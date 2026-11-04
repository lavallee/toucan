# Releasing toucan

toucan isn't on the npm registry (the name is taken). People install the tarball attached to the GitHub release, through
`install.sh` beside it. A release is a tag, that GitHub release and its two files, the docs site, the plugin entries in the Lyra Forge
marketplace, and the listing on lyra-forge.com.

## Versioning

Semantic versioning. The version in `package.json` must match both plugin manifests
(`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) and a `CHANGELOG.md` heading;
`npm run check` enforces this.

## Checklist

1. Start from a clean `main`; read every change since the previous tag.
2. Bump the version everywhere above and move `Unreleased` entries under the new heading.
3. Run `npm run check && npm test && npm run typecheck && npm run test:install`, `npm run docs`, and
   `gitleaks git --redact .` (CI runs the same scan over the whole history).
4. Commit `chore(release): X.Y.Z`, tag `vX.Y.Z` (annotated), and push both. The Release workflow checks it, packs
   `toucan.tgz`, runs the install check on it, and creates the release with `toucan.tgz`, `install.sh` and the changelog
   section as notes. Then run the one-line install from the README on a clean machine or account.
5. Wait for the Pages workflow and open https://lavallee.github.io/toucan/.
6. Validate the plugin (`claude plugin validate . --strict`), then update the pinned `sha` for toucan in
   both catalogs of the marketplace repo and run its tests.
7. Pinned dependencies: the server's `@tldraw/sync-core` must equal the `tldraw` the app is built with, since a release
   ships both, so upgrade them together.
8. Do not call the release public until the tag, release, site and marketplace entry all resolve.
