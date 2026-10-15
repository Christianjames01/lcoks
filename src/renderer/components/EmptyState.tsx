import type { ReactNode } from 'react';

export type EmptyArt = 'vault' | 'search' | 'favorites' | 'trash' | 'secure' | 'category';

/** Empty screen: a small illustration, one line of explanation and (usually) one action. */
export function EmptyState({ art, title, text, action, card }: { art: EmptyArt; title: string; text?: ReactNode; action?: ReactNode; card?: boolean }) {
  return (
    <div className={`empty empty-state ${card ? 'card' : ''}`}>
      <Illustration art={art} />
      <div className="h3">{title}</div>
      {text && <div className="muted small empty-text">{text}</div>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}

// Line drawings in the theme's colours: --fg-2 outlines, --accent-soft fills, --accent-2 highlights.
function Illustration({ art }: { art: EmptyArt }) {
  return (
    <svg className="empty-art" viewBox="0 0 160 120" width="160" height="120" aria-hidden focusable="false">
      <ellipse cx="80" cy="108" rx="54" ry="6" className="ea-shadow" />
      {ART[art]}
    </svg>
  );
}

const sparkle = (x: number, y: number, s = 1) => (
  <path className="ea-accent-stroke" d={`M${x} ${y - 6 * s}v${12 * s}M${x - 6 * s} ${y}h${12 * s}`} strokeLinecap="round" />
);

const ART: Record<EmptyArt, ReactNode> = {
  vault: (
    <g>
      <rect x="38" y="22" width="84" height="78" rx="12" className="ea-fill ea-line" />
      <rect x="48" y="32" width="64" height="58" rx="8" className="ea-line" />
      <circle cx="80" cy="61" r="15" className="ea-surface ea-line" />
      <circle cx="80" cy="61" r="4" className="ea-accent" />
      <path className="ea-line" d="M80 46v5M80 71v5M65 61h5M90 61h5" strokeLinecap="round" />
      <path className="ea-line" d="M50 100v6M110 100v6" strokeLinecap="round" />
      {sparkle(134, 28)}
      {sparkle(24, 52, 0.7)}
    </g>
  ),
  search: (
    <g>
      <rect x="30" y="30" width="70" height="20" rx="6" className="ea-fill ea-line" />
      <rect x="30" y="56" width="70" height="20" rx="6" className="ea-fill ea-line" />
      <rect x="30" y="82" width="52" height="16" rx="6" className="ea-fill ea-line" opacity="0.6" />
      <circle cx="104" cy="58" r="20" className="ea-surface ea-line" strokeWidth="3" />
      <path className="ea-accent-stroke" d="M119 73l15 15" strokeWidth="6" strokeLinecap="round" />
      <path className="ea-line" d="M96 52a9 9 0 0 1 9-5" strokeLinecap="round" />
    </g>
  ),
  favorites: (
    <g>
      <path
        className="ea-fill ea-line"
        strokeLinejoin="round"
        d="M80 22l14.7 29.8 32.9 4.8-23.8 23.2 5.6 32.7L80 97l-29.4 15.5 5.6-32.7-23.8-23.2 32.9-4.8z"
        transform="translate(0 -8)"
      />
      <circle cx="80" cy="64" r="5" className="ea-accent" />
      {sparkle(132, 26)}
      {sparkle(30, 30, 0.7)}
      {sparkle(138, 84, 0.6)}
    </g>
  ),
  trash: (
    <g>
      <rect x="50" y="38" width="60" height="64" rx="8" className="ea-fill ea-line" />
      <path className="ea-line" d="M42 38h76M68 38v-8h24v8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="ea-line" d="M66 52v38M80 52v38M94 52v38" strokeLinecap="round" opacity="0.5" />
      <circle cx="116" cy="88" r="14" className="ea-accent" />
      <path d="M109 88l5 5 9-10" stroke="var(--accent-fg)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  secure: (
    <g>
      <path className="ea-fill ea-line" strokeLinejoin="round" d="M80 16l38 14v28c0 26-17 41-38 50-21-9-38-24-38-50V30z" />
      <path d="M64 60l11 11 21-23" className="ea-accent-stroke" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {sparkle(134, 30)}
      {sparkle(26, 76, 0.7)}
    </g>
  ),
  category: (
    <g>
      <rect x="44" y="26" width="72" height="46" rx="9" className="ea-line" opacity="0.45" transform="rotate(-8 80 49)" />
      <rect x="40" y="38" width="80" height="52" rx="10" className="ea-fill ea-line" />
      <rect x="50" y="50" width="26" height="6" rx="3" className="ea-line-fill" />
      <rect x="50" y="62" width="44" height="5" rx="2.5" className="ea-line-fill" opacity="0.5" />
      <circle cx="118" cy="90" r="15" className="ea-accent" />
      <path d="M118 83v14M111 90h14" stroke="var(--accent-fg)" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
};
