import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '../shared/types';
import { api } from './lib/api';
import { Setup, Unlock, Welcome } from './views/Auth';
import { VaultApp } from './views/VaultApp';
import { TitleBar } from './views/TitleBar';

type Screen = 'loading' | 'welcome' | 'setup' | 'locked' | 'unlocked';

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>('loading');

  const refresh = useCallback(async () => {
    const s = await api.app.getState();
    setState(s);
    setScreen(s.status === 'unlocked' ? 'unlocked' : s.status === 'locked' ? 'locked' : 'welcome');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Locking is handled by the main process, which wipes the key and reloads this
  // page — so all renderer state (including any revealed secrets) is discarded.
  if (screen === 'unlocked') return <VaultApp version={state?.version ?? ''} />;

  return (
    <>
      <TitleBar />
      {screen === 'welcome' && <Welcome onCreate={() => setScreen('setup')} onRestored={refresh} />}
      {screen === 'setup' && <Setup onBack={() => setScreen('welcome')} onCreated={refresh} />}
      {screen === 'locked' && <Unlock hasHint={state?.hasHint ?? false} onUnlocked={refresh} />}
    </>
  );
}
