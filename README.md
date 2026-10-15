# Rondel

Retrospectives and everyday meetings: write, group, vote, discuss, agree actions; agenda, timer,
shared notes, decisions and action items; prepare before the meeting, carry open actions into the next one.

Rondel is a static web app plus an optional, very small room server. Everything people write is
encrypted in the browser with a key that lives only in the meeting link (after `#`), so whatever
stores or relays the meeting cannot read it.

## Ways to run it

| | What you get | How |
|---|---|---|
| **Cloudflare** | Static app + one Durable Object per meeting for storage and live sync | `npm run cf:deploy` |
| **Any Node host or container** | Same, with meetings in one SQLite file | `npm run build && npm start`, or the `Dockerfile` |
| **Static files only** (GitHub Pages, intranet, SharePoint) | Live meetings browser-to-browser; no storage, so no preparation at different times | Copy `dist/` anywhere |
| **claude.ai artifact** (test previews) | Same as a server, using the artifact's shared storage and live room; invite links use `#m.<room>.<key>` because claude.ai only passes plain anchors | Publish `dist/` with the `db`, `room` and `downloads` capabilities and set `shareUrl` in `index.html` |

The app decides at start-up: if `api/health` on the same address answers, it uses the room server;
otherwise it falls back to peer-to-peer. Nothing in the app is specific to one platform.

```
browser ──encrypted updates──▶ room server (Node | Cloudflare | …) ──▶ other browsers
   │                              stores opaque blobs, checks the link's auth token
   └─ IndexedDB copy, works offline and catches up on reconnect
```

## How your data is handled

`#/data` (linked from the footer, the home page and the command palette) explains in plain language what is
encrypted, what the server stores, what stays in the browser, what saved files contain, retention and deletion,
and the peer-to-peer fallback's public relays. It is readable before entering a name. Keep it in step with the code
when any of that changes.

## Recurring meetings

A meeting can repeat daily, weekly or monthly, or irregularly. It then gets one **series link**
(`#/s/<series>/<key>`) for the recurring calendar invite, plus ready-made invite text and an `.ics` file.

- Deliberately coarse: a series makes at most one meeting per calendar day, week or month, titled with it
  ("Team retro – Week 42, 2026", "– October 2026"). A team meeting every two weeks just gets a meeting in the weeks it
  opens the link. Anyone can rename a series meeting.
- Opening the link computes the current period (for example `2026-W42`) and, from the series key, that period's
  meeting room and key. Everyone with the link lands in the same meeting; the first one to open it creates it from
  the series template. Meetings are independent: nothing carries over from the previous one.
- Ids in a new series meeting are derived from its room, so two people starting it at the same moment write the
  same entries instead of two agendas.
- A small series document (stored like a meeting) holds the template, the facilitators and the list of meetings.
  When a facilitator closes a meeting, the link shows it as closed and offers "Start another meeting this week",
  which gets a suffix (`2026-W42-2`). An irregular series works only this way.
- "Start next occurrence" in a series meeting creates (or opens) next week's or month's meeting early, for preparation.
- The series' facilitators facilitate every new meeting, whoever opens it first.

## The room server

All server logic lives in `server/core` and uses only standard web APIs:

- `protocol.ts` – the JSON messages (`hello`, `upd`, `aw`, `compact`, `ping`; `welcome`, `ack`, `peers`, …).
- `room.ts` – one meeting room: auth check, ordered storage, relaying, compaction. It talks to a `RoomStore`
  interface and a minimal connection interface.

An adapter connects that to a platform in a few dozen lines:

- `server/node` – HTTP + WebSocket server, SQLite storage (`node:sqlite`), also serves `dist/`.
- `server/cloudflare` – Worker + Durable Object with its built-in SQLite.

Adding another platform (Azure, Deno, Bun, a Kubernetes service…) means implementing `RoomStore` and
wiring WebSocket frames to `Room`.

