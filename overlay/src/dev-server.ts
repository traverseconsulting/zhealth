/**
 * Minimal zHealth overlay node for local development.
 *
 *   ZH_REGISTRAR_KEY=<hex pubkey> ZH_CHAIN=main|test|dev PORT=8080 node dist/src/dev-server.js
 *
 * Routes (BRC-22 / BRC-24):
 *   POST /submit        body: BEEF bytes (application/octet-stream), header X-Topics: ["tm_zhealth"]
 *   POST /lookup        body: { "service": "ls_zhealth", "query": { ... } }
 *   GET  /listTopicManagers, /listLookupServiceProviders, /health
 *
 * ZH_CHAIN=dev accepts any merkle root. Use it only with locally built test
 * transactions; main/test check roots against WhatsOnChain block headers.
 */
import http from 'node:http'
import { WhatsOnChain, Utils } from '@bsv/sdk'
import type { ChainTracker } from '@bsv/sdk'
import { createZHealthNode } from './engine.js'

const registrarKey = process.env.ZH_REGISTRAR_KEY
if (registrarKey == null) { console.error('Set ZH_REGISTRAR_KEY to the registrar public key (hex).'); process.exit(1) }
const chain = process.env.ZH_CHAIN ?? 'main'
const chainTracker: ChainTracker = chain === 'dev'
  ? { isValidRootForHeight: async () => true, currentHeight: async () => 1_000_000_000 }
  : new WhatsOnChain(chain === 'test' ? 'test' : 'main')
const db = process.env.ZH_DB ?? 'zhealth.sqlite'

const node = await createZHealthNode({
  registrarKey,
  chainTracker,
  knex: { client: 'sqlite3', connection: { filename: db }, useNullAsDefault: true, pool: { min: 1, max: 1 } },
  onReject: (txid, i, reason) => console.log(`rejected ${txid}.${i}: ${reason}`)
})

const body = async (req: http.IncomingMessage): Promise<Buffer> => {
  const parts: Buffer[] = []
  for await (const c of req) parts.push(c as Buffer)
  return Buffer.concat(parts)
}
const send = (res: http.ServerResponse, code: number, v: unknown): void => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-topics', 'access-control-allow-methods': 'GET, POST, OPTIONS' })
  res.end(JSON.stringify(v))
}

http.createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null)
      if (req.method === 'POST' && req.url === '/submit') {
        const topics = JSON.parse(String(req.headers['x-topics'] ?? '[]'))
        const steak = await node.engine.submit({ beef: Array.from(await body(req)), topics })
        return send(res, 200, steak)
      }
      if (req.method === 'POST' && req.url === '/lookup') {
        const answer = await node.engine.lookup(JSON.parse((await body(req)).toString('utf8')))
        if (answer.type === 'output-list') {
          return send(res, 200, { type: 'output-list', outputs: answer.outputs.map(o => ({ beef: Utils.toHex(o.beef), outputIndex: o.outputIndex, context: o.context != null ? Utils.toUTF8(o.context) : undefined })) })
        }
        return send(res, 200, answer)
      }
      if (req.method === 'GET' && req.url === '/listTopicManagers') return send(res, 200, await node.engine.listTopicManagers())
      if (req.method === 'GET' && req.url === '/listLookupServiceProviders') return send(res, 200, await node.engine.listLookupServiceProviders())
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true })
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 400, { error: e instanceof Error ? e.message : String(e) })
    }
  })()
}).listen(Number(process.env.PORT ?? 8080), () => console.log(`zHealth overlay node on :${process.env.PORT ?? 8080} (chain=${chain}, db=${db})`))
