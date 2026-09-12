// Conversations — every call this deployment has listened to, searchable by what was said in it,
// with the full record behind each row: how the brief evolved, the transcript, the sources it drew
// on and how long each refresh took.
import { renderBrief } from "./brief.js";
import {
  ago,
  api,
  boot,
  citeChip,
  duration,
  empty,
  errorState,
  esc,
  fmtMs,
  icon,
  mountShell,
  openDrawer,
  prospectSwitcher,
  skeletonRows,
  stat,
  state,
  toast,
} from "./shell.js";

const PAGE = 20;
const filters = { q: "", status: "", prospect: "", sort: "started", order: "desc", offset: 0 };
let total = 0;

const $ = (s) => document.querySelector(s);

function chrome() {
  return `
    <div class="vb-filters">
      <label class="vb-search">
        ${icon("search", 15)}
        <input id="cvSearch" class="arag-input" type="search" placeholder="Search what was said, the brief, or a source…"
          aria-label="Search conversations" value="${esc(filters.q)}" />
      </label>
      <select id="cvProspect" class="arag-select" aria-label="Prospect">
        <option value="">All prospects</option>
        ${state.prospects.map((p) => `<option value="${esc(p.key)}">${esc(p.display_name)}</option>`).join("")}
      </select>
      <select id="cvStatus" class="arag-select" aria-label="Status">
        <option value="">Any status</option>
        <option value="live">Live</option>
        <option value="ended">Ended</option>
      </select>
      <span class="vb-result-count" id="cvCount"></span>
    </div>
    <div class="vb-table-wrap">
      <div class="vb-scroll">
        <table class="vb-table" id="cvTable">
          <thead><tr>
            <th data-sort="started" aria-sort="descending">Started ${icon("sortArrow", 12, "vb-sort")}</th>
            <th>Prospect</th>
            <th>Topic</th>
            <th>Status</th>
            <th class="num" data-sort="refreshes" aria-sort="none">Refreshes ${icon("sortArrow", 12, "vb-sort")}</th>
            <th class="num" data-sort="duration" aria-sort="none">Duration ${icon("sortArrow", 12, "vb-sort")}</th>
            <th class="num">Sources</th>
          </tr></thead>
          <tbody>${skeletonRows(6, 7)}</tbody>
        </table>
      </div>
      <div class="vb-pager" id="cvPager" hidden>
        <button class="arag-btn ghost sm" id="cvPrev">Previous</button>
        <button class="arag-btn ghost sm" id="cvNext">Next</button>
        <span class="spacer"></span>
        <span id="cvRange"></span>
      </div>
    </div>`;
}

function topicOf(s) {
  const b = s.brief;
  if (b && typeof b === "object" && typeof b.topic === "string" && b.topic.trim()) return b.topic;
  if (b && typeof b === "object" && typeof b.summary === "string" && b.summary.trim()) return b.summary;
  return "";
}

function row(s) {
  const topic = topicOf(s);
  const dur = Math.max(
    0,
    Math.round((Date.parse(s.endedAt ?? s.updatedAt) - Date.parse(s.createdAt)) / 1000),
  );
  const name = state.prospects.find((p) => p.key === s.prospect)?.display_name ?? s.prospect;
  return `<tr tabindex="0" data-id="${esc(s.id)}">
    <td>${ago(s.createdAt)}<div class="vb-sub vb-mono">${esc(s.id.slice(0, 8))}</div></td>
    <td>${esc(name)}</td>
    <td class="vb-primary"><span class="vb-truncate" style="max-width:38ch">${esc(topic || "No brief yet")}</span></td>
    <td>${
      s.status === "live"
        ? '<span class="arag-chip ok"><span class="vb-live-dot" style="margin-right:5px"></span>live</span>'
        : '<span class="arag-chip neutral">ended</span>'
    }</td>
    <td class="num">${s.stats.refreshes}${s.stats.failures ? `<div class="vb-sub">${s.stats.failures} failed</div>` : ""}</td>
    <td class="num">${esc(duration(dur))}</td>
    <td class="num">${s.citations.length}</td>
  </tr>`;
}

async function load() {
  const tbody = $("#cvTable tbody");
  tbody.innerHTML = skeletonRows(6, 7);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(filters.offset) });
  if (filters.q) qs.set("q", filters.q);
  if (filters.status) qs.set("status", filters.status);
  if (filters.prospect) qs.set("prospect", filters.prospect);
  qs.set("sort", filters.sort);
  qs.set("order", filters.order);
  try {
    const page = await api(`/api/v1/listen/sessions?${qs}`);
    total = page.total;
    if (!page.items.length) {
      tbody.innerHTML = `<tr><td colspan="7">${
        filters.q || filters.status || filters.prospect
          ? empty({
              icon: "search",
              title: "No conversation matches those filters",
              body: "Try a different word, or clear the filters to see every session.",
              action: '<button class="arag-btn secondary sm" id="cvClear">Clear filters</button>',
            })
          : empty({
              icon: "conversations",
              title: "No conversations yet",
              body: "Sessions appear here as soon as one has been listened to — start with the sample call in Live.",
              action: '<a class="arag-btn" href="/">Open Live</a>',
            })
      }</td></tr>`;
      $("#cvClear")?.addEventListener("click", () => {
        Object.assign(filters, { q: "", status: "", prospect: "", offset: 0 });
        $("#cvSearch").value = "";
        $("#cvStatus").value = "";
        $("#cvProspect").value = "";
        load();
      });
    } else {
      tbody.innerHTML = page.items.map(row).join("");
    }
    $("#cvCount").textContent = `${total} conversation${total === 1 ? "" : "s"}`;
    const pager = $("#cvPager");
    pager.hidden = total <= PAGE;
    $("#cvRange").textContent = `${filters.offset + 1}–${Math.min(filters.offset + PAGE, total)} of ${total}`;
    $("#cvPrev").disabled = filters.offset === 0;
    $("#cvNext").disabled = filters.offset + PAGE >= total;
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7">${errorState(e.message, "cvRetry")}</td></tr>`;
    $("#cvRetry")?.addEventListener("click", load);
  }
}

