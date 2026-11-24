# Contributing to toucan

toucan should stay small: a canvas people edit by hand, a narrow path for agents to edit it too, and
seams for everything specific to someone's own work (canvas scripts, extension commands, deployment notes).

## Set up

Node 22 or newer. The [Codex CLI](https://github.com/openai/codex) is only needed for the chat panel.

```sh
npm install
npm run dev        # server + vite with hot reload
```

## Make a change

- Keep the agent path single: the chat agent, terminal agents and the MCP server all go through `bin/toucan.mjs`.
  A new capability belongs in the CLI or the `toucan.*` helpers, then in the relevant guide under `docs/agents/`.
- Never let an agent path delete or move a person's shapes by default. Imports are keyed upserts;
  removal and repositioning are explicit flags.
- Domain-specific canvases belong in an extension command (`toucan-X` in its own repo), not here.
- Update the relevant agent guide, `website/content/` and `CHANGELOG.md` with any behaviour change. Keep `AGENTS.md` focused on rules agents need for everyday canvas work and links to the topic guides.
- The server needs only `dependencies` at runtime. What the app needs at build time goes in `devDependencies`, and a release
  ships the built app, so installing one stays small.
- The bar above the canvas, side panels, History, Routines, the chat dock and the UI primitives (`ui/*`) come from
  Leyline (`@lyra-forge/leyline`, github.com/lavallee/leyline), shared with Copycat and Skein. Change them there, run
  its tests, then pin it with `node scripts/update-leyline.mjs --source /path/to/leyline`. Do not copy them back here.
- Do not commit canvases, tokens, private hostnames or internal project names. `npm run check` catches
  the obvious ones.

## Before a pull request

```sh
npm run check && npm test && npm run typecheck && npm run test:install
gitleaks git --redact .   # optional locally; CI runs it
```

If you touched the docs site, also run `npm run docs` (needs `uv tool install artoo-artifacts`). In the
pull request, explain what changes for a person at the canvas or an agent at the CLI, and how you checked it.
