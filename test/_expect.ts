/**
 * A tiny zero-dependency `expect` shim over node:assert, plus re-exports of describe/it
 * from node:test. This lets the test files stay in a familiar matcher style while the whole
 * project runs with bare `node --test` — no vitest, no install (npm is not available here).
 *
 * Only the matchers the suite actually uses are implemented.
 */

import assert from "node:assert/strict";

export { after, before, beforeEach, describe, it } from "node:test";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Partial deep-match: every key in `expected` must match in `actual`. */
function matchObject(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!isObject(actual)) return false;
  for (const [k, v] of Object.entries(expected)) {
    const a: unknown = (actual as Record<string, unknown>)[k];
    if (isObject(v) && !Array.isArray(v)) {
      if (!matchObject(a, v as Record<string, unknown>)) return false;
    } else {
      try {
        assert.deepStrictEqual(a, v);
      } catch {
        return false;
      }
    }
  }
  return true;
}

export interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatch(re: RegExp): void;
  toContain(sub: unknown): void;
  toHaveLength(n: number): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toMatchObject(expected: Record<string, unknown>): void;
  not: Omit<Matchers, "not">;
}

// biome-ignore lint/suspicious/noExplicitAny: a matcher shim accepts any asserted value.
export function expect(actual: any): Matchers {
  const make = (negate: boolean): Omit<Matchers, "not"> => ({
    toBe(expected) {
      negate ? assert.notStrictEqual(actual, expected) : assert.strictEqual(actual, expected);
    },
    toEqual(expected) {
      negate ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected);
    },
    toMatch(re) {
      const ok = re.test(String(actual));
      assert.ok(negate ? !ok : ok, `expected ${actual} ${negate ? "not " : ""}to match ${re}`);
    },
    toContain(sub) {
      const ok = Array.isArray(actual) ? actual.includes(sub) : String(actual).includes(String(sub));
      assert.ok(negate ? !ok : ok, `expected ${actual} ${negate ? "not " : ""}to contain ${sub}`);
    },
    toHaveLength(n) {
      const len = (actual as { length: number }).length;
      negate ? assert.notStrictEqual(len, n) : assert.strictEqual(len, n);
    },
    toBeGreaterThan(n) {
      assert.ok(negate ? !(actual > n) : actual > n, `expected ${actual} > ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      assert.ok(negate ? !(actual >= n) : actual >= n, `expected ${actual} >= ${n}`);
    },
    toBeLessThanOrEqual(n) {
      assert.ok(negate ? !(actual <= n) : actual <= n, `expected ${actual} <= ${n}`);
    },
    toMatchObject(expected) {
      const ok = matchObject(actual, expected);
      assert.ok(negate ? !ok : ok, `object ${negate ? "" : "did not "}match`);
    },
  });

  return { ...make(false), not: make(true) } as Matchers;
}
