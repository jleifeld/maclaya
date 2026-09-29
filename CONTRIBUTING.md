# Contributing to maclaya

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Before you start

For anything bigger than a small fix, please open an issue first so we can agree on the approach before you invest time.

## Setup

You need a Mac with Apple Silicon, Node.js 22.13 or newer, and `python3`.

```bash
git clone https://github.com/jleifeld/maclaya.git
cd maclaya
npm install
npm run build
node dist/cli.js serve
```

For work on the dashboard, run `npm run dev:web` next to a running `maclaya serve`. Vite serves the UI on `:5173` with hot reload and proxies `/api` and `/v1` to the server.

## Tests

```bash
npm test            # fast suite, uses a stub of laya_mlx, no model downloads
npm run test:e2e    # runs the real checkpoints on MLX, downloads them on first run
```

- New behavior needs tests. Prefer integration tests that go through the HTTP API or the CLI over unit tests of internals.
- API compatibility tests use the official `@typesafe-ai/sdk`. If you touch the API, extend them.

## Jev compatibility

Without the `X-Maclaya-Extras: 1` header, responses must match Jev field for field. Laya-only data goes behind that header. Documented differences from hosted Jev are listed in the README; add to that list if your change introduces a new one.

## Before opening a pull request

```bash
npm run lint:fix
npm run typecheck
npm test
```

CI runs the same checks on macOS. Keep pull requests focused on one change, and update the README and `CHANGELOG.md` when users will notice the difference.

## License

By contributing, you agree that your contributions are licensed under the [Apache-2.0 license](LICENSE).
