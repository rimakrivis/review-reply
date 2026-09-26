import type { DraftResult } from "../types";
import type { Prompt } from "../prompt";

/** Any AI backend that can turn a prompt into a structured draft. */
export interface AIProvider {
  draft(prompt: Prompt): Promise<DraftResult>;
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
