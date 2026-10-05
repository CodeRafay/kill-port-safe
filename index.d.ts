/** kill-port 2.x compatible. Rejects with "No process running on port" when nothing listens. */
declare function killPort (port: number | string, method?: killPort.Method): Promise<{
  port: number
  pids: number[]
  stdout: string
  stderr: string
  code: number
}>

declare namespace killPort {
  type Method = 'tcp' | 'udp'

  interface ProcessInfo {
    pid: number
    /** Executable name, e.g. "node". null if it could not be read. */
    name: string | null
    /** Full command line (Linux, macOS). */
    command: string | null
    /** Working directory (Linux). */
    cwd: string | null
  }

  interface PortResult {
    port: number
    /**
     * busy: in use (`who` only) · killed: freed · free: nothing was listening ·
     * hidden: held by another user's process · failed: see `errors`
     */
    status: 'busy' | 'killed' | 'free' | 'hidden' | 'failed'
    processes: ProcessInfo[]
    errors?: string[]
  }

  interface KillOptions {
    /** @default 'tcp' */
    method?: Method
    /** Signal to send. @default 'SIGKILL' ('SIGTERM' when graceful) */
    signal?: NodeJS.Signals
    /** Send SIGTERM, then SIGKILL after this many ms (true = 5000). */
    graceful?: boolean | number
    /** Look up process names (adds ~200ms on Windows). @default true */
    info?: boolean
    /** Wait up to this many ms for the port to be released; 0 disables. @default 3000 */
    wait?: number
  }

  /** Kill listeners on several ports. Never rejects because a port was already free. */
  function killPorts (ports: number | string | Array<number | string>, options?: KillOptions): Promise<PortResult[]>
  /** Report what listens on each port without killing anything. */
  function who (ports: number | string | Array<number | string>, options?: { method?: Method }): Promise<PortResult[]>
}

export = killPort
