/** Validate untrusted public lookup parameters before constructing SQL queries. */
export interface SafeLookupQuery {
  kind?: 'root' | 'device' | 'request' | 'result' | 'close' | 'event'
  service?: string
  devicePub?: string
  status?: 'open' | 'closed' | 'active' | 'revoked'
  outpoint?: string
  since?: number
  limit?: number
}
const kinds = new Set(['root', 'device', 'request', 'result', 'close', 'event'])
const statuses = new Set(['open', 'closed', 'active', 'revoked'])
const fields = new Set(['kind', 'service', 'devicePub', 'status', 'outpoint', 'since', 'limit'])
const integer = (v: unknown, min: number, max: number, name: string): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new Error(`invalid ${name}`)
  return v
}
export function validateLookupQuery (input: unknown): SafeLookupQuery {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('query must be an object')
  const q = input as Record<string, unknown>
  for (const key of Object.keys(q)) if (!fields.has(key)) throw new Error(`unknown query field ${key}`)
  const out: SafeLookupQuery = {}
  if (q.kind !== undefined) {
    if (typeof q.kind !== 'string' || !kinds.has(q.kind)) throw new Error('invalid kind')
    out.kind = q.kind as SafeLookupQuery['kind']
  }
  if (q.status !== undefined) {
    if (typeof q.status !== 'string' || !statuses.has(q.status)) throw new Error('invalid status')
    out.status = q.status as SafeLookupQuery['status']
    if (out.kind === 'device' && !['active', 'revoked'].includes(q.status)) throw new Error('status incompatible with device')
    if (out.kind === 'request' && !['open', 'closed'].includes(q.status)) throw new Error('status incompatible with request')
    if (out.kind !== undefined && !['device', 'request'].includes(out.kind)) throw new Error('status incompatible with kind')
  }
  if (q.service !== undefined) {
    if (typeof q.service !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(q.service)) throw new Error('invalid service')
    out.service = q.service
  }
  if (q.devicePub !== undefined) {
    if (typeof q.devicePub !== 'string' || !/^(02|03)[0-9a-fA-F]{64}$/.test(q.devicePub)) throw new Error('invalid devicePub')
    out.devicePub = q.devicePub
  }
  if (q.outpoint !== undefined) {
    if (typeof q.outpoint !== 'string' || !/^[0-9a-fA-F]{64}\.(0|[1-9][0-9]{0,9})$/.test(q.outpoint)) throw new Error('invalid outpoint')
    const idx = Number(q.outpoint.split('.')[1])
    integer(idx, 0, 0xffffffff, 'outpoint index')
    out.outpoint = q.outpoint
  }
  if (q.since !== undefined) out.since = integer(q.since, 0, Number.MAX_SAFE_INTEGER, 'since')
  if (q.limit !== undefined) out.limit = integer(q.limit, 1, 1000, 'limit')
  return out
}
