import { describe, expect, it } from "vitest";
import {
  addRange,
  compareStats,
  completeMonths,
  coverageStart,
  isMonthComplete,
  isSameReview,
  mergeReviews,
  missingMonths,
  monthKey,
  previousMonth,
  reportMonths,
  reviewsInMonth,
  statsFor,
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
    expect(reportMonths(ranges, { "2026-02": entry("2026-02") }, NOW)).toEqual(["2026-08", "2026-07", "2026-06", "2026-02"]);
  });
  it("lists complete months still missing a report, oldest first", () => {
    expect(missingMonths(ranges, { "2026-07": entry("2026-07") }, NOW)).toEqual(["2026-06", "2026-08"]);
  });
});
