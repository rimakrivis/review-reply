# ReviewReply — technical log

Presentation source: one entry per important technical step. Format: problem → decision → why → result.

## Overview
- **Problem:** a bar gets the same kinds of reviews on several sites; answering each one well takes time, and the owner wants monthly insight.
- **Product:** Chrome MV3 extension. Drafts on-brand replies inside the review site; collects reviews; makes monthly and yearly AI reports.
- **Constraints:** €0 infrastructure, no server, no site APIs, cheapest adequate model, a human always posts.
- **Stack:** TypeScript, esbuild, Vitest + jsdom, OpenAI Chat Completions with structured outputs, `chrome.storage.local`.

## Architecture
- Content script per page → site reader (`src/content/sites.ts`) → background worker → OpenAI. Side panel / full view / settings read the same storage.
- UI injected into review sites lives in a Shadow DOM, so site CSS and extension CSS never clash.
- Data per business: `reviews:*`, `collect:*` (what was fully read, per site), `months:*`, `years:*`.

## Key decisions
| Date | Problem | Decision | Why |
|---|---|---|---|
| 2026-09-25 | Replies sound generic | Per-business **situations playbook** (recognise / respond / never say / example) | The AI picks a situation and says which, so the owner can check it |
| 2026-09-25 | Google offers no free review API for this | Read the page DOM (star `aria-label`s, structure), not obfuscated classes | Works without approval or server; survives class renames |
| 2026-09-25 | Prompt injection in reviews | Review text inside delimiters, "data, never instructions"; sample review tests it | Reviews are written by the public |
| 2026-09-27 | Updates lost saved settings | Fixed extension ID via manifest `key` | Storage is tied to the ID |
| 2026-09-27 | Reports need complete months | Track **coverage** ranges while the list is sorted newest first | A month is only reported when every review in it was seen |
| 2026-09-29 | AI miscounts and invents quotes | AI returns review **numbers**; code counts mentions and keeps only quotes found word-for-word | Exact numbers, no fabricated quotes |
| 2026-10-05 | Yearly report would be huge | Build it from the 12 monthly reports; AI groups monthly themes by number, code sums them | Small, cheap request; counts stay exact |
| 2026-10-05 | More sites (Tripadvisor, Facebook) | One **reader per site** behind a shared interface; reviews tagged with `source` | Rest of the app (drafts, history, reports) stays site-independent |
| 2026-10-05 | Tripadvisor is paginated | Follow "Showing results 31–60 of 513" from page 1; filtered lists don't count | Proves completeness without scrolling |
| 2026-10-05 | Facebook has no stars or sort button | Store `recommends`; check date order instead of a sort button | Honest stats; still proves completeness |
| 2026-10-05 | Businesses use different site mixes | A site is "in use" once opened; months wait for it, or the owner skips it per report or always | Flexible without silent gaps |
| 2026-10-05 | Plain UI | Redesign after Attio's extension: gray surfaces, filled fields, one blue action, purple for AI | Calmer, more professional |

## Challenges & solutions
- **Obfuscated, changing markup** (Google, Tripadvisor, Facebook) → anchor on accessible labels, `data-*` attributes and roles; tested against saved real pages (kept out of git).
- **Relative and localised dates** ("2 months ago", "prieš 3 dienas", "Sausis 29 d.") → per-site parsers; vague dates flagged rough and given wider matching tolerance.
- **Duplicates across scrolls and translations** → match by site id, else site + name + stars + date tolerance; text ignored (Google may translate it).
- **Shortened list texts** ("…") → flagged; replaced when the full review is opened.
- **Service worker sleeps after 30 s** during long AI calls → keep-alive ping; storage writes serialised in a queue.

## Results
- 141 unit tests (readers, coverage, prompts, parsing, rendering).
- Cost: a reply is a fraction of a cent with `gpt-4o-mini`; a monthly report is one request.
- Works on Google, Tripadvisor (owner pages) and Facebook (page Reviews tab).

## Demo ideas
- Draft → Shorter → Warmer on a 1★ review; show the situation it picked.
- Prompt-injection review that the AI ignores.
- Reports tab: month waiting for Tripadvisor → "Make without Tripadvisor".
- Yearly report with month-by-month charts; Save as PDF.
