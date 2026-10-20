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
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
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

    private View build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#99000000"));
        root.setOnClickListener(v -> finish());

        ScrollView scroll = new ScrollView(this);
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(18), dp(20), dp(20));
        GradientDrawable bg = round(BG, 28, BORDER);
        bg.setCornerRadii(new float[] { dp(28), dp(28), dp(28), dp(28), 0, 0, 0, 0 });
        card.setBackground(bg);
        card.setClickable(true); // taps inside don't close it
        scroll.addView(card);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        root.addView(scroll, clp);

        // Header
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text("Add expense", 20, FG, true);
        head.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        head.addView(text("🔒 Stays encrypted", 12, MUTED, false));
        card.addView(head);

        // Expense / Add money
        LinearLayout seg = new LinearLayout(this);
        seg.setPadding(dp(4), dp(4), dp(4), dp(4));
        seg.setBackground(round(CHIP, 14, BORDER));
        LinearLayout.LayoutParams segLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        segLp.topMargin = dp(14);
        for (String[] k : new String[][] { { "expense", "Expense" }, { "income", "Add money" } }) {
            TextView b = text(k[1], 15, FG, true);
            b.setGravity(Gravity.CENTER);
            b.setPadding(0, dp(10), 0, dp(10));
            b.setTag(k[0]);
            b.setOnClickListener(v -> setKind((String) v.getTag()));
            kindButtons.add(b);
            seg.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        card.addView(seg, segLp);

        // Amount
        String symbol = "₱";
        JSONObject meta = QuickAdd.meta(this);
        try {
            if (meta != null && meta.optString("currency", "").length() == 3) symbol = Currency.getInstance(meta.getString("currency")).getSymbol();
        } catch (Exception ignored) {
            // keep ₱
        }
        LinearLayout amountRow = new LinearLayout(this);
        amountRow.setGravity(Gravity.CENTER_VERTICAL);
        amountRow.setPadding(dp(16), dp(4), dp(16), dp(4));
        amountRow.setBackground(round(CHIP, 16, BORDER));
        amountRow.addView(text(symbol, 30, MUTED, true));
        amount = new EditText(this);
        amount.setHint("0");
        amount.setHintTextColor(Color.parseColor("#55FFFFFF"));
        amount.setTextColor(FG);
        amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        amount.setTypeface(Typeface.DEFAULT_BOLD);
        amount.setBackground(null);
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amount.setImeOptions(EditorInfo.IME_ACTION_DONE);
        amount.setPadding(dp(8), dp(6), 0, dp(6));
        amountRow.addView(amount, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        alp.topMargin = dp(14);
        card.addView(amountRow, alp);

        // Category
        card.addView(label("What is it?"));
        categoryRow = new LinearLayout(this);
        card.addView(scrollRow(categoryRow));

        // Account
        JSONArray accounts = meta == null ? null : meta.optJSONArray("accounts");
        if (accounts != null && accounts.length() > 0) {
            card.addView(label("Paid with"));
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
        note.setPadding(dp(14), dp(12), dp(14), dp(12));
        note.setBackground(round(CHIP, 14, BORDER));
        note.setImeOptions(EditorInfo.IME_ACTION_DONE);
        note.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });
        LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nlp.topMargin = dp(16);
        card.addView(note, nlp);

        // Save
        Button save = new Button(this);
        save.setText("Save");
        save.setAllCaps(false);
        save.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        save.setTypeface(Typeface.DEFAULT_BOLD);
        save.setTextColor(Color.BLACK);
        save.setBackground(round(FG, 16, 0));
        save.setOnClickListener(v -> save());
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        slp.topMargin = dp(16);
        card.addView(save, slp);
        amount.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });

        setKind("expense");
        setAccount(null);
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