async function openDetail(id) {
  const close = openDrawer({
    title: "Conversation",
    sub: `<span class="vb-mono">${esc(id)}</span>`,
    actions: `<a class="arag-btn secondary sm" href="/api/v1/listen/sessions/${encodeURIComponent(id)}/export?format=markdown">${icon("download", 14)} Export</a>`,
    body: `<div class="vb-skeleton" style="height:220px"></div>`,
  });
  try {
    const s = await api(`/api/v1/listen/sessions/${encodeURIComponent(id)}/export`);
    const body = document.querySelector(".vb-drawer-body");
    const name = state.prospects.find((p) => p.key === s.prospect)?.display_name ?? s.prospect;
    const briefHtml = renderBrief(s.brief);
    body.innerHTML = `
      <div class="vb-stats" style="margin-bottom:20px">
        ${stat("Prospect", name)}
        ${stat("Duration", duration(s.durationSec))}
        ${stat("Brief versions", s.briefVersion)}
        ${stat("Refreshes", s.stats.refreshes, `${s.stats.skipped} throttled · ${s.stats.failures} failed`)}
        ${stat("Refresh p50", s.stats.p50LatencyMs ? fmtMs(s.stats.p50LatencyMs) : "—", s.stats.p95LatencyMs ? `p95 ${fmtMs(s.stats.p95LatencyMs)}` : "")}
        ${stat("Sources", s.citations.length)}
      </div>

      <h3>Final brief</h3>
      ${
        briefHtml
          ? `<div class="vb-brief" style="margin-bottom:8px">${briefHtml}</div>
             <div class="vb-chip-row">${s.citations.map(citeChip).join("")}</div>`
          : empty({
              icon: "info",
              title: "This session never produced a brief",
              body: "Either too little was said, or every refresh came back without anything grounded to show.",
            })
      }

      <h3 style="margin-top:24px">How the brief evolved</h3>
      ${
        s.briefHistory.length
          ? `<div class="vb-timeline">${s.briefHistory
              .slice()
              .reverse()
              .map(
                (h, i) => `<div class="vb-tl-item${i === 0 ? " current" : ""}">
                  <span class="vb-tl-dot"></span>
                  <div>
                    <div class="vb-tl-head"><strong>v${h.version}</strong>${ago(h.at)}<span class="arag-chip neutral">${esc(fmtMs(h.latencyMs))}</span></div>
                    <div class="vb-tl-body">${esc(
                      (h.brief && typeof h.brief === "object" && (h.brief.topic || h.brief.summary)) || "—",
                    )}</div>
                  </div>
                </div>`,
              )
              .join("")}</div>`
          : '<p class="muted small">No refresh produced a usable brief.</p>'
      }

      <h3 style="margin-top:24px">Transcript</h3>
      <div class="vb-transcript" style="max-height:none">${
        s.transcript.length
          ? s.transcript
              .map(
                (t) =>
                  `<div class="line ${esc(t.speaker)}"><span class="who">${esc(t.speaker)}</span><span>${esc(t.text)}</span></div>`,
              )
              .join("")
          : '<p class="muted small">Nothing was heard in this session.</p>'
      }</div>`;
  } catch (e) {
    const body = document.querySelector(".vb-drawer-body");
    if (body) body.innerHTML = errorState(e.message);
    toast(e.message, "error");
  }
  return close;
}

function wire() {
  let t;
  $("#cvSearch").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      filters.q = e.target.value.trim();
      filters.offset = 0;
      load();
    }, 280);
  });
  $("#cvStatus").addEventListener("change", (e) => {
    filters.status = e.target.value;
    filters.offset = 0;
    load();
  });
  $("#cvProspect").addEventListener("change", (e) => {
    filters.prospect = e.target.value;
    filters.offset = 0;
    load();
  });
  $("#cvPrev").addEventListener("click", () => {
    filters.offset = Math.max(0, filters.offset - PAGE);
    load();
  });
  $("#cvNext").addEventListener("click", () => {
    filters.offset = Math.min(filters.offset + PAGE, Math.max(0, total - 1));
    load();
  });
  for (const th of document.querySelectorAll("#cvTable th[data-sort]")) {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      filters.order = filters.sort === key && filters.order === "desc" ? "asc" : "desc";
      filters.sort = key;
      filters.offset = 0;
      for (const other of document.querySelectorAll("#cvTable th[data-sort]")) {
        other.setAttribute(
          "aria-sort",
          other === th ? (filters.order === "asc" ? "ascending" : "descending") : "none",
        );
      }
      load();
    });
  }
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("#cvTable tbody tr[data-id]");
    if (tr) openDetail(tr.dataset.id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const tr = e.target.closest?.("#cvTable tbody tr[data-id]");
    if (tr) openDetail(tr.dataset.id);
  });
}

const host = mountShell({
  section: "conversations",
  title: "Conversations",
  description:
    "Every session this deployment has listened to. Open one to see the brief it ended with, how it " +
    "got there, and everything it drew on.",
  actions: `<button class="arag-btn ghost sm" id="cvReload">${icon("refresh", 14)} Reload</button>`,
});

await boot();
host.innerHTML = chrome();
prospectSwitcher();
wire();
document.getElementById("cvReload")?.addEventListener("click", load);
// A session id in the fragment opens straight into its detail (Live links here when one ends).
await load();
if (location.hash.length > 1) openDetail(decodeURIComponent(location.hash.slice(1)));
