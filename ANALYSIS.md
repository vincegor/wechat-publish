# Raphael Publish — Project Analysis Report

**Repo:** https://github.com/liuxiaopai-ai/raphael-publish (upstream)
**Fork:** `VinceChan1982/wechat-publish` (this working copy)
**Analyzed:** 2026-10-21 (upstream commit `1243dff`, `main`)
**Live (upstream):** https://publish.raphael.app (serves byte-identical asset hashes to local build)

> **Status:** this working copy is a fork of the upstream with the fork-specific fixes applied
> (see §8). Sections 1–7 describe the **upstream** code as analysed; §8 lists what changed.

---

## 1. Executive Summary

Raphael Publish (公众号排版大师) is a **client-only Markdown → WeChat Official Account formatter**. It runs entirely in the browser (no backend, no account, no telemetry beyond a Microsoft Clarity tag), and its differentiating value is a hand-written **WeChat compatibility layer** that rewrites the rendered DOM into markup that survives WeChat's editor sanitizer, plus **30 hand-designed themes**.

The project is a **high-quality, popular, and now dormant** open-source release. Everything critical works: the copy-to-WeChat pipeline was verified end-to-end in a real Chrome instance and emits correct `text/html` with a `<section>` root, inline styles, working tables and lists.

The main risks are **not** in the product concept but in the engineering foundations:

| Severity | Issue | Status |
|---|---|---|
| **Critical** | `pnpm lint` is a no-op — ESLint 9 + plugins installed, but no `eslint.config.js` exists | **Fixed in fork** (§8) |
| **Critical** | Click-to-locate index drift between the HTML indexer and the Markdown locator | Verified in Chrome — open |
| **Critical** | `markdown-it` configured with `html: true` → raw HTML reaches `dangerouslySetInnerHTML` | Verified — open |
| **High** | Zero-width space (`\u200B`) leaks into the WeChat clipboard payload | Verified — open |
| **High** | 2.41 MB / 757 KB gzip single JS chunk (full `highlight.js`, 384 languages) | Verified — open |
| **High** | No draft persistence — refresh loses the article | Verified — open |
| **Medium** | `wechatCompat.ts` (205 lines, hardest logic) has **zero** unit tests | Verified — open |
| **Medium** | `tsc -b` emits `vite.config.js` / `vite.config.d.ts` into the repo root | **Fixed in fork** (§8) |
| **Medium** | CI + deploy workflows are near-duplicates; no browser cache; no concurrency group | Verified — open |
| **Medium** | Latent regex bug in forced-inheritance colour extraction (dormant in all 30 themes) | Verified — open |

**Build/test status at upstream HEAD:** `pnpm test` → 47/47 pass · `pnpm build` → OK · `pnpm test:e2e` → 4/4 pass (run against system Chrome) · `pnpm lint` → **fails, exit 2**.

**Build/test status in this fork:** `pnpm lint` → exit 0 · `pnpm test` → 47/47 · `pnpm test:e2e` → 4/4 · `pnpm build` → OK.

---

## 2. Project Facts

| | |
|---|---|
| Stars / Forks | **993** / 269 |
| Open issues / PRs | 11 open issues, 4 open PRs (25 total) |
| License | MIT |
| Created | 2026-03-01 |
| Last push | 2026-04-05 (**~6.5 months stale**) |
| Commits | 40 (37 in March 2026, 3 in April) |
| Contributors | 7 (1 primary maintainer + 3 external) |
| Language | TypeScript |
| Topics | markdown, markdown-editor, wechat |

**Commit cadence collapsed after launch.** 37 of 40 commits landed in the first month; only 3 in the following month, then nothing. Issues and PRs are still arriving (latest PR 2026-09-30) but are not being merged.

---

## 3. Architecture

### 3.1 Rendering pipeline

```
markdown source
  → preprocessMarkdown()        src/lib/markdown.ts      (regex hacks for bold/HR)
  → md.render()                 markdown-it (html:true, linkify)
  → applyTheme(themeId)         DOMParser + inline-style injection + image-grid merge
  → markElementIndexes()        DOMParser + data-md-* tagging   (enhancement layer)
  → dangerouslySetInnerHTML     src/components/PreviewPanel.tsx
```

Each stage re-parses the full document with `DOMParser`. For a 49 KB article that yields **1.15 MB of HTML** (every element carries long inline `style` strings).

