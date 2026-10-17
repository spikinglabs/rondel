# Writing meeting templates

A template sets up a meeting: its title, the card board, the agenda with timed stages, and the voting rules.
Templates are small YAML files. You can make one without writing YAML (Design a meeting, then Download .yaml),
or write one by hand with this guide.

There are three places a template can live:

- **Built in:** the templates every Rondel has, in `src/templates/builtin.ts`.
- **Your organisation:** YAML files in the `templates/` folder of your settings folder (see [DEPLOY.md](DEPLOY.md)).
  Everyone on your site sees them under "From your organisation" when they start a meeting.
- **Your own:** templates you design or import in the browser. They stay in that browser until you download them.

A meeting keeps a copy of the template it started from, so changing or removing a template later never changes
meetings that already exist.

## A complete example

```yaml
name: Sprint retro
type: retro
description: Look back on the sprint and agree on two or three changes.
title: Sprint retro {date}

columns:
  - title: Went well
    description: Wins worth repeating
  - title: To improve
  - Ideas                     # a plain line is a column with only a title

agenda:
  - title: Check-in
    minutes: 5
    activity: round
    owner: Everyone
    notes: |
      One word for how the sprint felt.
  - title: Write cards
    minutes: 10
    activity: write
  - title: Group
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss the top cards
    minutes: 20
    activity: discuss
  - title: Agree actions
    minutes: 10
    activity: actions
    screen:
      middle: [actions, board]
      people: folded

settings:
  anonymous_cards: true
  votes_per_person: 5
  votes_per_card: 3
  secret_voting: true
```

## Fields

| Field | Required | What it does |
|---|---|---|
| `name` | yes | The name in the template picker, up to 80 characters. |
| `id` | no | A short id. Defaults to the name in lower case with dashes. |
| `type` | no | `retro`, `standup`, `planning`, `one_on_one` or `general` (the default). It sets the default voting rules and the label. |
| `description` | no | One line for the picker, up to 200 characters. |
| `title` | no | The default meeting title. `{date}` becomes today's date (2026-10-17) and `{month}` the month (October 2026). Defaults to the name and the date. |
| `columns` | no | The card board, up to 12 columns. Leave it out for a meeting without a board. |
| `agenda` | no | The agenda, up to 40 items. |
| `settings` | no | Voting and board rules (below). |

Any other field is an error, so a typo such as `colums:` is caught instead of silently ignored.

### Columns

Each column is a plain line (its title) or has these fields:

| Field | |
|---|---|
| `title` | Required, up to 80 characters. |
| `description` | A hint shown under the title, up to 300 characters. |
| `color` | A colour such as `"#16a34a"` (quote it, because `#` starts a comment in YAML). |

### Agenda items

Each item is a plain line (a 5-minute discussion) or has these fields:

| Field | |
|---|---|
| `title` | Required, up to 200 characters. |
| `minutes` | Whole minutes from 0 to 600; default 5. Starting the item starts a timer for this long. |
| `activity` | What happens during the item (below); default `topic`. |
| `owner` | Who leads it, such as `Facilitator` or `Everyone`. |
| `notes` | Pre-filled shared notes, such as questions to answer, up to 4000 characters. Use `\|` for several lines. |
| `screen` | What the meeting screen shows during the item (below). |

| `activity` | What happens |
|---|---|
| `topic` | Shared notes and decisions for one topic. |
| `round` | Everyone speaks in turn, for example a check-in or updates. |
| `brainstorm` | Everyone adds ideas at once, then dot-votes, and the best become actions or agenda items. |
| `write` | People write cards on the board. Drafts stay private until shared. |
| `group` | Cluster similar cards and name the groups. |
| `vote` | Everyone votes for the cards to discuss. |
| `discuss` | Talk through the cards in vote order. |
| `actions` | Agree owners and due dates for actions. |
| `break` | A pause. The timer runs; nothing to capture. |

`write`, `group`, `vote`, `discuss` and `actions` also switch the card board into that stage when the item starts.

### Screen

The meeting screen has a middle work area and a side bar. Each kind of activity has a sensible default, so most
templates never set `screen`. To change it for one item:

```yaml
screen:
  middle: [board, topic]   # up to 2 of: board, brainstorm, topic, actions, decisions, people
  people: folded           # agenda, people, board, brainstorm, topic, actions, decisions: open or folded
```

`topic` is the shared notes of the current item. Each person can still rearrange their own screen.

### Settings

| Setting | |
|---|---|
| `anonymous_cards` | `true` hides who wrote each card. |
| `votes_per_person` | Votes each person has, 0 to 99; 0 means unlimited. |
| `votes_per_card` | Votes one person can give one card, 0 to 99; 0 means unlimited. |
| `secret_voting` | `true` hides votes until the facilitator reveals them. |
| `open_board` | `true` shows cards live with names, like a whiteboard, with no private drafts. |

Settings you leave out follow the `type`: a `retro` defaults to anonymous cards, 5 votes per person, 3 per card
and secret voting; other types show names and give 3 votes, 1 per card.

## Checking a template

- In the app, Design a meeting → YAML checks the file as you type and points to the line of each problem.
- In the repository, `npm test` checks every file in `deploy/*/templates/`, so a broken organisation template
  fails before it is deployed.

## New versions

Every template in the picker has a **New version** button: it opens a copy named "… (v2)" and leaves the original
as it is. Inside a meeting, Settings → Save as a new template turns the meeting as it is now back into a template.
For an organisation template, download the new version and replace the file in your `templates/` folder.
