# VoiceBridge showcase — storyboard

One continuous take, produced by the single test in `showcase/record.spec.ts` (`showcase
walkthrough`), so the whole thing lands in one `.webm`. Shot numbers match the screenshot prefixes
written to `showcase/out/`, and the "at" column is the moment each still was actually captured in a
real recording — the spec prints that timeline at the end of every run. The workspace is the
rebuilt multi-section IA — a dark left rail with Live, Conversations, Knowledge, Prospects,
Quality, Settings and API, plus the Operator panel at `/admin/` — not the old single-page tabbed
console.

| # | Screen / region | What the viewer sees | At | On-screen callout | `record.spec.ts` step |
|---|---|---|---|---|---|
| 1 | Live — full page | A fresh browser lands on Live; the first-run banner explains the product and what it will not do; no session running | 00:07 | *(none — VO carries the problem statement)* | `page.goto("/")` + clear localStorage + reload, assert `#vbOnboard` visible and `#vbSessionChip` "not started" → `01-live-first-run.png` |
| 2 | Live — Brief card (`.vb-brief-card`) | "Play sample conversation" pressed from the banner; the brief renders its first grounded version with a citation underneath | 00:17 | **v1** in the brief header | `page.click("#vbSampleOnboard")`, wait `#vbSessionChip` "listening", wait `#vbSources .arag-cite` → `02-brief-first-citation.png` |
| 3 | Live — Brief card | The scripted call keeps feeding in; the brief reaches a strictly later version than shot 2, citations accumulate, then the sample finishes itself | 00:29 | **later `vN`**, genuinely advanced from shot 2 | `expect.poll` on the numeric value of `#vbBriefMeta .version` to exceed the version captured in shot 2, then wait for `#vbStatus` to read "Sample finished…" → `03-brief-evolved.png` |
| 4 | Live — Transcript card | The full nine-turn scripted call, caller and agent lines labelled | 00:35 | *(native turn labels are the callout)* | screenshot of the card around `#vbTranscript` → `04-transcript.png` |
| 5 | Live — Session card | Turns heard, brief refreshes, skipped-by-throttle count, last refresh latency, p50/p95, all filled in | 00:41 | *(native `dl` labels are the callout)* | capture the session's 8-character id prefix from `#vbStats dd.mono`, screenshot `#vbSessionCard` → `05-session-stats.png` |
| 6 | Conversations — drawer, top | End and save; switch to Conversations; search "titanium" (something the caller actually said); open the matching row — final brief and its citations | 00:53 | *(none — native "Final brief" heading)* | `page.click("#vbEnd")`, nav to Conversations, `page.fill("#cvSearch", "titanium")`, click `#cvTable tbody tr[data-id^="<prefix>"]` → `06-conversation-brief.png` |
| 7 | Conversations — drawer, scrolled | The same drawer scrolled to "How the brief evolved" — every version, newest first, each with its own timestamp and refresh latency | 01:00 | **v1 … vN** entries with their `ms` latency | scroll the "How the brief evolved" heading into view inside the drawer, assert the last timeline item reads "v1" and there is more than one → `07-conversation-evolution.png` |
| 8 | Knowledge — Knowledge Box card | Which Knowledge Box this prospect is grounded in, honestly marked as sample content, connected | 01:06 | **sample content** chip | `page.click('.arag-railnav a:has-text("Knowledge")')`, wait `#kbCard` contains "Knowledge Box" and "connected" → `08-knowledge-box.png` |
| 9 | Knowledge — Ask tester | A grounded question asked; the answer carries an "answered" chip, a citation, and the open nine-step pipeline underneath it | 01:13 | **answered** chip, **9 of 9 steps ran** | `page.fill("#kbQuestion", …)`, `page.click("#kbAsk")`, wait `[data-outcome]` "answered" + `.arag-cite` + `details.vb-pipeline`, scroll the newest bubble to the top of the answer scroller → `09-knowledge-ask-grounded.png` |
| 10 | Knowledge — Ask tester | An out-of-scope question asked; the answer carries a "handoff" chip and the prospect's handoff line, with its own pipeline under it | 01:19 | **handoff** chip | `page.fill("#kbQuestion", "What is the capital of France?")`, wait `[data-outcome]` "handoff", scroll that bubble to the top → `10-knowledge-ask-handoff.png` |
| 11 | Knowledge — Golden set card | "Run golden set" pressed; against the mock the whole run finishes in single-digit ms per question, so the very next frame already shows the completed table, chip "gate open", ten passes | 01:27 | **gate open** | `page.click("#kbRunGolden")`, wait `#kbGoldenChip` "gate open", assert 10 rows and "10/10 passed" → `11-knowledge-golden-gate-open.png` |
| 12 | Quality — full page | A prompt-injection turn fired in the background; metrics strip and the turn log filtered to guard trips, showing "redacted (guard trip)" instead of the actual text | 01:35 | **redacted (guard trip)** | background `request.post` of an injection question, nav to Quality, `page.selectOption("#qOutcome", "guard")`, wait "redacted (guard trip)" → `12-quality.png` (full page) |
| 13 | Operator — Overview | Sign in with the admin token; Overview reports Knowledge Box call counts and store sizes | 01:42 | *(none)* | `page.goto("/admin/")`, fill `#token`, click `#signin`, wait `#ovStats` contains "Knowledge Box calls" → `13-admin-overview.png` (full page) |
| 14 | Operator — Listen sessions drawer | This exact session opened from the operator side; brief history lists every version with its timestamp and latency | 01:48 | **v1 … vN** with `ms` latency | nav to Listen sessions, filter to prospect "progress", click the row matching this session's id, wait drawer contains "Brief history" and "v1" → `14-admin-session-brief-history.png` |
| 15 | Settings — full page, locked | Settings as anyone without the operator grant sees it: live connection health on the page, every group withheld, and one read-only banner with a token field and Unlock | 01:55 | **Viewing this deployment read-only** / **mock Knowledge Box** | `page.context().clearCookies({ name: "arag_admin" })` (see the note below), `page.goto("/settings/")`, assert `#stUnlock` visible, `[data-locked]` present and `form[data-group]` count 0 → `15-settings-read-only.png` |
| 16 | Settings — Branding section | Unlocked in place; the partner's product name typed into the branding form and the preview beside it already repainted — while the rail still reads VoiceBridge | 02:03 | **including unsaved changes**, **1 change not saved** | fill `#stToken` + click `#stUnlock`, scroll `section#branding` to the top, fill `.vb-set-field[data-field="branding.productName"] [data-control]`, assert `#stBrand .vb-set-preview .name` is the new name and `.arag-rail .name` is still "VoiceBridge" → `16-settings-brand-preview.png` |
| 17 | Settings — Branding, saved | Save pressed; the rail, the breadcrumb and the tab title all carry the partner's name, with no reload anywhere in the beat | 02:11 | **Saved — live now, no restart** | click `[data-save]`, wait `[data-status]` "Saved — live now, no restart", assert `.arag-rail .name` is the new name and `page` title starts with it → `17-settings-brand-live.png`; then `[data-reset-group="branding"]` + the confirm dialog, asserting the rail returns to "VoiceBridge" |
| 18 | Settings — ElevenLabs integration | The capability table: Scribe v2 Realtime, Conversational AI agents, text-to-speech and the voice library, each with what it does here — all correctly "unavailable" with no key | 02:23 | **Primary** badge, **not configured** | wait `#stCapabilities` contains "Primary", the four capability names and "not configured" → `18-settings-elevenlabs.png` |
| 19 | Settings — Voice agent panel | What this deployment wants for the prospect's agent — tool, URL, timeout, greeting, router prompt — and, honestly, nothing to compare it against: no diff table, push disabled | 02:29 | **ElevenLabs is not configured** | wait `#stAgent` contains "/api/v1/voice-answer", "8000 ms" and "voice_answer"; assert `.vb-set-diff` count 0 and `#stPush` disabled → `19-settings-voice-agent.png` |
| 20 | API explorer — full page | Every operation the deployment exposes, grouped by tag, built from its own OpenAPI document, each marked with the auth it needs | 02:35 | **`N` operations** (whatever the document holds) | `page.goto("/api/")`, assert `#apiCount` matches `/^\d+ operations$/` and more than 20 `[data-op]` rows → `20-api-explorer.png` |
| 21 | API explorer — the voice turn | The voice turn searched for, opened, its body prefilled from the schema with the selected prospect, sent — 200 OK and the live answer with citations, handoff flag and latencies | 02:43 | **200 OK** | `page.fill("#apiSearch", "voice-answer")`, click `[data-op="voiceAnswer"]`, assert `#apiBody` holds `"prospect": "progress"`, `page.click("#apiSend")`, wait `.vb-result-head` "200 OK" → `21-api-try-it.png` |
| 22 | API explorer — curl | The same call written out as curl, with the response codes table under it | 02:48 | *(native "curl" heading)* | scroll `#apiCurl` into view, assert it contains "curl -X POST" and the path → `22-api-curl.png` |

