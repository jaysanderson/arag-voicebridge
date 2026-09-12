# Screenshots

Captured at 1440 px against the mock Knowledge Box (`ARAG_MOCK=1`), so every screen shows real
data produced by the real pipeline — nothing here is mocked at the UI layer.

Regenerate with:

```sh
PW_TESTDIR=test/shots PW_DISABLE_TS_ESM=1 bunx playwright test --workers=1
```

`test/shots/after.spec.ts` drives it. It is deliberately outside `make e2e` (whose `testDir` is
`test/e2e`), so refreshing the screenshots is an explicit act.

## Before — the product-experience pass (D-28)

The single-page console with mode tabs that the pass replaced.

| File | Screen |
|---|---|
| `before-01-live.png` | Console, Listen tab |
| `before-02-live-session.png` | Listen with a brief and citations |
| `before-03-ask.png` | Ask tab |
| `before-04-golden.png` | Golden set tab |
| `before-05-call.png` | Call tab |
| `before-06-admin-signin.png` | Admin sign-in |
| `before-07-admin-overview.png` | Admin overview |
| `before-08-admin-prospects.png` | Admin prospects |
| `before-09-admin-listen-sessions.png` | Admin listen sessions |
| `before-10-admin-turns.png` | Admin turn log |
| `before-11-admin-config.png` | Admin configuration |

## After

The workspace: a Progress-branded rail, six product sections, and the operator views in the same
shell.

| File | Screen |
|---|---|
| `after-01-live-onboarding.png` | Live, first run |
| `after-02-live-session.png` | Live, a session running — the brief at v4 with its sources |
| `after-03-live-webhook.png` | Live, the telephony webhook integration drawer |
| `after-04-conversations.png` | Conversations list |
| `after-05-conversation-detail.png` | Conversation record: final brief, how it evolved, transcript |
| `after-06-knowledge.png` | Knowledge: the Knowledge Box, the Ask tester, the golden gate open |
| `after-07-quality.png` | Quality: metrics, turn log, handoff and guard reasons |
| `after-08-prospects.png` | Prospects, read-only until the operator token is entered |
| `after-09-settings.png` | Settings: connection, branding preview, integrations incl. the ElevenLabs agent wiring |
| `after-10-operator-signin.png` | Operator sign-in |
| `after-11-operator-overview.png` | Operator overview |
| `after-12-operator-sessions.png` | Operator listen sessions |
| `after-13-operator-turns.png` | Operator turn log, guard trips redacted |
| `after-14-operator-security.png` | Operator security: access, budgets, what is kept |
