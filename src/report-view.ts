import { compareStats } from "./archive";
import { monthName } from "./report-prompt";
import type { MonthEntry, ReportTheme } from "./types";

/**
 * Draws a monthly report. Shared by the side panel and the full view.
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

function themeList(themes: ReportTheme[], total: number): HTMLElement {
  const box = el("div", "themes");
  for (const t of themes) {
    const item = el("div", "theme");
    const head = el("div", "theme-head");
    head.append(el("b", "", t.theme));
    if (t.mentions) head.append(el("span", "muted", ` · ${t.mentions} of ${total} reviews`));
    item.append(head);
    if (t.details) item.append(el("p", "", t.details));
    for (const q of t.quotes) item.append(el("blockquote", "", `“${q}”`));
    box.append(item);
  }
  return box;
}

/** Fills `root` with the report. `previous` is last month's entry, used for the ▲▼ comparisons. */
export function renderMonthReport(root: HTMLElement, entry: MonthEntry, previous?: MonthEntry): void {
  const { stats, report } = entry;
  const diff = previous ? compareStats(stats, previous.stats) : undefined;
  const out: HTMLElement[] = [];

  out.push(el("h2", "report-title", `${monthName(entry.month)} report`));

  const tiles = el("div", "tiles");
  tiles.append(
    tile("Reviews", String(stats.count), diff && change(diff.count)),
    tile("Average", stats.average ? `${stats.average.toFixed(1)} ★` : "–", diff && previous!.stats.average ? change(diff.average, 1) : undefined),
  );
  out.push(tiles);

  const most = Math.max(1, ...stats.stars);
  const starBox = el("div", "stars");
  for (let n = 5; n >= 1; n--) {
    const row = el("div", "star-row");
    const bar = el("div", "bar");
    const fill = el("div", "bar-fill");
    fill.style.width = `${(stats.stars[n - 1] / most) * 100}%`;
    bar.append(fill);
    row.append(el("span", "star-label", `${n}★`), bar, el("span", "star-count", String(stats.stars[n - 1])));
    if (diff) row.append(el("span", "muted star-diff", signed(diff.stars[n - 1])));
    starBox.append(row);
  }
  out.push(starBox);
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
    if (report.overview) {
      const box = section("Overview");
      box.append(el("p", "", report.overview));
      out.push(box);
    }
    if (report.praise.length) {
      const box = section("👍 Praised");
      box.append(themeList(report.praise, stats.count));
      out.push(box);
    }
    if (report.complaints.length) {
      const box = section("👎 Complaints");
      box.append(themeList(report.complaints, stats.count));
      out.push(box);
    }
    if (report.changes.length) {
      const box = section("📈 Changes since last month");
      box.append(bulletList(report.changes));
      out.push(box);
    }
    if (report.suggestions.length) {
      const box = section("💡 Suggestions");
      box.append(bulletList(report.suggestions));
      out.push(box);
    }
  }

  const made = new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  out.push(
    el("p", "muted small report-foot", `Made ${made}. Numbers are counted exactly; the text is written by AI from the reviews.`),
  );
  root.replaceChildren(...out);
}
