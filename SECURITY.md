# Security Policy

## Supported Versions

Only the latest release of toucan receives security fixes.

## Reporting a Vulnerability

Please report security issues privately by emailing **mlavallee@gmail.com** rather than opening a
public GitHub issue. Include a description of the issue and its impact, steps to reproduce, and the
toucan version and platform. You should get an acknowledgement within a few days; once a fix is ready,
we will coordinate disclosure and credit with you.

## Scope

toucan is designed to run on your own machine or a network you trust. By design, its exec relay runs
arbitrary JavaScript in a browser tab, and its chat drives a coding agent that has a shell. The main
security-sensitive areas are:

- The server token in `~/.config/toucan/server.json` and its checks on every HTTP and WebSocket request
- The sign-in link, which carries the token in its URL fragment
- Canvas scripts, which run in every tab that opens the canvas
- The Codex sandbox and approval settings in `server/codex.mjs`
- Path handling for canvas names, scripts, archives and the data directory

Running the server bound to a public interface without HTTPS and your own access control is outside
the supported configuration.
