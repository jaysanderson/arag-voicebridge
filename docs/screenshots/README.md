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

## After — the product-experience pass (D-28)

The workspace: a Progress-branded rail, the product sections, and the operator views in the same
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
| `after-09-settings.png` | Settings, at the connection section |
| `after-10-operator-signin.png` | Operator sign-in |
| `after-11-operator-overview.png` | Operator overview |
| `after-12-operator-sessions.png` | Operator listen sessions |
| `after-13-operator-turns.png` | Operator turn log, guard trips redacted |
| `after-14-operator-security.png` | Operator security: access, budgets, what is kept |

## After — the full-implementation pass

What this pass added: every setting editable in the product, the ElevenLabs agent configured from
inside it, and the surfaces that let a stranger watch the product explain itself.

| File | Screen |
|---|---|
| `after-15-setup.png` | Set up: the first-run checklist, read from the live configuration |
| `after-16-pipeline-stepper.png` | The Ask tester with the nine-step pipeline trace open |
| `after-17-brief-comparison.png` | A conversation record comparing two versions of the brief |
| `after-18-api-explorer.png` | The API explorer, mid try-it, with the response and the curl |
| `after-19-operator-logs.png` | The operator log, paged over the ring |
| `after-20-settings-branding.png` | Settings → Branding: the editor and its live preview |
| `after-21-settings-api-keys.png` | Settings → API keys: the real key store |
| `after-22-settings-voice-agent.png` | Settings → ElevenLabs: the voice agent, ready to push |
| `after-23-prospect-form.png` | The prospect editor, as a form rather than a JSON textarea |
| `after-24-prospect-branding-preview.png` | The prospect's brand overlay, layered live on the deployment's |

Every screen is also checked for horizontal overflow at 1440, 1200, 1024, 768 and 390 px by
`test/shots/responsive.spec.ts`.
