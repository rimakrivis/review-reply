import { compareStats } from "./archive";
import { monthName } from "./report-prompt";
import { SOURCE_NAMES, type MonthEntry, type ReportTheme, type Source, type Stats, type StatsBySource, type YearEntry, type YearTheme } from "./types";
import { monthRange } from "./year-report";

/**
 * Draws monthly and yearly reports. Shared by the side panel and the full view.
 * Every text is set with textContent, never innerHTML, so text from reviews or the AI can never run as code.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** "+7", "−3" or "±0", with a real minus sign. */
export function signed(n: number, decimals = 0): string {
  const abs = Math.abs(n).toFixed(decimals);
  return n > 0 ? `+${abs}` : n < 0 ? `−${abs}` : `±${abs}`;
}

/** A small "▲ +0.3" / "▼ −2" label. Green when the change is good. */
function change(diff: number, decimals = 0): HTMLElement {
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "";
  const kind = diff > 0 ? "up" : diff < 0 ? "down" : "same";
  return el("span", `delta ${kind}`, `${arrow} ${signed(diff, decimals)}`.trim());
}

function tile(label: string, value: string, diff?: HTMLElement): HTMLElement {
  const box = el("div", "tile");
  box.append(el("div", "tile-label", label), el("div", "tile-value", value));
  if (diff) box.append(diff);
  return box;
}

function section(title: string, className = ""): HTMLElement {
  const box = el("section", `report-section ${className}`.trim());
  box.append(el("h3", "", title));
  return box;
}

function bulletList(items: string[]): HTMLElement {
  const ul = el("ul");
  for (const x of items) ul.append(el("li", "", x));
  return ul;
}

function themeList(themes: (ReportTheme | YearTheme)[], total: number): HTMLElement {
  const box = el("div", "themes");
  for (const t of themes) {
    const item = el("div", "theme");
    const head = el("div", "theme-head");
    head.append(el("b", "", t.theme));
    if (t.mentions) head.append(el("span", "muted", ` · ${t.mentions} of ${total} reviews`));
    if ("months" in t) head.append(el("span", "muted", ` · ${t.months} ${t.months === 1 ? "month" : "months"}`));
    item.append(head);
    if (t.details) item.append(el("p", "", t.details));
    for (const q of t.quotes) item.append(el("blockquote", "", `“${q}”`));
    box.append(item);
  }
  return box;
}

/** Review count and average tiles, then one bar per star level. `previous` adds ▲▼ changes. */
function numbers(stats: Stats, previous?: Stats): HTMLElement[] {
  const diff = previous ? compareStats(stats, previous) : undefined;
  const tiles = el("div", "tiles");
  tiles.append(
    tile("Reviews", String(stats.count), diff && change(diff.count)),
    tile("Average", stats.average ? `${stats.average.toFixed(1)} ★` : "–", diff && previous!.average ? change(diff.average, 1) : undefined),
  );
  if (stats.recommend) {
    const share = recommendShare(stats.recommend);
    const before = previous?.recommend && recommendShare(previous.recommend);
    tiles.append(tile("Recommend", `${share} %`, before !== undefined ? change(share - before) : undefined));
  }
  const most = Math.max(1, ...stats.stars);
  const starBox = el("div", "stars");
  for (let n = 5; n >= 1; n--) {
    const row = el("div", "star-row");
    row.append(el("span", "star-label", `${n}★`), bar(stats.stars[n - 1] / most), el("span", "star-count", String(stats.stars[n - 1])));
    if (diff) row.append(el("span", "muted star-diff", signed(diff.stars[n - 1])));
    starBox.append(row);
  }
  return [tiles, starBox];
}

/** Share of Facebook reviewers who recommend, in whole percent. */
function recommendShare([yes, no]: [number, number]): number {
  return Math.round((yes / Math.max(1, yes + no)) * 100);
}

/** A horizontal bar filled to `share` (0 to 1). */
function bar(share: number): HTMLElement {
  const box = el("div", "bar");
  const fill = el("div", "bar-fill");
  fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  box.append(fill);
  return box;
}

/** "Google 30 reviews · 4.2 ★ — Tripadvisor 12 reviews · 3.9 ★", only when more than one site had reviews. */
function bySourceLine(by: StatsBySource | undefined): HTMLElement[] {
  const sites = Object.entries(by ?? {}) as [Source, Stats][];
  if (sites.length < 2) return [];
  const text = sites
    .map(([s, st]) => {
      const score = st.average ? ` · ${st.average.toFixed(1)} ★` : st.recommend ? ` · ${recommendShare(st.recommend)} % recommend` : "";
      return `${SOURCE_NAMES[s]} ${st.count} review${st.count === 1 ? "" : "s"}${score}`;
    })
    .join(" — ");
  return [el("p", "small by-site", `By site: ${text}`)];
}

function footer(createdAt: number, what: string): HTMLElement {
  const made = new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return el("p", "muted small report-foot", `Made ${made}. Numbers are counted exactly; the text is written by AI from ${what}.`);
}

