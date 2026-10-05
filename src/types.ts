/** A recurring kind of review, with guidance on how to answer it. */
export interface Situation {
  id: string;
  name: string;
  /** How to recognise this situation in a review. */
  recognize: string;
  /** What the reply should say or do. */
  respond: string;
  /** Things the reply must never say for this situation. */
  avoid: string;
  /** Optional example reply in the business's voice. */
  example: string;
}

/** Something so serious the owner must hear about it right away, e.g. "Drink spiking". */
export interface UrgentTopic {
  id: string;
  name: string;
  /** How to recognise this topic in a review. */
  description: string;
}

/** Everything the AI needs to know about one business. */
export interface Profile {
  id: string;
  businessName: string;
  businessType: string;
  signature: string;
  tone: string;
  /** Facts the reply may use: hours, complaint email, booking link, etc. */
  facts: string;
  /** Rules that apply to every reply. */
  rules: string;
  situations: Situation[];
  /** Topics that count as urgent in reports and the 🚨 badge. */
  urgentTopics: UrgentTopic[];
  /** Language reports are written in, e.g. "English" or "Lithuanian". */
  reportLanguage: string;
  /** Review sites the owner always leaves out of this business's reports. */
  skippedSources?: Source[];
}

export interface Settings {
  apiKey: string;
  model: string;
  activeProfileId: string;
  profiles: Profile[];
  /** Show the floating ✨ button on Google review pages. */
  showLauncher: boolean;
}

/** Review sites ReviewReply can read. Reviews saved before sites existed are from Google. */
export type Source = "google" | "tripadvisor" | "facebook";

export const SOURCE_NAMES: Record<Source, string> = { google: "Google", tripadvisor: "Tripadvisor", facebook: "Facebook" };

/** Every site, in the order they are shown. */
export const SOURCES: Source[] = ["google", "tripadvisor", "facebook"];

export interface Review {
  /** Where the review was written. Missing means Google. */
  source?: Source;
  reviewerName: string;
  /** 1-5, or 0 when unknown (Facebook has no stars). */
  rating: number;
  /** Facebook: whether the reviewer recommends the business. */
  recommends?: boolean;
  text: string;
  /** When the review was written (ms since 1970), if the page shows it. */
  date?: number;
  /** True for vague dates like "2 months ago", which may be off by weeks. */
  dateIsRough?: boolean;
  /** True when the owner has already replied on Google. */
  hasOwnerReply?: boolean;
  /** The site's own id for the review (Google's data-review-id, Tripadvisor's data-review-gid), when shown. Never changes. */
  googleId?: string;
  /** True when the page showed only the start of the text ("…"). The full text replaces it once seen. */
  textIsShort?: boolean;
  /** Extra answers under the review, e.g. { Food: "4/5", Service: "1/5", "Price per person": "€10–20" }. */
  details?: Record<string, string>;
}

/** A review saved in the extension's archive. */
export interface StoredReview extends Review {
  /** Stable id made from the review's content, used to skip duplicates. */
  id: string;
  date: number;
  /** When the extension first saw this review. */
  firstSeen: number;
}

/** Star statistics for a set of reviews. */
export interface Stats {
  count: number;
  /** Average stars (0 when there are no rated reviews). */
  average: number;
  /** How many reviews gave 1, 2, 3, 4 and 5 stars: stars[0] is 1★ … stars[4] is 5★. */
  stars: [number, number, number, number, number];
  /** Facebook: how many reviews recommend and don't recommend. Only set when there are such reviews. */
  recommend?: [yes: number, no: number];
}

/** A theme guests praise or complain about in one month. */
export interface ReportTheme {
  theme: string;
  /** How many of the month's reviews mention it (counted by code, not guessed by the AI). */
  mentions: number;
  details: string;
  /** Short word-for-word quotes from reviews. */
  quotes: string[];
}

/** A review about one of the business's urgent topics. */
export interface UrgentItem {
  topic: string;
  what: string;
  /** Who wrote it, e.g. "Anna · 12 Aug · 1★", so the owner can find it on Google. */
  reviewers: string[];
}

