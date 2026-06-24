import { describe, it, expect } from "./_expect.ts";
import { extractCitations } from "../src/citations.ts";

describe("extractCitations", () => {
  it("maps retrieval items to {title,url,score} and sorts by score desc", () => {
    const out = extractCitations([
      { title: "Low", url: "https://a", score: 0.2 },
      { title: "High", url: "https://b", score: 0.9 },
    ]);
    expect(out.map((c) => c.title)).toEqual(["High", "Low"]);
  });

  it("skips items without a title", () => {
    const out = extractCitations([{ url: "https://x", score: 1 }, { title: "Keep", url: "" }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Keep");
  });

  it("dedupes by title+url, keeping the higher score", () => {
    const out = extractCitations([
      { title: "Same", url: "https://a", score: 0.3 },
      { title: "Same", url: "https://a", score: 0.7 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(0.7);
  });

  it("caps at 4 citations", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      title: `T${i}`,
      url: `https://u/${i}`,
      score: i / 10,
    }));
    expect(extractCitations(items)).toHaveLength(4);
  });

  it("coerces bad scores to 0", () => {
    const out = extractCitations([{ title: "X", url: "https://x", score: undefined }]);
    expect(out[0]!.score).toBe(0);
  });
});
