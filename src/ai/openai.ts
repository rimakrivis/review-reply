import { DRAFT_SCHEMA, parseDraft, type Prompt } from "../prompt";
import type { DraftResult } from "../types";
import { ProviderError, type AIProvider } from "./provider";

const URL = "https://api.openai.com/v1/chat/completions";

/** Reasoning models (gpt-5 family, o-series) reject `temperature` and accept `reasoning_effort`. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

export function buildRequestBody(model: string, prompt: Prompt): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "review_reply", strict: true, schema: DRAFT_SCHEMA },
    },
  };
  if (isReasoningModel(model)) {
    // Replies are short; keep hidden reasoning cheap and fast. Budget includes reasoning tokens.
    body.reasoning_effort = /^gpt-5(-|$)/i.test(model) ? "minimal" : "low";
    body.max_completion_tokens = 4000;
  } else {
    body.temperature = 0.7;
    body.max_completion_tokens = 600;
  }
  return body;
}

function explain(status: number, apiMessage: string): ProviderError {
  if (status === 401) return new ProviderError("OpenAI rejected the API key. Check it in Settings.", true);
  if (status === 429) {
    return new ProviderError(
      /quota|billing/i.test(apiMessage)
        ? "Your OpenAI account is out of credit. Add billing at platform.openai.com."
        : "OpenAI rate limit hit. Wait a few seconds and try again.",
    );
  }
  if (status === 404 || /model/i.test(apiMessage)) {
    return new ProviderError(`OpenAI could not use this model. Pick another in Settings. (${apiMessage})`, true);
  }
  return new ProviderError(`OpenAI error ${status}: ${apiMessage || "unknown error"}`);
}

export class OpenAIProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
    // Wrapped so fetch is never called with the provider as `this` (Chrome throws "Illegal invocation").
    private fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async draft(prompt: Prompt): Promise<DraftResult> {
    if (!this.apiKey.trim()) {
      throw new ProviderError("Add your OpenAI API key in Settings first.", true);
    }
    let res: Response;
    try {
      res = await this.fetchFn(URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey.trim()}`,
        },
        body: JSON.stringify(buildRequestBody(this.model, prompt)),
      });
    } catch (e) {
      console.warn("[ReviewReply] OpenAI request failed", e);
      throw new ProviderError("Could not reach OpenAI. Check your internet connection.");
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    };
    if (!res.ok) throw explain(res.status, data.error?.message ?? "");

    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new ProviderError(`The AI refused: ${choice.message.refusal}`);
    const content = choice?.message?.content;
    if (!content) {
      throw new ProviderError(
        choice?.finish_reason === "length"
          ? "The AI ran out of tokens before answering. Try again or pick a non-reasoning model."
          : "The AI returned no answer. Try again.",
      );
    }
    return parseDraft(content);
  }
}
