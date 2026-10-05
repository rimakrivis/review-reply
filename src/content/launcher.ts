import { LAUNCHER_POS_KEY, loadSettings, onSettingsChanged, saveSettings } from "../storage";
import type { Message } from "../types";
import { extensionAlive } from "./alive";
import { findReviewContainer, UI_ATTR } from "./extract";
import { siteFor } from "./sites";

/**
 * The floating ✨ button on review pages (Google, Tripadvisor, …). Clicking it opens a small menu that opens the side panel or the
 * full view. It lives in a Shadow DOM, like the draft bar, so Google's CSS and ours never clash.
 */

export const LAUNCHER_ATTR = "data-review-reply-launcher";

const MARGIN = 16;
const SIZE = 48;
/** Pointer movement (px) that turns a click into a drag. */
const DRAG_THRESHOLD = 4;

/** Distance from the bottom-right corner of the window. */
interface Pos {
  right: number;
  bottom: number;
}

const ICON = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${d.split("|").map((p) => `<path d="${p}"/>`).join("")}</svg>`;
const SPARKLE = ICON("M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z|M19 3v4M17 5h4");

const STYLE = `
  :host { all: initial; font: 13px/1.4 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .fab { width: ${SIZE}px; height: ${SIZE}px; border-radius: 14px; border: none; cursor: grab; display: grid; place-items: center;
         background: #1c1d1f; color: #fff; box-shadow: 0 6px 20px rgb(16 24 40 / .22), 0 0 0 1px rgb(255 255 255 / .06) inset; touch-action: none; }
  .fab svg { width: 22px; height: 22px; }
  .fab:hover { background: #2b2c30; }
  .fab:focus-visible { outline: 3px solid #9bbcff; outline-offset: 2px; }
  .fab.dragging { cursor: grabbing; }
  .menu { position: absolute; right: 0; bottom: ${SIZE + 8}px; min-width: 200px; padding: 4px; border-radius: 12px;
          background: #fff; color: #1c1d1f; border: 1px solid #e7e8eb; box-shadow: 0 12px 32px rgb(16 24 40 / .16);
          display: flex; flex-direction: column; gap: 1px; }
  .menu[hidden] { display: none; }
  .menu.down { bottom: auto; top: ${SIZE + 8}px; }
  .menu.left { right: auto; left: 0; }
  .menu button { font: inherit; text-align: left; border: none; background: none; color: inherit; display: flex; align-items: center; gap: 10px;
                 padding: 7px 10px; border-radius: 8px; cursor: pointer; }
  .menu button svg { color: #75777c; }
  .menu button:hover, .menu button:focus-visible { background: #f2f3f5; outline: none; }
  .menu .muted { color: #75777c; }
  .menu hr { border: none; border-top: 1px solid #e7e8eb; margin: 3px 4px; }
  @media (prefers-color-scheme: dark) {
    .fab { background: #ececee; color: #1c1d1f; }
    .fab:hover { background: #ffffff; }
    .menu { background: #1a1b1e; color: #ececee; border-color: #2c2e33; }
    .menu button:hover, .menu button:focus-visible { background: #26272b; }
    .menu .muted, .menu button svg { color: #9a9ca3; }
    .menu hr { border-top-color: #2c2e33; }
  }
`;

let enabled = false;
let host: HTMLElement | null = null;
/** Set when a frame inside this page (e.g. Google's pop-up reviews window) reported reviews. */
let reviewsInFrame = false;
let reportedToTop = false;

/** Message a frame sends to the main page: "this frame shows reviews, please show the ✨ button". */
export const REVIEWS_FOUND = "review-reply:reviews-found";

/** "Reply" in the languages of the Google domains in the manifest (English, Lithuanian, German). */
const REPLY_RE = /^\s*(reply|atsakyti|antworten)\s*$/i;

function isTopFrame(): boolean {
  try {
    return window.top === window;
  } catch {
    return false; // cross-origin parent
  }
}

/**
 * True when the page shows reviews the owner can reply to. Other sites decide for themselves (see sites.ts); on
 * Google: its business pages, a draft bar we already added, or a "Reply" button inside a single review.
 * A normal Google search has none of these.
 */
export function hasOwnerReviews(doc: Document = document): boolean {
  const site = siteFor(doc.location);
  if (site.hasOwnerReviews) return site.hasOwnerReviews(doc);
  if (doc.location.hostname === "business.google.com") return true;
  if (doc.querySelector(`[${UI_ATTR}]:not([${LAUNCHER_ATTR}])`)) return true;
  return Array.from(doc.querySelectorAll("button, [role=button], a, [jsaction]")).some(
    (b) =>
      (REPLY_RE.test(b.textContent ?? "") || REPLY_RE.test(b.getAttribute("aria-label") ?? "")) &&
      !b.closest(`[${UI_ATTR}]`) &&
      !!findReviewContainer(b),
  );
}

/** Keeps the button fully inside the window. */
export function clampPos(p: Pos, width: number, height: number): Pos {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(max, 0));
  return { right: clamp(p.right, width - SIZE), bottom: clamp(p.bottom, height - SIZE) };
}

function send(msg: Message): void {
  if (extensionAlive()) chrome.runtime.sendMessage(msg).catch(() => {});
}

function mount(doc: Document): void {
  host = doc.createElement("div");
  host.setAttribute(UI_ATTR, "");
  host.setAttribute(LAUNCHER_ATTR, "");
  host.style.cssText = `position: fixed; z-index: 2147483000; right: ${MARGIN}px; bottom: ${MARGIN}px;`;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="menu" role="menu" hidden>
      <button role="menuitem" data-action="panel">${ICON("M4 4h16v16H4z|M15 4v16")}Open side panel</button>
      <button role="menuitem" data-action="full">${ICON("M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7")}Open full view</button>
      <hr />
      <button role="menuitem" data-action="hide" class="muted">${ICON("M3 3l18 18|M10.6 10.6a2 2 0 0 0 2.8 2.8|M9.9 5.1A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.4 3.3M6.6 6.6C3.9 8.4 2.5 12 2.5 12s3.5 7 9.5 7a9.6 9.6 0 0 0 5.4-1.6")}Hide this button</button>
    </div>
    <button class="fab" aria-label="ReviewReply menu" aria-haspopup="menu" aria-expanded="false" title="ReviewReply (drag to move)">${SPARKLE}</button>`;
  (doc.body ?? doc.documentElement).append(host);

  const el = host;
  const fab = root.querySelector(".fab") as HTMLButtonElement;
  const menu = root.querySelector(".menu") as HTMLElement;
  const items = Array.from(menu.querySelectorAll("button"));
  const win = doc.defaultView ?? window;
  let pos: Pos = { right: MARGIN, bottom: MARGIN };

  const place = (p: Pos) => {
    pos = clampPos(p, win.innerWidth, win.innerHeight);
    el.style.right = `${pos.right}px`;
    el.style.bottom = `${pos.bottom}px`;
  };

  if (extensionAlive()) chrome.storage.local.get(LAUNCHER_POS_KEY).then((got) => {
    const saved = got[LAUNCHER_POS_KEY] as Pos | undefined;
    if (saved && typeof saved.right === "number" && typeof saved.bottom === "number") place(saved);
  });
  win.addEventListener("resize", () => place(pos));

  const setOpen = (open: boolean) => {
    // Open the menu towards the middle of the screen so it never goes off-screen.
    menu.classList.toggle("down", pos.bottom > win.innerHeight / 2);
    menu.classList.toggle("left", pos.right > win.innerWidth / 2);
    menu.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) items[0]?.focus();
  };

  // Drag to move. A press that barely moves is a normal click.
  let start: { x: number; y: number; pos: Pos } | null = null;
  let dragged = false;
  fab.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY, pos };
    dragged = false;
    fab.setPointerCapture?.(e.pointerId);
  });
  fab.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragged) setOpen(false);
    dragged = true;
    fab.classList.add("dragging");
    place({ right: start.pos.right - dx, bottom: start.pos.bottom - dy });
  });
  const endDrag = () => {
    if (dragged && extensionAlive()) chrome.storage.local.set({ [LAUNCHER_POS_KEY]: pos });
    start = null;
    fab.classList.remove("dragging");
  };
  fab.addEventListener("pointerup", endDrag);
  fab.addEventListener("pointercancel", endDrag);

  fab.addEventListener("click", () => {
    if (dragged) {
      dragged = false; // this click ends a drag
      return;
    }
    setOpen(!!menu.hidden);
  });

  menu.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (!action) return;
    setOpen(false);
    if (action === "panel") send({ type: "openPanel" });
    if (action === "full") send({ type: "openFull" });
    if (action === "hide") loadSettings().then((s) => saveSettings({ ...s, showLauncher: false }));
  });

  root.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (ev.key === "Escape" && !menu.hidden) {
      setOpen(false);
      fab.focus();
    }
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !menu.hidden) {
      ev.preventDefault();
      const i = items.indexOf(root.activeElement as HTMLButtonElement);
      items[(i + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  // A click anywhere else on the page closes the menu.
  doc.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !e.composedPath().includes(el)) setOpen(false);
  });
}

function unmount(): void {
  host?.remove();
  host = null;
}

/** Shows the button once the page has reviews to reply to. Cheap to call after every page change. */
export function refreshLauncher(doc: Document = document): void {
  if (!extensionAlive()) return;
  if (!isTopFrame()) {
    // Google often shows reviews in a pop-up frame. The button belongs to the main page, so tell it once.
    if (!reportedToTop && hasOwnerReviews(doc)) {
      reportedToTop = true;
      window.top?.postMessage({ type: REVIEWS_FOUND }, "*");
    }
    return;
  }
  if (!enabled || host) return;
  if (reviewsInFrame || hasOwnerReviews(doc)) mount(doc);
}

/** Reads the owner's setting and keeps the button in sync with it. Call once per page. */
export async function initLauncher(doc: Document = document): Promise<void> {
  if (!isTopFrame()) {
    refreshLauncher(doc);
    return;
  }
  window.addEventListener("message", (e) => {
    if ((e.data as { type?: unknown } | null)?.type !== REVIEWS_FOUND) return;
    reviewsInFrame = true;
    refreshLauncher(doc);
  });
  enabled = (await loadSettings()).showLauncher;
  onSettingsChanged((s) => {
    enabled = s.showLauncher;
    if (enabled) refreshLauncher(doc);
    else unmount();
  });
  refreshLauncher(doc);
}

/** Test helper: removes the button and forgets the setting. */
export function resetLauncher(): void {
  unmount();
  enabled = false;
  reviewsInFrame = reportedToTop = false;
}
