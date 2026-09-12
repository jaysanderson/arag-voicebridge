# Overview

VoiceBridge connects a voice agent to Progress Agentic RAG (ARAG) so that a spoken conversation can
be answered from a governed knowledge base rather than a model's general knowledge. It exists
because a voice agent that can say anything will eventually say something wrong — VoiceBridge is
the layer that makes sure every spoken answer traces back to retrieved content, that anything the
knowledge base cannot support is handed to a human by a fixed rule rather than a judgement call,
and that every turn is measured.

## What it is

A small, API-first service with one endpoint that matters: `POST /api/v1/voice-answer`. Any voice
platform whose agent can call an HTTP tool can use it — the shipped demo happens to use ElevenLabs
Conversational AI, but nothing about the contract is ElevenLabs-specific (see
[`../developer/extension-points.md`](../developer/extension-points.md)). Given a question and a
little conversation history, it returns a spoken-shaped answer, the sources it drew on, a flag
saying whether the turn must escalate to a person, and a latency breakdown.

Alongside the voice path, VoiceBridge ships:

- A **demo console** for trying the whole thing with no phone call involved — type a question and
  see exactly what the agent would say, click through to a real voice call once credentials are
  configured, or watch an ambient copilot build a live brief while it listens.
- An **admin panel** for managing the prospects (customers/demo targets) a deployment serves,
  testing each one's Knowledge Box connection, and reviewing the turn log and golden-set history.
- A **golden-set gate**: a per-prospect set of test questions that runs through the exact same
  pipeline the live agent uses, so "this prospect is ready to demo" is a pass/fail fact rather than
  a feeling.

## What makes an answer trustworthy

Three things, all visible rather than asserted:

1. **Grounding.** The model is instructed to answer only from retrieved content and to say so
   explicitly, with a fixed phrase, when the retrieved content does not cover the question. The
   bridge detects that phrase deterministically and treats it as a handoff — this is a contract
   between the prompt and the code, not a heuristic guess at whether an answer "sounds confident."
2. **Citations.** Every substantive answer carries the sources it drew on. They are never spoken —
   you cannot usefully say a URL out loud — but they are always available as data, shown as chips
   in the console and in the admin turn log.
3. **A clean handoff.** When the knowledge base cannot answer, the caller hears the prospect's own
   configured handoff line, not a guess, an apology-shaped non-answer, or dead air. The same applies
   when the upstream knowledge base is slow or erroring — VoiceBridge always resolves within the
   voice agent's own tool timeout.

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
  including onboarding a new prospect.
- [`faq.md`](faq.md) — the questions this document doesn't already answer.
- [`../architecture/architecture.md`](../architecture/architecture.md) — how it actually works,
  for a technical audience.
