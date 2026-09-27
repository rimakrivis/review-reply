import type { Review, Stats, StoredReview } from "./types";

/**
 * The review archive: every review the extension has seen, saved per business in chrome.storage.local.
 * The pure helpers at the top do the logic and are unit tested; the functions at the bottom read and write storage.
 */

/* ---------- Pure helpers ---------- */

const DAY = 86_400_000;
/** How far apart two dates can be and still belong to the same review. Google's relative dates drift daily. */
const EXACT_TOLERANCE = 3 * DAY;
const ROUGH_TOLERANCE = 45 * DAY;

/** Short hash (FNV-1a) of a text. The same text always gives the same result. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** "2026-03" for a timestamp, in the owner's local time. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Name + stars: the part of a review that does not change when Google translates it. */
function person(r: Pick<Review, "reviewerName" | "rating">): string {
  return `${r.reviewerName.trim().toLowerCase()}|${r.rating}`;
}

/**
 * True when two sightings are the same review. Google's own id decides when both have one; otherwise the same
 * person and stars with dates close enough.
 */
export function isSameReview(a: Review, b: Review): boolean {
  if (a.googleId && b.googleId) return a.googleId === b.googleId;
  if (a.date === undefined || b.date === undefined || person(a) !== person(b)) return false;
  const tolerance = a.dateIsRough || b.dateIsRough ? ROUGH_TOLERANCE : EXACT_TOLERANCE;
  return Math.abs(a.date - b.date) <= tolerance;
}

/**
 * Adds newly seen reviews to the archive.
 * - Skips reviews without a date, reviews already saved, and reviews in a locked (finished) month.
 * - The review text is not used to spot duplicates, because Google may show it translated or in the original.
 * - Updates a saved review when the owner has replied since, or when a more precise date appears.
 * Returns the new list (newest first) and how many reviews were added.
 */
export function mergeReviews(
  existing: StoredReview[],
  incoming: Review[],
  now: number,
  lockedMonths: ReadonlySet<string> = new Set(),
): { merged: StoredReview[]; added: number } {
  const merged = existing.map((r) => ({ ...r }));
  let added = 0;
  for (const r of incoming) {
    if (r.date === undefined) continue;
    const old = merged.find((m) => isSameReview(m, r));
    if (old) {
      if (r.hasOwnerReply !== undefined) old.hasOwnerReply = r.hasOwnerReply;
      if (old.dateIsRough && !r.dateIsRough) {
        old.date = r.date;
        old.dateIsRough = false;
      }
      if (!old.text && r.text) old.text = r.text;
      if (!old.details && r.details) old.details = r.details;
      if (!old.googleId && r.googleId) old.googleId = r.googleId;
      continue;
    }
    if (lockedMonths.has(monthKey(r.date))) continue;
    const id = hash(`${person(r)}|${r.date}|${now}|${added}`);
    merged.push({ ...r, id, date: r.date, firstSeen: now });
    added++;
  }
  merged.sort((a, b) => b.date - a.date);
  return { merged, added };
}

/** Review count, average stars and how many reviews gave each number of stars. */
export function statsFor(reviews: Pick<Review, "rating">[]): Stats {
  const stars: Stats["stars"] = [0, 0, 0, 0, 0];
  let sum = 0;
  let rated = 0;
  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) {
      stars[r.rating - 1]++;
      sum += r.rating;
      rated++;
    }
  }
  return { count: reviews.length, average: rated ? Math.round((sum / rated) * 100) / 100 : 0, stars };
}

/** Differences between two periods, e.g. 5★ +7, 1★ −3, average +0.3. */
export function compareStats(current: Stats, previous: Stats): Stats {
  return {
    count: current.count - previous.count,
    average: Math.round((current.average - previous.average) * 100) / 100,
    stars: current.stars.map((n, i) => n - previous.stars[i]) as Stats["stars"],
  };
}

/* ---------- Coverage: which months were fully scrolled through ---------- */

/** A stretch of time [from, to] in which every review was loaded (the list was sorted by Newest). */
export type Range = [number, number];

