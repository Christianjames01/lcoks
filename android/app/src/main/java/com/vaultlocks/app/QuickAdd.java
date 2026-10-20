package com.vaultlocks.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONObject;

/**
 * Adding expenses while the vault is LOCKED (see src/core/inbox.ts):
 *
 *   - an ongoing notification with an "Add expense" reply field, and
 *   - the QuickAddActivity pop-up (opened by Back Tap / double tap / notification).
 *
 * Each entry is encrypted to the vault's inbox public key (files/vault/inbox.pub) and
 * written as its own inbox-<uuid>.box file; the app adds it on the next unlock. Only
 * the account NAMES and currency (files/vault/inbox.meta) are readable here — never
 * balances or records.
 */
public final class QuickAdd {
    static final String CHANNEL = "quick-add";
    static final int NOTIFICATION_ID = 7310;
    static final String KEY_TEXT = "text";
    static final String ACTION_ADD = "com.vaultlocks.app.QUICK_ADD";
    static final String PREFS = "vaultlocks.quickadd";
    private static final String PREF_ON = "on";
    private static final int MAX_PENDING = 500;

    private QuickAdd() {}

    static boolean isOn(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PREF_ON, false);
    }

    static void setOn(Context c, boolean on) {
        SharedPreferences.Editor e = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putBoolean(PREF_ON, on).apply();
        if (on) show(c, null);
        else NotificationManagerCompat.from(c).cancel(NOTIFICATION_ID);
    }

    static File vaultDir(Context c) {
        return new File(c.getFilesDir(), "vault");
    }

    /** Quick add is set up once the vault has been unlocked with this version (inbox.pub exists). */
    static boolean ready(Context c) {
        return new File(vaultDir(c), "inbox.pub").isFile();
    }

    /** Account names + currency for the pop-up, or null. */
    static JSONObject meta(Context c) {
        try {
            String s = readText(new File(vaultDir(c), "inbox.meta"), 64 * 1024);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static String readText(File f, int max) throws Exception {
        if (!f.isFile()) return null;
        byte[] buf = new byte[(int) Math.min(f.length(), max)];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0;
            while (off < buf.length) {
                int r = in.read(buf, off, buf.length - off);
                if (r < 0) break;
                off += r;
            }
        }
        return new String(buf, StandardCharsets.UTF_8);
    }

    /** Post (or refresh) the notification; `status` replaces the hint line after a reply. */
    static void show(Context c, String status) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Quick add expense", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Add an expense from the notification shade or lock screen");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        Intent add = new Intent(c, QuickAddReceiver.class).setAction(ACTION_ADD);
        PendingIntent addPi = PendingIntent.getBroadcast(c, 1, add, PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        RemoteInput input = new RemoteInput.Builder(KEY_TEXT).setLabel("e.g. lunch 150 gcash").build();
        NotificationCompat.Action action = new NotificationCompat.Action.Builder(R.drawable.ic_stat_vault, "Type it", addPi)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(false)
            .build();

        // Tapping the notification opens the pop-up (categories + accounts) over the lock screen.
        Intent popup = new Intent(c, QuickAddActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent popupPi = PendingIntent.getActivity(c, 2, popup, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Action open = new NotificationCompat.Action.Builder(R.drawable.ic_stat_vault, "− Expense", popupPi).build();
        Intent cash = new Intent(c, QuickAddActivity.class).putExtra("cash", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent cashPi = PendingIntent.getActivity(c, 5, cash, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Action addCash = new NotificationCompat.Action.Builder(R.drawable.ic_stat_vault, "+ Add cash", cashPi).build();

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vault)
            .setContentTitle("VaultLocks quick add")
            .setContentText(status != null ? status : "Add an expense or cash — or type “lunch 150”")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(popupPi)
            .addAction(open)
            .addAction(addCash)
            .addAction(action);
        try {
            NotificationManagerCompat.from(c).notify(NOTIFICATION_ID, b.build());
        } catch (SecurityException e) {
            // Notification permission withdrawn: nothing to show.
        }
    }

    /** Typed reply, e.g. "lunch 150 gcash": parsed by the app on unlock. */
    static String addText(Context c, String text) {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty() || t.length() > 200) return "Type an expense, e.g. “lunch 150”";
        if (!t.matches(".*\\d.*")) return "Add an amount, e.g. “lunch 150”";
        try {
            JSONObject entry = new JSONObject();
            entry.put("t", t);
            String err = writeBox(c, entry);
            if (err != null) return err;
            return "Saved “" + (t.length() > 40 ? t.substring(0, 40) + "…" : t) + "” — added when you unlock";
        } catch (Exception e) {
            return "Could not save. Please try again";
        }
    }

    /** Entry from the pop-up. kind: "expense" | "income"; amount in minor units. Returns null on success, else a message. */
    static String addStructured(Context c, String kind, long amount, String category, String accountId, String note) {
        if (amount <= 0 || amount > 100_000_000_000_000L) return "Enter an amount";
        try {
            JSONObject entry = new JSONObject();
            entry.put("t", note == null ? "" : note.trim());
            entry.put("k", "income".equals(kind) ? "income" : "expense");
            entry.put("a", amount);
            if (category != null) entry.put("c", category);
            if (accountId != null) entry.put("acc", accountId);
            return writeBox(c, entry);
        } catch (Exception e) {
            return "Could not save. Please try again";
        }
    }

    /** Add day/time, encrypt to inbox.pub, write inbox-<uuid>.box atomically. Returns null on success. */
    private static String writeBox(Context c, JSONObject entry) throws Exception {
        File dir = vaultDir(c);
        File pubFile = new File(dir, "inbox.pub");
        if (!pubFile.isFile()) return "Open VaultLocks and unlock once to turn on quick add";
        File[] boxes = dir.listFiles((d, n) -> n.startsWith("inbox-") && n.endsWith(".box"));
        if (boxes != null && boxes.length >= MAX_PENDING) return "Too many waiting — unlock VaultLocks to add them";
        byte[] pub = Base64.decode(readText(pubFile, 200).trim(), Base64.DEFAULT);

        SimpleDateFormat day = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        Date now = new Date();
        entry.put("day", day.format(now));
        entry.put("at", iso.format(now));

        QuickAddCrypto.Sealed s = QuickAddCrypto.seal(pub, entry.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject box = new JSONObject();
        box.put("v", 1);
        box.put("epk", Base64.encodeToString(s.epk, Base64.NO_WRAP));
        box.put("iv", Base64.encodeToString(s.iv, Base64.NO_WRAP));
        box.put("ct", Base64.encodeToString(s.ct, Base64.NO_WRAP));

        File target = new File(dir, "inbox-" + UUID.randomUUID() + ".box");
        File tmp = new File(dir, "." + target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(box.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            out.getFD().sync();
        }
        if (!tmp.renameTo(target)) {
            tmp.delete();
            return "Could not save. Please try again";
        }
        return null;
    }

    /** Receives the typed reply. */
    public static class QuickAddReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            if (!ACTION_ADD.equals(intent.getAction())) return;
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence text = results == null ? null : results.getCharSequence(KEY_TEXT);
            PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    String status = addText(c, text == null ? null : text.toString());
                    // Re-posting clears the reply spinner and shows the result.
                    if (isOn(c)) show(c, status);
                } finally {
                    pending.finish();
                }
            }).start();
        }
    }

    /** Puts the notification and the double-tap detector back after a reboot or app update. */
    public static class BootReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent intent) {
            String a = intent.getAction();
            if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
            if (isOn(c)) show(c, null);
            if (KnockService.isOn(c)) KnockService.start(c);
        }
    }
}
