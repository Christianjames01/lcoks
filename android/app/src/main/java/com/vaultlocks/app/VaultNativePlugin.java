package com.vaultlocks.app;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.os.StatFs;
import android.view.WindowManager;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import java.io.ByteArrayOutputStream;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.util.regex.Pattern;

/**
 * SECURITY-SENSITIVE: native storage + clipboard for VaultLocks.
 *
 * - The vault lives in the app's private internal storage (getFilesDir()/vault),
 *   readable only by this app and excluded from Android backups (see manifest).
 * - Writes are atomic: temp file -> fsync -> rename over the old file, so an
 *   interrupted write never leaves a half-written vault.
 * - Copied secrets are flagged as sensitive (hidden from clipboard previews on
 *   Android 13+) and cleared by a native timer even if the app is backgrounded.
 * - Nothing here ever logs file contents or clipboard values.
 */
@CapacitorPlugin(name = "VaultNative")
public class VaultNativePlugin extends Plugin {

    private static final String CLIP_LABEL = "VaultLocks";
    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9._-]{1,100}$");
    private static final int MAX_BYTES = 64 * 1024 * 1024;

    private final Handler handler = new Handler(Looper.getMainLooper());

    // Text shared into the app ("Share -> VaultLocks"); kept in memory only, handed over once.
    private static String pendingSharedText;

    static void setSharedText(String text) {
        if (text == null || text.isEmpty()) return;
        pendingSharedText = text.length() > 1_000_000 ? text.substring(0, 1_000_000) : text;
    }

    @PluginMethod
    public void takeSharedText(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("text", pendingSharedText == null ? JSObject.NULL : pendingSharedText);
        pendingSharedText = null;
        call.resolve(ret);
    }

    /**
     * SECURITY: the system camera saves the photo it takes for us UNENCRYPTED in
     * app-specific storage (Pictures/). As soon as the app has read it, delete it.
     */
    @PluginMethod
    public void purgeCaptures(PluginCall call) {
        try {
            java.io.File dir = getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES);
            java.io.File[] files = dir == null ? null : dir.listFiles();
            if (files != null) {
                for (java.io.File f : files) f.delete();
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void readClipboard(PluginCall call) {
        String text = "";
        try {
            ClipData clip = clipboard().getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence cs = clip.getItemAt(0).coerceToText(getContext());
                if (cs != null) text = cs.toString();
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("text", text);
        call.resolve(ret);
    }
    private Runnable pendingClear;

    // ------------------------------------------------------------ storage ----

    private File vaultDir() {
        File dir = new File(getContext().getFilesDir(), "vault");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File exportDir() {
        File dir = new File(getContext().getCacheDir(), "exports");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** Only plain file names are accepted — no paths, no traversal. */
    private String name(PluginCall call) {
        String n = call.getString("name", "");
        if (n == null || !SAFE_NAME.matcher(n).matches() || n.startsWith(".")) {
            call.reject("Invalid file name");
            return null;
        }
        return n;
    }

    private static byte[] readAll(File f) throws IOException {
        long len = f.length();
        if (len > MAX_BYTES) throw new IOException("too large");
        byte[] buf = new byte[(int) len];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0;
            while (off < buf.length) {
                int r = in.read(buf, off, buf.length - off);
                if (r < 0) break;
                off += r;
            }
        }
        return buf;
    }

    private static void writeAtomicTo(File target, String data) throws IOException {
        File tmp = new File(target.getParentFile(), "." + target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data.getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();
        }
        if (!tmp.renameTo(target)) {
            tmp.delete();
            throw new IOException("rename failed");
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        String n = name(call);
        if (n == null) return;
        try {
            File f = new File(vaultDir(), n);
            JSObject ret = new JSObject();
            if (f.exists()) ret.put("data", new String(readAll(f), StandardCharsets.UTF_8));
            else ret.put("data", JSObject.NULL);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Read failed");
        }
    }

    @PluginMethod
    public void writeAtomic(PluginCall call) {
        String n = name(call);
        if (n == null) return;
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            writeAtomicTo(new File(vaultDir(), n), data);
            call.resolve();
        } catch (Exception e) {
            call.reject("Write failed");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String n = name(call);
        if (n == null) return;
        new File(vaultDir(), n).delete();
        call.resolve();
    }

    @PluginMethod
    public void stat(PluginCall call) {
        String n = name(call);
        if (n == null) return;
        File f = new File(vaultDir(), n);
        JSObject ret = new JSObject();
        ret.put("exists", f.exists());
        ret.put("size", f.exists() ? f.length() : 0);
        ret.put("mtime", f.exists() ? f.lastModified() : 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void writeExport(PluginCall call) {
        String n = name(call);
        if (n == null) return;
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            File f = new File(exportDir(), n);
            writeAtomicTo(f, data);
            JSObject ret = new JSObject();
            ret.put("uri", Uri.fromFile(f).toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Write failed");
        }
    }

    @PluginMethod
    public void clearExports(PluginCall call) {
        File[] files = exportDir().listFiles();
        if (files != null) {
            for (File f : files) f.delete();
        }
        call.resolve();
    }

    // ---------------------------------------------------------- clipboard ----

    private ClipboardManager clipboard() {
        return (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
    }

    @PluginMethod
    public void copySecret(PluginCall call) {
        String text = call.getString("text", "");
        int seconds = Math.max(10, Math.min(120, call.getInt("clearAfterSeconds", 30)));
        ClipboardManager cm = clipboard();
        ClipData clip = ClipData.newPlainText(CLIP_LABEL, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            PersistableBundle extras = new PersistableBundle();
            // ClipDescription.EXTRA_IS_SENSITIVE (Android 13+): hides the value in the clipboard preview.
            extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
        }
        cm.setPrimaryClip(clip);
        if (pendingClear != null) handler.removeCallbacks(pendingClear);
        pendingClear = this::clearIfOurs;
        handler.postDelayed(pendingClear, seconds * 1000L);
        call.resolve();
    }

    @PluginMethod
    public void clearClipboard(PluginCall call) {
        if (pendingClear != null) {
            handler.removeCallbacks(pendingClear);
            clearIfOurs();
        }
        call.resolve();
    }

    /** Clear only if the clipboard still holds our value (or Android hides what it holds). */
    private void clearIfOurs() {
        pendingClear = null;
        try {
            ClipboardManager cm = clipboard();
            ClipDescription d = cm.getPrimaryClipDescription();
            if (d == null || (d.getLabel() != null && CLIP_LABEL.contentEquals(d.getLabel()))) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cm.clearPrimaryClip();
                else cm.setPrimaryClip(ClipData.newPlainText("", ""));
            }
        } catch (Exception ignored) {
            // Clipboard unavailable — nothing more we can do.
        }
    }

    // ------------------------------------------------- quick unlock keys ----
    //
    // SECURITY: two AES-256-GCM keys live in the Android Keystore (TEE/StrongBox
    // hardware where available) and can never be exported:
    //  * BIO_ALIAS    - usable only right after a strong biometric (fingerprint)
    //                   authentication; invalidated if fingerprints are added/removed.
    //  * DEVICE_ALIAS - binds the PIN-protected key wrap to this device, so the
    //                   4-digit PIN cannot be brute-forced on another machine.

    private static final String BIO_ALIAS = "vaultlocks_bio";
    private static final String DEVICE_ALIAS = "vaultlocks_device";
    private static final int GCM_TAG_BITS = 128;

    private interface CipherAction {
        void run(Cipher cipher) throws Exception;
    }

    private static KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks;
    }

    private static SecretKey getOrCreateKey(String alias, boolean requireBiometric) throws Exception {
        KeyStore ks = keyStore();
        if (ks.containsAlias(alias)) return (SecretKey) ks.getKey(alias, null);
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256);
        if (requireBiometric) {
            b.setUserAuthenticationRequired(true);
            b.setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Strong biometrics OR the device screen-lock PIN/pattern/password.
                b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
            }
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(b.build());
        return kg.generateKey();
    }

    private static void deleteKey(String alias) {
        try {
            keyStore().deleteEntry(alias);
        } catch (Exception ignored) {}
    }

    private static String b64(byte[] b) {
        return Base64.encodeToString(b, Base64.NO_WRAP);
    }

    private static byte[] unb64(String s) {
        return Base64.decode(s, Base64.NO_WRAP);
    }

    /** Biometrics + device credential on Android 11+; biometrics only before that. */
    private static int authenticators() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_STRONG;
    }

    @PluginMethod
    public void biometricStatus(PluginCall call) {
        BiometricManager bm = BiometricManager.from(getContext());
        boolean bio = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS;
        boolean any = bm.canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS;
        JSObject ret = new JSObject();
        ret.put("available", any);
        ret.put("biometric", bio);
        ret.put("deviceCredential", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && any);
        call.resolve(ret);
    }

    /** Show the system fingerprint prompt bound to the cipher; run the action with the unlocked cipher. */
    private void authenticate(PluginCall call, Cipher cipher, String title, CipherAction action) {
        authenticate(call, cipher, title, "any", action);
    }

    /**
     * mode: "any" = biometrics or device passcode (Android 11+), "biometric" = face/fingerprint
     * only, "credential" = device PIN/pattern/password only (Android 11+).
     */
    private void authenticate(PluginCall call, Cipher cipher, String title, String mode, CipherAction action) {
        getActivity().runOnUiThread(() -> {
          try {
            FragmentActivity activity = (FragmentActivity) getActivity();
            if (activity == null || !activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
                // Android will not show the prompt for a background app — report it instead of hanging.
                call.reject("App is not in the foreground", "NOT_VISIBLE");
                return;
            }
            boolean r = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
            int allowed;
            if ("credential".equals(mode) && r) allowed = BiometricManager.Authenticators.DEVICE_CREDENTIAL;
            else if ("biometric".equals(mode) || !r) allowed = BiometricManager.Authenticators.BIOMETRIC_STRONG;
            else allowed = authenticators();
            BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("VaultLocks")
                .setAllowedAuthenticators(allowed);
            // A negative button is not allowed when the device passcode is an option.
            if ((allowed & BiometricManager.Authenticators.DEVICE_CREDENTIAL) == 0) builder.setNegativeButtonText("Cancel");
            BiometricPrompt.PromptInfo info = builder.build();
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(getContext()),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        try {
                            BiometricPrompt.CryptoObject co = result.getCryptoObject();
                            if (co == null || co.getCipher() == null) throw new IllegalStateException();
                            action.run(co.getCipher());
                        } catch (Exception e) {
                            call.reject("Fingerprint operation failed", "FAILED");
                        }
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence msg) {
                        boolean canceled = code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                            || code == BiometricPrompt.ERROR_USER_CANCELED
                            || code == BiometricPrompt.ERROR_CANCELED;
                        call.reject(canceled ? "Canceled" : String.valueOf(msg), canceled ? "CANCELED" : "ERROR");
                    }
                }
            );
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
          } catch (Exception e) {
            call.reject("Fingerprint prompt unavailable", "NOT_VISIBLE");
          }
        });
    }

    @PluginMethod
    public void bioEncrypt(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            deleteKey(BIO_ALIAS);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, getOrCreateKey(BIO_ALIAS, true));
            authenticate(call, c, "Turn on quick unlock", (cipher) -> {
                byte[] ct = cipher.doFinal(unb64(data));
                JSObject ret = new JSObject();
                ret.put("iv", b64(cipher.getIV()));
                ret.put("data", b64(ct));
                call.resolve(ret);
            });
        } catch (Exception e) {
            call.reject("Fingerprint unlock is not available", "UNAVAILABLE");
        }
    }

    @PluginMethod
    public void bioDecrypt(PluginCall call) {
        String iv = call.getString("iv");
        String data = call.getString("data");
        if (iv == null || data == null) {
            call.reject("No data");
            return;
        }
        try {
            if (!keyStore().containsAlias(BIO_ALIAS)) {
                call.reject("Fingerprint key missing", "INVALIDATED");
                return;
            }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            try {
                c.init(Cipher.DECRYPT_MODE, getOrCreateKey(BIO_ALIAS, true), new GCMParameterSpec(GCM_TAG_BITS, unb64(iv)));
            } catch (KeyPermanentlyInvalidatedException e) {
                // Fingerprints changed since enrollment: the key is gone for good.
                deleteKey(BIO_ALIAS);
                call.reject("Fingerprints changed", "INVALIDATED");
                return;
            }
            String mode = call.getString("mode", "any");
            authenticate(call, c, "Unlock VaultLocks", mode, (cipher) -> {
                JSObject ret = new JSObject();
                ret.put("data", b64(cipher.doFinal(unb64(data))));
                call.resolve(ret);
            });
        } catch (Exception e) {
            call.reject("Fingerprint unlock failed", "ERROR");
        }
    }

    @PluginMethod
    public void deviceEncrypt(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, getOrCreateKey(DEVICE_ALIAS, false));
            byte[] ct = c.doFinal(unb64(data));
            JSObject ret = new JSObject();
            ret.put("iv", b64(c.getIV()));
            ret.put("data", b64(ct));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Device key unavailable", "UNAVAILABLE");
        }
    }

    @PluginMethod
    public void deviceDecrypt(PluginCall call) {
        String iv = call.getString("iv");
        String data = call.getString("data");
        if (iv == null || data == null) {
            call.reject("No data");
            return;
        }
        try {
            if (!keyStore().containsAlias(DEVICE_ALIAS)) {
                call.reject("Device key missing", "INVALIDATED");
                return;
            }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, getOrCreateKey(DEVICE_ALIAS, false), new GCMParameterSpec(GCM_TAG_BITS, unb64(iv)));
            JSObject ret = new JSObject();
            ret.put("data", b64(c.doFinal(unb64(data))));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Device key unavailable", "INVALIDATED");
        }
    }

    @PluginMethod
    public void resetKey(PluginCall call) {
        String kind = call.getString("kind", "");
        if ("biometric".equals(kind)) deleteKey(BIO_ALIAS);
        else if ("device".equals(kind)) deleteKey(DEVICE_ALIAS);
        call.resolve();
    }

    // ------------------------------------------------------ vault files ----

    @PluginMethod
    public void list(PluginCall call) {
        JSArray files = new JSArray();
        File[] all = vaultDir().listFiles();
        if (all != null) {
            for (File f : all) {
                if (!f.isFile() || !SAFE_NAME.matcher(f.getName()).matches() || f.getName().startsWith(".")) continue;
                JSObject o = new JSObject();
                o.put("name", f.getName());
                o.put("size", f.length());
                files.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String from = call.getString("from", "");
        String to = call.getString("to", "");
        if (!SAFE_NAME.matcher(from).matches() || !SAFE_NAME.matcher(to).matches() || from.startsWith(".") || to.startsWith(".")) {
            call.reject("Invalid file name");
            return;
        }
        File src = new File(vaultDir(), from);
        if (!src.renameTo(new File(vaultDir(), to))) {
            call.reject("Rename failed");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void freeSpace(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("bytes", new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes());
        } catch (Exception e) {
            ret.put("bytes", -1);
        }
        call.resolve(ret);
    }

    // ---------------------------------------- attachments: export / view ----

    private File writeExportBytes(String name, byte[] bytes) throws IOException {
        File f = new File(exportDir(), name);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(bytes);
            out.getFD().sync();
        }
        return f;
    }

    /** Decoded (binary) file in the private export cache, for the share sheet. */
    @PluginMethod
    public void writeExportBase64(PluginCall call) {
        String n = name(call);
        if (n == null) return;
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            File f = writeExportBytes(n, unb64(data));
            JSObject ret = new JSObject();
            ret.put("uri", Uri.fromFile(f).toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Write failed");
        }
    }

    /**
     * Open an attachment in another app (explicit user action). The decrypted copy
     * lives only in the private export cache and is deleted on the next export /
     * app start; access is granted to the chosen app via a temporary content URI.
     */
    @PluginMethod
    public void openFile(PluginCall call) {
        String n = name(call);
        if (n == null) return;
        String data = call.getString("data");
        String mime = call.getString("mime", "application/octet-stream");
        if (data == null) {
            call.reject("No data");
            return;
        }
        try {
            File f = writeExportBytes(n, unb64(data));
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent chooser = Intent.createChooser(view, "Open with");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (android.content.ActivityNotFoundException e) {
            call.reject("No app can open this file", "NO_APP");
        } catch (Exception e) {
            call.reject("Could not open the file", "ERROR");
        }
    }

    /**
     * Render PDF pages to PNG images INSIDE the app (no copy is handed to other
     * apps). The temporary decrypted PDF is in private cache and deleted at once.
     */
    @PluginMethod
    public void renderPdf(PluginCall call) {
        String data = call.getString("data");
        int maxPages = Math.max(1, Math.min(60, call.getInt("maxPages", 30)));
        int width = Math.max(320, Math.min(2000, call.getInt("width", 1200)));
        if (data == null) {
            call.reject("No data");
            return;
        }
        File tmp = new File(getContext().getCacheDir(), "pdf-render.tmp");
        try {
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(unb64(data));
            }
            JSArray pages = new JSArray();
            int total;
            try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(fd)) {
                total = renderer.getPageCount();
                for (int i = 0; i < Math.min(total, maxPages); i++) {
                    try (PdfRenderer.Page page = renderer.openPage(i)) {
                        int h = Math.max(1, Math.round((float) width * page.getHeight() / Math.max(1, page.getWidth())));
                        Bitmap bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888);
                        bmp.eraseColor(Color.WHITE);
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        ByteArrayOutputStream png = new ByteArrayOutputStream();
                        bmp.compress(Bitmap.CompressFormat.JPEG, 85, png);
                        bmp.recycle();
                        pages.put("data:image/jpeg;base64," + b64(png.toByteArray()));
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("pages", pages);
            ret.put("total", total);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("This PDF is password-protected", "PDF_LOCKED");
        } catch (Exception e) {
            call.reject("This PDF could not be displayed", "PDF_ERROR");
        } finally {
            tmp.delete();
        }
    }

    /** Screenshot / screen-recording protection (FLAG_SECURE), per the user's setting. */
    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", true));
        getActivity().runOnUiThread(() -> {
            if (secure) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }
}
