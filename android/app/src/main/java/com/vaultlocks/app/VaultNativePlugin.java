package com.vaultlocks.app;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
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
                b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
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

    @PluginMethod
    public void biometricStatus(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject ret = new JSObject();
        ret.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(ret);
    }

    /** Show the system fingerprint prompt bound to the cipher; run the action with the unlocked cipher. */
    private void authenticate(PluginCall call, Cipher cipher, String title, CipherAction action) {
        getActivity().runOnUiThread(() -> {
          try {
            FragmentActivity activity = (FragmentActivity) getActivity();
            if (activity == null || !activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
                // Android will not show the prompt for a background app — report it instead of hanging.
                call.reject("App is not in the foreground", "NOT_VISIBLE");
                return;
            }
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("VaultLocks")
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .build();
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
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            try {
                c.init(Cipher.ENCRYPT_MODE, getOrCreateKey(BIO_ALIAS, true));
            } catch (KeyPermanentlyInvalidatedException e) {
                deleteKey(BIO_ALIAS);
                c.init(Cipher.ENCRYPT_MODE, getOrCreateKey(BIO_ALIAS, true));
            }
            authenticate(call, c, "Enable fingerprint unlock", (cipher) -> {
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
            authenticate(call, c, "Unlock VaultLocks", (cipher) -> {
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
}
