# ✨ ReviewReply

**A Chrome extension that drafts on-brand replies to Google Business reviews with AI, following each business's own playbook of situations.**

Small businesses get the same kinds of reviews again and again: a long wait at the bar, a refused entry, a wrong bill, praise for a favourite bartender. Answering each one well takes time, and generic AI replies sound generic. ReviewReply lets you describe how *your* business handles each situation once. It then drafts a reply for every review in one click, right inside Google's review page.

A human always stays in control. The extension only types a draft into the reply box. You read it, edit it, and click Google's own **Post** button.

![Draft reply injected into a review page](docs/demo.png)

## Features

- **One-click drafts on the review page.** A "✨ Draft reply" bar appears above every reply box. It also offers **Shorter**, **Warmer** and **Try again**.
- **Situations playbook.** For each recurring situation, you describe how to recognise it, how to respond and what never to say. You can add an example reply too. The AI picks the matching situation and shows you which one it used.
- **Business profiles and templates.** Keep one profile per business and switch between them. Start from a Bar, Restaurant, Café, Hotel, Beauty salon or generic template. Export and import profiles as JSON.
- **Side panel for the business.** Click the toolbar icon to switch business and make quick edits to its name, tone and facts. **⤢ Full view** opens the same screen in a normal, wide browser tab.
- **Floating ✨ button.** On Google review pages, a small button floats in the corner. It opens the side panel or the full view. Drag it to move it, or hide it from its menu or in Settings.
- **Review history and monthly reports.** While Google's review list is open (sorted by Newest), the extension saves every review it shows. The **📊 Reports** tab turns each complete month into a report: exact star counts compared with last month, plus an AI summary of 🚨 urgent reviews, praise, complaints with real quotes, changes and suggestions. Reports can be saved as PDF and written in the business's own language.
- **Urgent topics.** Each business lists what must never be missed, such as violence or hygiene. Matching reviews appear first in the report.
- **Backup.** **Export everything** saves all profiles, review history and reports in one file. **Import everything…** restores it on another computer.
- **Safe by default.** Built-in rules stop the AI from admitting liability, promising refunds or repeating personal details. The prompt tells the model to treat review text as data, never as instructions. The sample reviews include an "ignore previous instructions" attempt so you can check this.
- **Cheap.** Works with any OpenAI chat model. With `gpt-4o-mini`, a reply costs a small fraction of a cent.
- **Private.** Your API key stays in your browser. Reviews are sent only to OpenAI, and reports are made without reviewer names. There is no server.

![Settings page](docs/settings.png)

## How it works

```mermaid
flowchart LR
    subgraph UI["Where the user clicks"]
        C["🌐 Google review page<br/>content/content.ts + extract.ts<br/>✨ button, reads the review"]
        SP["📋 Side panel<br/>sidepanel/sidepanel.ts<br/>quick profile edits"]
        OP["⚙️ Settings page<br/>options/options.ts<br/>API key + playbook"]
    end

    subgraph BG["Background service worker"]
        B["background.ts<br/>handles every draft request"]
        ST["1 · storage.ts<br/>load the business"]
        PR["2 · prompt.ts<br/>build the prompt"]
        AI["3 · ai/openai.ts<br/>call OpenAI"]
        B --> ST
        B --> PR
        B --> AI
    end

    DB[("chrome.storage<br/>settings + profiles")]
    O["🤖 OpenAI API"]

    C <-->|"request ⇄ draft"| B
    SP -->|save| DB
    OP -->|save| DB
    ST -->|read| DB
    AI <-->|"prompt ⇄ JSON reply"| O
```

**One click, step by step**

1. You click **✨ Draft reply**. `content.ts` asks `extract.ts` to read the review from the page.
2. `content.ts` sends a `"draft"` message to `background.ts`.
3. `background.ts` loads the active business profile through `storage.ts`.
4. `prompt.ts` builds the system prompt (tone, facts, rules, playbook) and the user prompt (the review).
5. `ai/openai.ts` sends both to OpenAI and checks the JSON answer.
6. The draft travels back, and `content.ts` types it into Google's reply box.
7. You read it, edit it, and press Google's own **Post** button.

