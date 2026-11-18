import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEvent, validateSignedTransaction, broadcastSignedTransaction, verifyMining } from '../integrations/bsv-live.mjs'

const event = { action: 'welcome', publicKey: '02' + 'a'.repeat(64), opReturn: 'Welcome to zHealth' }
test('accepts public synthetic event, rejects sensitive or malformed payloads', () => {
  assert.deepEqual(validateEvent(event), event)
  for (const candidate of [{ ...event, publicKey: 'private-key' }, { ...event, opReturn: '\n' }, { ...event, opReturn: 'a'.repeat(257) }, { ...event, action: '../secret' }, null]) {
    assert.throws(() => validateEvent(candidate))
  }
  assert.throws(() => validateSignedTransaction('deadbeef!'))
})
test('broadcast requires a valid transaction ID from the network', async () => {
  const txid = 'b'.repeat(64)
  const got = await broadcastSignedTransaction({ txhex: '01000000', fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'POST')
    return { ok: true, json: async () => ({ txid }) }
  } })
  assert.equal(got, txid)
  await assert.rejects(() => broadcastSignedTransaction({ txhex: '01000000', fetchImpl: async () => ({ ok: false, status: 400 }) }))
})
test('reported mining is not verified without independent proof', async () => {
  const txid = 'c'.repeat(64)
  const blockhash = 'd'.repeat(64)
  const fetchImpl = async () => ({ ok: true, json: async () => ({ blockhash, confirmations: 2 }) })
  assert.equal((await verifyMining({ txid, fetchImpl })).status, 'awaiting_proof_verification')
  assert.equal((await verifyMining({ txid, fetchImpl, verifier: async () => false })).status, 'awaiting_proof_verification')
  assert.equal((await verifyMining({ txid, fetchImpl, verifier: async ({ blockHash }) => blockHash === blockhash })).status, 'verified_mined')
  assert.equal((await verifyMining({ txid, fetchImpl: async () => ({ ok: true, json: async () => ({ confirmations: 0 }) }) })).status, 'pending')
})