/** Fills `root` with the report. `previous` is last month's entry, used for the ▲▼ comparisons. */
export function renderMonthReport(root: HTMLElement, entry: MonthEntry, previous?: MonthEntry): void {
  const { stats, report } = entry;
  const out: HTMLElement[] = [];

  out.push(el("h2", "report-title", `${monthName(entry.month)} report`));
  out.push(...numbers(stats, previous?.stats), ...bySourceLine(entry.bySource));
  if (entry.skipped?.length) {
    out.push(el("p", "muted small", `Made without ${entry.skipped.map((s) => SOURCE_NAMES[s]).join(" and ")}.`));
  }
  if (previous) out.push(el("p", "muted small", `Compared with ${monthName(previous.month)}.`));

  if (!report) {
    out.push(el("p", "", "No reviews this month, so there is nothing to summarise."));
  } else {
    if (report.urgent.length) {
      const box = section("🚨 Urgent", "urgent");
      for (const u of report.urgent) {
        const item = el("div", "urgent-item");
        item.append(el("b", "", u.topic), el("p", "", u.what));
        if (u.reviewers.length) item.append(el("p", "muted small", u.reviewers.join(" · ")));
        box.append(item);
      }
      out.push(box);
    }
    out.push(...writtenSections(report, stats.count, "📈 Changes since last month"));
  }

  out.push(footer(entry.createdAt, "the reviews"));
  root.replaceChildren(...out);
}

/** Overview, praise, complaints, changes and suggestions. */
function writtenSections(
  report: { overview: string; praise: (ReportTheme | YearTheme)[]; complaints: (ReportTheme | YearTheme)[]; changes: string[]; suggestions: string[] },
  total: number,
  changesTitle: string,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (report.overview) {
    const box = section("Overview");
    box.append(el("p", "", report.overview));
    out.push(box);
  }
  if (report.praise.length) {
    const box = section("👍 Praised");
    box.append(themeList(report.praise, total));
    out.push(box);
  }
  if (report.complaints.length) {
    const box = section("👎 Complaints");
    box.append(themeList(report.complaints, total));
    out.push(box);
  }
  if (report.changes.length) {
    const box = section(changesTitle);
    box.append(bulletList(report.changes));
    out.push(box);
  }
  if (report.suggestions.length) {
    const box = section("💡 Suggestions");
    box.append(bulletList(report.suggestions));
    out.push(box);
  }
  return out;
}

/** Every month from `first` to `last`, e.g. "2026-01" … "2026-09". */
function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  for (let key = first; key <= last; key = `${y}-${String(m).padStart(2, "0")}`) {
    out.push(key);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/**
 * One small bar chart: a row per month with a short label, a bar and the value. Months without a report show "–".
 * Bars start at zero, so their lengths compare honestly.
 * Hovering a row shows the month's full numbers.
 */
function monthChart(
  title: string,
  keys: string[],
  months: Record<string, MonthEntry>,
  value: (s: Stats) => number,
  max: number,
  format: (n: number) => string,
): HTMLElement {
  const box = el("figure", "month-chart");
  box.append(el("figcaption", "", title));
  for (const key of keys) {
    const s = months[key]?.stats;
    const row = el("div", "chart-row");
    const label = new Date(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 1).toLocaleDateString("en", { month: "short" });
    row.title = s
      ? `${monthName(key)}: ${s.count} review${s.count === 1 ? "" : "s"}${s.average ? `, average ${s.average.toFixed(1)} ★` : ""}`
      : `${monthName(key)}: no report`;
    row.append(el("span", "chart-label", label), bar(s ? value(s) / max : 0), el("span", "chart-value", s ? format(value(s)) : "–"));
    box.append(row);
  }
  return box;
}

/**
 * Fills `root` with a yearly report. `months` are the business's monthly entries, used for the month-by-month
 * charts; `previous` is last year's entry, used for the ▲▼ comparisons. `outdated` adds a note that a monthly
 * report changed after this one was made.
 */
export function renderYearReport(
  root: HTMLElement,
  entry: YearEntry,
  months: Record<string, MonthEntry>,
  { previous, outdated = false }: { previous?: YearEntry; outdated?: boolean } = {},
): void {
  const { stats, report } = entry;
  const out: HTMLElement[] = [];

  out.push(el("h2", "report-title", `${entry.year} report`));
  const n = entry.months.length;
  out.push(el("p", "muted small", `Based on ${n} monthly report${n === 1 ? "" : "s"} (${n} of 12 months): ${monthRange(entry.months)}.`));
  if (outdated) {
    out.push(el("p", "notice warn small", "Some monthly reports changed after this report was made. Click Make again to update it."));
  }
  out.push(...numbers(stats, previous?.stats), ...bySourceLine(entry.bySource));
  if (previous) out.push(el("p", "muted small", `Compared with ${previous.year} (${previous.months.length} of 12 months).`));

  if (n) {
    const keys = monthsBetween(entry.months[0], entry.months[n - 1]);
    const most = Math.max(1, ...keys.map((k) => months[k]?.stats.count ?? 0));
    const charts = section("📅 Month by month");
    const pair = el("div", "chart-pair");
    pair.append(
      monthChart("Reviews per month", keys, months, (s) => s.count, most, String),
      monthChart("Average stars per month", keys, months, (s) => s.average, 5, (v) => (v ? `${v.toFixed(1)} ★` : "–")),
    );
    charts.append(pair);
    out.push(charts);
  }

  if (!report) {
    out.push(el("p", "", "No reviews in these months, so there is nothing to summarise."));
  } else {
    if (report.urgent.length) {
      const box = section(`🚨 Urgent during the year (${report.urgent.length})`, "urgent");
      for (const u of report.urgent) {
        const item = el("div", "urgent-item");
        item.append(el("b", "", `${monthName(u.month)} · ${u.topic}`), el("p", "", u.what));
        if (u.reviewers.length) item.append(el("p", "muted small", u.reviewers.join(" · ")));
        box.append(item);
      }
      out.push(box);
    }
    out.push(...writtenSections(report, stats.count, previous ? `📈 Changes during the year and since ${previous.year}` : "📈 Changes during the year"));
  }

  out.push(footer(entry.createdAt, "the monthly reports"));
  root.replaceChildren(...out);
}
