# Changelog

All notable changes to ReviewReply are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/rimakrivis/review-reply/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rimakrivis/review-reply/releases/tag/v0.1.0
