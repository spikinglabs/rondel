import { useEffect, useState, type ReactNode } from 'react';
import { openPalette, PALETTE_KEY } from './CommandPalette';
import { openBackup } from '../pages/commands';
import { getPrefs, knownPeople, setName, setPrefs, type Identity, type Theme } from '../lib/store';
import { feedbackHref, isLab, labLabel, VERSION } from '../lib/lab';
import { appName, operator, SOURCE_URL } from '../lib/site';

let pushToast: (msg: string) => void = () => {};
export const toast = (msg: string) => pushToast(msg);
/** Copy text, saying plainly when this page isn't allowed to. */
export const copyText = (text: string, done: string) =>
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => toast(done), () => toast('Copying is blocked here. Select the text and copy it yourself.'));
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e));
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: number | undefined;
    pushToast = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = window.setTimeout(() => setMsg(null), 3500);
    };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

const openModals: object[] = [];
export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; width?: number }) {
  useEffect(() => {
    const me = {};
    openModals.push(me);
    // Escape closes only the topmost modal.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openModals[openModals.length - 1] === me && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(me), 1);
    };
  }, [props.onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={props.title} style={props.width ? { maxWidth: props.width } : props.wide ? { maxWidth: 760 } : undefined}>
        <header>
          <h2>{props.title}</h2>
          <span className="spacer" />
          <button className="ghost icon" aria-label="Close" onClick={props.onClose}>✕</button>
        </header>
        <div className="body">{props.children}</div>
      </div>
    </div>
  );
}

// In-app replacements for confirm() and prompt(), which embedded pages may not be allowed to show.
type Ask = { message: string; input?: string; resolve: (v: string | null) => void };
let pushAsk: (a: Ask) => void = (a) => a.resolve(a.input === undefined ? (window.confirm(a.message) ? '' : null) : window.prompt(a.message, a.input));
/** Ask a yes/no question. */
export const ask = (message: string) => new Promise<boolean>((resolve) => pushAsk({ message, resolve: (v) => resolve(v !== null) }));
/** Ask for a line of text; null when cancelled. */
export const askText = (message: string, value = '') => new Promise<string | null>((resolve) => pushAsk({ message, input: value, resolve }));
export function Dialogs() {
  const [cur, setCur] = useState<Ask | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    pushAsk = (a) => {
      setValue(a.input ?? '');
      setCur(a);
    };
  }, []);
  if (!cur) return null;
  const done = (v: string | null) => {
    setCur(null);
    cur.resolve(v);
  };
  return (
    <Modal title={cur.input === undefined ? 'Please confirm' : cur.message} onClose={() => done(null)}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); done(cur.input === undefined ? '' : value); }}>
        {cur.input === undefined ? <p>{cur.message}</p> : <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label={cur.message} />}
        <div className="row">
          <span className="spacer" />
          <button type="button" onClick={() => done(null)}>Cancel</button>
          <button type="submit" className="primary" autoFocus={cur.input === undefined}>OK</button>
        </div>
      </form>
    </Modal>
  );
}

const PALETTE = ['#3b5bdb', '#2b8a3e', '#c2255c', '#e67700', '#7048e8', '#0c8599', '#5c940d', '#d6336c'];
/** A stable colour per id (kept for exports; the UI itself stays neutral). */
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export function Avatar(props: { id: string; name: string; ready?: boolean; size?: number }) {
  const s = props.size ?? 28;
  return (
    <span className="avatar" style={{ width: s, height: s, fontSize: s * 0.38 }} title={`${props.name}${props.ready ? ' · ready' : ''}`}>
      {initials(props.name || '?')}
      {props.ready && <span className="ready" aria-label="ready" />}
    </span>
  );
}

/** The name button in the top bar, opening the preferences this browser remembers. */
export function PrefsButton({ me, onChange }: { me: Identity; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ghost sm me-button" onClick={() => setOpen(true)} title="Your name and preferences">
        <Avatar id={me.id} name={me.name} size={22} /><span className="me-name">{me.name}</span>
      </button>
      {open && <PrefsModal me={me} onClose={() => setOpen(false)} onChange={onChange} />}
    </>
  );
}