### 3.2 Copy-to-WeChat pipeline (`src/lib/wechatCompat.ts`)

The most valuable code in the repo. It:

1. Strips internal `data-md-*` attributes.
2. Re-wraps the root in `<section>` (WeChat's preferred container).
3. Converts flex image grids → `<table><tr><td>` (WeChat ignores flex).
4. Flattens `<p>` inside `<li>` → `<span>` (WeChat mangles nested list markup).
5. Re-distributes the container's font/size/line-height/colour onto every text node (WeChat hijacks inheritance).
6. Re-attaches CJK punctuation to the preceding inline emphasis so `**标题**：说明` doesn't wrap.
7. Converts all remote images → Base64 via `fetch` + `FileReader`.

**Verified in Chrome** — clipboard `text/html` contains:
```html
<section style="max-width: 100%; ... background-color: #ffffff !important;">
  <h1 style="font-size: 32px; font-weight: 700; ...">标题</h1>
  <p style="...">正文 <strong style="font-weight: 700; color: #000 !important;">加粗</strong> 文本</p>
  <ul style="...; list-style-type: disc !important;"><li ...>项目一</li></ul>
  <table style="width: 100%; border-collapse: collapse;"><thead><tr><th ...>A</th>...
```

This is genuinely good work — it encodes real, hard-won knowledge of WeChat's editor behaviour.

### 3.3 Themes (`src/lib/themes/`)

30 themes, 3 groups (经典 / 潮流 / 更多风格), 876 lines. Each theme is a flat `Record<cssSelector, cssString>`:

```ts
{ id: 'apple', name: 'Mac', description: '…',
  styles: { container: '…', h1: '…', p: '…', strong: '…', img: '…', table: '…', … } }
```

The selector keys are applied with `querySelectorAll(selector)` + inline `style` concatenation — a clean, uniform scheme that also makes the theme-swatch UI derivable for free (`ThemeSelector.tsx` parses `background-color`/`color` out of the style strings).

### 3.4 Click-to-locate (the newest feature, PR #20)

Two **independent** counters that are supposed to agree:

- `markdownIndexer.ts` — walks the DOM, tags nodes with `data-md-type` / `data-md-index` (global, document order).
- `markdownLocator.ts` — re-parses the Markdown **text** line-by-line and counts elements to find the source range for a given index.

`indexerRules.ts` is the intended "single source of truth" — but it only centralises **type names and matching predicates**, not the **counting algorithm**. The two sides therefore disagree on granularity (§4.2).

### 3.5 Smart paste (`src/lib/htmlToMarkdown.ts`)

Turndown + `turndown-plugin-gfm`; clipboard images → data URLs; heuristics to detect IDE-formatted HTML and mostly-code HTML and defer to plain-text paste; custom image rule that preserves full data URLs.

---

## 4. Findings

### 4.1 🔴 `pnpm lint` does nothing (Critical)

`package.json` declares `"lint": "eslint ."`, and `eslint@9`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` are all in `devDependencies`. **There is no `eslint.config.js` in the repository.**

```
$ pnpm lint
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
✖ ELIFECYCLE  Command failed with exit code 2.
```

ESLint 9 requires flat config; the project was migrated to ESLint 9 + the `typescript-eslint` stack without ever adding the config file. Because CI doesn't run `lint`, this went unnoticed. **The project currently has zero static analysis**, despite having all the tooling for it.

### 4.2 🔴 Click-to-locate index drift (Critical)

The HTML indexer and the Markdown locator use different counting rules, so the two index spaces desynchronise for anything beyond "simple" Markdown.

**Case A — Setext headings** (`Title\n=====`, or `Text\n---`): markdown-it renders `<h1>`/`<h2>`, but the locator classifies the text line as `paragraph` and the underline as `hr`.

```
HTML   : 0:heading:H1:Setext 标题 | 1:paragraph:P:正文一
LOCATOR: 0:paragraph@0-20        | 1:paragraph@22-25
```
Verified in Chrome: clicking the rendered `<h1>` selects **nothing** (`selectionStart === selectionEnd`, empty).

**Case B — raw HTML blocks**: the HTML indexer only tags `h1-6 / p / ul / ol / blockquote / pre / table / hr / img`; a `<div>` block is untagged, but the locator counts it as a paragraph → every later index shifts by one.

```
HTML   : 0:paragraph:P:正文一
LOCATOR: 0:paragraph@0-29 (<div class="x">raw html</div>) | 1:paragraph@31-33 (正文一)
```
Verified in Chrome: clicking the paragraph "正文一" selects **`<div class="x">raw html</div>`** instead.

**Case C — tables nested in list items**: the HTML side never tags nested `<tr>`, the locator does → drift.

**Root cause:** `findElementByGlobalIndex` increments its counter for *every* markdown element it parses, while the HTML side tags only a *subset* of DOM nodes. `indexerRules.ts` centralises the vocabulary but not the algorithm.

**Impact:** silent wrong-element selection — worse than a no-op, because the user believes they edited the right block.

**Proper fix:** drive both directions from a **single parse**. markdown-it already exposes `token.map` with exact `[beginLine, endLine]` source ranges; the indexer could tag elements from the token stream and the locator could resolve `token.map` → character offsets, eliminating the hand-rolled line-based re-parser entirely.

### 4.3 🔴 XSS surface from `html: true` (Critical)

`src/lib/markdown.ts`:
```ts
export const md = new MarkdownIt({ html: true, linkify: true, … });
```

Raw HTML in the document is preserved and injected via `dangerouslySetInnerHTML` in `PreviewPanel.tsx`. Verified:

```
input : <img src=x onerror="alert(1)">
output: <img src=x onerror="alert(1)" style="…">   ← onerror survives applyTheme()
input : <script>alert(2)</script>
output: <script>alert(2)</script>                 ← tag survives in the string
```

`<script>` inserted via `innerHTML` does not execute, but **event-handler attributes do** (`onerror`, `onload`, …). Mitigating factors: no backend, no auth, no `localStorage` (content is in-memory only), so the practical impact is self-XSS. But the threat model is "paste rich text from an unknown source", which is exactly the app's primary use case, and future features (import from URL, shared drafts) would escalate it.

**Fix:** `html: false`, or run the output through DOMPurify before injection.

### 4.4 🟠 Zero-width space leaks into the WeChat payload (High)

`preprocessMarkdown` works around a markdown-it bold-parsing bug by injecting U+200B:

```ts
content = content.replace(/([^\s])\*\*([+\-＋－%％…]…)\*\*/g, '$1**\u200B$2**');
```

Verified: the U+200B survives into the final clipboard `text/html`, inside `<strong>`:
```
利率变化至<strong style="…">-5%</strong>。
```
It's invisible in WeChat but it is a foreign character injected into the user's content, and it breaks text search/copy fidelity. Open **PR #25** ("fix: preserve bold punctuation boundaries for WeChat") targets exactly this area.

### 4.5 🟠 2.41 MB single JS chunk (High)

```
dist/assets/index-B1xyRFkz.js   2,412.66 kB │ gzip: 756.88 kB
dist/assets/index-BPqM4Ys1.css     29.50 kB │ gzip:   6.35 kB
(!) Some chunks are larger than 500 kB after minification.
```

Cause: `import hljs from 'highlight.js'` pulls in **all 384 languages** (7.9 MB of source — confirmed: the bundle contains grammars for Java, Kotlin, Swift, Rust, Elixir, MATLAB, Haskell, PHP, Ruby, C++ …). `jspdf` and `html2pdf.js` are in the same chunk, as is `lucide-react`.

For a mobile-first "paste and preview" tool, ~757 KB gzip of JS before first paint is the single biggest UX lever available.

**Fix:** `highlight.js/lib/core` + register ~15 common languages · `build.rollupOptions.output.manualChunks` · `await import('html2pdf.js')` on PDF-export click only.

### 4.6 🟠 No draft persistence (High)

Content lives only in React state (`App.tsx`). A refresh, tab crash, or accidental navigation loses the entire article. For an authoring tool this is the biggest functional gap; there is no `localStorage`, no file open/save, no `.md` import/export. (Adjacent open issue #21: *"有图片的时候，左侧有会大量的文本，不好编辑，建议有个折叠按钮"*.)

### 4.7 🟡 Test coverage gaps (Medium)

47 unit tests across 4 files, 4 e2e specs. Coverage is **inverted** relative to risk:

| Module | Lines | Unit tests |
|---|---|---|
| `wechatCompat.ts` | 205 | **0** |
| `markdownIndexer.ts` | 156 | **0** |
| `indexerRules.ts` | 139 | **0** |
| `markdownLocator.ts` | 337 | 14 |
| `imageSelector.ts` | 268 | 25 |
| `markdown.ts` | 276 | 6 |
| `htmlToMarkdown.ts` | 191 | 2 |

The flex→table conversion, list flattening, CJK punctuation repair and Base64 embedding in `wechatCompat.ts` are all easily unit-testable in jsdom, and they are the product's core differentiator. This is also where a regression would be most damaging and least likely to be caught.

### 4.8 🟡 `tsc -b` pollutes the repo root (Medium)

`tsconfig.node.json` sets `composite: true` with no `noEmit`, so `pnpm build` emits `vite.config.js` and `vite.config.d.ts` into the working tree. `.gitignore` only covers `*.tsbuildinfo`. These show up as untracked files after every local build.

### 4.9 🟡 Scroll sync is ratio-based, not line-anchored (Medium)

`App.tsx: syncScrollPosition()` maps `scrollTop / scrollHeight` proportionally between a monospace `<textarea>` and a proportionally-typeset preview. The two layouts have different element heights, so the mapping is systematically wrong and drifts further the deeper you scroll. The e2e tests encode a ±0.12 tolerance, which documents the limitation rather than the intent. A line-anchored sync (map the source line under the viewport top to the corresponding preview element) would be both more accurate and simpler to reason about.

### 4.10 🟡 CI / deploy duplication (Medium)

- `ci.yml` and `deploy.yml` are near-identical; the deploy workflow re-runs unit tests + e2e + build that CI already validated.
- Both trigger on **every push** with no path filter, and **neither declares a `concurrency` group** → redundant runs on rapid pushes.
- Playwright's 167 MB chromium is re-downloaded on every run (`actions/setup-node` caches only the pnpm store).
- `pnpm lint` is not part of either workflow (see §4.1).

### 4.11 🟡 Latent regex fragility in forced inheritance (Medium)

`wechatCompat.ts` extracts the container colour with:
```ts
const colorMatch = containerStyle.match(/color:\s*([^;]+);/);
```
This also matches the `color:` **inside** `background-color:`. All 30 themes currently declare `color` before `background-color`, so the bug is dormant — but one theme edit flips it, and the result is `color: #ffffff !important` applied to every `<span>`, i.e. **white-on-white invisible text**. A word-boundary-anchored regex (`/(?:^|[;\s])color:/`) fixes it.

### 4.12 ⚪ Minor / hygiene

- **Duplicate `data-testid="copy-button"`** — the desktop and mobile toolbars are both mounted (one CSS-hidden), breaking Playwright strict-mode selection; the existing e2e works around it with `:visible`.
- **Dead exports** — `moveCursorToPosition` (`imageSelector.ts`), `getHtmlSelector` + `HTML_TAG_MAP` (`indexerRules.ts`) have zero call sites.
- **Empty `useEffect`** in `App.tsx` (lines 34-36) with a comment explaining that it does nothing.
- **`GITHUB_PAGES` env var is set in `deploy.yml` but never read** — `vite.config.ts` hardcodes `base: '/'`. It only works because `public/CNAME` makes it a custom domain.
- **README inaccuracy** — README and the toolbar tooltips state mobile/tablet = **480px/768px**; the actual values are **520px** (mobile frame) / **720px** (tablet frame) / 800px (tablet container class). Three different numbers for the same thing.
- **`framer-motion`** (~50 KB gz) is used only for hover/tap `scale` — could be CSS transitions.
- `e.preventDefault()` inside a **document-level** click listener in `PreviewPanel.tsx` intercepts clicks app-wide (currently safe since only the preview carries `data-md-*`).

---

## 5. What Works Well

1. **The WeChat compat layer is the real IP.** Flex→table, list flattening, font re-inheritance and CJK punctuation repair encode genuine empirical knowledge of WeChat's editor. It works.
2. **Clean layering.** `markdown.ts` (core render) is decoupled from `markdownIndexer.ts` (enhancement), with the decoupling explicitly documented in both files' headers.
3. **Theme schema is elegant.** One flat record per theme; the picker UI derives swatches from it automatically; adding a theme is a single object literal.
4. **Honest CI.** Both unit and browser tests gate the GitHub Pages deploy. Tests pass at HEAD.
5. **Zero-ops architecture.** Pure static site, no server, no database, no auth, no cookie banner — a real privacy and cost advantage over SaaS competitors (135 editor, 壹伴, etc.).
6. **Responsive/mobile-aware UX** — separate edit/preview tabs, scroll sync per device class, mobile-safe copy button (with an e2e regression test for it, added in response to issue #9).
7. **Community validation** — 993 stars, 269 forks, 3 external contributors, MIT license.

---

## 6. Recommendations (prioritised)

### Immediate (hours)
1. **Add `eslint.config.js`** and add `pnpm lint` to CI. Unlocks all static analysis the project already paid for.
2. **Strip `\u200B`** from the WeChat payload in `makeWeChatCompatible` (strip U+200B/U+2060 from text nodes before the final serialisation).
3. **Anchor the colour regex** — `/(?:^|[;\s])color:/` instead of `/color:/`.
4. **Fix README device widths** (480/768 → 520/720).
5. **Add `vite.config.js` / `vite.config.d.ts` / `*.tsbuildinfo` to `.gitignore`**, or set `noEmit: true` in `tsconfig.node.json`.

### Short term (1-2 days)
6. **Fix the index drift properly** — replace the hand-rolled Markdown re-parser with markdown-it's `token.map` so both the tagger and the locator read the *same* parse. This deletes `markdownLocator.ts`'s ~200 lines of fragile counting and fixes §4.2 for all input shapes at once.
7. **Sanitise HTML** — DOMPurify on the rendered output (or `html: false` if raw HTML isn't a requirement).
8. **Unit-test `wechatCompat.ts`** — flex→table, list flattening, punctuation repair, Base64 embedding, and a golden-file test for the full copy payload.

### Medium term (1 week)
9. **Shrink the bundle** — `highlight.js/lib/core` with ~15 languages, `manualChunks` for `react`/`markdown`/`pdf`, lazy-load `html2pdf.js` on demand. Target: 757 KB gz → <300 KB gz.
10. **Add draft autosave** to `localStorage` (+ a "clear draft" affordance) and/or `.md` file open/save.
11. **Consolidate CI** — one reusable workflow (`workflow_call`) for test+build, a browser cache step, a `concurrency` group, and path filters.

### Product
12. **Revive maintenance** — 11 open issues and 4 open PRs (including the bold-punctuation one) are queued against a repo that has been idle for 6.5 months. Even a monthly triage pass would materially improve the project's standing.
13. Consider the two most-requested adjacent features from issues: an **editor collapse/expand for long documents** (#21) and a **VS Code extension** (closed issue #17).

---

## 7. Verification Log

All findings above were reproduced locally, not inferred.

| Check | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | OK (45 s) |
| Unit tests | `pnpm test` | **47/47 pass** |
| Build | `pnpm build` | OK — 2.41 MB chunk warning |
| Lint | `pnpm lint` | **FAILS, exit 2** — no `eslint.config.js` |
| E2E | `pnpm test:e2e` | **4/4 pass** (run against system Chrome via `channel: 'chrome'`) |
| Clipboard payload | Playwright + `navigator.clipboard.read()` | `text/html` correct: `<section>` root, inline styles, tables, lists |
| ZWSP leak | vitest + `makeWeChatCompatible` | U+200B present in output |
| Raw HTML passthrough | vitest | `onerror=` and `<script>` both survive |
| Index drift | vitest + Playwright (Chrome) | Setext heading → empty selection; raw-HTML block → wrong element selected |
| Render perf (real browser) | Playwright, 49 KB doc | 92 ms per keystroke (18 ms @ 12 KB) — acceptable; the 4.2 s jsdom figure is a jsdom artefact, not a browser figure |
| Bundle composition | string probe of `dist/assets/index-*.js` | all 384 `highlight.js` languages bundled |

---

## 8. Fork changes (`vincegor/wechat-publish`)

> **Deployed:** https://vincegor.github.io/wechat-publish/ — CI and the Pages deploy workflow both run green on every push to `main`.

The upstream repo was forked to `VinceChan1982/raphael-publish` on 2026-09-14 and left untouched — Pages was never enabled and Actions never ran. This working copy is published as the standalone repo **`vincegor/wechat-publish`** (the fork's own account had no push access from the available credentials), with the fork-specific fixes below.

### Deployment blockers (all fixed)

| Change | File | Why |
|---|---|---|
| `base` now derived from `GITHUB_PAGES` + `GITHUB_REPOSITORY`, overridable via `BASE_PATH` | `vite.config.ts` | Upstream hard-coded `base: '/'`. A project Pages site is served from `/<repo>/`, so every asset 404s → blank page. Verified: build now emits `/wechat-publish/assets/...`. |
| `public/CNAME` deleted | `public/` | Contained `publish.raphael.app` — owned by the upstream author (Cloudflare-fronted, `104.26.x`). Shipping it makes Pages request a cert for a domain the fork doesn't control → site unavailable. |
| `GITHUB_REPOSITORY` + `BASE_PATH` wired into the build step | `.github/workflows/deploy.yml` | `GITHUB_PAGES` was set but never read. `BASE_PATH` is a repo variable, so a custom domain can flip the site to root-served without a code change. |
| `BASE_PATH=/` documented for custom domains | `README.md` | — |

### Repo hygiene (all fixed)

| Change | File | Why |
|---|---|---|
| Flat ESLint config added; `pnpm lint` now exits 0 | `eslint.config.js` | Upstream had ESLint 9 + all plugins installed but **no config file** → the `lint` script was a guaranteed failure and zero static analysis ran. |
| 9 lint errors fixed | `src/lib/{markdown,htmlToMarkdown,imageSelector,wechatCompat}.ts` | `@ts-ignore` → `@ts-expect-error`; redundant regex escapes (incl. `\[\]` → `\u005B\]`, which must stay escaped or the character class terminates early); unused catch bindings → optional catch binding. |
| `pnpm lint` added to both workflows | `.github/workflows/{ci,deploy}.yml` | Lint now gates CI and the Pages publish. |
| `outDir` added to the node tsconfig | `tsconfig.node.json` | `tsc -b` emitted `vite.config.js` / `vite.config.d.ts` into the repo root. **Vite resolves `vite.config.js` before `vite.config.ts`**, so a stale copy silently shadows the config — including the new `base` logic. |
| Emitted artifacts gitignored | `.gitignore` | Belt-and-braces. |
| Microsoft Clarity made opt-in via `VITE_CLARITY_ID` | `src/lib/analytics.ts`, `index.html`, `src/vite-env.d.ts` | Upstream hard-coded its own Clarity project id (`vozzvsv981`), so every fork reported its visitors to the upstream author's dashboard. |

### Docs

| Change | File | Why |
|---|---|---|
| Device widths corrected (480/768 → 520/720) | `README.md`, `src/components/Toolbar.tsx` | The documented and tooltipped sizes were wrong in both places; the real frames are 520 px (mobile) and 720 px (tablet). |
| Deploy guide rewritten | `README.md` | Documents the sub-path `base` behaviour, the CNAME removal, and the two settings that live in the GitHub UI rather than in code. |
| `AGENTS.md` written | `AGENTS.md` | — |

### Not fixed here (upstream product bugs, left for a decision)

The findings in §4 that affect product behaviour rather than deployment — the indexer/locator drift (§4.2), the `html: true` XSS surface (§4.3), the U+200B leak (§4.4), the 2.41 MB bundle (§4.5), missing draft persistence (§4.6), and the absent `wechatCompat` / `markdownIndexer` unit tests (§4.7) — are **still present**. They are upstream issues and would change rendered output or the copy-to-WeChat payload, so they were deliberately not bundled into a deployment-fixing change set.

### Verification after the fork changes

| Check | Result |
|---|---|
| `pnpm lint` | **passes, exit 0** |
| `pnpm test` | **47/47 pass** |
| `pnpm exec tsc -p tsconfig.json --noEmit` | **passes** |
| `pnpm test:e2e` | **4/4 pass** (system Chrome, `channel: 'chrome'`) |
| Project-Pages build | `src="/wechat-publish/assets/index-*.js"` ✅ |
| Root build | `src="/assets/index-*.js"` ✅ |
| `pnpm preview` on the sub-path build | `/wechat-publish/` → 200, assets → 200 ✅ |
| `dist/` contents | `index.html` + `assets/` — **no CNAME** ✅ |
| **Live site** | https://vincegor.github.io/wechat-publish/ — HTTP 200, assets 200, absolute `/wechat-publish/assets/…` paths ✅ |
| Live browser check | Renders the default article, theme switch applies (Claude bg `rgb(248,246,240)`), copy-to-WeChat emits `text/html` with a `<section>` root, **zero console errors** ✅ |
