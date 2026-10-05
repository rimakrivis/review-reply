import { SOURCES, type MonthEntry, type PageInfo, type Review, type Source, type Stats, type StatsBySource, type StoredReview, type YearEntry } from "./types";

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

/** The review's site; reviews saved before sites existed are from Google. */
export function sourceOf(r: Pick<Review, "source">): Source {
  return r.source ?? "google";
}

/** Site + name + stars: the part of a review that does not change when Google translates it. */
function person(r: Pick<Review, "reviewerName" | "rating" | "source">): string {
  return `${sourceOf(r)}|${r.reviewerName.trim().toLowerCase()}|${r.rating}`;
}

/**
 * True when two sightings are the same review. Reviews from different sites never are. The site's own id decides
 * when both have one; otherwise the same person and stars with dates close enough.
 */
export function isSameReview(a: Review, b: Review): boolean {
  if (sourceOf(a) !== sourceOf(b)) return false;
  if (a.googleId && b.googleId) return a.googleId === b.googleId;
  if (a.date === undefined || b.date === undefined || person(a) !== person(b)) return false;
  const tolerance = a.dateIsRough || b.dateIsRough ? ROUGH_TOLERANCE : EXACT_TOLERANCE;
  return Math.abs(a.date - b.date) <= tolerance;
}

/**
 * Adds newly seen reviews to the archive.
 * - Skips reviews without a date, reviews already saved, and reviews in a locked (finished) month.
 * - The review text is not used to spot duplicates, because Google may show it translated or in the original.
 * - Updates a saved review when the owner has replied since, when a more precise date appears, or when the full
 *   text appears for a review saved with only the start of its text.
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
      if (r.text && (!old.text || (old.textIsShort && !r.textIsShort))) {
        old.text = r.text;
        if (r.textIsShort) old.textIsShort = true;
        else delete old.textIsShort;
      }
      if (!old.details && r.details) old.details = r.details;
      if (!old.googleId && r.googleId) old.googleId = r.googleId;
      continue;
    }
    if (lockedMonths.has(monthKey(r.date))) continue;
    const id = hash(`${person(r)}|${r.date}|${now}|${added}`);
    merged.push({ ...r, source: sourceOf(r), id, date: r.date, firstSeen: now });
    added++;
  }
  merged.sort((a, b) => b.date - a.date);
  return { merged, added };
}

/** Review count, average stars, how many reviews gave each number of stars, and Facebook's recommendations. */
export function statsFor(reviews: Pick<Review, "rating" | "recommends">[]): Stats {
  const stars: Stats["stars"] = [0, 0, 0, 0, 0];
  const recommend: [number, number] = [0, 0];
  let sum = 0;
  let rated = 0;
  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) {
      stars[r.rating - 1]++;
      sum += r.rating;
      rated++;
    }
    if (r.recommends !== undefined) recommend[r.recommends ? 0 : 1]++;
  }
  const stats: Stats = { count: reviews.length, average: rated ? Math.round((sum / rated) * 100) / 100 : 0, stars };
  if (recommend[0] + recommend[1]) stats.recommend = recommend;
  return stats;
}

/** Numbers per review site, for the sites that have reviews. */
export function statsBySource(reviews: Pick<Review, "rating" | "recommends" | "source">[]): StatsBySource {
  const groups: Partial<Record<Source, Pick<Review, "rating" | "recommends">[]>> = {};
  for (const r of reviews) (groups[sourceOf(r)] ??= []).push(r);
  const out: StatsBySource = {};
  for (const [source, list] of Object.entries(groups) as [Source, Pick<Review, "rating" | "recommends">[]][]) out[source] = statsFor(list);
  return out;
}

/** Adds up several periods' numbers per review site. */
export function sumBySource(list: (StatsBySource | undefined)[]): StatsBySource {
  const groups: Partial<Record<Source, Stats[]>> = {};
  for (const by of list) {
    for (const [source, stats] of Object.entries(by ?? {}) as [Source, Stats][]) (groups[source] ??= []).push(stats);
  }
  const out: StatsBySource = {};
  for (const [source, stats] of Object.entries(groups) as [Source, Stats[]][]) out[source] = sumStats(stats);
  return out;
}