### Project map

**Screens**

| File | What it does |
|---|---|
| [src/content/content.ts](src/content/content.ts) | Runs inside Google's page. Adds the ✨ bar above each reply box and types the draft in. |
| [src/content/extract.ts](src/content/extract.ts) | Reads the reviewer name, stars and text from Google's page using stable clues. |
| [src/sidepanel/sidepanel.ts](src/sidepanel/sidepanel.ts) | Side panel for switching business and quick profile edits. The same page opens as a wide "full view" tab with `?view=full`. |
| [src/content/launcher.ts](src/content/launcher.ts) | The floating ✨ button on Google review pages that opens the side panel or the full view. |
| [src/options/options.ts](src/options/options.ts) | Settings page for the API key, model, business profiles and situations playbook. |

**Background logic**

| File | What it does |
|---|---|
| [src/background.ts](src/background.ts) | Receives every draft request and connects storage, prompt and AI. Also opens the side panel and full view for the ✨ button. |
| [src/storage.ts](src/storage.ts) | Saves and loads settings in `chrome.storage` and picks the active business. |
| [src/prompt.ts](src/prompt.ts) | Turns a profile and a review into AI instructions, then checks the answer. |
| [src/ai/openai.ts](src/ai/openai.ts) | Calls the OpenAI API and turns errors into plain-English messages. |
| [src/ai/provider.ts](src/ai/provider.ts) | The small interface any AI provider must follow, so others can be added. |

**Shared helpers**

| File | What it does |
|---|---|
| [src/types.ts](src/types.ts) | Data shapes used everywhere: `Review`, `Profile`, `Situation`, `Settings`, messages. |
| [src/archive.ts](src/archive.ts) | Saves collected reviews and reports per business, and works out which months are complete. |
| [src/report-prompt.ts](src/report-prompt.ts) | Turns a month's reviews into AI instructions for a report, then checks the answer and counts mentions in code. |
| [src/report-view.ts](src/report-view.ts) | Draws a monthly report in the side panel, the full view and the PDF. |
| [src/backup.ts](src/backup.ts) | Builds, checks and restores the Export / Import everything file. |
| [src/profiles.ts](src/profiles.ts) | Creates, copies, imports and exports business profiles as JSON. |
| [src/profile-form.ts](src/profile-form.ts) | Connects profile input fields to a profile. Used by both Settings and the side panel. |
| [src/templates/index.ts](src/templates/index.ts) | Starter playbooks for a bar, restaurant, café, hotel, beauty salon and a generic business. |

**Packaging, tests and tools**

| File | What it does |
|---|---|
| [public/manifest.json](public/manifest.json) | The extension's ID card. Tells Chrome which file is the content script, background, side panel and settings. |
| [public/](public/) | HTML, CSS and icons, copied as they are into `dist/`. |
| [scripts/build.mjs](scripts/build.mjs) | Compiles TypeScript to JavaScript and puts the finished extension in `dist/`. |
| [src/demo/demo.ts](src/demo/demo.ts) | A mock Google review page for trying the extension without a real business account. |
| [test/](test/) | Automated tests for extraction, prompts, the OpenAI provider and profiles. |
| [scripts/eval.mjs](scripts/eval.mjs) | Runs sample reviews through different models so you can compare quality and cost. |
| [scripts/make-icons.mjs](scripts/make-icons.mjs) | Generates the 16, 48 and 128 px icons. |

