import { useState } from 'react';
import { setName } from '../lib/store';
import { t } from '../lib/i18n';

export function NamePrompt({ onDone }: { onDone: () => void }) {
  const [name, set] = useState('');
  const joining = location.hash.startsWith('#/m/');
  return (
    <div className="login-wrap">
      <form className="card login stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { setName(name); onDone(); } }}>
        <h1>{joining ? t('Join the meeting') : t('Welcome to Rondel')}</h1>
        <p className="muted">{t('Retrospectives and team meetings that run in your browser. No account, no server: everyone in the meeting connects directly.')}</p>
        <label className="field">{t('Your name')}<input autoFocus required maxLength={60} value={name} onChange={(e) => set(e.target.value)} /></label>
        <p className="small muted">{t('Shown to the people in your meetings. Remembered in this browser, so you only enter it once; change it any time from your name at the top.')}</p>
        <button className="primary" type="submit">{t('Continue')}</button>
      </form>
    </div>
  );
}
