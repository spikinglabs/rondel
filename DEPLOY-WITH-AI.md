# Deploying Rondel with an AI assistant

This file is written for AI assistants (Claude, ChatGPT, Copilot, Cursor and others) that are asked to set up
Rondel for someone, for example "deploy Rondel in our AWS account". People can read it too; [DEPLOY.md](DEPLOY.md)
is the full reference for every setting.

**For the person asking:** give your assistant access to the cloud account or server (a terminal with the cloud's
command-line tool signed in, or the assistant's own cloud connector), then say something like:

> Deploy Rondel (https://github.com/spikinglabs/rondel) in our AWS account, eu-central-1, at
> rondel.example.com. Follow DEPLOY-WITH-AI.md in that repository.

## Instructions for the assistant

Work through these steps in order. Ask before creating anything that costs money, and say what it will cost.

### 1. Ask for what you need

Ask the person for anything below they haven't told you. Don't guess the first three.

| Question | Becomes |
|---|---|
| Where should it run (cloud and account, region, or which server)? | the recipe below |
| What address will people open, e.g. `rondel.example.com`? Who can change that DNS? | `RONDEL_HOST` |
| Who runs it, and how do people contact them about their data? | `operator.name`, `operator.contact` in `site.json` |
| How many days should unchanged meetings be kept? (default 90; 0 = until deleted) | `RETENTION_DAYS` and `operator.retentionDays` |
| Default interface language for people who haven't picked one (`en`, `de`; default: the browser's) | `language` |
| Where should "Send feedback" go (an email address or form URL, or nowhere)? | `feedback` |
| Should only the company network reach it? | security group or firewall rules |
| Any meeting templates for the whole organisation? | YAML files in `templates/` |

### 2. Know what Rondel needs

- **One container:** `ghcr.io/spikinglabs/rondel` (public; amd64 and arm64). Tags: `0.27.0` (exact),
  `0.27` (newest patch, recommended), `latest`. It listens on port 8787 and serves both the app and the room
  server. `GET /api/health` answers `{"rondel":true,...}`; use it for health checks.
- **Exactly one instance.** Open meetings live in that process's memory, and the meetings are in one SQLite file.
  Never run two copies behind a load balancer, never turn on autoscaling, and make deployments stop the old copy
  before starting the new one.
- **A disk for `/data`** that survives restarts and redeploys. A block disk (AWS EBS, an Azure managed disk, a
  persistent disk) is best. Network file shares (AWS EFS, NFS) work with the single instance; SMB shares such as
  Azure Files do not, because SQLite needs file locks. Back this disk up: it holds every meeting (encrypted).
- **HTTPS.** Browsers only allow the encryption Rondel uses on `https://` (and on `localhost`).
- **WebSockets** on `/api/rooms/...` must pass through the proxy or load balancer. The server pings every
  25 seconds, so an idle timeout of 60 seconds or more is enough.
- **No outbound access** is needed with `"sync": "server"`.
- **Settings:** a folder with `site.json` (and optionally `templates/`) mounted read-only, with
  `SITE_CONFIG=/site/site.json`. The container applies it at every start. Start from `deploy/example/`.

`site.json` for a company server:

```json
{
  "sync": "server",
  "feedback": "it-help@example.com",
  "operator": {
    "name": "Example Corp IT",
    "contact": "it-help@example.com",
    "hosting": "Rondel runs on Example Corp's AWS account in Frankfurt (eu-central-1).",
    "retentionDays": 90
  }
}
```

Write `operator.hosting` truthfully: the app's data page shows it to everyone. Keep `retentionDays` equal to the
`RETENTION_DAYS` environment variable.

### 3. Pick a recipe

#### AWS, simplest: one EC2 instance (recommended)

Roughly 15 to 20 USD a month. Uses `deploy/example/docker-compose.https.yml`, where Caddy gets the HTTPS
certificate by itself.

1. Launch one instance: Amazon Linux 2023 or Ubuntu, `t4g.small` (arm64) or `t3.small`, a 20 GB gp3 root disk.
2. Security group: allow 80 and 443 from the people who will use it (port 80 is needed for the certificate),
   and 22 only from the admin, or use SSM Session Manager instead of SSH. Don't open 8787.
3. Attach an Elastic IP and point the DNS name (`RONDEL_HOST`) at it, e.g. a Route 53 A record.
4. On the instance: install Docker and the Compose plugin, clone the repository, copy `deploy/example/` to
   `deploy/<company>/` and edit `site.json` (and `RETENTION_DAYS` in the compose file).
5. Start it:
   ```sh
   RONDEL_HOST=rondel.example.com docker compose -f deploy/<company>/docker-compose.https.yml up -d
   ```
   Put `RONDEL_HOST=...` in `deploy/<company>/.env` so later commands don't need it.
6. Backups: an Amazon Data Lifecycle Manager policy with daily EBS snapshots of the instance's disk.

If the site must stay inside the company network, Caddy can't get a public certificate. Use an internal
Application Load Balancer with an ACM certificate in front of port 8787 instead, and leave Caddy out (use
`deploy/example/docker-compose.yml`).

#### AWS, managed containers: ECS on Fargate

For teams that already run ECS. Roughly 40 USD a month with the load balancer.

- Copy the image to ECR (or pull it from ghcr.io directly; it is public).
- Task: 0.5 vCPU, 1 GB, port 8787, environment `SITE_CONFIG`, `RETENTION_DAYS`, `DATA_DIR=/data`. The settings
  folder must reach the task: build a small image `FROM ghcr.io/spikinglabs/rondel:0.27` that copies the folder
  to `/site`, or put it on the EFS volume.
- Storage: an EFS file system mounted at `/data`.
- Service: `desiredCount` 1, deployment `minimumHealthyPercent` 0 and `maximumPercent` 100, so two tasks never
  run at once. No autoscaling.
- Application Load Balancer with an ACM certificate, target group health check `/api/health`, idle timeout
  120 seconds. Stickiness isn't needed with one task.
- Backups: AWS Backup plan for the EFS file system.

Don't use AWS App Runner (no WebSockets), Lambda, or Elastic Beanstalk with more than one instance.
S3 with CloudFront alone serves only the static app, which then meets peer-to-peer and stores nothing
(see "Static files only" in DEPLOY.md).

#### Other places

- **Azure:** a Linux VM with the EC2 recipe above. Azure Container Apps only offers SMB file shares, which
  SQLite can't use safely.
- **Google Cloud:** a Compute Engine VM with the EC2 recipe above. Cloud Run has no suitable disk for SQLite.
- **Kubernetes:** a Deployment with `replicas: 1` and `strategy: Recreate`, a ReadWriteOnce PersistentVolumeClaim
  at `/data`, the settings folder as a ConfigMap mounted at `/site`, a readiness probe on `/api/health`, and an
  Ingress that passes WebSockets (most do; raise the proxy read timeout above 60 seconds if yours has one).
- **A company server or VM:** the EC2 recipe from step 4, or `deploy/example/docker-compose.yml` behind the
  reverse proxy you already have.
- **Cloudflare:** see DEPLOY.md. It needs no server or disk.

### 4. Check it works

```sh
node scripts/uptime.mjs https://rondel.example.com/
```

It needs Node 22 or later, or run it inside the container:
`docker compose -f deploy/<company>/docker-compose.https.yml exec rondel node scripts/uptime.mjs http://localhost:8787/`.
It prints `UP: ... (app, api/health, meeting room)` when the app, the server and a real meeting room work.
Then open the address in a browser, start a meeting, and open its link in a second browser window: both should
show the same cards live, and the footer should say "Run by" with the operator's name.

### 5. Tell the person

Report back in plain words:

- the address, and that it is working;
- what was created (instance, disk, DNS record, load balancer, backups) and the expected monthly cost;
- how to update: change the image tag or run `docker compose ... pull` and `up -d` again (see "Updating" in
  DEPLOY.md and the release notes at https://github.com/spikinglabs/rondel/releases);
- where the backups are, and that the meetings in them are encrypted and need their links to be read;
- how to remove everything again.

Never put a meeting link in a ticket, chat or log: the part after `#` is the key to the meeting.
