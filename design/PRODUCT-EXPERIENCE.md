# PRODUCT-EXPERIENCE.md — GroundLine (repo `arag-voice`, working title VoiceBridge)

Design specification for the product-experience pass (D-28). This document is implemented
literally by the engineering lead. Where it says "exact copy", the string is the string.

**Status of the surrounding work**
- Hero capability is real-time listening (D-20). Everything else is secondary to it.
- White-labelling by `BRAND_*` configuration must keep working (D-25); the default look is
  Progress-branded.
- Customer promise is `marketing/site/voicebridge.json` → `customer` block. The UI must live up to
  it, line by line. The promises this document designs against explicitly:
  - "one brief on screen keeps rewriting itself … with every factual claim carrying a citation"
  - "**a failed refresh leaves the last good brief in place rather than blanking it**"
  - "a field is left empty rather than filled with something invented"
  - "sources accumulate underneath … by the end there is a list of exactly what informed it"
  - "it never speaks" — the product is a screen, not a participant.

**Hard constraints** (from `TEAM-BRIEF.md`): static HTML + CSS + vanilla ES modules served from
`public/`; no build step; no runtime dependencies; no framework; no CDN; front-end calls only
`/api/v1`; `vendor/` is never edited. Everything works at 1440 px and degrades to tablet and
phone.

**House conventions used throughout this document**
- `GET /api/v1/x → field.path` means "this region is rendered from that field of that response".
- Wireframes are drawn at 1440 px unless labelled otherwise. One character ≈ 12 px.
- New CSS classes are `vb-*` when product-specific and `arag-*` when proposed for the platform
  kit; §6 says which is which and why.

---

## Contents

