import { useEffect, useState, type ReactNode } from 'react';
import { TopBar } from '../components/ui';
import { syncMode, type SyncMode } from '../lib/sync';
import { isLab } from '../lib/lab';

export const DATA_PAGE = '#/data';

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
  const ours = /(^|\.)spikinglabs\.(com|workers\.dev)$/.test(location.hostname);
  const back = history.length > 1 ? () => history.back() : () => (location.hash = '#/');

  return (
    <>
      <TopBar crumbs={['How your data is handled']} />
      <div className="page">
        <div className="stack data-page">
          <div className="row wrap page-head">
            <h1>How your data is handled</h1>
            <span className="spacer" />
            <button onClick={back}>Back</button>
          </div>
          <p className="muted">
            Rondel has no accounts and no tracking. Everything people write in a meeting is encrypted in their browser before it goes anywhere,
            with a key that only the people holding the meeting link have.
          </p>
          {isLab() && (
            <p className="data-mode">
              <strong>This is a test. </strong>
              Rondel is being tried out here as a lab product. Features may change, and meetings on this site may be deleted when the test ends.
              Keep anything you need, such as the minutes, somewhere else too.
            </p>
          )}
          {mode && (
            <p className="data-mode">
              <strong>On this site: </strong>
              {mode === 'server'
                ? 'meetings are stored, encrypted, on this site’s room server, so people can join live or at different times.'
                : mode === 'artifact'
                  ? 'meetings are stored, encrypted, in this claude.ai preview’s shared storage.'
                  : 'there is no room server, so browsers connect to each other directly and meetings live only in the browsers of the people who joined.'}
            </p>
          )}

          <Section title="The link is the key">
            <p>
              A meeting link looks like <code>…/#/m/<em>meeting</em>/<em>key</em></code>. The part after <code>#</code> is never sent to any server; browsers keep it to themselves.
              Your browser turns the key into an AES-256 encryption key and uses it to encrypt everything before it leaves.
            </p>
            <ul>
              <li>Anyone with the full link can open and edit the meeting. Share it like you would share the meeting invite.</li>
              <li>Without the link nobody can read the meeting, including the people who run the server. If every copy of a link is lost, its meeting cannot be recovered.</li>
              <li>A series link (<code>#/s/…</code>) works the same way. Each meeting in the series has its own key, worked out from the series key, so the series link opens all of them.</li>
              <li>The facilitator role, hidden votes and removing a person are agreements built into the app, not locks. Someone with the link and some technical skill could get around them. To shut someone out for good, start a new meeting and share the link only with the others.</li>
            </ul>
          </Section>

          <Section title="What the server stores">
            <p>When a room server is used, it stores each meeting as a list of encrypted updates it cannot open. For each meeting it also keeps:</p>
            <ul>
              <li>a random meeting id, taken from the link;</li>
              <li>a fingerprint that proves a browser has the key without revealing it, so people without the link can't write to the meeting;</li>
              <li>the size and order of the updates;</li>
              <li>when it last changed, so it can be deleted after a while;</li>
              <li>after a meeting is deleted on purpose, only a note that its id was deleted, so old copies can't bring it back.</li>
            </ul>
            <p>
              Who is online, their names and where they are in the meeting are encrypted the same way, passed on to the others in the meeting, and never stored.
              The server sees when browsers connect and how much they send, but not who they are or what they write.
            </p>
            <p>
              {ours
                ? <>{host} runs on Cloudflare (Workers and Durable Objects). Like any web host, Cloudflare handles the connections, so it sees IP addresses and timing in transit. To stop abuse, Rondel counts new connections per address for one minute; the count is not stored. </>
                : <>{host} is run by your organisation or whoever set it up; ask them where it is hosted. </>}
              Rondel itself keeps no logs and uses no analytics, cookies, fonts or scripts from other sites.
            </p>
          </Section>

          <Section title="What stays in your browser">
            <ul>
              <li>Your name and a random id that tells your cards apart from others'. Your name is shared, encrypted, in the meetings you join.</li>
              <li>The list of your meetings and series, with their links, your preferences and My templates.</li>
              <li>An offline copy of each meeting you opened, so it opens quickly and works without a connection.</li>
              <li>Drafts you haven't shared yet. They never leave your browser.</li>
            </ul>
            <p>Clearing your browser's site data removes all of this. Meetings stored on the server are not affected, and opening a link again brings them back.</p>
          </Section>

          <Section title="Files you save">
            <ul>
              <li><strong>Minutes</strong> (copied or downloaded) are plain, readable text. Treat them like any meeting notes.</li>
              <li>A <strong>meeting file</strong> holds the whole meeting and its key, unencrypted. Anyone with the file can read it and open the live meeting.</li>
              <li>A <strong>browser backup</strong> holds everything listed above, including all your meeting keys. It is readable unless you set a passphrase, which encrypts it in your browser (PBKDF2 and AES-GCM). There is no way to recover a forgotten passphrase.</li>
            </ul>
          </Section>

          <Section title="How long data is kept, and deleting it">
            <ul>
              <li>
                The server deletes a meeting when nobody has changed it for 90 days{ours ? '' : ' (the default; whoever runs this site can change it)'} and nobody has it open.
                Meeting settings show the date. Closing a meeting does not delete it. If someone whose browser still has a copy opens the link after that, the meeting is stored again from their copy.
              </li>
              <li>
                A facilitator can delete a meeting from the server for everyone, in Meeting settings. That can't be undone, and browsers that still have a copy can't store it again;
                they remove their copy when they open the link. Meetings in a recurring series can't be deleted this way yet; they expire like any other.
              </li>
              <li>"Remove from this browser" on the home page deletes your list entry and offline copy only. Others keep theirs, and the server copy stays.</li>
              <li>
                For anything else, such as deleting a series, contact {ours ? <a href="https://spikinglabs.com" target="_blank" rel="noopener">Spiking Labs</a> : 'whoever runs this site'} with
                the meeting id: the part of the link between <code>/m/</code> and the key. Don't send the key.
              </li>
            </ul>
          </Section>

          {window.RONDEL_CONFIG?.sync === 'server' ? (
            <Section title="When the server can't be reached">
              <p>
                This site only ever uses its own room server. If the server can't be reached, Rondel says so and keeps trying; it never falls back to connecting
                browsers through third-party relays. What you wrote meanwhile stays in your browser and is sent once the connection is back.
              </p>
            </Section>
          ) : (
            <Section title="When there is no server">
              <p>
                If the room server can't be reached when the page loads (or the app is installed as plain files somewhere), Rondel connects browsers to each other directly.
                They find each other through public Nostr relays run by third parties. The relays see a scrambled form of the meeting id and connection handshakes encrypted with
                the key, plus IP addresses as any server would. The meeting itself goes over direct, encrypted WebRTC connections between the browsers and is stored only in them.
              </p>
              <p>Organisations that don't want to use public relays can run Rondel with its own room server, or point it at relays they run themselves (an installation setting).</p>
            </Section>
          )}

          <p className="faint small">This page describes Rondel as it is built today. The source code is the final word, and anyone running their own copy can check it.</p>
        </div>
      </div>
    </>
  );
}
