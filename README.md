# kill-port-safe

**Free a port by killing the process using it, such as 3000, 5173 or 8080, on Windows, macOS, Linux and Docker.**
Fixes `EADDRINUSE: address already in use` in one command. Zero dependencies, and compatible with [`kill-port`](https://www.npmjs.com/package/kill-port).

```sh
npx kill-port-safe 3000
```

```
✓ 3000  killed node (PID 4812)
```

## Features

- **Kills only the right process.** It matches the exact port (3000 never touches 30001) and only the process *listening* on it, never apps that are merely connected.
- **Tells you what it killed.** The process name and PID, plus the command line and directory with `-v`. Use `who 3000` to look without killing anything.
- **Script- and CI-friendly.** Exits 0 when the port is already free, so `predev` and `pretest` hooks don't fail on a clean machine. Exits 1 when a kill really fails.
- **Graceful shutdown.** `--graceful` sends `SIGTERM` first and only force-kills if the process doesn't exit. `--signal` lets you choose the signal.
- **Works everywhere.** Windows (including IPv6 and non-English systems), macOS, Linux, and Alpine or distroless containers without `lsof`.
- **Fast.** Looks up only the ports you ask about, with no DNS lookups or full socket scans.
- **Safe to depend on.** Zero dependencies, no install scripts, never runs a shell, published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).
- **Easy to adopt.** CommonJS and ESM, TypeScript types included, port ranges (`3000-3005`), `--json`, `--quiet`.

## Compared to kill-port

`kill-port-safe` keeps kill-port's CLI and API, so switching is a one-line change. It also includes fixes for issues reported on kill-port over the years:

