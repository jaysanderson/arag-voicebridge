// The onboarding wizard.
//
// Not a tour and not a dismissible banner: a checklist of what this deployment still needs, with
// each step's state read from the live configuration on every visit (`GET /api/v1/setup`). A
// deployment that loses its Knowledge Box, or whose only API key is revoked, sees that step come
// back — a stored "dismissed" flag would have quietly lied about it.
//
// Only three steps are required. The sample conversation, the Ask tester and the whole session
// API work with no credentials at all, so a wizard that demanded an ElevenLabs key before showing
// anything would be misrepresenting the product.
import { api, boot, empty, errorState, esc, icon, mountShell, toast } from "./shell.js";

const $ = (s) => document.querySelector(s);

function stepCard(step, index, isNext) {
  const status = step.done
    ? '<span class="arag-chip ok">done</span>'
    : step.optional
      ? '<span class="arag-chip neutral">optional</span>'
      : '<span class="arag-chip warn">still to do</span>';
  return `<li class="vb-step${step.done ? " done" : ""}${isNext ? " next" : ""}" id="setup-${esc(step.id)}">
    <span class="vb-step-mark" aria-hidden="true">${step.done ? icon("check", 15) : index}</span>
    <div class="vb-step-body">
      <div class="vb-step-head">
        <h3>${esc(step.title)}</h3>
        ${status}
        ${isNext ? '<span class="arag-chip info">next</span>' : ""}
      </div>
      <p>${esc(step.body)}</p>
      <div class="vb-step-foot">
        ${step.detail ? `<span class="muted small">${esc(step.detail)}</span>` : ""}
        <span class="spacer"></span>
        ${
          step.href
            ? `<a class="arag-btn ${isNext ? "" : "secondary "}sm" href="${esc(step.href)}">${esc(
                step.action ?? "Open",
              )}</a>`
            : ""
        }
      </div>
    </div>
  </li>`;
}

function render(setup) {
  const done = setup.required_done;
  const total = setup.required_total;
  const optionalDone = setup.steps.filter((s) => s.optional && s.done).length;
  const optionalTotal = setup.steps.filter((s) => s.optional).length;
  // The first thing that is not done is the one the page should be about.
  const next = setup.steps.find((s) => !s.done && !s.optional) ?? setup.steps.find((s) => !s.done);

  $("#setupView").innerHTML = `
    <section class="arag-card" style="margin-bottom:20px">
      <div class="body">
        <div class="vb-setup-progress">
          <div>
            <strong>${
              setup.complete
                ? "This deployment is set up"
                : `${done} of ${total} required step${total === 1 ? "" : "s"} done`
            }</strong>
            <p class="muted small">${
              setup.complete
                ? `Everything required is in place. ${optionalDone} of ${optionalTotal} optional steps done — each one adds a channel rather than unlocking the product.`
                : "The product already works: the sample conversation and the Ask tester run against the built-in sample Knowledge Box. These steps point it at your own content and your own voice channel."
            }</p>
          </div>
          <div class="arag-meter" role="img" aria-label="${done} of ${total} required steps done">
            <span>Required</span><span class="val">${done}/${total}</span>
            <span class="track"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></span>
            <span>Optional</span><span class="val">${optionalDone}/${optionalTotal}</span>
            <span class="track"><i style="width:${
              optionalTotal ? Math.round((optionalDone / optionalTotal) * 100) : 0
            }%"></i></span>
          </div>
        </div>
      </div>
    </section>

    <ol class="vb-steps-list">
      ${setup.steps.map((s, i) => stepCard(s, i + 1, s === next)).join("")}
    </ol>`;
}

async function load() {
  const host = $("#setupView");
  try {
    const setup = await api("/api/v1/setup");
    render(setup);
    // The rail badge is the honest one: how much is still required, nothing else.
    document
      .querySelector("arag-app-shell")
      ?.setNavBadge?.("Set up", setup.complete ? "" : setup.required_total - setup.required_done);
  } catch (e) {
    host.innerHTML = errorState(e.message, "setupRetry");
    $("#setupRetry")?.addEventListener("click", load);
  }
}

const host = mountShell({
  section: "setup",
  title: "Set up",
  description: "What this deployment still needs, checked against its live configuration.",
  actions: `<button class="arag-btn secondary sm" id="setupRecheck">${icon("refresh", 14)} Check again</button>`,
});

await boot();
host.innerHTML = `<div id="setupView">${empty({
  icon: "check",
  title: "Checking this deployment",
  body: "Reading the live configuration.",
})}</div>`;
await load();

$("#setupRecheck")?.addEventListener("click", async () => {
  await load();
  toast("Checked again", "ok");
});

// Keep the page honest when someone changes something in another tab and comes back.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});
