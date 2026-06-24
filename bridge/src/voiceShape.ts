/**
 * Voice-shaping (SPEC §6.2.2 step 5, S5).
 *
 * ARAG returns written prose. TTS must speak something natural: ≤ 3 sentences, no URLs,
 * no markdown, no citation markers. This is a defence-in-depth backstop — the voice-answer
 * prompt (docs/voice-answer-prompt.md) already asks for spoken shape, but we never trust
 * the model to be perfect on something the prospect will literally hear.
 */

const MAX_SENTENCES = 3;

/** Strip inline citation markers like [1], [2,3], [12]. */
function stripCitationMarkers(text: string): string {
  return text.replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "");
}

/** Strip bare URLs and markdown links, keeping the link's visible text. */
function stripUrls(text: string): string {
  // Markdown link [label](url) → label
  let out = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1");
  // Bare http(s):// URLs and www.* → removed
  out = out.replace(/\bhttps?:\/\/[^\s)]+/gi, "");
  out = out.replace(/\bwww\.[^\s)]+/gi, "");
  return out;
}

/** Remove common markdown decoration that reads badly aloud. */
function stripMarkdown(text: string): string {
  let out = text;
  out = out.replace(/```[\s\S]*?```/g, " "); // code fences
  out = out.replace(/`([^`]+)`/g, "$1"); // inline code
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, ""); // headings
  out = out.replace(/(\*\*|__)(.*?)\1/g, "$2"); // bold
  out = out.replace(/(\*|_)(.*?)\1/g, "$2"); // italic
  out = out.replace(/^\s*[-*+]\s+/gm, ""); // bullet markers
  out = out.replace(/^\s*\d+\.\s+/gm, ""); // ordered list markers
  out = out.replace(/^\s*>\s?/gm, ""); // blockquote
  return out;
}

/** Collapse all runs of whitespace (incl. newlines) to single spaces and trim. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split into sentences and keep the first N. Simple and robust: split on
 * sentence-final punctuation followed by whitespace. Good enough for the ≤3-sentence
 * answers ARAG produces under the voice prompt.
 */
export function clampSentences(text: string, max = MAX_SENTENCES): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const parts = trimmed.match(/[^.!?]+[.!?]+(?:["')\]]*)|[^.!?]+$/g);
  if (!parts) return trimmed;
  const kept = parts.slice(0, max).map((s) => s.trim());
  let joined = kept.join(" ").trim();
  // Ensure it ends with terminal punctuation so TTS prosody lands.
  if (joined && !/[.!?]$/.test(joined)) joined += ".";
  return joined;
}

/**
 * Full voice-shaping pipeline. Order matters: strip structure before clamping so a
 * stripped URL doesn't leave a dangling "sentence".
 */
export function shapeForVoice(raw: string, maxSentences = MAX_SENTENCES): string {
  let out = raw ?? "";
  out = stripCitationMarkers(out);
  out = stripUrls(out);
  out = stripMarkdown(out);
  out = collapseWhitespace(out);
  // Tidy spaces left before punctuation by the strips above.
  out = out.replace(/\s+([.,!?;:])/g, "$1");
  out = clampSentences(out, maxSentences);
  return out;
}

/** Predicate used by tests and the output guard: does the text still leak a URL/marker? */
export function hasSpeakableViolation(text: string): boolean {
  return (
    /\bhttps?:\/\//i.test(text) ||
    /\bwww\./i.test(text) ||
    /\[\s*\d+\s*\]/.test(text) ||
    /[#*`]/.test(text)
  );
}
