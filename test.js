'use strict'

const test = require('node:test')
const assert = require('node:assert')
const net = require('net')
const { spawn, execFile } = require('child_process')
const path = require('path')
const killPort = require('./index.js')
const { killPorts, who, _internal: { parseWindowsNetstat, parseProcNet, parseLsof } } = killPort

const CLI = path.join(__dirname, 'cli.js')
const isWin = process.platform === 'win32'

// ---------- parser fixtures (captured from real machines) ----------

test('windows netstat: exact port, listeners only, IPv6, UDP, localized state', () => {
  const text = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       100',
    '  TCP    [::]:3000              [::]:0                 ABHÖREN         101',
    '  TCP    [::1]:3000             [::]:0                 LISTENING       102',
    '  TCP    0.0.0.0:30001          0.0.0.0:0              LISTENING       200',
    '  TCP    127.0.0.1:3000         127.0.0.1:52000        ESTABLISHED     100',
    '  TCP    127.0.0.1:52000        127.0.0.1:3000         ESTABLISHED     300',
    '  TCP    127.0.0.1:3000         127.0.0.1:52001        TIME_WAIT       0',
    '  UDP    0.0.0.0:3000           *:*                                    400',
    '  UDP    [::1]:3000             *:*                                    401'
  ].join('\r\n')
  const tcp = parseWindowsNetstat(text, new Set([3000]), false)
  assert.deepStrictEqual([...tcp.get(3000)], [100, 101, 102])
  assert.strictEqual(tcp.size, 1)
  const udp = parseWindowsNetstat(text, new Set([3000]), true)
  assert.deepStrictEqual([...udp.get(3000)], [400, 401])
})

test('/proc/net/tcp: LISTEN state only, hex port', () => {
  const text = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11111 1 0000000000000000 100 0 0 10 0',
    '   1: 0100007F:0BB8 0100007F:CB20 01 00000000:00000000 00:00000000 00000000  1000        0 22222 1 0000000000000000 20 4 30 10 -1',
    '   2: 00000000:7531 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 33333 1 0000000000000000 100 0 0 10 0'
  ].join('\n')
  assert.deepStrictEqual([...parseProcNet(text, new Set([3000]), false)], [['11111', 3000]])
  assert.deepStrictEqual([...parseProcNet(text, new Set([30001]), false)], [['33333', 30001]])
})

test('lsof -F: exact port match', () => {
  const text = 'p123\nn*:3000\np456\nn127.0.0.1:30001\np789\nn[::1]:3000\n'
  const map = parseLsof(text, new Set([3000]))
  assert.deepStrictEqual([...map.get(3000)], [123, 789])
})

// ---------- integration on the current OS ----------

function bindable (port) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false))
    s.listen(port, () => s.close(() => resolve(true)))
  })
}

async function freePort () {
  const s = net.createServer().listen(0)
  await new Promise((resolve) => s.once('listening', resolve))
  const { port } = s.address()
  await new Promise((resolve) => s.close(resolve))
  return port
}

// Starts a child that listens on `port` and resolves once it is ready.
function listener (port, { host, udp, onTerm } = {}) {
  const code = udp
    ? `require('dgram').createSocket(${JSON.stringify(host && host.includes(':') ? 'udp6' : 'udp4')}).bind(${port}, ${JSON.stringify(host || '0.0.0.0')}, () => console.log('ready'))`
    : `require('net').createServer().listen(${port}, ${host ? JSON.stringify(host) : 'undefined'}, () => console.log('ready'))`
  const term = onTerm ? `;process.on('SIGTERM', () => { console.log('term'); process.exit(0) })` : ''
  const child = spawn(process.execPath, ['-e', code + term + ';setInterval(()=>{}, 1e6)'])
  child.output = ''
  child.stdout.on('data', (c) => { child.output += c })
  child.exited = new Promise((resolve) => child.once('exit', resolve))
  return new Promise((resolve, reject) => {
    child.stdout.once('data', () => resolve(child))
    child.once('exit', (c) => reject(new Error(`listener exited early (${c})`)))
  })
}

const alive = (child) => child.exitCode === null && child.signalCode === null

function cli (...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr })
    })
  })
}

test('kills a TCP listener, reports it, and the port is free afterwards', async () => {
  const port = await freePort()
  const child = await listener(port)
  const res = await cli(String(port))
  assert.strictEqual(res.code, 0, res.stdout + res.stderr)
  assert.match(res.stdout, new RegExp(`✓ ${port}  killed node`))
  await child.exited
  assert.ok(await bindable(port))
})

