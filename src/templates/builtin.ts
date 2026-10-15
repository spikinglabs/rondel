// The templates that come with Rondel, in the same YAML format people use for their own.
// See src/lib/templates.ts for every field.

export const BUILTIN_YAML: string[] = [
  `
id: wins-challenges
name: Wins and challenges of the month
type: retro
description: Like the whiteboard - everyone posts notes live, with names.
title: Wins and challenges - {month}
columns:
  - title: Wins of the month
    description: What went well? What are you proud of?
  - title: Challenges
    description: What was hard? What got in the way?
agenda:
  - title: Write notes on the board
    minutes: 10
    activity: write
  - title: Walk the board
    minutes: 15
    activity: round
    notes: Each person reads out their notes.
  - title: Group the challenges
    minutes: 5
    activity: group
  - title: Vote on challenges to tackle
    minutes: 3
    activity: vote
  - title: Discuss the top challenges
    minutes: 20
    activity: discuss
  - title: Agree actions
    minutes: 7
    activity: actions
settings:
  open_board: true
  anonymous_cards: false
  votes_per_person: 3
  secret_voting: false
`,
  `
id: start-stop-continue
name: Start / Stop / Continue
type: retro
description: Focus on concrete changes in behaviour.
columns:
  - title: Start
    description: What should we begin doing?
  - title: Stop
    description: What should we stop doing?
  - title: Continue
    description: What works and should stay?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Review actions from last time
    minutes: 5
  - title: Write cards
    minutes: 8
    activity: write
  - title: Group similar cards
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss top topics
    minutes: 24
    activity: discuss
  - title: Agree action items
    minutes: 10
    activity: actions
`,
  `
id: mad-sad-glad
name: Mad / Sad / Glad
type: retro
description: A team health check on feelings.
columns:
  - title: Mad
    description: What frustrated you?
  - title: Sad
    description: What disappointed you?
  - title: Glad
    description: What made you happy?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Review actions from last time
    minutes: 5
  - title: Write cards
    minutes: 8
    activity: write
  - title: Group similar cards
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss top topics
    minutes: 24
    activity: discuss
  - title: Agree action items
    minutes: 10
    activity: actions
`,
  `
id: liked-learned-lacked
name: Liked / Learned / Lacked
type: retro
description: Good for project or milestone summaries.
columns:
  - title: Liked
    description: What did you enjoy?
  - title: Learned
    description: What did you learn?
  - title: Lacked
    description: What was missing?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Review actions from last time
    minutes: 5
  - title: Write cards
    minutes: 8
    activity: write
  - title: Group similar cards
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss top topics
    minutes: 24
    activity: discuss
  - title: Agree action items
    minutes: 10
    activity: actions
`,
  `
id: 4ls
name: 4Ls
type: retro
description: Liked, Learned, Lacked, Longed for.
columns:
  - title: Liked
  - title: Learned
  - title: Lacked
  - title: Longed for
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Review actions from last time
    minutes: 5
  - title: Write cards
    minutes: 8
    activity: write
  - title: Group similar cards
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss top topics
    minutes: 24
    activity: discuss
  - title: Agree action items
    minutes: 10
    activity: actions
`,
  `
id: sailboat
name: Sailboat
type: retro
description: What pushes us forward, holds us back, and lies ahead.
columns:
  - title: Wind
    description: What helps us move?
  - title: Anchors
    description: What slows us down?
  - title: Rocks
    description: What risks lie ahead?
  - title: Island
    description: Where do we want to be?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Review actions from last time
    minutes: 5
  - title: Write cards
    minutes: 8
    activity: write
  - title: Group similar cards
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss top topics
    minutes: 24
    activity: discuss
  - title: Agree action items
    minutes: 10
    activity: actions
`,
  `
id: well-improve-ideas
name: Went well / To improve / Ideas
type: retro
description: The classic three-column retro.
columns:
  - title: Went well
  - title: To improve
  - title: Ideas
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Review actions from last time
    minutes: 5
  - title: Write cards
    minutes: 8
    activity: write
  - title: Group similar cards
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss top topics
    minutes: 24
    activity: discuss
  - title: Agree action items
    minutes: 10
    activity: actions
`,
  `
id: blank-retro
name: Blank board
type: retro
description: Start empty and add your own columns.
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Review actions from last time
    minutes: 5
  - title: Write cards
    minutes: 8
    activity: write
  - title: Group similar cards
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss top topics
    minutes: 24
    activity: discuss
  - title: Agree action items
    minutes: 10
    activity: actions
`,
  `
id: standup
name: Daily stand-up
type: standup
description: Round of updates with blockers captured as actions.
agenda:
  - title: "Round: yesterday, today, blockers"
    minutes: 10
    activity: round
    owner: Everyone
  - title: Blockers and follow-ups
    minutes: 5
`,
  `
id: planning
name: Sprint planning
type: planning
description: Goal, capacity, and scope with decisions logged.
agenda:
  - title: Review open actions
    minutes: 5
  - title: Sprint goal
    minutes: 10
  - title: Capacity and absences
    minutes: 5
  - title: Backlog walkthrough and commitment
    minutes: 40
`,
  `
id: one-on-one
name: 1:1
type: one_on_one
description: Running agenda for a manager and report.
agenda:
  - title: How are things?
    minutes: 5
    notes: |
      Energy and workload. Anything on your mind?
  - title: Topics from report
    minutes: 15
  - title: Topics from manager
    minutes: 5
  - title: Follow-ups
    minutes: 5
`,
  `
id: general
name: General meeting
type: general
description: Agenda with time-boxes, notes, decisions and actions.
agenda:
  - title: Review open actions
    minutes: 5
  - title: Topic 1
    minutes: 15
  - title: AOB
    minutes: 5
`,
  `
id: brainstorm
name: Brainstorm
type: general
description: Collect and vote on ideas, then decide.
columns:
  - title: Ideas
    description: Add one idea per card
  - title: Questions
agenda:
  - title: Frame the problem
    minutes: 5
  - title: Collect ideas
    minutes: 10
    activity: write
  - title: Group ideas
    minutes: 5
    activity: group
  - title: Vote
    minutes: 3
    activity: vote
  - title: Decide
    minutes: 12
    activity: discuss
`,
];
