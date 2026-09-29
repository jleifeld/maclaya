# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-25

### Added

- `maclaya serve`: a Jev-compatible `POST /v1/systemone` and `GET /v1/models` API backed by Laya checkpoints running on MLX
- Language routing for `jev-latest` between the English and multilingual checkpoints
- Dashboard with request statistics and a searchable request log
- Playground with presets, a visual and a JSON editor, and curl, TypeScript and Python snippets
- System, light and dark theme switch for the dashboard
- `maclaya pull`, `predict`, `doctor` and `reset` commands
- Managed Python runtime through uv in `~/.maclaya`

[Unreleased]: https://github.com/jleifeld/maclaya/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jleifeld/maclaya/releases/tag/v0.1.0
