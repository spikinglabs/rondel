import { useCommands, type Command } from '../components/CommandPalette';
import { getPrefs, listMeetings, setPrefs, type Theme } from '../lib/store';
import { toast } from '../components/ui';
import { useEffect, useState } from 'react';
import { BackupModal } from '../components/Backup';
import { feedbackHref } from '../lib/lab';

let showBackup: (() => void) | null = null;
/** Open the backup and restore dialog from anywhere. */
export const openBackup = () => showBackup?.();

const THEMES: { t: Theme; label: string }[] = [{ t: 'light', label: 'Light' }, { t: 'dark', label: 'Dark' }, { t: 'system', label: 'Same as the system' }];

/** Commands that work on every page: go home, open a recent meeting, switch the theme. */
export function GlobalCommands() {
  const [backup, setBackup] = useState(false);
  useEffect(() => { showBackup = () => setBackup(true); return () => { showBackup = null; }; }, []);
  useCommands(() => {
    const here = location.hash;
    const out: Command[] = [];
    if (here && here !== '#/') out.push({ id: 'go-home', group: 'Go to', label: 'All meetings', hint: 'Home', keywords: 'home start list', run: () => (location.hash = '#/') });
    for (const m of listMeetings()) {
      const hash = `#/m/${m.roomId}/${m.key}`;
      if (here.startsWith(hash)) continue;
      out.push({ id: `open-${m.roomId}`, group: 'Meetings', label: m.title, hint: m.status === 'closed' ? 'Closed' : `${m.updatedAt.slice(0, 10)}`, keywords: 'open meeting', search: true, run: () => (location.hash = hash) });
    }
    const theme = getPrefs().theme;
    for (const { t, label } of THEMES) {
      if (t === theme) continue;
      out.push({ id: `theme-${t}`, group: 'Preferences', label: `Theme: ${label}`, keywords: 'appearance dark mode light mode colour color', run: () => { setPrefs({ theme: t }); toast(`Theme: ${label}`); } });
    }
    if (!here.startsWith('#/data')) out.push({ id: 'data', group: 'Go to', label: 'How your data is handled', keywords: 'privacy security encryption data storage server delete gdpr trust', run: () => (location.hash = '#/data') });
    const feedback = feedbackHref();
    if (feedback) out.push({ id: 'feedback', group: 'Go to', label: 'Send feedback', keywords: 'feedback bug problem report idea suggestion help contact lab', run: () => window.open(feedback, '_blank', 'noopener') });
    out.push({ id: 'backup', group: 'Preferences', label: 'Back up this browser', hint: 'To move to another browser', keywords: 'export backup move migrate transfer device save', run: () => setBackup(true) });
    out.push({ id: 'restore', group: 'Preferences', label: 'Restore a backup', keywords: 'import backup move migrate transfer device load', run: () => setBackup(true) });
    return out;
  });
  return backup ? <BackupModal onClose={() => setBackup(false)} /> : null;
}
