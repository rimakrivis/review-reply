import type { Review } from "../types";
import { parseReviewDate, UI_ATTR } from "./extract";

/**
 * Reading reviews ("recommendations") from a Facebook page's Reviews tab (facebook.com/<page>/reviews).
 *
 * Facebook has no stars: a reviewer recommends the page or not. Each review is a role="article" box whose header
 * says "Anna recommends Page." The header, the text and the comment box are found through Facebook's stable
 * data attributes and roles, since its class names are obfuscated. Works with Facebook in English and Lithuanian.
 */

const NOT_RECOMMEND_RE = /\b(doesn['’]t recommend|does not recommend|nerekomenduoja)\b/i;
const RECOMMEND_RE = /\b(recommends|rekomenduoja)\b/i;
/** "See more" inside a long review: the text is shortened. */
const SEE_MORE_RE = /^(see more|žr\. daugiau|daugiau)$/i;

/** True on a Facebook page's Reviews tab, the only place reviews are collected from. */
export function isFacebookReviewsPage(loc: Pick<Location, "hostname" | "pathname" | "search">): boolean {
  return (
    /(^|\.)facebook\.com$/i.test(loc.hostname) &&
    (/\/reviews\/?$/i.test(loc.pathname) || /[?&]sk=reviews\b/i.test(loc.search))
  );
}

/* ---------- Dates ---------- */

const DAY = 86_400_000;
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Lithuanian month stems, both "Sausis" and "sausio". */
const LT_MONTHS = ["saus", "vasar", "kov", "baland", "geguž", "biržel", "liep", "rugpjū", "rugsėj", "spal", "lapkri", "gruod"];

function monthIndex(word: string): number {
  const w = word.toLowerCase();
  const lt = LT_MONTHS.findIndex((stem) => w.startsWith(stem));
  return lt >= 0 ? lt : EN_MONTHS.findIndex((stem) => w.startsWith(stem));
}

/** A day without a year is this year's, or last year's when that day is still ahead. */
function dayOf(year: number | undefined, month: number, day: number, now: number): number | undefined {
  if (month < 0 || day < 1 || day > 31) return undefined;
  const thisYear = new Date(now).getFullYear();
  let d = new Date(year ?? thisYear, month, day).getTime();
  if (year === undefined && d > now + DAY) d = new Date(thisYear - 1, month, day).getTime();
  return d;
}

const RELATIVE: [RegExp, number][] = [
  [/^(\d+)\s*(min\.?|m)$/i, 60_000],
  [/^(\d+)\s*(val\.?|h)$/i, 3_600_000],
  [/^(\d+)\s*(d\.?)$/i, DAY],
  [/^(\d+)\s*(sav\.?|w)$/i, 7 * DAY],
  [/^(\d+)\s*(m\.?|y)$/i, 365 * DAY],
];

/**
 * Facebook's date under the reviewer's name: "Sausis 29 d.", "2025 m. Spalis 30 d.", "January 29",
 * "October 30, 2025", "29 January 2025", "3 d.", "5h", "Vakar", "Yesterday". Returns null when it is not a date.
 */
export function parseFacebookDate(text: string, now = Date.now()): number | null {
  const t = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,?\s+(at|\d{1,2}:\d{2}).*$/i, ""); // "January 29 at 14:05"
  if (/^(just now|ką tik)$/i.test(t)) return now;
  if (/^(yesterday|vakar)$/i.test(t)) return now - DAY;
  for (const [re, ms] of RELATIVE) {
    const m = re.exec(t);
    if (m) return now - Number(m[1]) * ms;
  }
  let m = /^(?:(\d{4})\s*m\.\s*)?([\p{L}]+)\s+(\d{1,2})\s*d\.?$/iu.exec(t); // Lithuanian
  if (m) return dayOf(m[1] ? Number(m[1]) : undefined, monthIndex(m[2]), Number(m[3]), now) ?? null;
  m = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i.exec(t); // "January 29, 2026"
  if (m) return dayOf(m[3] ? Number(m[3]) : undefined, monthIndex(m[1]), Number(m[2]), now) ?? null;
  m = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i.exec(t); // "29 January 2026"
  if (m) return dayOf(m[3] ? Number(m[3]) : undefined, monthIndex(m[2]), Number(m[1]), now) ?? null;
  const other = parseReviewDate(t, now);
  return other && !other.rough ? other.date : null;
}

/* ---------- Reviews ---------- */

function header(article: Element): Element | null {
  return article.querySelector('[data-ad-rendering-role="profile_name"], h2, h3, h4');
}

/** True for a review: an article whose header says "recommends" or "doesn't recommend". */
function isReview(article: Element): boolean {
  const h = header(article)?.textContent ?? "";
  return RECOMMEND_RE.test(h) || NOT_RECOMMEND_RE.test(h);
}

/** Elements of the review itself, not of the comments under it (which are articles too). */
function own(article: Element, selector: string): Element[] {
  return Array.from(article.querySelectorAll(selector)).filter((el) => el.closest('[role="article"]') === article);
}

/** The reviews on the page: top-level articles only, since comments are articles inside them. */
function reviewArticles(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('[role="article"]')).filter(
    (a) => !a.parentElement?.closest('[role="article"]') && !a.closest(`[${UI_ATTR}]`) && isReview(a),
  );
}

