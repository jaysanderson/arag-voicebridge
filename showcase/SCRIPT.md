# VoiceBridge showcase — narrated script

Target running time: **2:50**. Recorded by `showcase/record.spec.ts` against the mock ARAG
(`ARAG_MOCK=1`, prospect `progress`) — no credentials required. Screen is the demo console
(`/`) and the admin panel (`/admin/`) at 1280×800. Timestamps are approximate; the spec paces
itself off real UI state, not the clock.

---

## 00:00–00:14 — The problem

**On screen:** the console loads on the **Ask** tab. The Progress prospect is already selected;
its greeting line is visible under the prospect picker.

**Voice-over:**
> "A voice agent that can say anything will eventually say something wrong. A fabricated price,
> a made-up return policy, an invented safety claim — that's worse than no agent at all.
> VoiceBridge sits between a voice agent and its Knowledge Box, so every spoken answer is either
> grounded and cited, or handed off — never guessed."

**Screenshot:** `01-console-loaded.png`

---

## 00:14–00:45 — A grounded, cited, speakable answer

**On screen:** type "Tell me about the Desktop Metal PureSinter furnace." into the Ask box and
press **Ask**. The "What just happened" pipeline steps light up green in order (input guard →
ARAG ask → handoff check → voice shaping → citations → output guard). The answer bubble appears
with a citation chip and an "answered" badge; the latency strip (retrieve / first token / total)
fills in on the right.

**Voice-over:**
> "Ask it something the knowledge base actually covers. The answer comes back shaped for
> text-to-speech — three sentences, no markdown, no URLs — grounded in a real document, with the
> citation shown on screen but never read aloud. Every step of the pipeline is visible, and so is
> the latency: retrieval, first token, and total, on every single turn."

**Screenshots:** `02-ask-typed.png`, `03-grounded-answer.png`, `04-citations-latency.png`

---

## 00:45–01:05 — Out of scope: a deterministic handoff, not a guess

**On screen:** type "What is the capital of France?" and press **Ask**. The pipeline shows the
handoff check tripping; the answer bubble shows a "handoff" badge and the prospect's handoff
line ("...specialist...").

**Voice-over:**
> "Now ask something the knowledge base has nothing on. VoiceBridge doesn't improvise — an empty
> retrieval or an out-of-scope question is a string check, not a judgement call, and the agent
> hands off cleanly instead of inventing an answer."

**Screenshot:** `05-handoff.png`

---

## 01:05–01:35 — The demo gate: the golden set, live

**On screen:** switch to the **Golden set** tab — the gate reads "not run" and the table is
empty. Press **Run golden set**. Against the mock corpus the whole run completes in single-digit
milliseconds per question, so the timeline and table appear essentially fully populated the
instant it finishes: the chip flips straight to **"gate open"** and the summary reads
"10/10 passed".

**Voice-over:**
> "This is the gate every prospect has to clear before it goes live: ten golden questions, run
> through the exact same pipeline, right now. Seven should answer with a citation, three should
> hand off. All ten pass, so the gate opens."

**Screenshots:** `06-golden-not-run.png`, `07-golden-gate-open.png`

---

## 01:35–01:48 — Into the admin panel

**On screen:** navigate to **/admin/**, enter the admin token and sign in. The panel loads on
the Overview tab.

**Voice-over:**
> "Everything so far only ever touched the public API. Behind that is an admin panel for the
> people running the deployment."

**Screenshot:** `08-admin-signin.png`

---

## 01:48–02:05 — Test a Knowledge Box connection

**On screen:** on the Overview tab, press **Test connections**. The health table fills in with
all three prospects, each showing "connected" and a resource count.

**Voice-over:**
> "Every prospect maps to its own Knowledge Box. A live health check confirms each one is
> reachable — no waiting for a support ticket to find out a connection is down."

**Screenshot:** `09-kb-health.png`

---

## 02:05–02:30 — Add a prospect, no redeploy

**On screen:** switch to the **Prospects** tab, press **New**, fill in the key `showcase-acme`
and a configuration JSON, and press **Save**. The new row appears in the registry table. Press
**Provision search config**; the result panel shows the generated search-configuration name and
the registry row updates to show it stored.

**Voice-over:**
> "Onboarding a new prospect is an API call, not a deployment. Save its configuration, provision
> its stored ARAG search configuration, and it's live — with its own Knowledge Box, its own
> voice, and its own golden set."

**Screenshots:** `10-new-prospect.png`, `11-provisioned.png`

---

## 02:30–02:50 — The turn log: a guard trip, redacted

**On screen:** switch to the **Turn log** tab and press **Reload**. The table shows the two
turns from the Ask tab earlier (one answered, one handoff) plus a third turn from a
prompt-injection attempt sent moments earlier — its result column reads "guard · prompt-
injection" and its question column reads "redacted (guard trip)" instead of the actual text.

**Voice-over:**
> "Every turn is logged for review — except the ones that trip the input guard. An injection
> attempt is recorded as a reason, never as text, so the log itself can't leak what someone tried
> to make the agent say."

**Screenshot:** `12-turn-log-redacted.png`

---

## 02:50–03:00 — Close

**On screen:** open the **Configuration** tab briefly, showing the effective configuration with
secrets redacted, then settle on the console's metrics footer.

**Voice-over:**
> "One HTTP endpoint. Zero runtime dependencies. Apache-2.0. And everything you just watched ran
> with no credentials at all."

**Screenshot:** `13-closing.png`
