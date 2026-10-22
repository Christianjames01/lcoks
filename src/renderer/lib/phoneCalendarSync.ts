import { defaultGoogleCalendar, phoneCalendarChosen, phoneCalendarItems, phoneCalendarTarget, setPhoneCalendarTarget, type PhoneCalendarInfo } from '../../shared/phoneCalendar';
import type { VaultSnapshot } from '../../shared/types';
import { api } from './api';

export interface PhoneSyncResult {
  ok: boolean;
  count: number;
  /** Where the events went, e.g. "you@gmail.com (Google Calendar)". */
  where: string;
  message?: string;
}

/**
 * Where VaultLocks' events go on the phone: the calendar the user picked, otherwise the
 * main Google calendar (shown by every phone's calendar app and widget), otherwise
 * VaultLocks' own calendar.
 */
export async function resolvePhoneTarget(): Promise<{ id: number; calendar?: PhoneCalendarInfo }> {
  const r = await api.phoneCalendar.list();
  const list = r.ok ? r.value : [];
  if (phoneCalendarChosen()) {
    const id = phoneCalendarTarget();
    return { id, calendar: list.find((c) => c.id === id) };
  }
  const g = defaultGoogleCalendar(list);
  if (g) {
    setPhoneCalendarTarget(g.id);
    return { id: g.id, calendar: g };
  }
  return { id: 0 };
}

export function describeTarget(t: { id: number; calendar?: PhoneCalendarInfo }): string {
  if (!t.id) return '“VaultLocks” calendar on this phone';
  const c = t.calendar;
  if (!c) return 'your chosen calendar';
  return c.type === 'com.google' ? `${c.name} (Google Calendar)` : c.name;
}

/** Copy the next 14 days to the phone's calendar now (or remove them when off). */
export async function syncPhoneCalendar(snap: VaultSnapshot, on = !snap.settings.phoneCalendarOff): Promise<PhoneSyncResult> {
  const t = await resolvePhoneTarget();
  const items = on ? phoneCalendarItems(snap.events, snap.tasks, new Date(), snap.settings.phoneCalendarNames) : [];
  const r = await api.phoneCalendar.sync(on, items, t.id);
  if (!r.ok) return { ok: false, count: 0, where: describeTarget(t), message: r.message };
  return { ok: true, count: r.value, where: describeTarget(t) };
}
