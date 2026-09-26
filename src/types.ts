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
}

export interface Review {
  reviewerName: string;
  /** 1-5, or 0 when unknown. */
  rating: number;
  text: string;
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
  | { type: "openOptions" };

export type DraftResponse =
  | { ok: true; result: DraftResult; profileName: string }
  | { ok: false; error: string; needsSetup?: boolean };