- **The content script** finds reply boxes and walks up the page to the single review around each one. Google's class names are obfuscated and change often, so it relies on accessible star labels such as "Rated 4.0 out of 5". It also ignores the owner's existing reply. The UI lives in a Shadow DOM so the two pages' styles never clash.
- **The prompt builder** turns the profile into a system prompt with tone, facts, rules and the playbook. The review goes inside delimiters as untrusted text.
- **The OpenAI provider** uses [structured outputs](https://platform.openai.com/docs/guides/structured-outputs) with a strict JSON schema. It handles reasoning models, which need different parameters, and turns API errors into plain-English messages. It sits behind a small `AIProvider` interface so other providers can be added.

## Install (developer mode)

You need [Node.js](https://nodejs.org) 20 or newer and Google Chrome.

```bash
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/` folder.
3. The settings page opens. Paste an [OpenAI API key](https://platform.openai.com/api-keys) and set a spending limit on your OpenAI account.
4. Click **+ New profile** with a template, and fill in the business name, facts and signature.
5. Try it on the built-in demo page, linked at the bottom of settings. Then open your Google Business reviews and click **Reply** on a review.

**Tips:**
- To keep the ✨ icon in Chrome's toolbar, click the puzzle piece 🧩 and then the pin 📌 next to ReviewReply.
- To open the side panel on the left, go to Chrome **Settings → Appearance → Side panel** and choose **Show on left**. An extension cannot choose the side itself.

After code changes, run `npm run build` and click the reload icon on the extension card. `npm run watch` rebuilds on every save.

### Updating to a new version

The extension has a fixed ID, set by the `key` in [public/manifest.json](public/manifest.json), so Chrome recognises every version as the same extension and keeps your settings.

1. Download the new release zip and unzip it. Any folder works, but keeping one permanent folder is tidiest.
2. Open `chrome://extensions` and click **Load unpacked** on the new folder. Chrome replaces the old version.
3. Do **not** click **Remove** on the old version first. Removing an extension deletes its saved settings.

As a backup, click **Export everything** in Settings before updating.

## Choosing a model

The model is a setting. Any OpenAI chat model id works through "Other model…".

| Model | Notes |
|---|---|
| `gpt-4o-mini` | Default. Fast, cheap, writes well. |
| `gpt-4.1-nano` | Cheaper. Good for simple, short replies. |
| `gpt-4.1-mini` | More natural writing, still cheap. |
| `gpt-5-nano` / `gpt-5-mini` | Reasoning models. Slower, better at tricky reviews. |

Check [OpenAI's pricing page](https://openai.com/api/pricing/) for current prices. To compare models on your own reviews:

```bash
OPENAI_API_KEY=sk-... npm run eval -- --models gpt-4o-mini,gpt-4.1-nano,gpt-5-nano
# optional: --profile my-bar.reviewreply.json --reviews my-reviews.json --out results.md
```

This writes every model's reply for each sample review in [test/fixtures/sample-reviews.json](test/fixtures/sample-reviews.json) to `eval-results.md`, with the detected situation and response time.

## Development

```bash
npm test          # unit tests (Vitest + jsdom)
npm run typecheck # TypeScript
npm run check     # both, plus a production build
```

```
src/
  background.ts        service worker: drafting, opening the side panel / full view
  prompt.ts            system/user prompt builder and JSON parsing
  ai/                  AIProvider interface and OpenAI implementation
  content/extract.ts   reads reviews from Google's page (pure DOM, unit tested)
  content/content.ts   injects the draft bar and fills the reply box
  sidepanel/ options/  extension pages
  templates/           business-type starter playbooks
  demo/                mock review page for trying the extension
public/                manifest, HTML, CSS, icons (copied into dist/)
scripts/               build, icon generator, model eval
test/                  unit tests and sample reviews
```

## Limitations

- Google's review pages change without notice. If the draft bar stops appearing, the code that reads reviews needs updating. It is in [src/content/extract.ts](src/content/extract.ts).
- The content script runs on `google.com`, `google.lt`, `google.co.uk`, `google.ie`, `google.de` and `business.google.com`. Add other country domains in [public/manifest.json](public/manifest.json).
- Replies are generated in English. Change the first rule in a profile to use another language. Reports use the profile's **Report language**.
- Reports need the whole month. Sort Google's review list by **Newest** and scroll back far enough. Google shows about 100 reviews before you scroll.

## License

MIT
