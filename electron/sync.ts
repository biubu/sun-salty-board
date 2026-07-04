// LAN clipboard sync between SunSaltyBoard instances over self-signed TLS.
//
// Architecture:
//   * mDNS service discovery (multicast DNS) on `_sunsaltyboard._tcp.local`
//     announces this device and listens for others.
//   * Each peer runs an HTTPS+WSS server on PEER_PORT. TLS is self-signed and
//     regenerated on first run; clients opt out of cert verification with
//     `rejectUnauthorized: false` because there is no public CA — pairing is
//     out of scope for this milestone, so DO NOT enable this on untrusted
//     networks without a future pairing UI.
//   * On every clipboard event we broadcast the new payload to all connected
//     peers; on receive we ingest via workerBridge.storeItem.
//
// Known limitations (callouts):
//   * No device pairing / origin authentication beyond the self-signed cert.
//   * mDNS A-record target uses the discovered hostname; resolution assumes
//     the responder published a reachable A record (RFC 6762 §6.6).
//   * The service publishes only `127.0.0.1` for the A record on some
//     platforms; cross-host sync depends on the responder advertising the
//     real LAN IP via a SRV/A combo. We capture the address from TXT or SRV
//     targets and fall back to loopback.

import { createServer, Server as WsServer } from 'ws'
import type { WebSocket as WsClient } from 'ws'
import { createServer as createHttpsServer } from 'https'
import { readFileSync, existsSync, mkdirSync } from 'fs'
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
      } catch {
        // Ignore malformed frames; sync is best-effort.
      }
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
              // The local address is best-effort; SRV consumers that want
              // actual reachability should resolve via their own DNS or use
              // the A record the responder publishes. We publish loopback
              // because multicast-dns doesn't yet know our real interface
              // address on every platform.
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
            // Look for an A record in the same response so we can use a
            // real IP rather than the hostname the SRV advertised (which
            // requires additional resolution). Falls back to target.
            const aRecord = response.answers?.find(
              (a: any) => a.type === 'A' && a.name === target,
            )
            const address = aRecord?.data ?? target

            // TXT carries human-readable device name when advertised.
            const txtRecord = response.answers?.find(
              (a: any) => a.type === 'TXT' && a.name === `${target}.${SERVICE_TYPE}`,
            )
            const deviceNameFromTxt = txtRecord?.data
              ?.split('=')[1]
              ?.replace(/^device=/, '')

            peers.push({
              id: target,
              hostname: target,
              deviceName: deviceNameFromTxt || target,
              address,
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
  if (mdnsInstance) {
    try { mdnsInstance.removeAllListeners?.() } catch { /* best effort */ }
    try { mdnsInstance.destroy?.() } catch { /* best effort */ }
    mdnsInstance = null
  }
  for (const conn of connections) {
    try { conn.close() } catch { /* best effort */ }
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
    } catch {
      // Drop stale connections silently.
    }
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
    // Self-signed certs are the only choice on a LAN without a public CA;
    // pairing/ToFU is the proper long-term fix.
    rejectUnauthorized: false,
  }) as WsClient & { _peerId: string }
  ws._peerId = peer.id

  ws.on('open', () => {
    connections.push(ws)
  })
  ws.on('error', () => { /* ignore: peer offline */ })
}
