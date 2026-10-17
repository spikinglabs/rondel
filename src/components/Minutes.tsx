import { useEffect, useRef, useState } from 'react';
import { Md } from './Markdown';
import { Modal, copyText, toast } from './ui';
import { downloadText } from '../lib/files';
import { canSaveToFolder, chooseFolder, forgetFolder, saveIntoFolder, savedFolder } from '../lib/folder';

// Inline styles for email: Outlook ignores stylesheets, so every element carries its own look.
const EMAIL_STYLE: Record<string, string> = {
  div: 'font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f1f1f; line-height: 1.4;',
  h1: 'font-size: 18pt; font-weight: 600; margin: 0 0 8px;',
  h2: 'font-size: 14pt; font-weight: 600; margin: 18px 0 6px;',
  h3: 'font-size: 12pt; font-weight: 600; margin: 12px 0 4px;',
  p: 'margin: 0 0 8px;',
  ul: 'margin: 0 0 8px; padding-left: 20px;',
  ol: 'margin: 0 0 8px; padding-left: 20px;',
  table: 'border-collapse: collapse; margin: 0 0 10px;',
  th: 'border: 1px solid #c8c8c8; padding: 4px 8px; text-align: left; background: #f2f2f2; font-weight: 600;',
  td: 'border: 1px solid #c8c8c8; padding: 4px 8px; text-align: left; vertical-align: top;',
  blockquote: 'border-left: 3px solid #c8c8c8; margin: 0 0 8px; padding-left: 10px; color: #555555;',
  code: 'font-family: Consolas, monospace; font-size: 10pt;',
  pre: 'font-family: Consolas, monospace; font-size: 10pt; background: #f2f2f2; padding: 8px; margin: 0 0 8px;',
  a: 'color: #0563c1;',
};

/** The rendered minutes as standalone HTML with inline styles, ready for an email body. */
export function emailHtml(rendered: HTMLElement): string {
  const copy = rendered.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('class');
    const style = EMAIL_STYLE[el.tagName.toLowerCase()];
    if (style) el.setAttribute('style', style);
  }
  return copy.outerHTML;
}

/** Copy formatted minutes (HTML for Outlook and other mail apps, with the Markdown as plain text). */
export async function copyFormatted(rendered: HTMLElement, markdown: string, done = 'Minutes copied. Paste them into an email.') {
  const html = emailHtml(rendered);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([markdown], { type: 'text/plain' }),
    })]);
  } catch {
    // Older browsers: copy a selection of the rendered page, which also carries its formatting.
    const holder = document.createElement('div');
    holder.innerHTML = html;
    Object.assign(holder.style, { position: 'fixed', left: '-10000px', top: '0' });
    document.body.append(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    holder.remove();
  }
  toast(done);
}

/** A new email in the person's mail app, with the formatted minutes on the clipboard to paste in.
 *  (Rondel knows no addresses, and a mailto body can only hold short plain text.) */
export async function emailMinutes(rendered: HTMLElement, markdown: string, subject: string) {
  await copyFormatted(rendered, markdown, 'Minutes copied. Paste them into the new email, add the participants and send.');
  location.href = `mailto:?subject=${encodeURIComponent(subject)}`;
}

/** The minutes, formatted, with ways to take them away: email, a folder, copy, or download. */
export function MinutesModal({ markdown, title, fileName, actionsCsv, onClose }: { markdown: string; title: string; fileName: string; actionsCsv?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = () => ref.current?.firstElementChild as HTMLElement | null;
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const folderOk = canSaveToFolder();
  useEffect(() => { if (folderOk) savedFolder().then(setFolder); }, [folderOk]);

  const saveToFolder = async (pick = !folder) => {
    try {
      const dir = pick ? await chooseFolder() : folder;
      if (!dir) return;
      setFolder(dir);
      if (await saveIntoFolder(dir, fileName, markdown)) toast(`Saved ${fileName} in ${dir.name || 'the folder'}`);
      else toast('The browser did not allow saving in that folder.');
    } catch (e: any) {
      // The folder was moved or deleted: forget it and let the person choose again.
      if (e?.name === 'NotFoundError') { await forgetFolder(); setFolder(null); toast('That folder is gone. Choose another one.'); }
      else toast(`Could not save: ${e?.message ?? e}`);
    }
  };

  return (
    <Modal title="Minutes" onClose={onClose} wide>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <button className="primary" onClick={() => rendered() && copyFormatted(rendered()!, markdown)}>Copy for email</button>
        <button onClick={() => rendered() && emailMinutes(rendered()!, markdown, title)} title="Opens a new email in your mail app; paste the minutes in">Email</button>
        {folderOk && <button onClick={() => saveToFolder()} title="For example a OneDrive, SharePoint or Google Drive folder on this computer">{folder ? `Save to ${folder.name || 'folder'}` : 'Save to folder…'}</button>}
        {folderOk && folder && <button className="ghost sm" onClick={() => saveToFolder(true)}>Change folder</button>}
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="sm" onClick={() => copyText(markdown, 'Minutes copied as Markdown')}>Copy Markdown</button>
        <button className="sm" onClick={() => downloadText(fileName, markdown, 'text/markdown')}>Download .md</button>
        {actionsCsv && <button className="sm" onClick={() => downloadText(fileName.replace(/minutes\.md$/, 'actions.csv'), actionsCsv, 'text/csv')} title="Opens in Excel; imports into Jira, Planner or Azure DevOps">Actions as CSV</button>}
      </div>
      {folderOk && <p className="small muted" style={{ marginTop: -4 }}>Save to folder writes the minutes into a folder on this computer, such as your OneDrive or Google Drive folder, which then syncs them. Saving again replaces the file.</p>}
      <div className="minutes-view" ref={ref}><Md text={markdown} doc /></div>
    </Modal>
  );
}
