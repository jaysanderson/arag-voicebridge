# VoiceBridge showcase — storyboard

One continuous take, produced by the single test in `showcase/record.spec.ts` (`showcase
walkthrough`), so the whole thing lands in one `.webm`. Shot numbers match the screenshot
prefixes written to `showcase/out/`.

| # | Screen / region | What the viewer sees | Duration | On-screen callout | `record.spec.ts` step |
|---|---|---|---|---|---|
| 1 | Console — full page, Ask tab | Console loads, prospect "Progress" selected, greeting text visible | 14s | *(none — VO carries the problem statement)* | `await page.goto("/")` + assert `#prospect` value `progress` and `#prospectGreeting` non-empty → `01-console-loaded.png` |
| 2 | Console — Ask card, left column | Question typed into the input box | 4s | *(none)* | `page.fill("#question", ...)` → `02-ask-typed.png` |
| 3 | Console — Ask card + "What just happened" panel | Pipeline steps light up green in sequence; answer bubble renders with an "answered" chip and a citation | 14s | **"answered · cited"** (chip is native UI, no overlay needed) | `page.click("#ask")`, wait for `.arag-bubble.assistant .arag-chip.ok`, wait for `.arag-cite` → `03-grounded-answer.png` |
| 4 | Console — "What just happened" panel (cropped to that card) | Retrieve / first token / total latency values filled in | 5s | *(native `dl` labels are the callout)* | wait for `#factTotal` not `—`, screenshot of the card locator only → `04-citations-latency.png` |
| 5 | Console — Ask card | Out-of-scope question typed and asked | 6s | *(none)* | `page.fill`/`page.click("#ask")` |
| 6 | Console — Ask card + pipeline panel | Handoff chip appears; pipeline shows the handoff-check step tripped; handoff line spoken | 14s | **"handoff · out-of-scope"** | wait for `.arag-chip.warn` containing "handoff" → `05-handoff.png` |
| 7 | Console — Golden set tab | Tab switches; gate reads "not run", table empty — the queued-up state before the run | 10s | **"not run"** chip | `page.click('[data-tab="golden"]')`, wait for `#goldenChip` text "not run" → `06-golden-not-run.png` |
| 8 | Console — Golden set tab | "Run golden set" pressed; against the mock the whole run finishes in single-digit ms, so the very next frame already shows the completed table, chip "gate open" and summary "10/10 passed" | 20s | **"gate open"** | `page.click("#runGolden2")`, wait for `#goldenChip` text "gate open" → `07-golden-gate-open.png` |
| 9 | Admin — sign-in card | Navigate to `/admin/`, token entered, Sign in pressed, panel appears | 13s | *(none)* | `page.goto("/admin/")`, `page.fill("#token", ...)`, `page.click("#signin")`, wait for `#panel` visible → `08-admin-signin.png` |
| 10 | Admin — Overview tab | "Test connections" pressed; health table fills with three prospects, all "connected" | 17s | **"connected · N resources"** | `page.click("#reloadHealth")`, wait for 3 rows + `.arag-chip.ok` → `09-kb-health.png` |
| 11 | Admin — Prospects tab, editor | "New" pressed, key + JSON configuration filled in | 10s | *(none)* | `page.click('[data-tab="prospects"]')`, `page.click("#newProspect")`, `page.fill("#pKey", ...)`, `page.fill("#pJson", ...)` → `10-new-prospect.png` |
| 12 | Admin — Prospects tab | "Save" pressed, new row appears in the registry table; "Provision search config" pressed, result panel + updated row show the stored config name | 15s | **stored config name** in the table's "Stored config" column | `page.click("#saveProspect")`, wait for new row, `page.click("#provisionProspect")`, wait for `#provisionResult` text → `11-provisioned.png` |
| 13 | Admin — Turn log tab | "Reload" pressed; table shows an answered turn, a handoff turn, and a guard-trip turn whose question column reads "redacted (guard trip)" | 20s | **"redacted (guard trip)"** | background `request.post` of a prompt-injection question, `page.click('[data-tab="turns"]')`, `page.click("#reloadTurns")`, wait for "redacted (guard trip)" text → `12-turn-log-redacted.png` |
| 14 | Admin — Configuration tab, then back to console footer | Effective configuration shown with secrets redacted; final frame settles on the console's metrics strip | 10s | *(none — VO carries the close)* | `page.click('[data-tab="config"]')`, wait for `.arag-json` content, then `page.goto("/")`, wait for `#mBridge` "online" → `13-closing.png` |

Total: **~2:52**, within the 2–3 minute target.
