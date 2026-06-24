import { describe, it, expect } from "./_expect.ts";
import {
  shapeForVoice,
  clampSentences,
  hasSpeakableViolation,
} from "../src/voiceShape.ts";

describe("shapeForVoice", () => {
  it("strips citation markers", () => {
    const out = shapeForVoice("You can change your plan online [1]. It applies next cycle [2].");
    expect(out).not.toMatch(/\[\d+\]/);
    expect(out).toContain("change your plan online");
  });

  it("strips bare URLs and keeps markdown link text", () => {
    const out = shapeForVoice(
      "See [the plans page](https://example.com/plans) or visit https://help.example.com now.",
    );
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).toContain("the plans page");
  });

  it("removes markdown decoration", () => {
    const out = shapeForVoice("## Heading\n\n- **Bold** point\n- `code` bit");
    expect(out).not.toMatch(/[#*`]/);
  });

  it("clamps to at most 3 sentences", () => {
    const out = shapeForVoice("One. Two. Three. Four. Five.");
    const count = (out.match(/[.!?]/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(3);
    expect(out.startsWith("One.")).toBe(true);
    expect(out).not.toContain("Four");
  });

  it("collapses whitespace and trims", () => {
    expect(shapeForVoice("  hello   \n\n  world  ")).toBe("hello world.");
  });

  it("ensures terminal punctuation", () => {
    expect(shapeForVoice("no full stop here")).toMatch(/[.!?]$/);
  });

  it("handles empty/nullish input safely", () => {
    expect(shapeForVoice("")).toBe("");
    // @ts-expect-error testing defensive nullish handling
    expect(shapeForVoice(undefined)).toBe("");
  });
});

describe("clampSentences", () => {
  it("keeps questions and exclamations intact", () => {
    expect(clampSentences("Really? Yes! No.", 2)).toBe("Really? Yes!");
  });
});

describe("hasSpeakableViolation", () => {
  it("flags leaked URLs and markers", () => {
    expect(hasSpeakableViolation("visit https://x.com")).toBe(true);
    expect(hasSpeakableViolation("see [1]")).toBe(true);
    expect(hasSpeakableViolation("clean spoken text.")).toBe(false);
  });
});