/**
 * Where a Newest-sorted page's coverage starts: its oldest review, moved later by a safety margin because
 * Google's dates are approximate ("9 weeks ago" can be 63–69 days).
 */
export function coverageStart(reviews: Pick<Review, "date" | "dateIsRough">[]): number | undefined {
  let oldest: Pick<Review, "date" | "dateIsRough"> | undefined;
  for (const r of reviews) if (r.date !== undefined && (!oldest || r.date < oldest.date!)) oldest = r;
  if (!oldest) return undefined;
  return oldest.date! + (oldest.dateIsRough ? 30 * DAY : 7 * DAY);
}

/** Adds a range and joins overlapping ones, e.g. [May–Jul] + [Jun–Sep] → [May–Sep]. */
export function addRange(ranges: Range[], add: Range): Range[] {
  const all = [...ranges, add].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [from, to] of all) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + DAY) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

function monthBounds(month: string): Range {
  const [y, m] = month.split("-").map(Number);
  return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime() - 1];
}

/** True when the month is over and one covered range spans it from its first to its last day. */
export function isMonthComplete(ranges: Range[], month: string, now: number): boolean {
  const [start, end] = monthBounds(month);
  return end < now && ranges.some(([from, to]) => from <= start && to >= end);
}

/** All complete months, oldest first. */
export function completeMonths(ranges: Range[], now: number): string[] {
  if (!ranges.length) return [];
  const months: string[] = [];
  const d = new Date(ranges[0][0]);
  for (let m = new Date(d.getFullYear(), d.getMonth(), 1); m.getTime() < now; m.setMonth(m.getMonth() + 1)) {
    const key = monthKey(m.getTime());
    if (isMonthComplete(ranges, key, now)) months.push(key);
  }
  return months;
}

/* ---------- Storage ---------- */

export const reviewsKey = (profileId: string) => `reviews:${profileId}`;
export const collectKey = (profileId: string) => `collect:${profileId}`;

/** When the owner last had a Google review page open for this business, and what it covered. */
export interface CollectInfo {
  lastCollectedAt: number;
  /** Whether Google's list was sorted by Newest the last time a list with a sort button was seen. */
  lastSortedByNewest?: boolean;
  /** Stretches of time in which every review was collected. */
  coverage?: Range[];
}

export async function loadReviews(profileId: string): Promise<StoredReview[]> {
  const key = reviewsKey(profileId);
  const got = await chrome.storage.local.get(key);
  return (got[key] as StoredReview[] | undefined) ?? [];
}

export async function loadCollectInfo(profileId: string): Promise<CollectInfo | undefined> {
  const key = collectKey(profileId);
  const got = await chrome.storage.local.get(key);
  return got[key] as CollectInfo | undefined;
}

/**
 * Saves reviews seen on a Google page into the business's archive. Returns how many were new.
 * When the list was sorted by Newest, also records the stretch of time it covered.
 * Call it through the background worker's queue so two frames never save at the same moment.
 */
export async function addToArchive(
  profileId: string,
  incoming: Review[],
  sortedByNewest?: boolean,
  now = Date.now(),
): Promise<number> {
  const [existing, old] = await Promise.all([loadReviews(profileId), loadCollectInfo(profileId)]);
  const { merged, added } = mergeReviews(existing, incoming, now);
  const info: CollectInfo = { ...old, lastCollectedAt: now };
  if (sortedByNewest !== undefined) info.lastSortedByNewest = sortedByNewest;
  const start = sortedByNewest ? coverageStart(incoming) : undefined;
  if (start !== undefined && start < now) info.coverage = addRange(old?.coverage ?? [], [start, now]);
  await chrome.storage.local.set({ [reviewsKey(profileId)]: merged, [collectKey(profileId)]: info });
  return added;
}

/** Deletes all saved reviews for one business (the owner can collect them again from Google). */
export async function clearHistory(profileId: string): Promise<void> {
  await chrome.storage.local.remove([reviewsKey(profileId), collectKey(profileId)]);
}