Total: **2:48** (measured recording: 2:47.7 / 167.7s), within the 2–3 minute target.

## A note on shots 2, 3, 4, 5, 11, 18 and 19 — a real sticky-header rendering problem

The rebuilt UI does not have the old `[hidden]`-vs-`display:grid` conflict the previous console's
spec worked around, but it does still use `position: sticky` in several places — the shell's brand
band, the page header, Live's `.vb-side` column, Settings' section index (`.vb-set-nav`), and a data
table's own `thead th` inside its scroller — and that turned out to have its own capture problem.
Screenshotting an element tall enough that Playwright needs to scroll the page to reach it
composited the sticky chrome part-way down the captured image, on top of the element's own content,
and left a blank band where a scrolled-away table header should have been; elements that never
needed a scroll (the drawers, the bounded Ask answer box, cards near the top of a page) came out
clean. This was confirmed empirically against this spec's own output — not assumed from the old
console's issue — before writing a fix, and again this pass when the settings index turned up in the
middle of the ElevenLabs panels.

`record.spec.ts`'s `shootClear` helper works around it by un-sticking the chrome for the moment of
the shot — an injected stylesheet sets `position: static !important` on each of those selectors
immediately before the screenshot and removes it immediately after. Once nothing is pinned, a
scroll to bring a tall element into view carries it all away with the rest of the page, so there is
nothing left to re-composite over the element's content. An earlier version of the helper grew the
viewport to fit the element instead (avoiding the scroll altogether), which also produced clean
stills, but cost the recording itself: resizing the viewport mid-take is what left
`showcase/out/**/video.webm` empty on some runs. Un-sticking the chrome fixes the same artefact
without ever touching the viewport, so the video survives. It is used only for the shots that
actually need it: the brief card (2, 3), the transcript and session cards (4, 5), the golden-set
card (11) and the two ElevenLabs panels (18, 19). This is a recording-time workaround inside
`showcase/record.spec.ts` only; nothing under `public/` was touched, and the helper's doc comment
explains the mechanism for whoever reads the spec next.

