/**
 * Type declarations for the UI kit (`ui/arag-ui.js`).
 *
 * The kit itself stays plain browser JavaScript — it is linked straight from a <script type="module">
 * with no build step (STANDARDS § front end). These declarations exist so TypeScript callers get
 * completion and so the platform's own unit tests can import it without casts. Keep them in step
 * with the exports at the bottom of arag-ui.js.
 */

export interface Branding {
  productName?: string;
  tagline?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string;
  docsUrl?: string;
  poweredBy?: boolean;
}

/** One DOM operation implied by a branding payload (see brandingPlan). */
export interface BrandingOp {
  sel: string;
  text?: string;
  attr?: Record<string, string>;
  removeAttr?: string[];
  hidden?: boolean;
}

/** The subset of a Document/Element applyBranding needs — so any root, real or stubbed, works. */
export interface BrandingRoot {
  documentElement?: {
    style?: { setProperty(name: string, value: string): void; removeProperty?(name: string): void };
  };
  querySelectorAll(selectors: string): Iterable<BrandingTarget>;
}
export interface BrandingTarget {
  textContent?: string | null;
  hidden?: boolean;
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

export type SortDirection = "ascending" | "descending" | "none";
export interface SortState {
  key: string | null;
  dir: SortDirection;
}
export interface NavItem {
  kind: "group" | "link";
  label: string;
  href?: string;
  icon?: string;
}
export interface PageInfo {
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  offset: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}
export interface Placement {
  top: number;
  left: number;
  placement: "above" | "below";
}
export interface MenuItem {
  label: string;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  hidden?: boolean;
  separator?: boolean;
}
export interface TourStep {
  target?: string;
  title: string;
  body: string;
}

// ── formatting ──────────────────────────────────────────────────────────────
export function esc(value: unknown): string;
export function fmtMs(ms: number | null | undefined): string;
export function fmtBytes(bytes: number): string;
export function fmtRelative(iso: string | null | undefined, now?: number): string;
export function highlightJson(value: unknown): string;

// ── transport ───────────────────────────────────────────────────────────────
export function api<T = unknown>(path: string, opts?: RequestInit & { json?: unknown }): Promise<T>;
export function toast(message: string, kind?: "info" | "error" | "ok", ms?: number): void;
export function sse(url: string, handlers: Record<string, (data: unknown, ev?: Event) => void>): () => void;
export function announce(message: string): void;

// ── icons ───────────────────────────────────────────────────────────────────
export function icon(name: string, opts?: { size?: number; cls?: string; label?: string }): string;
export const iconNames: string[];

// ── branding hook ───────────────────────────────────────────────────────────
export function brandingVars(b: Branding | null | undefined): Record<string, string>;
export function brandingPlan(b: Branding | null | undefined): BrandingOp[];
export function applyBranding(b: Branding | null | undefined, root?: BrandingRoot | null): void;

// ── list-view logic ─────────────────────────────────────────────────────────
export function sortRows<T>(
  rows: readonly T[] | null | undefined,
  opts?: { key?: string; dir?: SortDirection; get?: (row: T) => unknown },
): T[];
export function nextSort(current: SortState | null | undefined, key: string): SortState;
export function paginate(total: number, page?: number, pageSize?: number): PageInfo;
export function filterRows<T>(
  rows: readonly T[] | null | undefined,
  query: string | null | undefined,
  fields?: readonly string[],
): T[];
export function parseNav(spec: string | null | undefined): NavItem[];
export function activeNavHref(items: readonly NavItem[], path: string): string | null;
export function placeCard(
  target: { top: number; bottom: number; left: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  opts?: { gap?: number; scrollX?: number; scrollY?: number },
): Placement;

// ── render helpers ──────────────────────────────────────────────────────────
export function emptyState(opts: {
  icon?: string;
  title: string;
  body?: string;
  actions?: string;
  kind?: string;
}): string;
export function errorState(err: unknown, opts?: { retry?: string }): string;
export function skeletonRows(n?: number): string;
export function snippet(text: string, opts?: { lang?: string }): string;
export function wireCopy(root?: ParentNode | null): void;

// ── overlays and behaviours ─────────────────────────────────────────────────
/** `title`, `sub`, `body` and `foot` are HTML — escape untrusted values with `esc()`. */
export function openDrawer(opts: {
  title: string;
  body?: string;
  foot?: string;
  sub?: string;
  wide?: boolean;
  side?: "left" | "right";
  onClose?: () => void;
}): { host: HTMLElement; close: () => void };
/** `title` and `body` are HTML; `confirmLabel` and `typed` are escaped for you. */
export function confirmDialog(opts: {
  title: string;
  body?: string;
  confirmLabel?: string;
  typed?: string | null;
  danger?: boolean;
}): Promise<boolean>;
export function closeOverlay(): void;
export function menuButton(
  itemsFactory: () => MenuItem[],
  opts?: { ariaLabel?: string; align?: "left" | "right" },
): HTMLElement;
export function popover(anchor: HTMLElement, html: string): HTMLElement | null;
export function tour(
  steps: readonly TourStep[],
  opts?: { onDone?: () => void; storageKey?: string },
): { stop: () => void };
export function wireTabs(tablist: HTMLElement | null, panel?: HTMLElement | null): void;
export function wireSegmented(
  root: HTMLElement | null,
  onChange?: (value: string, button: HTMLElement) => void,
): void;
/**
 * The `<arag-app-shell>` / `<arag-shell layout="rail">` element. Attributes: product, tagline, nav,
 * docs-href, admin-href, home-href, status-endpoint, branding-src, brand-base, rail, collapsible.
 */
export interface AragAppShellElement extends HTMLElement {
  setActivePath(path?: string): void;
  setNavBadge(label: string, value: number | string): void;
}

export function wireTable(
  root: HTMLElement | null,
  opts?: {
    onSort?: (state: SortState) => void;
    onSelect?: (selected: Set<string>) => void;
    onOpen?: (id: string, row: HTMLElement) => void;
    onPage?: (page: string) => void;
    selected?: Set<string>;
  },
): { selected: Set<string>; refresh: () => void };