/** Differences between two periods, e.g. 5★ +7, 1★ −3, average +0.3. */
export function compareStats(current: Stats, previous: Stats): Stats {
  return {
    count: current.count - previous.count,
    average: Math.round((current.average - previous.average) * 100) / 100,
    stars: current.stars.map((n, i) => n - previous.stars[i]) as Stats["stars"],
  };
}

/** Adds up several periods' numbers, e.g. twelve months into one year. The average is weighted by stars given. */
export function sumStats(list: Stats[]): Stats {
  const stars: Stats["stars"] = [0, 0, 0, 0, 0];
  let count = 0;
  for (const s of list) {
    count += s.count;
    s.stars.forEach((n, i) => (stars[i] += n));
  }
  const rated = stars.reduce((a, n) => a + n, 0);
  const sum = stars.reduce((a, n, i) => a + n * (i + 1), 0);
  const stats: Stats = { count, average: rated ? Math.round((sum / rated) * 100) / 100 : 0, stars };
  const recommend = list.reduce<[number, number]>((a, s) => [a[0] + (s.recommend?.[0] ?? 0), a[1] + (s.recommend?.[1] ?? 0)], [0, 0]);
  if (recommend[0] + recommend[1]) stats.recommend = recommend;
  return stats;
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

/** The parts of time covered in both lists, e.g. Google's coverage and Tripadvisor's. */
export function intersectRanges(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  for (const [aFrom, aTo] of a) {
    for (const [bFrom, bTo] of b) {
      const from = Math.max(aFrom, bFrom);
      const to = Math.min(aTo, bTo);
      if (from <= to) out.push([from, to]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function startOfNextDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** How far the owner has read a site's numbered pages, in order from page 1. */
export interface PageChain {
  /** The last result read so far, e.g. 60 after pages 1–30 and 31–60. */
  reached: number;
  /** The oldest review date on those pages. */
  oldest: number;
  /** When page 1 was read: nothing newer is known to be complete. */
  startedAt: number;
}

/**
 * Follows numbered pages sorted newest first (Tripadvisor: "Showing results 31-60 of 513"). Page 1 starts a chain;
 * each next page extends it. Pages read out of order add nothing. Returns the new chain and the time it covers:
 * from the day after its oldest review (more reviews of that day may be on the next page) until page 1 was read,
 * or from the start of the oldest review's month once the last page is read.
 */
export function followPages(
  chain: PageChain | undefined,
  page: PageInfo,
  oldest: number,
  now: number,
): { chain?: PageChain; range?: Range } {
  let next: PageChain;
  if (page.first === 1) next = { reached: page.last, oldest, startedAt: now };
  else if (chain && page.first <= chain.reached + 1 && page.last > chain.reached) {
    next = { ...chain, reached: page.last, oldest: Math.min(chain.oldest, oldest) };
  } else return { chain };
  const start = next.reached >= page.total ? startOfMonth(next.oldest) : startOfNextDay(next.oldest);
  return { chain: next, range: [start, next.startedAt] };
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

/* ---------- Monthly reports ---------- */

/** The reviews dated inside one "2026-08" month. */
export function reviewsInMonth(reviews: StoredReview[], month: string): StoredReview[] {
  return reviews.filter((r) => monthKey(r.date) === month);
}

/** "2026-01" → "2025-12" */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(y, m - 2, 1).getTime());
}

/** Months the owner can pick in the Reports tab: `ready` months (see readyMonths) and months with a report, newest first. */
export function reportMonths(ready: string[], months: Record<string, MonthEntry>): string[] {
  const all = new Set([...ready, ...Object.keys(months)]);
  return [...all].sort().reverse();
}

/** Complete months that don't have a report yet, oldest first. */
export function missingMonths(ranges: Range[], months: Record<string, MonthEntry>, now: number): string[] {
  return completeMonths(ranges, now).filter((m) => !months[m]);
}

/* ---------- Yearly reports ---------- */

/** The year's monthly entries, oldest first. */
export function monthsOfYear(months: Record<string, MonthEntry>, year: string): MonthEntry[] {
  return Object.values(months)
    .filter((e) => e.month.startsWith(`${year}-`))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Years the owner can pick: years of the pickable months (see reportMonths) and years with a report, newest first. */
export function reportYears(monthKeys: string[], years: Record<string, YearEntry>): string[] {
  const all = new Set([...monthKeys.map((m) => m.slice(0, 4)), ...Object.keys(years)]);
  return [...all].sort().reverse();
}

/** True when a monthly report of that year was made or changed after the yearly report. */
export function isYearOutdated(entry: YearEntry, months: Record<string, MonthEntry>): boolean {
  const now = monthsOfYear(months, entry.year);
  return (
    now.length !== entry.months.length ||
    now.some((m, i) => m.month !== entry.months[i] || m.createdAt > entry.createdAt)
  );
}

/* ---------- Storage ---------- */

export const reviewsKey = (profileId: string) => `reviews:${profileId}`;
export const collectKey = (profileId: string) => `collect:${profileId}`;
export const monthsKey = (profileId: string) => `months:${profileId}`;
export const yearsKey = (profileId: string) => `years:${profileId}`;

/** When the owner last had one site's review page open for this business, and what it covered. */
export interface SiteCollect {
  lastCollectedAt: number;
  /** Whether the list was sorted newest first the last time a list with a sort order was seen. */
  lastSortedByNewest?: boolean;
  /** Stretches of time in which every review was collected. */
  coverage?: Range[];
  /** Sites with numbered pages: how far they were read in order. */
  chain?: PageChain;
}

/**
 * Collection state of one business. Google's is kept at the top level (as saved before other sites existed),
 * other sites' under `sites`.
 */
export interface CollectInfo extends SiteCollect {
  sites?: Partial<Record<Exclude<Source, "google">, SiteCollect>>;
}

/** One site's collection state, if it was ever collected. */
export function siteCollect(info: CollectInfo | undefined, source: Source): SiteCollect | undefined {
  if (!info) return undefined;
  if (source !== "google") return info.sites?.[source];
  const { sites: _, ...google } = info;
  return google.coverage || google.lastSortedByNewest !== undefined ? google : undefined;
}

/** The sites this business has collection state for, Google first. */
export function collectedSources(info: CollectInfo | undefined): Source[] {
  return SOURCES.filter((s) => siteCollect(info, s));
}

/**
 * The sites in use for a business's reports: every site with some fully collected time, except the sites the
 * owner leaves out. A business that only ever opens Google uses only Google.
 */
export function sitesInUse(info: CollectInfo | undefined, skip: readonly Source[] = []): Source[] {
  return collectedSources(info).filter((s) => !skip.includes(s) && !!siteCollect(info, s)?.coverage?.length);
}

/** The time in which every site in use was fully collected. */
export function coverageOf(info: CollectInfo | undefined, skip: readonly Source[] = []): Range[] {
  const lists = sitesInUse(info, skip).map((s) => siteCollect(info, s)!.coverage!);
  return lists.length ? lists.reduce(intersectRanges) : [];
}

/** For one month: the sites in use that have it complete, and the ones still waiting to be opened. */
export function monthSites(
  info: CollectInfo | undefined,
  month: string,
  now: number,
  skip: readonly Source[] = [],
): { ready: Source[]; waiting: Source[] } {
  const ready: Source[] = [];
  const waiting: Source[] = [];
  for (const s of sitesInUse(info, skip)) {
    (isMonthComplete(siteCollect(info, s)!.coverage!, month, now) ? ready : waiting).push(s);
  }
  return { ready, waiting };
}

/** Months complete on at least one site in use, oldest first. A report can be made for them, maybe without a site. */
export function readyMonths(info: CollectInfo | undefined, now: number, skip: readonly Source[] = []): string[] {
  const all = new Set(sitesInUse(info, skip).flatMap((s) => completeMonths(siteCollect(info, s)!.coverage!, now)));
  return [...all].sort();
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

export async function loadMonths(profileId: string): Promise<Record<string, MonthEntry>> {
  const key = monthsKey(profileId);
  const got = await chrome.storage.local.get(key);
  return (got[key] as Record<string, MonthEntry> | undefined) ?? {};
}

/** Saves one month's entry, keeping the other months. Call it through the background worker's report queue. */
export async function saveMonthEntry(profileId: string, entry: MonthEntry): Promise<void> {
  const months = await loadMonths(profileId);
  months[entry.month] = entry;
  await chrome.storage.local.set({ [monthsKey(profileId)]: months });
}

export async function loadYears(profileId: string): Promise<Record<string, YearEntry>> {
  const key = yearsKey(profileId);
  const got = await chrome.storage.local.get(key);
  return (got[key] as Record<string, YearEntry> | undefined) ?? {};
}

/** Saves one year's entry, keeping the other years. Call it through the background worker's report queue. */
export async function saveYearEntry(profileId: string, entry: YearEntry): Promise<void> {
  const years = await loadYears(profileId);
  years[entry.year] = entry;
  await chrome.storage.local.set({ [yearsKey(profileId)]: years });
}

/** What a page tells about the reviews it shows. */
export interface PageSeen {
  source: Source;
  /** true / false when the page shows its sort order. */
  sortedByNewest?: boolean;
  /** Sites with numbered pages: which results this page shows. */
  page?: PageInfo;
}

/**
 * Updates one site's collection state after a page was read. When the list was sorted newest first, also records
 * the stretch of time it covered: for a scrolling list (Google) from its oldest review until now, for numbered
 * pages (Tripadvisor) as far as the pages were read in order.
 */
export function updateSiteCollect(old: SiteCollect | undefined, incoming: Review[], seen: PageSeen, now: number): SiteCollect {
  const site: SiteCollect = { ...old, lastCollectedAt: now };
  if (seen.sortedByNewest !== undefined) site.lastSortedByNewest = seen.sortedByNewest;
  if (!seen.sortedByNewest) return site;
  if (seen.page) {
    const dates = incoming.map((r) => r.date).filter((d): d is number => d !== undefined);
    if (!dates.length) return site;
    const { chain, range } = followPages(old?.chain, seen.page, Math.min(...dates), now);
    if (chain) site.chain = chain;
    if (range) site.coverage = addRange(old?.coverage ?? [], range);
    return site;
  }
  const start = coverageStart(incoming);
  if (start !== undefined && start < now) site.coverage = addRange(old?.coverage ?? [], [start, now]);
  return site;
}

/**
 * Saves reviews seen on a review page into the business's archive. Returns how many were new.
 * Call it through the background worker's queue so two frames never save at the same moment.
 */
export async function addToArchive(
  profileId: string,
  incoming: Review[],
  seen: PageSeen,
  now = Date.now(),
): Promise<number> {
  const [existing, old] = await Promise.all([loadReviews(profileId), loadCollectInfo(profileId)]);
  const tagged = incoming.map((r) => ({ ...r, source: seen.source }));
  const { merged, added } = mergeReviews(existing, tagged, now);
  const site = updateSiteCollect(siteCollect(old, seen.source), tagged, seen, now);
  const info: CollectInfo =
    seen.source === "google"
      ? { ...old, ...site }
      : { ...old, lastCollectedAt: old?.lastCollectedAt ?? now, sites: { ...old?.sites, [seen.source]: site } };
  await chrome.storage.local.set({ [reviewsKey(profileId)]: merged, [collectKey(profileId)]: info });
  return added;
}

/** Deletes all saved reviews for one business (the owner can collect them again from Google). */
export async function clearHistory(profileId: string): Promise<void> {
  await chrome.storage.local.remove([reviewsKey(profileId), collectKey(profileId)]);
}
