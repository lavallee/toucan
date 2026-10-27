# Releasing toucan

toucan is installed from git; there is no npm package (the name is taken). A release is a tag and GitHub
release, the docs site, the plugin entries in the Lyra Forge marketplace, and the listing on lyra-forge.com.

## Versioning

Semantic versioning. The version in `package.json` must match both plugin manifests
(`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) and a `CHANGELOG.md` heading;
`npm run check` enforces this.

## Checklist

1. Start from a clean `main`; read every change since the previous tag.
2. Bump the version everywhere above and move `Unreleased` entries under the new heading.
3. Run `npm run check && npm test && npm run typecheck && npm run build`, `artoo build website`, and
   `gitleaks git --redact .` (CI runs the same scan over the whole history).
4. Commit `chore(release): X.Y.Z`, tag `vX.Y.Z` (annotated), push both, and `gh release create vX.Y.Z`
   with the changelog section as notes.
5. Wait for the Pages workflow and open https://lavallee.github.io/toucan/.
6. Validate the plugin (`claude plugin validate . --strict`), then update the pinned `sha` for toucan in
   both catalogs of the marketplace repo and run its tests.
7. Do not call the release public until the tag, release, site and marketplace entry all resolve.
