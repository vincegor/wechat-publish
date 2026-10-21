# AGENTS.md

Raphael Publish — client-side Markdown → WeChat Official Account formatter. React 18 + Vite 5 + TypeScript + Tailwind 3, single-page, **no backend**. All rendering is DOM manipulation in the browser.

## Commands

```bash
pnpm install --frozen-lockfile     # pnpm 9 (CI uses Node 20)
pnpm dev                           # vite dev server
pnpm build                         # tsc -b && vite build
pnpm test                          # vitest run (jsdom)
pnpm test:e2e                      # playwright, needs browsers installed
```

Focused runs:

```bash
pnpm exec vitest run src/lib/markdown.test.ts            # one file
pnpm exec vitest run src/lib/markdownLocator.test.ts -t "全局索引"   # one test name (substring match)
pnpm exec playwright test e2e/app.spec.ts -g "syncs editor"         # one e2e spec
pnpm exec tsc -p tsconfig.json --noEmit                  # typecheck app code only
```

Gotchas:

- **`pnpm lint` now works** (flat config in `eslint.config.js`). It was broken upstream — ESLint 9 was installed with no config file, so the script exited 2.
- **`tsc -b --noEmit` fails** (TS6310: referenced project `tsconfig.node.json` may not disable emit). Use `tsc -p tsconfig.json --noEmit`.
- **Playwright browsers**: `pnpm exec playwright install chromium` (167 MB). `--with-deps` needs sudo. This machine has Google Chrome — `channel: 'chrome'` in `playwright.config.ts` works without the download.
- **`pnpm build` used to emit `vite.config.js` + `vite.config.d.ts` into the repo root.** `tsconfig.node.json` now sets `outDir: ./node_modules/.tmp/tsconfig.node`, and both names are gitignored. This mattered: **Vite resolves `vite.config.js` before `vite.config.ts`**, so a stale copy silently shadows your config (including the `base` path). If one appears, delete it.
- `tsconfig.tsbuildinfo` also lands in the repo root (it *is* gitignored).

## Render pipeline

`src/App.tsx` (~line 47) drives everything:

```
markdown → preprocessMarkdown() → md.render() → applyTheme(themeId) → markElementIndexes() → dangerouslySetInnerHTML
```

- `src/lib/markdown.ts` — markdown-it instance (**`html: true`**), `preprocessMarkdown` regex hacks, `applyTheme` (DOMParser → inline styles, image-grid merge, list-marker restoration).
- `src/lib/markdownIndexer.ts` — second DOMParser pass that tags nodes with `data-md-type` / `data-md-index` for click-to-locate.
- `src/lib/wechatCompat.ts` — `makeWeChatCompatible(html, themeId)`: the WeChat-specific rewrite (flex→table, `<p>` inside `<li>`→`<span>`, force container font/size/colour onto every text node, re-attach CJK punctuation to the preceding emphasis, inline images as Base64).
- `src/lib/themes/{classic,modern,extra}.ts` — 30 themes, each a flat `Record<selector, cssString>` with 21 keys: `container, h1..h4, p, strong, em, a, ul, ol, li, blockquote, code, pre, hr, img, table, th, td, tr`. `themes/index.ts` exports `THEMES` and `THEME_GROUPS` (经典 / 潮流 / 更多风格).
- `src/components/ThemeSelector.tsx` — the 4 quick-pill theme ids are hardcoded there: `['apple','claude','wechat','sspai']`.

Two consumers of the same HTML:

| Consumer | Entry point | `data-md-*` attrs |
|---|---|---|
| Live preview | `PreviewPanel.tsx` | kept (needed for click-to-locate) |
| Copy to WeChat | `App.handleCopy` → `makeWeChatCompatible` | must be stripped |
| HTML export | `App.handleExportHtml` → `cleanInternalAttributes` | must be stripped |

If you add an internal attribute, strip it on both export paths.

## Traps — read before changing these files

