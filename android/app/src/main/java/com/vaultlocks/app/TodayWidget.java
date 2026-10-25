package com.vaultlocks.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Today" home-screen widget: spent today, the month line and what's next.
 *
 * It shows a small summary the app writes while unlocked (WidgetData in
 * src/shared/api.ts) — never passwords, cards or balances; with "widget details"
 * off, amounts and titles are already replaced by the app. When the day has
 * changed since VaultLocks was last opened it says so instead of old numbers.
 */
public class TodayWidget extends AppWidgetProvider {
    private static final String PREFS = "vaultlocks.widget";
    private static final String KEY = "data";

    /** Store the summary from the app and redraw every widget. */
    static void save(Context c, String json) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
        refresh(c);
    }

    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, TodayWidget.class));
        if (ids.length > 0) draw(c, m, ids);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        draw(c, m, ids);
    }

    private static void draw(Context c, AppWidgetManager m, int[] ids) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject d = null;
        try {
            String raw = p.getString(KEY, null);
            if (raw != null) d = new JSONObject(raw);
        } catch (Exception ignored) {}
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        boolean fresh = d != null && today.equals(d.optString("day"));

        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);
        if (!fresh) {
            v.setTextViewText(R.id.widget_spent, "—");
            v.setTextViewText(R.id.widget_month, d == null ? "Open VaultLocks once to set up" : "Open VaultLocks to update");
            v.setTextViewText(R.id.widget_next, d == null ? "" : "New day");
            v.setTextViewText(R.id.widget_next_sub, "");
            v.setTextViewText(R.id.widget_more, "");
        } else {
            v.setTextViewText(R.id.widget_spent, d.optString("spentToday", "—"));
            v.setTextViewText(R.id.widget_month, d.optString("monthLine", ""));
            // Next: the first thing that hasn't passed (all-day items stay for the day).
            JSONArray next = d.optJSONArray("next");
            long now = System.currentTimeMillis();
            JSONObject first = null;
            JSONObject second = null;
            if (next != null) {
                for (int i = 0; i < next.length(); i++) {
                    JSONObject n = next.optJSONObject(i);
                    if (n == null || n.optLong("at") < now - 30 * 60_000L) continue;
                    if (first == null) first = n;
                    else if (second == null) second = n;
                }
            }
            v.setTextViewText(R.id.widget_next, first == null ? "Nothing else today" : first.optString("title"));
            v.setTextViewText(R.id.widget_next_sub, first == null ? "" : first.optString("sub"));
            v.setTextViewText(R.id.widget_more, second == null ? "" : "+ " + second.optString("title") + " · " + second.optString("sub"));
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(c, 21, open, flags);
        v.setOnClickPendingIntent(R.id.widget_root, openPi);
        v.setOnClickPendingIntent(R.id.widget_open, openPi);
        Intent add = new Intent(c, QuickAddActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(c, 22, add, flags));
        m.updateAppWidget(ids, v);
    }
}
