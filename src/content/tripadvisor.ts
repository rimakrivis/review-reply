import type { PageInfo, Review } from "../types";
import { parseReviewDate, UI_ATTR } from "./extract";

/**
 * Reading reviews from Tripadvisor's owner pages (tripadvisor.com/reviews?locationId=…).
 *
 * The page shows a list of reviews (each a button with the name, date, bubbles, title and the start of the text)
 * and one opened review with its full text and the reply box. Class names are obfuscated, so this relies on the
 * bubble rating image ("5 of 5 bubbles"), `data-review-gid` and the order of the text.
 */

const BUBBLES_RE = /([1-5])(?:[.,]\d)?\s+of\s+5\s+bubbles/i;
const BUBBLES_SELECTOR = 'svg[data-automation="bubbleRatingImage"], [aria-label*="bubbles" i]';
/** Lines that end the guest's text: Tripadvisor's buttons and notes under a review. */
const STOP_RE = /^(response published|select as favorite|report review|how to respond.*|your name will display as.*|premium subscribers.*|submit|read more|show less)$/i;
const SKIP_RE = /^(\d[\d,]*\s+contributions?|\d[\d,]*\s+helpful votes?)$/i;
const REPLIED_RE = /^(response published|response from .+|management response)$/i;
const SHORT_RE = /\s*(\.\.\.|…)$/;

/** True on Tripadvisor's owner pages, where the owner reads and answers reviews. Public review pages are not. */
export function isTripadvisorOwnerPage(loc: Pick<Location, "hostname" | "pathname">): boolean {
  return /(^|\.)tripadvisor\.[a-z.]+$/i.test(loc.hostname) && /^\/(reviews|owners|managementcenter)\b/i.test(loc.pathname);
}

function bubbleLabel(el: Element): string {
  return el.querySelector("title")?.textContent ?? el.getAttribute("aria-label") ?? "";
}

/** Bubble ratings that belong to a review (the business's overall score has no "of 5 bubbles" image). */
function bubbles(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(BUBBLES_SELECTOR)).filter(
    (el) => !el.closest(`[${UI_ATTR}]`) && BUBBLES_RE.test(bubbleLabel(el)),
  );
}

/** The box holding one review: the opened review, or one button in the list. */
function containerOf(bubble: Element): Element | null {
  return bubble.closest("[data-review-gid], button");
}

/** The opened review a reply box belongs to. */
export function findTripadvisorContainer(editor: Element): Element | null {
  const opened = editor.closest("[data-review-gid]");
  if (opened) return opened;
  for (let el = editor.parentElement, i = 0; el && el !== el.ownerDocument.body && i < 12; el = el.parentElement, i++) {
    const n = bubbles(el).length;
    if (n === 1) return el;
    if (n > 1) return null;
  }
  return null;
}

/** Visible text blocks in document order, including text inside buttons (each list item is a button). */
function blocks(container: Element): string[] {
  const walker = container.ownerDocument.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
  const out: string[] = [];
  let lastParent: Element | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    const t = n.nodeValue?.replace(/\s+/g, " ").trim();
    if (!parent || !t) continue;
    if (parent.closest(`[${UI_ATTR}], svg, textarea, script, style, [aria-hidden="true"], [hidden]`)) continue;
    if (parent === lastParent) out[out.length - 1] += ` ${t}`;
    else out.push(t);
    lastParent = parent;
  }
  return out;
}

/** "Review from Sep 24, 2026", "Sep 24, 2026", "Reviewed 24 September 2026". */
function parseDate(text: string, now: number): number | undefined {
  const d = parseReviewDate(text.replace(/^(review from|reviewed|written)\s+/i, ""), now);
  return d && !d.rough ? d.date : undefined;
}

export function extractTripadvisorReview(container: Element, now = Date.now()): Review {
  const rated = bubbles(container)[0];
  const m = rated ? BUBBLES_RE.exec(bubbleLabel(rated)) : null;
  const lines = blocks(container);

  // Name and date come first (in either order); then the title; then the text until Tripadvisor's own lines.
  let reviewerName = "";
  let date: number | undefined;
  let i = 0;
  for (; i < lines.length && (!reviewerName || date === undefined); i++) {
    const d = parseDate(lines[i], now);
    if (d !== undefined) date ??= d;
    else if (!reviewerName && !SKIP_RE.test(lines[i]) && !STOP_RE.test(lines[i])) reviewerName = lines[i];
  }
  const words: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (STOP_RE.test(line) || parseDate(line, now) !== undefined) break;
    if (!SKIP_RE.test(line)) words.push(line);
  }

  const inList = !container.hasAttribute("data-review-gid");
  const last = words.length - 1;
  const textIsShort = inList && last >= 0 && SHORT_RE.test(words[last]);
  if (textIsShort) words[last] = words[last].replace(SHORT_RE, "");

  const review: Review = {
    source: "tripadvisor",
    reviewerName,
    rating: m ? Number(m[1]) : 0,
    text: words.join("\n").trim(),
  };
  if (date !== undefined) {
    review.date = date;
    review.dateIsRough = false;
  }
  if (textIsShort) review.textIsShort = true;
  if (lines.some((l) => REPLIED_RE.test(l))) review.hasOwnerReply = true;
  else if (inList || container.querySelector("textarea")) review.hasOwnerReply = false;
  const gid = container.getAttribute("data-review-gid");
  if (gid) review.googleId = gid;
  return review;
}

/** Every review on the page: the opened one and the list. Only dated reviews are returned. */
export function extractAllTripadvisorReviews(root: ParentNode, now = Date.now()): Review[] {
  const containers = new Set<Element>();
  for (const b of bubbles(root)) {
    const c = containerOf(b);
    if (c) containers.add(c);
  }
  return Array.from(containers, (c) => extractTripadvisorReview(c, now)).filter(
    (r) => r.date !== undefined && (r.reviewerName || r.text),
  );
}

/** The page's text without scripts and styles, which can hold words like "reviews" too. */
function pageText(root: ParentNode): string {
  const el = "body" in root ? (root as Document).body : (root as Element);
  if (!el) return "";
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest("script, style, noscript")) parts.push(n.nodeValue ?? "");
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

/** "Showing results 31-60 of 513" */
export function tripadvisorPageInfo(root: ParentNode): PageInfo | undefined {
  const m = /showing results\s+([\d,]+)\s*[-–]\s*([\d,]+)\s+of\s+([\d,]+)/i.exec(pageText(root));
  if (!m) return undefined;
  const [first, last, total] = m.slice(1).map((n) => Number(n.replace(/,/g, "")));
  return { first, last, total };
}

/**
 * True when the list is sorted by "Most recent" and shows every review. A filter (such as "No response") hides
 * reviews, so a filtered list counts as not sorted: its pages cannot prove a month is complete.
 * Undefined when the page shows no sort order.
 */
export function isTripadvisorSortedByNewest(root: ParentNode): boolean | undefined {
  const text = pageText(root);
  const sort = /sorted by:?\s*(most recent|newest|oldest|highest rating|lowest rating|most helpful|[a-z]+)/i.exec(text);
  if (!sort) return undefined;
  if (!/^(most recent|newest)$/i.test(sort[1])) return false;
  const all = /([\d,]+)\s+reviews\b/i.exec(text);
  const page = tripadvisorPageInfo(root);
  if (!page) return undefined;
  return !all || Number(all[1].replace(/,/g, "")) === page.total;
}
