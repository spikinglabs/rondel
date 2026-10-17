import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { Dialogs, Footer, Toaster } from './components/ui';
import { CommandPaletteHost } from './components/CommandPalette';
import { GlobalCommands } from './pages/commands';
import { HomePage } from './pages/Home';
import { MeetingPage } from './pages/Meeting';
import { NamePrompt } from './pages/NamePrompt';
import { SeriesPage } from './pages/Series';
import { DataPage } from './pages/DataPage';
import { CrashTest, ErrorScreen } from './components/ErrorScreen';
import { applyTheme, getIdentity, type Identity } from './lib/store';
import { appName } from './lib/site';
import { registerApp } from './pwa/register';

applyTheme();
registerApp();

/** Accept the dotted invite forms (#m.<room>.<key>, #s.<series>.<key>) and turn them into the normal routes. */
function normalizeHash() {
  const m = location.hash.match(/^#([ms])\.([\w-]{8,64})\.([\w-]+)$/);
  if (m) history.replaceState(null, '', `#/${m[1]}/${m[2]}/${m[3]}`);
}
normalizeHash();

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => {
      normalizeHash();
      setHash(location.hash);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function App() {
  const hash = useHash();
  const [me, setMe] = useState<Identity>(getIdentity());
  if (hash.startsWith('#/data')) return <DataPage />;
  if (hash === '#/crash-test') return <CrashTest />;
  if (!me.name) return <NamePrompt onDone={() => setMe(getIdentity())} />;
  const m = hash.match(/^#\/m\/([\w-]+)\/([\w-]+)/);
  if (m) return <MeetingPage key={m[1]} roomId={m[1]} roomKey={m[2]} me={me} onRename={() => setMe(getIdentity())} />;
  const s = hash.match(/^#\/s\/([\w-]+)\/([\w-]+)(\/overview)?/);
  if (s) return <SeriesPage key={hash} seriesId={s[1]} seriesKey={s[2]} overview={!!s[3]} me={me} onRename={() => setMe(getIdentity())} />;
  return <HomePage me={me} onRename={() => setMe(getIdentity())} />;
}

document.title = appName();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorScreen>
      <App />
    </ErrorScreen>
    <Footer />
    <Toaster />
    <Dialogs />
    <CommandPaletteHost />
    <GlobalCommands />
  </StrictMode>,
);