Security model: the first browser to open a meeting registers a token derived from the link key; later
connections must present the same token. Stored data is AES-GCM encrypted with a key derived from the
link key. The server sees room ids, sizes and timing, not content.

## Settings

Edit the script block at the top of `index.html` (also in the built `dist/index.html`):

```js
window.RONDEL_CONFIG = {
  sync: "auto",       // "auto" | "server" | "p2p"
  serverUrl: null,    // room server elsewhere, e.g. "https://rondel.example.workers.dev/"
  strategy: "nostr",  // peer-to-peer only: how browsers find each other
  relayUrls: null,
  turn: [],
  lab: false,         // true: "Lab" tag in the header and a test notice on the data page
  feedback: null      // email address or form URL for "Send feedback"; null hides it
};
```

A deployment can keep its own settings in a JSON file and apply them to the build:
`node scripts/site-config.mjs site/lab.json` (part of `npm run cf:deploy`). The hosted lab site uses
`site/lab.json`: server-only sync, so it never falls back to public relays, and the lab notice.

Node server: `PORT` (8787), `DATA_DIR` (`./data`), `STATIC_DIR` (`./dist`).

## Releasing (hosted lab site)

Testers use https://rondel.lab.spikinglabs.com, so nothing goes there untested. GitHub Actions
(`.github/workflows/ci.yml`) does the releasing:

1. Every pull request runs `npm test`, the build and `npm run test:e2e`.
2. Every merge to `main` deploys to the staging site (https://rondel-staging.spikinglabs.workers.dev, its own
   meetings and a "Staging" tag) and runs `npm run check:staging` against it.
3. A version tag (`git tag v0.24.0 && git push origin v0.24.0`, matching `package.json`) does the same, then
   deploys the lab site and runs `npm run check:live`.

The workflow needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The same
`npm run cf:staging` / `cf:deploy` scripts still work by hand.

Costs and limits: rooms use the Durable Object hibernation API, so open but idle tabs cost nothing, and
heartbeats are answered without waking the room. Each network address may open 300 meeting connections a
minute (`ratelimits` in `wrangler.jsonc`). Cloudflare's budget alert on the account emails when spending passes $10.

Changes go in through pull requests to https://github.com/spikinglabs/rondel; nobody pushes to `main` directly.

## Development

```
npm install
npm run dev        # app on :5173, room server on :8787
npm test           # unit tests: meeting model, room server
npm run build      # dist/
npm run test:e2e   # browsers: peer-to-peer mode, then server mode (set CHROMIUM_PATH if needed)
npm run cf:dev     # the Cloudflare version locally; BASE_URL=http://localhost:8787/ node --import tsx e2e/server.mjs
```

Stack: React 19, Yjs, y-indexeddb, Vite; Trystero for the peer-to-peer fallback.

## Trade-offs

- Anyone with the full link can join and edit. Facilitator controls and hidden vote totals are conventions in
  the app, not enforced by the server.
- The server cannot help with search, reminders or integrations, because it cannot read meetings. Those would
  need a separate, opt-in add-on.

## Whiteboard: wins and challenges

The built-in **Wins and challenges of the month** template works like a team whiteboard: two regions (Wins of the month, Challenges), everyone posts sticky notes at the same time, and everyone sees each other. It uses an **open board** (`open_board: true`, or Settings → Open board): notes are posted straight to the board with the writer's name instead of as private drafts, and while someone types, the others see a dashed note with their name tag (and, on an open board, the text as it is typed). With the open board off, others only see that someone is writing, never the text. `{month}` in a template title becomes e.g. "October 2026".

## Everyone is done

Each person can press **I'm done** when they have finished a step. The top bar shows how many are done, and when everyone here (two or more people) is done, each person sees a short notice and a green "Everyone is done" mark; if the tab is in the background, its title gets a ✓ until they come back. Moving to another stage, or the facilitator's Clear, starts a new round.

