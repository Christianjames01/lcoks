// Security check-up: a 0–100 score and the list of things to fix. Works only on
// redacted item views (strength / reuse flags), never on secret values.

import type { EntryView, VaultMeta } from './types';

import { tr } from './i18n';
/** A password not changed for this long counts as old. */
export const OLD_PASSWORD_DAYS = 365;
const DAY = 86_400_000;

export const hasPassword = (e: EntryView): boolean => Object.values(e.secrets).some((s) => s.set && s.strength !== undefined);
export const isWeak = (e: EntryView): boolean => !!e.secrets.password?.set && (e.secrets.password.strength ?? 4) <= 1;
export const isReused = (e: EntryView): boolean => Object.values(e.secrets).some((s) => s.reused);
export const isOld = (e: EntryView, now = Date.now()): boolean => hasPassword(e) && now - Date.parse(e.updatedAt) > OLD_PASSWORD_DAYS * DAY;

export type IssueId = 'weak' | 'reused' | 'old' | 'backup';

export interface SecurityIssue {
  id: IssueId;
  title: string;
  detail: string;
  /** Items affected (0 for the backup issue). */
  items: EntryView[];
  severity: 'warn' | 'bad';
  penalty: number;
}

export interface SecurityReport {
  /** null when the vault is empty. */
  score: number | null;
  label: string;
  level: 'great' | 'good' | 'fair' | 'poor';
  passwords: number;
  issues: SecurityIssue[];
}

export function securityReport(
  entries: EntryView[],
  meta: Pick<VaultMeta, 'lastBackupAt'>,
  backupReminderDays: number,
  now = Date.now()
): SecurityReport {
  const withPw = entries.filter(hasPassword);
  const n = Math.max(1, withPw.length);
  const weak = withPw.filter(isWeak);
  const reused = withPw.filter(isReused);
  const old = withPw.filter((e) => isOld(e, now));
  // Each kind of problem costs at least a few points, more the larger the share of passwords it affects.
  const cost = (count: number, weight: number, min: number) => (count === 0 ? 0 : Math.max(min, Math.round((weight * count) / n)));

  const issues: SecurityIssue[] = [];
  if (weak.length) {
    issues.push({
      id: 'weak',
      title: tr("{0} weak password{1}", [weak.length, weak.length === 1 ? '' : 's']),
      detail: tr("Easy to guess. Replace them with long, random passwords from the generator."),
      items: weak,
      severity: 'bad',
      penalty: cost(weak.length, 40, 8)
    });
  }
  if (reused.length) {
    issues.push({
      id: 'reused',
      title: tr("{0} reused password{1}", [reused.length, reused.length === 1 ? '' : 's']),
      detail: tr("If one site leaks, every account with the same password is at risk. Give each one its own password."),
      items: reused,
      severity: 'bad',
      penalty: cost(reused.length, 30, 8)
    });
  }
  if (old.length) {
    issues.push({
      id: 'old',
      title: tr("{0} old password{1}", [old.length, old.length === 1 ? '' : 's']),
      detail: tr("Not changed in over a year. Consider updating important accounts."),
      items: old,
      severity: 'warn',
      penalty: cost(old.length, 10, 3)
    });
  }
  const backupAge = meta.lastBackupAt ? (now - Date.parse(meta.lastBackupAt)) / DAY : Infinity;
  if (entries.length > 0 && (!meta.lastBackupAt || (backupReminderDays > 0 && backupAge > backupReminderDays))) {
    issues.push({
      id: 'backup',
      title: meta.lastBackupAt ? tr("Backup is out of date") : tr("No backup yet"),
      detail: tr("Your vault lives only on this device. Keep an encrypted backup somewhere safe."),
      items: [],
      severity: meta.lastBackupAt ? 'warn' : 'bad',
      penalty: meta.lastBackupAt ? 8 : 15
    });
  }

  if (entries.length === 0) return { score: null, label: tr("No items yet"), level: 'good', passwords: 0, issues: [] };
  const score = Math.max(0, Math.min(100, 100 - issues.reduce((s, i) => s + i.penalty, 0)));
  const level = score >= 90 ? 'great' : score >= 75 ? 'good' : score >= 50 ? 'fair' : 'poor';
  const label = tr({ great: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Needs work' }[level]);
  return { score, label, level, passwords: withPw.length, issues };
}
