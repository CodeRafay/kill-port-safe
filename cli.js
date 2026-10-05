#!/usr/bin/env node
'use strict'

const { killPorts, who } = require('./index.js')
const { version } = require('./package.json')

const HELP = `kill-port-safe ${version}: free a port by killing whatever listens on it

Usage
  kill-port-safe <ports...>         kill listeners (3000 | 3000,3001 | 3000-3005)
  kill-port-safe who <ports...>     show what is listening, kill nothing

Options
  -p, --port <list>     ports (kill-port compatible)
  -m, --method <proto>  tcp (default) or udp
  --signal <SIG>        signal to send (default SIGKILL)
  --graceful[=ms]       SIGTERM first, SIGKILL after ms (default 5000)
  --wait=<ms>           wait until the port is free (default 3000)
  --no-wait             return right after signalling
  --dry-run             same as "who"
  --strict              exit 1 if a port was already free
  --json                machine-readable output
  -q, --quiet           print nothing
  -v, --verbose         include command line and directory
  -h, --help            show this help
      --version         show version

Exit codes: 0 done or already free, 1 a kill failed, 2 bad arguments`

function fail (message) {
  console.error(`kill-port-safe: ${message}\nRun with --help for usage.`)
  process.exit(2)
}

function expand (token, ports) {
  for (const part of String(token).split(',')) {
    if (!part) continue
    const range = part.match(/^(\d+)-(\d+)$/)
    if (!range) { ports.push(part); continue }
    const [from, to] = [Number(range[1]), Number(range[2])]
    if (from > to || to - from > 10000) fail(`invalid port range "${part}"`)
    for (let p = from; p <= to; p++) ports.push(String(p))
  }
}

function parse (argv) {
  const opts = { ports: [], method: 'tcp', mode: 'kill', wait: undefined }
  const value = (i, name) => {
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('-')) fail(`${name} needs a value`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const take = (name) => inline !== undefined ? inline : value(i++, name)
    switch (flag) {
      case '-h': case '--help': opts.help = true; break
      case '--version': opts.version = true; break
      case '-p': case '--port': expand(take(flag), opts.ports); break
      case '-m': case '--method': opts.method = take(flag).toLowerCase(); break
      case '--signal': opts.signal = take(flag).toUpperCase(); break
      case '--graceful': opts.graceful = inline !== undefined ? Number(inline) : true; break
      case '--wait': opts.wait = Number(take(flag)); break
      case '--no-wait': opts.wait = 0; break
      case '--dry-run': opts.mode = 'who'; break
      case '--strict': opts.strict = true; break
      case '--json': opts.json = true; break
      case '-q': case '--quiet': case '--silent': opts.quiet = true; break
      case '-v': case '--verbose': opts.verbose = true; break
      default:
        if (arg.startsWith('-')) fail(`unknown option "${arg}"`)
        if (arg === 'who' && opts.ports.length === 0 && opts.mode === 'kill') opts.mode = 'who'
        else expand(arg, opts.ports)
    }
  }
  if (opts.method !== 'tcp' && opts.method !== 'udp') fail(`method must be tcp or udp, got "${opts.method}"`)
  if (opts.signal && !/^SIG[A-Z0-9]+$/.test(opts.signal)) opts.signal = `SIG${opts.signal}`
  if (opts.signal && !require('os').constants.signals[opts.signal]) fail(`unknown signal "${opts.signal}"`)
  if (opts.graceful !== undefined && opts.graceful !== true && !(opts.graceful > 0)) fail('--graceful needs a positive number of ms')
  if (opts.wait !== undefined && !(opts.wait >= 0)) fail('--wait needs a number of ms')
  return opts
}

function describe (p, verbose) {
  let s = `${p.name || 'unknown'} (PID ${p.pid})`
  if (verbose && p.command) s += `  ${p.command}`
  if (verbose && p.cwd) s += `  in ${p.cwd}`
  return s
}

function print (results, opts) {
  if (opts.quiet) return
  if (opts.json) return console.log(JSON.stringify(results, null, 2))
  for (const r of results) {
    const procs = r.processes.map((p) => describe(p, opts.verbose || opts.mode === 'who')).join(', ')
    const line = {
      busy: `● ${r.port}  ${procs}`,
      killed: `✓ ${r.port}  killed ${procs}`,
      free: `· ${r.port}  already free`,
      hidden: `? ${r.port}  in use by a process owned by another user; try sudo`,
      failed: `✗ ${r.port}  could not free${procs ? ` (${procs})` : ''}: ${(r.errors || []).join('; ')}`
    }[r.status]
    if (opts.mode === 'who' && r.status === 'free') console.log(`· ${r.port}  free`)
    else console.log(line)
  }
}

async function main () {
  const opts = parse(process.argv.slice(2))
  if (opts.help) return console.log(HELP)
  if (opts.version) return console.log(version)
  if (opts.ports.length === 0) fail('no port given')
  const bad = opts.ports.find((p) => !/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 65535)
  if (bad) fail(`invalid port "${bad}"`)

  const ports = opts.ports.map(Number)
  const results = opts.mode === 'who'
    ? await who(ports, { method: opts.method })
    : await killPorts(ports, { method: opts.method, signal: opts.signal, graceful: opts.graceful, wait: opts.wait, info: !opts.quiet })
  print(results, opts)

  if (results.some((r) => r.status === 'failed')) process.exitCode = 1
  else if (opts.strict && opts.mode === 'kill' && results.some((r) => r.status === 'free')) process.exitCode = 1
}

main().catch((error) => {
  console.error(`kill-port-safe: ${error.message}`)
  process.exitCode = 1
})
