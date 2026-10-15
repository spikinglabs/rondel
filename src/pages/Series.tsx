import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { fillTitle, type View } from '../lib/model';
import { openDoc, type Identity } from '../lib/store';
import { createSync, type Sync } from '../lib/sync';
import { queueSeriesMeeting } from '../lib/useMeeting';
import { downloadText, slug } from '../lib/files';
import {
  CADENCE_SHORT, PERIOD_WORD, basePeriod, decide, initSeries, inviteText, nextAfter, occurrenceRoom, periodLabel, periodOf, readSeries,
  seriesIcs, seriesLink, seriesOps, upsertSeries, whenLoaded, type Occurrence, type SeriesInfo,
} from '../lib/series';
import { PrefsButton, TopBar, ask, copyText, fmtDate, toastError } from '../components/ui';

/** Series created in this browser, to write into their documents once storage has loaded. */
const pendingSeries = new Map<string, SeriesInfo>();
export function queueNewSeries(id: string, info: SeriesInfo) {
  pendingSeries.set(id, info);
}

/** Open a series document and keep it in sync while mounted. */
function useSeriesDoc(id: string | null, key: string | null) {
  const [state, setState] = useState<{ doc: Y.Doc; sync: Sync; loaded: boolean } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id || !key) return;
    const { doc, persistence, ready } = openDoc(id);
    let sync: Sync | null = null;
    let alive = true;
    const bump = () => tick((x) => x + 1);
    ready.then(async () => {
      if (!alive) return;
      const init = pendingSeries.get(id);
      pendingSeries.delete(id);
      if (init && !readSeries(doc)) initSeries(doc, init);
      const s = await createSync(doc, id, key);
      if (!alive) return s.destroy();
      sync = s;
      setState({ doc, sync: s, loaded: false });
      doc.on('update', bump);
      s.onChange(bump);
      await whenLoaded(s);
      if (alive) setState({ doc, sync: s, loaded: true });
    });
    return () => {
      alive = false;
      doc.off('update', bump);
      sync?.destroy();
      persistence.destroy();
      doc.destroy();
    };
  }, [id, key]);
  return state;
}

/** "Team retro – Week 42, 2026", "– October 2026"; anyone can rename it in the meeting. */
export function titleFor(info: SeriesInfo, occ: string, n: number, now = new Date()) {
  if (info.template.title) return fillTitle(info.template, now) + (n > 1 ? ` (${n})` : '');
  if (info.cadence === 'none') return `${info.name} – ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${info.name} – ${periodLabel(info.cadence, basePeriod(info.cadence, occ))}${n > 1 ? ` (${n})` : ''}`;
}

/**
 * Create a meeting of the series (or join it, if someone else just did) and go there. Each meeting starts fresh
 * from the series template: nothing carries over, so a meeting never depends on reading an earlier one.
 */
async function startOccurrence(o: { doc: Y.Doc; seriesId: string; seriesKey: string; info: SeriesInfo; occ: string; n: number; me: Identity; replace: boolean }) {
  const room = await occurrenceRoom(o.seriesKey, o.occ);
  const title = titleFor(o.info, o.occ, o.n);
  queueSeriesMeeting(room.roomId, {
    title, template: o.info.template, creatorId: o.me.id, seriesName: o.info.name,
    facilitators: o.info.facilitators.map((f) => f.id), series: { id: o.seriesId, key: o.seriesKey, occ: o.occ }, seed: room.roomId,
  });
  seriesOps(o.doc).addOccurrence({ occ: o.occ, title, status: 'live', createdAt: new Date().toISOString(), closedAt: null });
  const hash = `#/m/${room.roomId}/${room.key}`;
  if (o.replace) location.replace(hash);
  else location.hash = hash;
}

/**
 * The series link. Normally it goes straight on to the current meeting, creating it if this period has none
 * yet. With `overview` (or when this period's meeting is closed) it shows the series instead.
 */
