import { LAUNCHER_POS_KEY, loadSettings, onSettingsChanged, saveSettings } from "../storage";
import type { Message } from "../types";
import { findReviewContainer, UI_ATTR } from "./extract";

/**
 * The floating ✨ button on Google review pages. Clicking it opens a small menu that opens the side panel or the
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

const STYLE = `
  :host { all: initial; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .fab { width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; border: none; cursor: grab; font-size: 22px;
         background: #4f46e5; color: #fff; box-shadow: 0 4px 14px rgb(0 0 0 / .25); touch-action: none; }
  .fab:hover { background: #4338ca; }
  .fab:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
  .fab.dragging { cursor: grabbing; }
  .menu { position: absolute; right: 0; bottom: ${SIZE + 8}px; min-width: 190px; padding: 6px; border-radius: 12px;
          background: #fff; color: #0f172a; border: 1px solid #e2e8f0; box-shadow: 0 8px 24px rgb(0 0 0 / .18);
          display: flex; flex-direction: column; gap: 2px; }
  .menu[hidden] { display: none; }
  .menu.down { bottom: auto; top: ${SIZE + 8}px; }
  .menu.left { right: auto; left: 0; }
  .menu button { font: inherit; text-align: left; border: none; background: none; color: inherit;
                 padding: 8px 10px; border-radius: 8px; cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: #eef2ff; outline: none; }
  .menu .muted { color: #64748b; }
  @media (prefers-color-scheme: dark) {
    .menu { background: #111827; color: #e5e7eb; border-color: #1f2937; }
    .menu button:hover, .menu button:focus-visible { background: #1e1b4b; }
    .menu .muted { color: #94a3b8; }
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
 * True when the page shows reviews the owner can reply to: Google's business pages, a draft bar we already
 * added, or a "Reply" button inside a single review. A normal Google search has none of these.
 */
export function hasOwnerReviews(doc: Document = document): boolean {
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
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    // The extension was reloaded; this old content script can no longer reach it.
  }
}

function mount(doc: Document): void {
  host = doc.createElement("div");
  host.setAttribute(UI_ATTR, "");
  host.setAttribute(LAUNCHER_ATTR, "");
  host.style.cssText = `position: fixed; z-index: 2147483000; right: ${MARGIN}px; bottom: ${MARGIN}px;`;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="menu" role="menu" hidden>
      <button role="menuitem" data-action="panel">🗂️ Open side panel</button>
      <button role="menuitem" data-action="full">⤢ Open full view</button>
      <button role="menuitem" data-action="hide" class="muted">Hide this button</button>
    </div>
    <button class="fab" aria-label="ReviewReply menu" aria-haspopup="menu" aria-expanded="false" title="ReviewReply (drag to move)">✨</button>`;
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

  chrome.storage.local.get(LAUNCHER_POS_KEY).then((got) => {
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
    if (dragged) chrome.storage.local.set({ [LAUNCHER_POS_KEY]: pos });
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
