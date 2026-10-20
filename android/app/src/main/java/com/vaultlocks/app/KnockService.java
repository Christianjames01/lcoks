package com.vaultlocks.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Double tap on the BACK of the phone → the "Add expense" pop-up (QuickAddActivity).
 *
 * Fallback for phones whose own Back Tap cannot open an app. A foreground service
 * listens to the accelerometer ONLY while the screen is on (Android pauses sensors
 * when it is off, and it saves battery) and looks for two short, sharp knocks on the
 * Z axis 120–550 ms apart while the phone is otherwise still. No data is recorded.
 */
public class KnockService extends Service implements SensorEventListener {
    static final String CHANNEL = "knock";
    static final String POPUP_CHANNEL = "quick-add-popup";
    static final int NOTIFICATION_ID = 7311;
    static final int POPUP_NOTIFICATION_ID = 7312;
    private static final String PREF_ON = "knock";
    private static final String PREF_SENS = "knockSensitivity";

    private SensorManager sensors;
    private Sensor accel;
    private boolean listening = false;
    private final float[] gravity = new float[3];
    private boolean primed = false;
    private long firstKnock = 0;
    private long lastPeak = 0;
    private long cooldownUntil = 0;
    private float stillness = 0;
    private float threshold = 2.6f;

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_ON.equals(i.getAction())) listen(true);
            else if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) listen(false);
        }
    };

    // ------------------------------------------------------------ control --

    static boolean isOn(Context c) {
        return c.getSharedPreferences(QuickAdd.PREFS, Context.MODE_PRIVATE).getBoolean(PREF_ON, false);
    }

    /** 0 = low (firm taps), 1 = normal, 2 = high (light taps). */
    static int sensitivity(Context c) {
        return c.getSharedPreferences(QuickAdd.PREFS, Context.MODE_PRIVATE).getInt(PREF_SENS, 1);
    }

    static void setOn(Context c, boolean on, int sensitivity) {
        c.getSharedPreferences(QuickAdd.PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF_ON, on).putInt(PREF_SENS, Math.max(0, Math.min(2, sensitivity))).apply();
        if (on) start(c);
        else c.stopService(new Intent(c, KnockService.class));
    }

    static void start(Context c) {
        Intent i = new Intent(c, KnockService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception ignored) {
            // Not allowed right now (background start limits); it starts next time the app opens.
        }
    }

    /** Can the pop-up appear straight away (over other apps / from the background)? */
    static boolean canPopUp(Context c) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c);
    }

    // ------------------------------------------------------------ service --

    @Override
    public void onCreate() {
        super.onCreate();
        sensors = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        accel = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        threshold = new float[] { 3.6f, 2.6f, 1.8f }[sensitivity(this)];
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screen, f);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = ongoing();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION_ID, n);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        listen(pm == null || pm.isInteractive());
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        listen(false);
        try {
            unregisterReceiver(screen);
        } catch (Exception ignored) {
            // not registered
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void listen(boolean on) {
        if (accel == null || on == listening) return;
        listening = on;
        primed = false;
        firstKnock = 0;
        if (on) sensors.registerListener(this, accel, SensorManager.SENSOR_DELAY_FASTEST);
        else sensors.unregisterListener(this);
    }

    private Notification ongoing() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Double tap to add expense", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Shown while VaultLocks listens for a double tap on the back of the phone");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent popup = new Intent(this, QuickAddActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(this, 3, popup, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vault)
            .setContentTitle("Double tap the back to add an expense")
            .setContentText("Tap here to add one now")
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(pi)
            .build();
    }

    // ---------------------------------------------------------- detection --

    @Override
    public void onSensorChanged(SensorEvent e) {
        long now = SystemClock.elapsedRealtime();
        // Split gravity (slow) from movement (fast).
        final float a = 0.9f;
        if (!primed) {
            System.arraycopy(e.values, 0, gravity, 0, 3);
            primed = true;
            return;
        }
        for (int i = 0; i < 3; i++) gravity[i] = a * gravity[i] + (1 - a) * e.values[i];
        float x = e.values[0] - gravity[0];
        float y = e.values[1] - gravity[1];
        float z = e.values[2] - gravity[2];
        float side = (float) Math.sqrt(x * x + y * y);
        // Slowly decaying measure of how much the phone is moving (walking, shaking).
        stillness = 0.95f * stillness + 0.05f * (Math.abs(z) + side);

        if (now < cooldownUntil) return;
        boolean knock = Math.abs(z) > threshold && Math.abs(z) > side * 1.6f && stillness < threshold * 0.9f;
        if (!knock || now - lastPeak < 90) return; // one knock rings for a few samples
        lastPeak = now;

        if (firstKnock != 0 && now - firstKnock >= 120 && now - firstKnock <= 550) {
            firstKnock = 0;
            cooldownUntil = now + 2000;
            onDoubleTap();
        } else {
            firstKnock = now;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private void onDoubleTap() {
        Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null) {
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(30);
        }
        // VaultLocks is open and unlocked: use its own add form (no app switch, so no re-lock).
        if (VaultNativePlugin.openInApp(false)) return;
        if (!QuickAdd.ready(this)) return;
        Intent popup = new Intent(this, QuickAddActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (canPopUp(this)) {
            try {
                startActivity(popup);
                return;
            } catch (Exception ignored) {
                // fall through to the notification
            }
        }
        // Without "display over other apps", Android only lets a notification open it
        // (full-screen on the lock screen, a banner otherwise).
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(POPUP_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(POPUP_CHANNEL, "Add expense pop-up", NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(null, null);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        PendingIntent pi = PendingIntent.getActivity(this, 4, popup, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(this, POPUP_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vault)
            .setContentTitle("Add an expense")
            .setContentText("Tap to open")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setTimeoutAfter(15000)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .build();
        try {
            NotificationManagerCompat.from(this).notify(POPUP_NOTIFICATION_ID, n);
        } catch (SecurityException ignored) {
            // notifications not allowed
        }
    }
}
