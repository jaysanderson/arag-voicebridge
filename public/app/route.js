// View state in the URL, so a filtered list is a thing you can send someone.
//
// Each section is its own document (see DECISIONS V-20), so there is no router to speak of — only
// the query string, which the History API already manages. Search, filters, sort, paging and the
// record a drawer is showing all live here, which means Back closes a drawer and returns to the
// list you were looking at rather than to the previous section.

/** Current view state as a plain object. */
export function params() {
  return Object.fromEntries(new URLSearchParams(location.search).entries());
}

/**
 * Merge `patch` into the query string. Keys set to "", null or undefined are removed, so a
 * cleared filter leaves no trace in the URL.
 */
export function go(patch, { replace = false } = {}) {
  const next = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") next.delete(k);
    else next.set(k, String(v));
  }
  const qs = next.toString();
  const url = `${location.pathname}${qs ? `?${qs}` : ""}`;
  if (url === `${location.pathname}${location.search}`) return;
  history[replace ? "replaceState" : "pushState"]({}, "", url);
}

/** Run `fn(params())` whenever the user moves through history. */
export function onRoute(fn) {
  window.addEventListener("popstate", () => fn(params()));
}

/** An href for the same section with `patch` applied — for links that must be real links. */
export function href(patch) {
  const next = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "") next.delete(k);
    else next.set(k, String(v));
  }
  const qs = next.toString();
  return `${location.pathname}${qs ? `?${qs}` : ""}`;
}
