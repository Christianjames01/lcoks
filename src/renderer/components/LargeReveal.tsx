import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';

/** Thin ring that empties while a revealed secret counts down to auto-hide. */
export function CountdownRing({ seconds }: { seconds: number }) {
  return (
    <svg className="countdown-ring" viewBox="0 0 36 36" aria-hidden focusable="false">
      <circle cx="18" cy="18" r="16" pathLength="100" style={{ animationDuration: `${seconds}s` }} />
    </svg>
  );
}

/** Seconds left until `seconds` from mount have passed (counts down once per second). */
export function useCountdown(seconds: number): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (seconds <= 0) return;
    const end = Date.now() + seconds * 1000;
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [seconds]);
  return left;
}

function kindOf(c: string): 'upper' | 'lower' | 'digit' | 'space' | 'symbol' {
  if (/\p{Lu}/u.test(c)) return 'upper';
  if (/\p{Ll}/u.test(c)) return 'lower';
  if (/\p{N}/u.test(c)) return 'digit';
  if (/\s/u.test(c)) return 'space';
  return 'symbol';
}

/**
 * Large type: the secret in big monospace characters, numbered, with letters,
 * digits and symbols in different colours — easy to read when typing it on
 * another device. Closes by itself after the reveal timeout.
 */
export function LargeReveal({
  label,
  value,
  seconds,
  onCopy,
  onClose
}: {
  label: string;
  value: string;
  seconds: number;
  onCopy: () => void;
  onClose: () => void;
}) {
  const left = useCountdown(seconds);
  useEffect(() => {
    if (seconds > 0 && left === 0) onClose();
  }, [left, seconds, onClose]);
  const chars = [...value];

  return (
    <Dialog placement="center"
      title={label}
      subtitle={`${chars.length} characters${seconds > 0 ? ` · hides in ${left}s` : ''}`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <div className="big-legend grow" aria-hidden>
            <span className="ch-upper">ABC</span> uppercase <span className="ch-lower">abc</span> lowercase <span className="ch-digit">123</span> digits{' '}
            <span className="ch-symbol">#$%</span> symbols
          </div>
          <button type="button" className="btn" onClick={onCopy}>
            <Copy size={15} aria-hidden /> Copy
          </button>
          <button type="button" className="btn primary" onClick={onClose} data-autofocus>
            Done
          </button>
        </>
      }
    >
      <div className="big-secret selectable" aria-label={`${label}: ${chars.join(' ')}`}>
        {chars.map((c, i) => {
          const k = kindOf(c);
          return (
            <span key={i} className={`big-ch ch-${k}`} aria-hidden>
              <b>{k === 'space' ? '␣' : c}</b>
              <i>{i + 1}</i>
            </span>
          );
        })}
      </div>
    </Dialog>
  );
}
