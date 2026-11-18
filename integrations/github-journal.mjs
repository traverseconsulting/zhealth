/**
 * GitHub-backed zHealth event journal. SERVER-SIDE ONLY.
 * GITHUB_TOKEN must be a fine-grained token scoped to this repository's Contents
 * read/write permission. Never bundle this module or its token in the web client.
 *
 * GitHub's create-if-absent contents API is used for optimistic concurrency.
 * Sequence is an event number, NOT a BSV block number.
 */
import { validateEvent, hashHex } from './bsv-live.mjs'

const ID = n => `ZBLK${String(n).padStart(6, '0')}`
const SAFE_ID = /^ZBLK[0-9]{6,}$/
const SAFE_TXID = /^[a-f0-9]{64}$/i
const pathFor = id => `blocks/${id}.json`
export function createGitHubJournal ({ owner, repo, branch, token, fetchImpl = fetch }) {
  if (![owner, repo, branch, token].every(x => typeof x === 'string' && x.length > 0)) throw new Error('GitHub configuration missing')
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const read = async id => {
    if (!SAFE_ID.test(id)) throw new Error('invalid record id')
    const response = await fetchImpl(base + pathFor(id) + `?ref=${encodeURIComponent(branch)}`, { headers })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub read failed: HTTP ${response.status}`)
    const result = await response.json()
    return { sha: result.sha, record: JSON.parse(Buffer.from(result.content.replace(/\s/g, ''), 'base64').toString('utf8')) }
  }
  const write = async (id, record, sha) => {
    const response = await fetchImpl(base + pathFor(id), {
      method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message: `zHealth journal ${id}: ${record.status}`, branch,
        content: Buffer.from(JSON.stringify(record, null, 2) + '\n').toString('base64'), ...(sha ? { sha } : {}) })
    })
    return response.status === 200 || response.status === 201 ? true : response.status === 409 || response.status === 422 ? false : Promise.reject(new Error(`GitHub write failed: HTTP ${response.status}`))
  }
  return {
    read,
    async append (event) {
      const safe = validateEvent(event)
      // Search for a free record; create-if-absent prevents overwriting on concurrent writes.
      // The retry limit is intentional: callers should retry later under heavy contention.
      for (let n = 1; n <= 1000000; n++) {
        const id = ID(n)
        if (await read(id) !== null) continue
        const record = { id, ...safe, timestamp: new Date().toISOString(), status: 'pending',
          txid: null, blockHash: null, confirmations: 0 }
        record.recordHash = hashHex(JSON.stringify(record))
        if (await write(id, record)) return record
      }
      throw new Error('journal capacity exceeded')
    },
    async markBroadcast (id, txid) {
      if (!SAFE_TXID.test(txid)) throw new Error('invalid txid')
      const current = await read(id)
      if (!current || current.record.status !== 'pending') throw new Error('record is not pending')
      const next = { ...current.record, status: 'broadcast', txid: txid.toLowerCase() }
      next.recordHash = hashHex(JSON.stringify({ ...next, recordHash: undefined }))
      if (!await write(id, next, current.sha)) throw new Error('concurrent record update')
      return next
    },
    async markVerified (id, evidence) {
      const current = await read(id)
      if (!current || current.record.status !== 'broadcast') throw new Error('record not broadcast')
      if (evidence?.status !== 'verified_mined' || !SAFE_TXID.test(evidence.blockHash ?? '') ||
          !Number.isSafeInteger(evidence.confirmations) || evidence.confirmations < 1) throw new Error('mining proof not verified')
      const next = { ...current.record, status: 'verified_mined', blockHash: evidence.blockHash,
        confirmations: evidence.confirmations }
      next.recordHash = hashHex(JSON.stringify({ ...next, recordHash: undefined }))
      if (!await write(id, next, current.sha)) throw new Error('concurrent record update')
      return next
    }
  }
}
