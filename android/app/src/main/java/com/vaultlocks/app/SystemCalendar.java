package com.vaultlocks.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.CalendarContract;
import java.util.HashSet;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Copies the next days' events and tasks into the phone's calendar so the phone's own
 * lock-screen / home-screen calendar widgets show them (e.g. HyperOS "Thu, Oct 22 ·
 * 2:00 PM Team meeting").
 *
 * Target: either VaultLocks' own device-only calendar (target = 0), or a calendar the
 * user picked (target = its id) — needed on phones whose calendar app hides calendars
 * of unknown accounts (Xiaomi/HyperOS). In a picked calendar only the events VaultLocks
 * added are ever changed: their ids are remembered and they carry our package name.
 */
final class SystemCalendar {
    static final String ACCOUNT = "VaultLocks";
    private static final String NAME = "VaultLocks";
    private static final String PREFS = "vaultlocks.phoneCalendar";
    private static final String KEY_IDS = "eventIds";
    private static final String KEY_TARGET = "target";

    private SystemCalendar() {}

    /** Calendar URIs written "as the sync adapter" of our local account (needed to create our calendar). */
    private static Uri asSync(Uri uri) {
        return uri.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT)
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build();
    }

    private static long findOwn(ContentResolver cr) {
        try (Cursor c = cr.query(
            CalendarContract.Calendars.CONTENT_URI,
            new String[] { CalendarContract.Calendars._ID },
            CalendarContract.Calendars.ACCOUNT_NAME + "=? AND " + CalendarContract.Calendars.ACCOUNT_TYPE + "=?",
            new String[] { ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL },
            null
        )) {
            if (c != null && c.moveToFirst()) return c.getLong(0);
        }
        return -1;
    }

    private static long createOwn(ContentResolver cr) {
        ContentValues v = new ContentValues();
        v.put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT);
        v.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        v.put(CalendarContract.Calendars.NAME, NAME);
        v.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, NAME);
        v.put(CalendarContract.Calendars.CALENDAR_COLOR, Color.rgb(142, 142, 147));
        // Owner access: some phones hide read-only calendars from their widgets.
        v.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER);
        v.put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT);
        v.put(CalendarContract.Calendars.VISIBLE, 1);
        v.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
        v.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().getID());
        Uri uri = cr.insert(asSync(CalendarContract.Calendars.CONTENT_URI), v);
        return uri == null ? -1 : ContentUris.parseId(uri);
    }

    /** The phone's writable calendars (to pick one), without VaultLocks' own. */
    static JSONArray list(ContentResolver cr) {
        JSONArray out = new JSONArray();
        try (Cursor c = cr.query(
            CalendarContract.Calendars.CONTENT_URI,
            new String[] {
                CalendarContract.Calendars._ID,
                CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                CalendarContract.Calendars.ACCOUNT_NAME,
                CalendarContract.Calendars.ACCOUNT_TYPE,
                CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
                CalendarContract.Calendars.VISIBLE
            },
            null,
            null,
            null
        )) {
            while (c != null && c.moveToNext()) {
                if (c.getInt(4) < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) continue;
                if (ACCOUNT.equals(c.getString(2)) && CalendarContract.ACCOUNT_TYPE_LOCAL.equals(c.getString(3))) continue;
                JSONObject o = new JSONObject();
                o.put("id", c.getLong(0));
                o.put("name", c.getString(1) == null ? "Calendar" : c.getString(1));
                o.put("account", c.getString(2) == null ? "" : c.getString(2));
                o.put("type", c.getString(3) == null ? "" : c.getString(3));
                o.put("visible", c.getInt(5) == 1);
                out.put(o);
            }
        } catch (Exception ignored) {
            // no calendars readable
        }
        return out;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Delete the events VaultLocks added to a picked calendar (remembered ids + our package tag). */
    private static void clearPicked(Context ctx, ContentResolver cr) {
        SharedPreferences p = prefs(ctx);
        Set<String> ids = p.getStringSet(KEY_IDS, new HashSet<>());
        for (String id : ids) {
            try {
                cr.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, Long.parseLong(id)), null, null);
            } catch (Exception ignored) {
                // already gone
            }
        }
        try {
            cr.delete(CalendarContract.Events.CONTENT_URI, CalendarContract.Events.CUSTOM_APP_PACKAGE + "=?", new String[] { ctx.getPackageName() });
        } catch (Exception ignored) {
            // some providers don't allow this filter
        }
        p.edit().remove(KEY_IDS).apply();
    }

    private static void removeOwn(ContentResolver cr) {
        long cal = findOwn(cr);
        if (cal < 0) return;
        cr.delete(asSync(CalendarContract.Events.CONTENT_URI), CalendarContract.Events.CALENDAR_ID + "=?", new String[] { String.valueOf(cal) });
        cr.delete(asSync(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, cal)), null, null);
    }

    private static ContentValues event(Context ctx, long cal, JSONObject it) {
        long start = it.optLong("start");
        long end = Math.max(it.optLong("end"), start + 60_000);
        boolean allDay = it.optBoolean("allDay");
        ContentValues v = new ContentValues();
        v.put(CalendarContract.Events.CALENDAR_ID, cal);
        v.put(CalendarContract.Events.TITLE, it.optString("title", "VaultLocks").trim());
        v.put(CalendarContract.Events.DESCRIPTION, "Added by VaultLocks");
        v.put(CalendarContract.Events.DTSTART, start);
        v.put(CalendarContract.Events.DTEND, end);
        v.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
        // All-day events are stored in UTC midnight-to-midnight, timed ones in the phone's zone.
        v.put(CalendarContract.Events.EVENT_TIMEZONE, allDay ? "UTC" : TimeZone.getDefault().getID());
        v.put(CalendarContract.Events.HAS_ALARM, 0); // VaultLocks rings its own reminders
        v.put(CalendarContract.Events.CUSTOM_APP_PACKAGE, ctx.getPackageName());
        return v;
    }

    /**
     * Replace VaultLocks' events with `items` ({ title, start, end (epoch ms), allDay })
     * in the target calendar (0 = own calendar). Returns how many are now in it.
     */
    static int replace(Context ctx, ContentResolver cr, JSONArray items, long target) {
        long previous = prefs(ctx).getLong(KEY_TARGET, 0);
        // Switching calendars: take everything out of the old one first.
        if (previous != target) {
            if (previous == 0) removeOwn(cr);
            else clearPicked(ctx, cr);
        }
        prefs(ctx).edit().putLong(KEY_TARGET, target).apply();

        if (target > 0) {
            clearPicked(ctx, cr);
            Set<String> ids = new HashSet<>();
            for (int i = 0; i < items.length() && ids.size() < 300; i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                Uri u = cr.insert(CalendarContract.Events.CONTENT_URI, event(ctx, target, it));
                if (u != null) ids.add(String.valueOf(ContentUris.parseId(u)));
            }
            prefs(ctx).edit().putStringSet(KEY_IDS, ids).apply();
            return ids.size();
        }

        long cal = findOwn(cr);
        if (cal < 0) cal = createOwn(cr);
        if (cal < 0) return -1;
        ContentValues show = new ContentValues();
        show.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER);
        show.put(CalendarContract.Calendars.VISIBLE, 1);
        show.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
        cr.update(asSync(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, cal)), show, null, null);
        cr.delete(asSync(CalendarContract.Events.CONTENT_URI), CalendarContract.Events.CALENDAR_ID + "=?", new String[] { String.valueOf(cal) });
        int n = 0;
        for (int i = 0; i < items.length() && n < 300; i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            if (cr.insert(asSync(CalendarContract.Events.CONTENT_URI), event(ctx, cal, it)) != null) n++;
        }
        return n;
    }

    /** Turning it off: VaultLocks' calendar / its events in a picked calendar disappear. */
    static void remove(Context ctx, ContentResolver cr) {
        clearPicked(ctx, cr);
        removeOwn(cr);
        prefs(ctx).edit().remove(KEY_TARGET).apply();
    }
}
