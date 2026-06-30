import { createServer, Server as WsServer } from 'ws'
import type { WebSocket as WsClient } from 'ws'
import { createServer as createHttpsServer } from 'https'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { generateCert } from './certGen'

interface SyncPeer {
  id: string
  hostname: string
  deviceName: string
  address: string
  port: number
}

interface ClipboardMessage {
  type: 'clipboard'
  content: string
  contentHtml?: string
  dataType: string
  imageData?: number[]
  filePaths?: string[]
  sourceDevice: string
  timestamp: string
}

const PEER_PORT = 41987
const SERVICE_TYPE = '_sunsaltyboard._tcp.local'

let server: WsServer | null = null
let httpsServer: ReturnType<typeof createHttpsServer> | null = null
let peers: SyncPeer[] = []
let connections: WsClient[] = []
let deviceName = ''
let mdnsInstance: any = null
let brower: any = null

export function setDeviceName(name: string): void {
  deviceName = name
}

function getHostname(): string {
  try {
    return app.getName() + '-' + Math.random().toString(36).slice(2, 6)
  } catch {
    return 'sunsaltyboard-' + Math.random().toString(36).slice(2, 6)
  }
}

export async function startSync(
  onReceive: (msg: ClipboardMessage) => void,
): Promise<void> {
  const hostname = getHostname()
  const certDir = join(app.getPath('userData'), 'certs')
  const keyPath = join(certDir, 'server.key')
  const certPath = join(certDir, 'server.cert')

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(certDir, { recursive: true })
    generateCert(keyPath, certPath)
  }

  httpsServer = createHttpsServer({
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  })

  server = createServer({ server: httpsServer })

  server.on('connection', (ws) => {
    connections.push(ws)
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClipboardMessage
        if (msg.type === 'clipboard') {
          onReceive(msg)
        }
      } catch { }
    })
    ws.on('close', () => {
      connections = connections.filter((c) => c !== ws)
    })
  })

  httpsServer.listen(PEER_PORT)

  try {
    const multicastDns = (await import('multicast-dns')) as any
    const mdns = multicastDns.default ? multicastDns.default() : multicastDns()
    mdnsInstance = mdns

    mdns.on('query', (query: any) => {
      const isForUs = query.questions?.some(
        (q: any) => q.name === SERVICE_TYPE,
      )
      if (isForUs) {
        mdns.respond({
          answers: [
            {
              name: SERVICE_TYPE,
              type: 'PTR',
              data: `${hostname}.${SERVICE_TYPE}`,
            },
            {
              name: `${hostname}.${SERVICE_TYPE}`,
              type: 'SRV',
              data: {
                port: PEER_PORT,
                target: hostname,
              },
            },
            {
              name: hostname,
              type: 'A',
              data: '127.0.0.1',
            },
            {
              name: `${hostname}.${SERVICE_TYPE}`,
              type: 'TXT',
              data: `device=${deviceName || hostname}`,
            },
          ],
        })
      }
    })

    brower = mdns
    mdns.query({
      questions: [{ name: SERVICE_TYPE, type: 'PTR' }],
    })

    mdns.on('response', (response: any) => {
      const srvRecords = response.answers?.filter(
        (a: any) => a.type === 'SRV',
      ) || []
      for (const srv of srvRecords) {
        const target = srv.data?.target
        const port = srv.data?.port || PEER_PORT
        if (target && target !== hostname) {
          const existing = peers.find((p) => p.hostname === target)
          if (!existing) {
            peers.push({
              id: target,
              hostname: target,
              deviceName: target,
              address: target,
              port,
            })
          }
        }
      }
    })
  } catch (err) {
    console.warn('[SunSaltyBoard-Sync] mDNS unavailable:', err)
  }
}

export function stopSync(): void {
  if (brower) {
    try { brower.removeAllListeners?.() } catch { }
    brower = null
    mdnsInstance = null
  }
  for (const conn of connections) {
    try { conn.close() } catch { }
  }
  connections = []
  peers = []
  if (server) {
    server.close()
    server = null
  }
  if (httpsServer) {
    httpsServer.close()
    httpsServer = null
  }
}

export function broadcastClipboard(msg: ClipboardMessage): void {
  const data = JSON.stringify(msg)
  for (const conn of connections) {
    try {
      conn.send(data)
    } catch { }
  }
}

export function getPeers(): SyncPeer[] {
  return peers
}

export function connectToPeer(peer: SyncPeer): void {
  const existing = connections.some((c) => (c as any)._peerId === peer.id)
  if (existing) return

  const Ws = require('ws') as typeof import('ws')
  const ws = new Ws(`wss://${peer.address}:${peer.port}`, {
    rejectUnauthorized: false,
  }) as WsClient & { _peerId: string }
  ws._peerId = peer.id

  ws.on('open', () => {
    connections.push(ws)
  })
  ws.on('error', () => { })
}
