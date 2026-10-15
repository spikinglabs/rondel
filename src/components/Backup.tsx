import { useMemo, useRef, useState } from 'react';
import { Modal, toastError } from './ui';
import { backupSummary, collectBackup, makeBackupFile, parseBackupFile, readBackupFile, restoreBackup, type BackupFile, type MergeResult } from '../lib/backup';
import { downloadText } from '../lib/files';
import { listMeetings } from '../lib/store';
import { listSeries } from '../lib/series';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

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
    <Modal title="Backup restored" onClose={() => location.reload()}>
      <p>Added {plural(done.meetings, 'meeting')}, {done.series} series and {plural(done.templates, 'template')} to this browser.
        {done.identity === 'taken' && ' You are now the same person as in the backup, so you keep your facilitator role in its meetings.'}</p>
      <div className="row"><span className="spacer" /><button className="primary" onClick={() => location.reload()}>Done</button></div>
    </Modal>
  );

  const mismatch = !!pass && pass !== pass2;
  return (
    <Modal title="Move to another browser" onClose={onClose}>
      <section className="col" style={{ gap: 10 }}>
        <h3>Back up this browser</h3>
        <p className="small muted">One file with your name, preferences, My templates, your {plural(here.meetings, 'meeting')} and {here.series} series with their links, and the copy of each meeting stored here. Restore it in another browser to carry on there.</p>
        <p className="small warning-note">The file contains the keys to these meetings: anyone who has it can open them, just like with the links. Add a passphrase if you will store or send it.</p>
        <div className="row wrap">
          <label className="field" style={{ flex: 1, minWidth: 160 }}>Passphrase (optional)<input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
          {pass && <label className="field" style={{ flex: 1, minWidth: 160 }}>Repeat passphrase<input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>}
        </div>
        {mismatch && pass2 && <span className="small" style={{ color: 'var(--danger)' }}>The passphrases don't match.</span>}
        <div className="row"><span className="spacer" /><button className="primary" disabled={busy || mismatch} onClick={download}>Download backup</button></div>
      </section>
      <hr className="sep" />
      <section className="col" style={{ gap: 10 }}>
        <h3>Restore a backup</h3>
        <p className="small muted">Adds the backup to what this browser already has. Nothing here is removed.</p>
        <div className="row wrap">
          <button onClick={() => input.current?.click()}>Choose backup file…</button>
          <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Backup file" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { setFile({ name: f.name, f: parseBackupFile(await f.text()) }); setFilePass(''); } catch (err) { toastError(err); }
          }} />
          {file && <span className="small muted">{file.name}{file.f.encrypted ? ' · protected' : file.f.data ? ` · ${summaryText(file.f)}` : ''}</span>}
        </div>
        {file?.f.encrypted && <label className="field">Backup passphrase<input type="password" autoComplete="off" value={filePass} onChange={(e) => setFilePass(e.target.value)} /></label>}
        {file && (
          <label className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={takeId} onChange={(e) => setTakeId(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Be the same person as in the backup<span className="muted"> · keeps you facilitator of its meetings.{here.meetings + here.series > 0 ? ' Meetings already in this browser would then see you as someone new.' : ''}</span></span>
          </label>
        )}
        <div className="row"><span className="spacer" /><button className="primary" disabled={!file || busy || (file.f.encrypted && !filePass)} onClick={restore}>Restore</button></div>
      </section>
    </Modal>
  );
}

function summaryText(f: BackupFile) {
  if (f.encrypted) return '';
  const s = backupSummary(f.data);
  return `${plural(s.meetings, 'meeting')}, ${s.series} series, ${plural(s.templates, 'template')}${s.name ? `, from ${s.name}` : ''}`;
}
