# Developer track — knowledge check

29 questions, about 25 minutes. Try answering before you look — several are judgement calls, not
recall, and the "why" matters more than the label.

---

**1. Recall.** Name the nine conceptual steps of a turn, in order, as documented at the top of
`src/services/pipeline.ts`.

> Resolve prospect, input safety guard, build the ARAG request, call ARAG, shape the answer for
> voice, extract citations, deterministic handoff decision, output safety guard, return + record
> metrics. (The *actual* code computes citations right after the ARAG call, before the handoff
> check — see Q2 for why.)

---

**2. Judgement.** The comment header lists "shape the answer" (step 5) before "extract citations"
(step 6) before "handoff decision" (step 7). But in `runTurn`, citations are computed immediately
after the ARAG call — before the handoff check runs, and shaping only happens afterwards. Why?

> `decideHandoff` needs the retrieval **count**, not just the answer text — an answer with zero
> retrieved items is treated as ungrounded and forced to hand off regardless of how confident the
> model sounds (`no-retrieval` reason in `src/services/handoff.ts`). That count comes from the
> same retrieval object citations are flattened from, so it's read once, early. Shaping is skipped
> entirely on a handoff, because the spoken line is the prospect's own fixed `handoff_msg`, not
> anything ARAG produced — there is nothing to shape.

---

**3. Judgement.** A turn comes back from ARAG with a fluent, confident-sounding paragraph, but the
retrieval object is empty (nothing was actually found in the Knowledge Box). What does VoiceBridge
do, and why is that not left to the model to decide?

> It hands off (`reason: "no-retrieval"`), regardless of how the answer reads. `decideHandoff` in
> `src/services/handoff.ts` treats zero retrieved items as proof the answer is ungrounded, full
> stop — the model's own confidence is not evidence of correctness, and a fluent hallucination is
> exactly the failure mode a voice product cannot afford to gamble on, since the caller only hears
> the words, never the retrieval panel. This is belt-and-braces on top of the prompt's own
> `HANDOFF:` sentinel, specifically so a prompt that fails to produce the sentinel (a stored
> configuration that omits it, a model that ignores instructions) still degrades safely.

---

**4. Recall.** What is the `HANDOFF:` sentinel, and where does the contract for it live?

> A fixed string prefix the voice prompt is instructed to begin its reply with when the retrieved
> context cannot answer the question. `src/services/handoff.ts`'s `decideHandoff` checks for it as
> a case-insensitive prefix. It is a **contract** between the prompt and the bridge
> (`DECISIONS.md` V-04) — deliberately a deterministic string check rather than a judgement call,
> so the pipeline never has to decide whether an answer is "good enough" and the behaviour is
> reproducible in the golden set.

---

**5. Judgement.** Why is the handoff decision a string-prefix check rather than, say, a second LLM
call asking "was this answer actually grounded"?

> Determinism and debuggability. A second model call would itself be fallible, slower, and would
> reintroduce exactly the judgement-call problem the sentinel exists to avoid — now you'd need to
> trust a model to correctly judge another model's groundedness. A string check is instant, free,
> and its behaviour on a given input is always the same, which is what makes the golden set a
> meaningful, repeatable gate rather than a probabilistic sample.

---

**6. Recall.** Citations are returned in every successful response, but the voice-answer prompt
explicitly tells the model never to include citation markers in the spoken text. Why return them
at all?

> They are UI data, never spoken — shown as source chips in the workspace and available to the agent
> platform for on-screen display, but stripped from anything text-to-speech will read
> (`src/services/voiceShape.ts`'s `stripCitationMarkers`, and `guardOutput`'s
> `hasSpeakableViolation` as a backstop). A citation marker like `[1]` read aloud mid-sentence is
> nonsensical to a caller; the same citation shown as a chip on a screen is useful provenance.

---