/** The part of a monthly report written by the AI. */
export interface MonthReport {
  overview: string;
  urgent: UrgentItem[];
  praise: ReportTheme[];
  complaints: ReportTheme[];
  /** What changed since last month. */
  changes: string[];
  suggestions: string[];
}

/** Numbers per review site, only for the sites that had reviews. */
export type StatsBySource = Partial<Record<Source, Stats>>;

/** Everything saved for one month of one business. */
export interface MonthEntry {
  /** "2026-08" */
  month: string;
  /** Exact numbers, calculated by code. */
  stats: Stats;
  /** The same numbers per review site. Missing in reports made before sites existed. */
  bySource?: StatsBySource;
  /** Sites in use that were left out of this report, because the owner chose to. */
  skipped?: Source[];
  /** null when the month had no reviews, so no AI report was needed. */
  report: MonthReport | null;
  createdAt: number;
  /** True once the owner has looked at the report. */
  opened: boolean;
}

/** A theme across the year, made by grouping the monthly themes. */
export interface YearTheme extends ReportTheme {
  /** In how many monthly reports the theme appears. */
  months: number;
}

/** An urgent item from one of the year's monthly reports. */
export interface YearUrgentItem extends UrgentItem {
  /** "2026-08" */
  month: string;
}

/** The yearly report. Urgent items are copied from the monthly reports by code; the rest is written by the AI. */
export interface YearReport {
  overview: string;
  urgent: YearUrgentItem[];
  praise: YearTheme[];
  complaints: YearTheme[];
  /** How things changed during the year, and compared with last year. */
  changes: string[];
  suggestions: string[];
}

/** Everything saved for one year of one business. Built from its monthly reports, not from raw reviews. */
export interface YearEntry {
  /** "2026" */
  year: string;
  /** The months whose reports went into it, oldest first, e.g. ["2026-01", "2026-02"]. */
  months: string[];
  /** The monthly numbers added up exactly. */
  stats: Stats;
  bySource?: StatsBySource;
  /** null when none of the months had reviews. */
  report: YearReport | null;
  createdAt: number;
  opened: boolean;
}

/** "Showing results 31-60 of 513" */
export interface PageInfo {
  first: number;
  last: number;
  total: number;
}

export type Variant = "default" | "shorter" | "warmer" | "regenerate";

export interface DraftRequest {
  review: Review;
  variant: Variant;
  /** The previous draft, used by shorter / warmer / regenerate. */
  previous?: string;
}

export interface DraftResult {
  situation: string;
  confidence: "high" | "medium" | "low";
  reply: string;
}

/** Messages exchanged between extension pages / content scripts and the background worker. */
export type Message =
  | { type: "draft"; request: DraftRequest; profileId?: string }
  | { type: "openOptions" }
  | { type: "openPanel" }
  | { type: "openFull" }
  | {
      type: "archiveReviews";
      source: Source;
      reviews: Review[];
      /** true / false when the page shows its sort order; undefined on pages without one. */
      sortedByNewest?: boolean;
      /** For sites with numbered pages: which results this page shows, e.g. 31–60 of 513. */
      page?: PageInfo;
    }
  /** `skip`: sites to leave out of this report only. */
  | { type: "makeMonthReport"; profileId: string; month: string; skip?: Source[] }
  | { type: "makeMissingReports"; profileId: string }
  | { type: "makeYearReport"; profileId: string; year: string }
  /** `period` is a month ("2026-08") or a year ("2026"). */
  | { type: "markReportOpened"; profileId: string; period: string };

/** Answer to makeMonthReport / makeMissingReports / makeYearReport. */
export type ReportResponse = { ok: true; made: number } | { ok: false; error: string; needsSetup?: boolean };

export type DraftResponse =
  | { ok: true; result: DraftResult; profileName: string }
  | { ok: false; error: string; needsSetup?: boolean };
