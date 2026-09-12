# Overview

VoiceBridge listens to a live conversation and keeps one evolving, cited brief in front of whoever
is handling it — who the other person is, what they want, and what to say next — grounded in
Progress Agentic RAG (ARAG) rather than a model's general knowledge or memory. It exists because a
person on a live call needs to know what's true right now, not after the call: VoiceBridge is the
layer that listens as the conversation moves, keeps the brief current, and traces everything
factual in it back to retrieved content. The same grounding is also available as a follow-on,
answering a caller directly when nobody's available, and handing off to a human by a fixed rule
rather than a judgement call when the knowledge base can't support an answer.

## What it is

A small, API-first service built around one capability that matters most: a **listen session**.
`POST /api/v1/listen/sessions` opens one for a prospect; conversation is appended to it as it
happens, from any source — a realtime speech-to-text stream, a telephony webhook, a meeting bot, or
someone typing — and the evolving brief is read back over Server-Sent Events or by polling. Nothing
about the session API assumes a particular voice platform or transcription vendor.

Alongside the listening path, VoiceBridge ships:

- A **demo console** that opens on the Listen tab: press **Play sample conversation** to watch a
  scripted discovery call build a live brief with no credentials at all, paste or type your own
  conversation, or (with an ElevenLabs key configured) listen to a real microphone feed. The same
  console also has an Ask tab for the deflection pipeline as a text turn, a Call tab for a real voice
  round-trip, and a Golden set tab for the deflection quality gate.
- An **admin panel** for managing the prospects (customers/demo targets) a deployment serves,
  reviewing recent listen sessions and how their briefs evolved, testing each prospect's Knowledge
  Box connection, and reviewing the turn log and golden-set history for the deflection path.
- A **golden-set gate** for the deflection follow-on: a per-prospect set of test questions that runs
  through the exact same pipeline the live agent uses, so "this prospect is ready to answer on its
  own" is a pass/fail fact rather than a feeling.

## What makes a brief — or an answer — trustworthy

Three things, all visible rather than asserted:

1. **Grounding.** The brief's factual fields (key points, suggested answers, recommended products)
   are drawn only from retrieved content, and the schema is written so the model leaves a field
   empty rather than invent something to fill it. The deflection pipeline applies the same
   discipline to a spoken answer, with a fixed phrase the model uses explicitly when the retrieved
   content doesn't cover the question.
2. **Citations.** Every brief and every substantive deflection answer carries the sources it drew
   on. They are never spoken — you cannot usefully say a URL out loud — but they are always
   available as data: chips in the console, and the full accumulated list in the admin panel.
3. **A clean handoff, or an honest "not yet".** When a refresh finds nothing usable, the brief simply
   stays as it was rather than flashing something invented. When the deflection pipeline can't
   answer, the caller hears the prospect's own configured handoff line rather than a guess, an
   apology-shaped non-answer, or dead air — including when the upstream knowledge base is slow or
   erroring, since VoiceBridge always resolves within the voice agent's own tool timeout.

## What makes it repeatable across customers/prospects

Everything that differs between one deployment target and the next — which Knowledge Box, which
voice, which greeting, which handoff line, which test questions — lives in one registry entry, not
in code. Adding a new one is an admin API call (or a few clicks in the admin panel), not a
redeploy: see [`walkthrough-admin.md`](walkthrough-admin.md) for what that looks like in practice
and [`../developer/extension-points.md`](../developer/extension-points.md) for the full onboarding
ritual.

## Where to go next

- [`when-to-use.md`](when-to-use.md) — the shape of problem this fits, and where it doesn't.
- [`walkthrough-demo.md`](walkthrough-demo.md) — a click-by-click tour of the console.
- [`walkthrough-admin.md`](walkthrough-admin.md) — a click-by-click tour of the admin panel,
  including reviewing listen sessions and onboarding a new prospect.
- [`faq.md`](faq.md) — the questions this document doesn't already answer.
- [`../architecture/architecture.md`](../architecture/architecture.md) — how it actually works,
  for a technical audience.
