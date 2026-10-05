'use strict'

// Port-finding logic adapted from kill-port-fast (MIT, ceifa) and kill-port (MIT, Tiaan du Plessis).

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const NO_PROCESS = 'No process running on port'
const isWin = process.platform === 'win32'

const isUdp = (method) => String(method || 'tcp').toLowerCase() === 'udp'
const toPid = (value) => {
  const n = Number.parseInt(String(value), 10)
  return n > 0 ? n : null
}
const toPort = (value) => {
  const s = String(value).trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n >= 1 && n <= 65535 ? n : null
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const portFromAddress = (address) => toPort(address.slice(address.lastIndexOf(':') + 1))

// Never a shell: arguments go straight to the binary, so nothing can be injected.
function run (cmd, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch (error) {
      return resolve({ stdout: '', stderr: '', code: null, error })
    }
    const out = []
    const err = []
    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => err.push(c))
    child.on('error', (error) => resolve({ stdout: '', stderr: '', code: null, error }))
    child.on('close', (code) => resolve({
      stdout: Buffer.concat(out).toString(),
      stderr: Buffer.concat(err).toString(),
      code,
      error: null
    }))
  })
}

function add (map, port, pid) {
  if (!map.has(port)) map.set(port, new Set())
  map.get(port).add(pid)
}

// ---------- parsers (pure, unit-tested against captured output) ----------

// `netstat -nao` on Windows. TCP rows are listeners when the foreign address is
// 0.0.0.0:0 / [::]:0 — the State column is localized, so it is never read.
// UDP rows have no State column; the PID is always the last column.
function parseWindowsNetstat (text, portSet, udp) {
  const map = new Map()
  const proto = udp ? 'UDP' : 'TCP'
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts[0] !== proto || parts.length < 4) continue
    const port = portFromAddress(parts[1])
    if (!port || !portSet.has(port)) continue
    if (!udp && !/^(0\.0\.0\.0|\[::\]):0$/.test(parts[2])) continue
    const pid = toPid(parts[parts.length - 1])
    if (pid !== null) add(map, port, pid)
  }
  return map
}

// /proc/net/{tcp,tcp6,udp,udp6}: returns socket inode -> port for matching rows.
// TCP state 0A is LISTEN; any bound UDP socket counts.
function parseProcNet (text, portSet, udp) {
  const inodes = new Map()
  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/)
    if (parts.length < 10) continue
    const port = Number.parseInt(parts[1].slice(parts[1].lastIndexOf(':') + 1), 16)
    if (!portSet.has(port)) continue
    if (!udp && parts[3] !== '0A') continue
    if (parts[9] !== '0') inodes.set(parts[9], port)
  }
  return inodes
}

// `lsof -nP -Fpn`: lines starting with p<pid> then n<address>.
function parseLsof (text, portSet) {
  const map = new Map()
  let pid = null
  for (const line of text.split(/\r?\n/)) {
    if (line[0] === 'p') pid = toPid(line.slice(1))
    else if (line[0] === 'n' && pid) {
      const m = line.match(/:(\d+)(?:->|\s|$)/)
      const port = m && Number(m[1])
      if (port && portSet.has(port)) add(map, port, pid)
    }
  }
  return map
}

// ---------- finders: ports -> Map<port, Set<pid>> ----------

async function findWindows (portSet, udp) {
  // Full table, not `-p TCP`: that filter hides IPv6-only listeners such as ::1.
  const res = await run('netstat', ['-nao'])
  if (res.error) throw res.error
  return { map: parseWindowsNetstat(res.stdout, portSet, udp), hidden: new Set() }
}

function findLinuxProc (portSet, udp) {
  const files = udp ? ['/proc/net/udp', '/proc/net/udp6'] : ['/proc/net/tcp', '/proc/net/tcp6']
  const inodes = new Map()
  let readAny = false
  for (const file of files) {
    let text
    try { text = fs.readFileSync(file, 'latin1') } catch { continue }
    readAny = true
    for (const [inode, port] of parseProcNet(text, portSet, udp)) inodes.set(`socket:[${inode}]`, port)
  }
  if (!readAny) return null

  const map = new Map()
  if (inodes.size === 0) return { map, hidden: new Set() }
  const found = new Set()
  // Scans every process's fds (same as lsof/fuser); fine for dev machines.
  for (const entry of fs.readdirSync('/proc')) {
    const pid = toPid(entry)
    if (pid === null || String(pid) !== entry) continue
    let fds
    try { fds = fs.readdirSync(`/proc/${entry}/fd`) } catch { continue }
    for (const fd of fds) {
      let link
      try { link = fs.readlinkSync(`/proc/${entry}/fd/${fd}`) } catch { continue }
      const port = inodes.get(link)
      if (port !== undefined) { add(map, port, pid); found.add(link) }
    }
  }
  // A listening socket whose owner we cannot read belongs to another user (usually root).
  const hidden = new Set()
  for (const [link, port] of inodes) if (!found.has(link) && !map.has(port)) hidden.add(port)
  return { map, hidden }
}

