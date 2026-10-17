import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { TopBar } from '../components/ui';
import { syncMode, type SyncMode } from '../lib/sync';
import { isLab } from '../lib/lab';
import { contactHref, operator } from '../lib/site';
import { t, tn } from '../lib/i18n';

export const DATA_PAGE = '#/data';

/** A translated sentence with {placeholders} replaced by elements (code, links, emphasis). */
function fill(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((s, i) => {
    const k = /^\{(\w+)\}$/.exec(s)?.[1];
    return k && k in parts ? <Fragment key={i}>{parts[k]}</Fragment> : s;
  });
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="card stack data-section">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

/** Plain-language account of where meeting data goes, kept in step with the code (sync, crypto, store, backup, p2p). */
export function DataPage() {
  const [mode, setMode] = useState<SyncMode | null>(null);
  useEffect(() => void syncMode().then(setMode), []);
  const host = location.host;
  const op = operator();
  const contact = op && contactHref(op);
  const back = history.length > 1 ? () => history.back() : () => (location.hash = '#/');

  return (
    <>
      <TopBar crumbs={[t('How your data is handled')]} />
      <div className="page">
        <div className="stack data-page">
          <div className="row wrap page-head">
            <h1>{t('How your data is handled')}</h1>
            <span className="spacer" />
            <button onClick={back}>{t('Back')}</button>
          </div>
          <p className="muted">
            {t('Rondel has no accounts and no tracking. Everything people write in a meeting is encrypted in their browser before it goes anywhere, with a key that only the people holding the meeting link have.')}
          </p>
          {isLab() && (
            <p className="data-mode">
              <strong>{t('This is a test.')} </strong>
              {t('Rondel is being tried out here as a lab product. Features may change, and meetings on this site may be deleted when the test ends. Keep anything you need, such as the minutes, somewhere else too.')}
            </p>
          )}
          {mode && (
            <p className="data-mode">
              <strong>{t('On this site:')} </strong>
              {mode === 'server'
                ? t('meetings are stored, encrypted, on this site’s room server, so people can join live or at different times.')
                : mode === 'artifact'
                  ? t('meetings are stored, encrypted, in this claude.ai preview’s shared storage.')
                  : t('there is no room server, so browsers connect to each other directly and meetings live only in the browsers of the people who joined.')}
            </p>
          )}

          <Section title={t('The link is the key')}>
            <p>
              {fill(t('A meeting link looks like {link}. The part after {hash} is never sent to any server; browsers keep it to themselves.'), {
                link: <code>…/#/m/<em>{t('meeting')}</em>/<em>{t('key')}</em></code>,
                hash: <code>#</code>,
              })}{' '}
              {t('Your browser turns the key into an AES-256 encryption key and uses it to encrypt everything before it leaves.')}
            </p>
            <ul>
              <li>{t('Anyone with the full link can open and edit the meeting. Share it like you would share the meeting invite.')}</li>
              <li>{t('Without the link nobody can read the meeting, including the people who run the server. If every copy of a link is lost, its meeting cannot be recovered.')}</li>
              <li>{fill(t('A series link ({link}) works the same way. Each meeting in the series has its own key, worked out from the series key, so the series link opens all of them.'), { link: <code>#/s/…</code> })}</li>
              <li>{t('The facilitator role, hidden votes and removing a person are agreements built into the app, not locks. Someone with the link and some technical skill could get around them. To shut someone out for good, start a new meeting and share the link only with the others.')}</li>
            </ul>
          </Section>

          <Section title={t('What the server stores')}>
            <p>{t('When a room server is used, it stores each meeting as a list of encrypted updates it cannot open. For each meeting it also keeps:')}</p>
            <ul>
              <li>{t('a random meeting id, taken from the link;')}</li>
              <li>{t('a fingerprint that proves a browser has the key without revealing it, so people without the link can\'t write to the meeting;')}</li>
              <li>{t('the size and order of the updates;')}</li>
              <li>{t('when it last changed, so it can be deleted after a while;')}</li>
              <li>{t('after a meeting is deleted on purpose, only a note that its id was deleted, so old copies can\'t bring it back.')}</li>
            </ul>
            <p>
              {t('Who is online, their names and where they are in the meeting are encrypted the same way, passed on to the others in the meeting, and never stored. The server sees when browsers connect and how much they send, but not who they are or what they write.')}
            </p>
            <p>
              {op?.hosting === 'cloudflare'
                ? <>{t('{host} runs on Cloudflare (Workers and Durable Objects). Like any web host, Cloudflare handles the connections, so it sees IP addresses and timing in transit. To stop abuse, Rondel counts new connections per address for one minute; the count is not stored.', { host })} </>
                : op?.hosting
                  ? <>{op.hosting} </>
                  : <>{t('{host} is run by {name}; ask them where it is hosted.', { host, name: op ? op.name : t('your organisation or whoever set it up') })} </>}
              {t('Rondel itself keeps no logs and uses no analytics, cookies, fonts or scripts from other sites.')}
            </p>
          </Section>

          <Section title={t('What stays in your browser')}>
            <ul>
              <li>{t('Your name and a random id that tells your cards apart from others\'. Your name is shared, encrypted, in the meetings you join.')}</li>
              <li>{t('The list of your meetings and series, with their links, your preferences and My templates.')}</li>
              <li>{t('An offline copy of each meeting you opened, so it opens quickly and works without a connection.')}</li>
              <li>{t('Drafts you haven\'t shared yet. They never leave your browser.')}</li>
              <li>{t('A copy of the app\'s own files (no meeting content), so it opens without a connection and can be installed as an app.')}</li>
            </ul>
            <p>{t('Clearing your browser\'s site data removes all of this. Meetings stored on the server are not affected, and opening a link again brings them back.')}</p>
          </Section>

          <Section title={t('Files you save')}>
            <ul>
              <li>{fill(t('{minutes} (copied or downloaded) are plain, readable text. Treat them like any meeting notes.'), { minutes: <strong>{t('Minutes')}</strong> })}</li>
              <li>{fill(t('{save} writes the minutes, readable, into a folder you choose on this computer (for example your OneDrive or Google Drive folder, which then syncs them as usual). Your browser remembers which folder; Rondel\'s server is not involved. {csv} is a readable list of the action items.'), { save: <strong>{t('Save to folder')}</strong>, csv: <strong>{t('Actions as CSV')}</strong> })}</li>
              <li>{fill(t('A {file} holds the whole meeting and its key, unencrypted. Anyone with the file can read it and open the live meeting.'), { file: <strong>{t('meeting file')}</strong> })}</li>
              <li>{fill(t('A {backup} holds everything listed above, including all your meeting keys. It is readable unless you set a passphrase, which encrypts it in your browser (PBKDF2 and AES-GCM). There is no way to recover a forgotten passphrase.'), { backup: <strong>{t('browser backup')}</strong> })}</li>
            </ul>
          </Section>

          <Section title={t('How long data is kept, and deleting it')}>
            <ul>
              <li>
                {op?.retentionDays === 0
                  ? t('The server keeps meetings until someone deletes them.')
                  : op?.retentionDays
                    ? tn('The server deletes a meeting when nobody has changed it for {n} day and nobody has it open.', 'The server deletes a meeting when nobody has changed it for {n} days and nobody has it open.', op.retentionDays)
                    : t('The server deletes a meeting when nobody has changed it for {n} days (the default; whoever runs this site can change it) and nobody has it open.', { n: 90 })}{' '}
                {t('Meeting settings show the date. Closing a meeting does not delete it. If someone whose browser still has a copy opens the link after that, the meeting is stored again from their copy.')}
              </li>
              <li>
                {t('A facilitator can delete a meeting from the server for everyone, in Meeting settings. That can\'t be undone, and browsers that still have a copy can\'t store it again; they remove their copy when they open the link. In a recurring series this works for one meeting at a time, and a series facilitator can delete the whole series with all its meetings from the series overview.')}
              </li>
              <li>{t('"Remove from this browser" on the home page deletes your list entry and offline copy only. Others keep theirs, and the server copy stays.')}</li>
              <li>
                {fill(t('For anything else, contact {contact} with the meeting id: the part of the link between {m} and the key.'), {
                  contact: op ? (contact ? <a href={contact} target="_blank" rel="noopener">{op.name}</a> : op.name) : t('whoever runs this site'),
                  m: <code>/m/</code>,
                })}{' '}
                {t('Don\'t send the key.')}
              </li>
            </ul>
          </Section>

          {window.RONDEL_CONFIG?.sync === 'server' ? (
            <Section title={t('When the server can\'t be reached')}>
              <p>
                {t('This site only ever uses its own room server. If the server can\'t be reached, Rondel says so and keeps trying; it never falls back to connecting browsers through third-party relays. What you wrote meanwhile stays in your browser and is sent once the connection is back.')}
              </p>
            </Section>
          ) : (
            <Section title={t('When there is no server')}>
              <p>
                {t('If the room server can\'t be reached when the page loads (or the app is installed as plain files somewhere), Rondel connects browsers to each other directly. They find each other through public Nostr relays run by third parties. The relays see a scrambled form of the meeting id and connection handshakes encrypted with the key, plus IP addresses as any server would. The meeting itself goes over direct, encrypted WebRTC connections between the browsers and is stored only in them.')}
              </p>
              <p>{t('Organisations that don\'t want to use public relays can run Rondel with its own room server, or point it at relays they run themselves (an installation setting).')}</p>
            </Section>
          )}

          <p className="faint small">{t('This page describes Rondel as it is built today. The source code is the final word, and anyone running their own copy can check it.')}</p>
        </div>
      </div>
    </>
  );
}
