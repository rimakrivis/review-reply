import { describe, expect, it, vi } from "vitest";
import { buildRequestBody, isReasoningModel, MONTH_SPEC, OpenAIProvider } from "../src/ai/openai";

const prompt = { system: "sys", user: "usr" };

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("buildRequestBody", () => {
  it("uses temperature for classic models and strict JSON schema", () => {
    const b = buildRequestBody("gpt-4o-mini", prompt) as any;
    expect(b.temperature).toBe(0.7);
    expect(b.reasoning_effort).toBeUndefined();
    expect(b.response_format.json_schema.strict).toBe(true);
    expect(b.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "usr" }]);
  });
  it("uses reasoning settings for gpt-5 and o-series models", () => {
    expect(isReasoningModel("gpt-5-nano")).toBe(true);
    expect(isReasoningModel("o4-mini")).toBe(true);
    expect(isReasoningModel("gpt-4.1-nano")).toBe(false);
    const b = buildRequestBody("gpt-5-nano", prompt) as any;
    expect(b.temperature).toBeUndefined();
    expect(b.reasoning_effort).toBe("minimal");
    expect((buildRequestBody("gpt-5.4-mini", prompt) as any).reasoning_effort).toBe("low");
  });
});

describe("OpenAIProvider", () => {
  it("returns the parsed draft and sends the key", async () => {
    const f = fakeFetch(200, { choices: [{ message: { content: '{"situation":"A","confidence":"high","reply":"Thanks!"}' } }] });
    const r = await new OpenAIProvider("sk-test", "gpt-4o-mini", f).draft(prompt);
    expect(r.reply).toBe("Thanks!");
    const [, init] = (f as any).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sk-test");
  });
  it("asks for setup when the key is missing or wrong", async () => {
    await expect(new OpenAIProvider("", "m", fakeFetch(200, {})).draft(prompt)).rejects.toMatchObject({ needsSetup: true });
    await expect(
      new OpenAIProvider("bad", "m", fakeFetch(401, { error: { message: "Incorrect API key" } })).draft(prompt),
    ).rejects.toMatchObject({ needsSetup: true, message: expect.stringMatching(/API key/) });
  });
  it("explains quota, rate limit and truncation errors", async () => {
    await expect(new OpenAIProvider("k", "m", fakeFetch(429, { error: { message: "exceeded your current quota" } })).draft(prompt)).rejects.toThrow(/credit/);
    await expect(new OpenAIProvider("k", "m", fakeFetch(429, { error: { message: "slow down" } })).draft(prompt)).rejects.toThrow(/rate limit/);
    await expect(new OpenAIProvider("k", "m", fakeFetch(200, { choices: [{ message: { content: null }, finish_reason: "length" }] })).draft(prompt)).rejects.toThrow(/ran out of tokens/);
  });
  it("reports network failures", async () => {
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(new OpenAIProvider("k", "m", f).draft(prompt)).rejects.toThrow(/internet/);
  });
});

describe("summarizeMonth", () => {
  it("asks for the report schema with a larger budget and turns review numbers into counts", async () => {
    const answer = {
      overview: "Good month.",
      urgent: [],
      themes: [{ theme: "Staff", feeling: "praise", reviews: [1, 2], details: "Friendly", quotes: [] }],
      changes: [],
      suggestions: [],
    };
    const f = fakeFetch(200, { choices: [{ message: { content: JSON.stringify(answer) } }] });
    const listed = [1, 2].map((i) => ({ reviewerName: `R${i}`, rating: 5, text: "x", date: 0, id: String(i), firstSeen: 0 }));
    const r = await new OpenAIProvider("k", "gpt-4o-mini", f).summarizeMonth(prompt, listed);
    expect(r.praise[0].mentions).toBe(2);
    const body = JSON.parse((f as any).mock.calls[0][1].body);
    expect(body.response_format.json_schema.name).toBe("month_report");
    expect(body.max_completion_tokens).toBe(MONTH_SPEC.maxTokens);
    expect(body.temperature).toBe(MONTH_SPEC.temperature);
  });
  it("keeps replies on the reply schema by default", () => {
    expect((buildRequestBody("gpt-4o-mini", prompt) as any).response_format.json_schema.name).toBe("review_reply");
  });
});
