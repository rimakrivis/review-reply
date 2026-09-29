import type { DraftResult, MonthReport, StoredReview } from "../types";
import type { Prompt } from "../prompt";

/** Any AI backend that can turn a prompt into a structured draft or report. */
export interface AIProvider {
  draft(prompt: Prompt): Promise<DraftResult>;
  summarizeMonth(prompt: Prompt, listed: StoredReview[]): Promise<MonthReport>;
}

/** An error whose message is safe and useful to show to the user. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly needsSetup = false,
  ) {
    super(message);
  }
}
