# Artoo reference — toucan — a canvas you and your agents share

This file is generated. It is deliberately separate from `AGENTS.md` so the full class vocabulary enters context only when it is useful.

## Commands

Every command takes an artifact path, or resolves upward from the working
directory if you omit it.

| goal | command |
|------|---------|
| manifest health, firewall report, library drift | `artoo status .` |
| refresh inputs, verify, stamp `updated` | `artoo build .` |
| static and optional browser checks | `artoo verify .` |
| build or interrogate a repository graph | `artoo map --help` |
| publish (firewall-staged) | `artoo deploy .` |
| the layout vocabulary, in full | `artoo docs <library>` |
| everything artoo knows | `artoo docs --all` |

`artoo build` is the check that matters: it runs the manifest's build
commands, refreshes the provenance projection, verifies the firewall, and
reports any class used here that its library does not define.

## What publishes

Only `site/`. The artifact directory around it — `work/`, `notebook/`,
`artifact.toml`, this file — stays in the repo. Inside `site/` the firewall
still withholds any path segment starting with `_` or `.` (except
`.nojekyll`), and the research filenames `notebook.md`, `notes.md`,
`priors.md`, `DECISIONS.md`, `HANDOFF.md`.

That is deny-by-default and structural: `site/_draft/v2.html` is visible to
you and invisible to the world with no configuration. Put working material in
`work/`, and drafts under a `_`-prefixed path.

`artoo status .` lists exactly what is being withheld.

## Layout vocabulary

### artoo-kit 0.5.0

Long-form article layout, evidence regions, and the provenance panel.

Vendored at `site/lib/artoo-kit/`. Read the stylesheets there if you need the exact rule; this table is the vocabulary they define.

| class | role |
|---|---|
| `article` | the long-form grid container; children sit in the prose column by default |
| `article-full` | wrapper: let this child run edge to edge |
| `article-breakout` | wrapper: wider than prose, still centered |
| `article-mrow` | row that pairs a prose block with a margin note |
| `article-masthead` | top bar; `__name` is the artifact link, `__label` the standfirst tag |
| `article-header` | the title block at the head of the piece |
| `article-kicker` | small label above the title (conventionally the artifact kind) |
| `article-title` | the h1 |
| `article-dek` | standfirst under the title |
| `article-byline` | publication line; wrap the date in `<time datetime=…>` |
| `article-lede` | opening paragraph, set larger |
| `article-figure` | figure wrapper for a table or chart; put vintage, denominator, and source in the `figcaption` |
| `article-marginnote` | right-gutter note, inline on mobile; `--def`, `--source`, `--callout` variants, `.term` for the term defined |
| `article-pullquote` | breakout-width quote; attribute it with `<cite>` |
| `article-pullnumber` | breakout-width figure; `.num` is the value, `.label` its caption |
| `article-colophon` | how-it-was-made block closing the piece |
| `site-nav` | multi-page nav; `.brand`, `.nav-toggle` + `.nav-links`, and current-page links (wired by kit.js) |
| `page` | container for a non-article page; `--narrow` tightens it |
| `card-grid` | responsive grid of navigation cards |
| `nav-card` | navigation card; use on links to destinations, not as a generic container |
| `card` | deprecated compatibility alias for nav-card; prefer nav-card in new work |
| `callout` | boxed aside with a `.callout-title`; `--warn`, `--danger`, `--success` variants |
| `badge` | inline label; `--accent`, `--success`, `--warn` variants |
| `stat-row` | row of figures |
| `stat` | one figure; `.value` then `.label` |
| `toc` | table of contents, as an ordered list |
| `diagram` | wrapper for an inline SVG or a mermaid block |
| `colophon` | build and provenance footer |
| `collection-pager` | previous and next navigation at the foot of a collection page |
| `numeric` | tabular figures, so columns of numbers align |
| `no-print` | hide this element when the page is printed |
| `provenance` | the provenance panel root; mark it `data-artoo-provenance` and provenance.js fills it from data/provenance.json |
| `claim-ref` | written by provenance.js onto `[C7]`-style references; never hand-author it |

This library owns `article-`, `provenance`. A class starting with one of those that the stylesheet does not define is a guess, and `artoo build` fails on it and names the nearest real class. Your own classes go outside those prefixes — they are never second-guessed.

Full prose contract: `artoo docs artoo-kit`.

## Rules

1. **Use the vocabulary above; do not invent classes in its namespaces.** An
   invented class renders as nothing, which looks like a styling bug and is
   not one.
2. **Nothing loads from the network.** The artifact must render from a
   `file://` URL — no CDN scripts, no remote fonts, no external stylesheets.
   Vendor a runtime with `artoo lib vendor <name> <url>` and it is recorded
   with a pinned hash.
3. **Style SVG with CSS, not presentation attributes.** `fill="var(--chart-1)"`
   never resolves — SVG presentation attributes are not CSS. Give the shape a
   class and set `fill` in a `<style>` block, which also lets the chart follow
   the theme instead of baking one that only reads in light mode.
4. **A figure earns its place by enabling a valid comparison.** Vintages,
   denominators, and a source note belong in the `figcaption`.

## More

`artoo docs` lists the manifest, forms, data, evidence, firewall, serving, code maps, generators, and every installed site library.
