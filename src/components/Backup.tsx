import { useMemo, useRef, useState } from 'react';
import { Modal, toastError } from './ui';
import { backupSummary, collectBackup, makeBackupFile, parseBackupFile, readBackupFile, restoreBackup, type BackupFile, type MergeResult } from '../lib/backup';
import { downloadText } from '../lib/files';
import { listMeetings } from '../lib/store';
import { listSeries } from '../lib/series';

import { t, tn } from '../lib/i18n';

const meetingsText = (n: number) => tn('{n} meeting', '{n} meetings', n);
const seriesText = (n: number) => tn('1 series', '{n} series', n);
const templatesText = (n: number) => tn('{n} template', '{n} templates', n);

/** Move to another browser: download everything Rondel keeps here as one file, or add such a file to this browser. */
export function BackupModal({ onClose }: { onClose: () => void }) {
  const here = useMemo(() => ({ meetings: listMeetings().length, series: listSeries().length }), []);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; f: BackupFile } | null>(null);
  const [filePass, setFilePass] = useState('');
  const [takeId, setTakeId] = useState(here.meetings + here.series === 0);
  const [done, setDone] = useState<MergeResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    try {
      const data = await collectBackup();
      const f = await makeBackupFile(data, pass || undefined);
      await downloadText(`rondel-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(f), 'application/json');
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const data = await readBackupFile(file.f, filePass || undefined);
      setDone(await restoreBackup(data, takeId));
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };

  if (done) return (
    <Modal title={t('Backup restored')} onClose={() => location.reload()}>
      <p>{t('Added {meetings}, {series} and {templates} to this browser.', { meetings: meetingsText(done.meetings), series: seriesText(done.series), templates: templatesText(done.templates) })}
        {done.identity === 'taken' && ` ${t('You are now the same person as in the backup, so you keep your facilitator role in its meetings.')}`}</p>
      <div className="row"><span className="spacer" /><button className="primary" onClick={() => location.reload()}>{t('Done')}</button></div>
    </Modal>
  );

  const mismatch = !!pass && pass !== pass2;
  return (
    <Modal title={t('Move to another browser')} onClose={onClose}>
      <section className="col" style={{ gap: 10 }}>
        <h3>{t('Back up this browser')}</h3>
        <p className="small muted">{t('One file with your name, preferences, My templates, your {meetings} and {series} with their links, and the copy of each meeting stored here. Restore it in another browser to carry on there.', { meetings: meetingsText(here.meetings), series: seriesText(here.series) })}</p>
        <p className="small warning-note">{t('The file contains the keys to these meetings: anyone who has it can open them, just like with the links. Add a passphrase if you will store or send it.')}</p>
        <div className="row wrap">
          <label className="field" style={{ flex: 1, minWidth: 160 }}>{t('Passphrase (optional)')}<input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          {pass && <label className="field" style={{ flex: 1, minWidth: 160 }}>{t('Repeat passphrase')}<input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>}
        </div>
        {mismatch && pass2 && <span className="small" style={{ color: 'var(--danger)' }}>{t('The passphrases don\'t match.')}</span>}
        <div className="row"><span className="spacer" /><button className="primary" disabled={busy || mismatch} onClick={download}>{t('Download backup')}</button></div>
      </section>
      <hr className="sep" />
      <section className="col" style={{ gap: 10 }}>
        <h3>{t('Restore a backup')}</h3>
        <p className="small muted">{t('Adds the backup to what this browser already has. Nothing here is removed.')}</p>
        <div className="row wrap">
          <button onClick={() => input.current?.click()}>{t('Choose backup file…')}</button>
          <input ref={input} type="file" accept=".json,application/json" hidden aria-label={t('Backup file')} onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { setFile({ name: f.name, f: parseBackupFile(await f.text()) }); setFilePass(''); } catch (err) { toastError(err); }
          }} />
          {file && <span className="small muted">{file.name}{file.f.encrypted ? ` · ${t('protected')}` : file.f.data ? ` · ${summaryText(file.f)}` : ''}</span>}
        </div>
        {file?.f.encrypted && <label className="field">{t('Backup passphrase')}<input type="password" autoComplete="off" value={filePass} onChange={(e) => setFilePass(e.target.value)} /></label>}
        {file && (
          <label className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={takeId} onChange={(e) => setTakeId(e.target.checked)} style={{ marginTop: 3 }} />
            <span>{t('Be the same person as in the backup')}<span className="muted"> · {t('keeps you facilitator of its meetings.')}{here.meetings + here.series > 0 ? ` ${t('Meetings already in this browser would then see you as someone new.')}` : ''}</span></span>
          </label>
        )}
        <div className="row"><span className="spacer" /><button className="primary" disabled={!file || busy || (file.f.encrypted && !filePass)} onClick={restore}>{t('Restore')}</button></div>
      </section>
    </Modal>
  );
}

function summaryText(f: BackupFile) {
  if (f.encrypted) return '';
  const s = backupSummary(f.data);
  const vars = { meetings: meetingsText(s.meetings), series: seriesText(s.series), templates: templatesText(s.templates) };
  return s.name ? t('{meetings}, {series}, {templates}, from {name}', { ...vars, name: s.name }) : t('{meetings}, {series}, {templates}', vars);

}
