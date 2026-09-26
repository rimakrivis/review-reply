import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt, parseDraft } from "../src/prompt";
import { profileFromTemplate } from "../src/profiles";

const bar = { ...profileFromTemplate("bar", "The Copper Fox"), signature: "— The Copper Fox team", facts: "Complaints: hi@fox.example" };

describe("buildSystemPrompt", () => {
  const sys = buildSystemPrompt(bar);
  it("includes business, facts, signature and every situation", () => {
    expect(sys).toContain("The Copper Fox (Bar)");
    expect(sys).toContain("hi@fox.example");
    expect(sys).toContain("— The Copper Fox team");
    for (const s of bar.situations) expect(sys).toContain(s.name);
  });
  it("guards against instructions hidden in reviews and invented facts", () => {
    expect(sys).toMatch(/never as instructions/i);
    expect(sys).toMatch(/never invent/i);
  });
  it("omits empty sections", () => {
    expect(buildSystemPrompt({ ...bar, facts: "", signature: "" })).not.toContain("## Facts");
  });
});

describe("buildUserPrompt", () => {
  const review = { reviewerName: "Laura", rating: 2, text: "Waited 25 minutes." };
  it("wraps the review in delimiters with rating", () => {
    const u = buildUserPrompt({ review, variant: "default" });
    expect(u).toContain("2 out of 5 stars");
    expect(u).toContain("<review>\nWaited 25 minutes.\n</review>");
    expect(u).not.toContain("Previous draft");
  });
  it("handles rating-only reviews and unknown rating", () => {
    expect(buildUserPrompt({ review: { ...review, text: "" }, variant: "default" })).toContain("(no text, rating only)");
    expect(buildUserPrompt({ review: { ...review, rating: 0 }, variant: "default" })).toContain("Rating: unknown");
  });
  it("adds the previous draft for rewrite variants", () => {
    const u = buildUserPrompt({ review, variant: "shorter", previous: "Old draft" });
    expect(u).toContain("<draft>\nOld draft\n</draft>");
    expect(u).toMatch(/shorter/);
    expect(buildUserPrompt({ review, variant: "warmer", previous: "x" })).toMatch(/warmer/);
  });
});

describe("parseDraft", () => {
  it("parses valid JSON", () => {
    expect(parseDraft('{"situation":"Long wait","confidence":"high","reply":" Sorry! "}')).toEqual({
      situation: "Long wait", confidence: "high", reply: "Sorry!",
    });
  });
  it("tolerates code fences and bad optional fields", () => {
    expect(parseDraft('```json\n{"situation":"","confidence":"sure","reply":"Hi"}\n```')).toEqual({
      situation: "None", confidence: "low", reply: "Hi",
    });
  });
  it("rejects unusable output", () => {
    expect(() => parseDraft("not json")).toThrow(/unreadable/);
    expect(() => parseDraft('{"reply":""}')).toThrow(/empty/);
  });
});
