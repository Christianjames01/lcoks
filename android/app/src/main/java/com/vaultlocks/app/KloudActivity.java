package com.vaultlocks.app;

import android.Manifest;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.LinearInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Kloud on the lock screen: listens, says back what it heard, and stores the
 * sentence encrypted for the app (QuickAdd.addVoice). The vault stays locked —
 * Kloud can add expenses and reminders here, never read anything out.
 */
public class KloudActivity extends Activity {
    private static final int MIC_REQUEST = 41;
    private static final long AUTO_CLOSE_MS = 9000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final KloudVoice voice = new KloudVoice();
    private boolean dark = true;
    private int fg, muted, cardTop, cardBottom, edge, tile;

    private Orb orb;
    private TextView status, heard, reply, hint;
    private TextView undo, again;
    private String savedBox;
    private boolean listening;
    private final Runnable autoClose = this::finish;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        if (!BuildConfig.DEBUG) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(KnockService.POPUP_NOTIFICATION_ID);
        palette();
        setContentView(build());
        if (!QuickAdd.ready(this)) {
            show("Open VaultLocks and unlock once to turn on Kloud.", false);
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) listen();
        else requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MIC_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != MIC_REQUEST) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) listen();
        else show("Kloud needs the microphone. Allow it for VaultLocks in the phone's settings.", false);
    }

    @Override
    protected void onPause() {
        super.onPause();
        voice.cancel();
        listening = false;
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        voice.cancel();
        if (orb != null) orb.stop();
        super.onDestroy();
    }

    // -------------------------------------------------------------- flow --

    private void listen() {
        main.removeCallbacks(autoClose);
        KloudVoice.hush();
        listening = true;
        status.setText("LISTENING…");
        heard.setText("");
        reply.setText("");
        reply.setVisibility(View.GONE);
        undo.setVisibility(View.GONE);
        again.setText("Done");
        hint.setVisibility(View.VISIBLE);
        orb.setActive(true);
        voice.start(this, new KloudVoice.Listener() {
            @Override public void onLevel(float rmsDb) {
                orb.setLevel(rmsDb);
            }
            @Override public void onPartial(String text) {
                heard.setText("“" + text + "”");
            }
            @Override public void onResult(String text) {
                listening = false;
                heard.setText("“" + text + "”");
                handle(text);
            }
            @Override public void onError(String message) {
                listening = false;
                show(message, true);
            }
        });
    }

    private void handle(String said) {
        orb.setActive(false);
        hint.setVisibility(View.GONE);
        KloudSay.Reply r = KloudSay.reply(said, QuickAdd.meta(this));
        if (r.save) {
            String err = QuickAdd.addVoice(this, said);
            if (err != null) {
                show(err, true);
                return;
            }
            savedBox = QuickAdd.lastBox;
            undo.setVisibility(View.VISIBLE);
        }
        status.setText(r.save ? "SAVED · ENCRYPTED" : "KLOUD");
        reply.setText(r.text);
        reply.setVisibility(View.VISIBLE);
        again.setText("Say another");
        KloudVoice.speak(this, r.spoken);
        main.postDelayed(autoClose, AUTO_CLOSE_MS);
    }

    private void show(String message, boolean speak) {
        orb.setActive(false);
        hint.setVisibility(View.GONE);
        status.setText("KLOUD");
        reply.setText(message);
        reply.setVisibility(View.VISIBLE);
        again.setText("Try again");
        if (speak) KloudVoice.speak(this, message);
    }

    // ---------------------------------------------------------------- UI --

    private void palette() {
        dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_NO;
        fg = dark ? 0xFFFFFFFF : 0xFF0A0A0B;
        muted = dark ? 0xFF9A9A9F : 0xFF6C6C72;
        cardTop = dark ? 0xF2262628 : 0xF7FFFFFF;
        cardBottom = dark ? 0xF70A0A0B : 0xF5F0F0F2;
        edge = dark ? 0x40FFFFFF : 0x26000000;
        tile = dark ? 0x1AFFFFFF : 0x0F000000;
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView button(String label, boolean primary) {
        TextView b = text(label, 14, primary ? (dark ? 0xFF0A0A0B : 0xFFFFFFFF) : fg, true);
        b.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        if (primary) bg.setColor(fg);
        else {
            bg.setColor(tile);
            bg.setStroke(dp(1), edge);
        }
        b.setBackground(bg);
        b.setPadding(dp(12), dp(12), dp(12), dp(12));
        return b;
    }

    private View build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(dark ? 0xB3000000 : 0x80000000);
        root.setOnClickListener(v -> finish());

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(16), dp(18), dp(18));
        GradientDrawable glass = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { cardTop, cardBottom });
        glass.setCornerRadius(dp(28));
        glass.setStroke(dp(1), edge);
        card.setBackground(glass);
        card.setElevation(dp(18));
        card.setClickable(true);

        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView name = text("Kloud", 15, fg, true);
        name.setGravity(Gravity.START);
        TextView sub = text("VaultLocks · locked · voice add", 11, muted, false);
        sub.setGravity(Gravity.START);
        titles.addView(name);
        titles.addView(sub);
        head.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView close = text("✕", 16, muted, false);
        close.setPadding(dp(10), dp(6), dp(4), dp(6));
        close.setContentDescription("Close");
        close.setOnClickListener(v -> finish());
        head.addView(close);
        card.addView(head);

        orb = new Orb(this, fg);
        LinearLayout.LayoutParams orbLp = new LinearLayout.LayoutParams(dp(190), dp(190));
        orbLp.gravity = Gravity.CENTER_HORIZONTAL;
        orbLp.topMargin = dp(10);
        card.addView(orb, orbLp);
        orb.setOnClickListener(v -> {
            if (listening) voice.stop();
            else listen();
        });

        status = text("KLOUD", 11.5f, muted, true);
        status.setLetterSpacing(0.14f);
        card.addView(status, lp(4));
        heard = text("", 21, fg, true);
        card.addView(heard, lp(8));
        reply = text("", 16, fg, false);
        reply.setVisibility(View.GONE);
        card.addView(reply, lp(12));
        hint = text("Try: “coffee 120” · “cash in 500 gcash” · “remind me to pay rent tomorrow at 9”", 12.5f, muted, false);
        card.addView(hint, lp(14));

        LinearLayout row = new LinearLayout(this);
        undo = button("Undo", false);
        undo.setVisibility(View.GONE);
        undo.setOnClickListener(v -> {
            if (savedBox != null && QuickAdd.removeBox(this, savedBox)) {
                savedBox = null;
                undo.setVisibility(View.GONE);
                reply.setText("Okay, I removed it.");
                KloudVoice.speak(this, "Okay, I removed it.");
                main.removeCallbacks(autoClose);
                main.postDelayed(autoClose, 2500);
            }
        });
        LinearLayout.LayoutParams half = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        half.rightMargin = dp(10);
        row.addView(undo, half);
        again = button("Done", true);
        again.setOnClickListener(v -> {
            if (listening) voice.stop();
            else listen();
        });
        row.addView(again, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(row, lp(18));

        TextView privacy = text("Saved encrypted until you unlock. Kloud never reads passwords, cards or balances out loud.", 11, muted, false);
        card.addView(privacy, lp(14));

        int width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(32), dp(360));
        root.addView(card, new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        return root;
    }

    private LinearLayout.LayoutParams lp(int topDp) {
        LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        l.topMargin = dp(topDp);
        return l;
    }

    /** The glowing orb: breathes while idle, pulses with the voice while listening. */
    static final class Orb extends View {
        private final Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final int color;
        private float phase;
        private float level;
        private boolean active;
        private final ValueAnimator anim = ValueAnimator.ofFloat(0f, 1f);

        Orb(Context c, int color) {
            super(c);
            this.color = color;
            ring.setStyle(Paint.Style.STROKE);
            anim.setDuration(2400);
            anim.setRepeatCount(ValueAnimator.INFINITE);
            anim.setInterpolator(new LinearInterpolator());
            anim.addUpdateListener(a -> {
                phase = (float) a.getAnimatedValue();
                level *= 0.92f;
                invalidate();
            });
            anim.start();
            setContentDescription("Kloud. Tap to talk");
        }

        void setActive(boolean on) {
            active = on;
        }

        void setLevel(float rmsDb) {
            float v = Math.max(0f, Math.min(1f, (rmsDb + 2f) / 12f));
            if (v > level) level = v;
        }

        void stop() {
            anim.cancel();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            float w = getWidth(), h = getHeight(), cx = w / 2f, cy = h / 2f;
            float base = Math.min(w, h) * 0.24f;
            float breathe = (float) Math.sin(phase * Math.PI * 2) * 0.04f;
            float r = base * (1f + breathe + (active ? level * 0.35f : 0f));
            int a = Color.alpha(color);
            int rgb = color & 0x00FFFFFF;
            glow.setShader(new RadialGradient(cx, cy, r * 2.1f, new int[] { 0xFF000000 | rgb, (0x8C << 24) | rgb, (0x1F << 24) | rgb, rgb }, new float[] { 0f, 0.18f, 0.45f, 1f }, Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, r * 2.1f, glow);
            ring.setStrokeWidth(Math.max(2f, w / 120f));
            ring.setColor((0x8C << 24) | rgb);
            canvas.drawCircle(cx, cy, r * 1.55f, ring);
            ring.setColor((0x33 << 24) | rgb);
            float spin = phase * 360f;
            canvas.save();
            canvas.rotate(spin, cx, cy);
            ring.setPathEffect(new android.graphics.DashPathEffect(new float[] { w / 40f, w / 28f }, 0));
            canvas.drawCircle(cx, cy, r * 1.95f, ring);
            ring.setPathEffect(null);
            canvas.restore();
            if (a == 0) return;
        }
    }
}
