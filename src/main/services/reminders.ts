// Desktop reminders: shows system notifications at their time while VaultLocks is
// running (also while locked or in the tray). The list only holds what the renderer
// already chose to show in a notification — with previews off that is no event title.
// Nothing is written to disk; after a restart the list is rebuilt on the next unlock.

import { Notification, type BrowserWindow } from 'electron';
import type { ScheduledReminder } from '../../shared/api';

const CHECK_MS = 15_000;
/** A notification more than this late (computer was asleep) is skipped. */
const MAX_LATE_MS = 60 * 60_000;
const MAX_ITEMS = 100;

export class DesktopReminders {
  private items: ScheduledReminder[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly fired = new Set<string>();

  /** `inApp`: the unlocked app is in front — it shows its own reminder pop-up instead. */
  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly inApp: () => boolean
  ) {}

  get supported(): boolean {
    return Notification.isSupported();
  }

  /** Replace the whole list. Returns how many are scheduled. */
  schedule(raw: unknown): number {
    if (!Array.isArray(raw) || raw.length > MAX_ITEMS) throw new Error('INVALID');
    const now = Date.now();
    this.items = raw
      .filter(
        (r): r is ScheduledReminder =>
          !!r && typeof r === 'object' && Number.isInteger(r.id) && Number.isFinite(r.at) && r.at > now && typeof r.title === 'string' && typeof r.body === 'string'
      )
      .map((r) => ({ id: r.id, at: r.at, title: r.title.slice(0, 120), body: r.body.slice(0, 240), silent: r.silent === true, ...(r.kind === 'calendar' ? { kind: 'calendar' as const } : {}) }));
    if (this.items.length && !this.timer) {
      this.timer = setInterval(() => this.tick(), CHECK_MS);
      this.timer.unref?.();
    } else if (!this.items.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.items.length;
  }

  /** Sample notification in a few seconds. */
  test(): void {
    setTimeout(() => this.show({ id: 7, at: Date.now(), title: 'Submit requirements: tomorrow', body: 'This is how VaultLocks reminders look.' }), 3000);
  }

  private tick(): void {
    const now = Date.now();
    const due = this.items.filter((r) => r.at <= now);
    if (!due.length) return;
    this.items = this.items.filter((r) => r.at > now);
    for (const r of due) {
      const k = `${r.id}@${r.at}`;
      if (this.fired.has(k) || now - r.at > MAX_LATE_MS) continue;
      this.fired.add(k);
      // Calendar alarms already pop up inside the open app; expiry reminders have no in-app pop-up.
      if (!(r.kind === 'calendar' && this.inApp())) this.show(r);
    }
    if (this.fired.size > 500) this.fired.clear();
  }

  private show(r: ScheduledReminder): void {
    if (!this.supported) return;
    const n = new Notification({ title: r.title, body: r.body, silent: r.silent === true });
    n.on('click', () => {
      const win = this.getWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    n.show();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.items = [];
  }
}
