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
