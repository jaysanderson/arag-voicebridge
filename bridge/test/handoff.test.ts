import { describe, it, expect } from "./_expect.ts";
import { decideHandoff, stripSentinel, HANDOFF_SENTINEL } from "../src/handoff.ts";

describe("decideHandoff", () => {
  it("hands off on the sentinel prefix (the prompt↔bridge contract)", () => {
    const d = decideHandoff(`${HANDOFF_SENTINEL} I don't have that in the knowledge base.`, 5);
    expect(d.handoff).toBe(true);
    expect(d.reason).toBe("sentinel");
  });

  it("is case-insensitive on the sentinel", () => {
    expect(decideHandoff("handoff: nope", 3).handoff).toBe(true);
  });

  it("hands off on ARAG's stock not-found phrasing (belt-and-braces)", () => {
    const d = decideHandoff("Not enough data to answer this.", 5);
    expect(d.handoff).toBe(true);
    expect(d.reason).toBe("not-found-phrase");
  });

  it("does NOT false-handoff on a real answer that merely contains 'find'", () => {
    expect(decideHandoff("You can find your plan in the portal.", 2).handoff).toBe(false);
  });

  it("hands off on empty answer", () => {
    expect(decideHandoff("", 4)).toEqual({ handoff: true, reason: "empty-answer" });
  });

  it("hands off when nothing was retrieved (ungrounded)", () => {
    expect(decideHandoff("Some confident-sounding answer.", 0)).toEqual({
      handoff: true,
      reason: "no-retrieval",
    });
  });

  it("answers when grounded and non-empty", () => {
    expect(decideHandoff("You can do it in the portal.", 2)).toEqual({ handoff: false });
  });
});

describe("stripSentinel", () => {
  it("removes the sentinel prefix", () => {
    expect(stripSentinel("HANDOFF: nope")).toBe("nope");
    expect(stripSentinel("just text")).toBe("just text");
  });
});
