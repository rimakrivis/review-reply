import { describe, expect, it } from "vitest";
import {
  addRange,
  type CollectInfo,
  compareStats,
  completeMonths,
  coverageOf,
  coverageStart,
  followPages,
  intersectRanges,
  monthSites,
  readyMonths,
  sitesInUse,
  isMonthComplete,
  isSameReview,
  mergeReviews,
  missingMonths,
  monthKey,
  previousMonth,
  reportMonths,
  reviewsInMonth,
  statsBySource,
  statsFor,
  sumBySource,
  updateSiteCollect,
} from "../src/archive";
import type { MonthEntry, Review, StoredReview } from "../src/types";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 27, 12).getTime();

const review = (name: string, rating: number, daysAgo: number, extra: Partial<Review> = {}): Review => ({
  reviewerName: name,
  rating,
  text: `Review by ${name}`,
  date: NOW - daysAgo * DAY,
  dateIsRough: false,
  hasOwnerReply: false,
  ...extra,
});

describe("isSameReview", () => {
  it("matches the same person and stars when the dates drift by a day", () => {
    expect(isSameReview(review("Anna", 5, 3), review("Anna", 5, 4))).toBe(true);
  });
  it("ignores the text, because Google may show it translated", () => {
    expect(isSameReview(review("Anna", 5, 3, { text: "Super!" }), review("Anna", 5, 3, { text: "Great!" }))).toBe(true);
  });
  it("keeps apart different people, different stars, or dates far apart", () => {
    expect(isSameReview(review("Anna", 5, 3), review("Ben", 5, 3))).toBe(false);
    expect(isSameReview(review("Anna", 5, 3), review("Anna", 4, 3))).toBe(false);
    expect(isSameReview(review("Anna", 5, 3), review("Anna", 5, 20))).toBe(false);
  });
  it("allows more slack for rough dates like '2 months ago'", () => {
    expect(isSameReview(review("Anna", 5, 60, { dateIsRough: true }), review("Anna", 5, 80))).toBe(true);
  });
});

describe("mergeReviews", () => {
  it("adds new reviews and skips ones already saved", () => {
    const first = mergeReviews([], [review("Anna", 5, 3), review("Ben", 1, 10)], NOW);
    expect(first.added).toBe(2);
    const again = mergeReviews(first.merged, [review("Anna", 5, 4), review("Cleo", 4, 1)], NOW + DAY);
    expect(again.added).toBe(1);
    expect(again.merged.map((r) => r.reviewerName)).toEqual(["Cleo", "Anna", "Ben"]); // newest first
  });

  it("notices when the owner has replied since", () => {
    const { merged } = mergeReviews([], [review("Anna", 5, 3)], NOW);
    const after = mergeReviews(merged, [review("Anna", 5, 3, { hasOwnerReply: true })], NOW);
    expect(after.merged[0].hasOwnerReply).toBe(true);
  });

  it("replaces a rough date with a precise one", () => {
    const { merged } = mergeReviews([], [review("Anna", 5, 30, { dateIsRough: true })], NOW);
    const after = mergeReviews(merged, [review("Anna", 5, 26)], NOW);
    expect(after.merged[0].dateIsRough).toBe(false);
    expect(after.merged[0].date).toBe(NOW - 26 * DAY);
  });

  it("skips reviews without a date and reviews in a locked month", () => {
    const locked = new Set([monthKey(NOW - 40 * DAY)]);
    const { added } = mergeReviews([], [review("Anna", 5, 3, { date: undefined }), review("Ben", 2, 40)], NOW, locked);
    expect(added).toBe(0);
  });
});

describe("stats", () => {
  it("counts stars and averages only rated reviews", () => {
    const s = statsFor([{ rating: 5 }, { rating: 5 }, { rating: 1 }, { rating: 0 }]);
    expect(s).toEqual({ count: 4, average: 3.67, stars: [1, 0, 0, 0, 2] });
    expect(statsFor([])).toEqual({ count: 0, average: 0, stars: [0, 0, 0, 0, 0] });
  });

  it("compares two periods", () => {
    const march = statsFor([{ rating: 5 }, { rating: 5 }, { rating: 4 }]);
    const feb = statsFor([{ rating: 1 }, { rating: 5 }]);
    expect(compareStats(march, feb)).toEqual({ count: 1, average: 1.67, stars: [-1, 0, 0, 1, 1] });
  });

  it("uses the owner's local month", () => {
    expect(monthKey(new Date(2026, 2, 31, 23, 30).getTime())).toBe("2026-03");
  });
});

