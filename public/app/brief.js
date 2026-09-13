// The brief renderer — one panel, refined as the conversation moves, never a stream of alerts.
// Shared by the Live workspace and the Conversations detail view so a saved brief looks exactly
// like the one the handler was reading at the time.
import { esc } from "/ui/arag-ui.js";
import { icon } from "./icons.js";

function list(items, cls = "") {
  const arr = (items ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  return arr.length ? `<ul class="${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
}

function section(label, html) {
  return html ? `<div class="label">${esc(label)}</div>${html}` : "";
}

/** Render a brief object as HTML. Returns "" when there is nothing worth showing yet. */
export function renderBrief(b) {
  if (!b || typeof b !== "object") return "";
  let html = "";
  if (b.topic) html += `<div class="topic">${esc(b.topic)}</div>`;
  const chips = [];
  if (b.their_goal) {
    chips.push(
      `<span class="arag-chip info">${icon("target", 13)} ${esc(b.their_goal)}</span>`.replace("> ", ">"),
    );
  }
  if (b.stage) chips.push(`<span class="arag-chip outline">${esc(b.stage)}</span>`);
  if (chips.length) html += `<div class="row">${chips.join("")}</div>`;
  if (b.caller_profile) {
    html += `<div class="who">${icon("person", 14)}<span>${esc(b.caller_profile)}</span></div>`;
  }
  if (b.summary) html += `<p>${esc(b.summary)}</p>`;
  html += section("Key points", list(b.key_points));
  html += section("Ask them", list(b.suggested_questions));
  html += section("You could say", list(b.suggested_answers, "say"));
  html += section("Recommend", list(b.recommended_products));
  return html;
}

/** True when a brief carries something a person can read (mirrors isUsableBrief on the server). */
export function hasBrief(b) {
  return Boolean(renderBrief(b));
}

/** The brief's fields, in the order the panel shows them. Drives both rendering and comparison. */
export const BRIEF_FIELDS = [
  ["topic", "Topic"],
  ["caller_profile", "Who is calling"],
  ["their_goal", "What they want"],
  ["stage", "Stage"],
  ["summary", "Summary"],
  ["key_points", "Key points"],
  ["suggested_questions", "Ask them"],
  ["suggested_answers", "You could say"],
  ["recommended_products", "Recommend"],
];

const text = (v) => String(v ?? "").trim();
const arr = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

/**
 * Compare two versions of a brief, field by field.
 *
 * The interesting question when you review a call is not what the brief ended as — the record
 * already shows that — but *when it changed its mind*: the moment the caller said the thing that
 * moved the topic, or the moment a recommendation appeared. So a list field is compared item by
 * item (what was added, what was dropped) rather than as one blob of text, and a field that did
 * not move is reported as unchanged rather than left out, because "this stayed the same across
 * four refreshes" is itself an answer.
 */
export function diffBriefs(before, after) {
  const a = before && typeof before === "object" ? before : {};
  const b = after && typeof after === "object" ? after : {};
  return BRIEF_FIELDS.map(([key, label]) => {
    const isList = Array.isArray(a[key]) || Array.isArray(b[key]);
    if (isList) {
      const from = arr(a[key]);
      const to = arr(b[key]);
      const items = [
        ...to.map((t) => ({ text: t, kind: from.includes(t) ? "same" : "added" })),
        ...from.filter((t) => !to.includes(t)).map((t) => ({ text: t, kind: "removed" })),
      ];
      const moved = items.some((i) => i.kind !== "same");
      return {
        key,
        label,
        list: true,
        items,
        kind: !from.length && !to.length ? "empty" : moved ? "changed" : "same",
      };
    }
    const from = text(a[key]);
    const to = text(b[key]);
    const kind = from === to ? (from ? "same" : "empty") : !from ? "added" : !to ? "removed" : "changed";
    return { key, label, list: false, before: from, after: to, kind };
  });
}

/** How many fields actually moved between two versions. */
export function countChanges(rows) {
  return rows.filter((r) => r.kind !== "same" && r.kind !== "empty").length;
}