async function findLsof (portSet, udp) {
  const list = [...portSet].join(',')
  const args = udp ? ['-nP', `-iUDP:${list}`, '-Fpn'] : ['-nP', `-iTCP:${list}`, '-sTCP:LISTEN', '-Fpn']
  const res = await run('lsof', args)
  if (res.error) {
    if (res.error.code === 'ENOENT') throw new Error('lsof is not installed; install it (e.g. `apk add lsof`) or run on Linux with /proc')
    throw res.error
  }
  // lsof exits 1 when nothing matches.
  if (res.code > 1) throw new Error(res.stderr.trim() || 'lsof failed')
  return { map: parseLsof(res.stdout, portSet), hidden: new Set() }
}

async function find (ports, method) {
  const portSet = new Set(ports)
  const udp = isUdp(method)
  if (isWin) return findWindows(portSet, udp)
  if (process.platform === 'linux') {
    const res = findLinuxProc(portSet, udp)
    if (res) return res
  }
  // macOS lsof -F output is stable across releases, unlike netstat's columns.
  return findLsof(portSet, udp)
}

// ---------- process details ----------

async function describe (pids) {
  const info = new Map(pids.map((pid) => [pid, { pid, name: null, command: null, cwd: null }]))
  if (pids.length === 0) return info
  if (process.platform === 'linux') {
    for (const pid of pids) {
      const p = info.get(pid)
      // argv[0] first: /proc/<pid>/comm holds the thread name (Node 24 reports "MainThread").
      try {
        const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
        p.command = argv.join(' ') || null
        if (argv[0]) p.name = path.basename(argv[0])
      } catch {}
      if (!p.name) try { p.name = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() } catch {}
      try { p.cwd = fs.readlinkSync(`/proc/${pid}/cwd`) } catch {}
    }
  } else if (isWin) {
    // Name only; full command lines on Windows need PowerShell (~500ms startup).
    // A filtered tasklist per PID is ~200ms vs ~650ms for the full list.
    await Promise.all(pids.map(async (pid) => {
      const res = await run('tasklist', ['/FO', 'CSV', '/NH', '/FI', `PID eq ${pid}`])
      const cols = res.stdout.match(/"([^"]*)"/g)
      if (cols && toPid(cols[1] && cols[1].slice(1, -1)) === pid) info.get(pid).name = cols[0].slice(1, -1)
    }))
  } else {
    // -ww: macOS truncates columns otherwise. Separate calls because comm may contain spaces.
    const read = async (field) => {
      const res = await run('ps', ['-ww', '-o', 'pid=', '-o', `${field}=`, '-p', pids.join(',')])
      for (const line of res.stdout.split('\n')) {
        const m = line.match(/^\s*(\d+) (.*)$/)
        if (m && info.has(Number(m[1]))) info.get(Number(m[1]))[field] = m[2].trim()
      }
    }
    await Promise.all([read('comm'), read('args')])
    for (const p of info.values()) {
      p.name = p.comm ? path.basename(p.comm) : null
      p.command = p.args || null
      delete p.comm
      delete p.args
    }
  }
  return info
}

// ---------- killing ----------

function protectedReason (pid) {
  if (pid === process.pid || pid === process.ppid) return 'refusing to kill itself or its parent'
  if (isWin && pid === 4) return 'owned by Windows (System / http.sys); stop the service using it instead'
  return null
}

