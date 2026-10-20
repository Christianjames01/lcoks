package com.vaultlocks.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Add expense" pop-up that opens over the lock screen (Back Tap, double tap on the
 * back, or the notification). Pick Expense / Add money, the amount, a category
 * (Food, Fare…) and an account (Cash, GCash…). The entry is encrypted to the
 * vault's inbox public key; nothing from the vault is shown here except account names.
 */
public class QuickAddActivity extends Activity {
    private static final int BG = Color.parseColor("#141416");
    private static final int FG = Color.parseColor("#F5F5F7");
    private static final int MUTED = Color.parseColor("#8E8E93");
    private static final int CHIP = Color.parseColor("#232326");
    private static final int BORDER = Color.parseColor("#33FFFFFF");

    /** id, label (pop-up wording), kind — ids match src/shared/money.ts. */
    private static final String[][] CATEGORIES = {
        { "food", "Food", "expense" },
        { "transport", "Fare", "expense" },
        { "groceries", "Groceries", "expense" },
        { "bills", "Bills & Load", "expense" },
        { "shopping", "Shopping", "expense" },
        { "health", "Health", "expense" },
        { "education", "School", "expense" },
        { "entertainment", "Fun", "expense" },
        { "family", "Family", "expense" },
        { "other", "Other", "expense" },
        { "topup", "Cash in / Top-up", "income" },
        { "salary", "Salary", "income" },
        { "gifts", "Allowance", "income" },
        { "other-income", "Other", "income" }
    };

    private String kind = "expense";
    private String category = "food";
    private String account = null;
    private EditText amount;
    private EditText note;
    private LinearLayout categoryRow;
    private final List<TextView> kindButtons = new ArrayList<>();
    private final List<TextView> accountChips = new ArrayList<>();
    private boolean saving = false;
    private TextView accountLabel;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        // Keep the pop-up out of screenshots and the recent-apps preview.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        // Opened from the double-tap full-screen notification: remove it.
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(KnockService.POPUP_NOTIFICATION_ID);

        if (!QuickAdd.ready(this)) {
            Toast.makeText(this, "Open VaultLocks and unlock once to turn on quick add.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        setContentView(build());
        amount.requestFocus();
        amount.postDelayed(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(amount, InputMethodManager.SHOW_IMPLICIT);
        }, 150);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private GradientDrawable round(int color, float radiusDp, int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        if (stroke != 0) d.setStroke(dp(1), stroke);
        return d;
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView chip(String label) {
        TextView t = text(label, 14, FG, true);
        t.setPadding(dp(14), dp(9), dp(14), dp(9));
        t.setBackground(round(CHIP, 20, BORDER));
        t.setClickable(true);
        t.setFocusable(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(8));
        t.setLayoutParams(lp);
        return t;
    }

    private void select(TextView t, boolean on) {
        t.setBackground(round(on ? FG : CHIP, 20, on ? FG : BORDER));
        t.setTextColor(on ? Color.BLACK : FG);
        t.setSelected(on);
    }

    private HorizontalScrollView scrollRow(LinearLayout row) {
        HorizontalScrollView sv = new HorizontalScrollView(this);
        sv.setHorizontalScrollBarEnabled(false);
        sv.addView(row);
        return sv;
    }

    /** Height of the status bar, so the card starts just below it. */
    private int statusBar() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(24);
    }

    /**
     * Compact card at the TOP of the screen (like a notification), so the keyboard
     * below never covers it: Expense / Add cash, amount + Save, category, account, note.
     */
    private View build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#80000000"));
        root.setOnClickListener(v -> finish());

        ScrollView scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        scroll.setPadding(dp(10), statusBar() + dp(8), dp(10), dp(10));
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(14), dp(16), dp(16));
        card.setBackground(round(BG, 26, BORDER));
        card.setElevation(dp(12));
        card.setClickable(true); // taps inside don't close it
        scroll.addView(card);
        root.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        // Expense / Add cash (top row, always visible)
        LinearLayout seg = new LinearLayout(this);
        seg.setPadding(dp(4), dp(4), dp(4), dp(4));
        seg.setBackground(round(CHIP, 14, BORDER));
        for (String[] k : new String[][] { { "expense", "− Expense" }, { "income", "+ Add cash" } }) {
            TextView b = text(k[1], 15, FG, true);
            b.setGravity(Gravity.CENTER);
            b.setPadding(0, dp(10), 0, dp(10));
            b.setTag(k[0]);
            b.setOnClickListener(v -> setKind((String) v.getTag()));
            kindButtons.add(b);
            seg.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        card.addView(seg);

        // Amount + Save in one row
        String symbol = "₱";
        JSONObject meta = QuickAdd.meta(this);
        try {
            if (meta != null && meta.optString("currency", "").length() == 3) symbol = Currency.getInstance(meta.getString("currency")).getSymbol();
        } catch (Exception ignored) {
            // keep ₱
        }
        LinearLayout amountRow = new LinearLayout(this);
        amountRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout amountBox = new LinearLayout(this);
        amountBox.setGravity(Gravity.CENTER_VERTICAL);
        amountBox.setPadding(dp(14), 0, dp(10), 0);
        amountBox.setBackground(round(CHIP, 16, BORDER));
        amountBox.addView(text(symbol, 24, MUTED, true));
        amount = new EditText(this);
        amount.setHint("0");
        amount.setHintTextColor(Color.parseColor("#55FFFFFF"));
        amount.setTextColor(FG);
        amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        amount.setTypeface(Typeface.DEFAULT_BOLD);
        amount.setBackground(null);
        amount.setSingleLine(true);
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amount.setImeOptions(EditorInfo.IME_ACTION_DONE);
        amount.setPadding(dp(6), dp(8), 0, dp(8));
        amountBox.addView(amount, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        amountRow.addView(amountBox, new LinearLayout.LayoutParams(0, dp(60), 1));
        Button save = new Button(this);
        save.setText("Save");
        save.setAllCaps(false);
        save.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        save.setTypeface(Typeface.DEFAULT_BOLD);
        save.setTextColor(Color.BLACK);
        save.setBackground(round(FG, 16, 0));
        save.setOnClickListener(v -> save());
        LinearLayout.LayoutParams sbp = new LinearLayout.LayoutParams(dp(92), dp(60));
        sbp.setMarginStart(dp(8));
        amountRow.addView(save, sbp);
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        alp.topMargin = dp(10);
        card.addView(amountRow, alp);

        // Category
        card.addView(label("What is it?"));
        categoryRow = new LinearLayout(this);
        card.addView(scrollRow(categoryRow));

        // Account
        JSONArray accounts = meta == null ? null : meta.optJSONArray("accounts");
        if (accounts != null && accounts.length() > 0) {
            accountLabel = label("Paid with");
            card.addView(accountLabel);
            LinearLayout accRow = new LinearLayout(this);
            TextView none = chip("None");
            none.setTag(null);
            none.setOnClickListener(v -> setAccount(null));
            accountChips.add(none);
            accRow.addView(none);
            for (int i = 0; i < accounts.length(); i++) {
                JSONObject a = accounts.optJSONObject(i);
                if (a == null) continue;
                TextView c = chip(a.optString("name", "Account"));
                c.setTag(a.optString("id"));
                c.setOnClickListener(v -> setAccount((String) v.getTag()));
                accountChips.add(c);
                accRow.addView(c);
            }
            card.addView(scrollRow(accRow));
        }

        // Note
        note = new EditText(this);
        note.setHint("Note (optional), e.g. Jollibee");
        note.setHintTextColor(MUTED);
        note.setTextColor(FG);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        note.setSingleLine(true);
        note.setPadding(dp(14), dp(10), dp(14), dp(10));
        note.setBackground(round(CHIP, 14, BORDER));
        note.setImeOptions(EditorInfo.IME_ACTION_DONE);
        note.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });
        LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nlp.topMargin = dp(12);
        card.addView(note, nlp);

