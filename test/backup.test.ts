import { describe, expect, it } from "vitest";
import { backupFileName, buildBackup, describeBackup, parseBackup, restoreChanges } from "../src/backup";
import { profileFromTemplate } from "../src/profiles";

const profile = { ...profileFromTemplate("restaurant", "Lost in Amsterdam"), id: "p1" };

function stored(): Record<string, unknown> {
  return {
    settings: { apiKey: "sk-secret", model: "gpt-4o-mini", activeProfileId: "p1", profiles: [profile], showLauncher: true },
    "reviews:p1": [{ reviewerName: "Anna", rating: 5, text: "Great", date: 1, firstSeenAt: 1 }],
    "collect:p1": { lastCollectedAt: 5, coverage: [[0, 5]] },
    "months:p1": {
      "2026-08": { month: "2026-08", stats: {}, report: { overview: "ok" }, createdAt: 1, opened: true },
      "2026-07": { month: "2026-07", stats: {}, report: null, createdAt: 1, opened: false },
    },
    launcherPos: { x: 1, y: 2 },
  };
}

describe("backup", () => {
  it("round-trips settings and archive keys, leaving out other keys", () => {
    const b = buildBackup(stored(), { includeApiKey: true, now: Date.UTC(2026, 8, 29) });
    const back = parseBackup(JSON.stringify(b));
    expect(back.settings.apiKey).toBe("sk-secret");
    expect(back.settings.profiles[0].businessName).toBe("Lost in Amsterdam");
    expect(back.settings.profiles[0].id).toBe("p1"); // ids are kept so the archive keys still match
    expect(Object.keys(back.data).sort()).toEqual(["collect:p1", "months:p1", "reviews:p1"]);
    expect(back.exportedAt).toBe("2026-09-29T00:00:00.000Z");
    expect(describeBackup(back)).toBe("1 business, 1 reviews, 1 monthly reports");
  });

  it("leaves the API key out unless asked", () => {
    const b = buildBackup(stored(), { includeApiKey: false });
    expect(b.settings.apiKey).toBe("");
    expect(JSON.stringify(b)).not.toContain("sk-secret");
  });

  it("keeps this browser's API key when the file has none", () => {
    const b = parseBackup(JSON.stringify(buildBackup(stored(), { includeApiKey: false })));
    const now = { settings: { apiKey: "sk-mine", profiles: [] } };
    const { set } = restoreChanges(now, b);
    expect((set.settings as { apiKey: string }).apiKey).toBe("sk-mine");
  });

  it("removes archive keys the file doesn't have, and nothing else", () => {
    const b = parseBackup(JSON.stringify(buildBackup(stored(), { includeApiKey: true })));
    const now = { ...stored(), "reviews:old": [], "months:old": {}, leftTipDismissed: true };
    const { set, remove } = restoreChanges(now, b);
    expect(remove.sort()).toEqual(["months:old", "reviews:old"]);
    expect(Object.keys(set).sort()).toEqual(["collect:p1", "months:p1", "reviews:p1", "settings"]);
  });

  it("fills in fields that older versions didn't save", () => {
    const old = buildBackup(stored(), { includeApiKey: false });
    const { urgentTopics: _u, reportLanguage: _r, ...oldProfile } = profile;
    old.settings.profiles = [oldProfile as typeof profile];
    const back = parseBackup(JSON.stringify(old));
    expect(back.settings.profiles[0].urgentTopics).toEqual([]);
    expect(back.settings.profiles[0].reportLanguage).toBe("English");
  });

  it("rejects files that are not a valid backup", () => {
    const good = buildBackup(stored(), { includeApiKey: false });
    const bad = (change: (b: any) => void) => {
      const b = structuredClone(good) as any;
      change(b);
      return () => parseBackup(JSON.stringify(b));
    };
    expect(() => parseBackup("not json")).toThrow("not valid JSON");
    expect(() => parseBackup(JSON.stringify(profile))).toThrow("not a ReviewReply backup");
    expect(bad((b) => (b.format = 2))).toThrow("newer version");
    expect(bad((b) => delete b.settings)).toThrow("no settings");
    expect(bad((b) => (b.settings.profiles = [{ businessName: "X" }]))).toThrow("profile 1 is not valid");
    expect(bad((b) => (b.settings.apiKey = 5))).toThrow("settings.apiKey");
    expect(bad((b) => delete b.data)).toThrow("no review data");
    expect(bad((b) => (b.data["reviews:p1"] = "oops"))).toThrow('"reviews:p1" is not valid');
  });

  it("ignores unknown keys inside data", () => {
    const b = buildBackup(stored(), { includeApiKey: false }) as any;
    b.data.settings = { apiKey: "sneaky" };
    expect(Object.keys(parseBackup(JSON.stringify(b)).data)).not.toContain("settings");
  });

  it("names the file by date", () => {
    expect(backupFileName(Date.UTC(2026, 8, 29, 12))).toBe("reviewreply-backup-2026-09-29.json");
  });
});
