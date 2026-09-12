# Exercise 2 — Write a golden question that catches a real mistake

**Goal:** understand what a golden-set check actually asserts by writing one that fails first,
then fixing it, using `orbital` from Exercise 1 (or any prospect you control).

## Task

1. `PUT /api/v1/admin/prospects/orbital` with a second golden question of `"expect": "answer"`
   and a `must_include` term that is **plausible-sounding but wrong** — something a careless
   person might type without checking the actual source text in `src/services/seed.ts`. (If you
   want a ready-made example of this exact mistake, see `solutions/02-write-a-golden-question.md`
   — but try writing your own wrong one first.)

2. Run the golden set and read the failure:

   ```bash
   BASE_URL=http://localhost:8099 node scripts/eval.ts orbital
   ```

3. Fix the `must_include` term to something the actual answer text contains, `PUT` again, and
   re-run until it passes.

4. Now add a **third** golden question with `"expect": "handoff"` for a question the mock corpus
   cannot possibly answer (anything outside additive manufacturing). Confirm it passes too.

## Done when

`scripts/eval.ts` exits `0` (POSIX success) for `orbital` with **all** questions passing:

```bash
BASE_URL=http://localhost:8099 node scripts/eval.ts orbital; echo "exit code: $?"
```

The last line must read `exit code: 0`, and the summary line must show `0 failed`.

## Think about

- `checkTurn` in `src/services/goldenEval.ts` runs several checks for an "answer" question, not
  just yours: it also asserts ≥1 citation, no spoken URLs, no citation markers, and ≤3 sentences.
  A `must_include` failure is only one of several ways a question can fail — read the `checks`
  array in a failing result to see all of them, not just the first.
- Why does a "handoff" question have far fewer checks than an "answer" question? (Look at
  `checkTurn`'s `if (gq.expect === "answer")` branch.) What does that asymmetry tell you about
  what the golden set is actually trying to guarantee?
