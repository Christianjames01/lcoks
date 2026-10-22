package com.vaultlocks.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.CalendarContract;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Show on the phone's calendar widgets": copies the next days' events and tasks
 * into a local, device-only "VaultLocks" calendar (never synced to any account),
 * so the phone's own lock-screen / home-screen calendar widgets can show them —
 * e.g. HyperOS "Thu, Oct 22 · 2:00 PM Team meeting".
 *
 * Opt-in only. The copy is replaced on every sync and deleted when turned off.
 */
final class SystemCalendar {
    static final String ACCOUNT = "VaultLocks";
    private static final String NAME = "VaultLocks";

    private SystemCalendar() {}

    /** Calendar URIs written "as the sync adapter" of our local account (needed to create a calendar). */
    private static Uri asSync(Uri uri) {
        return uri.buildUpon()
            .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT)
            .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
            .build();
    }

    private static long findCalendar(ContentResolver cr) {
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

    private static long createCalendar(ContentResolver cr) {
        ContentValues v = new ContentValues();
        v.put(CalendarContract.Calendars.ACCOUNT_NAME, ACCOUNT);
        v.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        v.put(CalendarContract.Calendars.NAME, NAME);
        v.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, NAME);
        v.put(CalendarContract.Calendars.CALENDAR_COLOR, Color.rgb(142, 142, 147));
        // Read-only for other apps: changes happen in VaultLocks.
        v.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_READ);
        v.put(CalendarContract.Calendars.OWNER_ACCOUNT, ACCOUNT);
        v.put(CalendarContract.Calendars.VISIBLE, 1);
        v.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
        v.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE, TimeZone.getDefault().getID());
        Uri uri = cr.insert(asSync(CalendarContract.Calendars.CONTENT_URI), v);
        return uri == null ? -1 : ContentUris.parseId(uri);
    }

    /**
     * Replace everything in the VaultLocks calendar with `items`
     * ({ title, start (epoch ms), end (epoch ms), allDay }). Returns how many were written.
     */
    static int replace(ContentResolver cr, JSONArray items) {
        long cal = findCalendar(cr);
        if (cal < 0) cal = createCalendar(cr);
        if (cal < 0) return -1;
        cr.delete(asSync(CalendarContract.Events.CONTENT_URI), CalendarContract.Events.CALENDAR_ID + "=?", new String[] { String.valueOf(cal) });
        int n = 0;
        for (int i = 0; i < items.length() && n < 300; i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            long start = it.optLong("start");
            long end = Math.max(it.optLong("end"), start + 60_000);
            boolean allDay = it.optBoolean("allDay");
            ContentValues v = new ContentValues();
            v.put(CalendarContract.Events.CALENDAR_ID, cal);
            v.put(CalendarContract.Events.TITLE, it.optString("title", "VaultLocks").trim());
            v.put(CalendarContract.Events.DTSTART, start);
            v.put(CalendarContract.Events.DTEND, end);
            v.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
            // All-day events are stored in UTC midnight-to-midnight, timed ones in the phone's zone.
            v.put(CalendarContract.Events.EVENT_TIMEZONE, allDay ? "UTC" : TimeZone.getDefault().getID());
            v.put(CalendarContract.Events.HAS_ALARM, 0); // VaultLocks rings its own reminders
            v.put(CalendarContract.Events.ACCESS_LEVEL, CalendarContract.Events.ACCESS_PRIVATE);
            if (cr.insert(asSync(CalendarContract.Events.CONTENT_URI), v) != null) n++;
        }
        return n;
    }

    /** Turning it off: the VaultLocks calendar and every copied entry disappear. */
    static void remove(ContentResolver cr) {
        long cal = findCalendar(cr);
        if (cal < 0) return;
        cr.delete(asSync(CalendarContract.Events.CONTENT_URI), CalendarContract.Events.CALENDAR_ID + "=?", new String[] { String.valueOf(cal) });
        cr.delete(asSync(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI, cal)), null, null);
    }
}
