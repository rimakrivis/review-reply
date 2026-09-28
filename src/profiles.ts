import type { Profile, Situation, UrgentTopic } from "./types";
import { TEMPLATES } from "./templates";

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function profileFromTemplate(key: string, businessName = ""): Profile {
  const t = TEMPLATES.find((x) => x.key === key) ?? TEMPLATES[TEMPLATES.length - 1];
  const p = structuredClone(t.profile);
  return { ...p, id: newId(), businessName };
}

export function emptySituation(): Situation {
  return { id: newId(), name: "New situation", recognize: "", respond: "", avoid: "", example: "" };
}

export function emptyUrgentTopic(): UrgentTopic {
  return { id: newId(), name: "New topic", description: "" };
}

export const DEFAULT_REPORT_LANGUAGE = "English";

/** Fills in fields that profiles saved by older versions don't have yet. */
export function normalizeProfile(p: Profile): Profile {
  return {
    ...p,
    urgentTopics: Array.isArray(p.urgentTopics) ? p.urgentTopics : [],
    reportLanguage: p.reportLanguage || DEFAULT_REPORT_LANGUAGE,
  };
}

function str(v: unknown, field: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new Error(`"${field}" must be text.`);
  return v;
}

/**
 * Validates untrusted JSON (from an imported file) and returns a clean Profile with a fresh id.
 * Throws an Error with a readable message when the file is not a valid profile.
 */
export function parseProfileJson(json: string): Profile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The file does not contain a business profile.");
  }
  const d = data as Record<string, unknown>;
  const businessName = str(d.businessName, "businessName");
  if (!businessName.trim()) throw new Error("The profile has no business name.");
  if (d.situations !== undefined && !Array.isArray(d.situations)) {
    throw new Error('"situations" must be a list.');
  }
  const situations = ((d.situations as unknown[]) ?? []).map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Situation ${i + 1} is not valid.`);
    const x = raw as Record<string, unknown>;
    return {
      id: newId(),
      name: str(x.name, `situations[${i}].name`) || `Situation ${i + 1}`,
      recognize: str(x.recognize, `situations[${i}].recognize`),
      respond: str(x.respond, `situations[${i}].respond`),
      avoid: str(x.avoid, `situations[${i}].avoid`),
      example: str(x.example, `situations[${i}].example`),
    };
  });
  if (d.urgentTopics !== undefined && !Array.isArray(d.urgentTopics)) {
    throw new Error('"urgentTopics" must be a list.');
  }
  const urgentTopics = ((d.urgentTopics as unknown[]) ?? []).map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`Urgent topic ${i + 1} is not valid.`);
    const x = raw as Record<string, unknown>;
    return {
      id: newId(),
      name: str(x.name, `urgentTopics[${i}].name`) || `Topic ${i + 1}`,
      description: str(x.description, `urgentTopics[${i}].description`),
    };
  });
  return {
    id: newId(),
    businessName,
    businessType: str(d.businessType, "businessType"),
    signature: str(d.signature, "signature"),
    tone: str(d.tone, "tone"),
    facts: str(d.facts, "facts"),
    rules: str(d.rules, "rules"),
    situations,
    urgentTopics,
    reportLanguage: str(d.reportLanguage, "reportLanguage") || DEFAULT_REPORT_LANGUAGE,
  };
}

/** JSON for export. Ids are dropped because they are regenerated on import. */
export function profileToJson(p: Profile): string {
  const { id: _id, situations, urgentTopics, ...rest } = p;
  return JSON.stringify(
    {
      ...rest,
      situations: situations.map(({ id: _sid, ...s }) => s),
      urgentTopics: urgentTopics.map(({ id: _tid, ...t }) => t),
    },
    null,
    2,
  );
}