1. **Indexer/locator index drift.** `markdownIndexer.ts` (walks the DOM) and `markdownLocator.ts` (re-parses the Markdown text line-by-line) count elements with *different* rules, so their index spaces desynchronise on anything but simple Markdown. Verified breakage: setext headings (`Title\n=====`, `Text\n---`), raw HTML blocks, tables nested in list items. `src/lib/indexerRules.ts` centralises type *names* only — not the counting algorithm. If you touch either side, add tests to both.
2. **Two `selectTextAreaRange` exports.** `src/lib/imageSelector.ts` (focus + select + scroll into view) and `src/lib/markdownLocator.ts` (focus + select, restores `scrollTop`). `App.tsx` uses the **imageSelector** one; the markdownLocator one is dead code. Don't import the wrong one.
3. **`markdown-it` runs with `html: true`** — raw HTML (including `onerror=` handlers) reaches `dangerouslySetInnerHTML`. Self-XSS only today (no backend, no storage), but don't add new injection points.
4. **`preprocessMarkdown` injects U+200B (`\u200B`)** to work around a markdown-it bold-parsing bug. It survives into the WeChat clipboard payload.
5. **`wechatCompat.ts` colour regex** `/color:\s*([^;]+);/` also matches the `color:` inside `background-color:`. Currently dormant because every theme declares `color` before `background-color` — preserve that ordering or fix the regex (wrong match = white-on-white text).
6. **Tailwind preflight strips list markers**, so `applyTheme` re-adds `list-style-type` manually. New list-related theme styles need the same treatment.
7. **`import hljs from 'highlight.js'`** bundles all 384 languages (the JS chunk is 2.41 MB / 757 KB gzip). Use `highlight.js/lib/core` + explicit language registration if you touch highlighting.

## Tests

- Unit: vitest + jsdom (`vitest.config.ts`, `include: ['src/**/*.test.ts']`). `DOMParser` works, so DOM-level assertions are viable.
- E2E: playwright, one chromium project, `webServer` = `vite --host 127.0.0.1 --port 4173 --strictPort`, `reuseExistingServer: !CI`.
- **Desktop and mobile toolbars are both mounted** (one CSS-hidden) → duplicate `data-testid`s, e.g. `copy-button`. Use `:visible` in selectors (see `e2e/app.spec.ts`).
- **No unit tests exist for `wechatCompat.ts` or `markdownIndexer.ts`** — the two most logic-dense modules, and the product's core differentiator. Add coverage when changing them.
- CI runs `pnpm test` + `pnpm test:e2e` + `pnpm build`; `.github/workflows/deploy.yml` re-runs the same three steps before publishing to GitHub Pages.

## Deploy

GitHub Pages, `.github/workflows/deploy.yml` publishes to GitHub Pages on push to `main`.

- **`vite.config.ts` computes `base` automatically**: `GITHUB_PAGES=true` + `GITHUB_REPOSITORY=owner/repo` → `base = /<repo>/`. Project Pages are served from a sub-path, so a root-relative `base` produces a blank page (404s on every asset). Override with `BASE_PATH=/` for a custom-domain (root-served) site.
- **`public/CNAME` was removed.** It pointed at `publish.raphael.app`, which the upstream author owns (Cloudflare-fronted). A fork shipping that CNAME makes Pages try to issue a cert for a domain it doesn't control → site breaks.
- **Microsoft Clarity is opt-in** via `VITE_CLARITY_ID` (`src/lib/analytics.ts`). Upstream hard-coded its own Clarity project id, so every fork reported its visitors to that project.
- Repo settings that are **not** in code: Pages → Source = "GitHub Actions", and the optional custom domain + a repo variable `BASE_PATH=/` when using one.

## Conventions

- UI strings and most comments are Chinese; identifiers and newer code comments are English.
- Themes are plain data — adding one means appending an object to the right `themes/*.ts` array; no registry to update beyond `themes/index.ts` (groups are derived from the same arrays).
