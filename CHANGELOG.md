# Changelog

All notable changes to ReviewReply are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-10-14

### Added
- **Yearly report.** Pick a year at the top of the report list in the **Reports** tab. It is built from that
  year's monthly reports, not from the raw reviews, so it stays small and cheap. Any missing monthly reports are made
  first. It works for an unfinished year too, and shows which months it covers.
  - Exact totals for the year, compared with last year when there is a report for it.
  - Two charts: reviews per month and average stars per month.
  - Every 🚨 urgent item of the year, with its month.
  - AI summary: overview, 👍 praise and 👎 complaint themes across the year (with how many reviews and months mention
    each, counted by code), changes during the year and suggestions.
  - A note when a monthly report was made again after the yearly one, so it can be updated.
  - **Save as PDF**, like the monthly report.
- Backups include yearly reports.
- **Tripadvisor.** The ✨ Draft reply bar, the floating ✨ button and review history work on Tripadvisor's owner
  review pages too. Shortened texts in the list are replaced by the full text once the review is opened. Pages
  opened in order from page 1, sorted by **Most recent** without filters, mark months as complete.
- **Facebook.** The ✨ Draft reply bar works in the comment box under each review, and the page's **Reviews** tab is
  collected for the review history (Facebook in English or Lithuanian). Facebook has no stars: reports count who
  recommends and show the share as its own tile.
- **Several review sites per business.** Each business uses only the sites whose reviews were opened for it: Google,
  Tripadvisor, Facebook or any mix. Each saved review remembers its site. The Review history card shows each site, and reports
  show the numbers per site.
- **Waiting for a site.** When a month is complete on one site but not yet on another, the Reports tab says which
  site to open. The owner can also **Make without** that site for one report, or **Always leave it out** for the
  business (and **Use again** later). Reports say which sites they were made without.

### Changed
- **New design** for the side panel, full view, settings, the ✨ Draft reply bar and the floating ✨ button: calm
  gray and white surfaces, filled fields, one blue main button, purple for AI. The business switcher moved into the
  top bar, and Profile / Reports became a two-part switch.
- **Business card in the side panel** shows a compact row with **Edit**. Changes are saved with **Save** (not while
  typing); **Cancel** undoes them. Switching business with unsaved changes asks first.

## [0.3.0] - 2026-09-30

### Added
- **Review history.** While Google's review list is open, ReviewReply saves every review it shows (name, stars,
  text, date, and whether you already replied), without duplicates. The list must be sorted by **Newest**. Scroll
  down to collect older months. The side panel shows how many reviews are saved and which months are complete.
- **Monthly reports** in a new **📊 Reports** tab (side panel and full view). Each report has exact counts (reviews,
  average, stars per level, compared with last month) and an AI summary: 🚨 urgent reviews, overview, 👍 praise and
  👎 complaint themes with real quotes, changes since last month and suggestions. Reports are made only for complete
  months. **Make missing reports** fills in all of them at once.
- **Save as PDF** for a report, using Chrome's own print dialog.
- **Urgent topics** in each business profile, for example violence, hygiene or discrimination. Reviews about these
  topics are listed first in the report. Templates come with starting topics.
- **Report language** in each business profile, so reports can be written in, for example, Lithuanian.
- **Backup** in Settings: **Export everything** saves all profiles, review history and reports in one file (the API
  key only if you tick the box). **Import everything…** restores it, for example on another computer. Importing
  replaces all ReviewReply data in that browser. A file without an API key keeps the key already saved there.

### Changed
- The side panel has tabs again: 🏢 Profile and 📊 Reports.

### Privacy
- Reviewer names are not sent to OpenAI when a report is made. A backup file contains your guests' reviews, so keep
  it private.

## [0.2.1] - 2026-09-27

### Changed
- The extension now has a fixed ID (`mhgdpnpekmacppmkfjoaadamkboblpgb`), set by a `key` in the manifest. Future
  updates keep your saved profiles even when the new version is unzipped into a different folder.
- **One-time step when updating to 0.2.1:** export your business profiles in Settings first and copy your API key.
  Because the ID changes this one time, Chrome starts 0.2.1 with empty settings. Import the profiles afterwards.

## [0.2.0] - 2026-09-27

### Added
- A floating ✨ button on Google review pages. It opens the side panel or the full view, can be dragged anywhere
  (the position is remembered), and can be hidden from its menu or in Settings.
- The button also appears when Google shows reviews in a pop-up window, and it recognises the Reply button in
  English, Lithuanian and German.
- The side panel now edits the business profile: name, type, signature, tone and facts. The full playbook stays in
  Settings.
- A **Full view** that opens the side panel screen in a normal, wide browser tab.
- A tip in the side panel explaining how to show it on the left side of Chrome.
- A new Settings option: "Show the ✨ button on Google review pages".

### Removed
- The Reply tab in the side panel and the right-click "Draft a reply to this review" menu. Replies are drafted
  with the ✨ Draft reply bar on the Google review page.
- The `contextMenus` permission, which is no longer needed.

## [0.1.0] - 2026-09-26

### Added
- First release: AI-drafted replies to Google reviews, business profiles with a situations playbook, templates,
  side panel, settings page and demo page.

[0.4.0]: https://github.com/rimakrivis/review-reply/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rimakrivis/review-reply/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/rimakrivis/review-reply/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rimakrivis/review-reply/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rimakrivis/review-reply/releases/tag/v0.1.0