test('does not kill a port that merely contains the digits (3000 vs 30001)', async () => {
  let small
  for (let i = 0; i < 50 && !small; i++) {
    const p = 1024 + Math.floor(Math.random() * 5000)
    if (await bindable(p) && await bindable(p * 10 + 1)) small = p
  }
  const big = await listener(small * 10 + 1)
  const res = await cli(String(small))
  assert.strictEqual(res.code, 0)
  assert.match(res.stdout, /already free/)
  assert.ok(alive(big))
  big.kill()
})

test('does not kill a client connected to the port, only the listener', async () => {
  const port = await freePort()
  const server = await listener(port, { host: '127.0.0.1' })
  const client = spawn(process.execPath, ['-e', `require('net').connect(${port}, '127.0.0.1', () => console.log('ready')).on('error', () => {}); setInterval(() => {}, 1e6)`])
  await new Promise((resolve) => client.stdout.once('data', resolve))
  const res = await cli(String(port))
  assert.strictEqual(res.code, 0, res.stdout + res.stderr)
  await server.exited
  assert.ok(alive(client))
  client.kill()
})

test('kills an IPv6-only listener', async (t) => {
  const port = await freePort()
  let child
  try { child = await listener(port, { host: '::1' }) } catch { return t.skip('no IPv6 loopback') }
  const res = await cli(String(port))
  assert.strictEqual(res.code, 0, res.stdout + res.stderr)
  await child.exited
})

test('kills a UDP listener with -m udp', async () => {
  const port = await freePort()
  const child = await listener(port, { udp: true })
  const res = await cli(String(port), '--method', 'udp')
  assert.strictEqual(res.code, 0, res.stdout + res.stderr)
  await child.exited
})

test('ranges and comma lists', async () => {
  const a = await freePort()
  const b = await freePort()
  const c1 = await listener(a)
  const c2 = await listener(b)
  const res = await cli('--port', `${a},${b}`)
  assert.strictEqual(res.code, 0, res.stdout + res.stderr)
  await Promise.all([c1.exited, c2.exited])
  const range = await cli('--json', '--no-wait', `${a}-${a + 2}`)
  assert.deepStrictEqual(JSON.parse(range.stdout).map((r) => r.port), [a, a + 1, a + 2])
})

test('exit codes: free port 0, --strict 1, bad input 2', async () => {
  const port = await freePort()
  assert.strictEqual((await cli(String(port))).code, 0)
  assert.strictEqual((await cli(String(port), '--strict')).code, 1)
  assert.strictEqual((await cli('abc')).code, 2)
  assert.strictEqual((await cli('70000')).code, 2)
  assert.strictEqual((await cli('5-1')).code, 2)
  assert.strictEqual((await cli('--bogus', '3000')).code, 2)
  assert.strictEqual((await cli()).code, 2)
  assert.strictEqual((await cli('-q', String(port))).stdout, '')
})

test('who shows the listener without killing it', async () => {
  const port = await freePort()
  const child = await listener(port)
  const res = await cli('who', String(port))
  assert.strictEqual(res.code, 0)
  assert.match(res.stdout, /node/)
  assert.match(res.stdout, new RegExp(`PID ${child.pid}`))
  assert.ok(alive(child))
  const [r] = await who(port)
  assert.strictEqual(r.status, 'busy')
  child.kill()
})

test('--graceful lets the process handle SIGTERM', { skip: isWin && 'Windows has no SIGTERM for console apps' }, async () => {
  const port = await freePort()
  const child = await listener(port, { onTerm: true })
  const res = await cli('--graceful=2000', String(port))
  assert.strictEqual(res.code, 0, res.stdout + res.stderr)
  await child.exited
  assert.match(child.output, /term/)
})

test('--graceful escalates to a forced kill', async () => {
  const port = await freePort()
  const code = `process.on('SIGTERM', () => {}); require('net').createServer().listen(${port}, () => console.log('ready')); setInterval(() => {}, 1e6)`
  const child = spawn(process.execPath, ['-e', code])
  await new Promise((resolve) => child.stdout.once('data', resolve))
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const res = await cli('--graceful=300', String(port))
  assert.strictEqual(res.code, 0, res.stdout + res.stderr)
  await exited
})

test('library: killPort is kill-port compatible, killPorts never rejects on free', async () => {
  const port = await freePort()
  await assert.rejects(killPort(port), /No process running on port/)
  await assert.rejects(killPort('nope'), /Invalid port number provided/)
  const child = await listener(port)
  const res = await killPort(port, 'tcp')
  assert.deepStrictEqual(res.pids, [child.pid])
  const [r] = await killPorts([port])
  assert.strictEqual(r.status, 'free')
})

test('ESM import works', async () => {
  const mod = await import('./index.mjs')
  assert.strictEqual(typeof mod.default, 'function')
  assert.strictEqual(typeof mod.killPorts, 'function')
  assert.strictEqual(typeof mod.who, 'function')
})
