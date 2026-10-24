package com.vaultlocks.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
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
 * "Add expense / Add cash" pop-up: a frosted-glass card at the TOP of the screen,
 * over the lock screen or any app (Back Tap, double tap on the back, or the
 * notification). Black & white glass: big centred amount, icon tiles for the category,
 * account cards, and one Save button that says what will happen. Selected things
 * turn solid (white on dark, black on light); there are no other colours.
 *
 * The entry is encrypted to the vault's inbox public key; nothing from the vault is
 * shown except account names — and balances, only if the user turned that on.
 */
public class QuickAddActivity extends Activity {
    /** id, label, icon, kind — ids match src/shared/money.ts. */
    private static final Object[][] CATEGORIES = {
        { "food", "Food", R.drawable.qa_food, "expense" },
        { "coffee", "Coffee", R.drawable.qa_coffee, "expense" },
        { "transport", "Fare", R.drawable.qa_fare, "expense" },
        { "groceries", "Groceries", R.drawable.qa_groceries, "expense" },
        { "bills", "Bills", R.drawable.qa_bills, "expense" },
        { "shopping", "Shopping", R.drawable.qa_shopping, "expense" },
        { "health", "Health", R.drawable.qa_health, "expense" },
        { "education", "School", R.drawable.qa_school, "expense" },
        { "entertainment", "Fun", R.drawable.qa_fun, "expense" },
        { "family", "Family", R.drawable.qa_family, "expense" },
        { "other", "Other", R.drawable.qa_other, "expense" },
        { "topup", "Cash in", R.drawable.qa_topup, "income" },
        { "salary", "Salary", R.drawable.qa_salary, "income" },
        { "gifts", "Allowance", R.drawable.qa_gift, "income" },
        { "other-income", "Other", R.drawable.qa_income, "income" }
    };

    private static final String PREF_DELTA = "pendingDelta.";
    private static final String PREF_STAMP = "pendingStamp";

    // Palette (dark or light, following the phone).
    private boolean dark = true;
    private boolean blurred = false;
    private int cardTop, cardBottom, fg, muted, tile, border, edge, solidBg;

    private String kind = "expense";
    private String category = "food";
    private String account = null;
    private String currency = "PHP";
    private EditText amount;
    private EditText note;
    private TextView save;
    private TextView balanceLine;
    private LinearLayout categoryRow;
    private final List<TextView> kindButtons = new ArrayList<>();
    private final List<View> accountViews = new ArrayList<>();
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
        // Keep the pop-up out of screenshots and the recent-apps preview (the "VaultLocks Dev"
        // test build allows screenshots so the pop-up can be documented).
        if (!BuildConfig.DEBUG) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        frostBehind();
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(KnockService.POPUP_NOTIFICATION_ID);

