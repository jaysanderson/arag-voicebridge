# When to use VoiceBridge — and when not

## Good fit

- **A voice agent already exists (or is being built) on a platform with its own STT/turn-taking/TTS**
  and needs a grounded, cited, governed answer layer rather than the platform's own built-in
  knowledge base. This is the core case: VoiceBridge is the retrieval-and-answer slot, not a voice
  platform in its own right.
- **The business case depends on provable grounding and a clean handoff**, not just "the bot can
  answer questions." If a prospect will ask "what happens when it doesn't know?" or "how do we know
  it isn't making things up?", VoiceBridge's deterministic handoff and citation-as-data model are
  built specifically to answer that in a way a reviewer can verify, not just take on trust.
- **Multiple customers/demo targets share one deployment**, each with its own Knowledge Box, voice,
  greeting and test questions. The prospect registry and the golden-set gate exist precisely so
  onboarding the fifth prospect costs the same as the second — a configuration change, not a code
  change.
- **An agent-assist ("whisper") pattern**, where a structured, evolving brief supports a human
  handling a live conversation rather than (or alongside) fully autonomous self-service. This is
  arguably the lower-risk way to introduce the technology: it sidesteps "can I trust a bot with my
  customers" entirely, and puts citations exactly where a human reviewer wants them — on their own
  screen, in real time.
- **A text-first proof of concept is acceptable before committing to a phone/voice pipeline.** The
  console's Ask tab runs the identical pipeline as a live call, so the grounding and handoff story
  can be demonstrated and validated with zero voice infrastructure at all.

## Poor fit

- **A single, static FAQ with no need for governance or citations.** If a prospect only needs
  "answer these known questions," the retrieval and handoff machinery here is more system than the
  problem requires — a simpler scripted or FAQ-matching bot may serve them better and cheaper.
- **Telephony/SIP is a hard requirement today.** VoiceBridge (and the shipped demo's voice
  transport) is web-based; telephony is not built and is out of scope for the current
  implementation — see [`../architecture/limits.md`](../architecture/limits.md).
- **Sub-800ms round-trip perceived latency is a hard requirement with no holding phrase allowed.**
  Generation time-to-first-token dominates turn latency (see
  [`../architecture/scaling.md`](../architecture/scaling.md)); the shipped pattern manages this with
  a fast model, a `noop` reranker and a holding phrase on the voice agent's side, but the underlying
  ARAG call is not sub-200ms and no amount of bridge-side optimisation changes that.
- **Genuine multi-tenant production scale, today.** The single shared ARAG service-account token,
  the single-machine JSON store, and the mock-only-verified golden corpus for any given prospect are
  all real limits at real production scale (see [`../architecture/limits.md`](../architecture/limits.md)) —
  this is a strong MVP/demo-to-first-customers shape, not (yet) a hardened multi-tenant SaaS
  platform.
- **A requirement that the system itself enforce document-level access control**, rather than
  demonstrate a retrieval filter. `security.groups` filters what a query can retrieve; it is not an
  authorisation boundary on the documents themselves — see
  [`../architecture/security-model.md`](../architecture/security-model.md) for the precise
  distinction, which matters a great deal if a prospect's compliance team asks about it directly.
