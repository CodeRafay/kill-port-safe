'use strict'

// Times how long a command takes to free a port held by a fresh listener.
// Usage: node bench.js [--runs=10] [--port=39123] -- <command> [args...]   ("{port}" is replaced)
//   node bench.js -- node cli.js {port}
//   npm i --no-save kill-port@2.0.1 && node bench.js -- node node_modules/kill-port/cli.js --port {port}
// "freed" is when both the command and the listener have exited.

const { spawn } = require('child_process')

const sep = process.argv.indexOf('--')
if (sep === -1 || sep === process.argv.length - 1) {
  console.error('usage: node bench.js [--runs=10] [--port=39123] -- <command> [args...]')
  process.exit(2)
}
const opt = (name, def) => Number((process.argv.slice(2, sep).find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1]) || def
const runs = opt('runs', 10)
const port = opt('port', 39123)
const [cmd, ...args] = process.argv.slice(sep + 1).map((a) => a.replace('{port}', port))

function listen () {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port}, () => console.log('up'))`])
    child.stdout.once('data', () => resolve(child))
    child.once('exit', (code) => reject(new Error(`listener exited with ${code}; is port ${port} free?`)))
  })
}

async function once () {
  const listener = await listen()
  listener.removeAllListeners('exit')
  const gone = new Promise((resolve) => listener.once('exit', resolve))
  const start = process.hrtime.bigint()
  const code = await new Promise((resolve) => spawn(cmd, args, { stdio: 'ignore' }).once('close', resolve))
  const timeout = setTimeout(() => listener.kill('SIGKILL'), 10000)
  await gone
  clearTimeout(timeout)
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, code }
}

async function main () {
  const times = []
  for (let i = 0; i < runs; i++) {
    const { ms, code } = await once()
    if (code !== 0) console.error(`run ${i + 1}: command exited with ${code}`)
    times.push(ms)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  console.log(`${process.platform} node ${process.version}  ${[cmd, ...args].join(' ')}`)
  console.log(`median ${median.toFixed(0)} ms  min ${times[0].toFixed(0)} ms  max ${times[times.length - 1].toFixed(0)} ms  (${runs} runs)`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
