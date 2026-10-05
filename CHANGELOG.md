# Changelog

All notable changes are listed here. This project follows [semver](https://semver.org): breaking changes only in major versions.

## 0.1.0

First release.

- Drop-in replacement for `kill-port` 2.x: same CLI flags (`--port`, `--method`, `--verbose`), same `require('kill-port')`-style default export, and a `kill-port` bin alias.
- Exact port matching: killing 3000 never touches 30001.
- Kills listeners only, never processes that are merely connected to the port.
- Linux reads `/proc` directly (works in Alpine, distroless and containers without `lsof`).
- Windows: IPv6-only listeners (`::1`), non-English Windows, UDP.
- Exit code 0 when the port is already free, 1 on failure, 2 on bad input. `--strict` fails on free ports.
- `--signal`, `--graceful[=ms]` (SIGTERM, then SIGKILL), `--wait`/`--no-wait`, port ranges (`3000-3005`), `--quiet`, `--json`.
- `who <port>` / `--dry-run`: shows what is on a port without killing it.
- Reports what it killed (process name and PID; command line and directory with `-v`).
- Clear message when another user's process holds the port.
- Refuses to kill itself, its parent, or the Windows System process.
- Zero dependencies, CommonJS and ESM, bundled TypeScript types.
