import { describe, expect, it } from "vitest";
import { parseProfileJson, profileFromTemplate, profileToJson } from "../src/profiles";
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
    const strip = (x: typeof p) => ({ ...x, id: "", situations: x.situations.map((s) => ({ ...s, id: "" })) });
    expect(strip(back)).toEqual(strip(p));
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
