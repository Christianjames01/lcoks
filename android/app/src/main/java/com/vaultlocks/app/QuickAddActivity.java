package com.vaultlocks.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Small "Add expense / Add cash" pop-up at the TOP of the screen, over the lock
 * screen or any app (Back Tap, double tap on the back, or the notification).
 * The entry is encrypted to the vault's inbox public key; nothing from the vault is
 * shown except account names — and balances, only if the user turned that on.
 */
public class QuickAddActivity extends Activity {
    private static final int BG = Color.parseColor("#1C1C1F");
    private static final int FG = Color.parseColor("#F5F5F7");
    private static final int MUTED = Color.parseColor("#8E8E93");
    private static final int CHIP = Color.parseColor("#2A2A2E");
    private static final int BORDER = Color.parseColor("#26FFFFFF");
    private static final int RED = Color.parseColor("#FF453A");
    private static final int GREEN = Color.parseColor("#30D158");

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

    private static final String PREF_DELTA = "pendingDelta.";
    private static final String PREF_STAMP = "pendingStamp";

    private String kind = "expense";
    private String category = "food";
    private String account = null;
    private String currency = "PHP";
    private EditText amount;
    private EditText note;
    private TextView save;
    private TextView balanceLine;
    private TextView accountLabel;
    private LinearLayout categoryRow;
    private final List<TextView> kindButtons = new ArrayList<>();
    private final List<TextView> accountChips = new ArrayList<>();
    private final List<JSONObject> accounts = new ArrayList<>();
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
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
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

    @Override
    protected void onDestroy() {
        VaultNativePlugin.quickAddClosed();
        super.onDestroy();
    }

