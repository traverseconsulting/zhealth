import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newSession, ACCOUNT_PATH } from '../src/chain.js'
import { serviceId, DEVICE_MODELS } from '../src/devices.js'
import { randomPeerKey, sharedSecretHex, matchCode, closeAddressForPatient, closeKeyForPatient } from '../src/ecdh.js'

test('session derives unique one-time hardened keys', () => {
  const session = newSession()
  const a = session.nextKey()
  const b = session.nextKey()
  assert.equal(a.index, 0)
  assert.equal(b.index, 1)
  assert.equal(a.path, `${ACCOUNT_PATH}/0'`)
  assert.equal(b.path, `${ACCOUNT_PATH}/1'`)
  assert.notEqual(a.pubHex, b.pubHex)
  assert.equal(a.publicKey.length, 33)
})
test('service identifiers are deterministic and unique across models', () => {
  const slugs = [...new Set(DEVICE_MODELS.flatMap(m => m.services))]
  const ids = slugs.map(serviceId)
  assert.equal(slugs.length, 33)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[0-9a-f]{16}$/)
})
test('patient and provider derive matching ECDH secret and close address', () => {
  const patient = randomPeerKey()
  const provider = randomPeerKey()
  const requestTxid = 'a'.repeat(64)
  assert.equal(sharedSecretHex(patient.privHex, provider.pubHex), sharedSecretHex(provider.privHex, patient.pubHex))
  assert.equal(matchCode(patient.privHex, provider.pubHex), matchCode(provider.privHex, patient.pubHex))
  const derived = closeKeyForPatient(patient.privHex, provider.pubHex, requestTxid)
  assert.equal(derived.address, closeAddressForPatient(provider.privHex, patient.pubHex, requestTxid))
})
