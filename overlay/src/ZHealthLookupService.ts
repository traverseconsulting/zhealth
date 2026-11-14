/**
 * ls_zhealth — the zHealth lookup service (BRC-24).
 *
 * Indexes every token admitted by tm_zhealth into the public zHealth database
 * and answers queries about it. Answers are output lists: the host attaches
 * the BEEF (transaction + SPV proof) for every output, so a client or a
 * joining node can verify each record against block headers on its own.
 */
import { Utils } from '@bsv/sdk'
import type { LookupQuestion } from '@bsv/sdk'
import type { Knex } from 'knex'
import type { LookupService, LookupFormula, OutputAdmittedByTopic, OutputSpent } from '@bsv/overlay'
import { TOPIC, LOOKUP_SERVICE, KINDS, serviceBySlug, decodeRecord } from './protocol.js'
import { ZHealthStorage, migrations } from './storage.js'

export interface ZHealthQuery {
  /** Record kind. Omit to search all kinds. */
  kind?: 'root' | 'device' | 'request' | 'result' | 'close' | 'event'
  /** Service ID (16 hex) or catalog slug, e.g. "temperature". */
  service?: string
  devicePub?: string
  /** request: open | closed, device: active | revoked. */
  status?: 'open' | 'closed' | 'active' | 'revoked'
  /** "txid.outputIndex" */
  outpoint?: string
  /** Sync cursor: only records with seq greater than this. Each answer's context is its seq. */
  since?: number
  limit?: number
}

const MAX = 1000

export class ZHealthLookupService implements LookupService {
  readonly admissionMode = 'locking-script' as const
  readonly spendNotificationMode = 'txid' as const

  constructor (readonly storage: ZHealthStorage) {}

  async outputAdmittedByTopic (p: OutputAdmittedByTopic): Promise<void> {
    if (p.mode !== 'locking-script' || p.topic !== TOPIC) return
    await this.storage.insert(p.txid, p.outputIndex, decodeRecord(p.lockingScript))
  }

  async outputSpent (p: OutputSpent): Promise<void> {
    if (p.topic !== TOPIC) return
    await this.storage.markSpent(p.txid, p.outputIndex, 'spendingTxid' in p ? p.spendingTxid : null)
  }

  async outputNoLongerRetainedInHistory (txid: string, outputIndex: number, topic: string): Promise<void> {
    if (topic === TOPIC) await this.storage.remove(txid, outputIndex)
  }

  async outputEvicted (txid: string, outputIndex: number): Promise<void> {
    await this.storage.remove(txid, outputIndex)
  }

  async lookup (question: LookupQuestion): Promise<LookupFormula> {
    if (question.service !== LOOKUP_SERVICE) throw new Error(`lookup service ${LOOKUP_SERVICE} cannot answer ${question.service}`)
    const q = (question.query ?? {}) as ZHealthQuery
    if (typeof q !== 'object') throw new Error('query must be an object')

    let b = this.storage.query()
    if (q.kind != null) {
      const kind = q.kind.toUpperCase()
      if (!(KINDS as readonly string[]).includes(kind)) throw new Error(`unknown kind ${q.kind}`)
      b = b.where('kind', kind)
    }
    if (q.service != null) {
      const id = /^[0-9a-f]{16}$/.test(q.service) ? q.service : serviceBySlug(q.service)?.id
      if (id == null) throw new Error(`unknown service ${q.service}`)
      // Devices list every service they are trusted for.
      b = b.where(w => { void w.where('serviceId', id).orWhere('serviceIds', 'like', `%${id}%`) })
    }
    if (q.devicePub != null) b = b.where('devicePub', q.devicePub)
    if (q.status != null) {
      if (!['open', 'closed', 'active', 'revoked'].includes(q.status)) throw new Error(`unknown status ${q.status}`)
      b = b.where('spent', q.status === 'closed' || q.status === 'revoked')
    }
    if (q.outpoint != null) {
      const [txid, idx] = q.outpoint.split('.')
      b = b.where({ txid, outputIndex: Number(idx) })
    }
    if (q.since != null) b = b.where('seq', '>', Number(q.since))
    const limit = Math.min(Math.max(Number(q.limit ?? MAX), 1), MAX)

    const rows = await b.orderBy('seq', 'asc').limit(limit).select('seq', 'txid', 'outputIndex')
    return rows.map(r => ({ txid: r.txid, outputIndex: r.outputIndex, context: Utils.toArray(String(r.seq), 'utf8') }))
  }

  async getDocumentation (): Promise<string> {
    return DOCS
  }

  async getMetaData (): Promise<{ name: string, shortDescription: string, version: string }> {
    return { name: LOOKUP_SERVICE, shortDescription: 'Query the public zHealth database: root, trusted devices, requests, results, closes.', version: '1' }
  }
}

/** Factory in the shape OverlayExpress.configureLookupServiceWithKnex expects. */
export function createZHealthLookupService (storage: ZHealthStorage) {
  return (knex: Knex): { service: ZHealthLookupService, migrations: typeof migrations } => {
    storage.attach(knex)
    return { service: new ZHealthLookupService(storage), migrations }
  }
}

const DOCS = `# ls_zhealth

POST /lookup with { "service": "ls_zhealth", "query": { ... } }.

| Query | Returns |
|---|---|
| { "kind": "root" } | The ROOT token that identifies the overlay |
| { "kind": "device", "service": "temperature", "status": "active" } | Trusted devices for a service |
| { "kind": "request", "service": "<svcId>", "status": "open" } | Open service requests (the contract board) |
| { "kind": "result", "devicePub": "<hex>" } | Results produced by a device |
| { "outpoint": "<txid>.<index>" } | One record |
| { "since": 0, "limit": 1000 } | Every record in admission order. Each output's context is its sequence number; pass the last one back as "since" to page. A joining node uses this to download the database. |

Every answer is an output list with BEEF, so each record can be checked with SPV.`