function PrefsModal({ me, onClose, onChange }: { me: Identity; onClose: () => void; onChange: () => void }) {
  const prefs = getPrefs();
  const [name, setNameValue] = useState(me.name);
  const [theme, setTheme] = useState<Theme>(prefs.theme);
  const [defaults, setDefaults] = useState(prefs.meetingDefaults);
  const [people, setPeople] = useState(knownPeople().length);
  const d = defaults;
  return (
    <Modal title="Your preferences" onClose={onClose}>
      <form className="col" style={{ gap: 16 }} onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) setName(name);
        setPrefs({ theme, meetingDefaults: defaults });
        if (people === 0) localStorage.removeItem('rondel:people');
        toast('Preferences saved in this browser');
        onChange();
        onClose();
      }}>
        <label className="field">Your name<input required maxLength={60} value={name} onChange={(e) => setNameValue(e.target.value)} /><span className="hint">Shown to others in your meetings. A new name applies to meetings you open from now on.</span></label>
        <label className="field">Appearance
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="system">Same as my device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <div className="col" style={{ gap: 4 }}>
          <h3>Settings for new meetings</h3>
          {d ? (
            <div className="row wrap small">
              <span className="muted">{[d.showAuthors === false ? 'Anonymous cards' : d.showAuthors ? 'Card authors shown' : '', d.votesPerUser !== undefined ? `${d.votesPerUser || 'Unlimited'} votes per person` : '', d.votesPerCard !== undefined ? `${d.votesPerCard || 'unlimited'} per card` : '', d.secretVoting ? 'votes hidden until revealed' : ''].filter(Boolean).join(' · ')}</span>
              <button type="button" className="ghost sm" onClick={() => setDefaults(null)}>Forget</button>
            </div>
          ) : (
            <span className="small muted">The defaults of each template. To change them, open a meeting's Settings and tick “Use these settings for my new meetings”.</span>
          )}
        </div>
        <div className="col" style={{ gap: 4 }}>
          <h3>People</h3>
          <div className="row wrap small">
            <span className="muted">{people ? `${people} name${people === 1 ? '' : 's'} from your meetings are suggested when you assign actions.` : 'No names remembered.'}</span>
            {people > 0 && <button type="button" className="ghost sm" onClick={() => setPeople(0)}>Forget</button>}
          </div>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <h3>Move to another browser</h3>
          <div className="row wrap small">
            <span className="muted">Back up your meetings, series, templates and settings to a file, and restore it elsewhere.</span>
            <button type="button" className="sm" onClick={() => { onClose(); openBackup(); }}>Back up or restore…</button>
          </div>
        </div>
        <p className="small faint">All of this stays in this browser. Nothing is sent to a server.</p>
        <div className="row"><span className="spacer" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

export function TopBar(props: { crumbs?: string[]; right?: ReactNode }) {
  return (
    <div className="topbar">
      <a className="brand" href="#/">
        <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3.5" /><circle cx="16" cy="16" r="3.5" fill="currentColor" /></svg>
        {appName()}
      </a>
      {isLab() && <span className="lab-tag" title="Rondel is being tested. Things may change, and test meetings may be deleted when the test ends.">{labLabel()}</span>}
      {props.crumbs?.map((c, i) => <span key={i} className="crumbs"><span className="faint">/</span><span>{c}</span></span>)}
      <span className="spacer" />
      <button className="sm palette-btn" onClick={openPalette} aria-label="Search and commands" title={`Search and commands (${PALETTE_KEY})`}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span className="palette-btn-text">Search</span><kbd>{PALETTE_KEY}</kbd>
      </button>
      {props.right}
    </div>
  );
}

export function Footer() {
  const feedback = feedbackHref();
  const op = operator();
  return (
    <footer className="site-footer">
      {appName()} {VERSION}
      {op && <> · Run by {op.url ? <a href={op.url} target="_blank" rel="noopener">{op.name}</a> : op.name}</>}
      {' · '}<a href={SOURCE_URL} target="_blank" rel="noopener">Open source</a> · <a href="#/data">How your data is handled</a>
      {feedback && <> · <a href={feedback} target="_blank" rel="noopener">Send feedback</a></>}
    </footer>
  );
}

export function isOverdue(due: string | null, status: string) {
  return !!due && status === 'open' && due < new Date().toISOString().slice(0, 10);
}

export function fmtDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