**7. Judgement.** You trip the input guard with a prompt-injection attempt and then check the turn
log. The record has no `question` field at all — not an empty string, the key is absent. A normal
successful turn's record does carry `question`. What decided this, and where?

> `src/routes/voice.ts`'s `handleTurn`: `question: guardTrip ? undefined : body.question.slice(0,
> 500)`. `undefined` fields are dropped at serialisation, so the text is never written to the
> store at all — not stored-then-hidden, never stored. This is `DECISIONS.md` V-08: an unsafe
> input is exactly the text you don't want retained and re-displayed in an admin panel later. The
> decision is made once, in the route, at write time, rather than left to whichever admin screen
> is built later to remember to redact it.

---

**8. Recall.** What does `ARAG_MOCK=1` actually start, and what does it seed?

> `startMockArag` boots a second, private in-process HTTP server that behaves like a real ARAG
> Knowledge Box, seeded with the 8 documents in `src/services/seed.ts` (short, original notes
> about metal additive manufacturing — binder jetting, sintering furnaces, Formlabs, 3D Systems).
> Every prospect's `AragClient`, regardless of its own configured `kb_id`, is routed to this same
> mock instance by `AragClientPool` (`src/services/clientPool.ts`) while the flag is set.

---

**9. Judgement.** The shipped `tangerine` and `northwind` prospects' own golden sets **fail** when
run against `ARAG_MOCK=1` (try `BASE_URL=... node scripts/eval.ts tangerine`). Is this a bug? What
does it mean for a prospect you create yourself for practice?

> Not a bug. Those golden sets are written for their real, telco/health Knowledge Boxes; the mock
> always serves the same additive-manufacturing corpus to every prospect regardless of `kb_id`
> (Q8). Only `progress`'s golden set is written to match the mock's actual content. Any prospect
> you create for hands-on practice under the mock must ask questions the *mock's* corpus can
> answer, not questions about whatever the prospect notionally sells — otherwise every "answer"
> question fails for a reason that has nothing to do with your configuration.

---

**10. Recall.** What is the difference between the "inline" and "stored configuration" paths when
`buildAskRequest` constructs an ARAG request?

> If the prospect has an `ask_config` set, the request carries only `search_configuration: <name>`
> — the stored configuration in the Knowledge Box owns the prompt, filters, reranker and models,
> and nothing else is sent inline. Otherwise, the bridge builds the voice prompt inline
> (`buildVoicePrompt`) and sends `reranker`, `max_tokens`, `temperature` and (optionally)
> `generative_model` directly on the request. `src/services/provision.ts`'s
> `buildSearchConfiguration` is what writes the stored-configuration version of the same prompt
> into the Knowledge Box for prospects that use that path.

---

**11. Judgement.** `guardInput`'s `OUT_OF_SCOPE_PATTERNS` and `INJECTION_PATTERNS` are a blocklist
of specific, narrow regular expressions, not a whitelist of "approved" question shapes. Why is
that the right trade-off here?

> A whitelist would have to anticipate every legitimate way a caller might phrase every legitimate
> support question across every locale before the product could ship a new prospect, and would
> still wrongly block real questions on day one. A narrow blocklist catches specific, known-bad
> shapes cheaply and deterministically and lets everything else through to ARAG, where
> `decideHandoff` is the real arbiter of whether a given question can actually be answered. The
> guard's job is triage, not judgement.

---

**12. Recall.** What happens, end to end, when the ARAG client call itself throws — a timeout, a
network error, a protocol error?

> `runTurn`'s `try/catch` around the `ask()` call logs `arag.fail` (with `kind` and `message` from
> the error, never the caller's question) and returns the prospect's `handoff_msg` with
> `handoff_reason: "upstream-error"` — the same shape of response as a content-driven handoff, so
> the caller hears a natural line, not silence or a raw error. This is the mechanism behind "never
> dead air."

---

**13. Judgement.** `make check` runs `make lint` (biome, whole repo) then `make typecheck` then
`make coverage`. On a shared checkout with other work in flight, `make lint` can fail for a file
you never touched. Why doesn't that mean your own change is wrong, and what should you check
instead?

> Biome's `check` scans every file in the repository by default, not just your diff, so a
> formatting issue anywhere else in an actively-developed repo shows up as a `make check` failure
> regardless of what you changed. Run `make lint`/`make typecheck` narrowly, if your editor
> doesn't already flag it, and specifically check your own file's diff is clean; don't treat an
> unrelated pre-existing failure elsewhere as evidence your change broke something.

---

**14. Recall.** Why does `checkTurn` (the per-question golden-set assertion) apply several checks
to an `"expect": "answer"` question but only one to an `"expect": "handoff"` question?

> An "answer" question asserts something rich and specific — this claim, grounded (≥1 citation),
> spoken correctly (≤3 sentences, no URLs, no citation markers), optionally containing named terms
> — because there is real content to verify. A "handoff" question only needs to verify the single
> safety property that matters: the pipeline correctly refused to guess. There is no further
> content to check, because a handoff's spoken text is always the prospect's own fixed
> `handoff_msg`, never anything ARAG produced.

---

**15. Judgement.** `AragClientPool` keeps one `AragClient` per `kb_id|baseUrl` pair rather than one
global client for the whole process. What would break if VoiceBridge used a single global client
instead, and why does per-prospect pooling (rather than, say, a brand-new client per request) make
sense?

> A single global client can only point at one Knowledge Box and one zone at a time — the moment a
> second prospect in a different Knowledge Box (or a different region) is added, every turn for
> one of the two prospects would be routed to the wrong KB. VoiceBridge is multi-tenant by design
> (`DECISIONS.md` V-03), so "which Knowledge Box" has to be a per-request routing decision, not a
> process-wide constant. Pooling by `kb_id|baseUrl` rather than building a fresh client per request
> avoids repeatedly reconstructing an identical, stateless client on every single turn, and gives
> the admin health check one object per Knowledge Box to query; the pool is cleared whenever the
> registry changes, so a `kb_id` edit takes effect on the next turn rather than being cached
> forever.

---

**16. Judgement.** `ListenService`'s refresh throttle (a rolling word window, a 1.5 s minimum gap,
a Jaccard similarity skip, a 4-word minimum) lives entirely inside `src/services/listen.ts`, on the
server. Why not let each client — the Live page, a softphone plugin, a telephony bridge —
implement its own pacing before it posts to `/transcript`?

> A client-side throttle has to be reimplemented, correctly, by every integration, and a naive or
> malicious client can simply skip it and fire an LLM call per word — the cost profile of the
> whole product would then depend on code VoiceBridge doesn't control. Putting the policy on the
> server (`DECISIONS.md` V-14) makes it a property of the product: every caller gets the same
> behaviour and the same cost exposure regardless of what wrote the client, and the policy itself
> becomes unit-testable (`decideRefresh` is a pure function, tested with an injectable clock in
> `test/listen.test.ts`) without spinning up a browser or a telephony stack.

---

**17. Recall.** A transcript chunk can be sent with `"final": false`. What happens to it when the
next chunk arrives?

> If the previous entry in the session's transcript is itself non-final, `ListenService.append`
> pops it before pushing the new one — an interim (non-final) entry is always replaced by
> whatever comes next for that same utterance, never accumulated. This is what lets a streaming
> STT source resend its evolving hypothesis every 200 ms without flooding the transcript: only the
> latest guess for an in-progress utterance is ever kept, and only a `final: true` entry survives
> once something newer (final or not) arrives after it.

---

**18. Recall.** Every time `ListenService.refresh` actually calls the brief, what three things does
it send, and why does the previous brief matter?

> The rolling window (the last ~28 words heard, `this.window(session)`), the full transcript text
> of **final** entries only (`this.transcriptText(session)`, interim chunks are excluded — see
> Q17), and the session's own previous brief (`session.brief ?? undefined`) as `prev` on the
> `BriefRequest`. Sending the previous brief is what makes this an *evolving* brief rather than a
> series of unrelated snapshots: `src/services/brief.ts`'s prompt is written to refine what it
> already inferred (the caller's profile, their goal, the stage of the call) using only the new
> window as fresh input, instead of re-deriving the whole picture from scratch on every refresh
> and potentially contradicting itself turn to turn.

---

**19. Judgement.** A caller wants to build their own client that owns its own transcript buffer and
its own refresh pacing, and only wants a single one-shot structured brief for a block of text it
already has. Should they open a `POST /api/v1/listen/sessions` session, or call
`POST /api/v1/brief` directly? What do they give up either way?

> `POST /api/v1/brief` directly — it is the stateless primitive `ListenService.refresh` itself
> calls underneath a session (same request shape: `text`, `transcript`, `prev`, `model`). A
> session buys you server-owned transcript storage, the throttle, accumulated citations across a
> whole call, latency stats, and multiple readers via `GET .../events` (SSE) or polling — none of
> which this caller needs if it already owns its own state and only wants one refresh for text it
> already has in hand. Reaching for a session anyway costs a persisted object (sessions are capped
> at 200, transcripts at 400 entries in `DATA_DIR`) for state nobody but this one caller will ever
> read, and it inherits throttle behaviour tuned for a live, continuous call rather than a single
> deliberate request. Going the other way — calling `/brief` directly when you actually have
> multiple readers or want the server to own the throttle for you — means reimplementing
> `decideRefresh`'s policy yourself, badly, which is exactly the mistake V-14 exists to prevent
> (Q16).

---

**20. Recall.** `VOICE_TURN_TIMEOUT_MS` is set as an environment variable at boot. An operator then
patches it through `PATCH /api/v1/admin/settings`. Does the running server need to restart to pick
up the new value on the next voice turn?

> No. `SettingsService.apply()` (`src/services/settings.ts`, `DECISIONS.md` V-26) writes the
> effective value directly into the same `VoiceConfig` object `runTurn` already holds a reference
> to — the environment variable only supplied the value at boot, it is not re-read afterwards, and
> nothing about the pipeline's own code changes. The very next `POST /api/v1/voice-answer` on the
> same process reads the patched value.

---

**21. Judgement.** An operator patches `limits.turnTimeoutMs` to a value at or above
`agentToolTimeoutMs` through `PATCH /api/v1/admin/settings`. What happens, and why does Settings
check this *after* applying the patch rather than only validating the number in isolation first?

> The patch is applied, `assertVoiceConfig()` (the same check `src/config.ts` runs at boot) is run
> again against the live config, finds the turn-budget invariant broken, and the whole change is
> **rolled back** — the store and the live `VoiceConfig` both revert to what they were before the
> patch — and the request gets a 400 naming the invariant. Checking a single field in isolation
> can't catch this: the invariant is a relationship *between* two fields (`turnTimeoutMs` and
> `agentToolTimeoutMs`), potentially in different groups, so the only way to know a patch is safe is
> to actually apply it against the real config and check the whole thing, the same as at boot —
> which is also why a rollback, not just a rejection, is necessary if that check fails.

---

**22. Judgement.** `API_KEYS` used to be the entire authentication story for `auth: "api"` routes.
`ApiKeyStore` (`DECISIONS.md` V-27) replaces it, but still reads `API_KEYS` on first boot. What is
`API_KEYS`'s role now, and what would break for an already-deployed customer if the store simply
ignored it?

> `API_KEYS` is now only the **seed**: on first boot, any key listed there is recorded into the
> store as an `origin: "env"` key, so it shows up in `GET /api/v1/admin/api-keys` and keeps
> authenticating exactly as before. If the store ignored it, every existing integration holding one
> of those keys — a telephony bridge, a pushed ElevenLabs tool's `X-API-Key` header — would stop
> authenticating the moment a customer upgraded to the version with the new store, with no
> equivalent key to reach for in the admin UI, because nothing would have recorded that the old key
> was ever meant to keep working.

---

**23. Recall.** `POST /api/v1/admin/voice-agent/push` writes the custom server tool before it writes
the agent, and a `GET` immediately before that can show ElevenLabs holding both a deprecated inline
`tools` array and a `tool_ids` array on the same agent. What does the push actually send back for
those, and why?

> `pushAgent()` (`src/services/elevenAgent.ts`) sends `tool_ids` only, dropping the inline `tools`
> copy from what it reads and writes back — sending both is refused by ElevenLabs with a 400
> ("Cannot specify both tools and tool IDs"), one of three live-API constraints found by
> `make agent-check`'s throwaway-agent verification (`DECISIONS.md` V-28) rather than by the unit
> suite, which only exercises an in-process fake with no opinion on what the real API accepts. The
> tool is created or patched first specifically so its id exists before the agent write that links
> to it needs one.

---

**24. Judgement.** `DECISIONS.md` V-23 says ElevenLabs is the **default implementation of every
voice surface**, while the API contract stays vendor-neutral. Point at exactly where the vendor
appears and where it does not. What would a customer running Deepgram for transcription and Twilio
for telephony have to replace, and what would they keep unchanged?

> Vendor-neutral: the listen session API. `POST /api/v1/listen/sessions`, `…/transcript`,
> `…/events`, `…/refresh` describe transcript chunks and an evolving brief and have no idea what
> produced the words — a realtime STT stream, a telephony webhook, a meeting bot or someone typing
> are the same thing to it. So is `POST /api/v1/voice-answer`: one question in, one speakable
> answer out, callable by any platform that can make an HTTP tool call. Vendor-specific: three
> *implementations* that sit beside that contract — `POST /api/v1/scribe-token`
> (`src/services/scribe.ts`) mints an ElevenLabs Scribe credential for the Live microphone,
> `POST /api/v1/speech` (`src/services/tts.ts`) reads a suggested line aloud, and
> `GET/POST /api/v1/admin/voice-agent[/push]` (`elevenAgent.ts` + `voiceAgent.ts`) configures an
> ElevenLabs Conversational AI agent. The Deepgram/Twilio customer replaces all three — they post
> Deepgram's transcript into the same `/transcript` endpoint and point a Twilio function at
> `/voice-answer` — and keeps the sessions, the throttle, the brief, the pipeline, the guards, the
> golden set and every screen in the workspace. Nothing in `src/services/listen.ts`,
> `pipeline.ts`, `brief.ts` or `safety.ts` mentions a vendor. What they lose is the *default*: with
> no `ELEVENLABS_API_KEY`, the microphone, the agent push and the spoken cue report themselves
> unavailable rather than pretending, and the sample/typed/webhook paths carry the product.

---

**25. Recall.** What does `GET /api/v1/listen/sessions/{id}/brief-history` return, and why does the
Conversations screen's comparison panel not default to comparing the last two versions?

> Every version of the brief this session produced, up to `MAX_BRIEF_HISTORY` (20), each snapshot
> carrying its `version`, the `at` instant and the `latencyMs` of that specific refresh — appended
> only when a refresh produced a *usable* brief, so a failed or empty refresh leaves no entry
> (`isUsableBrief` in `src/services/listen.ts`). The panel walks backwards from the latest version
> until it finds one that actually differs and opens on that pair, because a deferred refresh very
> often fires on a window nothing new has entered, which makes the last two versions identical
> surprisingly often. A comparison screen whose default answer is "0 fields moved" is a form, not
> an answer.

---

**26. Judgement.** A partner's integration polls `GET /api/v1/admin/turns` and
`GET /api/v1/admin/golden-evals`. Both were deleted (`DECISIONS.md` V-30). What is the migration,
and what does the integration gain rather than lose?

> Move to the public `GET /api/v1/turns` and `GET /api/v1/golden-evals` — the same records, and the
> admin token the integration already sends authenticates against them, because `enforceAuth` lets
> any admin-authenticated caller through an `auth: "api"` route. The distinction the admin copies
> appeared to draw ("an operator can read this without an API key") never actually existed. The
> gain is real: the public routes carry the filtering, paging and `reasons`/`total` facets the
> admin copies never had. "Public" still is not "anonymous" here — these routes require a
> same-origin session, an API key or the admin token even on a deployment with no key active.

---

**27. Judgement.** A customer states a 30-day retention policy and points at Settings → Retention as
evidence it is met. The fields exist and read `0`. What is actually true, and what are the **two
separate** things they have to change?

> Nothing is being deleted on a clock. A window of `0` means "keep until the underlying ring or
> store evicts it" — the historical behaviour, and the shipped default precisely so an upgrade does
> not silently start deleting a customer's demo data (`src/services/retention.ts`). So: (1) set
> `turnDays`, `sessionDays` and `evalDays` to 30 — three fields, not one, because a turn record, a
> listen session's full transcript and a golden-run result are three different retention footprints;
> and (2) switch `autoPurge` on, because with it off the configured windows are only applied when
> an operator presses **Purge now** or calls `POST /api/v1/admin/purge`. A contractual retention
> limit that depends on someone remembering to click a button is not enforced. Setting the windows
> without the timer is the failure mode that looks most like compliance and is not.

---

**28. Recall.** `POST /api/v1/admin/purge` takes a `scope`. What is the difference between
`"retention"` and `"turns"`, and how would you tell from the response which one you just ran?

> `"retention"` (the default) applies the configured windows: it deletes only records older than
> `turnDays`/`sessionDays`/`evalDays`, and deletes nothing at all for any window left at `0`.
> `"turns"` — like `"sessions"`, `"evals"` and `"all"` — deletes **everything in that store
> regardless of age**, immediately, with no undo. The response is the same shape either way
> (`{turns, sessions, evals, at, windows}`), so the first tell is the arithmetic: a `retention` run
> on a deployment whose turns are all minutes old returns `turns: 0` while reporting
> `windows.turnDays: 30`; a `turns` run on the same deployment returns `turns: 31` with the same
> `windows`. The second tell is the log: a scoped purge always writes `retention.purge` at `warn`
> with the `actor` and the `scope`, while applying the windows writes `retention.purged` at `info`
> and only when something was actually deleted. Only one of the two is recoverable by waiting.

---

**29. Judgement.** An operator raises the global rate limit in Settings, the screen confirms the
new value, and the limiter keeps rejecting at the old one. `SettingsService.apply()` definitely
wrote into the live config. Where was the bug, and what does the fix say about adding a setting of
your own?

> The platform reads `route.opts.rateLimit` on **every** request, but the product handed it a
> plain `{ rps, burst }` object captured once at boot — so the store, the screen and the API all
> agreed on a number the limiter was never going to read again. `DECISIONS.md` V-31's fix is
> `liveBudget()` in `src/services/budget.ts`, which returns an object of **getters**; the
> platform's spread evaluates them per request, so the limiter reads the current value. Two others
> were wrong the same way in the same pass — the turn-log ring cap (fixed by creating the
> collection uncapped and enforcing the current size in `record()`, since leaving the collection's
> own cap at the boot value would have made raising the setting work downwards only) and the
> deployment's `ARAG_GENERATIVE_MODEL`/`ARAG_RERANKER` defaults. The lesson for a new setting:
> adding a row to the table makes it *editable*, not *effective*. The test is whether the code that
> consumes the value re-reads it, and V-31 states the standard plainly — a setting that cannot take
> effect without a restart is a bug, not a caveat.
