# VoiceBridge showcase — storyboard

One continuous take, produced by the single test in `showcase/record.spec.ts` (`showcase
walkthrough`), so the whole thing lands in one `.webm`. Shot numbers match the screenshot
prefixes written to `showcase/out/`.

| # | Screen / region | What the viewer sees | Duration | On-screen callout | `record.spec.ts` step |
|---|---|---|---|---|---|
| 1 | Console — full page, Listen tab (the default) | Console loads on Listen, no session running, the "feed a conversation in" copy visible | 14s | *(none — VO carries the problem statement)* | `await page.goto("/")` + assert the Listen tab is selected and `#listenChip` reads "no session" → `01-console-loaded.png` |
| 2 | Console — Live brief card | "Play sample conversation" pressed; the brief renders its first version with a citation underneath it | 12s | **v1** in the brief header | `page.click("#sampleBtn")`, wait for `#briefSources .arag-cite` → `02-brief-midcall.png` |
| 3 | Console — Live brief card | The scripted call keeps feeding in; the brief reaches a strictly later version than the first shot, citations accumulate, then the sample finishes on its own | 30s | **later `vN`** in the brief header, genuinely advanced from shot 2 | `expect.poll` on the numeric value of `#briefMeta .version` to exceed the version captured in shot 2, then wait for `#sampleBtn` to read "Play sample conversation" again → `03-brief-evolved.png` |
| 4 | Console — Transcript pane | The full nine-turn scripted call, caller and agent lines labelled | 8s | *(native turn labels are the callout)* | screenshot of the `#transcript` locator alone → `04-transcript.png` |
| 5 | Console — Session stats | Chunks, brief refreshes and throttled-skip counts, last refresh latency, all filled in | 6s | *(native `dl` labels are the callout)* | screenshot of the `#listenStats` locator alone → `05-listen-stats.png` |
| 6 | Console — Ask card + "What just happened" panel | Tab switches to Ask; question asked; pipeline steps light up green in sequence; answer bubble renders with an "answered" chip and a citation | 14s | **"answered · cited"** (chip is native UI, no overlay needed) | `page.click('[data-tab="ask"]')`, `page.fill`/`page.click("#ask")`, wait for `.arag-bubble.assistant .arag-chip.ok`, wait for `.arag-cite` → `06-ask-grounded.png` |
| 7 | Console — "What just happened" panel (cropped to that card) | Retrieve / first token / total latency values filled in | 6s | *(native `dl` labels are the callout)* | wait for `#factTotal` not `—`, screenshot of the card locator only → `07-citations-latency.png` |
| 8 | Console — Ask card + pipeline panel | Out-of-scope question asked; handoff chip appears; pipeline shows the handoff-check step tripped; handoff line spoken | 16s | **"handoff · out-of-scope"** | `page.fill`/`page.click("#ask")`, wait for `.arag-chip.warn` containing "handoff" → `08-ask-handoff.png` |
| 9 | Console — Golden set tab | Tab switches; gate reads "not run", table empty — the queued-up state before the run | 8s | **"not run"** chip | `page.click('[data-tab="golden"]')`, wait for `#goldenChip` text "not run" → `09-golden-not-run.png` |
| 10 | Console — Golden set tab | "Run golden set" pressed; against the mock the whole run finishes in single-digit ms, so the very next frame already shows the completed table, chip "gate open" and summary "10/10 passed" | 10s | **"gate open"** | `page.click("#runGolden2")`, wait for `#goldenChip` text "gate open" → `10-golden-gate-open.png` |
| 11 | Admin — sign-in, Overview tab | Navigate to `/admin/`, token entered, Sign in pressed, panel appears already showing Knowledge Box health | 6s | *(none)* | `page.goto("/admin/")`, `page.fill("#token", ...)`, `page.click("#signin")`, wait for `#panel` visible → `11-admin-signin.png` |
| 12 | Admin — Listen sessions tab | "Reload" pressed; the sample-call session appears in the table (ended, with its refresh/throttled counts); its brief history panel lists every version newest-first with a timestamp and refresh latency | 24s | **"v1" … "vN"** entries with their `ms` latency in the brief history | `page.click('[data-tab="listen"]')`, `page.click("#reloadListen")`, wait for a table row + `#listenMeta` containing "refreshes" + `#briefHistory` containing "v1" → `12-admin-listen-sessions.png` |
| 13 | Admin — Turn log tab | Background `request.post` of a prompt-injection question, then "Reload" pressed; table shows the answered and handoff turns from the Ask tab plus a guard-trip turn whose question column reads "redacted (guard trip)" | 14s | **"redacted (guard trip)"** | `page.click('[data-tab="turns"]')`, `page.click("#reloadTurns")`, wait for "redacted (guard trip)" text → `13-turn-log-redacted.png` |
| 14 | Console — metrics footer | Back to `/`; the closing frame settles on the console's metrics strip | 8s | *(none — VO carries the close)* | `page.goto("/")`, wait for `#mBridge` "online" → `14-closing.png` |

Total: **~3:00**, within the 2–3 minute target.

## A note on shots 3, 4, 5 and 7

The "Live brief" card and the Ask "What just happened" card both grow taller than the 1280×800
recording viewport once the call or the answer has filled in. `record.spec.ts`'s `shootClear`
helper grows the viewport to fit the whole card before those four screenshots and restores it
straight after, rather than letting Playwright's normal scroll-to-capture path run — scrolling a
tall element into view leaves `arag-shell`'s sticky product header pinned across the top of the
captured card. That is a recording-time workaround inside `showcase/record.spec.ts` only; nothing
under `public/` was touched, and the helper's doc comment explains the mechanism for whoever reads
the spec next.
