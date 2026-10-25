import { Keyboard, Mic, Send, Square, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { KloudStatus } from '../../shared/api';
import { answer, speakable, understand, type KloudAction } from '../../shared/kloud';
import { allMoneyCategories } from '../../shared/money';
import type { VaultSnapshot } from '../../shared/types';
import { api, errorMessage, unwrap } from '../lib/api';
import { isAndroid, isPhone } from '../lib/platform';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

interface Turn {
  id: number;
  who: 'you' | 'kloud';
  text: string;
  /** Something Kloud saved that can be taken back. */
  undo?: () => Promise<void>;
}

/** Desktop has no phone speech service: speak with the system voice. */
function speakHere(text: string) {
  if (isPhone()) return api.kloud.speak(text);
  try {
    window.speechSynthesis.cancel();
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = 0.95;
    window.speechSynthesis.speak(u);
  } catch {
    /* no voice */
  }
}

/**
 * Kloud, the VaultLocks assistant: talk (phones) or type, and it answers out
 * loud. It runs what you ask on the unlocked vault — but never says a secret.
 */
export function KloudPanel({
  snap,
  onClose,
  onChanged,
  onOpenEntry,
  onOpenView
}: {
  snap: VaultSnapshot;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenEntry: (id: string) => void;
  onOpenView: (view: 'money' | 'calendar' | 'tasks' | 'vault') => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<KloudStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(!isPhone());
  const n = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const canTalk = isPhone() && !!status?.available;

  const say = (who: Turn['who'], text: string, undo?: Turn['undo']) => setTurns((t) => [...t, { id: ++n.current, who, text, ...(undo ? { undo } : {}) }]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, partial]);
  useEffect(() => () => speakHere(''), []);

  const run = async (a: KloudAction): Promise<Turn['undo']> => {
    switch (a.type) {
      case 'saveTransaction': {
        const t = await unwrap(api.vault.saveTransaction({ ...a.input }));
        await onChanged();
        return async () => {
          await unwrap(api.vault.deleteTransaction(t.id));
          await onChanged();
        };
      }
      case 'saveTask': {
        const [t] = await unwrap(api.vault.saveTasks([a.input], []));
        await onChanged();
        return async () => {
          await unwrap(api.vault.saveTasks([], [t!.id]));
          await onChanged();
        };
      }
      case 'saveEvent': {
        const [e] = await unwrap(api.vault.saveEvents([a.input], []));
        await onChanged();
        return async () => {
          await unwrap(api.vault.saveEvents([], [e!.id]));
          await onChanged();
        };
      }
      case 'openEntry':
        setTimeout(() => {
          onClose();
          onOpenEntry(a.id);
        }, 1400);
        return undefined;
      case 'openView':
        setTimeout(() => {
          onClose();
          onOpenView(a.view);
        }, 1600);
        return undefined;
      case 'lock':
        setTimeout(() => void api.auth.lock(), 1200);
        return undefined;
    }
  };

  const handle = async (text: string) => {
    const said = text.trim();
    if (!said) return;
    say('you', said);
    const s = snapRef.current;
    const intent = understand(said, { accounts: s.accounts, categories: allMoneyCategories() });
    const reply = answer(intent, {
      transactions: s.transactions,
      accounts: s.accounts,
      events: s.events,
      tasks: s.tasks,
      entries: s.entries,
      currency: s.settings.currency
    });
    let undo: Turn['undo'];
    try {
      if (reply.action) undo = await run(reply.action);
    } catch (e) {
      const msg = `Sorry, I couldn’t do that: ${errorMessage(e)}`;
      say('kloud', msg);
      speakHere(speakable(msg, s.settings.currency));
      return;
    }
    say('kloud', reply.say, undo);
    speakHere(speakable(reply.say, s.settings.currency));
  };

  const listen = async () => {
    if (listening) {
      api.kloud.stop();
      return;
    }
    let st = status;
    if (st && !st.mic) st = await api.kloud.requestMic();
    setStatus(st);
    if (!st?.mic) {
      say('kloud', 'I need the microphone to hear you. Allow it for VaultLocks, or type instead.');
      setTyping(true);
      return;
    }
    speakHere('');
    setListening(true);
    setPartial('');
    const r = await api.kloud.listen((e) => {
      if (e.partial !== undefined) setPartial(e.partial);
      if (e.level !== undefined) setLevel(Math.max(0, Math.min(1, (e.level + 2) / 12)));
    });
    setListening(false);
    setPartial('');
    setLevel(0);
    if (r.ok) void handle(r.value);
    else {
      say('kloud', r.message);
      speakHere(r.message);
    }
  };

  // Phones: start listening as soon as Kloud opens (if the microphone is allowed).
  useEffect(() => {
    let gone = false;
    void (async () => {
      const st = await api.kloud.status();
      if (gone) return;
      setStatus(st);
      // No speech service on this phone: typing still works.
      if (!st.available) setTyping(true);
      if (isPhone() && st.available && st.mic) void listen();
      else if (!st.available) say('kloud', 'Hi, I’m Kloud. Type what you want: “lunch 150 from GCash”, “how much did I spend on coffee this month”, or “remind me to pay rent tomorrow at 9”.');
    })();
    return () => {
      gone = true;
      api.kloud.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = typed;
    setTyped('');
    void handle(t);
  };

  const examples = useMemo(() => ['lunch 150 from gcash', 'how much did I spend on coffee this month', 'what’s on my calendar today', 'remind me to pay rent tomorrow at 9'], []);

  return (
    <Dialog placement="center" size="narrow" title="Kloud" subtitle={canTalk ? (status?.onDevice ? 'Voice assistant · speech stays on this phone' : 'Voice assistant') : 'Assistant · type to Kloud'} onClose={onClose}>
      <div className="kloud">
        <button
          type="button"
          className={`kloud-orb ${listening ? 'on' : ''}`}
          style={{ ['--lvl' as string]: String(level) }}
          onClick={() => (canTalk ? void listen() : setTyping(true))}
          aria-label={listening ? 'Stop listening' : 'Talk to Kloud'}
        >
          <span className="kloud-core" />
          <span className="kloud-ring a" />
          <span className="kloud-ring b" />
        </button>
        <div className="kloud-state" aria-live="polite">
          {listening ? 'Listening…' : canTalk ? 'Tap the orb to talk' : ''}
        </div>
        {listening && partial && <div className="kloud-partial">“{partial}”</div>}

        <div className="kloud-turns" ref={listRef}>
          {turns.length === 0 && !listening && (
            <div className="kloud-examples">
              {examples.map((x) => (
                <button key={x} type="button" className="vl-pill" onClick={() => void handle(x)}>
                  {x}
                </button>
              ))}
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} className={`kloud-turn ${t.who}`}>
              <span className="kloud-who">{t.who === 'you' ? 'You' : 'Kloud'}</span>
              <span>{t.text}</span>
              {t.undo && (
                <button
                  type="button"
                  className="btn sm kloud-undo"
                  onClick={async () => {
                    try {
                      await t.undo!();
                      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, undo: undefined } : x)));
                      say('kloud', 'Okay, I took that back.');
                      speakHere('Okay, I took that back.');
                    } catch (e) {
                      toast(errorMessage(e), 'error');
                    }
                  }}
                >
                  <Undo2 size={13} aria-hidden /> Undo
                </button>
              )}
            </div>
          ))}
        </div>

        {typing ? (
          <form className="kloud-type" onSubmit={submit}>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Ask or tell Kloud…" aria-label="Message to Kloud" autoComplete="off" data-autofocus={!isPhone() || undefined} maxLength={300} />
            <button type="submit" className="btn primary" disabled={!typed.trim()} aria-label="Send">
              <Send size={16} aria-hidden />
            </button>
          </form>
        ) : null}
        <div className="kloud-bar">
          {canTalk && (
            <button type="button" className={`btn ${listening ? '' : 'primary'}`} onClick={() => void listen()}>
              {listening ? <Square size={15} aria-hidden /> : <Mic size={16} aria-hidden />}
              {listening ? 'Done' : 'Talk'}
            </button>
          )}
          {canTalk && (
            <button type="button" className="btn" onClick={() => setTyping((v) => !v)} aria-pressed={typing}>
              <Keyboard size={16} aria-hidden /> Type
            </button>
          )}
        </div>
        {isAndroid() && status?.available && (
          <label className="kloud-knock">
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 600 }}>Double tap the back opens Kloud</span>
              <span className="dim small">Talk on the lock screen: expenses and reminders are saved encrypted until you unlock.</span>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={status.onKnock}
              onChange={async (e) => {
                const on = e.target.checked;
                await api.kloud.setOnKnock(on);
                setStatus((s) => (s ? { ...s, onKnock: on } : s));
                toast(on ? 'Double tap now opens Kloud.' : 'Double tap opens the add-expense pop-up again.');
              }}
            />
          </label>
        )}
        <p className="dim small kloud-note">Kloud never reads passwords, PINs or card numbers out loud — it only opens them on screen.</p>
      </div>
    </Dialog>
  );
}