// Resolves to null on success (or already gone), or an error message.
async function signalPid (pid, signal) {
  if (isWin && (signal === 'SIGTERM' || signal === 'SIGINT')) {
    // process.kill on Windows always force-terminates; taskkill without /F asks politely.
    const res = await run('taskkill', ['/PID', String(pid)])
    if (res.error) return res.error.message
    if (res.code === 0 || res.code === 128) return null // 128: process not found
    return (res.stderr || res.stdout).trim() || `taskkill exited with ${res.code}`
  }
  try {
    process.kill(pid, signal)
    return null
  } catch (error) {
    if (error.code === 'ESRCH') return null
    if (error.code === 'EPERM') return 'permission denied (owned by another user); try sudo'
    return error.message
  }
}

async function waitFree (ports, method, timeout) {
  const deadline = Date.now() + timeout
  let busy = new Set(ports)
  while (busy.size > 0) {
    const { map } = await find([...busy], method)
    busy = new Set(map.keys())
    if (busy.size === 0 || Date.now() >= deadline) break
    await sleep(100)
  }
  return busy
}

function normalizePorts (ports) {
  const list = (Array.isArray(ports) ? ports : [ports]).map(toPort)
  if (list.length === 0 || list.some((p) => p === null)) throw new Error('Invalid port number provided')
  return [...new Set(list)]
}

async function who (ports, options = {}) {
  const list = normalizePorts(ports)
  const { map, hidden } = await find(list, options.method)
  const all = [...new Set([...map.values()].flatMap((s) => [...s]))]
  const info = await describe(options.info === false ? [] : all)
  return list.map((port) => {
    const pids = [...(map.get(port) || [])]
    return {
      port,
      status: pids.length ? 'busy' : hidden.has(port) ? 'hidden' : 'free',
      processes: pids.map((pid) => info.get(pid) || { pid, name: null, command: null, cwd: null })
    }
  })
}

async function killPorts (ports, options = {}) {
  const method = options.method || 'tcp'
  const graceful = options.graceful === true ? 5000 : Number(options.graceful) || 0
  const signal = options.signal || (graceful ? 'SIGTERM' : 'SIGKILL')
  const wait = options.wait === undefined ? 3000 : Number(options.wait) || 0

  const before = await who(ports, { method, info: options.info })
  const results = before.map((r) => ({ ...r, status: r.status === 'busy' ? 'killed' : r.status, errors: [] }))
  const targets = new Map() // pid -> results that depend on it
  for (const r of results) {
    if (r.status === 'hidden') r.errors.push('a process owned by another user holds this port; try sudo')
    for (const p of r.processes) {
      const reason = protectedReason(p.pid)
      if (reason) r.errors.push(`PID ${p.pid}: ${reason}`)
      else targets.set(p.pid, [...(targets.get(p.pid) || []), r])
    }
  }

  const sendAll = async (sig, pids, record = true) => {
    for (const pid of pids) {
      const err = await signalPid(pid, sig)
      if (err && record) for (const r of targets.get(pid)) r.errors.push(`PID ${pid}: ${err}`)
    }
  }
  // A polite signal may be refused (Windows console apps); the SIGKILL escalation reports real failures.
  await sendAll(signal, targets.keys(), !graceful)

  const busyPorts = () => results.filter((r) => r.status === 'killed').map((r) => r.port)
  if (graceful && targets.size) {
    const still = await waitFree(busyPorts(), method, graceful)
    if (still.size) {
      const pids = [...targets.keys()].filter((pid) => targets.get(pid).some((r) => still.has(r.port)))
      await sendAll('SIGKILL', pids)
    }
  }
  if (wait && targets.size) {
    const still = await waitFree(busyPorts(), method, wait)
    for (const r of results) if (still.has(r.port) && !r.errors.length) r.errors.push('port is still in use after kill')
  }

  for (const r of results) if (r.errors.length) r.status = 'failed'
  return results
}

// kill-port 2.x compatible: one port, rejects when nothing is listening.
async function killPort (port, method = 'tcp') {
  const p = toPort(port)
  if (!p) throw new Error('Invalid port number provided')
  const [r] = await killPorts([p], { method, info: false })
  if (r.status === 'free') throw new Error(NO_PROCESS)
  if (r.status === 'failed') throw new Error(r.errors.join('; '))
  return { port: p, pids: r.processes.map((x) => x.pid), stdout: '', stderr: '', code: 0 }
}

module.exports = killPort
module.exports.default = killPort
module.exports.killPort = killPort
module.exports.killPorts = killPorts
module.exports.who = who
module.exports._internal = { parseWindowsNetstat, parseProcNet, parseLsof, toPort }