        if (!QuickAdd.ready(this)) {
            Toast.makeText(this, "Open VaultLocks and unlock once to turn on quick add.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        palette();
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

    /** Android 12+: blur whatever is behind (lock screen / app), like frosted glass. */
    private void frostBehind() {
        if (Build.VERSION.SDK_INT < 31) return;
        WindowManager wm = getWindowManager();
        if (wm == null || !wm.isCrossWindowBlurEnabled()) return;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND);
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.setBlurBehindRadius(dp(28));
        getWindow().setAttributes(lp);
        blurred = true;
    }

    private void palette() {
        dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_NO;
        if (dark) {
            cardTop = blurred ? 0xB8262628 : 0xF2262628;
            cardBottom = blurred ? 0xC70A0A0B : 0xF70A0A0B;
            fg = 0xFFFFFFFF;
            muted = 0xFF9A9A9F;
            tile = 0x1AFFFFFF;
            border = 0x2EFFFFFF;
            edge = 0x40FFFFFF;
            solidBg = 0xFF0A0A0B;
        } else {
            cardTop = blurred ? 0xC7FFFFFF : 0xF7FFFFFF;
            cardBottom = blurred ? 0xBFF0F0F2 : 0xF5F0F0F2;
            fg = 0xFF0A0A0B;
            muted = 0xFF6C6C72;
            tile = 0x0F000000;
            border = 0x1F000000;
            edge = 0x26000000;
            solidBg = 0xFFFFFFFF;
        }
    }

    // ------------------------------------------------------------- helpers --

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private GradientDrawable round(int color, float radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private TextView text(String s, float sp, int color, int weight) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (weight >= 700) t.setTypeface(Typeface.DEFAULT_BOLD);
        else if (weight >= 600) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setIncludeFontPadding(false);
        return t;
    }

    private ImageView icon(int res, int sizeDp, int tint) {
        ImageView v = new ImageView(this);
        v.setImageResource(res);
        v.setImageTintList(ColorStateList.valueOf(tint));
        v.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)));
        return v;
    }

    /** Selected / primary things are solid: white on dark glass, black on light glass. */
    private int accent() {
        return fg;
    }

    /** Text and icons on a solid (selected) surface. */
    private int onAccent() {
        return solidBg;
    }

    /** A see-through glass tile with a hairline edge. */
    private GradientDrawable glassTile(float radiusDp) {
        GradientDrawable d = round(tile, radiusDp);
        d.setStroke(dp(1), border);
        return d;
    }

    private HorizontalScrollView scrollRow(LinearLayout row) {
        HorizontalScrollView sv = new HorizontalScrollView(this);
        sv.setHorizontalScrollBarEnabled(false);
        sv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        sv.setClipToPadding(false);
        sv.addView(row);
        return sv;
    }

    private LinearLayout.LayoutParams fullWidth(int topDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(topDp);
        return lp;
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

    private static int kindIcon(String kind) {
        switch (kind) {
            case "cash": return R.drawable.qa_cash;
            case "ewallet": return R.drawable.qa_ewallet;
            case "credit": return R.drawable.qa_credit;
            default: return R.drawable.qa_bank;
        }
    }

    private static String kindName(String kind) {
        switch (kind) {
            case "cash": return "On hand";
            case "ewallet": return "E-wallet";
            case "bank": return "Bank";
            case "credit": return "Credit card";
            default: return "Account";
        }
    }

    // -------------------------------------------------------------- layout --

    private View build() {
        FrameLayout root = new FrameLayout(this);
        // Light dim on top of the blur (a stronger one where blur isn't available).
        root.setBackgroundColor(blurred ? (dark ? 0x40000000 : 0x26000000) : (dark ? 0x99000000 : 0x66000000));
        root.setOnClickListener(v -> finish());

        ScrollView scroll = new ScrollView(this);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        scroll.setClipToPadding(false);
        scroll.setPadding(0, statusBar() + dp(8), 0, dp(12));
        FrameLayout holder = new FrameLayout(this);
        holder.setOnClickListener(v -> finish());

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(10), dp(12), dp(12));
        GradientDrawable glass = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { cardTop, cardBottom });
        glass.setCornerRadius(dp(22));
        glass.setStroke(dp(1), edge);
        // Sheen: a soft highlight across the top that fades out, like light on glass.
        GradientDrawable sheen = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { dark ? 0x17FFFFFF : 0x73FFFFFF, 0x00FFFFFF });
        sheen.setCornerRadius(dp(22));
        LayerDrawable layered = new LayerDrawable(new Drawable[] { glass, sheen });
        layered.setLayerInset(1, dp(1), dp(1), dp(1), dp(110));
        card.setBackground(layered);
        card.setElevation(dp(18));
        card.setClickable(true); // taps inside don't close it
        int width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(32), dp(340));
        holder.addView(card, new FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER_HORIZONTAL));
        scroll.addView(holder);
        root.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        card.addView(header());
        card.addView(segmented(), fullWidth(10));
        card.addView(amountBlock(), fullWidth(6));

        categoryRow = new LinearLayout(this);
        categoryRow.setPadding(0, 0, dp(4), 0);
        card.addView(scrollRow(categoryRow), fullWidth(8));

        JSONObject meta = QuickAdd.meta(this);
        JSONArray list = meta == null ? null : meta.optJSONArray("accounts");
        if (list != null && list.length() > 0) {
            LinearLayout accRow = new LinearLayout(this);
            accRow.setPadding(0, 0, dp(4), 0);
            accRow.addView(noneCard());
            for (int i = 0; i < list.length(); i++) {
                JSONObject a = list.optJSONObject(i);
                if (a == null) continue;
                accounts.add(a);
                accRow.addView(accountCard(a));
            }
            card.addView(scrollRow(accRow), fullWidth(8));
        }

        note = new EditText(this);
        note.setHint("Add a note (optional)");
        note.setHintTextColor(muted);
        note.setTextColor(fg);
        note.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        note.setSingleLine(true);
        note.setPadding(dp(12), dp(8), dp(12), dp(8));
        note.setBackground(glassTile(12));
        note.setImeOptions(EditorInfo.IME_ACTION_DONE);
        note.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });
        card.addView(note, fullWidth(8));

        save = text("Save expense", 14, solidBg, 700);
        save.setGravity(Gravity.CENTER);
        save.setOnClickListener(v -> save());
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42));
        slp.topMargin = dp(8);
        card.addView(save, slp);

        amount.setOnEditorActionListener((v, id, e) -> {
            save();
            return true;
        });

        setKind(getIntent().getBooleanExtra("cash", false) ? "income" : "expense");

        // Slide down from the top like a notification.
        card.setTranslationY(-dp(24));
        card.setAlpha(0f);
        card.setScaleX(0.98f);
        card.setScaleY(0.98f);
        card.animate().translationY(0).alpha(1f).scaleX(1f).scaleY(1f).setDuration(200).start();
        return root;
    }

    private View header() {
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo = new ImageView(this);
        try {
            Drawable app = getPackageManager().getApplicationIcon(getPackageName());
            logo.setImageDrawable(app);
        } catch (Exception ignored) {
            logo.setImageResource(R.mipmap.ic_launcher);
        }
        logo.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(6));
            }
        });
        logo.setClipToOutline(true);
        head.addView(logo, new LinearLayout.LayoutParams(dp(24), dp(24)));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setPadding(dp(8), 0, 0, 0);
        titles.addView(text("VaultLocks", 13.5f, fg, 700));
        LinearLayout sub = new LinearLayout(this);
        sub.setGravity(Gravity.CENTER_VERTICAL);
        sub.setPadding(0, dp(2), 0, 0);
        sub.addView(icon(R.drawable.qa_lock, 10, muted));
        TextView subText = text("Quick add · stays encrypted", 10.5f, muted, 400);
        subText.setPadding(dp(4), 0, 0, 0);
        sub.addView(subText);
        titles.addView(sub);
        head.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        FrameLayout close = new FrameLayout(this);
        close.setBackground(glassTile(14));
        close.setContentDescription("Close");
        close.setOnClickListener(v -> finish());
        ImageView x = icon(R.drawable.qa_close, 14, muted);
        close.addView(x, new FrameLayout.LayoutParams(dp(14), dp(14), Gravity.CENTER));
        head.addView(close, new LinearLayout.LayoutParams(dp(28), dp(28)));
        return head;
    }

    private View segmented() {
        LinearLayout seg = new LinearLayout(this);
        seg.setPadding(dp(3), dp(3), dp(3), dp(3));
        seg.setBackground(glassTile(12));
        for (String[] k : new String[][] { { "expense", "−  Expense" }, { "income", "+  Add cash" } }) {
            TextView b = text(k[1], 13, fg, 600);
            b.setGravity(Gravity.CENTER);
            b.setTag(k[0]);
            b.setOnClickListener(v -> setKind((String) v.getTag()));
            kindButtons.add(b);
            seg.addView(b, new LinearLayout.LayoutParams(0, dp(30), 1));
        }
        return seg;
    }

    private View amountBlock() {
        JSONObject meta = QuickAdd.meta(this);
        if (meta != null && meta.optString("currency", "").length() == 3) currency = meta.optString("currency");
        String symbol = "₱";
        try {
            symbol = Currency.getInstance(currency).getSymbol();
        } catch (Exception ignored) {
            // keep ₱
        }
        LinearLayout block = new LinearLayout(this);
        block.setOrientation(LinearLayout.VERTICAL);
        block.setGravity(Gravity.CENTER_HORIZONTAL);

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER);
        row.addView(text(symbol, 20, muted, 600));
        amount = new EditText(this);
        amount.setHint("0");
        amount.setHintTextColor(dark ? 0x55FFFFFF : 0x40000000);
        amount.setTextColor(fg);
        amount.setTextSize(TypedValue.COMPLEX_UNIT_SP, 32);
        amount.setTypeface(Typeface.DEFAULT_BOLD);
        amount.setBackground(null);
        amount.setSingleLine(true);
        amount.setGravity(Gravity.CENTER);
        amount.setMinWidth(dp(44));
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amount.setImeOptions(EditorInfo.IME_ACTION_DONE);
        amount.setPadding(dp(4), 0, dp(4), 0);
        amount.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}

            public void onTextChanged(CharSequence s, int a, int b, int c) {}

            public void afterTextChanged(Editable s) {
                refresh();
            }
        });
        row.addView(amount, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        block.addView(row);

        balanceLine = text("", 11.5f, muted, 600);
        balanceLine.setGravity(Gravity.CENTER);
        balanceLine.setVisibility(View.GONE);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        blp.topMargin = dp(2);
        block.addView(balanceLine, blp);
        return block;
    }

    /** Category tile: a glass icon badge over a short label. */
    private View tile(Object[] c) {
        LinearLayout t = new LinearLayout(this);
        t.setOrientation(LinearLayout.VERTICAL);
        t.setGravity(Gravity.CENTER);
        t.setTag(c[0]);
        t.setOnClickListener(v -> setCategory((String) v.getTag()));
        FrameLayout badge = new FrameLayout(this);
        badge.setBackground(glassTile(9));
        badge.addView(icon((Integer) c[2], 16, fg), new FrameLayout.LayoutParams(dp(16), dp(16), Gravity.CENTER));
        t.addView(badge, new LinearLayout.LayoutParams(dp(30), dp(30)));
        TextView label = text((String) c[1], 10.5f, fg, 600);
        label.setPadding(0, dp(4), 0, 0);
        t.addView(label);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(56), dp(58));
        lp.setMarginEnd(dp(6));
        t.setLayoutParams(lp);
        return t;
    }

    private View noneCard() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.CENTER);
        c.setTag(null);
        c.addView(text("No", 12, fg, 700));
        TextView l = text("account", 10, muted, 400);
        l.setPadding(0, dp(2), 0, 0);
        c.addView(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(58), dp(44));
        lp.setMarginEnd(dp(6));
        c.setLayoutParams(lp);
        c.setOnClickListener(v -> setAccount(null));
        accountViews.add(c);
        return c;
    }

    /** Glass account card: name, and balance (if shown) or type; solid with a check when chosen. */
    private View accountCard(JSONObject a) {
        FrameLayout f = new FrameLayout(this);
        f.setBackground(glassTile(13));
        f.setTag(a.optString("id"));
        f.setOnClickListener(v -> setAccount((String) v.getTag()));

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(10), dp(7), dp(24), dp(7));
        boolean credit = "credit".equals(a.optString("kind"));
        LinearLayout nameRow = new LinearLayout(this);
        nameRow.setGravity(Gravity.CENTER_VERTICAL);
        ImageView kindIcon = icon(kindIcon(a.optString("kind")), 12, fg);
        kindIcon.setTag("kindIcon");
        nameRow.addView(kindIcon);
        TextView name = text(a.optString("name", "Account"), 12, fg, 700);
        name.setTag("name");
        name.setSingleLine(true);
        name.setPadding(dp(5), 0, 0, 0);
        nameRow.addView(name);
        col.addView(nameRow);
        Long bal = balanceOf(a);
        String subText = bal != null ? money(credit ? Math.abs(bal) : bal) + (credit ? " owed" : "") : kindName(a.optString("kind"));
        TextView sub = text(subText, 10.5f, muted, bal != null ? 700 : 400);
        sub.setTag("sub");
        sub.setPadding(0, dp(3), 0, 0);
        col.addView(sub);
        f.addView(col);

        FrameLayout check = new FrameLayout(this);
        check.setBackground(round(solidBg, 8));
        check.addView(icon(R.drawable.qa_check, 10, fg), new FrameLayout.LayoutParams(dp(10), dp(10), Gravity.CENTER));
        check.setVisibility(View.GONE);
        check.setTag("check");
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(dp(16), dp(16), Gravity.TOP | Gravity.END);
        clp.setMargins(0, dp(6), dp(6), 0);
        f.addView(check, clp);

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44));
        lp.setMarginEnd(dp(6));
        f.setLayoutParams(lp);
        f.setMinimumWidth(dp(92));
        accountViews.add(f);
        return f;
    }

    // --------------------------------------------------------------- state --

    private void setKind(String k) {
        kind = k;
        for (TextView b : kindButtons) {
            boolean on = k.equals(b.getTag());
            b.setBackground(on ? round(accent(), 9) : null);
            b.setTextColor(on ? onAccent() : fg);
        }
        categoryRow.removeAllViews();
        String first = null;
        for (Object[] c : CATEGORIES) {
            if (!c[3].equals(k)) continue;
            if (first == null) first = (String) c[0];
            categoryRow.addView(tile(c));
        }
        setCategory(first);
        setAccount(account);
    }

    /** Chosen tile: its badge turns solid and the tile gets a soft glass panel; the others stay clear. */
    private void setCategory(String id) {
        category = id;
        for (int i = 0; i < categoryRow.getChildCount(); i++) {
            LinearLayout t = (LinearLayout) categoryRow.getChildAt(i);
            boolean on = id != null && id.equals(t.getTag());
            t.setBackground(on ? glassTile(14) : null);
            FrameLayout badge = (FrameLayout) t.getChildAt(0);
            badge.setBackground(on ? round(accent(), 9) : glassTile(9));
            ((ImageView) badge.getChildAt(0)).setImageTintList(ColorStateList.valueOf(on ? onAccent() : fg));
            TextView label = (TextView) t.getChildAt(1);
            label.setTextColor(on ? fg : muted);
            label.setTypeface(on ? Typeface.DEFAULT_BOLD : Typeface.create("sans-serif-medium", Typeface.NORMAL));
        }
    }

    private void setAccount(String id) {
        account = id;
        for (View v : accountViews) {
            Object tag = v.getTag();
            boolean on = id == null ? tag == null : id.equals(tag);
            if (tag == null) {
                v.setBackground(on ? round(accent(), 13) : glassTile(13));
                LinearLayout c = (LinearLayout) v;
                ((TextView) c.getChildAt(0)).setTextColor(on ? onAccent() : fg);
                ((TextView) c.getChildAt(1)).setTextColor(on ? onAccent() : muted);
                continue;
            }
            v.setBackground(on ? round(accent(), 13) : glassTile(13));
            int text = on ? onAccent() : fg;
            ImageView k = v.findViewWithTag("kindIcon");
            if (k != null) k.setImageTintList(ColorStateList.valueOf(text));
            TextView n = v.findViewWithTag("name");
            if (n != null) n.setTextColor(text);
            TextView sub = v.findViewWithTag("sub");
            if (sub != null) sub.setTextColor(on ? (dark ? 0xB30A0A0B : 0xB3FFFFFF) : muted);
            v.setAlpha(1f);
            View check = v.findViewWithTag("check");
            if (check != null) check.setVisibility(on ? View.VISIBLE : View.GONE);
        }
        refresh();
    }

    /** Balance line and the Save button's text follow the amount, type and account. */
    private void refresh() {
        if (save == null || balanceLine == null) return;
        long v = minor(amount.getText().toString());
        JSONObject a = accountById(account);
        String name = a == null ? null : a.optString("name");
        boolean cash = "income".equals(kind);

        String label;
        if (cash) label = v > 0 ? "Add " + money(v) + (name != null ? " to " + name : " cash") : "Add cash";
        else label = v > 0 ? "Save " + money(v) + (name != null ? " · from " + name : " expense") : "Save expense";
        save.setText(label);
        save.setTextColor(onAccent());
        save.setBackground(round(accent(), 13));
        save.setAlpha(v > 0 ? 1f : 0.55f);

        Long bal = balanceOf(a);
        if (bal == null) {
            balanceLine.setVisibility(View.GONE);
            return;
        }
        if (v <= 0) {
            balanceLine.setText(name + " balance  " + money(bal));
            balanceLine.setTextColor(muted);
        } else {
            long after = cash ? bal + v : bal - v;
            balanceLine.setText(name + "  " + money(bal) + "  →  " + money(after) + (cash ? "" : " left"));
            balanceLine.setTextColor(fg);
        }
        balanceLine.setVisibility(View.VISIBLE);
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
