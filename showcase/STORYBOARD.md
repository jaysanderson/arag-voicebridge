# VoiceBridge showcase — storyboard

One continuous take, produced by the single test in `showcase/record.spec.ts` (`showcase
walkthrough`), so the whole thing lands in one `.webm`. Shot numbers match the screenshot prefixes
written to `showcase/out/`. The workspace is the rebuilt multi-section IA — a dark left rail with
Live, Conversations, Knowledge, Prospects, Quality and Settings, plus the Operator panel at
`/admin/` — not the old single-page tabbed console.

| # | Screen / region | What the viewer sees | Duration | On-screen callout | `record.spec.ts` step |
|---|---|---|---|---|---|
| 1 | Live — full page | A fresh browser lands on Live; the first-run banner explains the product and what it will not do; no session running | 15s | *(none — VO carries the problem statement)* | `page.goto("/")` + clear localStorage + reload, assert `#vbOnboard` visible and `#vbSessionChip` "not started" → `01-live-first-run.png` |
| 2 | Live — Brief card (`.vb-brief-card`) | "Play sample conversation" pressed from the banner; the brief renders its first grounded version with a citation underneath | 45s (with #3) | **v1** in the brief header | `page.click("#vbSampleOnboard")`, wait `#vbSessionChip` "listening", wait `#vbSources .arag-cite` → `02-brief-first-citation.png` |
| 3 | Live — Brief card | The scripted call keeps feeding in; the brief reaches a strictly later version than shot 2, citations accumulate, then the sample finishes itself | *(above)* | **later `vN`**, genuinely advanced from shot 2 | `expect.poll` on the numeric value of `#vbBriefMeta .version` to exceed the version captured in shot 2, then wait for `#vbStatus` to read "Sample finished…" → `03-brief-evolved.png` |
| 4 | Live — Transcript card | The full nine-turn scripted call, caller and agent lines labelled | 16s (with #5) | *(native turn labels are the callout)* | screenshot of the card around `#vbTranscript` → `04-transcript.png` |
| 5 | Live — Session card | Turns heard, brief refreshes, skipped-by-throttle count, last refresh latency, p50/p95, all filled in | *(above)* | *(native `dl` labels are the callout)* | capture the session's 8-character id prefix from `#vbStats dd.vb-mono`, screenshot `#vbSessionCard` → `05-session-stats.png` |
| 6 | Conversations — drawer, top | End and save; switch to Conversations; search "titanium" (something the caller actually said); open the matching row — final brief and its citations | 20s (with #7) | *(none — native "Final brief" heading)* | `page.click("#vbEnd")`, nav to Conversations, `page.fill("#cvSearch", "titanium")`, click `#cvTable tbody tr[data-id^="<prefix>"]` → `06-conversation-brief.png` |
| 7 | Conversations — drawer, scrolled | The same drawer scrolled to "How the brief evolved" — every version, newest first, each with its own timestamp and refresh latency | *(above)* | **v1 … vN** entries with their `ms` latency | scroll the "How the brief evolved" heading into view inside the drawer, assert the last timeline item reads "v1" and there is more than one → `07-conversation-evolution.png` |
| 8 | Knowledge — Knowledge Box card | Which Knowledge Box this prospect is grounded in, honestly marked as sample content, connected | 18s (with #9, #10) | **sample content** chip | `page.click('nav.vb-nav a:has-text("Knowledge")')`, wait `#kbCard` contains "Knowledge Box" and "connected" → `08-knowledge-box.png` |
| 9 | Knowledge — Ask tester | A grounded question asked; the answer carries an "answered" chip and a citation | *(above)* | **answered** chip (native UI) | `page.fill("#kbQuestion", …)`, `page.click("#kbAsk")`, wait `.arag-chip.ok` "answered" + `.arag-cite` → `09-knowledge-ask-grounded.png` |
| 10 | Knowledge — Ask tester | An out-of-scope question asked; the answer carries a "handoff" chip and the prospect's handoff line | *(above)* | **handoff** chip | `page.fill("#kbQuestion", "What is the capital of France?")`, wait `.arag-chip.warn` "handoff" → `10-knowledge-ask-handoff.png` |
| 11 | Knowledge — Golden set card | "Run golden set" pressed; against the mock the whole run finishes in single-digit ms per question, so the very next frame already shows the completed table, chip "gate open", ten passes | 13s | **gate open** | `page.click("#kbRunGolden")`, wait `#kbGoldenChip` "gate open", assert 10 rows and "10/10 passed" → `11-knowledge-golden-gate-open.png` |
| 12 | Quality — full page | A prompt-injection turn fired in the background; metrics strip and the turn log filtered to guard trips, showing "redacted (guard trip)" instead of the actual text | 12s | **redacted (guard trip)** | background `request.post` of an injection question, nav to Quality, `page.selectOption("#qOutcome", "guard")`, wait "redacted (guard trip)" → `12-quality.png` (full page) |
| 13 | Operator — Overview | Sign in with the admin token; Overview reports Knowledge Box call counts and store sizes | 14s (with #14) | *(none)* | `page.goto("/admin/")`, fill `#token`, click `#signin`, wait `#ovStats` contains "Knowledge Box calls" → `13-admin-overview.png` (full page) |
| 14 | Operator — Listen sessions drawer | This exact session opened from the operator side; brief history lists every version with its timestamp and latency | *(above)* | **v1 … vN** with `ms` latency | nav to Listen sessions, filter to prospect "progress", click the row matching this session's id, wait drawer contains "Brief history" and "v1" → `14-admin-session-brief-history.png` |
| 15 | Settings — Connection + Branding | The Connection card is honest about the mock Knowledge Box; the Branding card previews the white-label identity | 12s (with #16) | **mock Knowledge Box** / **Progress default** chips | nav to Settings, wait `#stConnection` contains "mock Knowledge Box" and `#stBrand` contains "Progress default" → `15-settings-connection-brand.png` |
| 16 | Settings — ElevenLabs integration card | ElevenLabs shown as a Primary integration — Scribe v2 Realtime, Conversational AI, text-to-speech, all correctly "unavailable" with no key — plus the agent tool definition and system prompt ready to paste in | *(above)* | **Primary** badge | wait the card contains "Primary", "Scribe v2 Realtime", "Conversational AI agents", "Text-to-speech" and `#stAgent` contains "voice_answer" → `16-settings-elevenlabs.png` |

Total: **~2:45**, within the 2–3 minute target (measured recording: 2:44.6 / 164.6s).

## A note on shots 2, 3, 4, 5, 11 and 16 — a real sticky-header rendering problem

The rebuilt UI does not have the old `[hidden]`-vs-`display:grid` conflict the previous console's
spec worked around, but it does still use `position: sticky` in two places — the shell's
`.vb-topbar` and, on Live, the `.vb-side` column — and that turned out to have its own capture
problem. Screenshotting an element tall enough that Playwright needs to scroll the page to reach it
composited the sticky top bar part-way down the captured image, on top of the element's own
content; elements that never needed a scroll (the drawers, the bounded Ask answer box, cards near
the top of a page) came out clean. This was confirmed empirically against this spec's own output —
not assumed from the old console's issue — before writing a fix.

`record.spec.ts`'s `shootClear` helper works around it by un-sticking the chrome for the moment of
the shot — an injected stylesheet sets `.vb-topbar, .vb-side { position: static !important; }`
immediately before the screenshot and removes it immediately after. Once neither is pinned, a
scroll to bring a tall element into view carries them away with the rest of the page like anything
else, so there is nothing left to re-composite over the element's content. An earlier version of
the helper grew the viewport to fit the element instead (avoiding the scroll altogether), which
also produced clean stills, but cost the recording itself: resizing the viewport mid-take is what
left `showcase/out/**/video.webm` empty on some runs. Un-sticking the chrome fixes the same
artefact without ever touching the viewport, so the video survives. It is used only for the six
shots that actually needed it: the brief card (2, 3), the transcript and session cards (4, 5), the
golden-set card (11), and the ElevenLabs integration card (16). This is a recording-time workaround
inside `showcase/record.spec.ts` only; nothing under `public/` was touched, and the helper's doc
comment explains the mechanism for whoever reads the spec next.

## A note on the golden-set gate (shot 11)

`DATA_DIR` is a persistent store, not reset between recordings of this spec, so a prospect that has
already had its golden set run once in a given data directory shows a prior "gate open" result on
load rather than "not run". The spec no longer asserts the starting state — only that pressing "Run
golden set" reaches "gate open" with ten passes — so the recording is repeatable against a warm
data directory as well as a clean one.