## A note on the golden-set gate (shot 11)

`DATA_DIR` is a persistent store, not reset between recordings of this spec, so a prospect that has
already had its golden set run once in a given data directory shows a prior "gate open" result on
load rather than "not run". The spec no longer asserts the starting state — only that pressing "Run
golden set" reaches "gate open" with ten passes — so the recording is repeatable against a warm
data directory as well as a clean one.

## A note on the operator cookie (shot 15)

Shot 13 signs into the Operator panel, and `/admin/` and Settings unlock with the same token
exchanged for the same `arag_admin` cookie. Arriving at Settings straight from the Operator panel
would therefore find every form already open, and the beat that this section is about — a page that
renders read-only for anyone and reveals its editing surface in place — would never appear. The
spec drops that one cookie before navigating (`clearCookies({ name: "arag_admin" })`), which is
exactly where a viewer who never signed in stands, and where an operator stands twelve hours later
when the cookie has expired. Nothing else is cleared: the workspace's own session cookie survives,
so the page behaves as it does for a real visitor rather than a half-reset one, and the unlock that
follows is the product's own flow, not a staged one.

## A note on the Ask tester's answer box (shots 9 and 10)

`#kbAnswers` is a bounded scroller and the page scrolls it to the bottom when an answer lands. Now
that a traced turn renders its nine-step pipeline underneath the answer, that auto-scroll left the
last few steps filling the frame with the answer, its outcome chip and its citations out of shot.
The spec pulls the newest bubble's own top to the top of the scroller before shooting, so the frame
leads with the answer and the pipeline reads underneath it.
