# Community templates

This folder is the real, working version of the README's Phase 3: *"the first
person on a chain records it, the thousandth presses one button."*

Each file here is one contributed template — the volatile half of one site
(which request holds the data, where the fields live in it) that VIGIL's
watch builder can apply automatically instead of asking the next person to
record and map it by hand.

## Contributing one

1. In VIGIL's watch builder, record and set up a watch normally.
2. Click **Export as template**. It downloads a JSON file already stripped of
   cookies, tokens, and any of your account/order/session identifiers —
   the export button always does this, so what you get is safe to share.
3. Drop that file into this folder, named after the site
   (e.g. `cinestar-de.json`, `stockx.json`).
4. Open a pull request.

Before merging, sanity-check that the file has no stray identifiers beyond
what `toTemplate()` already strips (`src/core/registry.js`) — the export
strips known patterns, not everything anyone could ever put in a URL.

## Building the feed

`npm run build-feed` reads every `*.json` file in this folder, validates it,
and writes the merged feed to `dist/templates.json` — the exact shape
`fetchTemplatePack()` in `src/core/registry.js` expects. That one file is what
gets deployed to `TEMPLATE_FEED`'s URL (currently a placeholder — wherever
this project ends up actually hosting it: GitHub Pages, Cloudflare Pages,
Netlify, all work fine, since it's just static JSON, no server logic).

Malformed files are skipped with a warning, not a hard failure — one bad
contribution shouldn't be able to take the whole feed down.