/** The review a comment box belongs to: the outermost article around it. */
export function findFacebookContainer(editor: Element): Element | null {
  let article = editor.closest('[role="article"]');
  for (let up = article?.parentElement?.closest('[role="article"]'); up; up = up.parentElement?.closest('[role="article"]')) {
    article = up;
  }
  return article && isReview(article) ? article : null;
}

/** Text of an element, one line per block, without buttons, hidden parts or images' alt text. */
function textOf(el: Element): { text: string; short: boolean } {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  const lines: string[] = [];
  let short = false;
  let lastBlock: Element | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    const t = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (!parent || !t) continue;
    const button = parent.closest('[role="button"], button');
    if (button && el.contains(button)) {
      if (SEE_MORE_RE.test(t)) short = true;
      continue;
    }
    if (parent.closest('[aria-hidden="true"]')) continue;
    const block = parent.closest('div, p, li') ?? parent;
    if (block === lastBlock && lines.length) lines[lines.length - 1] += ` ${t}`;
    else lines.push(t);
    lastBlock = block;
  }
  return { text: lines.join("\n").replace(/\s*(…|\.\.\.)$/, short ? "" : "$1").trim(), short };
}

export function extractFacebookReview(article: Element, now = Date.now()): Review {
  const h = header(article);
  const headText = h?.textContent ?? "";
  const links = h ? Array.from(h.querySelectorAll("a")) : [];
  const reviewerName = (links[0]?.textContent ?? "").trim();
  const pageName = links.length > 1 ? (links[links.length - 1].textContent ?? "").trim() : "";

  const review: Review = {
    source: "facebook",
    reviewerName,
    rating: 0,
    recommends: !NOT_RECOMMEND_RE.test(headText),
    text: "",
  };

  // The date is a link to the review's own post, just under the name.
  for (const a of own(article, "a")) {
    if (h?.contains(a)) continue;
    const date = parseFacebookDate(a.getAttribute("aria-label") ?? "", now) ?? parseFacebookDate(a.textContent ?? "", now);
    if (date === null) continue;
    review.date = date;
    review.dateIsRough = false;
    const id = /\/posts\/([\w-]+)|story_fbid=([\w-]+)/.exec(a.getAttribute("href") ?? "");
    if (id) review.googleId = `fb:${id[1] ?? id[2]}`;
    break;
  }

  const message = own(article, '[data-ad-rendering-role="story_message"], [data-ad-preview="message"]')[0];
  if (message) {
    const { text, short } = textOf(message);
    review.text = text;
    if (short) review.textIsShort = true;
  }

  // Tags the reviewer picked, e.g. "Cozy atmosphere".
  const tags = own(article, "ul li")
    .filter((li) => !li.closest("form") && !li.querySelector('[role="button"], button, input'))
    .map((li) => (li.textContent ?? "").replace(/^[\s·•]+|[\s·•]+$/g, ""))
    .filter(Boolean);
  if (tags.length) review.details = { Tags: tags.join(", ") };

  // A comment from the page itself is the owner's reply.
  const comments = Array.from(article.querySelectorAll('[role="article"]')).filter((c) => c !== article);
  review.hasOwnerReply =
    !!pageName && comments.some((c) => (c.getAttribute("aria-label") ?? "").includes(pageName));
  return review;
}

/** Every review on the page. Only dated reviews are returned. */
export function extractAllFacebookReviews(root: ParentNode, now = Date.now()): Review[] {
  return reviewArticles(root)
    .map((a) => extractFacebookReview(a, now))
    .filter((r) => r.date !== undefined && r.reviewerName);
}

/**
 * Facebook shows no sort button, so the order is checked instead: newest first means every review is as old as
 * or older than the one above it. Undefined with fewer than two reviews.
 */
export function isFacebookSortedByNewest(root: ParentNode): boolean | undefined {
  const dates = extractAllFacebookReviews(root).map((r) => r.date!);
  if (dates.length < 2) return undefined;
  return dates.every((d, i) => i === 0 || d <= dates[i - 1] + DAY);
}
