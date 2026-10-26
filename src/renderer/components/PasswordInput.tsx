import { Copy, Eye, EyeOff, WandSparkles } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { api, errorMessage, unwrap } from '../lib/api';
import { GeneratorDialog } from './Generator';
import { StrengthMeter } from './StrengthMeter';
import { useToast } from './Toast';

import { tr } from '../../shared/i18n';
interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  showStrength?: boolean;
  showFeedback?: boolean;
  allowGenerate?: boolean;
  allowCopy?: boolean;
  mono?: boolean;
  inputMode?: 'numeric' | 'text';
  autoComplete?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Masked secret input with show/hide, copy (via the main-process clipboard
 * manager with auto-clear), strength indicator and generator.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  invalid,
  describedBy,
  showStrength,
  showFeedback,
  allowGenerate,
  allowCopy,
  mono = true,
  inputMode,
  autoComplete = 'off',
  onKeyDown
}: Props) {
  const [visible, setVisible] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const toast = useToast();

  return (
    <>
      <div className="input-group" aria-invalid={invalid || undefined}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={mono ? 'mono' : ''}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode={inputMode}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={`icon-btn ${visible ? 'on' : ''}`}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? tr("Hide password") : tr("Show password")}
          aria-pressed={visible}
          title={visible ? tr("Hide") : tr("Show")}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        {allowCopy && (
          <button
            type="button"
            className="icon-btn"
            disabled={!value}
            aria-label={tr("Copy password")}
            title={tr("Copy (clipboard clears automatically)")}
            onClick={async () => {
              try {
                const { seconds } = await unwrap(api.vault.copyText(value));
                toast(tr("Copied. Clipboard clears in {0}s.", [seconds]));
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            }}
          >
            <Copy size={15} />
          </button>
        )}
        {allowGenerate && (
          <button type="button" className="icon-btn" aria-label={tr("Generate password")} title={tr("Generate password")} onClick={() => setGenOpen(true)}>
            <WandSparkles size={15} />
          </button>
        )}
      </div>
      {showStrength && (
        <div style={{ marginTop: 6 }}>
          <StrengthMeter password={value} showFeedback={showFeedback} />
        </div>
      )}
      {genOpen && <GeneratorDialog onClose={() => setGenOpen(false)} onUse={onChange} canCopy={allowCopy} />}
    </>
  );
}
