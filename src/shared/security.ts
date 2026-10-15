// Security check-up: a 0–100 score and the list of things to fix. Works only on
// redacted item views (strength / reuse flags), never on secret values.

import type { EntryView, VaultMeta } from './types';

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
      title: `${weak.length} weak password${weak.length === 1 ? '' : 's'}`,
      detail: 'Easy to guess. Replace them with long, random passwords from the generator.',
      items: weak,
      severity: 'bad',
      penalty: cost(weak.length, 40, 8)
    });
  }
  if (reused.length) {
    issues.push({
      id: 'reused',
      title: `${reused.length} reused password${reused.length === 1 ? '' : 's'}`,
      detail: 'If one site leaks, every account with the same password is at risk. Give each one its own password.',
      items: reused,
      severity: 'bad',
      penalty: cost(reused.length, 30, 8)
    });
  }
  if (old.length) {
    issues.push({
      id: 'old',
      title: `${old.length} old password${old.length === 1 ? '' : 's'}`,
      detail: `Not changed in over a year. Consider updating important accounts.`,
      items: old,
      severity: 'warn',
      penalty: cost(old.length, 10, 3)
    });
  }
  const backupAge = meta.lastBackupAt ? (now - Date.parse(meta.lastBackupAt)) / DAY : Infinity;
  if (entries.length > 0 && (!meta.lastBackupAt || (backupReminderDays > 0 && backupAge > backupReminderDays))) {
    issues.push({
      id: 'backup',
      title: meta.lastBackupAt ? 'Backup is out of date' : 'No backup yet',
      detail: 'Your vault lives only on this device. Keep an encrypted backup somewhere safe.',
      items: [],
      severity: meta.lastBackupAt ? 'warn' : 'bad',
      penalty: meta.lastBackupAt ? 8 : 15
    });
  }

  if (entries.length === 0) return { score: null, label: 'No items yet', level: 'good', passwords: 0, issues: [] };
  const score = Math.max(0, Math.min(100, 100 - issues.reduce((s, i) => s + i.penalty, 0)));
  const level = score >= 90 ? 'great' : score >= 75 ? 'good' : score >= 50 ? 'fair' : 'poor';
  const label = { great: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Needs work' }[level];
  return { score, label, level, passwords: withPw.length, issues };
}
