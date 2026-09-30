# ReviewReply roadmap

This page lists what has been built and what comes next. Features are built **one step at a time**, and each step
is discussed before it is built.

## Done

| Version | What changed |
|---|---|
| 0.1.0 | AI-drafted replies on Google review pages, business profiles, situations playbook, templates, demo page. |
| 0.2.0 | Floating ✨ button on Google review pages; side panel for editing the business profile; full view in a wide tab. The side panel's Reply tab and the right-click menu were removed. |
| 0.2.1 | Fixed extension ID, so updates keep saved settings even when the new version is in a different folder. |
| 0.3.0 | Phase 2 steps 2.1–2.3: review history, urgent topics, report language, monthly reports in a 📊 Reports tab, Save as PDF, and Export / Import everything. |

---

## Phase 2: Review reports

**Goal:** give the owner a regular report on what guests praise, what they complain about, what needs urgent
attention, and how things are changing, month by month and year by year.

### Decisions already made

- **Everything stays in the extension.** There is no server and no hosting. Reviews and reports are stored in
  Chrome's own storage (`chrome.storage.local`).
- **Monthly and yearly reports only.** There is no weekly report.
- **Reports are built in layers.** A monthly report is made from that month's reviews. A yearly report is made from
  the 12 monthly reports, not from thousands of raw reviews. This keeps each AI request small and cheap.
- **Old raw reviews are deleted** one month after their month's report is made. Exact star counts are kept forever.
  A finished month is then locked, so no review is counted twice.
- **History comes from scrolling.** The first time, the owner scrolls Google's review list back through the year, and
  the extension collects every review it sees. After that, it collects new reviews whenever the review page is open.
- **Each business defines its own urgent topics**, for example "hygiene", "violence", "drink spiking" or
  "discrimination".
- **Reports appear in the side panel** (compact) **and in the full view** (wide, with charts), and can be saved as
  **PDF**.
- **Three indicators, each with its own icon:** 🚨 urgent reviews, 💬 unanswered reviews and 📊 new report ready.

**Storage:** a year of reviews for a very busy venue is at most about 3.5 MB, well under Chrome's 10 MB limit.
Since old raw reviews are deleted, real use stays much lower.

### Steps

#### Step 2.1: Collect reviews with dates ✅ 0.3.0
- Read **every** review on the page, not only the one being replied to: name, stars, text, **date**, and whether
  the owner has already replied.
- Understand Google's dates: "3 days ago", "a month ago", "2 years ago", "Edited …", and full dates. Older reviews
  only have rough dates ("2 months ago"), so they may land in the neighbouring month.
- Save them per business, without duplicates, including reviews inside Google's pop-up window.
- Show the collection status in the side panel, for example *"Collected 214 reviews · Jan–Sep 2026 · last update
  today"*.
- **Only complete months get reports.** Google sorts by "Most relevant" by default, which mixes old and new
  reviews. The extension checks that the list is sorted by **Newest**, and tracks which months were fully scrolled
  through. For any other month it says, for example: *"Sort your Google reviews by Newest and scroll back to June
  to complete it."*
- Recognise the owner's replies ("<business> · Owner"), and leave Google's extra lines out of the review text:
  "View full review", "Service / Food / Atmosphere", price ranges, noise level and group size.

#### Step 2.2: Urgent topics in the business profile ✅ 0.3.0
- Add an **Urgent topics** list to each profile, editable in Settings (next to the situations playbook).
- Business templates come with sensible starting topics. For example, a bar gets fights, hygiene, drink spiking,
  security staff behaviour, discrimination and theft.
- Profiles exported before this change still import correctly, with an empty list.

#### Step 2.3: Monthly report and the Reports tab ✅ 0.3.0
- **Calculated exactly by code:** number of reviews, average rating, stars per level (5★ … 1★), and a comparison
  with last month, for example *"5★ +7 · 1★ −3 · average 4.1 → 4.4 ▲"*.
- **Written by the AI:**
  - a short overview
  - 🚨 urgent items matching the business's topics, shown first
  - 👍 praise and 👎 complaint themes, each with how many people mention it, details and real quotes, for example
    *"Too expensive · 14 of 38 reviews · mostly cocktails"*
  - changes since last month
  - suggested actions
- A **📊 Reports** tab in the side panel and the full view. The tabs come back, since there will be more than one
  section again.
- **Backup: Export everything / Import everything** in Settings. This is one file with all profiles, settings
  (the API key only if the owner chooses to include it), review history and reports. Import asks before replacing
  anything.

#### Step 2.4: Yearly report, charts and PDF
- The yearly report is built from the monthly reports, and compared with the previous year when it exists.
- Charts in the full view: average rating per month, reviews per month, and this month's stars against last
  month's.
- ~~Save as PDF~~: already done in 0.3.0 for monthly reports; the yearly report gets it too.

#### Step 2.5: Automatic routine
- Each day, the extension checks whether a month has ended.
  - If the owner has opened the review page since the month ended, the report is made automatically and a Chrome
    notification says *"Your March report is ready"*.
  - If not, the notification says *"Open your Google reviews so ReviewReply can finish March's report"*.
- The yearly report is made automatically in January.
- Old raw reviews are cleaned up and finished months are locked.
- Settings gets a switch to turn automatic reports on or off.

#### Step 2.6: Badges
- On the **floating ✨ button**, three separate mini badges. Clicking one goes straight to that item.
  - 🚨 number of new urgent reviews
  - 💬 number of unanswered reviews
  - 📊 a dot when a new report hasn't been opened yet
- On the **toolbar icon**, Chrome allows only one badge, so it shows the most important item: urgent first, then
  unanswered, then report ready. Hovering over the icon lists all three.
- **Urgent between reports:** new reviews from the last 14 days are checked against the urgent topics in one small,
  cheap AI request, so 🚨 updates right away instead of once a month.

---

## Phase 3: Chrome Web Store

Once reports are ready, publish the extension on the Chrome Web Store:

- **Why:** automatic updates, no Developer mode, no zip files, and Chrome stops showing warnings. This is the
  normal way business owners install extensions.
- **What it needs:**
  - a one-time $5 developer account
  - a privacy policy page (the extension handles an API key and review text)
  - store screenshots and a description
  - Google's review, which takes a few days for each version
- The extension's fixed ID can be kept in the store using the private key saved outside the project.

---

## To discuss before starting Phase 2

- ~~**Report language**~~: decided, each profile has a Report language (0.3.0).
- **Cost limit:** should Settings show roughly how much each report costs, with a monthly maximum?
- **Unanswered count:** should it include old reviews collected while scrolling back, or only new ones?
- **Several businesses:** one report per business, or also a combined overview?