describe("coverage", () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

  it("starts at the oldest review plus a safety margin", () => {
    expect(coverageStart([review("A", 5, 3), review("B", 5, 63)])).toBe(NOW - 63 * DAY + 7 * DAY);
    expect(coverageStart([review("A", 5, 90, { dateIsRough: true })])).toBe(NOW - 60 * DAY);
    expect(coverageStart([])).toBeUndefined();
  });

  it("joins overlapping ranges", () => {
    const r = addRange([[at(2026, 5, 1), at(2026, 7, 31)]], [at(2026, 6, 15), at(2026, 9, 27)]);
    expect(r).toEqual([[at(2026, 5, 1), at(2026, 9, 27)]]);
    expect(addRange(r, [at(2026, 1, 1), at(2026, 2, 1)])).toHaveLength(2); // a gap stays a gap
  });

  it("calls a month complete only when it is over and fully covered", () => {
    const ranges: [number, number][] = [[at(2026, 5, 20), NOW]];
    expect(isMonthComplete(ranges, "2026-06", NOW)).toBe(true);
    expect(isMonthComplete(ranges, "2026-05", NOW)).toBe(false); // only from the 20th
    expect(isMonthComplete(ranges, "2026-09", NOW)).toBe(false); // not over yet
    expect(completeMonths(ranges, NOW)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("monthly report helpers", () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
  const ranges: [number, number][] = [[at(2026, 5, 20), NOW]];
  const entry = (month: string): MonthEntry => ({
    month,
    stats: statsFor([]),
    report: null,
    createdAt: NOW,
    opened: true,
  });

  it("finds the month before, across the new year", () => {
    expect(previousMonth("2026-08")).toBe("2026-07");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
  it("picks only the reviews dated in the month", () => {
    const stored = [at(2026, 7, 31), at(2026, 8, 1), at(2026, 8, 31), at(2026, 9, 1)].map(
      (date, i): StoredReview => ({ reviewerName: `R${i}`, rating: 5, text: "", date, id: String(i), firstSeen: NOW }),
    );
    expect(reviewsInMonth(stored, "2026-08").map((r) => r.reviewerName)).toEqual(["R1", "R2"]);
  });
  it("lists complete months and months with a report, newest first", () => {
    expect(reportMonths(completeMonths(ranges, NOW), { "2026-02": entry("2026-02") })).toEqual(["2026-08", "2026-07", "2026-06", "2026-02"]);
  });
  it("lists complete months still missing a report, oldest first", () => {
    expect(missingMonths(ranges, { "2026-07": entry("2026-07") }, NOW)).toEqual(["2026-06", "2026-08"]);
  });
});

describe("several review sites", () => {
  const ta = (name: string, rating: number, daysAgo: number, extra: Partial<Review> = {}) =>
    review(name, rating, daysAgo, { source: "tripadvisor", ...extra });

  it("never mixes up reviews from different sites", () => {
    expect(isSameReview(review("Anna", 5, 3), ta("Anna", 5, 3))).toBe(false);
    const { merged } = mergeReviews([], [review("Anna", 5, 3), ta("Anna", 5, 3)], NOW);
    expect(merged.map((r) => r.source)).toEqual(["google", "tripadvisor"]);
  });

  it("replaces a shortened text with the full text, never the other way round", () => {
    const short = ta("Ben", 1, 5, { text: "Short changed...\nHad been going", textIsShort: true });
    const full = ta("Ben", 1, 5, { text: "Short changed\nHad been going for years.", googleId: "taur:1" });
    const once = mergeReviews([], [short], NOW).merged;
    const twice = mergeReviews(once, [full], NOW).merged;
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ text: full.text, googleId: "taur:1" });
    expect(twice[0].textIsShort).toBeUndefined();
    expect(mergeReviews(twice, [short], NOW).merged[0].text).toBe(full.text);
  });

  it("counts stars per site and adds them up across months", () => {
    const by = statsBySource([review("A", 5, 1), ta("B", 3, 1), ta("C", 1, 1)]);
    expect(by.google?.count).toBe(1);
    expect(by.tripadvisor).toMatchObject({ count: 2, average: 2 });
    expect(sumBySource([by, { google: statsFor([{ rating: 1 }]) }]).google).toMatchObject({ count: 2, average: 3 });
  });

  it("follows numbered pages read in order from page 1", () => {
    const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();
    const p1 = followPages(undefined, { first: 1, last: 30, total: 75 }, d(2026, 3, 10), NOW);
    expect(p1.range).toEqual([d(2026, 3, 11), NOW]); // reviews of the 10th may continue on page 2
    const p3 = followPages(p1.chain, { first: 61, last: 75, total: 75 }, d(2025, 1, 5), NOW + DAY);
    expect(p3.range).toBeUndefined(); // page 2 was skipped
    const p2 = followPages(p1.chain, { first: 31, last: 60, total: 75 }, d(2025, 6, 2), NOW + DAY);
    expect(p2.range).toEqual([d(2025, 6, 3), NOW]); // still only as new as when page 1 was read
    const last = followPages(p2.chain, { first: 61, last: 75, total: 75 }, d(2025, 1, 5), NOW + DAY);
    expect(last.range).toEqual([d(2025, 1, 1), NOW]); // the last page: its oldest month is complete
  });

  it("counts a month complete only when every site in use covers it", () => {
    const d = (m: number, day: number) => new Date(2026, m - 1, day).getTime();
    const google = updateSiteCollect(undefined, [review("A", 5, 200)], { source: "google", sortedByNewest: true }, NOW);
    const info: CollectInfo = { ...google };
    const googleOnly = completeMonths(coverageOf(info), NOW);
    expect(googleOnly).toContain("2026-05");
    const ta = updateSiteCollect(undefined, [review("B", 4, 0, { date: d(6, 15) })], {
      source: "tripadvisor",
      sortedByNewest: true,
      page: { first: 1, last: 30, total: 90 },
    }, NOW);
    const both: CollectInfo = { ...info, sites: { tripadvisor: ta } };
    expect(completeMonths(coverageOf(both), NOW)).toEqual(["2026-07", "2026-08"]);
    expect(intersectRanges([[0, 10]], [[5, 20], [30, 40]])).toEqual([[5, 10]]);
  });

  it("ignores a page whose sort order could not be trusted", () => {
    const site = updateSiteCollect(undefined, [review("A", 5, 30)], { source: "tripadvisor", sortedByNewest: false, page: { first: 1, last: 30, total: 90 } }, NOW);
    expect(site).toEqual({ lastCollectedAt: NOW, lastSortedByNewest: false });
  });

  it("uses only the sites a business opened, and lets the owner leave one out", () => {
    const d = (m: number, day: number) => new Date(2026, m - 1, day).getTime();
    const google = updateSiteCollect(undefined, [review("A", 5, 200)], { source: "google", sortedByNewest: true }, NOW);
    const ta = updateSiteCollect(undefined, [review("B", 4, 0, { date: d(6, 15) })], {
      source: "tripadvisor",
      sortedByNewest: true,
      page: { first: 1, last: 30, total: 90 },
    }, NOW);
    const onlyGoogle: CollectInfo = { ...google };
    expect(sitesInUse(onlyGoogle)).toEqual(["google"]);
    expect(monthSites(onlyGoogle, "2026-05", NOW)).toEqual({ ready: ["google"], waiting: [] });

    const both: CollectInfo = { ...google, sites: { tripadvisor: ta } };
    expect(monthSites(both, "2026-05", NOW)).toEqual({ ready: ["google"], waiting: ["tripadvisor"] });
    expect(monthSites(both, "2026-07", NOW)).toEqual({ ready: ["google", "tripadvisor"], waiting: [] });
    expect(monthSites(both, "2026-05", NOW, ["tripadvisor"])).toEqual({ ready: ["google"], waiting: [] });
    // May can still be picked (complete on Google); "Make missing reports" only takes months complete everywhere.
    expect(readyMonths(both, NOW)).toContain("2026-05");
    expect(completeMonths(coverageOf(both), NOW)).toEqual(["2026-07", "2026-08"]);
    expect(completeMonths(coverageOf(both, ["tripadvisor"]), NOW)).toContain("2026-05");
  });
});
