import { estimateStrength } from '../../shared/strength';

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

/** 5-segment strength bar. Accepts either a password (scored locally) or a stored score. */
export function StrengthMeter({ password, score, showFeedback }: { password?: string; score?: number; showFeedback?: boolean }) {
  const result = password !== undefined ? estimateStrength(password) : null;
  const s = result ? result.score : (score ?? 0);
  const empty = password !== undefined && password.length === 0;
  return (
    <div>
      <div className="strength" role="img" aria-label={`Password strength: ${empty ? 'none' : LABELS[s]}`}>
        <div className="strength-bars" data-score={s} aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={!empty && i <= s ? 'on' : ''} />
          ))}
        </div>
        <span className="strength-label" aria-hidden>
          {empty ? '—' : LABELS[s]}
        </span>
      </div>
      {showFeedback && result && !empty && result.feedback.length > 0 && (
        <div className="help-text" style={{ marginTop: 4 }}>
          {result.feedback[0]}
        </div>
      )}
    </div>
  );
}