    // ------------------------------------------------------------- helpers --

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
        TextView t = text(label, 13, FG, true);
        t.setPadding(dp(11), dp(6), dp(11), dp(6));
        t.setBackground(round(CHIP, 16, BORDER));
        t.setClickable(true);
        t.setFocusable(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(6));
        t.setLayoutParams(lp);
        return t;
    }

    private int accent() {
        return "income".equals(kind) ? GREEN : RED;
    }

    private void select(TextView t, boolean on) {
        int a = accent();
        t.setBackground(round(on ? a : CHIP, 16, on ? a : BORDER));
        t.setTextColor(on ? Color.BLACK : FG);
        t.setSelected(on);
    }

    private HorizontalScrollView scrollRow(LinearLayout row) {
        HorizontalScrollView sv = new HorizontalScrollView(this);
        sv.setHorizontalScrollBarEnabled(false);
        sv.addView(row);
        return sv;
    }

    private TextView label(String s) {
        TextView t = text(s, 11, MUTED, true);
        t.setLetterSpacing(0.06f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        lp.bottomMargin = dp(6);
        t.setLayoutParams(lp);
        return t;
    }

    private int statusBar() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? getResources().getDimensionPixelSize(id) : dp(24);
    }

    private String money(long minor) {
        NumberFormat f = NumberFormat.getCurrencyInstance(Locale.getDefault());
        try {
            f.setCurrency(Currency.getInstance(currency));
        } catch (Exception ignored) {
            // keep the default
        }
        f.setMaximumFractionDigits(minor % 100 == 0 ? 0 : 2);
        f.setMinimumFractionDigits(minor % 100 == 0 ? 0 : 2);
        return f.format(minor / 100.0);
    }

    // ------------------------------------------------------- balances (opt-in) --

    /**
     * Balance known to the pop-up: the one the app wrote at the last unlock (only if
     * "Show balances in the pop-up" is on) plus what was added here since then.
     */
    private Long balanceOf(JSONObject a) {
        if (a == null || !a.has("balance")) return null;
        return a.optLong("balance") + prefs().getLong(PREF_DELTA + a.optString("id"), 0);
    }

    private SharedPreferences prefs() {
        SharedPreferences p = getSharedPreferences(QuickAdd.PREFS, Context.MODE_PRIVATE);
        // inbox.meta is rewritten on every unlock: changes made here are then in its balances.
        long stamp = new File(QuickAdd.vaultDir(this), "inbox.meta").lastModified();
        if (p.getLong(PREF_STAMP, -1) != stamp) {
            SharedPreferences.Editor e = p.edit();
            for (String k : p.getAll().keySet()) if (k.startsWith(PREF_DELTA)) e.remove(k);
            e.putLong(PREF_STAMP, stamp).apply();
        }
        return p;
    }

    private JSONObject accountById(String id) {
        if (id == null) return null;
        for (JSONObject a : accounts) if (id.equals(a.optString("id"))) return a;
        return null;
    }

    private void updateBalanceLine() {
        if (balanceLine == null) return;
        JSONObject a = accountById(account);
        Long bal = balanceOf(a);
        if (bal == null) {
            balanceLine.setVisibility(View.GONE);
            return;
        }
        long v = minor(amount.getText().toString());
        String name = a.optString("name");
        if (v <= 0) {
            balanceLine.setText(name + " balance: " + money(bal));
            balanceLine.setTextColor(MUTED);
        } else {
            long after = "income".equals(kind) ? bal + v : bal - v;
            balanceLine.setText(name + ": " + money(bal) + "  →  " + money(after) + ("income".equals(kind) ? "" : " left"));
            balanceLine.setTextColor(accent());
        }
        balanceLine.setVisibility(View.VISIBLE);
    }

    // -------------------------------------------------------------- layout --

    private View build() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#33000000"));
        root.setOnClickListener(v -> finish());

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(14));
        card.setBackground(round(BG, 22, BORDER));
        card.setElevation(dp(16));
        card.setClickable(true); // taps inside don't close it
        int width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(24), dp(400));
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        clp.topMargin = statusBar() + dp(8);
        root.addView(card, clp);

        // App name + logo, close
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo = new ImageView(this);
        try {
            Drawable icon = getPackageManager().getApplicationIcon(getPackageName());
            logo.setImageDrawable(icon);
        } catch (Exception ignored) {
            logo.setImageResource(R.mipmap.ic_launcher);
        }
        head.addView(logo, new LinearLayout.LayoutParams(dp(22), dp(22)));
        TextView name = text("VaultLocks", 13, FG, true);
        name.setPadding(dp(8), 0, 0, 0);
        head.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        head.addView(text("🔒 encrypted", 11, MUTED, false));
        TextView close = text("✕", 15, MUTED, false);
        close.setPadding(dp(12), dp(2), dp(2), dp(2));
        close.setOnClickListener(v -> finish());
        head.addView(close);
        card.addView(head);

        // − Expense / + Add cash
        LinearLayout seg = new LinearLayout(this);
        seg.setPadding(dp(3), dp(3), dp(3), dp(3));
        seg.setBackground(round(CHIP, 12, BORDER));
        for (String[] k : new String[][] { { "expense", "− Expense" }, { "income", "+ Add cash" } }) {
            TextView b = text(k[1], 13, FG, true);
            b.setGravity(Gravity.CENTER);
            b.setPadding(0, dp(7), 0, dp(7));
            b.setTag(k[0]);
            b.setOnClickListener(v -> setKind((String) v.getTag()));
            kindButtons.add(b);
            seg.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        LinearLayout.LayoutParams segLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        segLp.topMargin = dp(10);
        card.addView(seg, segLp);

        // Amount + Save
        JSONObject meta = QuickAdd.meta(this);
        if (meta != null && meta.optString("currency", "").length() == 3) currency = meta.optString("currency");
        String symbol = "₱";
        try {
            symbol = Currency.getInstance(currency).getSymbol();
        } catch (Exception ignored) {
            // keep ₱
        }
        LinearLayout amountRow = new LinearLayout(this);
        amountRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout amountBox = new LinearLayout(this);
        amountBox.setGravity(Gravity.CENTER_VERTICAL);
        amountBox.setPadding(dp(12), 0, dp(8), 0);
        amountBox.setBackground(round(CHIP, 14, BORDER));
        amountBox.addView(text(symbol, 18, MUTED, true));
        amount = new EditText(this);
        amount.setHint("0");
        amount.setHintTextColor(Color.parseColor("#55FFFFFF"));
        amount.setTextColor(FG);
        amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        amount.setTypeface(Typeface.DEFAULT_BOLD);
        amount.setBackground(null);
        amount.setSingleLine(true);
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amount.setImeOptions(EditorInfo.IME_ACTION_DONE);
        amount.setPadding(dp(6), dp(4), 0, dp(4));
        amount.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}

            public void onTextChanged(CharSequence s, int a, int b, int c) {}

            public void afterTextChanged(Editable s) {
                updateBalanceLine();
            }
        });
        amountBox.addView(amount, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        amountRow.addView(amountBox, new LinearLayout.LayoutParams(0, dp(46), 1));
        save = text("Save", 14, Color.BLACK, true);
        save.setGravity(Gravity.CENTER);
        save.setOnClickListener(v -> save());
        LinearLayout.LayoutParams sbp = new LinearLayout.LayoutParams(dp(72), dp(46));
        sbp.setMarginStart(dp(8));
        amountRow.addView(save, sbp);
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        alp.topMargin = dp(8);
        card.addView(amountRow, alp);

        // Category
        card.addView(label("WHAT IS IT?"));
        categoryRow = new LinearLayout(this);
        card.addView(scrollRow(categoryRow));

        // Account
        JSONArray list = meta == null ? null : meta.optJSONArray("accounts");
        if (list != null && list.length() > 0) {
            accountLabel = label("PAID WITH");
            card.addView(accountLabel);
            LinearLayout accRow = new LinearLayout(this);
            TextView none = chip("None");
            none.setTag(null);
            none.setOnClickListener(v -> setAccount(null));
            accountChips.add(none);
            accRow.addView(none);
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i);
                if (a == null) continue;
                accounts.add(a);
                TextView c = accountCard(a);
                c.setTag(a.optString("id"));
                c.setOnClickListener(v -> setAccount((String) v.getTag()));
                accountChips.add(c);
                accRow.addView(c);
            }
            card.addView(scrollRow(accRow));
            balanceLine = text("", 12, MUTED, true);
            balanceLine.setVisibility(View.GONE);
            LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            blp.topMargin = dp(6);
            card.addView(balanceLine, blp);
        }

        // Note
        note = new EditText(this);
        note.setHint("Note (optional)");
        note.setHintTextColor(MUTED);
        note.setTextColor(FG);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        note.setSingleLine(true);
        note.setPadding(dp(12), dp(8), dp(12), dp(8));
        note.setBackground(round(CHIP, 12, BORDER));
        note.setImeOptions(EditorInfo.IME_ACTION_DONE);
        note.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });
        LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        nlp.topMargin = dp(10);
        card.addView(note, nlp);

        amount.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });

        setKind(getIntent().getBooleanExtra("cash", false) ? "income" : "expense");
        setAccount(null);

        // Slide down from the top like a notification.
        card.setTranslationY(-dp(30));
        card.setAlpha(0f);
        card.animate().translationY(0).alpha(1f).setDuration(170).start();
        return root;
    }

    private void setKind(String k) {
        kind = k;
        int a = accent();
        for (TextView b : kindButtons) {
            boolean on = k.equals(b.getTag());
            b.setBackground(on ? round(a, 10, 0) : null);
            b.setTextColor(on ? Color.BLACK : FG);
        }
        save.setBackground(round(a, 14, 0));
        save.setText("income".equals(k) ? "Add" : "Save");
        if (accountLabel != null) accountLabel.setText("income".equals(k) ? "ADD TO" : "PAID WITH");
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
        setAccount(account);
    }

    private void setCategory(String id) {
        category = id;
        for (int i = 0; i < categoryRow.getChildCount(); i++) {
            TextView t = (TextView) categoryRow.getChildAt(i);
            select(t, id != null && id.equals(t.getTag()));
        }
    }

    /** Small coloured card for an account (its colour from the app): name, and balance if shown. */
    private TextView accountCard(JSONObject a) {
        Long bal = balanceOf(a);
        boolean credit = "credit".equals(a.optString("kind"));
        String body = a.optString("name", "Account") + "\n" + (bal != null ? money(credit ? Math.abs(bal) : bal) + (credit ? " owed" : "") : kindName(a.optString("kind")));
        TextView t = text(body, 12, Color.WHITE, true);
        t.setLineSpacing(dp(2), 1f);
        t.setPadding(dp(12), dp(8), dp(14), dp(8));
        t.setMinWidth(dp(96));
        t.setClickable(true);
        t.setFocusable(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(6));
        t.setLayoutParams(lp);
        return t;
    }

    private static String kindName(String kind) {
        switch (kind) {
            case "cash": return "Cash";
            case "ewallet": return "E-wallet";
            case "bank": return "Bank";
            case "credit": return "Credit card";
            default: return "Account";
        }
    }

    private int cardColor(Object tag) {
        JSONObject a = tag == null ? null : accountById((String) tag);
        try {
            if (a != null && a.has("color")) return Color.parseColor(a.getString("color"));
        } catch (Exception ignored) {
            // fall through
        }
        return Color.parseColor("#3A3A40");
    }

    private void setAccount(String id) {
        account = id;
        for (TextView t : accountChips) {
            Object tag = t.getTag();
            boolean on = id == null ? tag == null : id.equals(tag);
            if (tag == null) {
                select(t, on);
                continue;
            }
            // Coloured card; the chosen one gets a white ring and a check.
            GradientDrawable d = round(cardColor(tag), 14, 0);
            if (on) d.setStroke(dp(2), Color.WHITE);
            t.setBackground(d);
            t.setAlpha(on || id == null ? 1f : 0.7f);
            String txt = t.getText().toString().replaceFirst("^✓ ", "");
            t.setText(on ? "✓ " + txt : txt);
        }
        updateBalanceLine();
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
        JSONObject acc = accountById(account);
        if (acc != null && acc.has("balance")) {
            SharedPreferences p = prefs();
            String key = PREF_DELTA + account;
            p.edit().putLong(key, p.getLong(key, 0) + ("income".equals(kind) ? v : -v)).apply();
        }
        Toast.makeText(this, ("income".equals(kind) ? "Cash added" : "Expense saved") + " — it appears in VaultLocks when you unlock", Toast.LENGTH_SHORT).show();
        finish();
    }
}
