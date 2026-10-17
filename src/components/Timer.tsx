import { useEffect, useState } from 'react';
import type { Timer } from '../lib/model';
import type { Ops } from '../lib/ops';
import { t } from '../lib/i18n';

// The clock never goes below zero: when time runs out it says so, and the tooltip says how long ago.
export function fmtMs(ms: number) {
  if (ms <= 0) return t('Time\'s up');
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function overText(ms: number) {
  const min = Math.floor(-ms / 60_000);
  return min < 1 ? t('Ended just now') : t('Ended {n} min ago', { n: min });
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
      <div className="row" aria-label={t('Timer')}>
        {custom ? (
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            const min = Number(new FormData(e.currentTarget).get('min'));
            if (min > 0) ops.timerStart(min * 60_000);
            setCustom(false);
          }}>
            <input name="min" type="number" min={1} max={240} defaultValue={5} autoFocus style={{ width: 64 }} aria-label={t('Timer minutes')} />
            <button className="sm primary" type="submit">{t('Start')}</button>
          </form>
        ) : (
          <>
            <span className="small muted">{t('Timer')}</span>
            {[3, 5, 10].map((m) => <button key={m} className="sm" onClick={() => ops.timerStart(m * 60_000)}>{t('{n}m', { n: m })}</button>)}
            <button className="sm" onClick={() => setCustom(true)} aria-label={t('Custom timer')}>…</button>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="row" aria-label={t('Timer')}>
      {timer.label && <span className="small muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{timer.label}</span>}
      <span className={`timer ${cls}`} role="timer" title={ms <= 0 ? overText(ms) : undefined}>{fmtMs(ms)}</span>
      {canControl && (
        <>
          {ms <= 0 ? null : timer.running
            ? <button className="sm" onClick={ops.timerPause} aria-label={t('Pause timer')}>❚❚</button>
            : <button className="sm" onClick={ops.timerResume} aria-label={t('Resume timer')}>▶</button>}
          <button className="sm" onClick={() => ops.timerAdd(60_000)}>{t('+1m')}</button>
          <button className="sm ghost" onClick={ops.timerReset} aria-label={t('Stop timer')}>✕</button>

        </>
      )}
    </div>
  );
}
