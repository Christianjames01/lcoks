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
}
