import { CircleCheck, Lock, Plus, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { dayKey, moneyCategory, parseQuick } from '../../shared/money';
import type { InboxStatus } from '../../shared/types';
import { api } from '../lib/api';

import { tr } from '../../shared/i18n';
/**
 * Lock screen "Add expense": the entry is encrypted to the vault's inbox public key
 * and added on the next unlock. Nothing from the vault is shown here — only how many
 * entries are waiting. Hidden until the vault has been unlocked once with this version.
 */
export function QuickAddLocked() {
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api.inbox.status();
    if (r.ok) setStatus(r.value);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const parsed = useMemo(() => parseQuick(text), [text]);

  if (!status?.enabled) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed || busy) return;
    setBusy(true);
    const r = await api.inbox.add(text, dayKey(new Date()));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.message });
    api.app.haptic('success');
    setText('');
    setMsg({ ok: true, text: tr("Saved. It will be added to your expenses when you unlock.") });
    void load();
  };

  return (
    <section className="locked-quick" aria-label={tr("Add expense while locked")}>
      {!open ? (
        <button type="button" className="btn block locked-quick-open" onClick={() => setOpen(true)}>
          <Wallet size={16} aria-hidden /> {tr("Add expense")}
          {status.pending > 0 && <span className="lq-badge">{status.pending} {tr("waiting")}</span>}
        </button>
      ) : (
        <form className="lq-form" onSubmit={submit}>
          <div className="lq-head">
            <Wallet size={15} aria-hidden />
            <span className="grow">{tr("Add expense")}</span>
            <span className="lq-lock">
              <Lock size={11} aria-hidden /> {tr("Stays encrypted")}
            </span>
          </div>
          <div className="lq-row">
            <input
              className="input"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setMsg(null);
              }}
              placeholder={tr("e.g. \"lunch 150\"")}
              aria-label={tr("Expense, for example lunch 150")}
              autoComplete="off"
              maxLength={200}
              autoFocus
            />
            <button type="submit" className="btn primary" disabled={busy || !parsed} aria-label={tr("Add")}>
              {busy ? <span className="spinner" aria-hidden /> : <Plus size={16} aria-hidden />}
            </button>
          </div>
          <div className="lq-foot" aria-live="polite">
            {msg ? (
              <span className={msg.ok ? 'lq-ok' : 'error-text'}>
                {msg.ok && <CircleCheck size={13} aria-hidden />} {msg.text}
              </span>
            ) : parsed ? (
              <span>
                {parsed.kind === 'income' ? tr("Income") : tr("Expense")} · {moneyCategory(parsed.category).name} · {(parsed.amount / 100).toLocaleString()}
              </span>
            ) : (
              <span className="dim">
                {status.pending > 0 ? tr("{0} waiting for your next unlock.", [status.pending]) : tr("You can only add here. Unlock to see your expenses.")}
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