| | kill-port 2.0.1 (latest release) | kill-port-safe |
|---|---|---|
| Exact port matching ([#67](https://github.com/tiaanduplessis/kill-port/issues/67)) | substring match | exact |
| Works without `lsof` ([#9](https://github.com/tiaanduplessis/kill-port/issues/9), [#45](https://github.com/tiaanduplessis/kill-port/issues/45)) | needs `lsof` | reads `/proc` |
| Lookup speed on macOS / Linux ([#61](https://github.com/tiaanduplessis/kill-port/issues/61)) | scans all sockets | queries only the requested ports |
| Port already free ([#87](https://github.com/tiaanduplessis/kill-port/issues/87)) | error | exit 0 (`--strict` to fail) |
| Exit code when a kill fails | 0 | 1 |
| Signal choice / graceful shutdown ([#48](https://github.com/tiaanduplessis/kill-port/issues/48)) | SIGKILL only | `--signal`, `--graceful` |
| Port ranges ([#37](https://github.com/tiaanduplessis/kill-port/issues/37)) | — | `3000-3005` |
| `--quiet` ([#77](https://github.com/tiaanduplessis/kill-port/issues/77)) | — | yes |
| Shows what was killed | — | yes |
| Waits until the port is free | — | yes |
| TypeScript types ([#79](https://github.com/tiaanduplessis/kill-port/issues/79)) | via `@types/kill-port` | bundled |
| Module formats | CommonJS | CommonJS + ESM |
| Runtime dependencies | 2 | 0 |
| Runs commands through a shell | yes | never |

kill-port is actively maintained again: its master branch has since added exact port matching, `--quiet`, signal choice and bundled types, not yet released as of October 2026. It still needs `lsof`, fails when the port is already free and has no `who` or wait-until-free.

kill-port-safe is not affiliated with kill-port. Thanks to its maintainer and contributors; this project builds on their work (see [Credits](#credits)).

## Compared to kill-port-process and fkill

| | kill-port-process 5.0.0 | fkill 10 | kill-port-safe |
|---|---|---|---|
| Finds by port | yes | yes (`:3000`) | yes |
| Linux without `lsof` | needs `ss` | needs `ss` | reads `/proc`, needs nothing |
| `--graceful` | SIGTERM only, nothing on Windows | `forceAfterTimeout` | SIGTERM, then SIGKILL if still running |
| Port already free | error | error | exit 0 |
| Shows what it killed / `who` | — | — | yes |
| Waits until the port is free | — | — | yes |
| kill-port API compatible | no (`killPortProcess`) | no | yes |
| Node.js | ≥ 22 | ≥ 20, ESM only | ≥ 18, CommonJS + ESM |
| Runtime dependencies | 0 | 5 | 0 |

fkill is a general process killer (by PID or name, with a fuzzy-search CLI); use it if that's what you need.

## Switching from kill-port

```sh
npm uninstall kill-port
npm install --save-dev kill-port-safe
```

Your scripts don't need to change: the package also installs a `kill-port` command, and `require('kill-port-safe')` behaves like `require('kill-port')`.

```json
{
  "scripts": {
    "predev": "kill-port 3000"
  }
}
```

## CLI

```sh
kill-port-safe 3000                  # kill whatever listens on 3000
kill-port-safe 3000 5173 8080        # several ports
kill-port-safe 3000,3001             # comma list
kill-port-safe 3000-3005             # range
kill-port-safe --port 8080           # kill-port style
kill-port-safe 9000 --method udp     # UDP
kill-port-safe who 3000              # show what's on 3000, kill nothing
```

| Option | |
|---|---|
| `-p, --port <list>` | ports to free |
| `-m, --method <tcp\|udp>` | protocol, default `tcp` |
| `--signal <SIG>` | signal to send, default `SIGKILL` |
| `--graceful[=ms]` | send `SIGTERM`, then `SIGKILL` after `ms` (default 5000) |
| `--wait=<ms>` / `--no-wait` | how long to wait for the port to be released (default 3000) |
| `--dry-run` | same as `who` |
| `--strict` | exit 1 if a port was already free |
| `--json` | machine-readable output |
| `-q, --quiet` | no output |
| `-v, --verbose` | include command line and working directory |

**Exit codes:** `0` = freed or already free · `1` = a kill failed · `2` = invalid arguments.

## API

```js
const killPort = require('kill-port-safe')
// or: import killPort, { killPorts, who } from 'kill-port-safe'

// kill-port compatible: rejects with "No process running on port" if nothing listens
await killPort(3000)
await killPort(9000, 'udp')

// several ports, never rejects because a port was already free
const results = await killPorts([3000, 3001], { graceful: 2000 })
// [{ port: 3000, status: 'killed', processes: [{ pid: 4812, name: 'node', ... }] },
//  { port: 3001, status: 'free', processes: [] }]

// look without killing
const [info] = await who(3000)
// { port: 3000, status: 'busy', processes: [{ pid: 4812, name: 'node', command: 'node server.js', cwd: '/app' }] }
```

`killPorts` options: `method` (`'tcp'`/`'udp'`), `signal`, `graceful` (`true` or ms), `wait` (ms, `0` to skip), `info` (`false` skips the process-name lookup).
Status values: `killed`, `free`, `failed` (see `errors`), `hidden` (held by another user's process), `busy` (from `who`).

## FAQ

### How do I kill the process on port 3000?
```sh
npx kill-port-safe 3000
```
This works the same way on Windows, macOS and Linux.

### How do I fix "Error: listen EADDRINUSE: address already in use :::3000"?
Another process, often a dev server that didn't shut down, still holds the port. Run `npx kill-port-safe 3000`. To fix it for good, add `"predev": "kill-port-safe 3000"` to your `package.json` scripts.

### How do I see what's using a port without killing it?
```sh
npx kill-port-safe who 3000
```

### How do I stop a server gracefully instead of force-killing it?
`kill-port-safe 3000 --graceful` sends `SIGTERM`, waits up to 5 seconds for the process to exit, then force-kills it. On Windows, console apps can't receive `SIGTERM`, so they're terminated.

### Why does it say "owned by another user; try sudo"?
The port belongs to a process run by another user, often root (for example nginx or a system service). Run the command with `sudo` (or as Administrator on Windows) if you really want to kill it.

### How do I free port 5173 (Vite), 4200 (Angular) or 8080?
The same way, with any port: `npx kill-port-safe 5173`. Free several at once with `npx kill-port-safe 3000 5173 8080`.

### How do I kill a port on Windows without netstat and taskkill?
`npx kill-port-safe 3000` replaces `netstat -ano | findstr :3000` followed by `taskkill /PID <pid> /F`. It works in PowerShell, cmd and Git Bash.

### How do I kill a port on macOS or Linux without lsof?
`npx kill-port-safe 3000` replaces `lsof -i :3000` followed by `kill -9 <pid>`. On Linux it doesn't even need `lsof` installed.

### Is it safe to use in CI and Docker?
Yes. It has no dependencies, works without `lsof`, never runs commands through a shell, refuses to kill itself, its parent process or the Windows System process, and exits 0 when the port is already free, so a `predev` or `pretest` step won't fail on a clean machine.

### `npm install -g kill-port-safe` fails with EEXIST. Why?
kill-port-safe also installs a `kill-port` command so existing scripts keep working. If kill-port (or another package with a `kill-port` command) is already installed globally, npm refuses to overwrite it. Run `npm uninstall -g kill-port` first, or use the `kill-port-safe` command, which never clashes. In a project, don't install both packages side by side: npm and pnpm may pick different winners for the shared command.

### Why does zero dependencies matter?
In 2025, the [Shai-Hulud worm](https://www.blackduck.com/blog/npm-malware-attack-shai-hulud-threat.html) published infected versions of hundreds of npm packages, including kill-port 2.0.2 and 2.0.3, which have since been removed. Every dependency is one more package an attacker can compromise. kill-port-safe has none, has no install scripts, and every release is built and published by GitHub Actions with npm provenance, so you can verify exactly which source code it came from.

## Credits

The port-lookup approach builds on [kill-port](https://github.com/tiaanduplessis/kill-port) by Tiaan du Plessis and [kill-port-fast](https://github.com/ceifa/kill-port-fast) by ceifa (both MIT).

## License

MIT
