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
/** Google's current layout: the business name, then a line that just says "Owner", then the reply. */
const OWNER_LABEL_RE = /^(owner|savininkas)$/i;
const NOISE_RE = /^(more|less|see more|read more|view full review|like|share|reply|edit|delete|translated by google.*|see original.*|\d+\s*(photos?|reviews?)|local guide.*|\d+\s+reviews?\s*[·•]\s*\d+\s+photos?)$/i;

/** Extra answers Google shows under a review ("Service: 1/5", "Noise level", …), not part of the guest's text. */
const DETAIL_LABELS = /^(food|service|atmosphere|rooms|location|price|price per person|meal type|group size|noise level|wait time|reservation|parking|parking space|parking options|special offers|recommended dishes|vegetarian options|dietary restrictions|kid-friendliness|wheelchair accessibility)$/i;
/** "€10–20", "$30-40", "€100+". */
const PRICE_RE = /^[€$£]\s?\d+(?:\s?[–-]\s?[€$£]?\d+)?\+?$/;
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

/** Text the owner cannot see or that is not part of the review: our UI, hidden copies, buttons, editors. */
function isHidden(el: Element): boolean {
  return !!el.closest(
    `[${UI_ATTR}], [aria-hidden="true"], [hidden], [style*="display: none"], [style*="display:none"], textarea, [contenteditable="true"], button, script, style`,
  );
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

/* ---------- Dates ---------- */

type Unit = "minute" | "hour" | "day" | "week" | "month" | "year";

const DAY = 86_400_000;
const UNIT_MS: Record<Unit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
  year: 365 * DAY,
};

/** "3 weeks ago", "a month ago", "Edited 2 days ago". */
const REL_EN = /^(?:edited\s+)?(a|an|one|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i;
/** Lithuanian: "prieš 3 dienas", "prieš mėnesį", "prieš 2 metus", "Redaguota prieš savaitę". */
const REL_LT = /^(?:redaguota\s+)?prieš\s+(?:(\d+)\s+)?([a-ząčęėįšųūž.]+)$/i;
const LT_UNITS: [RegExp, Unit][] = [
  [/^min/i, "minute"],
  [/^val/i, "hour"],
  [/^dien/i, "day"],
  [/^savait/i, "week"],
  [/^mėn/i, "month"],
  [/^met/i, "year"],
];
/** "March 5, 2025", "5 March 2025", "2025-03-05". */
const ABSOLUTE_RE = /^(?:edited\s+)?([a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[a-z]+\s+\d{4}|\d{4}-\d{2}-\d{2})$/i;

function relative(amount: number, unit: Unit, now: number) {
  // Months and years are vague on Google: "2 months ago" can mean 6 to 9 weeks.
  return { date: now - amount * UNIT_MS[unit], rough: unit === "month" || unit === "year" };
}

/**
 * Turns Google's date line into a timestamp. Google shows relative dates ("3 weeks ago"), so `now` is needed.
 * Returns null when the text is not a date.
 */
export function parseReviewDate(text: string, now = Date.now()): { date: number; rough: boolean } | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (/^(today|just now|šiandien)$/i.test(t)) return { date: now, rough: false };
  if (/^(yesterday|vakar)$/i.test(t)) return { date: now - DAY, rough: false };

  const en = REL_EN.exec(t);
  if (en) {
    const amount = /^\d+$/.test(en[1]) ? Number(en[1]) : 1; // "a week ago" = 1 week
    return relative(amount, en[2].toLowerCase() as Unit, now);
  }

  const lt = REL_LT.exec(t);
  if (lt) {
    const unit = LT_UNITS.find(([re]) => re.test(lt[2]))?.[1];
    if (unit) return relative(lt[1] ? Number(lt[1]) : 1, unit, now);
  }

  const abs = ABSOLUTE_RE.exec(t);
  if (abs) {
    const ms = Date.parse(abs[1]);
    if (!Number.isNaN(ms)) return { date: ms, rough: false };
  }
  return null;
}

function isNoise(text: string): boolean {
  return (
    /^[★☆✩✭⭐\s]+$/.test(text) ||
    NOISE_RE.test(text) ||
    DATE_RE.test(text) ||
    parseReviewDate(text) !== null ||
    (RATING_RE.test(text) && text.length < 30)
  );
}

/** Where the owner's reply starts: a "Response from the owner" line, or the business name above an "Owner" line. */
function ownerStart(blocks: { text: string }[]): number {
  for (let i = 0; i < blocks.length; i++) {
    if (OWNER_MARKER_RE.test(blocks[i].text)) return i;
    if (OWNER_LABEL_RE.test(blocks[i].text)) return Math.max(i - 1, 0);
  }
  return -1;
}

/**
 * Sorts the lines under the stars into Google's extra answers ("Service: 1/5", "Noise level" → "Quiet",
 * "€10–20") and the guest's own words.
 */
export function splitDetails(lines: string[]): { details: Record<string, string>; rest: string[] } {
  const details: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PRICE_RE.test(line)) {
      details["Price per person"] ??= line;
      continue;
    }
    const m = /^(.{2,30}?)\s*:\s*(.*)$/.exec(line);
    const name = (m ? m[1] : line).trim();
    if (DETAIL_LABELS.test(name)) {
      // "Service: 1/5" in one line, or "Service:" / "Noise level" with the answer on the next line.
      let value = m?.[2].trim() ?? "";
      if (!value && i + 1 < lines.length) value = lines[++i];
      if (value) details[name] = value;
      continue;
    }
    rest.push(line);
  }
  return { details, rest };
}

