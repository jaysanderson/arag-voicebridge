# When to use VoiceBridge — and when not

## Good fit

- **A person is handling a live conversation — support, sales discovery, an escalation — and needs
  grounded, current context as it moves**, not a static FAQ they have to stop and search. This is the
  core case: a listen session takes conversation from any source (a realtime STT stream, a telephony
  webhook, a meeting bot, or someone typing) and keeps one evolving, cited brief in front of them,
  refined turn by turn rather than reset each time.
- **The business case depends on provable grounding**, not just "the brief looks helpful" or "the
  bot can answer questions." If a stakeholder will ask "how do we know it isn't inventing that
  product fact?" or "what happens when it doesn't know?", the brief's factual fields are drawn only
  from the Knowledge Box with citations attached, and the deflection follow-on's deterministic
  handoff answers the second question the same way — built specifically to survive that question,
  not just to demo well once.
- **A pilot needs to start before any telephony or STT integration exists.** The session API is
  transport-agnostic: a pilot can begin with someone pasting or typing a transcript into Live and
  watching the brief build, then add a real speech-to-text feed once the core idea is proven —
  ElevenLabs Scribe out of the box if a key is configured, or any other STT feeding the same session.
- **Multiple customers/demo targets share one deployment**, each with its own Knowledge Box, voice,
  greeting and test questions. The prospect registry exists precisely so onboarding the fifth
  prospect costs the same as the second — a configuration change, not a code change.
- **Self-serve deflection is wanted as a second step, once listening is trusted.** The same grounded
  pipeline that feeds the brief can answer a caller directly over `POST /api/v1/voice-answer` when
  nobody's available, gated by a golden set before it's ever demoed or deployed. A text-first proof
  of concept works here too — the "ask it something" tester on Knowledge runs the identical pipeline
  as a live call.

## Poor fit

- **A full agent-assist suite with coaching, scoring, CRM and dialer integration is the requirement.**
  VoiceBridge does one thing — a grounded, cited, evolving brief and, as a follow-on, a grounded
  answer — not call recording, sentiment analytics, coaching workflows or telephony/CRM plumbing.
- **A single, static FAQ with no need for governance or citations.** If a prospect only needs "answer
  these known questions," the retrieval, throttling and handoff machinery here is more system than
  the problem requires — a simpler scripted or FAQ-matching bot may serve them better and cheaper.
- **Telephony/SIP is a hard requirement today.** VoiceBridge (and the shipped demo's voice transport
  and microphone client) is web-based; telephony is not built and is out of scope for the current
  implementation — see [`../architecture/limits.md`](../architecture/limits.md).
- **A scored, automated quality gate for the live brief, equivalent to the golden set.** That gate
  exists for the deflection pipeline only; judging whether a brief was useful on a given call is, for
  now, a manual read of the session's brief history in Conversations or Operator's Listen sessions
  view.
- **Sub-second brief updates with no tolerance for a throttled or deferred refresh.** The listen
  service deliberately throttles refreshes (a minimum word count, a minimum gap, a similarity check)
  so a fast-talking or noisy transcript doesn't turn every word into an LLM call; a refresh can be
  deferred by design when the throttle decides the last one was too recent.
- **Genuine multi-tenant production scale, today.** The single shared ARAG service-account token, the
  single-machine JSON store, the 200-session cap on live sessions, and the mock-only-verified golden
  corpus for any given prospect are all real limits at real production scale (see
  [`../architecture/limits.md`](../architecture/limits.md)) — this is a strong MVP/pilot shape, not
  (yet) a hardened multi-tenant SaaS platform.
- **A requirement that the system itself enforce document-level access control**, rather than
  demonstrate a retrieval filter. `security.groups` filters what a query can retrieve; it is not an
  authorisation boundary on the documents themselves — see
  [`../architecture/security-model.md`](../architecture/security-model.md) for the precise
  distinction, which matters a great deal if a prospect's compliance team asks about it directly.
