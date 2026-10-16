import { useEffect, useMemo, useRef, useState } from 'react';

/** Something the palette can do. `search` commands are found by typing (cards, ideas, …) and are not listed when the box is empty. */
export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  search?: boolean;
  run: () => void;
}

// Pages register a function that lists their commands; the palette asks them when it opens and as you type.
const sources = new Map<symbol, { current: () => Command[] }>();
let setOpenHost: ((open: boolean) => void) | null = null;

/** Offer commands in the palette while the calling component is on screen. */
export function useCommands(list: () => Command[]) {
  const ref = useRef(list);
  ref.current = list;
  useEffect(() => {
    const key = Symbol();
    sources.set(key, ref);
    return () => { sources.delete(key); };
  }, []);
}

export const openPalette = () => setOpenHost?.(true);
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const PALETTE_KEY = isMac ? '⌘K' : 'Ctrl K';

/** After a command moves a block into view: scroll to an item in it and flash it. */
export function reveal(id: string) {
  let tries = 0;
  const go = () => {
    const els = [...document.querySelectorAll<HTMLElement>(`[data-find="${CSS.escape(id)}"]`)];
    const el = els.find((e) => e.offsetParent) ?? null;
    if (!el) { if (tries++ < 20) setTimeout(go, 50); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('found');
    void el.offsetWidth;
    el.classList.add('found');
    setTimeout(() => el.classList.remove('found'), 1600);
  };
  requestAnimationFrame(go);
}

/** Put the cursor in a field once a command has brought its block into view. */
export function focusField(label: string) {
  let tries = 0;
  const go = () => {
    const el = [...document.querySelectorAll<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`)].find((e) => e.offsetParent);
    if (!el) { if (tries++ < 20) setTimeout(go, 50); return; }
    el.scrollIntoView({ block: 'center' });
    el.focus();
  };
  requestAnimationFrame(go);
}

function matches(c: Command, words: string[]) {
  const hay = `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
/** Lower is better: the label starting with what you typed, then how many of your words are in the label itself. */
function score(c: Command, q: string, words: string[]) {
  const l = c.label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const inLabel = words.filter((w) => l.split(' ').some((x) => x.startsWith(w))).length;
  return (l.startsWith(q.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()) ? 0 : 1) + (words.length - inLabel) + (c.search ? 0.5 : 0);
}

/** Mounted once for the whole app: Ctrl/⌘ K (or the Search button in the top bar) opens it. */
export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpenHost = setOpen;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); setOpenHost = null; };
  }, []);
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}

function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const back = useRef<Element | null>(document.activeElement);
  const all = useMemo(() => [...sources.values()].flatMap((s) => s.current()), []);
  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return all.filter((c) => !c.search);
    const words = query.split(/\s+/);
    return all.filter((c) => matches(c, words)).map((c, i) => ({ c, i, s: score(c, query, words) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.c).slice(0, 60);
  }, [all, query]);
  // Keep groups together, in the order their best match appears.
  const grouped = useMemo(() => {
    const order: string[] = [];
    for (const c of results) if (!order.includes(c.group)) order.push(c.group);
    return order.map((g) => ({ group: g, items: results.filter((c) => c.group === g) }));
  }, [results]);
  const flat = grouped.flatMap((g) => g.items);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const close = (restore = true) => {
    onClose();
    if (restore && back.current instanceof HTMLElement) back.current.focus();
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    close(false);
    c.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(flat.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(flat[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };

  let n = -1;
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} placeholder="Search or type a command…"
          aria-label="Search or type a command" role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={flat[sel] ? `cmd-${sel}` : undefined} />
        <ul id="palette-list" role="listbox" ref={listRef} aria-label="Commands">
          {grouped.map((g) => (
            <li key={g.group} role="presentation">
              <div className="palette-group" aria-hidden="true">{g.group}</div>
              <ul role="group" aria-label={g.group}>
                {g.items.map((c) => {
                  const i = ++n;
                  return (
                    <li key={c.id} id={`cmd-${i}`} role="option" aria-selected={i === sel} className="palette-item"
                      onMouseMove={() => i !== sel && setSel(i)} onClick={() => run(c)}>
                      <span className="palette-label">{c.label}</span>
                      {c.hint && <span className="palette-hint">{c.hint}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {flat.length === 0 && <li className="palette-empty">Nothing found for “{q}”.</li>}
        </ul>
        <div className="palette-foot faint small">↑↓ to choose · Enter to run · Esc to close</div>
      </div>
    </div>
  );
}
