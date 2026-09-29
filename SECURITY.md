# Security policy

## Supported versions

Security fixes go into the latest release on npm. Please update before reporting.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through [GitHub security advisories](https://github.com/jleifeld/maclaya/security/advisories/new) instead, with steps to reproduce and the output of `npx maclaya doctor`.

Once a fix is released, the advisory is published with credit to you, unless you prefer otherwise.

## Scope

maclaya is a local HTTP server, so these are especially relevant:

- Reaching the API or dashboard from another machine when it shouldn't be possible (the default bind is `127.0.0.1`, the dashboard is localhost-only without `--expose-dashboard`)
- Bypassing `--api-key`
- Leaking request or response bodies stored in `~/.maclaya/stats.db`, or storing them despite `--no-log-bodies`
- Code execution through request payloads, checkpoint names or environment handling

Answers the Laya models give are out of scope, unless they lead to one of the issues above.
