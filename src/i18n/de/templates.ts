// German versions of the templates that come with Rondel (same order, ids and structure as src/templates/builtin.ts),
// in the same YAML format people use for their own. See src/lib/templates.ts for every field.

export const TEMPLATES_DE: string[] = [
  `
id: wins-challenges
name: Erfolge und Herausforderungen des Monats
type: retro
description: Wie am Whiteboard - alle posten ihre Notizen live und mit Namen.
title: Erfolge und Herausforderungen - {month}
columns:
  - title: Erfolge des Monats
    description: Was lief gut? Worauf sind Sie stolz?
  - title: Herausforderungen
    description: Was war schwierig? Was stand im Weg?
agenda:
  - title: Notizen an die Tafel schreiben
    minutes: 10
    activity: write
  - title: Tafel durchgehen
    minutes: 15
    activity: round
    notes: Alle lesen ihre Notizen vor.
  - title: Herausforderungen gruppieren
    minutes: 5
    activity: group
  - title: Über anzugehende Herausforderungen abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Herausforderungen besprechen
    minutes: 20
    activity: discuss
  - title: Aufgaben vereinbaren
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
description: Fokus auf konkrete Verhaltensänderungen.
columns:
  - title: Start
    description: Womit sollten wir anfangen?
  - title: Stop
    description: Womit sollten wir aufhören?
  - title: Continue
    description: Was funktioniert und sollte bleiben?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Aufgaben vom letzten Mal durchgehen
    minutes: 5
  - title: Karten schreiben
    minutes: 8
    activity: write
  - title: Ähnliche Karten gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Themen besprechen
    minutes: 24
    activity: discuss
  - title: Aufgaben vereinbaren
    minutes: 10
    activity: actions
`,
  `
id: mad-sad-glad
name: Mad / Sad / Glad
type: retro
description: Ein Stimmungsbild des Teams.
columns:
  - title: Mad
    description: Was hat Sie geärgert?
  - title: Sad
    description: Was hat Sie enttäuscht?
  - title: Glad
    description: Was hat Sie gefreut?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Aufgaben vom letzten Mal durchgehen
    minutes: 5
  - title: Karten schreiben
    minutes: 8
    activity: write
  - title: Ähnliche Karten gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Themen besprechen
    minutes: 24
    activity: discuss
  - title: Aufgaben vereinbaren
    minutes: 10
    activity: actions
`,
  `
id: liked-learned-lacked
name: Gefallen / Gelernt / Gefehlt
type: retro
description: Gut für Rückblicke auf Projekte oder Meilensteine.
columns:
  - title: Gefallen
    description: Was hat Ihnen gefallen?
  - title: Gelernt
    description: Was haben Sie gelernt?
  - title: Gefehlt
    description: Was hat gefehlt?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Aufgaben vom letzten Mal durchgehen
    minutes: 5
  - title: Karten schreiben
    minutes: 8
    activity: write
  - title: Ähnliche Karten gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Themen besprechen
    minutes: 24
    activity: discuss
  - title: Aufgaben vereinbaren
    minutes: 10
    activity: actions
`,
  `
id: 4ls
name: 4L
type: retro
description: Gefallen, Gelernt, Gefehlt, Gewünscht.
columns:
  - title: Gefallen
  - title: Gelernt
  - title: Gefehlt
  - title: Gewünscht
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Aufgaben vom letzten Mal durchgehen
    minutes: 5
  - title: Karten schreiben
    minutes: 8
    activity: write
  - title: Ähnliche Karten gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Themen besprechen
    minutes: 24
    activity: discuss
  - title: Aufgaben vereinbaren
    minutes: 10
    activity: actions
`,
  `
id: sailboat
name: Segelboot
type: retro
description: Was uns antreibt, was uns bremst und was vor uns liegt.
columns:
  - title: Wind
    description: Was bringt uns voran?
  - title: Anker
    description: Was bremst uns?
  - title: Felsen
    description: Welche Risiken liegen vor uns?
  - title: Insel
    description: Wo wollen wir hin?
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Aufgaben vom letzten Mal durchgehen
    minutes: 5
  - title: Karten schreiben
    minutes: 8
    activity: write
  - title: Ähnliche Karten gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Themen besprechen
    minutes: 24
    activity: discuss
  - title: Aufgaben vereinbaren
    minutes: 10
    activity: actions
`,
  `
id: well-improve-ideas
name: Lief gut / Zu verbessern / Ideen
type: retro
description: Die klassische Retro mit drei Spalten.
columns:
  - title: Lief gut
  - title: Zu verbessern
  - title: Ideen
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Aufgaben vom letzten Mal durchgehen
    minutes: 5
  - title: Karten schreiben
    minutes: 8
    activity: write
  - title: Ähnliche Karten gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Themen besprechen
    minutes: 24
    activity: discuss
  - title: Aufgaben vereinbaren
    minutes: 10
    activity: actions
`,
  `
id: blank-retro
name: Leeres Board
type: retro
description: Leer starten und eigene Spalten hinzufügen.
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Aufgaben vom letzten Mal durchgehen
    minutes: 5
  - title: Karten schreiben
    minutes: 8
    activity: write
  - title: Ähnliche Karten gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Wichtigste Themen besprechen
    minutes: 24
    activity: discuss
  - title: Aufgaben vereinbaren
    minutes: 10
    activity: actions
`,
  `
id: standup
name: Daily Stand-up
type: standup
description: Kurze Update-Runde, Hindernisse werden als Aufgaben festgehalten.
agenda:
  - title: "Runde: gestern, heute, Hindernisse"
    minutes: 10
    activity: round
    owner: Alle
  - title: Hindernisse und nächste Schritte
    minutes: 5
`,
  `
id: planning
name: Sprint-Planning
type: planning
description: Ziel, Kapazität und Umfang, Entscheidungen werden protokolliert.
agenda:
  - title: Offene Aufgaben durchgehen
    minutes: 5
  - title: Sprint-Ziel
    minutes: 10
  - title: Kapazität und Abwesenheiten
    minutes: 5
  - title: Backlog durchgehen und Commitment
    minutes: 40
`,
  `
id: one-on-one
name: 1:1
type: one_on_one
description: Fortlaufende Agenda für Führungskraft und Teammitglied.
agenda:
  - title: Wie läuft es?
    minutes: 5
    notes: |
      Energie und Arbeitslast. Beschäftigt Sie gerade etwas?
  - title: Themen des Teammitglieds
    minutes: 15
  - title: Themen der Führungskraft
    minutes: 5
  - title: Nächste Schritte
    minutes: 5
`,
  `
id: general
name: Allgemeines Meeting
type: general
description: Agenda mit Zeitfenstern, Notizen, Entscheidungen und Aufgaben.
agenda:
  - title: Offene Aufgaben durchgehen
    minutes: 5
  - title: Thema 1
    minutes: 15
  - title: Sonstiges
    minutes: 5
`,
  `
id: brainstorm
name: Brainstorming
type: general
description: Ideen sammeln, abstimmen und dann entscheiden.
columns:
  - title: Ideen
    description: Eine Idee pro Karte
  - title: Fragen
agenda:
  - title: Problem beschreiben
    minutes: 5
  - title: Ideen sammeln
    minutes: 10
    activity: write
  - title: Ideen gruppieren
    minutes: 5
    activity: group
  - title: Abstimmen
    minutes: 3
    activity: vote
  - title: Entscheiden
    minutes: 12
    activity: discuss
`,
];
