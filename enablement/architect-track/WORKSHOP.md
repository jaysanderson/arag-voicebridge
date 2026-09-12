# VoiceBridge architecture workshop

**Time:** 105 minutes. **Audience:** architects and technical leads evaluating or deploying
VoiceBridge for a customer. The product's hero capability is real-time listening (agent-assist,
§7) — sections 1–6 cover the turn-based foundation it's built on, so read them in order even if
agent-assist is what the customer actually asked about. Bring a running mock instance if you want
to check any claim below — every command is copy-pasteable and needs no credentials:

```bash
mkdir -p /tmp/voicebridge-workshop
ARAG_MOCK=1 ADMIN_TOKEN=workshop-token DATA_DIR=/tmp/voicebridge-workshop PORT=8099 node src/index.ts
```

---

## 1. Orientation — why voice is a different problem from chat (10 min)

VoiceBridge is one endpoint: `POST /api/v1/voice-answer`. Any voice platform whose agent can call
an HTTP tool can use it — the shipped demo happens to use ElevenLabs Conversational AI, but the
contract is generic. A voice agent calls the bridge as a **custom tool**, mid-conversation, and
the platform enforces its own timeout on that tool call. That single fact — a hard, externally
enforced deadline, on every single turn, with a human waiting on the other end of a phone call —
is what makes voice a fundamentally different integration problem from a chat UI, where a slow
response is merely a delayed answer instead of a broken conversation. Everything in this workshop
follows from that constraint.

Read `README.md`'s "How a turn works" diagram before continuing if you haven't already; this
workshop assumes you understand the nine-step pipeline shape at a high level (the developer track
covers it turn by turn — this workshop is about the decisions around it, not the code inside it).

---

## 2. The turn budget (15 min)

Three timeouts exist, at three different layers, and they nest:

