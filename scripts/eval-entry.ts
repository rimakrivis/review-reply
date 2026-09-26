// Runs sample reviews through one or more OpenAI models so replies and cost can be compared.
import { readFileSync, writeFileSync } from "node:fs";
import { OpenAIProvider } from "../src/ai/openai";
import { buildPrompt } from "../src/prompt";
import { parseProfileJson, profileFromTemplate } from "../src/profiles";
import type { Profile, Review } from "../src/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const key = process.env.OPENAI_API_KEY ?? "";
if (!key) {
  console.error("Set OPENAI_API_KEY first, e.g.\n  OPENAI_API_KEY=sk-... npm run eval -- --models gpt-4o-mini,gpt-4.1-nano");
  process.exit(1);
}
const models = (arg("models") ?? "gpt-4o-mini").split(",").map((m) => m.trim()).filter(Boolean);
const reviews: Review[] = JSON.parse(readFileSync(arg("reviews") ?? "test/fixtures/sample-reviews.json", "utf8"));
const profilePath = arg("profile");
const profile: Profile = profilePath
  ? parseProfileJson(readFileSync(profilePath, "utf8"))
  : {
      ...profileFromTemplate("bar", "The Copper Fox"),
      signature: "— The Copper Fox team",
      facts: "Complaints and lost property: hello@copperfox.example\nHappy hour Wed-Fri 18:00-20:00",
    };

const lines: string[] = [`# Eval: ${profile.businessName}`, "", `Models: ${models.join(", ")}`, ""];
for (const [i, review] of reviews.entries()) {
  lines.push(`## ${i + 1}. ${review.reviewerName}, ${review.rating}★`, "", `> ${review.text || "(rating only)"}`, "");
  for (const model of models) {
    const started = Date.now();
    try {
      const r = await new OpenAIProvider(key, model).draft(buildPrompt(profile, { review, variant: "default" }));
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      lines.push(`**${model}** · ${r.situation} (${r.confidence}) · ${secs}s`, "", r.reply, "");
      console.log(`✓ ${model} #${i + 1} ${secs}s ${r.situation}`);
    } catch (e) {
      lines.push(`**${model}** · ERROR: ${e instanceof Error ? e.message : e}`, "");
      console.log(`✗ ${model} #${i + 1} ${e instanceof Error ? e.message : e}`);
    }
  }
}
const out = arg("out") ?? "eval-results.md";
writeFileSync(out, lines.join("\n"));
console.log(`\nWrote ${out}`);
