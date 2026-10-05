// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { statsFor } from "../src/archive";
import { renderMonthReport, renderYearReport, signed } from "../src/report-view";
import type { MonthEntry, YearEntry } from "../src/types";

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
  it("shows numbers per site and which sites were left out", () => {
    const root = document.createElement("div");
    renderMonthReport(root, {
      ...august,
      bySource: { google: ratings(5, 5, 4), tripadvisor: ratings(1) },
      skipped: ["facebook"],
    });
    expect(root.querySelector(".by-site")!.textContent).toBe("By site: Google 3 reviews · 4.7 ★ — Tripadvisor 1 review · 1.0 ★");
    expect(root.textContent).toContain("Made without Facebook.");
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

describe("renderYearReport", () => {
  const months = { "2026-07": july, "2026-08": august };
  const year: YearEntry = {
    year: "2026",
    months: ["2026-07", "2026-08"],
    stats: ratings(5, 3, 1, 5, 5, 4, 1),
    report: {
      overview: "A mixed summer.",
      urgent: [{ ...august.report!.urgent[0], month: "2026-08" }],
      praise: [{ theme: "Cocktails", mentions: 5, months: 2, details: "", quotes: [] }],
      complaints: [],
      changes: ["Fewer complaints in August."],
      suggestions: ["Keep the cocktail menu."],
    },
    createdAt: new Date(2026, 9, 1).getTime(),
    opened: false,
  };

  it("shows coverage, month-by-month charts, urgent items with their month, then the written sections", () => {
    const root = document.createElement("div");
    renderYearReport(root, year, months);
    expect(root.querySelector(".report-title")!.textContent).toBe("2026 report");
    expect(root.textContent).toContain("Based on 2 monthly reports (2 of 12 months): July – August 2026.");
    const titles = Array.from(root.querySelectorAll("h3")).map((h) => h.textContent);
    expect(titles).toEqual(["📅 Month by month", "🚨 Urgent during the year (1)", "Overview", "👍 Praised", "📈 Changes during the year", "💡 Suggestions"]);
    const charts = root.querySelectorAll(".month-chart");
    expect(charts).toHaveLength(2);
    const values = (i: number) => Array.from(charts[i].querySelectorAll(".chart-value")).map((v) => v.textContent);
    expect(values(0)).toEqual(["3", "4"]);
    expect(values(1)).toEqual(["3.0 ★", "3.8 ★"]);
    expect(root.textContent).toContain("August 2026 · Drink spiking");
    expect(root.textContent).toContain("5 of 7 reviews · 2 months");
    expect(root.querySelector(".notice")).toBeNull();
  });
  it("shows gaps between months and warns when the report is outdated", () => {
    const root = document.createElement("div");
    const withGap = { ...year, months: ["2026-06", "2026-08"] };
    renderYearReport(root, withGap, { "2026-06": { ...july, month: "2026-06" }, "2026-08": august }, { outdated: true });
    const labels = Array.from(root.querySelectorAll(".month-chart:first-of-type .chart-row")).map((r) => r.textContent);
    expect(labels).toEqual(["Jun3", "Jul–", "Aug4"]);
    expect(root.querySelector(".notice")!.textContent).toMatch(/Make again/);
  });
  it("compares with last year", () => {
    const root = document.createElement("div");
    renderYearReport(root, year, months, { previous: { ...year, year: "2025", stats: ratings(5, 5), report: null } });
    expect(root.textContent).toContain("Compared with 2025 (2 of 12 months).");
    expect(root.querySelector(".delta")!.textContent).toBe("▲ +5");
    expect(root.textContent).toContain("📈 Changes during the year and since 2025");
  });
});