## QR code invites

Invite → **QR code** shows the meeting link as a QR code to scan with a phone. It is drawn in the browser (qrcode-generator), never by an online QR service, because the link carries the meeting's encryption key.

## Side panels

The « button folds the agenda to a narrow rail of item numbers; » or any number opens it again for editing. People, Action items and Decisions each fold to their title. Drag the edge of the right column (or focus it and use the arrow keys) to widen it; double-click resets it. The layout is remembered in this browser (`rondel:layout`).

## Markdown and minutes

Cards, action items and decisions show Markdown (**bold**, *italic*, `code`, links, lists; cards also headings, quotes and tables). Discussion notes are typed as plain Markdown; **Preview** shows them formatted, and closed meetings show them formatted. The renderer (src/components/Markdown.tsx) builds React elements, so raw HTML is never rendered and links only open http(s) and mailto.

**Minutes** opens the minutes formatted, with **Copy for email** (HTML with inline styles plus the Markdown as plain text, so it pastes into Outlook with headings, lists and an action table), **Copy Markdown** and **Download .md**. Other features reuse `MinutesModal` / `copyFormatted` from src/components/Minutes.tsx.

## Middle work area and stage screens

The middle of the meeting screen is the work area; every block (Board, Discussion, Action items, Decisions, People) has a fixed home in the right side bar. ⤢ moves a block to the top of the middle (two at most; the oldest goes back home), and the minimize button, or **Move back** at its home, returns it.

Each stage can set the screen while it runs (designer: **Screen** on a stage; YAML: `screen:` with `middle: [board, topic]` and `agenda`, `people`, `board`, `topic`, `actions`, `decisions` set to `open` or `folded` for their side bar home). Defaults: write, group and vote show the board; discuss shows board and discussion; actions shows action items and discussion; a break shows the discussion. Anyone can rearrange their own screen during the stage; the next stage applies its own screen again. Without a stage, the screen is remembered per browser.

## Brainstorm

Discussion is one shared text that people write together, in order, on one topic. Brainstorm is for going wide first: everyone adds many short ideas at once, each its own tile, with no judging. The facilitator can hide others' ideas while collecting, so people aren't anchored by the first ideas they see (this is a screen convention, like secret voting; the ideas are in the encrypted meeting). Then the facilitator moves to **Vote** (three dots each, stackable) and **Pick**, where ideas sort by dots and each can become an action item or a new agenda topic in one click. The prompt is the current agenda item's title, and every agenda item has its own brainstorm. Ideas, their dots and what became of them go into the minutes.

A **Brainstorm** stage in the designer puts the brainstorm in the middle; any other time, it sits folded in the side bar and moves to the middle like the other blocks.

## Command palette

Press **Ctrl K** (**⌘K** on a Mac), or the **Search** button in the top bar on a phone, to search and run commands from one box. Typing finds cards, ideas, action items, decisions and agenda items, and jumps to the one you pick (moving its block to the middle and highlighting it). Commands cover the screen (show a block in the middle, minimize it, fold it, reset the layout), adding things (a card, an idea, an action, a decision, notes, an agenda topic), running the meeting for facilitators (next item, start any item, timer, board stage, brainstorm step, reveal votes), and the meeting itself (invite, minutes, save, settings, close). On every page it also opens recent meetings and switches the theme. Pages add commands with `useCommands` (src/components/CommandPalette.tsx).

## Moving to another browser

Rondel keeps your identity, preferences, My templates and the lists of your meetings and series (with their link keys) in the browser. **Your preferences → Back up or restore…** (or "Back up this browser" in the command palette) downloads all of it, plus the stored copy of each meeting and series, as one file. Restoring it in another browser adds it to what that browser has: lists and meetings are merged, nothing is removed, and settings the browser already has are kept. Tick "Be the same person as in the backup" to keep your facilitator role (the default in a fresh browser). The file holds the meetings' keys, so it opens them like their links do; an optional passphrase encrypts it (PBKDF2 and AES-GCM, in the browser).