export function extractReview(container: Element, now = Date.now()): Review {
  const ratingEl = ratingElements(container)[0];
  const rating = ratingEl ? parseRating(label(ratingEl)) : 0;

  const blocks = textBlocks(container);
  // Everything from the owner's existing reply onwards belongs to the owner, not the reviewer.
  const ownerIdx = ownerStart(blocks);
  const guestBlocks = (ownerIdx >= 0 ? blocks.slice(0, ownerIdx) : blocks).filter(
    (b) => !(ratingEl && ratingEl.contains(b.el)),
  );

  const before = (b: { el: Element }) =>
    !ratingEl || !!(b.el.compareDocumentPosition(ratingEl) & 4 /* FOLLOWING */);

  // Name: an explicitly marked element, otherwise the first short text before the stars.
  const marked = container.querySelector("[data-reviewer-name]");
  const nameBlock = marked
    ? { el: marked, text: marked.textContent?.trim() ?? "" }
    : guestBlocks.find((b) => before(b) && !isNoise(b.text) && b.text.length <= 40);
  const reviewerName = nameBlock?.text ?? "";

  // Under the stars: Google's extra answers first, then the guest's words (Google may split paragraphs).
  const under = guestBlocks.filter((b) => b !== nameBlock && (!ratingEl || !before(b))).map((b) => b.text);
  const { details, rest } = splitDetails(under);
  const text = rest.filter((t) => !isNoise(t)).join("\n").trim();

  const review: Review = { reviewerName, rating, text, hasOwnerReply: ownerIdx >= 0 };
  if (Object.keys(details).length) review.details = details;
  const googleId = container.matches("[data-review-id]")
    ? container.getAttribute("data-review-id")
    : container.querySelector("[data-review-id]")?.getAttribute("data-review-id");
  if (googleId) review.googleId = googleId;

  // The first date line before the owner's reply is the review's own date.
  for (const b of ownerIdx >= 0 ? blocks.slice(0, ownerIdx) : blocks) {
    const d = parseReviewDate(b.text, now);
    if (d) {
      review.date = d.date;
      review.dateIsRough = d.rough;
      break;
    }
  }
  return review;
}

/**
 * Finds every review on the page. For each star rating, climbs up to the biggest box that still holds only that
 * one rating: that box is one review. Only dated reviews are returned, which also drops the business's overall
 * "4.5 out of 5" header.
 */
export function extractAllReviews(root: ParentNode, now = Date.now()): Review[] {
  const ratings = ratingElements(root);

  // Count how many ratings sit inside each ancestor, climbing once per rating (fast even for long lists).
  const counts = new Map<Element, number>();
  for (const r of ratings) {
    for (let el = r.parentElement, i = 0; el && i < MAX_CLIMB; el = el.parentElement, i++) {
      counts.set(el, (counts.get(el) ?? 0) + 1);
    }
  }

  const containers = new Set<Element>();
  for (const r of ratings) {
    let best: Element | null = null;
    for (let el = r.parentElement, i = 0; el && i < MAX_CLIMB; el = el.parentElement, i++) {
      if (el === el.ownerDocument.body || (counts.get(el) ?? 0) > 1) break; // climbed into the list
      if ((el.textContent ?? "").length > MAX_CONTAINER_TEXT) break;
      best = el;
      if (el.hasAttribute("data-review-id")) break;
    }
    if (best) containers.add(best);
  }

  return Array.from(containers, (c) => extractReview(c, now)).filter(
    (r) => r.date !== undefined && (r.reviewerName || r.text || r.rating),
  );
}

/**
 * Reads Google's sort button: "☰ Newest", "☰ Most relevant", … The chosen sort is the button's visible word
 * (or its hidden label). The dropdown's menu items are always in the page too, so anything inside the menu
 * is ignored. Returns undefined when the page has no sort button (e.g. the review previews on the search page).
 */
export function isSortedByNewest(root: ParentNode): boolean | undefined {
  const SORTS = /^(most relevant|newest|highest rating|lowest rating|naujausi|aktualiausi)$/i;
  const NEWEST = /^(newest|naujausi)$/i;
  for (const el of Array.from(root.querySelectorAll("button, [role=button]"))) {
    if (el.closest('[role=menu], [role=menuitem], [role=listbox], [role=option]')) continue;
    const name = [el.getAttribute("aria-label") ?? "", (el.textContent ?? "").replace(/\s+/g, " ").trim()].find((t) =>
      SORTS.test(t),
    );
    if (name) return NEWEST.test(name);
  }
  return undefined;
}
