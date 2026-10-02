import { Copy, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  MAX_LENGTH,
  MIN_LENGTH,
  generatePassphrase,
  generatePassword,
  passphraseEntropyBits,
  passwordEntropyBits,
  type PassphraseOptions,
  type PasswordOptions
} from '../../shared/generator';
import { api, errorMessage, unwrap } from '../lib/api';
import { Dialog } from './Dialog';
import { StrengthMeter } from './StrengthMeter';
import { useToast } from './Toast';

// Generator *options* (never generated values) are remembered per device for convenience.
const OPTS_KEY = 'vaultlocks.generator.options';
function loadOpts(): { mode: 'password' | 'passphrase'; pw: PasswordOptions; pp: PassphraseOptions } {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      return {
        mode: raw.mode === 'passphrase' ? 'passphrase' : 'password',
        pw: { ...DEFAULT_PASSWORD_OPTIONS, ...(raw.pw ?? {}) },
        pp: { ...DEFAULT_PASSPHRASE_OPTIONS, ...(raw.pp ?? {}) }
      };
    }
  } catch {
    /* ignore */
  }
  return { mode: 'password', pw: DEFAULT_PASSWORD_OPTIONS, pp: DEFAULT_PASSPHRASE_OPTIONS };
}

interface Props {
  onClose: () => void;
  /** When provided, shows a "Use Password" button. */
  onUse?: (value: string) => void;
  /** Copy requires an unlocked vault (clipboard is managed by the main process). */
  canCopy?: boolean;
}

export function GeneratorDialog({ onClose, onUse, canCopy = true }: Props) {
  const initial = loadOpts();
  const [mode, setMode] = useState(initial.mode);
  const [pw, setPw] = useState<PasswordOptions>(initial.pw);
  const [pp, setPp] = useState<PassphraseOptions>(initial.pp);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const regenerate = useCallback(() => {
    try {
      setValue(mode === 'password' ? generatePassword(pw) : generatePassphrase(pp));
      setError(null);
    } catch (e) {
      setValue('');
      setError(e instanceof Error ? e.message : 'Unable to generate.');
    }
  }, [mode, pw, pp]);

  useEffect(() => {
    regenerate();
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify({ mode, pw, pp }));
    } catch {
      /* ignore */
    }
  }, [regenerate, mode, pw, pp]);

  // Drop the generated value from component state when the dialog closes.
  useEffect(() => () => setValue(''), []);

  const bits = mode === 'password' ? passwordEntropyBits(pw) : passphraseEntropyBits(pp);
  const toggle = (k: keyof Omit<PasswordOptions, 'length'>) => setPw((o) => ({ ...o, [k]: !o[k] }));

  return (
    <Dialog
      title="Password generator"
      subtitle="Generated locally with a cryptographically secure random number generator."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn left" onClick={regenerate}>
            <RefreshCw size={15} aria-hidden /> Regenerate
          </button>
          {canCopy && (
            <button
              type="button"
              className="btn"
              disabled={!value}
              onClick={async () => {
                try {
                  const { seconds } = await unwrap(api.vault.copyText(value));
                  toast(`Copied. Clipboard clears in ${seconds}s.`);
                } catch (e) {
                  toast(errorMessage(e), 'error');
                }
              }}
            >
              <Copy size={15} aria-hidden /> Copy
            </button>
          )}
          {onUse && (
            <button
              type="button"
              className="btn primary"
              disabled={!value}
              onClick={() => {
                onUse(value);
                onClose();
              }}
            >
              Use password
            </button>
          )}
        </>
      }
    >
      <div className="segmented" role="group" aria-label="Generator type" style={{ marginBottom: 18 }}>
        <button type="button" aria-pressed={mode === 'password'} onClick={() => setMode('password')}>
          Password
        </button>
        <button type="button" aria-pressed={mode === 'passphrase'} onClick={() => setMode('passphrase')}>
          Passphrase
        </button>
      </div>

      <div className="field">
        <span className="label">Generated {mode}</span>
        <div className="generated" aria-live="polite" aria-label="Generated value">
          {value || <span className="dim">{error}</span>}
        </div>
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <StrengthMeter password={value} />
          <span className="dim small">≈ {bits} bits of entropy</span>
        </div>
      </div>

      {mode === 'password' ? (
        <>
          <div className="field">
            <label htmlFor="gen-length" className="row-flex" style={{ justifyContent: 'space-between' }}>
              <span>Length</span>
              <span className="mono" style={{ color: 'var(--fg)' }}>
                {pw.length}
              </span>
            </label>
            <div className="row-flex">
              <input
                id="gen-length"
                type="range"
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                value={pw.length}
                onChange={(e) => setPw((o) => ({ ...o, length: Number(e.target.value) }))}
              />
              <input
                className="input mono"
                style={{ width: 76 }}
                type="number"
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                aria-label="Length"
                value={pw.length}
                onChange={(e) => {
                  const n = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Number(e.target.value) || MIN_LENGTH));
                  setPw((o) => ({ ...o, length: n }));
                }}
              />
            </div>
          </div>
          <div className="grid-2" style={{ rowGap: 12 }}>
            {(
              [
                ['upper', 'Uppercase (A–Z)'],
                ['lower', 'Lowercase (a–z)'],
                ['digits', 'Numbers (0–9)'],
                ['symbols', 'Symbols (!@#$…)'],
                ['avoidAmbiguous', 'Avoid ambiguous characters (I l 1 O 0)']
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="checkbox">
                <input type="checkbox" checked={pw[k]} onChange={() => toggle(k)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="gen-words" className="row-flex" style={{ justifyContent: 'space-between' }}>
              <span>Words</span>
              <span className="mono" style={{ color: 'var(--fg)' }}>
                {pp.words}
              </span>
            </label>
            <input
              id="gen-words"
              type="range"
              min={3}
              max={12}
              value={pp.words}
              onChange={(e) => setPp((o) => ({ ...o, words: Number(e.target.value) }))}
            />
          </div>
          <div className="grid-2" style={{ rowGap: 12, alignItems: 'center' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="gen-sep">Separator</label>
              <select id="gen-sep" className="select" value={pp.separator} onChange={(e) => setPp((o) => ({ ...o, separator: e.target.value }))}>
                <option value="-">Hyphen ( - )</option>
                <option value=" ">Space</option>
                <option value=".">Period ( . )</option>
                <option value="_">Underscore ( _ )</option>
                <option value="">None</option>
              </select>
            </div>
            <div className="stack" style={{ gap: 10, paddingTop: 18 }}>
              <label className="checkbox">
                <input type="checkbox" checked={pp.capitalize} onChange={() => setPp((o) => ({ ...o, capitalize: !o.capitalize }))} />
                <span>Capitalize words</span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={pp.includeNumber} onChange={() => setPp((o) => ({ ...o, includeNumber: !o.includeNumber }))} />
                <span>Include a number</span>
              </label>
            </div>
          </div>
          <p className="help-text" style={{ marginTop: 14 }}>
            Words from the EFF large wordlist (7,776 words, ≈12.9 bits each).
          </p>
        </>
      )}
    </Dialog>
  );
}
