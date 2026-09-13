// Conversations — every call this deployment has listened to, searchable by what was said in it,
// with the full record behind each row: how the brief evolved, the transcript, the sources it drew
// on and how long each refresh took.
import { renderBrief } from "./brief.js";
import { go, onRoute, params } from "./route.js";
import {
  activatableRows,
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
/** View state lives in the query string, so a filtered list is shareable and Back works. */
const filters = { q: "", status: "", prospect: "", sort: "started", order: "desc", offset: 0 };
let total = 0;
let closeDetail = null;

function readUrl() {
  const p = params();
  filters.q = p.q ?? "";
  filters.status = p.status ?? "";
  filters.prospect = p.prospect ?? "";
  filters.sort = p.sort ?? "started";
  filters.order = p.order ?? "desc";
  filters.offset = Number(p.offset ?? 0) || 0;
  return p.id ?? "";
}

/** Push the current filters into the URL. `id` opens (or closes) the record drawer. */
function writeUrl(extra = {}) {
  go({
    q: filters.q,
    status: filters.status,
    prospect: filters.prospect,
    sort: filters.sort === "started" ? "" : filters.sort,
    order: filters.order === "desc" ? "" : filters.order,
    offset: filters.offset || "",
    ...extra,
  });
}

const $ = (s) => document.querySelector(s);

function chrome() {
  return `
    <div class="arag-filterbar">
      <label class="arag-search">
        ${icon("search", 15)}
        <input id="cvSearch" type="search" placeholder="Search what was said, the brief, or a source…"
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
      <span class="spacer"></span>
      <span class="count" id="cvCount"></span>
    </div>
    <div class="arag-datatable">
      <div class="scroll">
        <table id="cvTable">
          <thead><tr>
            <th data-sort="started" aria-sort="descending"><button type="button">Started ${icon("sortArrow", 12, "sortic")}</button></th>
            <th>Prospect</th>
            <th>Topic</th>
            <th>Status</th>
            <th class="num" data-sort="refreshes" aria-sort="none"><button type="button">Refreshes ${icon("sortArrow", 12, "sortic")}</button></th>
            <th class="num" data-sort="duration" aria-sort="none"><button type="button">Duration ${icon("sortArrow", 12, "sortic")}</button></th>
            <th class="num">Sources</th>
          </tr></thead>
          <tbody>${skeletonRows(6, 7)}</tbody>
        </table>
      </div>
      <nav class="arag-pagination" id="cvPager" hidden>
        <button class="arag-btn ghost sm" id="cvPrev">Previous</button>
        <button class="arag-btn ghost sm" id="cvNext">Next</button>
        <span class="spacer"></span>
        <span class="range" id="cvRange"></span>
      </nav>
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
    <td>${ago(s.createdAt)}<div class="cell-sub mono">${esc(s.id.slice(0, 8))}</div></td>
    <td>${esc(name)}</td>
    <td><span class="cell-title arag-truncate" style="max-width:38ch">${esc(topic || "No brief yet")}</span></td>
    <td>${
      s.status === "live"
        ? '<span class="arag-chip ok"><span class="vb-live-dot" style="margin-right:5px"></span>live</span>'
        : '<span class="arag-chip neutral">ended</span>'
    }</td>
    <td class="num">${s.stats.refreshes}${s.stats.failures ? `<div class="cell-sub">${s.stats.failures} failed</div>` : ""}</td>
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
        syncControls();
        writeUrl();
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
  closeDetail?.();
  const close = openDrawer({
    onClose: () => {
      closeDetail = null;
      // Closing by hand clears the record from the URL; closing because the user pressed Back
      // must not push another entry, and by then the id has already gone.
      if (params().id) go({ id: "" });
    },
    title: "Conversation",
    sub: `<span class="mono">${esc(id)}</span>`,
    actions: `<a class="arag-btn secondary sm" href="/api/v1/listen/sessions/${encodeURIComponent(id)}/export?format=markdown">${icon("download", 14)} Export</a>`,
    body: `<div class="arag-skeleton" style="height:220px"></div>`,
  });
  closeDetail = close;
  try {
    const s = await api(`/api/v1/listen/sessions/${encodeURIComponent(id)}/export`);
    const body = document.querySelector(".arag-drawer .body");
    const name = state.prospects.find((p) => p.key === s.prospect)?.display_name ?? s.prospect;
    const briefHtml = renderBrief(s.brief);
    body.innerHTML = `
      <div class="arag-statstrip" style="margin-bottom:20px">
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
             <div class="arag-chips">${s.citations.map(citeChip).join("")}</div>`
          : empty({
              icon: "info",
              title: "This session never produced a brief",
              body: "Either too little was said, or every refresh came back without anything grounded to show.",
            })
      }

      <h3 style="margin-top:24px">How the brief evolved</h3>
      ${
        s.briefHistory.length
          ? `<ol class="arag-timeline">${s.briefHistory
              .slice()
              .reverse()
              .map(
                (h, i) => `<li${i === 0 ? ' class="current"' : ""}>
                  <span class="dot"></span>
                  <div>
                    <div class="head"><strong>v${h.version}</strong>${ago(h.at)}<span class="arag-chip neutral">${esc(fmtMs(h.latencyMs))}</span></div>
                    <div class="body">${esc(
                      (h.brief && typeof h.brief === "object" && (h.brief.topic || h.brief.summary)) || "—",
                    )}</div>
                  </div>
                </li>`,
              )
              .join("")}</ol>`
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
    const body = document.querySelector(".arag-drawer .body");
    if (body) body.innerHTML = errorState(e.message);
    toast(e.message, "error");
  }
  return close;
}

/** Put the filter controls back in step with the URL (first load, and every Back). */
function syncControls() {
  const q = $("#cvSearch");
  if (q && q.value !== filters.q) q.value = filters.q;
  const st = $("#cvStatus");
  if (st) st.value = filters.status;
  const pr = $("#cvProspect");
  if (pr) pr.value = filters.prospect;
  for (const th of document.querySelectorAll("#cvTable th[data-sort]")) {
    th.setAttribute(
      "aria-sort",
      th.dataset.sort === filters.sort ? (filters.order === "asc" ? "ascending" : "descending") : "none",
    );
  }
}

function wire() {
  let t;
  $("#cvSearch").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      filters.q = e.target.value.trim();
      filters.offset = 0;
      writeUrl();
      load();
    }, 280);
  });
  $("#cvStatus").addEventListener("change", (e) => {
    filters.status = e.target.value;
    filters.offset = 0;
    writeUrl();
    load();
  });
  $("#cvProspect").addEventListener("change", (e) => {
    filters.prospect = e.target.value;
    filters.offset = 0;
    writeUrl();
    load();
  });
  $("#cvPrev").addEventListener("click", () => {
    filters.offset = Math.max(0, filters.offset - PAGE);
    writeUrl();
    load();
  });
  $("#cvNext").addEventListener("click", () => {
    filters.offset = Math.min(filters.offset + PAGE, Math.max(0, total - 1));
    writeUrl();
    load();
  });
  for (const th of document.querySelectorAll("#cvTable th[data-sort]")) {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      filters.order = filters.sort === key && filters.order === "desc" ? "asc" : "desc";
      filters.sort = key;
      filters.offset = 0;
      syncControls();
      writeUrl();
      load();
    });
  }
  activatableRows("#cvTable tbody tr[data-id]", (tr) => {
    writeUrl({ id: tr.dataset.id });
    void openDetail(tr.dataset.id);
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
const openId = readUrl();
host.innerHTML = chrome();
prospectSwitcher();
syncControls();
wire();
document.getElementById("cvReload")?.addEventListener("click", load);
await load();
// ?id=… opens straight into a record — how Live links here when a session ends, and what Back
// returns you to after closing the drawer.
if (openId) await openDetail(openId);

// Back and forward move through filters and records, not out of the section.
onRoute(async (p) => {
  readUrl();
  syncControls();
  await load();
  closeDetail?.();
  if (p.id) await openDetail(p.id);
});
