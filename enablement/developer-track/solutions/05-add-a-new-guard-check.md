# Solution 5 — Add a guard that blocks a card number before it reaches ARAG

`src/services/safety.ts`:

```ts
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /\b(kill|harm|hurt)\s+(myself|yourself|someone)\b/i,
  /\bhow (?:do|to) (?:i )?make (?:a )?(?:bomb|weapon|explosive)\b/i,
  // EXERCISE 5: naive card-number detector — never forward what looks like a PAN to ARAG.
  /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}\b/,
];
```

`test/safety.test.ts`:

```ts
describe("guardInput (exercise 5: card-number guard)", () => {
  it("rejects input containing what looks like a card number", () => {
    const r = guardInput("My card number is 4111 1111 1111 1111, can you check my order?");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unsafe-request");
  });
  it("does not false-positive on a normal payment question", () => {
    expect(guardInput("How do I update my payment details?").ok).toBe(true);
  });
});
```

```bash
make test
```

```
ℹ tests 162
ℹ pass 162
ℹ fail 0
```

(162, two more than whatever `make test` reports on a clean checkout before this change — the
absolute number will differ depending on what else has landed since; what matters is `fail 0` and
exactly two more passing tests.)

Live:

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"My card number is 4111 1111 1111 1111, can you check my order?","conversation_id":"ex5-block"}'
```

```json
{"answer":"I can only help with support questions about this service. Let me get a team member for anything else.","citations":[],"handoff":true,"latency_ms":{"retrieve":0,"first_token":0,"total":1},"handoff_reason":"unsafe-request"}
```

```bash
curl -s -X POST http://localhost:8099/api/v1/voice-answer -H 'content-type: application/json' \
  -d '{"prospect":"progress","question":"How do I update my payment details?","conversation_id":"ex5-allow"}'
```

```json
{"answer":"Let me hand you over to a specialist who can help with that.","citations":[],"handoff":true,"latency_ms":{"retrieve":14,"first_token":14,"total":17},"handoff_reason":"sentinel"}
```

Both hand off — but for entirely different reasons. The first never reached ARAG (`reason:
"unsafe-request"`, the guard fired). The second reached ARAG, retrieved nothing relevant from the
additive-manufacturing mock corpus, and the voice prompt's own `HANDOFF:` sentinel fired
(`reason: "sentinel"`) — a completely ordinary, content-driven handoff that would behave the same
way against a real telco Knowledge Box that *did* have payment content.

## Why the regex is shaped this way

```
/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}\b/
```

Four groups of digits, each optionally separated by a space or dash, the last group 3–4 digits
(covering 15-digit Amex-style and 16-digit Visa/Mastercard-style numbers) — a shape check, not a
validity check. There's no Luhn digit-sum validation and no attempt to distinguish a real card
number from sixteen random digits: precision is not the point here. `guardInput` runs before
anything is sent anywhere, so the cost of a false positive (an unusual, harmless 16-digit string
gets deflected) is a slightly awkward customer conversation; the cost of a false negative (a real
card number reaches ARAG, gets logged in a request trace, ends up in a stored search
configuration's history) is a real data-handling incident. That asymmetry is why this guard is
deliberately generous about what it blocks.

## Why a blocklist, not a whitelist

`guardInput` blocks specific, narrow, known-dangerous shapes — an injection phrasing, a
self-harm phrasing, a card-number shape — and lets everything else through to ARAG, where
`decideHandoff` (`src/services/handoff.ts`) is the real arbiter of whether a question can be
answered at all. A whitelist ("only forward questions matching an approved shape") would have to
anticipate every legitimate way a caller might phrase every legitimate support question, in every
supported locale, before the product could ship a single new prospect — and it would still be
wrong on day one for a support conversation that includes an order number, an address, a product
model with unusual punctuation, or simply a phrasing nobody anticipated. The guard's job is to
catch specific, known bad shapes cheaply and deterministically; the grounding-and-retrieval
pipeline is what already decides, per-question, whether an *answer* is safe to give.
