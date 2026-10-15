import { useEffect, useRef } from 'react';
import * as Y from 'yjs';

/**
 * A textarea bound to a Y.Text, so several people can type in the same notes at once.
 * Local edits are applied as minimal inserts/deletes; remote edits keep the caret in place.
 */
export function SharedText({ text, readOnly, placeholder, label }: { text: Y.Text; readOnly?: boolean; placeholder?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const last = useRef(text.toString());

  useEffect(() => {
    const el = ref.current!;
    el.value = last.current = text.toString();
    const observer = (e: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.local && tr.origin === 'textarea') return;
      let start = el.selectionStart, end = el.selectionEnd, index = 0;
      for (const d of e.delta) {
        if (d.retain) index += d.retain;
        else if (d.insert) {
          const n = (d.insert as string).length;
          if (index <= start) start += n;
          if (index < end) end += n;
          index += n;
        } else if (d.delete) {
          const n = d.delete;
          if (index < start) start -= Math.min(n, start - index);
          if (index < end) end -= Math.min(n, end - index);
        }
      }
      el.value = last.current = text.toString();
      if (document.activeElement === el) el.setSelectionRange(start, end);
    };
    text.observe(observer);
    return () => text.unobserve(observer);
  }, [text]);

  const onInput = () => {
    const el = ref.current!;
    const prev = last.current;
    const next = el.value;
    let a = 0;
    while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
    let b = 0;
    while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;
    text.doc!.transact(() => {
      if (prev.length - a - b > 0) text.delete(a, prev.length - a - b);
      if (next.length - a - b > 0) text.insert(a, next.slice(a, next.length - b));
    }, 'textarea');
    last.current = next;
  };

  return <textarea ref={ref} readOnly={readOnly} placeholder={placeholder} onInput={onInput} aria-label={label} />;
}
