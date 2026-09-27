import type { DraftResponse, DraftResult, Message, Variant } from "../types";
import { extractAllReviews, extractReview, findReviewContainer, isSortedByNewest, UI_ATTR } from "./extract";
import { extensionAlive } from "./alive";
import { initLauncher, refreshLauncher } from "./launcher";

/**
 * Adds a "Draft reply" bar above every review reply box on the page.
 * The bar lives in a Shadow DOM so Google's CSS cannot break it (and ours cannot break Google's).
 * Nothing is ever posted: the draft is only typed into the reply box.
 */

const DONE_ATTR = "data-review-reply-done";
const EDITOR_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]';

const STYLE = `
  :host { all: initial; display: block; margin: 6px 0; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  button { font: inherit; border: 1px solid #c7d2fe; background: #eef2ff; color: #3730a3; border-radius: 999px;
           padding: 4px 12px; cursor: pointer; }
  button:hover { background: #e0e7ff; }
  button:disabled { opacity: .6; cursor: progress; }
  button.primary { background: #4f46e5; border-color: #4f46e5; color: #fff; font-weight: 600; }
  button.primary:hover { background: #4338ca; }
  .info { color: #475569; font-size: 12px; }
  .error { color: #b91c1c; font-size: 12px; }
  a { color: inherit; }
  @media (prefers-color-scheme: dark) {
    button { background: #1e1b4b; border-color: #3730a3; color: #c7d2fe; }
    .info { color: #94a3b8; } .error { color: #fca5a5; }
  }
`;

function send(msg: Message): Promise<DraftResponse> {
  return chrome.runtime.sendMessage(msg);
}

/** Types text into a textarea or rich-text editor so the page's own framework notices it. */
export function fillEditor(editor: HTMLElement, text: string): void {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const proto = Object.getPrototypeOf(editor) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(editor, text);
    else editor.value = text;
  } else {
    const sel = editor.ownerDocument.getSelection();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    sel?.removeAllRanges();
    sel?.addRange(range);
    // execCommand keeps the editor's undo history and framework state in sync where supported.
    const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!ok) editor.textContent = text;
  }
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.dispatchEvent(new Event("change", { bubbles: true }));
}

function currentText(editor: HTMLElement): string {
  return editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
    ? editor.value
    : (editor.textContent ?? "");
}

function attach(editor: HTMLElement, container: Element): void {
  editor.setAttribute(DONE_ATTR, "");
  const host = document.createElement("div");
  host.setAttribute(UI_ATTR, "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="bar">
      <button class="primary" data-v="default">✨ Draft reply</button>
      <span class="more" hidden>
        <button data-v="shorter">Shorter</button>
        <button data-v="warmer">Warmer</button>
        <button data-v="regenerate">Try again</button>
      </span>
      <span class="status" role="status"></span>
    </div>`;
  editor.insertAdjacentElement("beforebegin", host);

  const buttons = Array.from(root.querySelectorAll("button"));
  const more = root.querySelector(".more") as HTMLElement;
  const status = root.querySelector(".status") as HTMLElement;

  const show = (cls: "info" | "error", text: string, settingsLink = false) => {
    status.className = `status ${cls}`;
    status.textContent = text + (settingsLink ? " " : "");
    if (settingsLink) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = "Open settings";
      a.onclick = (e) => {
        e.preventDefault();
        send({ type: "openOptions" });
      };
      status.append(a);
    }
  };

  const run = async (variant: Variant) => {
    const review = extractReview(container);
    if (!review.text && !review.rating) {
      show("error", "Couldn't read this review. Reload the page and try again.");
      return;
    }
    buttons.forEach((b) => (b.disabled = true));
    show("info", "Drafting…");
    try {
      const res = await send({
        type: "draft",
        request: { review, variant, previous: currentText(editor) || undefined },
      });
      if (!res.ok) {
        show("error", res.error, res.needsSetup);
        return;
      }
      fillEditor(editor, res.result.reply);
      more.hidden = false;
      show("info", describe(res.result) + " Review it, then post it yourself.");
    } catch (e) {
      show("error", "The extension was updated. Reload this page and try again.");
      console.warn("[ReviewReply]", e);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };

  for (const b of buttons) b.addEventListener("click", () => run(b.dataset.v as Variant));
}

function describe(r: DraftResult): string {
  return r.situation === "None" ? "No matching situation." : `Situation: ${r.situation} (${r.confidence}).`;
}

function isCandidate(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el.hasAttribute(DONE_ATTR) || el.closest(`[${UI_ATTR}]`)) return false;
  // Skip search boxes and single-line fields.
  if (el.getAttribute("role") === "combobox" || el.getAttribute("name") === "q") return false;
  if (el.getAttribute("role") === "textbox" && el.getAttribute("aria-multiline") === "false") return false;
  return true;
}

export function scan(root: ParentNode = document): number {
  let added = 0;
  for (const el of Array.from(root.querySelectorAll(EDITOR_SELECTOR))) {
    if (!isCandidate(el)) continue;
    // Nested editors (role=textbox inside contenteditable) only get one bar.
    if (el.parentElement?.closest(EDITOR_SELECTOR)) continue;
    const container = findReviewContainer(el);
    if (!container) continue;
    attach(el, container);
    added++;
  }
  return added;
}

let lastSent = "";

/**
 * Sends every review on Google's full review list to the background worker, which saves it in the business's
 * review history. Only sends when the reviews on the page changed (Google loads more as the owner scrolls).
 * Pages without Google's sort button (e.g. the short review previews on the search page) are not collected.
 */
export function collect(root: ParentNode = document): void {
  // The demo page is an extension page: never mix its sample reviews into a real business's history.
  if (location.protocol === "chrome-extension:" || !extensionAlive()) return;
  const reviews = extractAllReviews(root);
  if (!reviews.length) return;
  const sortedByNewest = isSortedByNewest(root);
  const signature = `${sortedByNewest}\n` + reviews.map((r) => `${r.reviewerName}|${r.rating}|${r.hasOwnerReply}`).join("\n");
  if (signature === lastSent) return;
  lastSent = signature;
  const where = `${location.host}${location.pathname}`;
  if (sortedByNewest === undefined) {
    console.info(`[ReviewReply] Not saving ${reviews.length} reviews: no Google sort button here (${where})`);
    return;
  }
  console.info(`[ReviewReply] Saving ${reviews.length} reviews · sorted by Newest: ${sortedByNewest} · ${where}`);
  const msg: Message = { type: "archiveReviews", reviews, sortedByNewest };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

/** When the owner clears a review history, send this page's reviews again instead of assuming they are saved. */
function resendAfterClear(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!extensionAlive()) return;
    const cleared = Object.keys(changes).some((k) => k.startsWith("reviews:") && changes[k].newValue === undefined);
    if (area === "local" && cleared) {
      lastSent = "";
      collect();
    }
  });
}

export function start(): void {
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    // After the extension is reloaded, this old copy stops watching the page instead of throwing errors.
    if (!extensionAlive()) {
      observer.disconnect();
      return;
    }
    timer = window.setTimeout(() => {
      scan();
      refreshLauncher();
      collect();
    }, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
  initLauncher();
  collect();
  resendAfterClear();
}

// Content scripts run as classic scripts; start automatically unless a page opts out (tests).
if (typeof chrome !== "undefined" && chrome.runtime?.id && !(globalThis as { __RR_NO_AUTOSTART__?: boolean }).__RR_NO_AUTOSTART__) {
  start();
}
