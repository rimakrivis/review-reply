import type { Review } from "../types";

/**
 * Heuristics for reading a review from Google's review pages.
 *
 * Google's class names are obfuscated and change often, so this relies on things that are more
 * stable: accessible star labels ("Rated 4.0 out of 5", "4 stars"), `data-review-id` attributes,
 * and document structure. Everything here is pure DOM logic so it can be unit tested with jsdom.
 */

/** Our own injected UI carries this attribute and is ignored while reading. */
export const UI_ATTR = "data-review-reply-ui";

const RATING_RE = /(?:rated\s*)?([1-5])(?:[.,]\d)?\s*(?:out of\s*5|\/\s*5|stars?\b|-star)/i;
const OWNER_MARKER_RE = /^(response from the owner|owner'?s? (response|reply)|your (response|reply))\b/i;
const NOISE_RE = /^(more|less|see more|read more|like|share|reply|edit|delete|translated by google.*|see original.*|\d+\s*(photos?|reviews?)|local guide.*)$/i;
const DATE_RE = /^(\d+\s+\w+\s+ago|a\s+\w+\s+ago|an\s+\w+\s+ago|new|edited.*|\w+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+\w+\s+\d{4})$/i;

const MAX_CLIMB = 12;
const MAX_CONTAINER_TEXT = 8000;

function label(el: Element): string {
  return el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "";
}

/** Elements whose accessible label describes a 1-5 star rating. */
export function ratingElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll("[aria-label], [title]")).filter(
    (el) => !el.closest(`[${UI_ATTR}]`) && RATING_RE.test(label(el)),
  );
}

export function parseRating(text: string): number {
  const m = RATING_RE.exec(text);
  return m ? Number(m[1]) : 0;
}

/**
 * Walks up from a reply box to the element holding exactly one review.
 * Returns null when no single review can be identified (e.g. the page search box).
 */
export function findReviewContainer(from: Element): Element | null {
  let el: Element | null = from.parentElement;
  for (let i = 0; el && el !== el.ownerDocument.body && i < MAX_CLIMB; i++, el = el.parentElement) {
    if (el.hasAttribute("data-review-id")) return el;
    const ratings = ratingElements(el);
    if (ratings.length === 1) {
      return (el.textContent ?? "").length <= MAX_CONTAINER_TEXT ? el : null;
    }
    if (ratings.length > 1) return null; // climbed past the review into a list
  }
  return null;
}

function isHidden(el: Element): boolean {
  return !!el.closest(`[${UI_ATTR}], [aria-hidden="true"], textarea, [contenteditable="true"], button, script, style`);
}

const INLINE = new Set(["B", "I", "EM", "STRONG", "U", "MARK", "SMALL", "S", "SUB", "SUP", "BR", "WBR"]);

/** The element a text node belongs to, looking through inline formatting like <b> or <em>. */
function blockOf(el: Element, stop: Element): Element {
  while (INLINE.has(el.tagName) && el.parentElement && el !== stop) el = el.parentElement;
  return el;
}

/** Visible text blocks in document order, one per parent element. */
function textBlocks(container: Element): { el: Element; text: string }[] {
  const doc = container.ownerDocument;
  const walker = doc.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
  const byParent = new Map<Element, string>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue?.replace(/\s+/g, " ").trim();
    if (!n.parentElement || !t || isHidden(n.parentElement)) continue;
    const parent = blockOf(n.parentElement, container);
    byParent.set(parent, ((byParent.get(parent) ?? "") + " " + t).trim());
  }
  return Array.from(byParent, ([el, text]) => ({ el, text }));
}

function isNoise(text: string): boolean {
  return /^[★☆✩✭⭐\s]+$/.test(text) || NOISE_RE.test(text) || DATE_RE.test(text) || (RATING_RE.test(text) && text.length < 30);
}

export function extractReview(container: Element): Review {
  const ratingEl = ratingElements(container)[0];
  const rating = ratingEl ? parseRating(label(ratingEl)) : 0;

  const blocks = textBlocks(container);
  // Everything from the owner's existing reply onwards belongs to the owner, not the reviewer.
  const ownerIdx = blocks.findIndex((b) => OWNER_MARKER_RE.test(b.text));
  const reviewerBlocks = (ownerIdx >= 0 ? blocks.slice(0, ownerIdx) : blocks).filter(
    (b) => !isNoise(b.text) && !(ratingEl && ratingEl.contains(b.el)),
  );

  const before = (b: { el: Element }) =>
    !ratingEl || !!(b.el.compareDocumentPosition(ratingEl) & 4 /* FOLLOWING */);

  // Name: an explicitly marked element, otherwise the first short text before the stars.
  const marked = container.querySelector("[data-reviewer-name]");
  const nameBlock = marked
    ? { el: marked, text: marked.textContent?.trim() ?? "" }
    : reviewerBlocks.find((b) => before(b) && b.text.length <= 40);
  const reviewerName = nameBlock?.text ?? "";

  // Text: the review body comes after the stars. Join its blocks (Google may split paragraphs).
  const body = reviewerBlocks.filter((b) => b !== nameBlock && (!ratingEl || !before(b)));
  const text = body.map((b) => b.text).join("\n").trim();

  return { reviewerName, rating, text };
}
