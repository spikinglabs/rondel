# Running your own Rondel

Rondel is a static web app plus a small room server. You can run it for your team or company on Cloudflare,
on any machine with Node or Docker, or as plain static files. Your settings and your organisation's meeting
templates live in one folder, so updating to a new Rondel version never touches them.

## 1. Make your settings folder

Copy `deploy/example/` to `deploy/<you>/` (or keep it outside the repository, anywhere you like) and edit it:

```
deploy/acme/
  site.json            your settings (below)
  templates/           optional: YAML meeting templates for everyone in your organisation
  docker-compose.yml   only if you run it with Docker
```

`site.json` holds the settings that differ from the defaults:

```json
{
  "name": "Rondel",
  "sync": "server",
  "feedback": "it-help@example.com",
  "operator": {
    "name": "Example Corp IT",
    "url": "https://intranet.example.com/it",
    "contact": "it-help@example.com",
    "hosting": "Rondel runs on Example Corp's own servers in Frankfurt.",
    "retentionDays": 90
  }
}
```

| Setting | What it does |
|---|---|
| `name` | The name in the header, the browser tab and link previews. Defaults to "Rondel". If you run a changed copy as a service for others, please use your own name (see the Licence in the README). |
| `sync` | `"server"` uses only your room server and never public relays (recommended with a server). `"auto"` falls back to peer-to-peer when no server answers. `"p2p"` never uses a server. |
| `serverUrl` | A room server at another address than the app, e.g. `"https://rondel.example.workers.dev/"`. Leave it out when the server serves the app. |
| `feedback` | An email address or a form URL for the footer's "Send feedback" link. `null` hides the link. |
| `operator.name` | Who runs this site. The footer shows "Run by …" and the data page names them as the contact. Leave `operator` out to show nothing. |
| `operator.url` | Optional link for the name in the footer. |
| `operator.contact` | Optional email address or URL people use to ask about their data. Defaults to `url`. |
| `operator.hosting` | One or two sentences for the data page saying where the server runs, e.g. "Rondel runs on Example Corp's own servers in Frankfurt." `"cloudflare"` uses the built-in Cloudflare wording. |
| `operator.retentionDays` | How many days the data page says unchanged meetings are kept. Must match the server's `RETENTION_DAYS`; `0` means kept until deleted. |
| `lab` | `true` shows a "Lab" tag and a test notice, or a text such as `"Staging"` for the tag. |
| `robots` | `"noindex"` keeps the site out of search results, e.g. for a staging copy. Leave it out for a public site. Meeting links are never indexed either way: everything after `#` stays in the browser. |
| `templates` | Extra template files to list. Files in the `templates/` folder are added automatically. |
| `strategy`, `relayUrls`, `turn` | Peer-to-peer details; see `index.html`. |

Every YAML file in `templates/` appears under "From your organisation" when someone starts a meeting.
The format is described in the README under "Meeting templates (YAML)", and the easiest way to make one is
Design a meeting → Download .yaml. `npm test` checks every template in `deploy/*/templates/`.

`node scripts/site-config.mjs deploy/acme/site.json` applies the folder to a build: it merges `site.json` into
`dist/index.html` and copies `templates/`. Run it after every `npm run build`; it is safe to run twice.

## 2. Pick where it runs

### Cloudflare (Workers and Durable Objects)

Meetings are stored in one Durable Object each.

```sh
npm ci
npx wrangler login
npm run build && node scripts/site-config.mjs deploy/acme/site.json && npx wrangler deploy
```

That deploys the Worker "rondel" from `wrangler.jsonc` to `rondel.<your-subdomain>.workers.dev`. To use your own
domain or worker name, copy `wrangler.jsonc` into your folder, change `name`, add
`"routes": [{ "pattern": "rondel.example.com", "custom_domain": true }]`, change `main` and
`assets.directory` to `../../server/cloudflare/worker.ts` and `../../dist`, and deploy with
`npx wrangler deploy -c deploy/acme/wrangler.jsonc`. `deploy/spikinglabs/wrangler.jsonc` is a working example
with a staging environment. Set `operator.hosting` to `"cloudflare"`.

`vars.RETENTION_DAYS` in the wrangler file sets how long unchanged meetings are kept (default 90, `"0"` keeps them).

### Docker or any Node host

Meetings are stored in one SQLite file in `/data`. With Docker Compose:

```sh
docker compose -f deploy/acme/docker-compose.yml up -d
```

The example builds the image from your checkout. To skip building, use the ready-made image that each release
publishes, and replace `build: ../..` with `image: ghcr.io/spikinglabs/rondel:latest` (or pin a release such as `0.27.0`,
or the newest `0.27.x` with `0.27`). It runs on amd64 and arm64; the first published release is 0.27.0. Without Compose:

```sh
docker run -d -p 8787:8787 -v rondel-data:/data \
  -v "$PWD/deploy/acme:/site:ro" -e SITE_CONFIG=/site/site.json \
  ghcr.io/spikinglabs/rondel:latest
```

The image applies `SITE_CONFIG` (your `site.json`, with `templates/` next to it) each time it starts, so changing
a setting or a template only needs a restart. Put it behind your usual HTTPS reverse proxy; browsers need
HTTPS for the encryption to work on anything but `localhost`. The proxy must pass WebSocket upgrades on `/api/`.

Without Docker, on any machine with Node 22.5 or later:

```sh
npm ci && npm run build && node scripts/site-config.mjs deploy/acme/site.json
PORT=8787 DATA_DIR=/var/lib/rondel RETENTION_DAYS=90 npm start
```

| Variable | Default | |
|---|---|---|
| `PORT` | 8787 | |
| `DATA_DIR` | `./data` (`/data` in Docker) | Where the SQLite file lives. Back this up. |
| `STATIC_DIR` | `./dist` | The built app. |
| `RETENTION_DAYS` | 90 | Days after the last change before a meeting is deleted; `0` keeps them. |
| `SITE_CONFIG` | none | Docker only: the `site.json` to apply at start. |

`node scripts/uptime.mjs https://rondel.example.com/` checks the app, the server and a real meeting room, for
your monitoring.

### Static files only

Without a server, people meet live browser-to-browser through public relays, and nothing is stored, so
preparing a meeting at different times does not work. Build, apply your folder with `"sync": "p2p"` (or
`"auto"`) and copy `dist/` to any web server, an intranet page or GitHub Pages.

## 3. Updating

Pull the new version, then repeat the build and deploy step (or `docker compose ... up -d --build`; with the
ready-made image, change its tag or run `docker compose pull` first). Your
settings folder and your meetings are untouched. The release notes on GitHub say when a change needs anything
from you.
