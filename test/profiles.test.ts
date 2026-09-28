import { describe, expect, it } from "vitest";
import { normalizeProfile, parseProfileJson, profileFromTemplate, profileToJson } from "../src/profiles";
import { TEMPLATES } from "../src/templates";

describe("templates", () => {
  it("every template has rules, tone and uniquely named situations", () => {
    for (const t of TEMPLATES) {
      const p = profileFromTemplate(t.key, "X");
      expect(p.rules.length).toBeGreaterThan(50);
      expect(p.tone).not.toBe("");
      const names = p.situations.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it("every template has uniquely named urgent topics and English reports", () => {
    for (const t of TEMPLATES) {
      const p = profileFromTemplate(t.key, "X");
      expect(p.reportLanguage).toBe("English");
      expect(p.urgentTopics.length).toBeGreaterThanOrEqual(5);
      expect(p.urgentTopics.every((u) => u.name && u.description)).toBe(true);
      const names = p.urgentTopics.map((u) => u.name);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(profileFromTemplate("bar").urgentTopics.map((u) => u.name)).toContain("Drink spiking");
  });
  it("creates independent copies", () => {
    const a = profileFromTemplate("bar");
    const b = profileFromTemplate("bar");
    a.situations[0].name = "changed";
    expect(b.situations[0].name).not.toBe("changed");
    expect(a.id).not.toBe(b.id);
  });
});

describe("import / export", () => {
  it("round-trips a profile with fresh ids", () => {
    const p = profileFromTemplate("restaurant", "Luna");
    const back = parseProfileJson(profileToJson(p));
    expect(back.id).not.toBe(p.id);
    const strip = (x: typeof p) => ({
      ...x,
      id: "",
      situations: x.situations.map((s) => ({ ...s, id: "" })),
      urgentTopics: x.urgentTopics.map((u) => ({ ...u, id: "" })),
    });
    expect(strip(back)).toEqual(strip(p));
    expect(back.urgentTopics.length).toBeGreaterThan(0);
    expect(back.urgentTopics[0].id).not.toBe(p.urgentTopics[0].id);
  });
  it("leaves topic ids out of the exported file", () => {
    const json = JSON.parse(profileToJson(profileFromTemplate("bar", "Luna")));
    expect(json.urgentTopics[0]).not.toHaveProperty("id");
  });
  it("imports an old file without urgent topics or report language", () => {
    const p = parseProfileJson('{"businessName":"Old bar","situations":[]}');
    expect(p.urgentTopics).toEqual([]);
    expect(p.reportLanguage).toBe("English");
  });
  it("keeps a custom report language and rejects bad topics", () => {
    const p = parseProfileJson('{"businessName":"A","reportLanguage":"Lithuanian","urgentTopics":[{"description":"x"}]}');
    expect(p.reportLanguage).toBe("Lithuanian");
    expect(p.urgentTopics[0]).toMatchObject({ name: "Topic 1", description: "x" });
    expect(() => parseProfileJson('{"businessName":"A","urgentTopics":"hygiene"}')).toThrow(/list/);
    expect(() => parseProfileJson('{"businessName":"A","urgentTopics":[{"name":5}]}')).toThrow(/urgentTopics/);
  });
  it("rejects bad files with readable messages", () => {
    expect(() => parseProfileJson("{oops")).toThrow(/not valid JSON/);
    expect(() => parseProfileJson("[]")).toThrow(/does not contain/);
    expect(() => parseProfileJson('{"businessName":""}')).toThrow(/no business name/);
    expect(() => parseProfileJson('{"businessName":"A","situations":{}}')).toThrow(/list/);
    expect(() => parseProfileJson('{"businessName":"A","tone":5}')).toThrow(/tone/);
  });
  it("fills in missing optional fields", () => {
    const p = parseProfileJson('{"businessName":"A","situations":[{"respond":"x"}]}');
    expect(p.situations[0]).toMatchObject({ name: "Situation 1", respond: "x", avoid: "" });
    expect(p.rules).toBe("");
  });
});

describe("normalizeProfile", () => {
  it("fills in fields missing from profiles saved by older versions", () => {
    const { urgentTopics: _u, reportLanguage: _l, ...old } = profileFromTemplate("bar", "Old");
    const p = normalizeProfile(old as never);
    expect(p.urgentTopics).toEqual([]);
    expect(p.reportLanguage).toBe("English");
    expect(p.businessName).toBe("Old");
  });
  it("keeps fields that are already there", () => {
    const p = { ...profileFromTemplate("hotel"), reportLanguage: "German" };
    expect(normalizeProfile(p)).toEqual(p);
  });
});