1. [Personas and jobs-to-be-done](#1-personas-and-jobs-to-be-done)
2. [Information architecture, sitemap and router](#2-information-architecture-sitemap-and-router)
3. [Screen-by-screen wireframes](#3-screen-by-screen-wireframes)
4. [State inventory](#4-state-inventory)
5. [Copy guidelines and copy deck](#5-copy-guidelines-and-copy-deck)
6. [Components mapped to the UI kit](#6-components-mapped-to-the-ui-kit)
7. [Visual design specification](#7-visual-design-specification)
8. [The guided demo path](#8-the-guided-demo-path)
9. [API gaps](#9-api-gaps)
10. [Admin / operator IA](#10-admin--operator-ia)

---

## 1. Personas and jobs-to-be-done

Four personas, taken verbatim from `voicebridge.json → personas`, each with the job it is doing,
the screen that serves it, and the objection the screen has to answer. Every screen in §3 exists
because a row here needs it. A screen that serves no row is cut.

### P1 — Contact-centre supervisor / enablement lead
> "Wants agents — especially new ones — to say the right thing on a live call without memorising
> the knowledge base, and to see afterwards what the call actually covered."
> Objects: *"why is a self-updating brief better than a search bar my agents already have?"*

| Job | Screen | How the screen answers the objection |
|---|---|---|
| Watch a live call and read what to say next | **Live** | The brief is the main pane and it rewrites itself. There is no search box on Live. The agent never types a query — that is the whole argument, made by the layout. |
| See afterwards what a call covered | **Conversations → detail** | Brief history with timestamps, the transcript beside it, the sources that were drawn on. |
| Prove a new agent is safe to put on calls | **Knowledge → golden set** | Run the gate, see pass/fail per question. |
| Spot calls that went wrong | **Quality → handoff reasons, turn log** | Reasons are named, not scored. |

### P2 — Sales engineer running discovery calls
> "Wants to track what a prospect has said, what they're really trying to solve, and what to ask or
> offer next, without breaking eye contact with the call."
> Objects: *"does it keep up with the conversation, or is it one turn behind?"*

| Job | Screen | How the screen answers the objection |
|---|---|---|
| Keep a read on the other party mid-call | **Live → brief** | `caller_profile`, `their_goal`, `stage` sit in a fixed meta row directly under the topic, so the eye returns to the same three spots. |
| Know what to ask next | **Live → brief → "Ask them"** | `suggested_questions`, listed, scannable, never a paragraph. |
| Know what to say | **Live → brief → "You could say"** | `suggested_answers`, each with a copy control. |
| Trust that it is current | **Live → freshness indicator** | A permanent, always-visible "Updated *n* s ago / Refreshing" readout beside the version number. Latency is shown, not hidden — the product's own FAQ says ~3 s and argues why that is enough. |
| Hand over an escalation | **Conversations → detail → Export** | The brief and its sources as a Markdown handover note. |

### P3 — AI platform lead
> "Wants to add a live-conversation copilot to an existing telephony/CRM/meeting stack without
> taking on a new STT vendor dependency or a bespoke integration per channel."
> Objects: *"is the session API really independent of how the transcript arrives?"*

| Job | Screen | How the screen answers the objection |
|---|---|---|
| Prove transport independence in 60 seconds | **Live → start panel** | Three equal-weight source cards: Microphone, Telephony webhook, Typed text. Equal weight *is* the claim. |
| Get the integration snippet | **Live → Telephony webhook** | Copy-paste `POST` snippets with the deployment's real origin and the live session id substituted in, and the `X-API-Key` header shown only when key auth is on. |
| Check which optional vendors are wired up | **Settings → Integrations** | `GET /api/v1/integrations`, booleans and non-secret detail only. |
| Read the contract | Every screen's header | "API docs" in the utility band, honouring `branding.docsUrl`. |

### P4 — Compliance reviewer
> "Needs to sign off a system that suggests things to a person on a live call, with evidence every
> factual claim traces to approved content, and that the system degrades honestly."
> Objects: *"show me a suggested answer can always be traced to a citation."*

| Job | Screen | How the screen answers the objection |
|---|---|---|
| Trace a claim to a source | **Live / Conversations → Sources panel** | Sources accumulate under the brief with their retrieval score; each opens the source. The count is always visible, including when it is zero. |
| See the system refuse rather than invent | **Knowledge → Test a question** | The six-step pipeline stepper shows which step produced the outcome, including a handoff and its reason. |
| See it fail honestly | **Live → stale state** | A failed refresh shows "Last good brief · updated 34 s ago", never an error, never a blank pane. Designed in §4. |
| Audit what was retained | **Quality → turn log**, **Operator → Turn log** | Question text is absent for guard trips, and the UI says so in place rather than in a footnote. |
| Confirm no audio is injected | Everywhere | No "speak", "play" or "answer the caller" control exists outside the explicitly-labelled Voice agent tool in Live. |

### Non-goals, stated so the UI never grows them
No coaching, no scoring, no sentiment, no talk-time, no CRM. The product is the brief. Any screen
proposing otherwise is out of scope (`voicebridge.json → faq`, "What does it not do?").

---

## 2. Information architecture, sitemap and router

### 2.1 Two areas, one shell

| Area | Nav | Audience |
|---|---|---|
| **Workspace** | Live · Conversations · Knowledge · Prospects · Quality · Settings | P1, P2, P3, P4 |
| **Operator** | Overview · Connection · Prospects · Jobs · Logs · Usage · Turn log · Listen sessions · Branding · Security | Deployment operator (`ADMIN_TOKEN`) |

Both use the same app shell — identical chrome, sidebar, header, tables, drawers and type. The
sidebar swaps its nav manifest and shows an `Operator` label chip. The operator area is not a
different product with a different look; that is the whole point of brief item 6.

### 2.2 Sitemap

```
/                                   Live                      (hero workspace; default landing)
  ?session=<id>                       reattach to a running or ended session
  ?source=mic|webhook|text            preselect a source on the start panel
  #voice                              Voice agent tool drawer open
/welcome/                           First-run onboarding
  ?step=1|2|3
/conversations/                     Conversations list
  ?q=&prospect=&status=&from=&to=&sort=&order=&limit=&offset=
  ?...&id=<id>                        conversation detail (filters preserved for Back)
  ?...&id=<id>&v=<n>                  detail, brief version n selected
/knowledge/                         Knowledge
  ?prospect=<key>
  ?prospect=<key>&run=<jobId>         a golden run in progress or just finished
  ?prospect=<key>&eval=<evalId>       a historical result open
  #ask                                the "Test a question" tool focused
/prospects/                         Prospects list
  ?key=<key>                          prospect detail / edit
  ?key=new                            create
/quality/                           Quality
  ?prospect=&outcome=&reason=&source=&limit=&offset=
/settings/                          Settings
  #connection | #branding | #integrations | #access | #about
/admin/                             Operator · Overview
/admin/connection/                  Operator · Connection
/admin/prospects/     ?key=          Operator · Prospects
/admin/jobs/          ?status=&id=   Operator · Jobs
/admin/logs/          ?level=&contains=
/admin/usage/                        Operator · Usage
/admin/turns/         ?prospect=&outcome=&reason=&offset=
/admin/sessions/      ?prospect=&id=  Operator · Listen sessions
/admin/branding/                     Operator · Branding
/admin/security/                     Operator · Security
```

Out of the IA entirely, by decision:
- **"Ask" is no longer a top-level tab.** It becomes the *Test a question* tool inside
  **Knowledge** (§2.4).
- **"Call" is no longer a top-level tab.** It becomes the *Voice agent* tool inside **Live**,
  opened as a drawer (§3.2).
- **"Golden set" is no longer a top-level tab.** It is a panel inside **Knowledge**.

### 2.3 Router decision: multi-document sections, query-string view state

**Chosen:** one real HTML document per nav section, served from a directory so the URL has no file
extension. Record identity and view state live in the **query string**. Navigation *between*
sections is a real document load; navigation *within* a section (list → detail, filter change, tab
change) is `history.pushState()` plus a re-render, no reload.

**File layout** (matches what is on disk):

```
public/
  index.html            → /                     Live
  ui-ext.css                                    all new component CSS (never vendor/)
  brand/arag-logo.svg                           Progress wordmark, light surfaces
  brand/arag-logo-alt.svg                       Progress wordmark, dark surfaces
  app/shell.js                                  <vb-app> shell, nav manifests, branding, theme
  app/icons.js                                  the inline-SVG icon set (§7.7)
  app/route.js                                  params() / go() / onRoute() — ~40 lines
  app/live.js  app/brief.js  app/mic.js  app/call.js
  app/conversations.js  app/knowledge.js  app/prospects.js
  app/quality.js  app/settings.js
  conversations/index.html   knowledge/index.html   prospects/index.html
  quality/index.html         settings/index.html    welcome/index.html
admin/
  index.html  connection/index.html  prospects/index.html  jobs/index.html
  logs/index.html  usage/index.html  turns/index.html  sessions/index.html
  branding/index.html  security/index.html
  admin.js                                      operator controllers, one per view
```

**Why this and not a hash router over a single page**

1. **No build step, and none needed.** Each document links `arag-ui.css`, `ui-ext.css` and one ES
   module. Nothing bundles, nothing transpiles, nothing resolves imports at build time.
2. **The server already does it.** `app.static("/", public)` resolves `/conversations/` →
   `public/conversations/index.html` and 301-redirects `/conversations` → `/conversations/`
   (`vendor/arag-platform/src/http/app.ts`, `serveStatic`). No rewrite rule, no SPA fallback, no
   server change.
3. **Real URLs, for free.** Back, forward, reload, bookmark, open-in-new-tab, and the Playwright
   showcase's `page.goto('/knowledge/?prospect=progress')` all work with zero router code. A hash
   router would require writing, testing and maintaining that behaviour ourselves — net new
   dependency-shaped code in a product whose differentiator is having none.
4. **Payload per screen.** Quality never downloads the microphone/Scribe code; Live never
   downloads the prospect editor. With one page, everything ships to everyone.
5. **Deep links are shareable.** "Look at this call" is a URL a supervisor can paste into chat.
   A hash fragment is never sent to the server and cannot be used for anything else later.

**The one cost, and how it is paid.** A full document load between sections drops in-memory state.
This matters on exactly one screen: **Live**, where a session may be running. It is paid as
follows:

- The open session id is written to `sessionStorage["vb.session"]` on creation, and cleared on End.
- Returning to `/` with a stored id reattaches: `GET /api/v1/listen/sessions/{id}` for the current
  state, then `EventSource` on `/api/v1/listen/sessions/{id}/events` for the stream.
- While a session is live and the user is elsewhere, the sidebar's **Live** item carries a green
  liveness dot and the session's brief version (`Live ● v4`), so leaving is visibly recoverable.
- The session itself is **server-side** — throttling, refresh and the brief all live on the server
  (`ListenService`), which is exactly why a page reload is survivable at all. The browser is a
  viewer, never the owner. This is a property of the architecture, not a workaround.

**Within-section routing contract** (`app/route.js`, ~40 lines, no dependencies):

```js
params()                 // → object from location.search
go(patch, {replace})     // merge patch into the query, pushState, fire 'vb:route'
onRoute(fn)              // fn(params) on load, on 'popstate' and on 'vb:route'
href(patch)              // build a URL for <a href> so links are real links
```

Rules the implementation must follow:
- Every filter, sort, page offset and selected record id is in the URL. Nothing that changes what
  is on screen lives only in memory.
- `null`/empty values are removed from the query rather than serialised as blanks.
- List → detail **merges** (`go({id})`), so Back returns to the list with filters intact.
- Every row, chip and breadcrumb that navigates is an `<a href>` with a real URL, with a click
  handler that calls `go()` and `preventDefault()`s. Middle-click and ⌘-click keep working.

### 2.4 Where the old "Ask" tab goes, and why

**Decision: Knowledge → "Test a question" panel.** Not Live.

Reasoning, in priority order:

1. **Job fit.** Ask (`POST /api/v1/voice-answer`) answers the question *"will this Knowledge Box
   answer this correctly, and hand off when it cannot?"* That is a verification job done by P3 and
   P4 before and between calls. It is not a job anybody does *during* a live conversation.
2. **It would compete with the hero.** Live's argument is that nobody types a query. Putting a
   query box on Live contradicts the product's own positioning in the most visible place in the
   product.
3. **Its neighbours are on Knowledge.** Ask is the single-question form of the golden set; the
   golden set is Ask run ten times with assertions. They share the pipeline, the stepper, the
   citation display and the handoff-reason vocabulary. Side by side, they teach each other.
4. **It keeps a trust surface where compliance looks.** P4 arrives at Knowledge to check
   grounding; finding the prove-it tool there is the shortest path.

The panel keeps the existing six-step pipeline stepper ("What just happened") beneath the answer,
upgraded with per-step timing and the handoff reason (§6, `.vb-pipeline`).

### 2.5 Global objects and scope

- **Prospect** is a global scope selector living in the sidebar, above the nav. It writes
  `?prospect=` into every section that is prospect-scoped (Live, Knowledge, Quality) and persists
  to `localStorage["vb.prospect"]`. Conversations is *not* prospect-scoped by default (you search
  across all) but has a prospect filter in its filter bar.
- **Theme** (light / dark / system) lives in Settings → About, persists to
  `localStorage["vb.theme"]`, and is applied by `shell.js` before first paint to avoid a flash.
- **Density** (comfortable / compact) applies to data tables only, persists to
  `localStorage["vb.density"]`, and is a control on the table toolbar, not a global setting.

---

## 3. Screen-by-screen wireframes

All frames are 1440 px wide. Annotations under each frame give the data source for every region.
Responsive behaviour is specified once in §3.1 (it is the same shell everywhere) and then only
where a screen departs from it.

### 3.1 The shell (every screen, workspace and operator)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▐PROGRESS AGENTIC RAG▌                                      mock  ·  service online  ·  API docs  ·  Help     │ 36
├──────────────────────┬───────────────────────────────────────────────────────────────────────────────────────┤
│  GroundLine          │  Live                                        [ Prospect: Progress ▾ ]  [ End session ] │ 64
│  live conversation   ├───────────────────────────────────────────────────────────────────────────────────────┤
│                      │                                                                                        │
│  ┌────────────────┐  │                                                                                        │
│  │ Progress     ▾ │  │                                                                                        │
│  └────────────────┘  │                          content area, 32 px gutters                                   │
│                      │                                                                                        │
│  ▸ Live         ● v4 │                                                                                        │
│    Conversations     │                                                                                        │
│    Knowledge         │                                                                                        │
│    Prospects         │                                                                                        │
│    Quality           │                                                                                        │
│    Settings          │                                                                                        │
│                      │                                                                                        │
│  ──────────────────  │                                                                                        │
│    Operator      ↗   │                                                                                        │
│                      │                                                                                        │
│                      │                                                                                        │
│  ────────────────────│                                                                                        │
│  Open source ·       │                                                                                        │
│  Apache-2.0          │                                                                                        │
│  v0.2.0              │                                                                                        │
└──────────────────────┴───────────────────────────────────────────────────────────────────────────────────────┘
 ◄──── 248 px ────►    ◄────────────────────────── 1192 px ──────────────────────────────────────────────────►
```

| Region | Source |
|---|---|
| Utility band, left | `public/brand/arag-logo-alt.svg` at `height:16px` (white + `#5ce500`). Hidden with the whole band when `GET /api/v1/branding → poweredBy === false`. |
| Utility band, right | `mock`/`live` chip from `GET /readyz → arag.mock`; `<arag-status endpoint="/readyz">`; **API docs** → `branding.docsUrl`; **Help** → `branding.supportUrl` (item hidden when empty). |
| Sidebar identity | `branding.logoUrl` as `<img style="height:26px">` when set, else `branding.productName` as text (default `GroundLine`); `branding.tagline` beneath at 11 px. |
| Prospect switcher | `GET /api/v1/prospects → items[].key/display_name`. Writes `?prospect=`. |
| Nav | Static manifest in `app/shell.js`. Active item by `location.pathname`. |
| `● v4` on Live | `sessionStorage["vb.session"]` + last `brief` SSE event → `briefVersion`. Dot colour `--vb-live`. Absent when no session. |
| Operator link | `/admin/`. Shown always; the operator area itself gates on `ADMIN_TOKEN`. |
| Sidebar footer | `branding.footerText` (default `Open source · Apache-2.0`) + `GET /readyz → version`. |
| Page header | Breadcrumb/title from the page; right cluster is page actions. |

**When `poweredBy === false`** the utility band is removed entirely and its right-hand cluster
(env chip, status, API docs, Help) moves into the page header's right side, before the page
actions, separated by a 1 px divider. The Progress wordmark then appears nowhere in the chrome.
This is the only branding-driven layout change; everything else is token swaps.

**Responsive (applies to every screen)**

| Breakpoint | Shell | Tables | Multi-pane content |
|---|---|---|---|
| ≥ 1280 px | Sidebar 248 px, expanded | All columns | Full three-pane |
| 1100–1280 px | Sidebar collapses to a 64 px icon rail; labels become `title` tooltips and `aria-label`; the prospect switcher becomes an icon button opening a popover | All columns | Three-pane, rails narrow to 240/300 |
| 700–1100 px | Sidebar becomes off-canvas behind a menu button in the page header; a scrim closes it; focus is trapped while open | Columns marked `data-priority="3"` are hidden | Two columns; the third pane moves below |
| < 700 px | As above; page header wraps to two rows; page actions collapse into an overflow "More" menu | Table becomes stacked cards: each row a `.arag-datatable.cards` article with label/value pairs | Single column; panes become a `.arag-segmented` switcher, first pane default |

No horizontal page scroll at any width. Tables, the transcript and snippet blocks each get their
own `overflow-x:auto` container.

---

### 3.2 Live — empty (no session)

This is the landing screen and the first thing a partner's customer sees. It has one job: make it
obvious that a conversation can come from anywhere, and that there is a one-click way to see it
work.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Live                                                            [ Prospect: Progress ▾ ]       │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                 │
│   Start listening                                                                               │
│   The brief appears here and keeps rewriting itself as the conversation moves.                  │
│                                                                                                 │
│   ┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐       │
│   │ ◻ mic                    │ │ ◻ webhook                │ │ ◻ type                   │       │
│   │ Microphone               │ │ Telephony webhook        │ │ Typed or pasted text     │       │
│   │                          │ │                          │ │                          │       │
│   │ Transcribe from this     │ │ Post transcript chunks   │ │ Paste a transcript, one  │       │
│   │ device.                  │ │ from your phone system.  │ │ line per turn.           │       │
│   │                          │ │                          │ │                          │       │
│   │ ⚠ Needs ElevenLabs       │ │ [ Show instructions ]    │ │ [ Start typing ]         │       │
│   │ [ Use microphone ]       │ │                          │ │                          │       │
│   └──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘       │
│                                                                                                 │
│   ────────────────────────────────────────────────────────────────────────────────────────      │
│                                                                                                 │
│   ▶  Play sample conversation          A recorded discovery call, replayed turn by turn.        │
│                                                                                                 │
│   ────────────────────────────────────────────────────────────────────────────────────────      │
│                                                                                                 │
│   Recent                                                                                        │
│   Progress · 4 min ago · Metal 3D printing for a machine shop   v6 · 12 sources   [ Open ]      │
│   Progress · 2 h ago  · Sintering furnace materials             v3 · 8 sources    [ Open ]      │
│                                                              View all conversations →           │
│                                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Source |
|---|---|
| Source cards | Static. The microphone card's availability from `GET /api/v1/integrations → items[id=scribe].configured` **and** `GET /api/v1/prospects/{key} → scribe_ready`. When unavailable the card is not hidden — it stays, greyed, with the reason, because its presence is part of the transport-independence argument. |
| Telephony "Show instructions" | Expands the card in place into the snippet block below. |
| Play sample conversation | Primary action. Creates a session and replays `SAMPLE_CONVERSATION` from `app/live.js` at 1.4 s intervals via `POST /api/v1/listen/sessions/{id}/transcript`. |
| Recent | `GET /api/v1/listen/sessions?prospect={key}&limit=3&sort=started&order=desc` → `items[].createdAt`, `.prospect`, `.brief.topic`, `.briefVersion`, `.citations.length`. Omitted entirely when `total === 0`. |

**Telephony instructions, expanded** (the `.arag-snippet` component, copy button per block):

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Telephony webhook                                                        [ Hide ]    │
│                                                                                       │
│ 1. Open a session when the call connects.                                  [ Copy ]  │
│    POST https://voicebridge.fly.dev/api/v1/listen/sessions                            │
│    Content-Type: application/json                                                     │
│    X-API-Key: <your key>                                                              │
│                                                                                       │
│    {"prospect":"progress","metadata":{"call_id":"<your call id>"}}                    │
│                                                                                       │
│ 2. Post transcript chunks as they arrive.                                  [ Copy ]  │
│    POST https://voicebridge.fly.dev/api/v1/listen/sessions/{id}/transcript            │
│                                                                                       │
│    {"chunks":[{"speaker":"caller","text":"…","final":true}]}                          │
│                                                                                       │
│ 3. Read the brief.                                                          [ Copy ] │
│    GET https://voicebridge.fly.dev/api/v1/listen/sessions/{id}/events   (SSE)         │
│                                                                                       │
│ 4. End the call.                                                            [ Copy ] │
│    DELETE https://voicebridge.fly.dev/api/v1/listen/sessions/{id}                     │
│                                                                                       │
│ Interim hypotheses: send "final": false. The server throttles refreshes for you.      │
│ Full reference →                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Origin is `location.origin`, substituted live. `{id}` becomes the real session id once a session
  exists, and stays literal otherwise.
- The `X-API-Key` line is present only when key auth is enforced
  (`GET /api/v1/admin/config → apiKeysEnforced`, or the 401 probe result cached by `shell.js`);
  otherwise the line is omitted, not shown commented out.
- "Full reference →" links to `branding.docsUrl + "#tag/listen"`.

---

### 3.3 Live — session running (the hero screen)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Live   ● listening                            [ Prospect: Progress ▾ ]  [ Voice agent ]  [ End session ]│
├──────────────────────┬────────────────────────────────────────────────┬────────────────────────────────┤
│ SOURCE               │ BRIEF                              v4 ·  2.8 s │ TRANSCRIPT              24 turns│
│ ┌──────────────────┐ │ ─────────────────────────────── Updated 3 s ago│ ───────────────────────────────│
│ │ mic│webhook│text │ │                                                │ caller  We run a machine shop, │
│ └──────────────────┘ │ Metal 3D printing for a machine shop           │         mostly stainless steel │
│                      │                                                │         brackets.              │
│ ▌▌▌▌▌▌▁▁▁▁  hearing  │ [ Operations manager ]  [ Replace machining ]  │                                │
│ "…and the budget"    │ [ Discovery ]                                  │ agent   Have you looked at     │
│                      │                                                │         binder jetting?        │
│ [ Pause ]            │ They run a few hundred stainless parts a week  │                                │
│                      │ and are evaluating binder jetting to replace   │ caller  Binder jetting, I      │
│ ── Brief model ────  │ manifold machining. Budget is constrained this │         think. Somebody        │
│ Auto — fast default▾ │ year and titanium is a later requirement.      │         mentioned the Shop    │
│                      │                                                │         System.                │
│ ── Session ────────  │ KEY POINTS                                     │                                │
│ Chunks          24   │ · Shop System is a binder jetting platform     │ caller  What happens after the │
│ Refreshes        4   │ · Debinding and sintering are a separate step  │         printer?               │
│ Throttled        7   │ · PureSinter supports stainless and titanium   │                                │
│ Failures         0   │ · Titanium needs an inert atmosphere           │ agent   There is — debinding   │
│ p50           2.6 s  │                                                │         and sintering.         │
│ p95           4.1 s  │ ASK THEM                                       │                                │
│ Started      14:32   │ · How many manifolds a week?                   │ caller  We would need         │
│                      │ · Is titanium needed this year or next?        │         stainless today, and   │
│ [ Hide controls ]    │                                                │         titanium later.        │
│                      │ YOU COULD SAY                            [ ⧉ ] │                                │
│                      │ "Binder jetting prints the part, then a        │ caller  And honestly the       │
│                      │  separate furnace debinds and sinters it."     │         budget matters.        │
│                      │                                          [ ⧉ ] │                                │
│                      │ "PureSinter handles stainless today and        │ ▁▁▁ hearing …                  │
│                      │  titanium when you need it."                   │                                │
│                      │                                                │ ───────────────────────────────│
│                      │ PRODUCTS TO MENTION                            │ [ Type a turn…            ▸ ]  │
│                      │ [ Shop System ]  [ PureSinter furnace ]        │                                │
│                      │                                                │                                │
│                      │ ─────────────────────────────────────────────  │                                │
│                      │ SOURCES  12                                    │                                │
│                      │ ◻ Shop System datasheet        0.91  ↗         │                                │
│                      │ ◻ PureSinter furnace overview  0.88  ↗         │                                │
│                      │ ◻ Binder jetting explained     0.84  ↗         │                                │
│                      │ Show all 12 ▾                                  │                                │
└──────────────────────┴────────────────────────────────────────────────┴────────────────────────────────┘
 ◄──── 264 px ────►     ◄──────────── 504 px ────────────►                ◄────────── 320 px ──────────►
```

Column widths inside the 1192 px content area (32 px gutters, 20 px gaps): **264 / 504 / 320**.
The brief is the widest pane. "Hide controls" collapses the left rail and widens the brief to
788 px; the state persists to `localStorage["vb.live.rail"]`.

| Region | Source |
|---|---|
| `● listening` | SSE `status` events on `/api/v1/listen/sessions/{id}/events`; `live`/`ended`. Dot `--vb-live`, pulsing. |
| Source segmented control | Local. Switching does not end the session — a session may be fed from several sources at once, which is the point. |
| Level meter + interim line | Microphone only. Interim text from the local Scribe socket before it is posted as `final:false`. |
| Brief model | `GET /api/v1/models?prospect={key}` → `models[]`, `current`. Applies to the *next* refresh; changing it does not restart the session. |
| Session stats | `GET /api/v1/listen/sessions/{id} → stats.*` and SSE `stats` payloads: `chunks`, `refreshes`, `skipped`, `failures`, `p50LatencyMs`, `p95LatencyMs`; `Started` from `createdAt`. |
| Brief header `v4 · 2.8 s` | `briefVersion`, `stats.lastLatencyMs`. |
| Freshness line | Derived client-side from the last `brief` event timestamp and the last `status` event. Full state machine in §4.2. |
| Topic | `brief.topic` (h2, 20 px). |
| Three meta chips | `brief.caller_profile`, `brief.their_goal`, `brief.stage`. Fixed order, fixed position. A missing field omits its chip; the row never shows a placeholder. |
| Summary | `brief.summary` (15 px / 1.6). |
| KEY POINTS | `brief.key_points[]`. |
| ASK THEM | `brief.suggested_questions[]`. |
| YOU COULD SAY | `brief.suggested_answers[]`, each in a `.vb-say` block with a copy control. |
| PRODUCTS TO MENTION | `brief.recommended_products[]` as chips. |
| SOURCES | `citations[]` → `title`, `url`, `score`. Count is the array length. Collapsed to 3 with "Show all *n*". A citation with no `url` renders as a chip without the `↗` and is not clickable. |
| Transcript | SSE `transcript` events, plus `GET /api/v1/listen/sessions/{id}?transcript_tail=50` on attach. Interim entries (`final:false`) render italic at 60 % opacity and are replaced in place. |
| Type a turn | `POST /api/v1/listen/sessions/{id}/transcript` with one chunk. `caller:` / `agent:` prefix parsed for the speaker; default `caller`. |
| End session | `DELETE /api/v1/listen/sessions/{id}`. |

**Section-omission rule (the "leave it empty" promise).** A brief section whose array is empty or
whose string is blank is **not rendered at all** — no heading, no placeholder, no "none". The only
exception is `SOURCES`, which always renders its heading and count, including `SOURCES 0`, because
the absence of sources is itself the compliance signal.

**Version-change feedback.** When `briefVersion` increments, the brief card's left edge shows a
2 px `--vb-live` rail that fades out over 600 ms, and any section whose content changed gets a
one-shot 400 ms background wash at 8 % `--arag-brand-50`. No motion beyond that: the reader is
mid-conversation and content must not jump. Content is replaced in place; the pane never
re-scrolls to the top. Respects `prefers-reduced-motion` by dropping both effects and showing only
the version number change.

---

### 3.4 Live — Voice agent tool (drawer)

The old "Call" tab. Opened by the **Voice agent** header action; URL `#voice`.

```
                                              ┌──────────────────────────────────────────────┐
                                              │ Voice agent                            [ × ] │
                                              ├──────────────────────────────────────────────┤
                                              │ The follow-on capability: the agent answers  │
                                              │ the caller directly when nobody is available │
                                              │ and hands over by a fixed rule.              │
                                              │                                              │
                                              │ Voice                                        │
                                              │ [ Agent default                          ▾ ] │
                                              │                                              │
                                              │ [ Start call ]        ○ idle                 │
                                              │                                              │
                                              │ ─────────────────────────────────────────    │
                                              │ Call transcript                              │
                                              │ you    What is binder jetting?               │
                                              │ agent  Binder jetting prints a part by …     │
                                              │        [ 2 sources ]  3.1 s                  │
                                              │                                              │
                                              │ ─────────────────────────────────────────    │
                                              │ ☑ Feed this call into the listen session      │
                                              │   Turns are appended as transcript chunks so  │
                                              │   the brief keeps up with the call.           │
                                              └──────────────────────────────────────────────┘
                                               ◄──────────── 480 px ─────────────►
```

| Region | Source |
|---|---|
| Voice select | `GET /api/v1/voices → voices[]`. On 503 the select is disabled and the help line reads the copy in §5. |
| Start call | Vendored `public/vendor/elevenlabs-client.js`; the agent's custom tool calls `POST /api/v1/voice-answer`. |
| Per-turn meta | `VoiceAnswerResponse.citations.length`, `latency_ms.total`, and a `handoff` chip with `handoff_reason` when true. |
| Feed into session | When checked (default on, when a session exists), each side of the call is posted to `POST /api/v1/listen/sessions/{id}/transcript`, so the deflection call drives the same evolving brief. This is the reason the tool lives in Live rather than anywhere else. |

Drawer behaviour: focus trap, `Esc` closes, background scroll locked, `aria-modal="true"`,
returns focus to the Voice agent button on close. A live call blocks close with the confirm dialog
in §5.

---

### 3.5 Conversations — list

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Conversations                                                                    [ ↓ Export list ]      │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ⌕ Search what was said…          │ All prospects ▾ │ All │ Live │ Ended │ │ Last 7 days ▾ │ [Clear] │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ 38 conversations                                                     Sort: Started ▾   Density: ▤ ▦    │
│ ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ STARTED ▾     PROSPECT    STATUS   TOPIC                          VER  SRC  TURNS  P50     LAST    │ │
│ ├────────────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Today 14:32   Progress    ● live   Metal 3D printing for a …      v4   12    24    2.6 s   3 s ago │ │
│ │ Today 11:04   Progress    ended    Sintering furnace materials    v6    8    41    2.9 s   3 h ago │ │
│ │ Today 09:17   Tangerine   ended    Mobile plan change             v2    4    11    3.4 s   5 h ago │ │
│ │ Yest. 16:50   Progress    ended    Titanium qualification         v9   12    63    2.4 s   1 d ago │ │
│ │ Yest. 15:02   Progress    ended    —                              v0    0     3    —       1 d ago │ │
│ │ …                                                                                                   │ │
│ ├────────────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Showing 1–25 of 38                                          [ ‹ Previous ]  1 2  [ Next › ]        │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Single request: `GET /api/v1/listen/sessions?q=&prospect=&status=&from=&to=&sort=&order=&limit=&offset=`
→ `{items, total, limit, offset}`.

| Column | Field | Priority | Width |
|---|---|---|---|
| STARTED | `createdAt`, relative + absolute in `title` | 1 | 132 |
| PROSPECT | `prospect`, resolved to `display_name` from `GET /api/v1/prospects` | 1 | 120 |
| STATUS | `status` → `● live` (`--vb-live` dot) / `ended` | 1 | 88 |
| TOPIC | `brief.topic`, truncated with `text-overflow:ellipsis`, `—` when `brief === null` | 1 | flex |
| VER | `briefVersion` | 2 | 56 |
| SRC | `citations.length` | 2 | 56 |
| TURNS | `stats.chunks` | 3 | 64 |
| P50 | `stats.p50LatencyMs` | 3 | 72 |
| LAST | `updatedAt`, relative | 2 | 88 |

- Whole row is a link to `?…&id={id}`; the filter query is preserved so Back returns to this exact
  list. Row height 40 px comfortable / 32 px compact.
- Sort: clicking a header toggles `sort`/`order`. Sortable headers only on `started`, `updated`,
  `refreshes` (VER), `duration` — the four the API supports. Non-sortable headers carry no affordance.
- `q` searches prospect, brief, source titles and the transcript (server-side). Debounced 250 ms;
  each keystroke burst produces one `go({q, offset:0}, {replace:true})`.
- Date range presets: `Any time`, `Today`, `Last 7 days`, `Last 30 days`, `Custom…` (two date
  inputs) → `from`/`to` as ISO instants.
- "Export list" downloads the current filtered page as CSV, built client-side from `items` — no
  API needed, and it is honest about being the current filter.

---

### 3.6 Conversations — detail

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Conversations  ·  Progress · Today 14:32                        [ ↓ Export ▾ ] [ Resume ] [ ⋯ ]      │
│ Metal 3D printing for a machine shop                                                                    │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐                        │
│ │ STATUS   │ DURATION │ VERSIONS │ SOURCES  │ TURNS    │ P50      │ P95      │                        │
│ │ ended    │ 11 m 04 s│ 6        │ 12       │ 41       │ 2.9 s    │ 4.6 s    │                        │
│ └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘                        │
├──────────────────────┬────────────────────────────────────────────────┬────────────────────────────────┤
│ BRIEF HISTORY        │ BRIEF  v6                          final       │ TRANSCRIPT │ SOURCES  12       │
│                      │ ─────────────────────────────────────────────  │ ───────────────────────────────│
│ ● v6  14:43  2.4 s   │ Metal 3D printing for a machine shop           │ 14:32:11 caller  We run a      │
│ │                    │                                                │          machine shop…         │
│ ○ v5  14:41  3.1 s   │ [ Operations manager ] [ Replace machining ]   │ 14:32:19 agent   Have you      │
│ │                    │ [ Discovery ]                                  │          looked at binder…     │
│ ○ v4  14:39  2.8 s   │                                                │ 14:32:31 caller  Binder        │
│ │                    │ They run a few hundred stainless parts a week… │          jetting, I think…     │
│ ○ v3  14:37  2.6 s   │                                                │ …                              │
│ │                    │ KEY POINTS                                     │                                │
│ ○ v2  14:35  4.9 s   │ · Shop System is a binder jetting platform     │ ⚠ Earliest turns trimmed —     │
│ │                    │ · …                                            │   the service keeps the last   │
│ ○ v1  14:33  3.3 s   │                                                │   400 turns of a session.      │
│                      │ ASK THEM / YOU COULD SAY / PRODUCTS…           │                                │
│ Compare with v5 ▾    │                                                │                                │
└──────────────────────┴────────────────────────────────────────────────┴────────────────────────────────┘
 ◄──── 220 px ────►     ◄──────────── 548 px ────────────►                ◄────────── 320 px ──────────►
```

| Region | Source |
|---|---|
| Breadcrumb | `‹ Conversations` links back with the preserved filter query. |
| Title | `brief.topic`, falling back to `Conversation {id first 8}` when null. |
| Stat strip | `GET /api/v1/listen/sessions/{id}` → `status`, `createdAt`/`endedAt` (duration), `briefVersion`, `citations.length`, `stats.chunks`, `stats.p50LatencyMs`, `stats.p95LatencyMs`. |
| Brief history | **`GET /api/v1/listen/sessions/{id}/briefs`** (API gap §9.1) → `items[].version/at/latencyMs`. Selecting a version sets `?v=`. `final` chip on the newest. |
| Brief pane | The selected version's `brief` object, rendered by the same `.vb-brief` renderer as Live — identical markup, so the reviewer sees exactly what the agent saw. |
| Compare with v5 | Diff mode: fields that changed from the previous version get a left rail and a 6 % brand wash; removed items show struck through in `--arag-text-subtle`. Off by default. |
| Transcript / Sources | Two tabs in the right pane. Transcript: `GET …/{id}?transcript_tail=400` → `transcript[]` with `ts` shown at `HH:MM:SS`. Sources: `citations[]` with score and link. |
| Trim notice | Shown when `transcriptTotal >= 400`. |
| Export ▾ | `GET /api/v1/listen/sessions/{id}/export?format=json` and `?format=markdown`. Two menu items: "JSON (full record)" and "Markdown (handover note)". |
| Resume | Only when `status === "live"` — navigates to `/?session={id}`. Replaced by nothing when ended (not a disabled button). |
| ⋯ | Overflow: "Copy session id", "Copy link", and for operators "Delete conversation" (API gap §9.5, destructive confirm). |

---

### 3.7 Knowledge

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Knowledge                                                              [ Prospect: Progress ▾ ]         │
├──────────────────────────────────────────────────────────┬─────────────────────────────────────────────┤
│ KNOWLEDGE BOX                              ● connected   │ TEST A QUESTION                             │
│ ───────────────────────────────────────────────────────  │ ──────────────────────────────────────────  │
│ Knowledge Box      …3f7a21                               │ The same pipeline the phone call uses.      │
│ Region             aws-us-east-2-1                       │                                             │
│ Resources          1,284                                 │ [ Ask something the knowledge base can  ] ▸ │
│ Search config      progress_voice                        │                                             │
│ Answer model       gemini-2.5-flash                      │ [ What is binder jetting? ] [ PureSinter ]  │
│ Brief model        gemini-2.5-flash-lite                 │ [ Capital of France? ]                      │
│ Reranker           predict                               │                                             │
│ Last checked       12 s ago · 210 ms                     │ ┌─────────────────────────────────────────┐ │
│                                        [ Test connection]│ │ Binder jetting prints a part by         │ │
│                                                          │ │ depositing binder into a powder bed.    │ │
│ ─────────────────────────────────────────────────────────│ │ [ 3 sources ] [ answered ]  2.9 s       │ │
│ GOLDEN SET                                      10 cases │ └─────────────────────────────────────────┘ │
│ ───────────────────────────────────────────────────────  │                                             │
│ QUESTION                              EXPECT   MUST      │ WHAT JUST HAPPENED                          │
│ Tell me about the PureSinter furnace  answer   sinter    │ ● Input safety guard              1 ms      │
│ Which makers do binder jetting?       answer   Desktop…  │ ● ARAG ask (retrieval + generation) 2,740 ms│
│ What is the capital of France?        handoff  —         │ ● Deterministic handoff check      —        │
│ …                                                        │ ● Voice shaping                    2 ms     │
│                                     [ Edit golden set → ]│ ● Citations                        3 sources│
│                                                          │ ● Output safety guard              1 ms     │
│ [ ▶ Run golden set ]   last run: 10/10 · 2 h ago         │                                             │
│                                                          │                                             │
│ ─────────────────────────────────────────────────────────│                                             │
│ RUN HISTORY                                              │                                             │
│ WHEN            RESULT      P50     P95      │           │                                             │
│ 2 h ago         ✓ 10 / 10   2.8 s   4.9 s    │ [ Open ]  │                                             │
│ Yesterday 18:02 ✗ 8 / 10    3.1 s   6.2 s    │ [ Open ]  │                                             │
│ Mon 09:41       ✓ 10 / 10   2.7 s   4.4 s    │ [ Open ]  │                                             │
│                                     Showing 3 of 12 ▾    │                                             │
└──────────────────────────────────────────────────────────┴─────────────────────────────────────────────┘
 ◄────────────────── 700 px ──────────────────────►          ◄──────────── 460 px ────────────►
```

| Region | Source |
|---|---|
| Knowledge Box card | `GET /api/v1/knowledge?prospect={key}` → `KnowledgeStatus`: masked kb id, region, `resources`, `ask_config`, `generative_model`, `brief_model`, `reranker`, `ok`, `ms`, `checkedAt`. The full kb id is operator-only and appears in Operator → Connection. |
| Test connection | Re-requests `GET /api/v1/knowledge?prospect=` with a cache-busting header; the row shows a spinner in place, never a full-card skeleton. |
| Golden set table | `GET /api/v1/prospects/{key} → golden_questions[]` (`q`, `expect`, `must_include`). Read-only here. "Edit golden set →" goes to `/prospects/?key={key}#golden`. |
| Run golden set | `POST /api/v1/golden-evals {prospect}` → 202 `{job}`; sets `?run={job.id}`; renders `<arag-job-timeline events-src="/api/v1/jobs/{id}/events">`; on `succeeded` loads `GET /api/v1/golden-evals/{job.id}` and opens the result. |
| last run | `GET /api/v1/golden-evals?prospect={key}&limit=1` → `items[0].passed/total/createdAt`. |
| Run history | `GET /api/v1/golden-evals?prospect={key}&limit=10&offset=` → `{items, total}`; columns from `createdAt`, `ok`, `passed`/`total`, `latency_ms.p50/p95`. "Open" sets `?eval={id}` and opens the result drawer. |
| Test a question | `POST /api/v1/voice-answer {prospect, question}` → answer bubble, `citations.length` chip, `handoff`/`answered` chip, `latency_ms.total`. |
| Suggestion chips | The prospect's `golden_questions[].q`, first three, including one `expect:"handoff"` question so the refusal behaviour is one click away. |
| What just happened | `.vb-pipeline`, six fixed steps, timings from `latency_ms.retrieve` / `first_token` / `total` and `handoff_reason`. On a handoff, the "Deterministic handoff check" step turns amber and names the reason. |

**Golden result drawer** (`?eval={id}`): per-case rows — question, expected, got, latency, and the
check list from `GoldenCase.checks[]` (`{ok, label}`) as pass/fail lines. Failed cases sort first.

---

### 3.8 Prospects — list

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Prospects                                                                            [ + New prospect ] │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ⌕ Filter prospects…                                                              Density: ▤ ▦      │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ KEY ▾      NAME         LOCALE  KNOWLEDGE BOX  SEARCH CONFIG   GOLDEN SET   BRAND     UPDATED      │ │
│ ├────────────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ progress   Progress     en-US   …3f7a21 ●      progress_voice  10 · ✓ pass  —         2 h ago      │ │
│ │ tangerine  Tangerine    en-AU   …000000 ●      tangerine_voice  8 · ✗ 6/8   ◆ custom  3 d ago      │ │
│ │ northwind  Northwind    en-GB   …9b2c04 ✗      inline           0 · not run —         5 d ago      │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Operator-authenticated: `GET /api/v1/admin/prospects → items[]` (`id`, `display_name`, `locale`,
  `kb_id` masked in the cell, `ask_config`, `golden_questions.length`, `brand`, `updatedAt`).
- Knowledge Box health dot from `GET /api/v1/admin/health → prospects[].ok/ms`.
- Golden state from `GET /api/v1/golden-evals?limit=100`, latest per prospect.
- **Unauthenticated** it degrades to the public projection `GET /api/v1/prospects → items[]`
  (key, display name, locale, golden set size) with the `.arag-authgate` panel above the table and
  no New/Edit/Delete affordances. See §4.8.
- Sorting and filtering are client-side (a registry is tens of rows, not thousands) — no API change.

### 3.9 Prospects — detail / edit

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Prospects  ·  progress                              [ Provision search config ]  [ Save changes ]     │
│ Progress                                                                                                │
├──────────────────────┬─────────────────────────────────────────────────────────────────────────────────┤
│ Identity             │ IDENTITY                                                                         │
│ Knowledge Box        │ Key            [ progress                    ]  lowercase, digits, - and _       │
│ Retrieval and model  │ Display name   [ Progress                    ]                                   │
│ Conversation         │ Locale         [ en-US                       ]                                   │
│ Golden set           │                                                                                  │
│ Branding             │ KNOWLEDGE BOX                                                                    │
│ Voice and avatar     │ Knowledge Box  [ 3f7a2140-…-9c11             ]  ● connected · 210 ms · 1,284 res │
│ Danger zone          │ Region         [ aws-us-east-2-1             ]                                   │
│                      │ Search config  [ progress_voice              ]  stored ask configuration         │
│                      │                                                                                  │
│                      │ RETRIEVAL AND MODEL                                                              │
│                      │ Reranker       ( ) noop   (•) predict                                            │
│                      │ Answer model   [ gemini-2.5-flash          ▾ ]  ⚡⚡ speed ★★ quality $$ price    │
│                      │ Brief model    [ gemini-2.5-flash-lite     ▾ ]  the brief needs low latency      │
│                      │ Max tokens     [ 160     ]   Temperature [ 0   ]                                 │
│                      │                                                                                  │
│                      │ CONVERSATION                                                                     │
│                      │ Greeting       [ Hi, thanks for calling. I can help with…                    ]   │
│                      │ Handoff line   [ Let me hand you over to a specialist who can help with that.]   │
│                      │                                                                                  │
│                      │ GOLDEN SET                                                   [ + Add question ]  │
│                      │ QUESTION                                 EXPECT     MUST INCLUDE                 │
│                      │ [ Tell me about the PureSinter furnace ] [answer ▾] [ sinter          ]   [ × ]  │
│                      │ [ What is the capital of France?       ] [handoff▾] [ —               ]   [ × ]  │
│                      │                                                                                  │
│                      │ BRANDING OVERLAY                                          [ Reset to default ]   │
│                      │ Product name  [ Tangerine Assist  ]     ┌────────────────────────────────┐       │
│                      │ Tagline       [ live call support ]     │ ▐PROGRESS▌                     │       │
│                      │ Logo URL      [ /branding/tan.svg ]     │ ┌──────┬───────────────────┐   │       │
│                      │ Primary       [ #1f3a93 ] ■             │ │ Tan… │ Live      ● v4    │   │       │
│                      │ Accent        [ #ff7a00 ] ■             │ │ ▸Live│ ████████████      │   │       │
│                      │ Footer text   [ © Tangerine 2026  ]     │ └──────┴───────────────────┘   │       │
│                      │ ☑ Show "Built on Progress Agentic RAG"  └────────────────────────────────┘       │
│                      │                                          live preview                            │
│                      │ DANGER ZONE                                                                      │
│                      │ Delete this prospect and everything scoped to it.        [ Delete prospect ]     │
└──────────────────────┴─────────────────────────────────────────────────────────────────────────────────┘
```

- Loads `GET /api/v1/admin/prospects/{key}` → `ProspectRecord`. Saves `PUT` with `ProspectInput`.
  `?key=new` posts `POST /api/v1/admin/prospects {key, config}`; 409 shows the inline key error.
- Field-level validation mirrors `validateProspect()` exactly (`FieldError.path` → the field).
  Server `FieldError[]` responses are mapped back onto the same fields; nothing is reported only
  in a toast.
- Answer/brief model selects: `GET /api/v1/models?prospect={key}` → `models[]` with
  `speed`/`quality`/`price` rendered as the ⚡/★/$ triple already used in the console.
- Provision search config: `POST /api/v1/admin/prospects/{key}/provision` — shows a
  "Dry run first" checkbox mapping to `dry_run:true`, and renders the returned `config` in
  `<arag-json>` before the real run.
- Branding overlay writes `config.brand` (the seven `ProspectBrand` fields). The live preview is
  `.vb-brandpreview`: the shell at 1/4 scale with `primaryColor`/`accentColor` applied as inline
  custom properties, the logo loaded, and the band toggled by `poweredBy`. Invalid colours are
  rejected by the same grammar as `isSafeColor()` and the field shows the error inline.
- Delete requires typing the key (`.arag-confirm` type-to-confirm), per brief item 6.
- The left column is an in-page section nav (scroll-spy), not tabs; the form is one document so
  Save is one action.

---

### 3.10 Quality

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Quality                                                    [ Prospect: All ▾ ]   [ Window: Recent ▾ ]   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐                               │
│ │ TURNS   │ P50     │ P95     │ P50 1ST │ HANDOFF │ CITATION│ GUARD   │                               │
│ │ 214     │ 2.9 s   │ 5.6 s   │ 1.4 s   │ 18 %    │ 97 %    │ 2 %     │                               │
│ └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘                               │
│  turns in the window      total latency       first token    of turns    of answered turns  of turns   │
├──────────────────────────────────────────────────────────┬─────────────────────────────────────────────┤
│ HANDOFF AND GUARD REASONS                                │ BY PROSPECT                                 │
│ ───────────────────────────────────────────────────────  │ ──────────────────────────────────────────  │
│ sentinel             ████████████████████  24            │ progress    ███████████████████  168        │
│ no-retrieval         ████████  9                         │ tangerine   ████  38                        │
│ not-found-phrase     ████  5                             │ northwind   █  8                            │
│ prompt-injection ⚠   ██  2   guard                       │                                             │
│ upstream-error       █  1                                │                                             │
├──────────────────────────────────────────────────────────┴─────────────────────────────────────────────┤
│ TURN LOG                            [ All │ Answered │ Handoff │ Guard ]   [ Reason: any ▾ ]           │
│ ┌────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ TIME      PROSPECT   QUESTION                             RESULT           TOTAL  1ST TOK  CITES   │ │
│ ├────────────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ 14:41:02  progress   What materials does PureSinter…      answered         2.7 s  1.2 s    4       │ │
│ │ 14:39:55  progress   What is the capital of France?       handoff sentinel 1.9 s  0.9 s    0       │ │
│ │ 14:38:10  progress   ⊘ not stored                         guard  injection 0.0 s  —        0       │ │
│ │ …                                                                                                   │ │
│ ├────────────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Showing 1–100 of 214                                        [ ‹ Previous ]  [ Next › ]             │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Source |
|---|---|
| Stat strip | `GET /api/v1/metrics?prospect=` → `turns`, `latency_total_ms.p50/p95`, `latency_first_token_ms.p50`, `handoff_rate`, `citation_coverage`, `guard_trip_rate`. Rates rendered as percentages with the denominator named in the caption line underneath — "of answered turns" for citation coverage, because that is what `MetricsService` actually computes. |
| Window | `GET /api/v1/metrics?window=` (API gap §9.3). Until that lands, the control is absent and the strip caption reads "over the recent window (last 500 turns)" — the honest description of the ring buffer. |
| Reasons | `GET /api/v1/turns?prospect= → reasons[]` (`reason`, `count`, `guard`). Bars are `.arag-progress` at row width; guard reasons carry the warning icon and an amber bar. Clicking a bar sets `?reason=`. |
| By prospect | `GET /api/v1/metrics → by_prospect{}`. Clicking sets `?prospect=`. |
| Turn log | `GET /api/v1/turns?prospect=&outcome=&reason=&source=&limit=&offset=` → `{items, total}`. |
| `⊘ not stored` | Rendered for `guard_trip === true`, where `question` is absent. The cell explains the absence in place: a `title` of "Question text is not retained for turns that tripped a safety guard." |

The turn log is public (`GET /api/v1/turns`), so Quality needs no operator sign-in. The operator
area's Turn log (§10) is the same data with the full log ring and no prospect scoping.

---

### 3.11 Settings

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Settings                                                                                                │
├──────────────────────┬─────────────────────────────────────────────────────────────────────────────────┤
│ Connection           │ CONNECTION                                                                       │
│ Branding             │ Service          ● online · v0.2.0 · up 4 h 12 m                                 │
│ Integrations         │ Knowledge Box    ● connected · aws-us-east-2-1 · 210 ms · 1,284 resources        │
│ Access               │ Mode             mock ARAG                            [ Test connection ]        │
│ About                │ Prospects        3 configured                                                    │
│                      │                                                                                  │
│                      │ BRANDING                                                                         │
│                      │ Set by environment variables. Changing them needs a restart.                     │
│                      │ ┌──────────────────────────────┐  BRAND_PRODUCT_NAME   GroundLine                │
│                      │ │ ▐PROGRESS AGENTIC RAG▌       │  BRAND_TAGLINE        live conversation support │
│                      │ │ ┌──────┬───────────────────┐ │  BRAND_LOGO_URL       — (wordmark only)         │
│                      │ │ │Groun…│ Live     ● v4     │ │  BRAND_PRIMARY_COLOR  — (kit default)           │
│                      │ │ │▸Live │ ████████████      │ │  BRAND_ACCENT_COLOR   — (#5ce500)               │
│                      │ │ │ Conv…│ ████████          │ │  BRAND_POWERED_BY     on                        │
│                      │ │ └──────┴───────────────────┘ │  BRAND_FOOTER_TEXT    — (Apache-2.0)            │
│                      │ └──────────────────────────────┘  BRAND_DOCS_URL       /api/v1/docs              │
│                      │  live preview                     BRAND_SUPPORT_URL    —                         │
│                      │                                   White-label guide →                            │
│                      │                                                                                  │
│                      │ INTEGRATIONS                                                                     │
│                      │ ElevenLabs Scribe    ● configured    microphone transcription in Live            │
│                      │ ElevenLabs Voices    ● configured    the voice agent tool                        │
│                      │ LiveKit              ○ not set       LIVEKIT_URL, LIVEKIT_API_KEY, …             │
│                      │ LiveAvatar           ○ not set       needs LiveKit                    Docs →     │
│                      │                                                                                  │
│                      │ ACCESS                                                                           │
│                      │ Public API           open · rate limited per IP                                  │
│                      │ API keys             not enforced — set API_KEYS to require X-API-Key            │
│                      │ Browser session      active · expires in 11 h                                    │
│                      │ Operator             signed in                            [ Sign out ]           │
│                      │                                                                                  │
│                      │ ABOUT                                                                            │
│                      │ Appearance           ( ) Light  ( ) Dark  (•) Match system                       │
│                      │ Version              0.2.0 · platform v0.1.8                                     │
│                      │ Licence              Apache-2.0                            Source →              │
└──────────────────────┴─────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Source |
|---|---|
| Connection | `GET /readyz` → `ok`, `version`, `arag.ok/ms/mock`, `prospects`; uptime from `GET /api/v1/admin/health → uptimeSec` when operator, otherwise omitted. |
| Branding table | `GET /api/v1/branding` → the nine fields, each shown with its `BRAND_*` variable name so the operator knows what to change. Empty values render as `—` plus the effective default in parentheses. |
| Branding preview | `.vb-brandpreview` with the live payload. |
| Integrations | `GET /api/v1/integrations → items[]` (`id`, `label`, `configured`, `detail`, `envVars[]`, `docsUrl`). Never renders a value that could be a secret. |
| Access | `GET /api/v1/admin/config` when operator (`apiKeysEnforced`, rate limits); otherwise inferred: a 401 from a key-protected probe means enforced. Browser session from the `arag_session` cookie's expiry echoed by `POST /api/v1/session`. |
| Sign out | Clears the admin cookie (`POST /api/v1/admin/login` with an empty token is **not** used — the front-end deletes the cookie and reloads; see §10.1). |
| Appearance | Local only. |

Branding is deliberately **read-only** here. It is environment configuration, not application
state, and pretending otherwise would be the single most misleading thing in the product.

---

### 3.12 First-run onboarding (`/welcome/`)

Shown when `localStorage["vb.onboarded"] !== "1"` **and**
`GET /api/v1/listen/sessions?limit=1 → total === 0`. `/` redirects to `/welcome/`; every other
route is reachable directly and shows a dismissible "Take the tour" link in the page header
instead.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                                         │
│   ▐PROGRESS AGENTIC RAG▌                                                                                │
│                                                                                                         │
│   Set up GroundLine                                                          Step 1 of 3                │
│   ●───────○───────○                                                                                     │
│                                                                                                         │
│   Choose what it listens about                                                                          │
│   A prospect points GroundLine at one Knowledge Box and carries its greeting, handoff line and           │
│   golden set.                                                                                           │
│                                                                                                         │
│   ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐          │
│   │ ◉ Progress                │  │ ○ Tangerine               │  │ ○ Northwind               │          │
│   │   en-US · 10 golden cases │  │   en-AU · 8 golden cases  │  │   en-GB · no golden set   │          │
│   │   ● Knowledge Box ready   │  │   ● Knowledge Box ready   │  │   ✗ cannot reach the KB   │          │
│   └───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘          │
│                                                                                                         │
│                                                             [ Skip setup ]      [ Continue ]            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Step 2 — **Check the connection**: runs `GET /api/v1/knowledge?prospect={key}` and shows the six
rows from §3.7 with a pass/fail line, plus "What this means" one-liners. If it fails, the step
offers "Open Operator → Connection" and lets the user continue anyway with the sample.

Step 3 — **Start**: three actions, one primary.

```
│   You are ready                                                              Step 3 of 3                │
│   ●───────●───────●                                                                                     │
│                                                                                                         │
│   ▶  Play sample conversation                                                                           │
│      A recorded discovery call, replayed turn by turn. Watch the brief build.                           │
│                                                                                                         │
│   ⌨  Paste your own transcript                                                                          │
│      One line per turn, prefixed caller: or agent:.                                                     │
│                                                                                                         │
│   ⇲  Connect a telephony webhook                                                                        │
│      Two POST requests from the system you already have.                                                │
```

Each sets `localStorage["vb.onboarded"]="1"` and navigates to `/` with `?source=` preset, or, for
the sample, to `/` with the sample already playing.

---

## 4. State inventory

Every screen has six states. The rule that governs all of them:

> **Never replace content with a failure.** A region that had good content keeps it and gains a
> qualifier. A region that never had content explains what would put content there.

### 4.1 Global state rules

| State | Rendering rule |
|---|---|
| **Loading (first)** | `.arag-skeleton` blocks matching the final layout's shape and count. Never a spinner in a full-page overlay, never a centred "Loading…". Tables show 5 skeleton rows at the configured row height. Skeletons appear only after 200 ms, so a fast response never flashes. |
| **Loading (refresh)** | The existing content stays and dims to 70 % opacity; the refreshing control shows an inline 12 px spinner. No layout change, no scroll change. |
| **Empty** | `.arag-emptystate`: icon (20 px, `--arag-text-subtle`), title (15 px, `--arag-text`), one sentence of body (13 px, muted), one primary action. Never more than two actions. Never an illustration. |
| **Populated** | As §3. |
| **Error** | Inline, scoped to the region that failed, using `.arag-alert.error`: what failed, in product terms; the recovery action as a button; the request id in `mono small` when the problem body carries one. Toasts are used only for actions the user just triggered (save, delete, copy), never for background failures. |
| **Degraded** | `.arag-alert.warn` **above** the content, content still shown. Used when data is present but stale, partial, or produced with a fallback. |
| **Permission denied** | `.arag-authgate` replaces the panel body only: a lock icon, the reason the panel is gated, a token field, "Sign in". Never a redirect, never a modal, never a blank page. |

Copy for every one of these is in §5.4–§5.7.

### 4.2 Live — the brief freshness state machine (the core promise)

This is the design of *"a failed refresh leaves the last good brief in place rather than blanking
it"*. It is a **staleness indicator, not an error**.

```
                    SSE status:refreshing
   ┌────────────┐ ────────────────────────► ┌─────────────┐
   │  FRESH     │                           │ REFRESHING  │
   │ ● green    │ ◄──────────────────────── │ ● blue pulse│
   └────────────┘   SSE brief (version++)   └─────────────┘
        │                                          │
        │ >20 s since last brief                   │ SSE status:skipped  (reason=refresh-failed)
        ▼                                          │ or no brief within 15 s
   ┌────────────┐                                  │
   │  STALE     │ ◄────────────────────────────────┘
   │ ◐ amber    │
   └────────────┘
        │ 3 consecutive failures
        ▼
   ┌────────────────────┐
   │ STALE + RETRY      │
   │ ◐ amber [Retry now]│
   └────────────────────┘
```

| State | Trigger | Brief pane | Indicator (top-right of the brief header) | Colour |
|---|---|---|---|---|
| **Waiting** | Session open, `briefVersion === 0` | Empty state: "Listening. The brief appears once there is enough conversation." | `● listening` | `--vb-live` |
| **Fresh** | `brief` event received < 20 s ago | Brief, fully opaque | `Updated 3 s ago` with a `--vb-live` dot | green |
| **Refreshing** | `status:refreshing` | Brief, unchanged, **not dimmed** | `Refreshing` with a pulsing `--arag-brand-500` dot | blue |
| **Throttled** | `status:skipped`, reason `nothing-relevant-yet`, or the append response says `refresh:"skipped"` | Brief, unchanged | `Waiting for new conversation` | muted, no dot |
| **Stale** | ≥ 20 s since the last `brief`, or one failed refresh | Brief, unchanged, **still fully opaque**, plus a 2 px amber top rail on the card | `Last good brief · updated 34 s ago` | amber |
| **Stale + retry** | 3 consecutive failures, or ≥ 60 s stale | As above | `Last good brief · refresh failing` + `[ Retry now ]` | amber |
| **Reconnecting** | `EventSource.onerror` | Brief, unchanged | `Reconnecting…` | amber |
| **Ended** | `status:ended` | Brief, unchanged, header gains a `final` chip | `Session ended · v6` | muted |

Hard rules, restated because this is the promise the product is sold on:

1. The brief pane is **never** emptied by a failure. The only transition out of showing a brief is
   the user starting a new session.
2. No `.arag-alert.error`, no red, no toast, no modal for a failed refresh. Amber, in place, one
   line.
3. The words "error" and "failed" do not appear in the fresh/stale indicator. "refresh failing" is
   the strongest phrasing permitted, and only after three consecutive failures.
4. `stats.failures` keeps counting in the session panel — the number is honest even though the
   pane is calm. That is where an operator looks; it is not shouted at the person on the call.
5. `Retry now` calls **`POST /api/v1/listen/sessions/{id}/refresh`** (API gap §9.2). Until that
   endpoint exists, the button posts a zero-width transcript keep-alive chunk is **not**
   acceptable — the button is simply omitted and the indicator stops at "Last good brief".

### 4.3 Live

| State | Condition | Copy / rendering |
|---|---|---|
| Loading | Attaching to `?session=` | Skeleton in all three panes, 400 ms max before content or error |
| Empty | No session | §3.2 start panel |
| Populated | Session live | §3.3 |
| Error — create failed | `POST /api/v1/listen/sessions` non-2xx | `.arag-alert.error` above the start panel: "Could not start a session. {detail}" + `[ Try again ]` |
| Error — unknown prospect | 404 with `ProspectNotFoundError` | "That prospect is not in the registry. Choose another, or add it in Prospects." + `[ Open Prospects ]` |
| Error — session gone | 404 on attach | "That session no longer exists. The service keeps the 200 most recent sessions." + `[ Start a new session ]`. Clears `sessionStorage`. |
| Error — session ended | 409 on append | Inline under the composer: "This session has ended. Start a new one to keep listening." + `[ Start a new session ]` |
| Degraded — rate limited | 429 on append | Inline, amber: "Too many updates. The brief is rate limited to protect the Knowledge Box. Resuming in {n} s." Auto-retries with backoff; the composer stays usable. |
| Degraded — SSE lost | `onerror` | Amber pill in the header: "Reconnecting…". Falls back to polling `GET /api/v1/listen/sessions/{id}` every 3 s after 2 failed reconnects, and says so: "Reconnected by polling." |
| Permission — no key | 401 on any listen call | `.arag-authgate` over the start panel: "This deployment requires an API key." + `[ Sign in as operator ]`, plus the note that a same-origin session is normally issued automatically. |
| Degraded — no microphone | `GET /api/v1/integrations → scribe.configured === false`, or `POST /api/v1/scribe-token` 503 | The microphone card stays, greyed, with "Not configured on this deployment" and `[ How to configure ]`. The other two sources are unaffected — the point survives. |
| Degraded — mic denied | `getUserMedia` NotAllowedError | "Microphone access was refused by the browser. Allow it in the address bar, or paste a transcript instead." |

### 4.4 Conversations

| State | Copy / rendering |
|---|---|
| Loading | 5 skeleton rows; the filter bar renders immediately and is usable |
| Empty — none at all (`total === 0` and no filters) | Title "No conversations yet" · Body "Sessions appear here once a listen session has run. Start one on Live." · `[ Go to Live ]` |
| Empty — filters exclude all | Title "No conversations match these filters" · Body "Try a wider date range, or clear the search." · `[ Clear filters ]` |
| Populated | §3.5 |
| Error | `.arag-alert.error` replacing the table body: "Could not load conversations. {detail}" · `[ Retry ]`. The filter bar stays. |
| Degraded — partial | If `GET /api/v1/prospects` fails, prospect keys render raw instead of display names, with a one-line amber note "Showing prospect keys — the prospect list could not be loaded." |
| Detail: loading | Stat strip skeleton + three pane skeletons |
| Detail: empty brief | `briefVersion === 0`: the brief pane shows "No brief was produced. The conversation did not reach the minimum before it ended." and the version rail is empty |
| Detail: error 404 | Full-panel empty state: "This conversation no longer exists." · `[ Back to conversations ]` |
| Detail: degraded | `/briefs` unavailable: the version rail hides and the brief pane shows the final version with an amber line "Only the final brief is available for this conversation." |

### 4.5 Knowledge

| State | Copy / rendering |
|---|---|
| Loading | Card-shaped skeletons; the "Test a question" input is enabled immediately |
| Empty — no golden set | Title "No golden set for this prospect" · Body "A golden set is the gate before a prospect answers on its own. Add the questions it must get right." · `[ Add questions ]` → `/prospects/?key={key}#golden` |
| Empty — no runs | Run history area: "Not run yet." with the `[ ▶ Run golden set ]` button as the only action |
| Populated | §3.7 |
| Error — KB unreachable | The Knowledge Box card keeps its rows and shows them as last-known, with an amber header chip `● unreachable` and "Last successful check {time}. {detail}" + `[ Test connection ]`. Values are not blanked. |
| Error — run failed | The job timeline's failed stage turns red with `job.error.message`; the history table is untouched; `[ Run again ]` |
| Degraded — partial run | Job `cancelled`: "Run stopped after {n} of {total} questions." with the partial result still openable |
| Error — ask failed | The answer area shows `.arag-alert.error` with the detail; the pipeline stepper marks the step that failed; previous answers stay |
| Permission | Not gated — all endpoints used here are public |

### 4.6 Prospects

| State | Copy / rendering |
|---|---|
| Loading | 3 skeleton rows |
| Empty | Title "No prospects yet" · Body "A prospect points GroundLine at a Knowledge Box and carries its greeting, handoff line and golden set." · `[ + New prospect ]` |
| Populated | §3.8 |
| Permission denied | `.arag-authgate` above a read-only table built from `GET /api/v1/prospects`. Title "Operator sign-in required to edit" · Body "Registry entries contain Knowledge Box ids. Signing in shows and edits them." · token field + `[ Sign in ]`. The read-only list is still shown — a locked door with a window, not a wall. |
| Editor: unsaved changes | A sticky footer bar: "Unsaved changes" + `[ Discard ]` `[ Save changes ]`; `beforeunload` guard; navigating within the section prompts with `.arag-confirm` |
| Editor: validation | Per-field `.arag-field.invalid` with the message under the control, from `FieldError.path`. A summary alert at the top lists the count and links to the first invalid field. |
| Editor: save error 409 | Inline on the Key field: "That key is already in use." |
| Editor: provision dry run | `<arag-json>` of the returned `config`, with `[ Apply for real ]` |
| Editor: delete | `.arag-confirm`: "Delete prospect {key}? This removes its registry entry, its golden set and its branding overlay. Conversations already recorded are kept. Type {key} to confirm." |

### 4.7 Quality

| State | Copy / rendering |
|---|---|
| Loading | Stat strip skeletons (7 tiles) + 5 table skeleton rows |
| Empty | Title "No turns recorded yet" · Body "Metrics appear after the first answered turn. Running a golden set is the quickest way to produce some." · `[ Run golden set ]` → `/knowledge/?prospect={key}` |
| Empty — filtered | "No turns match this filter." · `[ Clear filter ]` |
| Populated | §3.10 |
| Degraded — no reasons | `reasons[]` empty: the panel shows "No handoffs or guard trips in this window." — a good outcome, phrased as one |
| Error | `.arag-alert.error` per panel; a metrics failure does not blank the turn log and vice versa |

### 4.8 Settings

| State | Copy / rendering |
|---|---|
| Loading | Row-level skeletons per section |
| Populated | §3.11 |
| Degraded — readyz failing | Connection section: `● offline`, and every other section still renders from its own source |
| Error — branding failed | Falls back to the kit defaults, with an amber line "Branding could not be loaded; showing defaults." The shell never blocks on branding. |
| Permission | Access and the uptime row show `.arag-authgate` inline; Connection, Branding, Integrations and About are public and always render |

### 4.9 Onboarding

| State | Copy / rendering |
|---|---|
| Loading | Prospect cards as skeletons |
| Empty — no prospects | Step 1 becomes: "No prospects are configured. An operator has to add one before GroundLine can listen." · `[ Open Prospects ]` · `[ Skip setup ]` |
| Error — prospects failed | "Could not reach the service. {detail}" · `[ Retry ]` |
| Degraded — KB check failed at step 2 | The step shows the failed rows with the reason and both `[ Open Operator → Connection ]` and `[ Continue anyway ]`; the sample conversation still works against a mock or a healthy KB |

### 4.10 Operator area

Additional to the above:

| State | Copy / rendering |
|---|---|
| Signed out | The whole operator area renders the shell with the operator nav and a centred `.arag-authgate` card in the content area, not a bare login page. The nav is visible but every item is `aria-disabled`. |
| Token rejected | Inline under the field: "That token was not accepted." The field is not cleared. |
| Token expired mid-session | The failing panel shows the authgate; other panels keep their last data with an amber "Signed out — sign in to refresh." |
| Destructive action | `.arag-confirm` with the object named, the consequence spelled out, and type-to-confirm for delete and reset. Cancel is the default focus. |

---

## 5. Copy guidelines and copy deck

### 5.1 House style

1. **Labels, not sentences.** A control is named, not described. `End session`, not
   `Click here to end the session`.
2. **Sentence case everywhere.** Buttons, headings, table headers (table headers are additionally
   uppercased by CSS, not by the string), menu items, chips. Never Title Case.
3. **British spelling**, consistent with the existing docs: *behaviour, colour, organisation,
   recognise, analyse, centre, licence* (noun) / *license* (verb), *personalise*. `-ise` not
   `-ize`.
4. **No emoji. Anywhere.** Not in copy, not as icons, not in empty states, not in logs.
5. **No marketing adjectives** in the product: no *powerful, seamless, intelligent, smart,
   effortless, instantly, AI-powered*. The marketing site makes claims; the product states facts.
6. **No explanatory paragraph where a label will do.** Empty states get one sentence. Cards get a
   one-line helper only when the label is genuinely ambiguous.
7. **Numbers are units, not adjectives.** `2.9 s`, `12 sources`, `18 %`. Latency under 1 s in ms
   (`840 ms`), at or over 1 s in seconds to one decimal (`2.9 s`) — this is `fmtMs()` from the kit,
   used unchanged.
8. **Name the mechanism, not the magic.** "The server throttles refreshes", not "it knows when to
   update".
9. **Errors say what happened, then what to do.** Two clauses maximum. The recovery is a button,
   not a sentence.
10. **Never apologise, never blame.** No "Sorry", no "You must", no "Invalid input" — say which
    field and what it needs.
11. **Say "brief", "session", "prospect", "source", "handoff", "turn".** These are the product's
    nouns; they match the API. Never introduce a synonym ("summary", "call", "customer",
    "citation", "escalation", "message") for one of them in the UI.
12. **Tone comes from `voicebridge.json → customer`.** Plain, specific, slightly understated,
    willing to state a limit. When in doubt, copy its register: *"It fails quietly, not loudly."*

### 5.2 Navigation and chrome

| Key | String |
|---|---|
| `nav.live` | Live |
| `nav.conversations` | Conversations |
| `nav.knowledge` | Knowledge |
| `nav.prospects` | Prospects |
| `nav.quality` | Quality |
| `nav.settings` | Settings |
| `nav.operator` | Operator |
| `nav.op.overview` | Overview |
| `nav.op.connection` | Connection |
| `nav.op.prospects` | Prospects |
| `nav.op.jobs` | Jobs |
| `nav.op.logs` | Logs |
| `nav.op.usage` | Usage |
| `nav.op.turns` | Turn log |
| `nav.op.sessions` | Listen sessions |
| `nav.op.branding` | Branding |
| `nav.op.security` | Security |
| `nav.back` | Back to workspace |
| `band.docs` | API docs |
| `band.help` | Help |
| `band.mock` | mock |
| `band.live` | live |
| `shell.tagline` | live conversation support |
| `shell.footer` | Open source · Apache-2.0 |
| `shell.menu` | Menu |
| `shell.skip` | Skip to content |

### 5.3 Buttons and controls

| Key | String |
|---|---|
| `btn.playSample` | Play sample conversation |
| `btn.stopSample` | Stop sample |
| `btn.useMic` | Use microphone |
| `btn.pauseMic` | Pause |
| `btn.resumeMic` | Resume |
| `btn.showInstructions` | Show instructions |
| `btn.hideInstructions` | Hide |
| `btn.startTyping` | Start typing |
| `btn.sendTurn` | Send |
| `btn.endSession` | End session |
| `btn.startNew` | Start a new session |
| `btn.retryNow` | Retry now |
| `btn.hideControls` | Hide controls |
| `btn.showControls` | Show controls |
| `btn.voiceAgent` | Voice agent |
| `btn.startCall` | Start call |
| `btn.endCall` | End call |
| `btn.mute` | Mute |
| `btn.copy` | Copy |
| `btn.copied` | Copied |
| `btn.export` | Export |
| `btn.exportJson` | JSON (full record) |
| `btn.exportMd` | Markdown (handover note) |
| `btn.exportList` | Export list |
| `btn.resume` | Resume |
| `btn.open` | Open |
| `btn.clearFilters` | Clear filters |
| `btn.testConnection` | Test connection |
| `btn.runGolden` | Run golden set |
| `btn.runAgain` | Run again |
| `btn.editGolden` | Edit golden set |
| `btn.addQuestion` | Add question |
| `btn.ask` | Ask |
| `btn.newProspect` | New prospect |
| `btn.save` | Save changes |
| `btn.discard` | Discard |
| `btn.provision` | Provision search config |
| `btn.dryRun` | Dry run first |
| `btn.applyForReal` | Apply for real |
| `btn.deleteProspect` | Delete prospect |
| `btn.signIn` | Sign in |
| `btn.signOut` | Sign out |
| `btn.retry` | Retry |
| `btn.continue` | Continue |
| `btn.continueAnyway` | Continue anyway |
| `btn.skipSetup` | Skip setup |
| `btn.takeTour` | Take the tour |
| `btn.cancel` | Cancel |
| `btn.confirmDelete` | Delete |
| `btn.showAll` | Show all {n} |
| `btn.previous` | Previous |
| `btn.next` | Next |
| `btn.howToConfigure` | How to configure |
| `btn.whiteLabelGuide` | White-label guide |
| `btn.fullReference` | Full reference |

### 5.4 Section and panel headings

| Key | String |
|---|---|
| `h.startListening` | Start listening |
| `h.source.mic` | Microphone |
| `h.source.webhook` | Telephony webhook |
| `h.source.text` | Typed or pasted text |
| `h.recent` | Recent |
| `h.source` | Source |
| `h.brief` | Brief |
| `h.transcript` | Transcript |
| `h.sources` | Sources |
| `h.session` | Session |
| `h.briefModel` | Brief model |
| `h.keyPoints` | Key points |
| `h.askThem` | Ask them |
| `h.youCouldSay` | You could say |
| `h.products` | Products to mention |
| `h.briefHistory` | Brief history |
| `h.knowledgeBox` | Knowledge Box |
| `h.goldenSet` | Golden set |
| `h.runHistory` | Run history |
| `h.testQuestion` | Test a question |
| `h.whatHappened` | What just happened |
| `h.reasons` | Handoff and guard reasons |
| `h.byProspect` | By prospect |
| `h.turnLog` | Turn log |
| `h.identity` | Identity |
| `h.retrieval` | Retrieval and model |
| `h.conversation` | Conversation |
| `h.brandingOverlay` | Branding overlay |
| `h.voiceAvatar` | Voice and avatar |
| `h.dangerZone` | Danger zone |
| `h.connection` | Connection |
| `h.branding` | Branding |
| `h.integrations` | Integrations |
| `h.access` | Access |
| `h.about` | About |

Helper lines (used once each, never repeated):

| Key | String |
|---|---|
| `help.start` | The brief appears here and keeps rewriting itself as the conversation moves. |
| `help.mic` | Transcribe from this device. |
| `help.webhook` | Post transcript chunks from your phone system. |
| `help.text` | Paste a transcript, one line per turn. |
| `help.sample` | A recorded discovery call, replayed turn by turn. |
| `help.typedFormat` | One line per turn. Prefix with caller: or agent: to label the speaker. |
| `help.briefModel` | Applies to the next refresh. |
| `help.voiceAgent` | The follow-on capability: the agent answers the caller directly when nobody is available, and hands over by a fixed rule. |
| `help.feedIntoSession` | Turns are appended as transcript chunks so the brief keeps up with the call. |
| `help.testQuestion` | The same pipeline the phone call uses. |
| `help.guardRedaction` | Question text is not retained for turns that tripped a safety guard. |
| `help.brandingEnv` | Set by environment variables. Changing them needs a restart. |
| `help.prospectKey` | Lowercase letters, digits, - and _. |
| `help.briefModelLatency` | The brief needs low latency. |
| `help.webhookInterim` | Interim hypotheses: send "final": false. The server throttles refreshes for you. |
| `help.transcriptTrim` | Earliest turns trimmed — the service keeps the last 400 turns of a session. |
| `help.citationCoverage` | of answered turns |

### 5.5 Empty states

| Screen | Title | Body | Action |
|---|---|---|---|
| Live · no session | Start listening | The brief appears here and keeps rewriting itself as the conversation moves. | Play sample conversation |
| Live · waiting for first brief | Listening | The brief appears once there is enough conversation to work from. | — |
| Live · recent (none) | *(section omitted entirely)* | | |
| Conversations · none | No conversations yet | Sessions appear here once a listen session has run. Start one on Live. | Go to Live |
| Conversations · filtered | No conversations match these filters | Try a wider date range, or clear the search. | Clear filters |
| Conversation · no brief | No brief was produced | The conversation did not reach the minimum before it ended. | — |
| Knowledge · no golden set | No golden set for this prospect | A golden set is the gate before a prospect answers on its own. Add the questions it must get right. | Add questions |
| Knowledge · no runs | Not run yet | Running the golden set records the result here. | Run golden set |
| Prospects · none | No prospects yet | A prospect points GroundLine at a Knowledge Box and carries its greeting, handoff line and golden set. | New prospect |
| Quality · no turns | No turns recorded yet | Metrics appear after the first answered turn. Running a golden set is the quickest way to produce some. | Run golden set |
| Quality · no reasons | No handoffs or guard trips in this window | — | — |
| Quality · filtered | No turns match this filter | — | Clear filter |
| Operator · Jobs none | No jobs | Golden-set runs appear here while they are running and after they finish. | — |
| Operator · Logs none | No log records in this window | Widen the level or clear the filter. | Clear filter |
| Operator · Sessions none | No listen sessions | Sessions appear here as soon as one is started. | — |
| Onboarding · no prospects | No prospects are configured | An operator has to add one before GroundLine can listen. | Open Prospects |

### 5.6 Freshness, status and progress

| Key | String |
|---|---|
| `fresh.listening` | Listening |
| `fresh.updated` | Updated {n} ago |
| `fresh.refreshing` | Refreshing |
| `fresh.waiting` | Waiting for new conversation |
| `fresh.stale` | Last good brief · updated {n} ago |
| `fresh.failing` | Last good brief · refresh failing |
| `fresh.reconnecting` | Reconnecting… |
| `fresh.polling` | Reconnected by polling |
| `fresh.ended` | Session ended · v{n} |
| `status.live` | live |
| `status.ended` | ended |
| `status.final` | final |
| `status.connected` | connected |
| `status.unreachable` | unreachable |
| `status.configured` | configured |
| `status.notSet` | not set |
| `status.notStored` | not stored |
| `status.answered` | answered |
| `status.handoff` | handoff |
| `status.guard` | guard |
| `status.pass` | pass |
| `status.fail` | fail |
| `status.notRun` | not run |
| `status.unsaved` | Unsaved changes |
| `progress.golden` | Running question {i} of {total} |
| `progress.goldenDone` | {passed} of {total} passed |
| `progress.samplePlaying` | Playing a sample discovery call |
| `progress.sampleDone` | Sample finished. The brief above is what the person on the call would be reading. |

### 5.7 Errors

Pattern: **what happened. {detail from the problem+json}** then a recovery button. The request id
is rendered in `mono small` beneath when present.

| Key | String |
|---|---|
| `err.generic` | Something went wrong on the service. {detail} |
| `err.offline` | Cannot reach the service. Check that it is running. |
| `err.startSession` | Could not start a session. {detail} |
| `err.unknownProspect` | That prospect is not in the registry. Choose another, or add it in Prospects. |
| `err.sessionGone` | That session no longer exists. The service keeps the 200 most recent sessions. |
| `err.sessionEnded` | This session has ended. Start a new one to keep listening. |
| `err.rateLimited` | Too many updates. The brief is rate limited to protect the Knowledge Box. Resuming in {n} s. |
| `err.loadConversations` | Could not load conversations. {detail} |
| `err.conversationGone` | This conversation no longer exists. |
| `err.kbUnreachable` | Cannot reach the Knowledge Box. Last successful check {time}. {detail} |
| `err.goldenFailed` | The golden run stopped. {detail} |
| `err.goldenPartial` | Run stopped after {n} of {total} questions. |
| `err.askFailed` | The question could not be answered. {detail} |
| `err.scribeMissing` | Microphone transcription is not configured on this deployment. The sample conversation and pasted text work without it. |
| `err.micDenied` | Microphone access was refused by the browser. Allow it in the address bar, or paste a transcript instead. |
| `err.voicesMissing` | Voices need an ElevenLabs key on the server. The agent default is used. |
| `err.avatarMissing` | The avatar needs LiveKit and LiveAvatar credentials on the server. |
| `err.saveProspect` | Could not save. {detail} |
| `err.keyTaken` | That key is already in use. |
| `err.fieldRequired` | Required. |
| `err.fieldPattern` | Lowercase letters, digits, - and _ only. |
| `err.fieldColour` | Not a colour the service accepts. Use a hex value such as #1f3a93. |
| `err.fieldRange` | Must be between {min} and {max}. |
| `err.tokenRejected` | That token was not accepted. |
| `err.signedOut` | Signed out — sign in to refresh. |
| `err.brandingDefaults` | Branding could not be loaded; showing defaults. |
| `err.prospectNames` | Showing prospect keys — the prospect list could not be loaded. |
| `err.briefHistory` | Only the final brief is available for this conversation. |

### 5.8 Permission (authgate) copy

| Key | String |
|---|---|
| `gate.title` | Operator sign-in required |
| `gate.prospects` | Registry entries contain Knowledge Box ids. Signing in shows and edits them. |
| `gate.operator` | This area reads configuration, logs and usage for the whole deployment. |
| `gate.turns` | The full turn log can contain caller questions. |
| `gate.field` | Admin token |
| `gate.help` | The ADMIN_TOKEN configured for this deployment. It is exchanged for a cookie and never stored in the page. |
| `gate.apiKey` | This deployment requires an API key. A browser on the same origin is normally issued a session automatically. |

### 5.9 Confirmations (destructive and interrupting)

| Key | Title | Body | Confirm |
|---|---|---|---|
| `confirm.endSession` | End this session? | The brief, its sources and the transcript are kept. | End session |
| `confirm.leaveLive` | Leave the session running? | It keeps listening on the server. Come back from the sidebar. | Leave |
| `confirm.closeCall` | End the call first? | A voice call is in progress. | End call |
| `confirm.discard` | Discard changes? | Unsaved changes to this prospect will be lost. | Discard |
| `confirm.deleteProspect` | Delete prospect {key}? | This removes its registry entry, its golden set and its branding overlay. Conversations already recorded are kept. Type {key} to confirm. | Delete |
| `confirm.deleteSession` | Delete this conversation? | The brief, transcript and sources are removed permanently. | Delete |
| `confirm.cancelJob` | Cancel this run? | Questions already run keep their results. | Cancel run |
| `confirm.resetBranding` | Reset this prospect's branding? | It returns to the deployment's branding. | Reset |

### 5.10 Onboarding copy

| Key | String |
|---|---|
| `ob.title` | Set up GroundLine |
| `ob.step` | Step {i} of 3 |
| `ob.s1.title` | Choose what it listens about |
| `ob.s1.body` | A prospect points GroundLine at one Knowledge Box and carries its greeting, handoff line and golden set. |
| `ob.s2.title` | Check the connection |
| `ob.s2.body` | What the brief will be grounded in. |
| `ob.s2.ok` | Ready. |
| `ob.s2.fail` | The Knowledge Box could not be reached. The sample conversation still works. |
| `ob.s3.title` | You are ready |
| `ob.s3.sample` | Play sample conversation |
| `ob.s3.sampleBody` | A recorded discovery call, replayed turn by turn. Watch the brief build. |
| `ob.s3.paste` | Paste your own transcript |
| `ob.s3.pasteBody` | One line per turn, prefixed caller: or agent:. |
| `ob.s3.webhook` | Connect a telephony webhook |
| `ob.s3.webhookBody` | Two POST requests from the system you already have. |

### 5.11 Accessible names not visible on screen

| Element | `aria-label` |
|---|---|
| Copy control on a suggested answer | Copy suggested answer |
| Source chip | Open source: {title} |
| Sidebar collapse toggle | Collapse navigation |
| Table sort header | Sort by {column} |
| Density toggle | Table density |
| Level meter | Microphone input level |
| Freshness indicator | Brief freshness |
| Brief pane live region | `aria-live="polite" aria-atomic="false"` on the brief body; the topic and the freshness line are `aria-live="polite"`, the lists are not, so a screen reader is told the brief changed without re-reading all of it |
| Transcript | `aria-live="polite"` on the last entry only |

---

## 6. Components mapped to the UI kit

### 6.1 Existing kit components, used unchanged

`vendor/arag-platform/ui/arag-ui.css` and `arag-ui.js` are **never edited**. These are used as-is:

| Kit component | Used on |
|---|---|
| `body.arag` + the whole token block | Every page |
| `.arag-card`, `.arag-card > .head`, `> .body`, `.pad` | Every panel on every screen |
| `.arag-btn` + `.secondary .ghost .danger .sm .lg` | Every action |
| `.arag-field`, `.arag-label`, `.arag-input`, `.arag-select`, `.arag-textarea`, `.arag-help` | Prospect editor, filter bar, composer, onboarding |
| `.arag-chip` + `.ok .warn .danger .info .neutral .outline` | Status, brief meta chips, source chips, result chips |
| `.arag-status` + `data-state` | Utility band service pill, KB health |
| `.arag-table`, `.num` | Base for the new data table (see 6.2 #2) |
| `.arag-kv` | Session stats, connection rows, turn facts |
| `.arag-steps` | Golden-run job timeline |
| `.arag-alert` + `.ok .warn .error` | Every inline error and degraded banner |
| `.arag-toast` | Save / delete / copy confirmations only |
| `.arag-modal`, `.arag-modal-backdrop` | Confirmations (wrapped by `.arag-confirm`) |
| `.arag-json`, `.arag-log` | Operator: config, usage, provision result, logs |
| `.arag-chat`, `.arag-bubble` | Voice agent drawer, Test a question |
| `.arag-cite` | Source chips (extended, see 6.3 #21) |
| `.arag-progress` | Reason bars in Quality, job progress |
| `.arag-divider`, `.arag-row`, `.arag-stack`, `.arag-grid` | Layout throughout |
| `.arag-kpi` | Base for the stat strip tiles |
| `.arag-empty` | Base for the empty state (see 6.2 #6) |
| `<arag-status>` | Band service pill |
| `<arag-json>` | Operator config / usage / provision |
| `<arag-log>` | Operator logs |
| `<arag-health>` | Operator connection |
| `<arag-job-timeline>` | Golden run |
| `aragUI.api / toast / esc / fmtMs / fmtBytes / sse / applyBranding` | All data access, all SSE, all branding |

**Not used:** `<arag-shell>` (replaced by the sidebar shell, 6.2 #1 — the kit's shell is a
top-nav marketing-ish chrome and cannot host a left nav), `.arag-tabs` (replaced by
`.arag-segmented` where a control is a control, and by real routes where a tab was really
navigation), `.arag-dropzone` (nothing is uploaded).

### 6.2 New components proposed **for the platform kit** (`arag-*`)

These are generic, every product in the programme needs them, and the brief explicitly names most
of them. They are written in `public/ui-ext.css` now under their final `arag-*` names, so the
platform Head can lift the block verbatim into `arag-ui.css` with no rename. Report them upstream
in the final summary.

---

#### 1. `arag-app` — sidebar application shell
Custom element `<vb-app>` in `public/app/shell.js` today; proposed upstream as `<arag-app>`.

```html
<vb-app
  area="workspace|operator"
  active="live"
  title="Live"
  breadcrumb="Conversations=/conversations/"
  prospect-scope>
  <span slot="actions"> … page actions … </span>
  … page content …
</vb-app>
```

Renders: `.arag-app` grid → `.arag-app-band`, `.arag-app-side`, `.arag-app-head`,
`.arag-app-main`. Reads `GET /api/v1/branding` once and calls `applyBranding()` (kit function,
unchanged), reads `GET /api/v1/prospects` for the scope selector, applies the persisted theme
before first paint.

**States:** `expanded` (≥1280), `rail` (1100–1280, `[data-nav="rail"]`), `offcanvas`
(<1100, `[data-nav="off"]` + `[data-open]`), `poweredBy=false` (band removed, actions relocated).
**Accessibility:** `<nav aria-label="Sections">`, active item `aria-current="page"`, skip link as
the first focusable element, focus trap while off-canvas is open.
**Where:** `public/ui-ext.css` + `public/app/shell.js`. **Propose upstream: yes.**

---

#### 2. `arag-datatable` — data table with sort, priority columns and density
```html
<table class="arag-datatable" data-density="comfortable|compact">
  <thead><tr>
    <th data-sort="started" aria-sort="descending"><button>Started</button></th>
    <th data-priority="3">P50</th>
  </tr></thead>
  <tbody>
    <tr><td data-label="Started"><a href="?id=…">Today 14:32</a></td>…</tr>
  </tbody>
</table>
```
Extends `.arag-table`: sticky `thead`, 40/32 px rows, `data-priority` column hiding at breakpoints,
`data-label` driving the `<700px` card mode, whole-row links, keyboard row focus.
**States:** loading (5 `.arag-skeleton` rows), empty (`<tbody>` replaced by a full-width cell
containing `.arag-emptystate`), sorted asc/desc/unsorted, row hover, row focus, row selected.
**Propose upstream: yes.**

---

#### 3. `arag-drawer` — right-hand drawer
```html
<aside class="arag-drawer" data-width="480" aria-modal="true" role="dialog" aria-labelledby="…" hidden>
  <header class="head"><h2 id="…">Voice agent</h2><button class="close" aria-label="Close">…</button></header>
  <div class="body">…</div>
  <footer class="foot">…</footer>
</aside>
<div class="arag-drawer-scrim" hidden></div>
```
Widths 400 / 480 / 640 via `data-width`. Slides from the right, 160 ms `ease-out`, no slide under
`prefers-reduced-motion`. Focus trap, `Esc`, scrim click, focus restore.
**States:** closed, opening, open, blocked-close (see `confirm.closeCall`).
**Used by:** Voice agent, golden result, operator detail drawers. **Propose upstream: yes.**

---

#### 4. `arag-breadcrumb`
```html
<nav class="arag-breadcrumb" aria-label="Breadcrumb">
  <a href="/conversations/?status=ended">Conversations</a><span aria-hidden="true">·</span>
  <span aria-current="page">Progress · Today 14:32</span>
</nav>
```
Separator is a middot rendered by CSS content, not a character in the string. Truncates the middle
segment first. **Propose upstream: yes.**

---

#### 5. `arag-filterbar`
```html
<div class="arag-filterbar">
  <label class="search"><svg class="arag-icon">…</svg><input type="search" …></label>
  <select class="arag-select">…</select>
  <div class="arag-segmented">…</div>
  <button class="arag-btn ghost sm" data-clear>Clear</button>
</div>
```
48 px tall, sticky under the page header, wraps to two rows below 1100 px, collapses to a search
field plus a "Filters (2)" button opening a drawer below 700 px.
**States:** default, active (at least one filter set — the Clear button appears only then),
disabled (while the first load is in flight). **Propose upstream: yes.**

---

#### 6. `arag-emptystate`
```html
<div class="arag-emptystate">
  <svg class="arag-icon lg">…</svg>
  <h3>No conversations yet</h3>
  <p>Sessions appear here once a listen session has run. Start one on Live.</p>
  <a class="arag-btn secondary">Go to Live</a>
</div>
```
Replaces `.arag-empty` (which is a bare dashed box). Max width 380 px, centred, 48 px vertical
padding, icon 20 px `--arag-text-subtle`. One action, two at most. No illustration.
**Propose upstream: yes** (as an evolution of `.arag-empty`).

---

#### 7. `arag-statstrip`
```html
<div class="arag-statstrip">
  <div class="stat"><span class="k">Turns</span><span class="v">214</span><span class="s">in the window</span></div>
  …
</div>
```
Equal-width tiles in a single row, wrapping at 1100 px, 2-up at 700 px. Values
`font-variant-numeric: tabular-nums`, 28 px display face. `.stat.warn` / `.stat.ok` tint only the
value, never the tile background.
**States:** loading (skeleton bar in place of the value), unavailable (`—` plus a `title`
explaining why). **Propose upstream: yes.**

---

#### 8. `arag-segmented`
```html
<div class="arag-segmented" role="group" aria-label="Status">
  <button aria-pressed="true">All</button><button>Live</button><button>Ended</button>
</div>
```
Used for the Live source switch, Conversations status, Quality outcome, detail pane switching on
mobile. 28 px tall (`sm` 24 px), 1 px border, selected segment gets `--arag-brand-50` fill and
`--arag-brand-600` text. Arrow-key roving tabindex. **Propose upstream: yes** — it replaces most
misuse of `.arag-tabs` for things that are not navigation.

---

#### 9. `arag-toolbar`
```html
<div class="arag-toolbar"><span class="count">38 conversations</span><span class="spacer"></span>…</div>
```
The row between the filter bar and a table: result count on the left, sort/density/actions on the
right. 36 px, no border, `--arag-text-muted`. **Propose upstream: yes.**

---

#### 10. `arag-skeleton`
```html
<span class="arag-skeleton" style="--w:60%"></span>
<tr class="arag-skeleton-row"><td colspan="9"></td></tr>
```
A 1.4 s shimmer between `--arag-brand-50` and `--arag-surface`; a static block under
`prefers-reduced-motion`. Appears only after 200 ms. **Propose upstream: yes.**

---

#### 11. `arag-snippet` — code block with a copy button
```html
<figure class="arag-snippet">
  <figcaption>Open a session when the call connects.<button class="arag-btn ghost sm" data-copy>Copy</button></figcaption>
  <pre><code>POST https://…</code></pre>
</figure>
```
Built on `.arag-pre`. `data-copy` copies `textContent` of the `<code>` via
`navigator.clipboard.writeText`, swaps the label to "Copied" for 1.5 s, and falls back to
selecting the text when the clipboard API is unavailable (non-secure origin).
**States:** default, copied, copy-unavailable. **Propose upstream: yes.**

---

#### 12. `arag-pagination`
```html
<nav class="arag-pagination" aria-label="Pages">
  <span class="range">Showing 1–25 of 38</span>
  <button data-prev disabled>Previous</button><button data-next>Next</button>
</nav>
```
Offset-based, matching every list endpoint's `limit`/`offset`. No page-number list beyond 7 pages.
**Propose upstream: yes.**

---

#### 13. `arag-confirm` — confirmation dialog, with type-to-confirm
```html
<div class="arag-confirm" role="alertdialog" aria-modal="true">
  <h2>Delete prospect progress?</h2>
  <p>This removes its registry entry, its golden set and its branding overlay. …</p>
  <label>Type <code>progress</code> to confirm<input …></label>
  <div class="actions"><button class="arag-btn ghost">Cancel</button><button class="arag-btn danger" disabled>Delete</button></div>
</div>
```
Cancel is focused on open. The destructive button stays disabled until the typed value matches
exactly. Required on every destructive action (brief item 6). **Propose upstream: yes.**

---

#### 14. `arag-icon` — the inline-SVG icon convention
```html
<svg class="arag-icon" width="16" height="16" aria-hidden="true">…</svg>
```
`.arag-icon { width:1em; height:1em; stroke:currentColor; fill:none; stroke-width:1.5;
stroke-linecap:round; stroke-linejoin:round; flex:none }`, sizes `.sm` 14, default 16, `.lg` 20.
Icons are exported as functions from `public/app/icons.js` returning SVG strings — no sprite
file, no fetch, no emoji ever. **Propose upstream: yes** (the CSS class and the rule; each product
keeps its own icon set).

---

#### 15. `arag-timeline` — vertical event timeline
```html
<ol class="arag-timeline">
  <li aria-current="true"><span class="dot"></span><span class="label">v6</span><span class="meta">14:43 · 2.4 s</span></li>
</ol>
```
Used for the brief-version rail in Conversation detail and for job event history in the operator
area. Connector line drawn with a border on the `<li>`, not a pseudo-element hack that breaks in
RTL. **States:** past, current, future/pending, failed. **Propose upstream: yes.**

---

#### 16. `arag-splitpane`
```html
<div class="arag-splitpane" data-cols="264,1fr,320" data-key="vb.live.rail">…</div>
```
CSS-grid columns from `data-cols`, with collapse toggles on the outer panes and the state
persisted under `data-key`. No drag handle in v1 — the sizes are designed, not user-tuned, and a
drag handle would be the first thing to break on touch. **Propose upstream: yes.**

---

#### 17. `arag-authgate`
```html
<div class="arag-authgate">
  <svg class="arag-icon lg">lock</svg>
  <h3>Operator sign-in required</h3>
  <p>Registry entries contain Knowledge Box ids. Signing in shows and edits them.</p>
  <form><input type="password" autocomplete="current-password" …><button class="arag-btn">Sign in</button></form>
  <p class="arag-help">The ADMIN_TOKEN configured for this deployment. …</p>
</div>
```
Posts `POST /api/v1/admin/login {token}`, then re-runs the panel's own loader. Replaces the panel
body only — never the page.
**States:** gated, submitting, rejected (inline error, field not cleared), granted (removes itself).
**Propose upstream: yes.**

---

### 6.3 New components local to this product (`vb-*`, `public/ui-ext.css`)

These encode GroundLine's domain and should not go upstream.

#### 18. `.vb-brief` — the brief pane
```html
<article class="vb-brief" data-version="4" aria-live="polite">
  <h2 class="topic">Metal 3D printing for a machine shop</h2>
  <div class="meta">
    <span class="arag-chip outline" data-field="caller_profile">Operations manager</span>
    <span class="arag-chip outline" data-field="their_goal">Replace machining</span>
    <span class="arag-chip outline" data-field="stage">Discovery</span>
  </div>
  <p class="summary">…</p>
  <section data-field="key_points"><h3>Key points</h3><ul><li>…</li></ul></section>
  <section data-field="suggested_questions"><h3>Ask them</h3><ul>…</ul></section>
  <section data-field="suggested_answers"><h3>You could say</h3>
    <blockquote class="vb-say">…<button data-copy aria-label="Copy suggested answer">…</button></blockquote>
  </section>
  <section data-field="recommended_products"><h3>Products to mention</h3><div class="arag-row">…</div></section>
</article>
```
Contract: a section whose field is empty is **absent from the DOM**, not hidden. The renderer is a
single pure function `renderBrief(brief) -> string` in `public/app/brief.js`, used identically by
Live, Conversation detail and the export preview — one implementation, so what the reviewer sees
is provably what the agent saw.
**States:** `data-state="waiting|fresh|refreshing|stale|failing|ended"` on the wrapping card,
driving the rail colour; `data-changed` on a section for the 400 ms wash.

#### 19. `.vb-freshness` — the staleness indicator
```html
<span class="vb-freshness" data-state="stale"><span class="dot"></span><span class="txt">Last good brief · updated 34 s ago</span><button class="arag-btn ghost sm" data-retry hidden>Retry now</button></span>
```
States exactly as §4.2. Colours: `--vb-live` (fresh/listening), `--arag-brand-500` pulsing
(refreshing), `--arag-warn-fg` (stale/failing/reconnecting), `--arag-text-subtle` (waiting/ended).
Never red.

#### 20. `.vb-transcript`
```html
<div class="vb-transcript" role="log" aria-label="Transcript">
  <p class="line" data-speaker="caller"><time datetime="…">14:32:11</time><b class="who">caller</b><span class="what">…</span></p>
  <p class="line interim" …>…</p>
</div>
```
Speaker column 56 px, capitalised by CSS; `.interim` italic at 60 % opacity, replaced in place.
Auto-scrolls to the bottom **only when already within 40 px of the bottom**, so reading history is
never yanked. Timestamps hidden on Live (noise), shown in Conversation detail.

#### 21. `.vb-source` — citation chip and source list
```html
<a class="vb-source arag-cite" href="…" target="_blank" rel="noreferrer">
  <span class="t">Shop System datasheet</span><span class="s">0.91</span><svg class="arag-icon sm">…</svg>
</a>
```
Extends `.arag-cite`. Score right-aligned, tabular, with a 2 px under-bar whose width is the score.
No `url` → renders as a `<span>` with no arrow and `title="This source has no link."`
`.vb-sourcelist` collapses to 3 with "Show all {n}"; the heading always shows the count, including
0.

#### 22. `.vb-sourcepicker` — the three source cards on Live empty
Three equal cards, `data-source="mic|webhook|text"`, `data-available="true|false"`. An unavailable
card keeps its full text and gains a muted reason line — never hidden, because the three-way choice
is the product's transport-independence claim.

#### 23. `.vb-level` — microphone level meter
Ten 3 px bars, `--vb-live` fill, driven from the Web Audio analyser at ~20 fps, `aria-hidden`
(the interim transcript line is the accessible signal). Frozen grey when paused.

#### 24. `.vb-pipeline` — the six-step turn pipeline
```html
<ol class="vb-pipeline">
  <li data-step="guard-in" data-state="ok"><span class="ic"></span><span>Input safety guard</span><span class="meta">1 ms</span></li>
  …
  <li data-step="handoff" data-state="warn"><span class="ic"></span><span>Deterministic handoff check</span><span class="meta">sentinel</span></li>
</ol>
```
Built on `.arag-steps`, adding per-step timing from `latency_ms` and the reason string. Six fixed
steps, always all six, so absence of a step is never ambiguous.
**States per step:** pending, active, ok, warn (handoff), error, skipped.

#### 25. `.vb-brandpreview` — miniature shell preview
A 320×180 non-interactive replica of the shell (band, sidebar, header, two content bars) rendered
with the candidate branding applied as inline custom properties on the wrapper, so the preview
never mutates the real document. Used in Settings → Branding and the prospect branding overlay.
`aria-hidden="true"` with a text summary beside it.

#### 26. `.vb-goldencase` — a golden result row
Question, expected/actual chips, latency, and the `checks[]` list as pass/fail lines with the
label verbatim from `GoldenCase.checks[].label`. Failed cases sort first and get an amber left
rail.

#### 27. `.vb-reasonbar` — a handoff/guard reason row
Label, `.arag-progress` bar at row width, count. Guard reasons carry the warning icon and an amber
bar; handoff reasons use `--arag-brand-400`. The whole row is a link setting `?reason=`.

#### 28. `.vb-composer` — the "type a turn" input
Single-line input with a send button, `caller:`/`agent:` prefix parsing, `Enter` to send,
`Shift+Enter` for a multi-line paste that is split into one chunk per line. Shows the throttle
outcome from the append response inline and briefly: "Queued", "Refreshing", "Waiting for new
conversation".

### 6.4 Summary table

| # | Class / element | Home | Upstream? |
|---|---|---|---|
| 1 | `arag-app` / `<vb-app>` | ui-ext.css + app/shell.js | yes |
| 2 | `arag-datatable` | ui-ext.css | yes |
| 3 | `arag-drawer` | ui-ext.css | yes |
| 4 | `arag-breadcrumb` | ui-ext.css | yes |
| 5 | `arag-filterbar` | ui-ext.css | yes |
| 6 | `arag-emptystate` | ui-ext.css | yes |
| 7 | `arag-statstrip` | ui-ext.css | yes |
| 8 | `arag-segmented` | ui-ext.css | yes |
| 9 | `arag-toolbar` | ui-ext.css | yes |
| 10 | `arag-skeleton` | ui-ext.css | yes |
| 11 | `arag-snippet` | ui-ext.css | yes |
| 12 | `arag-pagination` | ui-ext.css | yes |
| 13 | `arag-confirm` | ui-ext.css | yes |
| 14 | `arag-icon` | ui-ext.css + app/icons.js | yes (class only) |
| 15 | `arag-timeline` | ui-ext.css | yes |
| 16 | `arag-splitpane` | ui-ext.css | yes |
| 17 | `arag-authgate` | ui-ext.css | yes |
| 18 | `vb-brief` | ui-ext.css + app/brief.js | no |
| 19 | `vb-freshness` | ui-ext.css | no |
| 20 | `vb-transcript` | ui-ext.css | no |
| 21 | `vb-source` / `vb-sourcelist` | ui-ext.css | no |
| 22 | `vb-sourcepicker` | ui-ext.css | no |
| 23 | `vb-level` | ui-ext.css | no |
| 24 | `vb-pipeline` | ui-ext.css | no |
| 25 | `vb-brandpreview` | ui-ext.css | no |
| 26 | `vb-goldencase` | ui-ext.css | no |
| 27 | `vb-reasonbar` | ui-ext.css | no |
| 28 | `vb-composer` | ui-ext.css | no |

---

## 7. Visual design specification

The kit owns the palette and the primitives. This section adds only what an application shell
needs and nothing that redefines a brand token — the same discipline `arag-showroom/public/showroom.css`
follows. All new tokens are `--vb-*` and are expressed against kit variables wherever possible, so
a `BRAND_*` swap lands in one place.

### 7.1 Type scale

Faces are inherited from the kit: `--arag-font-display` for headings and numerals-as-display,
`--arag-font-text` for UI and prose, `--arag-font-mono` for ids, snippets and log lines.
Base is 14 px (the kit's `body.arag`).

| Token | px / line-height | Weight | Tracking | Used for |
|---|---|---|---|---|
| `--vb-fs-micro` | 11 / 1.35 | 600 | +0.06em, uppercase | Table headers, section eyebrows (`KEY POINTS`), stat labels |
| `--vb-fs-xs` | 12 / 1.45 | 400 | 0 | Meta, timestamps, help text, chips |
| `--vb-fs-sm` | 13 / 1.5 | 400 | 0 | Nav items, table body, form controls, filter bar |
| `--vb-fs-base` | 14 / 1.5 | 400 | 0 | Body copy, card body, drawer body |
| `--vb-fs-read` | 15 / 1.6 | 400 | 0 | **Brief body only** — summary, key points, suggested answers |
| `--vb-fs-md` | 16 / 1.35 | 600 | −0.005em | Card titles (`h3`), drawer titles |
| `--vb-fs-lg` | 20 / 1.25 | 600 | −0.01em | Page title (`h1`), brief topic (`h2`) |
| `--vb-fs-xl` | 28 / 1.15 | 600 | −0.015em | Stat strip values |
| `--vb-fs-hero` | 34 / 1.15 | 650 | −0.02em | Onboarding step title only |

Rules: exactly one `h1` per page (the page title). The brief topic is an `h2`. Card titles are
`h3`. Nothing on any screen is larger than `--vb-fs-xl` except the onboarding hero. Numerals in
tables, stats and latency readouts always `font-variant-numeric: tabular-nums`. Prose maximum
measure 68 ch (the brief summary is the only prose that gets close).

### 7.2 Spacing rhythm (4 / 8 px grid)

| Token | px | Used for |
|---|---|---|
| `--vb-s1` | 4 | Icon-to-label, chip internals |
| `--vb-s2` | 8 | Control gaps, chip rows, list-item gaps |
| `--vb-s3` | 12 | Card body inner stack, form field gaps |
| `--vb-s4` | 16 | Card padding, section gaps inside a card |
| `--vb-s5` | 20 | Pane gaps in a split layout |
| `--vb-s6` | 24 | Between cards |
| `--vb-s7` | 32 | Page gutters, between major sections |
| `--vb-s8` | 48 | Empty-state vertical padding |
| `--vb-s9` | 72 | Onboarding step vertical rhythm |

Every margin, padding and gap in `ui-ext.css` must be one of these tokens. No arbitrary pixel
values, with two allowed exceptions: hairline borders (1 px) and the 2 px status rails.

Fixed dimensions: utility band 36, page header 64, sidebar 248 (rail 64), filter bar 48, toolbar
36, table row 40 / 32 compact, table header row 32, nav item 34, button 32 (`sm` 24, `lg` 44),
input 34, drawer widths 400 / 480 / 640, content gutter 32.

### 7.3 Colour roles

Structural colour is the kit's ink and brand blues. They are not changed.

| Role | Token | Value (light) | Where |
|---|---|---|---|
| Page background | `--arag-surface` | `#f4faff` | `body` |
| Card / panel | `--arag-surface-raised` | `#ffffff` | Cards, sidebar, drawer |
| Utility band | `--arag-ink-950` | `#00123c` | Band, log viewer, toasts |
| Sidebar background | `--vb-side` = `var(--arag-surface-raised)` | `#ffffff` | Sidebar, with a 1 px `--arag-border` right edge |
| Hairline | `--arag-border` | `#c9d9ee` | All borders, dividers |
| Primary text | `--arag-text` | `#101828` | Body |
| Muted | `--arag-text-muted` | `#55627a` | Labels, meta |
| Subtle | `--arag-text-subtle` | `#8892b0` | Placeholders, disabled, empty-state icons |
| Action | `--arag-brand-600` | `#2b2bb2` | Primary buttons, links, active nav text |
| Action wash | `--arag-brand-50` | `#eef1fd` | Active nav fill, hover rows, chip fills |
| Warning | `--arag-warn-fg` / `--arag-warn-bg` | `#6b4e00` / `#fff3c2` | Stale brief, guard reasons, degraded banners |
| Danger | `--arag-danger-fg` / `--arag-danger-bg` | `#8c1f2e` / `#ffe3e7` | Errors, destructive buttons |
| **Liveness** | `--vb-live` = `var(--arag-accent-400)` | **`#5ce500`** | See below |

`ui-ext.css` sets, at `:root`, `--arag-accent-400: #5ce500;` — the kit's only use of that token is
the brand band dot, which the sidebar shell replaces with the wordmark, so the override is safe
and confined. Because `applyBranding()` rewrites `--arag-accent-400` from `BRAND_ACCENT_COLOR`,
a partner's accent colour automatically becomes their liveness colour. Progress green is therefore
the default, not a hard-coded constant.

#### Where `#5ce500` appears — the complete list
1. The liveness dot on the sidebar **Live** item while a session is running.
2. The `● listening` / `● live` status dot in the Live page header and in list rows.
3. The freshness indicator dot in the **fresh** state.
4. The 2 px left rail on the brief card that flashes for 600 ms on a new brief version.
5. The microphone level meter bars.
6. The `● connected` / `● configured` dot on Knowledge Box and integration rows.
7. The `✓` glyph on a passing golden case and the pass chip's icon (the chip text stays
   `--arag-accent-fg`, which is a dark green with real contrast).
8. Inside `arag-logo.svg` / `arag-logo-alt.svg`, as the wordmark's own mark.
9. On the dark utility band only, it may carry small text (e.g. the `live` environment chip) —
   contrast against `#00123c` is ≈ 11 : 1.

#### Where `#5ce500` must never appear
- Body text, labels, links, headings, or any text on a light surface (contrast vs `#ffffff` is
  ≈ 1.7 : 1 — it fails at any size).
- Any fill larger than 24 × 24 px behind text of any colour.
- Button backgrounds, nav item backgrounds, table row highlights, selected states, focus rings.
- Charts, bars or progress fills (`.arag-progress` uses `--arag-brand-500`; guard bars use amber).
- Success *messages* — those use `--arag-accent-soft` / `--arag-accent-fg` from the kit.
- Error, warning or disabled states, ever.
- As a second brand colour alongside a partner's `primaryColor`.

The rule, stated once for the implementer: **green means "this is happening right now".** It is a
liveness signal, never an identity colour and never a success colour.

### 7.4 Logo usage (Progress wordmark)

Both files are copied to `public/brand/` and are never recoloured, rotated, cropped, outlined or
placed on a busy background. Aspect ratio 526 × 61 (≈ 8.6 : 1); always set `height` and let width
follow.

| File | Surface | Height | Placement | Clear space |
|---|---|---|---|---|
| `arag-logo-alt.svg` (white + `#5ce500`) | Dark: the utility band, the onboarding hero panel, the operator sign-in card in dark theme | 16 px (band), 24 px (onboarding hero) | Band: left, 20 px from the container edge, vertically centred | ≥ 16 px on all sides |
| `arag-logo.svg` (ink `#4b4e52` + `#5ce500`) | Light: Settings → Branding preview caption, the operator sign-in card in light theme, the `.vb-brandpreview` band strip | 20 px (sign-in), 14 px (preview strip) | Left-aligned with the card's content | ≥ 12 px on all sides |

Rules:
- Variant is chosen by **surface luminance, not by theme**. Implement with both `<img>` elements
  inside `.vb-wordmark` and CSS visibility driven by the surface class, so no JavaScript is
  involved and no flash occurs on theme change.
- Below 700 px the band wordmark drops to 14 px; below 380 px it is replaced by nothing (the band
  keeps only its right-hand actions) rather than being squeezed.
- `alt="Progress Agentic RAG"`; when the wordmark sits next to the product name it becomes
  `alt=""` with `aria-hidden="true"` to avoid a duplicate announcement.
- **`BRAND_LOGO_URL` never replaces the Progress wordmark and the Progress wordmark never replaces
  a partner logo.** They occupy different slots: the partner logo is the sidebar identity, the
  Progress wordmark is the "built on" credit in the band. `poweredBy:false` removes the band and
  with it the Progress wordmark; the partner logo is unaffected.
- Partner logos are constrained to `max-height:26px; max-width:180px; object-fit:contain`. A logo
  that fails to load falls back to `branding.productName` as text — never a broken-image icon.

### 7.5 Elevation

| Level | Shadow | Used on |
|---|---|---|
| 0 | none, 1 px `--arag-border` | Sidebar, filter bar, toolbar, table, nested panels |
| 1 | `--arag-shadow` (kit) | Cards |
| 2 | `0 8px 28px rgba(0,18,60,.14)` → `--vb-shadow-2` | Drawer, popover, select menu, sticky footer bar |
| 3 | `0 24px 64px rgba(0,18,60,.28)` → `--vb-shadow-3` | Modal / confirm |

Rule: never nest elevation. A card inside a card is a bordered region, not a second shadow. The
page header and filter bar gain a 1 px bottom border when the content scrolls under them — no
shadow.

### 7.6 Focus, hover, selection

- `:focus-visible` → `outline: 2px solid var(--arag-brand-500); outline-offset: 2px;` and the
  element's own border radius. On the dark band: `outline-color:#fff`. Focus is never removed and
  never replaced by colour alone.
- Table rows are focusable (`tabindex="0"` on the row link); focus shows an inset 2 px ring so it
  is not clipped by the row boundary.
- Hover on rows: `--arag-brand-50` background, 80 ms. Hover never changes text colour.
- Selected row (detail open): 2 px `--arag-brand-600` left rail + `--arag-brand-50` fill.
- Disabled: 45 % opacity, `cursor:not-allowed`, and always accompanied by an explanation in
  adjacent text — never a silently dead control.
- Minimum hit target 32 × 32 px; icon-only buttons get padding to reach it.
- `prefers-reduced-motion: reduce` disables the brief flash, the skeleton shimmer, the drawer
  slide, the status pulse and all transitions over 100 ms.

### 7.7 Iconography

Inline SVG only, from `public/app/icons.js`. Stroke set, 1.5 px, `currentColor`, no fill, 24×24
viewBox rendered at 16 px (20 px in empty states and section headers). **No emoji anywhere, ever.**
No icon appears without a text label except in the collapsed sidebar rail, where the label is in
`aria-label` and a `title` tooltip.

**Core set (20)**

| Name | One-line description | Used on |
|---|---|---|
| `live` | Filled dot inside a thin ring | Liveness indicators, live status |
| `mic` | Capsule microphone on a stand | Microphone source, level meter header |
| `webhook` | Two nodes joined by an elbow connector | Telephony webhook source |
| `type` | Text caret between two serifs | Typed/pasted text source |
| `brief` | Document with three ruled lines and one short line | Live nav, brief pane |
| `list` | Three horizontal rules with leading dots | Conversations nav |
| `book` | Open book, two facing pages | Knowledge nav |
| `users` | Two overlapping head-and-shoulders | Prospects nav |
| `gauge` | Semicircular dial with a needle | Quality nav |
| `sliders` | Three horizontal tracks with offset handles | Settings nav |
| `shield` | Shield outline with an inner tick | Security, safety guards, trust rows |
| `link-out` | Square with an arrow leaving its top-right | Source chips, external docs |
| `copy` | Two offset rounded rectangles | Copy controls |
| `download` | Downward arrow onto a tray | Export |
| `search` | Circle with a diagonal handle | Filter bar, search inputs |
| `filter` | Funnel | Filter drawer on narrow widths |
| `calendar` | Grid with a header bar and two tabs | Date range |
| `chevron` | Single 90° chevron, rotated by CSS | Disclosure, sort, breadcrumb, select |
| `refresh` | Circular arrow with an arrowhead | Retry, reload, test connection |
| `clock` | Circle with two hands | Latency and timestamps |

**Secondary set (10)**

| Name | Description | Used on |
|---|---|---|
| `alert` | Triangle with an exclamation | Degraded and guard rows |
| `check` | Single tick | Pass, configured |
| `x` | Cross | Close, clear, fail |
| `handoff` | Arrow curving out of a bracket | Handoff reasons, handoff chips |
| `play` | Right-pointing triangle | Play sample, run golden set |
| `stop` | Rounded square | End session, stop sample |
| `plus` | Cross of two equal strokes | New prospect, add question |
| `trash` | Bin with a lid and two ruled lines | Delete |
| `lock` | Padlock, shackle closed | Authgate, security |
| `menu` | Three horizontal rules | Off-canvas nav toggle at < 1100 px |

### 7.8 Density and tables

- Two densities, tables only: **comfortable** (40 px rows, 10 px cell padding) and **compact**
  (32 px rows, 6 px cell padding, 12 px type). Toggle lives in `.arag-toolbar`; persisted in
  `localStorage["vb.density"]`; applies to every table in the app at once, because a per-table
  setting is a setting nobody finds twice.
- Header row 32 px, `--vb-fs-micro`, uppercase by CSS, sticky within the table's scroll container.
- Cell alignment: text left, numbers right (`.num`), status centred in its own fixed-width column.
- Truncation: one line with `text-overflow:ellipsis` and the full value in `title`. Never wrap a
  table cell except the card mode below 700 px.
- Zebra striping is not used. Row separation is a 1 px `--arag-brand-50` bottom border (the kit's
  existing choice).

### 7.9 Dark mode

The kit's `[data-theme="dark"]` block is the base. `ui-ext.css` adds only:

```
[data-theme="dark"] {
  --vb-side: #0e1626;          /* sidebar, slightly darker than the raised surface */
  --vb-band: #070d18;          /* utility band, darker than ink-950 so it still reads as chrome */
  --vb-shadow-2: 0 8px 28px rgba(0,0,0,.5);
  --vb-shadow-3: 0 24px 64px rgba(0,0,0,.6);
}
```

- `--vb-live` stays `#5ce500`: on `#0b1220` the contrast is ≈ 13 : 1, so on dark surfaces it may
  additionally carry small text and thin rules. It still never fills a large area behind text.
- Theme is applied by `shell.js` from `localStorage["vb.theme"]` (`light` / `dark` / `system`)
  **before first paint**, by setting `data-theme` on `<html>` in a synchronous inline module at
  the top of each document. `system` follows `prefers-color-scheme` live via `matchMedia`.
- Every screenshot in `docs/screenshots/` is taken in light theme at 1440 px; dark mode is
  verified by one screenshot of Live.
- The Progress wordmark uses `arag-logo-alt.svg` on every dark surface including the sign-in card,
  per §7.4's surface-luminance rule.

### 7.10 Motion

| Interaction | Duration / curve |
|---|---|
| Hover, focus, colour changes | 80 ms `ease` |
| Drawer open/close | 160 ms `cubic-bezier(.2,0,0,1)` |
| Modal fade | 120 ms `ease-out` |
| Brief version rail flash | 600 ms `ease-out`, opacity only |
| Changed-section wash | 400 ms `ease-out`, background only |
| Skeleton shimmer | 1400 ms linear, infinite |
| Status dot pulse | 1000 ms, opacity 1 → 0.35 (the kit's `arag-pulse`) |

Nothing moves position on the Live screen while a session is running except the transcript's own
scroll. Content is replaced in place. This is a deliberate constraint: the reader is holding a
conversation.