## New versions of a template

Every template in the picker has a **New version** button (on hover): it opens the designer with a copy named "… (v2)" (then v3, and so on), and the original stays as it is. Inside a meeting, **Settings → Save as a new template…** or "Save as a new template" in the command palette does the same from the meeting as it is now, keeping the original template's description and pre-filled notes. My templates also keep their **Edit** button for changing a template in place.

## Full-screen column

Every board column has a full-screen button next to its title. It shows that one column across the whole screen with larger notes side by side, Previous / Next to step through columns (or the arrow keys), and Esc or Exit full screen to return. It only changes your own view.

## People and preferences

- **People** in a meeting lists everyone who has opened it: who is here now (with what they are doing: here, writing cards, done), and who joined earlier, for example to prepare. The top bar shows who is here by name.
- **Removing someone:** the meeting's creator can remove a person from People. Their app leaves the meeting and deletes its local copy, and they drop off the list and the facilitators. This is a courtesy, not a lock: the link is the key, so someone determined could clear their browser and rejoin under a new name. To shut someone out for good, start a new meeting and share its link only with the others.
- **Remembered in this browser** (click your name at the top): your name, light/dark appearance, card and voting defaults for new meetings (tick "Use these settings for my new meetings" in a meeting's Settings), the last template and series names you used, and the names of people you've met, which are suggested as action owners.

## Meeting designer

Home → **Design a meeting** (or New meeting → Design new…) opens a visual designer: name the meeting, lay it out as timed stages, set up the card board and voting, and see the run of show with clock times. Each stage has an activity:

- **Discussion** and **Round** (everyone speaks in turn) get shared notes and decisions.
- **Write cards**, **Group cards**, **Vote**, **Discuss cards** and **Actions** are board stages: when the facilitator starts one, its timer runs and the board switches to that step (private drafts, grouping, voting, vote order). This is how a collaborative retro is designed, and any meeting kind can use it.
- **Break** just runs the timer.

The designer and the YAML tab edit the same template; editing in the designer rewrites the YAML without its comments. The run of show warns about odd orders (voting before writing), board stages without columns, and long meetings without a break.

## Meeting templates (YAML)

Every template, including the built-in ones (`src/templates/builtin.ts`), is a small YAML file:

```yaml
name: Sprint retro                 # required
type: retro                        # retro | standup | planning | one_on_one | general (default general)
description: Shown in the template picker
title: Sprint retro {date}         # default meeting title; {date} becomes today's date
columns:                           # the card board; leave out for none
  - title: Went well
    description: Wins worth repeating
  - To improve                     # a plain line works too
agenda:
  - title: Review last actions
    minutes: 5                     # whole minutes, default 5
    activity: topic                # topic | round | write | group | vote | discuss | actions | break
    owner: Facilitator
    notes: |                       # pre-filled meeting notes
      Which actions are still open?
  - Board                          # a plain line works too
settings:
  anonymous_cards: true            # hide who wrote each card
  votes_per_person: 5              # 0 = unlimited
  votes_per_card: 3                # 0 = unlimited
  secret_voting: true              # hide votes until the facilitator reveals them
```

- **Your own templates:** Design a meeting, or New meeting → Design new… (or Import .yaml…, or Copy on any template). The editor checks the YAML as you type, points to the line of each problem, and previews the result. Saved templates live in your browser; Download .yaml to share one.
- **Save as template:** in a meeting, Settings → Save as meeting design… turns its board, agenda and settings into YAML.
- **For everyone in your organisation:** put YAML files next to the app and list them in `RONDEL_CONFIG.templates` in `index.html`, for example `["templates/board-meeting.yaml"]`. They appear under "From your organisation".
- A meeting keeps a copy of its template, so "Start the next meeting" works for everyone in it, even if the template was only in one person's browser.
