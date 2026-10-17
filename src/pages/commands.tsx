import { useCommands, type Command } from '../components/CommandPalette';
import { getPrefs, listMeetings, setPrefs, type Theme } from '../lib/store';
import { toast } from '../components/ui';
import { useEffect, useState } from 'react';
import { BackupModal } from '../components/Backup';
import { feedbackHref } from '../lib/lab';
import { canInstall, installApp } from '../pwa/register';
import { t } from '../lib/i18n';

let showBackup: (() => void) | null = null;
/** Open the backup and restore dialog from anywhere. */
export const openBackup = () => showBackup?.();

const THEMES: { t: Theme; label: string }[] = [{ t: 'light', label: t('Light') }, { t: 'dark', label: t('Dark') }, { t: 'system', label: t('Same as the system') }];

/** Commands that work on every page: go home, open a recent meeting, switch the theme. */
export function GlobalCommands() {
  const [backup, setBackup] = useState(false);
  useEffect(() => { showBackup = () => setBackup(true); return () => { showBackup = null; }; }, []);
  useCommands(() => {
    const here = location.hash;
    const out: Command[] = [];
    if (here && here !== '#/') out.push({ id: 'go-home', group: t('Go to'), label: t('All meetings'), hint: t('Home'), keywords: 'home start list startseite übersicht liste', run: () => (location.hash = '#/') });
    for (const m of listMeetings()) {
      const hash = `#/m/${m.roomId}/${m.key}`;
      if (here.startsWith(hash)) continue;
      out.push({ id: `open-${m.roomId}`, group: t('Meetings'), label: m.title, hint: m.status === 'closed' ? t('Closed') : `${m.updatedAt.slice(0, 10)}`, keywords: 'open meeting öffnen', search: true, run: () => (location.hash = hash) });
    }
    const theme = getPrefs().theme;
    for (const { t: th, label } of THEMES) {
      if (th === theme) continue;
      out.push({ id: `theme-${th}`, group: t('Preferences'), label: t('Theme: {name}', { name: label }), keywords: 'appearance dark mode light mode colour color design darstellung dunkel hell farbe', run: () => { setPrefs({ theme: th }); toast(t('Theme: {name}', { name: label })); } });
    }
    if (!here.startsWith('#/data')) out.push({ id: 'data', group: t('Go to'), label: t('How your data is handled'), keywords: 'privacy security encryption data storage server delete gdpr trust datenschutz sicherheit verschlüsselung daten speicher löschen dsgvo', run: () => (location.hash = '#/data') });
    const feedback = feedbackHref();
    if (feedback) out.push({ id: 'feedback', group: t('Go to'), label: t('Send feedback'), keywords: 'feedback bug problem report idea suggestion help contact lab fehler melden idee vorschlag hilfe kontakt rückmeldung', run: () => window.open(feedback, '_blank', 'noopener') });
    if (canInstall()) out.push({ id: 'install', group: t('Preferences'), label: t('Install as an app'), hint: t('Own window, opens offline'), keywords: 'install app desktop pwa offline window shortcut installieren fenster verknüpfung', run: installApp });
    out.push({ id: 'backup', group: t('Preferences'), label: t('Back up this browser'), hint: t('To move to another browser'), keywords: 'export backup move migrate transfer device save sicherung sichern exportieren umziehen übertragen gerät speichern', run: () => setBackup(true) });
    out.push({ id: 'restore', group: t('Preferences'), label: t('Restore a backup'), keywords: 'import backup move migrate transfer device load sicherung wiederherstellen importieren umziehen übertragen gerät laden', run: () => setBackup(true) });
    return out;
  });
  return backup ? <BackupModal onClose={() => setBackup(false)} /> : null;
}