| Variable | Default | Owned by | What happens at the deadline |
|---|---|---|---|
| `AGENT_TOOL_TIMEOUT_MS` | 8000 | The voice platform (configured on the agent's tool definition, **not** read by VoiceBridge itself) | The agent gives up waiting for the bridge and the caller hears dead air or a generic platform error |
| `VOICE_TURN_TIMEOUT_MS` | 6000 | VoiceBridge, per ARAG `/ask` call | The bridge gives up on ARAG and returns the prospect's `handoff_msg` instead |
| `ARAG_TIMEOUT_MS` | 60000 | The ARAG client's own default | Irrelevant to a voice turn — this is the platform default tuned for document-processing pipelines, and the voice turn always overrides it with the much tighter `VOICE_TURN_TIMEOUT_MS` |

The invariant that actually matters: **`VOICE_TURN_TIMEOUT_MS` must be strictly less than
`AGENT_TOOL_TIMEOUT_MS`.** `src/config.ts`'s `assertVoiceConfig` checks this once, at boot, and
refuses to start the server if it doesn't hold:

```
Error: VOICE_TURN_TIMEOUT_MS (9000) must be < AGENT_TOOL_TIMEOUT_MS (8000) so the bridge always
resolves a turn before the agent's tool call times out.
```

**Why this has to be a gap, not just an inequality.** If the two were equal, a turn that takes
exactly `VOICE_TURN_TIMEOUT_MS` to fail over (detect the ARAG timeout, build the handoff response,
serialise it, get it back over the network) could still lose the race against the agent platform's
own clock, which started ticking at the same moment. The gap between the two numbers is your
margin for: network latency bridge→agent, JSON serialisation, the bridge's own request-handling
overhead, and clock skew between the two systems. The shipped default gives you a 2-second margin
(6000 vs 8000). If you tighten `VOICE_TURN_TIMEOUT_MS` to squeeze more retries or fallback logic
into a turn, you are spending directly from that margin — model this explicitly rather than
tuning by feel.

**Why `VOICE_BRIEF_TIMEOUT_MS` (default 12000) is allowed to be so much longer.** The brief
(`POST /api/v1/brief`, the ambient "Listen" copilot) is not on the same clock — it updates a
sidebar the human is glancing at, not a spoken response the caller is waiting on. `src/services/
brief.ts`'s `runBrief` never throws; on any failure (including its own timeout) it returns `brief:
null`, and the UI simply keeps showing the previous brief rather than flashing an error
(`public/app.js`). A slow brief degrades to "stale," not to "broken conversation" — a materially
different failure mode, which is why it gets a materially looser budget.

**Discussion prompt:** a customer wants `VOICE_TURN_TIMEOUT_MS` raised to 7500 because their real
Knowledge Box is slow. `AGENT_TOOL_TIMEOUT_MS` is fixed at 8000 by their voice platform's plan
tier. What's your margin now, and what would you tell them?

---

## 3. Where grounding is enforced (15 min)

"Grounded" is not a property of the model's phrasing — it's enforced mechanically, in three
independent places, any one of which is sufficient on its own:

1. **The prompt contract.** The voice prompt (`src/services/voicePrompt.ts`) instructs the model
   to answer only from retrieved context and to reply with a fixed sentinel, `HANDOFF:`, when it
   cannot. `src/services/handoff.ts`'s `decideHandoff` checks for that sentinel as a plain string
   prefix — not a semantic judgement, a string comparison.
2. **The retrieval-count backstop.** Even if the model ignores the sentinel and answers fluently
   anyway, `decideHandoff` also hands off whenever ARAG's retrieval returned zero items
   (`reason: "no-retrieval"`). A confident-sounding answer with nothing behind it is treated as
   unsafe to speak, unconditionally — the model's own confidence is never trusted as a signal.
3. **The output guard.** After voice-shaping, `guardOutput` (`src/services/safety.ts`) checks the
   spoken text one more time for leaked URLs, citation markers or markdown — a last-line-of-defence
   check on what is about to actually be spoken, independent of how the answer was produced.

Two guards sit **before** any of this, at the input side: `guardInput`'s injection and
out-of-scope pattern checks run before the ARAG call is even built, and (as of the current
codebase) the same screening is applied to caller-supplied conversation history and Listen-mode
transcripts (`screenTurns`/`screenTranscript` in `src/services/safety.ts`) — both reach the model
as context on endpoints that are open by default, so a poisoned turn earlier in the conversation
is dropped rather than silently forwarded.

**Be explicit about what these guards are and are not.** The code comment on `safety.ts` says it
plainly: "deliberately lightweight, deterministic and logged — a demo-grade safety net, not a
content-moderation product." The regex patterns catch obvious phrasings; they are not a
classifier and will miss paraphrased attacks. This is a real, documented limitation, not an
oversight — it is the seam where a customer with a stricter compliance requirement plugs in a
real moderation service, and you should be able to say exactly what you'd add and where it slots
in (immediately after `guardInput`/before `buildAskRequest`, and/or after `shapeForVoice`/before
`guardOutput`) when a customer asks about it in a design review.

**Discussion prompt:** a customer asks "can the bot ever say something not in our knowledge base?"
Answer using the three-layer list above, not "no" — what's the honest, complete answer, including
what still depends on the prompt being deployed correctly (layer 1) versus what holds even if the
prompt is wrong or missing (layers 2 and 3)?

---

## 4. Multi-tenant routing (15 min)

VoiceBridge serves multiple prospects (brands/customers) from one process. Two collaborating
pieces make this work:

- **The prospect registry** (`src/services/registry.ts`) is a `Collection<ProspectRecord>` backed
  by `DATA_DIR/prospects.json`, with full admin CRUD (`POST`/`PUT`/`DELETE
  /api/v1/admin/prospects*`). Adding a prospect is a write to this store, not a deploy
  (`DECISIONS.md` V-02) — `config/prospects.example.json` only seeds it once, on first boot, when
  the store is empty.
- **The ARAG client pool** (`src/services/clientPool.ts`) keeps one `AragClient` per
  `kb_id|baseUrl` pair, not one client for the whole process (`DECISIONS.md` V-03) — because
  prospects can live in different Knowledge Boxes and even different zones. The pool is cleared
  (`clients.clear()`) on every registry write, so a `kb_id` edit takes effect on the very next
  turn rather than being cached indefinitely.

**The load-bearing constraint architects need to internalise:** `DATA_DIR` is a single JSON-file
store (`vendor/arag-platform/src/store/jsonstore.ts`) — the whole collection is loaded into an
in-memory `Map` at boot and the **entire file** is rewritten on every write (debounced 50ms). This
is explicitly documented in the store's own header comment as "good for MVP-scale state... the
interface is small so it can be swapped for Postgres/Redis at GA." Two consequences that belong in
every design review:

- **This is a single-writer store.** Two processes pointed at the same `DATA_DIR` will each hold
  their own in-memory copy and will race to overwrite each other's file on flush. The shipped
  `fly.toml` reflects this: `min_machines_running = 1`, and nothing in the deployment topology
  attempts to run more than one instance against the same volume. Horizontal scaling behind one
  `DATA_DIR` is not a supported configuration today.
- **A corrupted store file is silently reset to empty**, not repaired (`jsonstore.ts`: on a JSON
  parse failure the file is renamed to `<file>.json.corrupt-<timestamp>` and the collection starts
  empty). For `prospects.json`, the registry's own `seedFromFile` will then re-seed the *shipped
  example* prospects on the next boot — silently discarding **any prospect added via the admin API
  since the last successful boot**. This is a real operational risk worth surfacing explicitly in
  a go-live review (see `design-review-checklist.md`), not a hypothetical.

**Discussion prompt:** a customer wants three brands, each with its own Knowledge Box, run from
two Fly regions for latency. What does the client pool already give you for free, and what do you
now have to solve yourself regarding `DATA_DIR`? (Hint: two regions means two volumes, which means
two independent, non-synchronised prospect registries, unless you change the architecture.)

---

## 5. Stored search configurations vs. inline prompts (15 min)

`buildAskRequest` (`src/services/pipeline.ts`) makes a binary choice per prospect, per turn:

- **No `ask_config` set** → the *inline* path. The bridge builds the voice prompt itself
  (`buildVoicePrompt`) and sends `reranker`, `max_tokens`, `temperature` and (optionally)
  `generative_model` directly on the `/ask` request, read from the prospect's own record.
- **`ask_config` set** → the *stored-configuration* path. The request carries only
  `search_configuration: <name>` — and **nothing else inline**. The stored configuration inside
  the Knowledge Box owns the prompt, the retrieval filters, the reranker and the model. Look at
  `buildAskRequest` closely: the `ask_config` branch `return`s immediately, before the
  `reranker`/`max_tokens`/`temperature`/`generative_model` lines even run.

This has a sharp, easy-to-miss consequence for operators: **once a prospect has `ask_config` set,
editing its `reranker`, `max_tokens`, `temperature` or `generative_model` fields through the admin
API does nothing** — those fields are simply never read for that prospect's turns. The only way to
change behaviour is to re-provision the stored configuration (`POST
/api/v1/admin/prospects/{key}/provision`, which itself reads those same prospect fields to *build*
the new stored configuration — see `src/services/provision.ts`). A review that only checks "is the
prospect record correct" without checking "was the stored configuration actually re-provisioned
after the last edit" will miss configuration drift. This is exactly the kind of gap to catch
before a customer go-live.

**One more asymmetry worth knowing:** the live brief (`src/services/brief.ts`'s
`buildBriefRequest`) **never** uses a prospect's stored `ask_config` — it always builds its own
prompt and schema inline, every time, regardless of how the prospect's main turn path is
configured. A customer who has carefully governed their main answer path via a stored
configuration (language filters, a public security group) has not automatically extended the same
governance to the brief's retrieval — check this explicitly if the brief pane is in scope for a
deployment.

**Trade-off summary for a design review:**

| | Inline | Stored configuration |
|---|---|---|
| Where governance lives | In the prompt string built by the bridge, redeployed with the code | In the Knowledge Box, provisioned by an explicit step |
| Retrieval filters (language, security groups) | Not expressed at all | `filter_expression`, `security.groups` |
| Change velocity | Instant — edit the prospect record | Requires re-running provision |
| Drift risk | Low (one source of truth: the prospect record) | High if re-provisioning is forgotten after an edit |
| Best for | Fast-moving demos, prospects without governance requirements | Production customers with retrieval governance or security-group requirements |

---

## 6. Failure modes and degradation (10 min)

Every failure path in the turn pipeline ends in the same shape of response — `200 OK`,
`handoff: true`, a spoken `handoff_msg`, a `handoff_reason` for diagnosis — never a 5xx, never a
hang. The reasons, in the order a turn can hit them:

| `handoff_reason` | Trigger | Reached ARAG? |
|---|---|---|
| `empty-question` / `question-too-long` / `prompt-injection` / `unsafe-request` | Input guard trip | No |
| `sentinel` | Model returned the `HANDOFF:` prefix | Yes |
| `not-found-phrase` | Model's own stock refusal, prompt not applied | Yes |
| `empty-answer` | ARAG returned no text at all | Yes |
| `no-retrieval` | ARAG returned text but zero retrieved items | Yes |
| `upstream-error` | The ARAG call itself threw — timeout, network, protocol | Attempted, failed |
| `empty-output` / `unspeakable-content` | Output guard trip after shaping | Yes |

Two failure modes sit **outside** this per-turn table and matter just as much for a deployment:

- **Boot-time refusal** — `assertVoiceConfig` (§2) and, in production, a missing `ADMIN_TOKEN`.
  These fail the deployment before it ever serves traffic, which is the right place for a
  configuration error to surface.
- **Store-file corruption** (§4) — silently resets to empty rather than failing loudly. This is
  the one failure mode in the whole system that does *not* announce itself; it only shows up as
  "why did my prospects disappear," which is exactly why it belongs on a go-live checklist rather
  than being left to be discovered in production.

---

## 7. Designing for agent-assist (15 min)

Everything so far has been one request, one response. Agent-assist (`src/services/listen.ts`,
`src/routes/listen.ts`) is a **long-lived session**: a human agent (or a telephony bridge on their
behalf) opens one, keeps appending transcript for the length of a live call — minutes, sometimes
tens of minutes — and one or more viewers watch the brief evolve over `GET .../events` (SSE). That
"long-lived" property is the whole architectural difference from a turn, and it's where most of
the surprises live.

**Sessions per agent.** The product's own model is one session per live call: the console opens
exactly one on "Play sample conversation" or the first typed/pasted chunk, and ends it when the
call ends. A contact-centre deployment scales this directly — N agents on N simultaneous calls is
N concurrently open sessions, each with its own SSE subscriber (the agent's own screen, and
possibly a supervisor's). Nothing in the product enforces "one session per agent" as a rule; it's
a convention the calling application has to keep. A caller that opens a fresh session per *turn*
instead of per *call* would defeat the entire point — the evolving brief and the accumulated
citations exist specifically because the session persists across many appends.

**Refresh cost per minute — not a flat rate.** `DEFAULT_THROTTLE.minGapMs` (1500 ms) is a
**ceiling**, not a target: at most 40 refreshes/minute/session, reachable only by unnaturally
bursty input (rapid re-paste, an aggressive STT chunker). Natural speech at ~130–150 words/minute
takes 10–15 seconds to produce a fresh, sufficiently-different 28-word window
(`DEFAULT_THROTTLE.windowWords`), so a real conversation realistically produces on the order of
4–6 refreshes/minute/session once the Jaccard similarity check (`jaccardMax: 0.85`) is doing its
job — budget against that steady-state figure, not the ceiling, but design your alerting around
the ceiling (a session refreshing near 40/min for any length of time means either a client bug
re-sending the same content as "new," or a misbehaving STT integration). The other half of the
cost model that is easy to miss: `transcriptText()` sends the **whole running transcript so far**
(up to `MAX_TRANSCRIPT_CHARS`, 20,000 characters) on every single refresh, not just the new window
— so refresh 40 of a long call costs materially more input tokens than refresh 2 of the same call,
even though `max_tokens` (600, `buildBriefRequest`) bounds the output side at a constant. Size a
customer's cost estimate off their *longest* expected call, not their average one.

**SSE connection budget.** `GET /api/v1/listen/sessions/{id}/events` is registered with
`noRateLimit: true` — deliberately, since a legitimate viewer reconnecting after a network blip
should never be throttled. The consequence: **nothing in the product limits how many SSE
connections can be open at once**, to one session or across all of them. An open SSE stream is a
request that never resolves for as long as the viewer is watching, and Fly's own admission control
(`fly.toml`'s `[http_service.concurrency]`, soft 40 / hard 60 — see `sizing-deployment.md`) counts
it exactly like any other in-flight request. A supervisor dashboard that opens one SSE connection
per active agent, on top of the agents' own consoles each holding a second connection to the same
sessions, consumes that same 40/60 budget that ordinary `voice-answer` turns need — and unlike a
turn, an SSE connection doesn't free its slot when the "work" is done, only when the viewer
disconnects or the session ends.

**What breaks with many concurrent sessions.** Two independent limits, and a customer can hit
either without hitting the other:

1. **Request concurrency**, from SSE connections plus normal traffic sharing the same
   `soft_limit`/`hard_limit` — the symptom is turns and appends starting to queue or get rejected
   under Fly's admission control while CPU and memory both look fine, because the constraint is
   held-open connections, not compute (§ "Concurrency and memory per machine" in
   `sizing-deployment.md`).
2. **The `listen-sessions` collection cap (200, `ListenService`'s `cap` option, `DATA_DIR/
   listen-sessions.json`).** Read `Collection.put` in `vendor/arag-platform/src/store/
   jsonstore.ts` closely: once the collection holds more than the cap, it evicts the
   **oldest-by-`createdAt`** record — with no distinction between `"live"` and `"ended"`. Ended
   sessions accumulate in the same collection (they are kept for the admin brief-history view, not
   deleted), so on a busy day the 200 slots fill with call history long before 200 calls are ever
   concurrently live. Once the collection is full, the next session created evicts the single
   oldest record in it — and if that happens to be a long-running call that started before 200
   newer sessions were created, **a still-live session is silently deleted out from under an agent
   who is actively on that call.** Its next transcript append throws `ListenSessionNotFound` (a
   404), which the API surfaces correctly — but "a session that was working stopped working with
   no warning, mid-call" is a bad way for an operator to discover a capacity limit. This is a real
   gap, not a hypothetical: raising the cap (`ListenService`'s `cap` constructor option, not
   currently wired to an env variable) is the honest fix for a deployment expecting more than ~200
   sessions' worth of combined live-plus-recent-history at once, and it belongs on the go-live
   checklist for any customer running agent-assist at meaningful volume.

**Retention of conversation content.** A listen session **is** the retained content — the full
transcript (up to 400 entries, `MAX_TRANSCRIPT_ENTRIES`), up to 20 versions of the evolving brief
(`MAX_BRIEF_HISTORY`, each a full structured snapshot), and the accumulated citations, all sitting
in `DATA_DIR/listen-sessions.json` for as long as the cap keeps them around. This is a materially
larger retention footprint than the turn log (§ "Data retention" idea from the turn-log
discussion above, which keeps only up to 500 characters of one question per turn):
`screenTranscript` (`src/services/safety.ts`) screens transcript chunks for the same
injection/out-of-scope patterns as any other input, but it does not redact anything — a real
customer's full conversation, verbatim, is what gets stored. And unlike the admin-only turn log,
`GET /api/v1/listen/sessions/{id}` and `GET /api/v1/listen/sessions` are both `auth: "api"`
(public) routes: if `API_KEYS` is unset, **anyone who can reach the host can read any session's
full transcript and brief by id, and list recent sessions across every prospect on the
deployment**, with no notion of "which agent owns this call." Treat "who may read a session" as
its own line item in a go-live review, separate from the turn-log question it superficially
resembles.

**Discussion prompt:** a customer wants a supervisor view that shows all agents' live briefs on
one screen, refreshed continuously. Using the two limits above, what is the actual ceiling on how
many agents that one dashboard can watch at once on the shipped `shared-cpu-1x` machine, and which
limit do you expect to bite first — request concurrency, or the 200-session cap?

---

## 8. Exercise — design the deployment (10 min)

A customer wants VoiceBridge for two brands: `northwind` (health insurance member support, must
answer from a Knowledge Box governed by a language filter and a `members` security group) and
`tangerine` (telco support, no special governance). They expect low call volumes today (under 50
concurrent calls) but want the design to survive being right about growth. In groups of 2–3,
answer:

1. Which prospect uses a stored search configuration, and why? Would you provision it before or
   after the golden set is written, and why does the order matter?
2. Given §4, can this run as two machines behind a load balancer today, sharing one `DATA_DIR`?
   If not, what is the smallest change that would let it (without necessarily reaching for
   Postgres)? What do you lose in that smallest-change version compared to a real migration?
3. `northwind`'s golden set must gate any change to its prompt or its stored configuration before
   it reaches production. Where does that gate live today (`scripts/eval.ts`,
   `POST /api/v1/golden-evals`), and how would you wire it into this customer's CI, given the
   product ships no built-in CI integration beyond the exit code?
4. Using `sizing-deployment.md`'s latency and cost breakdown, estimate whether a single
   `shared-cpu-1x` / 512 MB machine (the shipped default) is enough for 50 concurrent calls, or
   whether you need to size up — show your reasoning, not just a number.
5. Both brands want agent-assist available to every agent on every call, plus one supervisor
   dashboard per brand watching all of that brand's live sessions at once. Using §7, at what point
   (in agents, not calls) does the 200-session cap start to matter for a brand running at your
   projected volume, and at what point does SSE connection count start competing with the same
   `40`/`60` request-concurrency budget `voice-answer` turns need? Which limit would you expect a
   real customer to hit first, and what would you tell them to change?

There is no single correct answer to (2) — the point of the exercise is to notice the constraint
exists at all before a customer's growth surfaces it as an incident.
