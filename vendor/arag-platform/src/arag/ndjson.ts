/**
 * NDJSON helpers for the ARAG `/ask` stream.
 *
 * Every line is `{ "item": { "type": "…", … } }` on current ARAG; older shapes put fields at the
 * top level. `normaliseItem` accepts both and returns a typed `AskStreamItem`.
 */
import type { AskStreamItem } from "./types.ts";

/** Normalise one parsed NDJSON object into an AskStreamItem (or null if unrecognisable). */
export function normaliseItem(obj: unknown): AskStreamItem | null {
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const node = (o.item && typeof o.item === "object" ? o.item : o) as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : undefined;

  // Structured answer can arrive as a top-level `answer_json` (synchronous shape) or typed item.
  const aj =
    o.answer_json ??
    node.answer_json ??
    (type === "answer_json" ? (node.object ?? node.json ?? node.value) : undefined);
  if (aj && typeof aj === "object") return { type: "answer_json", object: aj };

  if (type === "answer") {
    const t = node.text ?? node.answer ?? node.content;
    return { type: "answer", text: typeof t === "string" ? t : "" };
  }
  if (type === undefined && typeof o.answer === "string") return { type: "answer", text: o.answer };
  if (type === "retrieval") {
    const results = (node.results ?? node) as Record<string, unknown>;
    return { type: "retrieval", results: results as AskStreamItem extends { results: infer R } ? R : never };
  }
  if (type === "citations") {
    const c = (node.citations ?? {}) as Record<string, Array<[number, number]>>;
    return { type: "citations", citations: c };
  }
  if (type) return { ...(node as Record<string, unknown>), type } as AskStreamItem;
  return null;
}

/**
 * Incrementally split a byte stream into complete NDJSON lines. Feed `push(chunk)`; it returns
 * the parsed objects for every complete line. Call `flush()` at the end for a trailing partial line.
 */
export class NdjsonSplitter {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  /** Lines that failed to parse (kept for diagnostics, capped). */
  readonly malformed: string[] = [];

  push(chunk: Uint8Array): unknown[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const out: unknown[] = [];
    let nl = this.buffer.indexOf("\n");
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.parseInto(line, out);
      nl = this.buffer.indexOf("\n");
    }
    return out;
  }

  flush(): unknown[] {
    const out: unknown[] = [];
    const tail = (this.buffer + this.decoder.decode()).trim();
    this.buffer = "";
    if (tail) this.parseInto(tail, out);
    return out;
  }

  private parseInto(line: string, out: unknown[]): void {
    try {
      out.push(JSON.parse(line));
    } catch {
      if (this.malformed.length < 20) this.malformed.push(line.slice(0, 200));
    }
  }
}

/** Async-iterate a fetch body as normalised AskStreamItems. */
export async function* iterateAskStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AskStreamItem> {
  const reader = body.getReader();
  const splitter = new NdjsonSplitter();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const obj of splitter.push(value)) {
        const item = normaliseItem(obj);
        if (item) yield item;
      }
    }
    for (const obj of splitter.flush()) {
      const item = normaliseItem(obj);
      if (item) yield item;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Serialise an item back to an NDJSON line in the canonical `{item:{…}}` envelope. */
export function toNdjsonLine(item: AskStreamItem | Record<string, unknown>): string {
  return `${JSON.stringify({ item })}\n`;
}
