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
}

export interface Settings {
  apiKey: string;
  model: string;
  activeProfileId: string;
  profiles: Profile[];
  /** Show the floating ✨ button on Google review pages. */
  showLauncher: boolean;
}

export interface Review {
  reviewerName: string;
  /** 1-5, or 0 when unknown. */
  rating: number;
  text: string;
  /** When the review was written (ms since 1970), if the page shows it. */
  date?: number;
  /** True for vague dates like "2 months ago", which may be off by weeks. */
  dateIsRough?: boolean;
  /** True when the owner has already replied on Google. */
  hasOwnerReply?: boolean;
  /** Google's own id for the review (data-review-id), when the page shows it. Never changes. */
  googleId?: string;
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
      reviews: Review[];
      /** true / false when the page has Google's sort button; undefined on pages without one. */
      sortedByNewest?: boolean;
    };

export type DraftResponse =
  | { ok: true; result: DraftResult; profileName: string }
  | { ok: false; error: string; needsSetup?: boolean };
