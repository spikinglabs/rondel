import { useEffect, useState } from 'react';
import type { Timer } from '../lib/model';
import type { Ops } from '../lib/ops';

// The clock never goes below zero: when time runs out it says so, and the tooltip says how long ago.
export function fmtMs(ms: number) {
  if (ms <= 0) return "Time's up";
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function overText(ms: number) {
  const min = Math.floor(-ms / 60_000);
  return min < 1 ? 'Ended just now' : `Ended ${min} min ago`;
}

export function TimerView({ timer, canControl, ops }: { timer: Timer; canControl: boolean; ops: Ops }) {
  const [, tick] = useState(0);
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    if (!timer.running) return;
    const i = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(i);
  }, [timer.running]);
  const ms = timer.running && timer.endsAt ? timer.endsAt - Date.now() : timer.remainingMs;
  const active = timer.running || timer.remainingMs > 0;
  const cls = !active ? '' : ms <= 0 ? 'over' : ms < 60_000 ? 'low' : '';

  if (!active) {
    if (!canControl) return null;
    return (
      <div className="row" aria-label="Timer">
        {custom ? (
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            const min = Number(new FormData(e.currentTarget).get('min'));
            if (min > 0) ops.timerStart(min * 60_000);
            setCustom(false);
          }}>
            <input name="min" type="number" min={1} max={240} defaultValue={5} autoFocus style={{ width: 64 }} aria-label="Minutes" />
            <button className="sm primary" type="submit">Start</button>
          </form>
        ) : (
          <>
            <span className="small muted">Timer</span>
            {[3, 5, 10].map((m) => <button key={m} className="sm" onClick={() => ops.timerStart(m * 60_000)}>{m}m</button>)}
            <button className="sm" onClick={() => setCustom(true)} aria-label="Custom timer">…</button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="row" aria-label="Timer">
      {timer.label && <span className="small muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{timer.label}</span>}
      <span className={`timer ${cls}`} role="timer" title={ms <= 0 ? overText(ms) : undefined}>{fmtMs(ms)}</span>
      {canControl && (
        <>
          {ms <= 0 ? null : timer.running
            ? <button className="sm" onClick={ops.timerPause} aria-label="Pause timer">❚❚</button>
            : <button className="sm" onClick={ops.timerResume} aria-label="Resume timer">▶</button>}
          <button className="sm" onClick={() => ops.timerAdd(60_000)}>+1m</button>
          <button className="sm ghost" onClick={ops.timerReset} aria-label="Stop timer">✕</button>
        </>
      )}
    </div>
  );
}
