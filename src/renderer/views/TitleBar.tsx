import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

/** Custom draggable title bar (native window controls are drawn by the OS overlay on the right). */
export function TitleBar({ children }: { children?: ReactNode }) {
  return (
    <header className={`titlebar ${children ? 'has-tools' : ''}`}>
      <div className="brand" aria-label="VaultLocks">
        <span className="brand-mark" aria-hidden>
          <Lock size={12} strokeWidth={2.2} />
        </span>
        VAULT
      </div>
      {children ?? <div className="drag" />}
    </header>
  );
}