export function SeriesPage({ seriesId, seriesKey, me, overview, onRename }: { seriesId: string; seriesKey: string; me: Identity; overview: boolean; onRename: () => void }) {
  const s = useSeriesDoc(seriesId, seriesKey);
  const series = s ? readSeries(s.doc) : null;
  const [busy, setBusy] = useState<string | null>(null);
  const acted = useRef(false);

  useEffect(() => {
    if (series) upsertSeries({ id: seriesId, key: seriesKey, name: series.info.name, cadence: series.info.cadence, updatedAt: new Date().toISOString() });
  }, [series?.info.name]);

  const goTo = async (occ: string) => {
    const room = await occurrenceRoom(seriesKey, occ);
    location.replace(`#/m/${room.roomId}/${room.key}`);
  };

  const start = async (occ: string, n: number) => {
    if (!s || !series) return;
    setBusy('Starting the meeting…');
    try {
      await startOccurrence({ doc: s.doc, seriesId, seriesKey, info: series.info, occ, n, me, replace: true });
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  };

  const decision = series ? decide(series.occurrences, periodOf(series.info.cadence)) : null;
  useEffect(() => {
    if (overview || acted.current || !s?.loaded || !decision) return;
    if (decision.kind === 'open') {
      acted.current = true;
      void goTo(decision.occ);
    } else if (decision.kind === 'create') {
      acted.current = true;
      void start(decision.occ, decision.n);
    }
  }, [overview, s?.loaded, decision?.kind]);

  const top = <TopBar crumbs={series ? [series.info.name] : []} right={<PrefsButton me={me} onChange={onRename} />} />;
  if (!s || !series) {
    const missing = s?.loaded && s.sync.mode === 'server';
    return (
      <>
        {top}
        <div className="page">
          <div className="card stack" style={{ maxWidth: 560, margin: '40px auto' }}>
            <h2>{!s?.loaded ? 'Opening the meeting series…' : missing ? 'This meeting series was not found' : 'Nobody with this series is online'}</h2>
            {s?.loaded && <p className="muted">{missing ? 'Check that you copied the whole link, including the part after #.' : 'Without a meeting server, the person who set up the series has to be online once for others to get it.'}</p>}
          </div>
        </div>
      </>
    );
  }
  if (busy || (!overview && decision && decision.kind !== 'closed')) {
    return (<>{top}<div className="empty">{busy ?? 'Opening the current meeting…'}</div></>);
  }

  const { info, occurrences } = series;
  const ops = seriesOps(s.doc);
  const past = Object.values(occurrences).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const isFacilitator = info.facilitators.some((f) => f.id === me.id);
  const link = seriesLink(seriesId, seriesKey);
  const period = periodOf(info.cadence);
  const closedNow = decision?.kind === 'closed' ? decision : null;
  const startNext = () => {
    if (closedNow) return start(closedNow.next, closedNow.n);
    const d = decide(occurrences, period);
    if (d.kind === 'open') return goTo(d.occ);
    if (d.kind === 'create') return start(d.occ, d.n);
    return start(d.next, d.n);
  };

  return (
    <>
      {top}
      <div className="page">
        <div className="home-grid">
          <div className="stack">
            <div className="row wrap page-head">
              <h1>{info.name}</h1>
              <span className="badge">{CADENCE_SHORT[info.cadence]}</span>
            </div>
            {closedNow && (
              <div className="card stack">
                <h2>{occurrences[closedNow.last]?.title ?? 'The last meeting'} is closed</h2>
                <p className="muted">Open it to read the minutes, or start {info.cadence === 'none' ? 'the next meeting' : `another meeting ${PERIOD_WORD[info.cadence]}`}.</p>
                <div className="row wrap">
                  <button onClick={() => goTo(closedNow.last)}>Open the minutes</button>
                  <button className="primary" onClick={startNext}>{info.cadence === 'none' ? 'Start the next meeting' : `Start another meeting ${PERIOD_WORD[info.cadence]}`}</button>
                </div>
              </div>
            )}
            {!closedNow && (
              <div className="row"><button className="primary" onClick={startNext}>{decision?.kind === 'open' ? 'Open the current meeting' : 'Start the current meeting'}</button></div>
            )}
            <div className="card flush">
              {past.length === 0 ? (
                <div className="empty">No meetings in this series yet. The first person to open the series link starts one.</div>
              ) : (
                <ul className="list">
                  {past.map((o: Occurrence) => (
                    <li key={o.occ} className="link" onClick={() => goTo(o.occ)}>
                      <div className="col" style={{ gap: 2, minWidth: 0 }}>
                        <span>{o.title}</span>
                        <span className="faint small">{fmtDate(o.createdAt)}</span>
                      </div>
                      <span className="spacer" />
                      <span className={`badge ${o.status === 'live' ? 'success' : ''}`}>{o.status === 'live' ? 'Open' : 'Closed'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <aside className="stack">
            <SeriesInvite id={seriesId} info={info} link={link} />
            <div className="card stack">
              <h2>Facilitators</h2>
              <p className="small muted">They facilitate every new meeting in the series, whoever opens it first. Anyone can step in when none of them is there.</p>
              <ul className="list">
                {info.facilitators.map((f) => (
                  <li key={f.id}>
                    <span>{f.name}{f.id === me.id ? ' (you)' : ''}</span>
                    <span className="spacer" />
                    {isFacilitator && info.facilitators.length > 1 && (
                      <button className="ghost sm" aria-label={`Remove ${f.name} as facilitator`} onClick={async () => {
                        if (await ask(`Remove ${f.name} as a facilitator of ${info.name}?`)) ops.removeFacilitator(f.id);
                      }}>✕</button>
                    )}
                  </li>
                ))}
              </ul>
              {!isFacilitator && <button className="sm" onClick={() => ops.addFacilitator({ id: me.id, name: me.name })}>Facilitate this series too</button>}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

/** The series link, ready-made invite text and a calendar file for the recurring invite. */
export function SeriesInvite({ id, info, link }: { id: string; info: SeriesInfo; link: string }) {
  return (
    <div className="card stack">
      <h2>Put this in the calendar invite</h2>
      <p className="small muted">One link for every meeting in the series. It always opens the current meeting, and starts it if nobody has yet.</p>
      <div className="row">
        <input readOnly value={link} aria-label="Series link" onFocus={(e) => e.target.select()} />
        <button className="primary" onClick={() => copyText(link, 'Series link copied')}>Copy</button>
      </div>
      <div className="row wrap">
        <button className="sm" onClick={() => copyText(inviteText(info, link), 'Invite text copied. Paste it into the Outlook invite.')}>Copy invite text</button>
        <button className="sm" onClick={() => downloadText(`${slug(info.name) || 'meeting'}.ics`, seriesIcs(id, info, link), 'text/calendar')}>Download calendar file (.ics)</button>
      </div>
      <p className="small muted">Open the .ics file in Outlook, add the people, and send. Everyone on the invite gets the link.</p>
    </div>
  );
}

/**
 * While a series meeting is open, keep its entry in the series up to date (title, open or closed), so the
 * series link knows when to offer the next one.
 */
export function useSeriesTracking(view: View | null, me: Identity) {
  const meta = view?.meta ?? null;
  const ref = meta?.series ?? null;
  const s = useSeriesDoc(ref?.id ?? null, ref?.key ?? null);
  useEffect(() => {
    if (!s || !ref || !meta || !readSeries(s.doc)) return;
    seriesOps(s.doc).syncOccurrence(ref.occ, { title: meta.title, status: meta.status, closedAt: meta.closedAt }, meta.createdAt || new Date().toISOString());
  }, [s, s?.loaded, ref?.occ, meta?.title, meta?.status, meta?.closedAt]);
  if (!ref) return null;
  /** The next week's (month's) meeting, made now so people can prepare. */
  const startNext = async () => {
    const series = s && readSeries(s.doc);
    if (!s || !series || !view) return toastError(new Error('The series is still loading. Try again in a moment.'));
    const next = nextAfter(series.info.cadence, ref.occ, series.occurrences);
    if (next.exists) {
      const room = await occurrenceRoom(ref.key, next.occ);
      location.hash = `#/m/${room.roomId}/${room.key}`;
      return;
    }
    await startOccurrence({ doc: s.doc, seriesId: ref.id, seriesKey: ref.key, info: series.info, occ: next.occ, n: next.n, me, replace: false }).catch(toastError);
  };
  const series = s ? readSeries(s.doc) : null;
  const next = series ? nextAfter(series.info.cadence, ref.occ, series.occurrences) : null;
  const nextLabel = !series || !next ? null : series.info.cadence === 'none' ? 'the next meeting' : periodLabel(series.info.cadence, basePeriod(series.info.cadence, next.occ));
  return { link: seriesLink(ref.id, ref.key), overview: `#/s/${ref.id}/${ref.key}/overview`, startNext, nextLabel, nextExists: !!next?.exists };
}

