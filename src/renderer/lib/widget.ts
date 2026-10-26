// What the Android home-screen widget shows (TodayWidget.java). Only a short
// summary leaves the vault: today's spending, the month's budget line and the
// next few events / tasks / bills. With "widget details" off, amounts and titles
// are replaced so nothing private shows on the home screen.

import type { WidgetData } from '../../shared/api';
import { formatTime, occurrenceBounds, occurrencesInRange } from '../../shared/calendar';
import { dayKey, formatMoney, monthOf } from '../../shared/money';
import { billsInOrder } from '../../shared/plans';
import type { VaultSnapshot } from '../../shared/types';

import { tr } from '../../shared/i18n';
export function widgetData(snap: VaultSnapshot, now: number): WidgetData {
  const today = dayKey(new Date(now));
  const tomorrow = dayKey(new Date(now + 86_400_000));
  const show = snap.settings.widgetDetails;
  const money = (v: number) => (show ? formatMoney(v, snap.settings.currency) : '••••');
  const spent = snap.transactions.filter((t) => t.kind === 'expense' && t.date === today).reduce((a, t) => a + t.amount, 0);
  const monthSpent = snap.transactions.filter((t) => t.kind === 'expense' && monthOf(t.date) === monthOf(today)).reduce((a, t) => a + t.amount, 0);
  const budget = snap.settings.monthlyBudget;
  const monthLine = budget > 0 ? (monthSpent <= budget ? `${money(budget - monthSpent)} left this month` : `${money(monthSpent - budget)} over budget`) : `${money(monthSpent)} this month`;

  const next: WidgetData['next'] = [];
  for (const o of occurrencesInRange(snap.events, today, tomorrow)) {
    if (o.done) continue;
    const at = occurrenceBounds(o).start.getTime();
    if (at < now - 30 * 60_000 && !o.event.allDay) continue;
    next.push({ at, title: show ? o.event.title : tr("Event"), sub: o.event.allDay ? (o.day === today ? tr("Today") : tr("Tomorrow")) : `${o.day === today ? '' : 'Tomorrow, '}${formatTime(o.event.startTime)}` });
  }
  for (const t of snap.tasks) {
    if (t.completed || !t.due || t.due > tomorrow) continue;
    const at = new Date(`${t.due}T${t.dueTime || '09:00'}:00`).getTime();
    next.push({ at, title: show ? t.title : tr("Task"), sub: t.due < today ? tr("Task · overdue") : tr("Task · {0}{1}", [t.due === today ? 'today' : 'tomorrow', t.dueTime ? `, ${formatTime(t.dueTime)}` : '']) });
  }
  for (const s of billsInOrder(snap.bills, today)) {
    if (s.state !== 'overdue' && s.state !== 'today' && !(s.state === 'soon' && s.due === tomorrow)) continue;
    next.push({ at: new Date(`${s.due}T09:00:00`).getTime(), title: show ? tr("Pay {0}", [s.bill.name]) : tr("Bill"), sub: s.state === 'overdue' ? tr("Bill · overdue") : s.due === today ? tr("Bill · today") : tr("Bill · tomorrow") });
  }
  next.sort((a, b) => a.at - b.at);
  return { day: today, spentToday: money(spent), monthLine, next: next.slice(0, 6) };
}
