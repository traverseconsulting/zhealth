/**
 * zHealth live BSV adapter. Server-side only. No private keys or funding credentials
 * are accepted by this module. The caller must supply a fully funded, signed tx.
 *
 * Confirmation is fail-closed: a MINED API status alone is not proof. A separate
 * verifier must validate the transaction's Merkle inclusion against a trusted header.
 */
import { createHash } from 'node:crypto'

const TXID = /^[0-9a-f]{64}$/i
const PUBKEY = /^(02|03)[0-9a-f]{64}$/i
const HEX = /^(?:[0-9a-f]{2})+$/i
export const hashHex = value => createHash('sha256').update(value).digest('hex')
export const validateEvent = event => {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) throw new Error('invalid event')
  const { action, publicKey, opReturn } = event
  if (typeof action !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(action)) throw new Error('invalid action')
  if (typeof publicKey !== 'string' || !PUBKEY.test(publicKey)) throw new Error('invalid compressed public key')
  if (typeof opReturn !== 'string' || opReturn.length > 256 || !/^[\x20-\x7e]*$/.test(opReturn)) throw new Error('OP_RETURN must be printable ASCII, max 256 characters')
  return { action, publicKey: publicKey.toLowerCase(), opReturn }
}
export const validateSignedTransaction = txhex => {
  if (typeof txhex !== 'string' || txhex.length > 200000 || !HEX.test(txhex)) throw new Error('invalid signed transaction hex')
  return txhex.toLowerCase()
}
export async function broadcastSignedTransaction ({ txhex, network = 'test', fetchImpl = fetch }) {
  validateSignedTransaction(txhex)
  if (!['test', 'main'].includes(network)) throw new Error('invalid BSV network')
  const res = await fetchImpl(`https://api.whatsonchain.com/v1/bsv/${network}/tx/raw`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txhex })
  })
  if (!res.ok) throw new Error(`broadcast rejected: HTTP ${res.status}`)
  const data = await res.json()
  const txid = typeof data === 'string' ? data : data.txid
  if (typeof txid !== 'string' || !TXID.test(txid)) throw new Error('broadcaster returned no valid txid')
  return txid.toLowerCase()
}
export async function fetchChainStatus ({ txid, network = 'test', fetchImpl = fetch }) {
  if (!TXID.test(txid) || !['test', 'main'].includes(network)) throw new Error('invalid status query')
  const res = await fetchImpl(`https://api.whatsonchain.com/v1/bsv/${network}/tx/hash/${txid}`)
  if (!res.ok) throw new Error(`status query failed: HTTP ${res.status}`)
  const data = await res.json()
  return {
    status: Number.isSafeInteger(data.confirmations) && data.confirmations > 0 && TXID.test(data.blockhash ?? '') ? 'reported_mined' : 'pending',
    blockHash: TXID.test(data.blockhash ?? '') ? data.blockhash.toLowerCase() : null,
    confirmations: Number.isSafeInteger(data.confirmations) ? data.confirmations : 0
  }
}
export async function verifyMining ({ txid, network = 'test', verifier, fetchImpl = fetch }) {
  const status = await fetchChainStatus({ txid, network, fetchImpl })
  if (status.status !== 'reported_mined') return { status: 'pending' }
  if (typeof verifier !== 'function') return { status: 'awaiting_proof_verification', ...status }
  const verified = await verifier({ txid, blockHash: status.blockHash, network })
  return verified === true ? { status: 'verified_mined', ...status } : { status: 'awaiting_proof_verification', ...status }
}
