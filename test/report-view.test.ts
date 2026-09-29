// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { statsFor } from "../src/archive";
import { renderMonthReport, signed } from "../src/report-view";
import type { MonthEntry } from "../src/types";

const ratings = (...r: number[]) => statsFor(r.map((rating) => ({ rating })));

const august: MonthEntry = {
  month: "2026-08",
  stats: ratings(5, 5, 4, 1),
  report: {
    overview: "A good month.",
    urgent: [{ topic: "Drink spiking", what: "A guest felt drugged.", reviewers: ["Anna · 12 Aug · 1★"] }],
    praise: [{ theme: "Cocktails", mentions: 3, details: "Espresso martini", quotes: ["Best in town"] }],
    complaints: [{ theme: "<img src=x onerror=alert(1)>", mentions: 1, details: "", quotes: [] }],
    changes: ["Fewer complaints about waiting."],
    suggestions: ["Add a second bartender on Fridays."],
  },
  createdAt: new Date(2026, 8, 1).getTime(),
  opened: false,
};
const july: MonthEntry = { month: "2026-07", stats: ratings(5, 3, 1), report: null, createdAt: 0, opened: true };

describe("renderMonthReport", () => {
  it("shows the numbers, then urgent items first, then the other sections", () => {
    const root = document.createElement("div");
    renderMonthReport(root, august, july);
    expect(root.querySelector(".report-title")!.textContent).toBe("August 2026 report");
    expect(root.querySelector(".tile-value")!.textContent).toBe("4");
    expect(root.querySelector(".delta")!.textContent).toBe("▲ +1");
    const titles = Array.from(root.querySelectorAll("h3")).map((h) => h.textContent);
    expect(titles).toEqual(["🚨 Urgent", "Overview", "👍 Praised", "👎 Complaints", "📈 Changes since last month", "💡 Suggestions"]);
    expect(root.textContent).toContain("Anna · 12 Aug · 1★");
    expect(root.textContent).toContain("3 of 4 reviews");
  });
  it("shows AI text as plain text, never as HTML", () => {
    const root = document.createElement("div");
    renderMonthReport(root, august);
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
  it("explains a month without reviews", () => {
    const root = document.createElement("div");
    renderMonthReport(root, { ...august, stats: statsFor([]), report: null });
    expect(root.textContent).toContain("No reviews this month");
  });
  it("formats changes with a real minus sign", () => {
    expect([signed(3), signed(-2), signed(0), signed(0.25, 1)]).toEqual(["+3", "−2", "±0", "+0.3"]);
  });
});