        TextView foot = text("🔒 Saved encrypted — added to VaultLocks when you unlock", 11.5f, MUTED, false);
        LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        flp.topMargin = dp(10);
        card.addView(foot, flp);

        amount.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });

        setKind(getIntent().getBooleanExtra("cash", false) ? "income" : "expense");
        setAccount(null);

        // Slide down from the top like a notification.
        card.setTranslationY(-dp(40));
        card.setAlpha(0f);
        card.animate().translationY(0).alpha(1f).setDuration(180).start();
        return root;
    }

    private TextView label(String s) {
        TextView t = text(s.toUpperCase(), 11, MUTED, true);
        t.setLetterSpacing(0.06f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        lp.bottomMargin = dp(8);
        t.setLayoutParams(lp);
        return t;
    }

    private void setKind(String k) {
        kind = k;
        if (accountLabel != null) accountLabel.setText("income".equals(k) ? "ADD TO" : "PAID WITH");
        for (TextView b : kindButtons) {
            boolean on = k.equals(b.getTag());
            b.setBackground(on ? round(FG, 11, 0) : null);
            b.setTextColor(on ? Color.BLACK : FG);
        }
        categoryRow.removeAllViews();
        String first = null;
        for (String[] c : CATEGORIES) {
            if (!c[2].equals(k)) continue;
            if (first == null) first = c[0];
            TextView t = chip(c[1]);
            t.setTag(c[0]);
            t.setOnClickListener(v -> setCategory((String) v.getTag()));
            categoryRow.addView(t);
        }
        setCategory(first);
    }

    private void setCategory(String id) {
        category = id;
        for (int i = 0; i < categoryRow.getChildCount(); i++) {
            TextView t = (TextView) categoryRow.getChildAt(i);
            select(t, id != null && id.equals(t.getTag()));
        }
    }

    private void setAccount(String id) {
        account = id;
        for (TextView t : accountChips) {
            Object tag = t.getTag();
            select(t, id == null ? tag == null : id.equals(tag));
        }
    }

    /** "1,250.50" → 125050; -1 if not a positive amount. */
    private static long minor(String s) {
        String t = s.replace(",", "").trim();
        if (!t.matches("\\d{1,13}(\\.\\d{0,2})?")) return -1;
        String[] p = t.split("\\.", -1);
        long whole = Long.parseLong(p[0]);
        String frac = p.length > 1 ? (p[1] + "00").substring(0, 2) : "00";
        long v = whole * 100 + Long.parseLong(frac);
        return v > 0 ? v : -1;
    }

    private void save() {
        if (saving) return;
        long v = minor(amount.getText().toString());
        if (v <= 0) {
            amount.setError("Enter an amount");
            return;
        }
        saving = true;
        String err = QuickAdd.addStructured(this, kind, v, category, account, note.getText().toString());
        if (err != null) {
            saving = false;
            Toast.makeText(this, err, Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, "Saved — it will be added when you unlock VaultLocks", Toast.LENGTH_SHORT).show();
        finish();
    }
}
