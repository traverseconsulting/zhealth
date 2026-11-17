import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateLookupQuery } from '../src/lookup-validation.js'

test('accepts valid bounded lookup parameters', () => {
  assert.deepEqual(validateLookupQuery({ kind: 'request', status: 'open', since: 0, limit: 100 }), { kind: 'request', status: 'open', since: 0, limit: 100 })
  assert.deepEqual(validateLookupQuery({}), {})
  assert.deepEqual(validateLookupQuery({ outpoint: 'a'.repeat(64) + '.0' }), { outpoint: 'a'.repeat(64) + '.0' })
})
test('rejects malformed and unbounded lookup requests', () => {
  for (const q of [null, [], 'x', { limit: 0 }, { limit: 1001 }, { limit: '10' }, { limit: NaN }, { since: -1 }, { since: 1.2 }, { since: Infinity }, { kind: 'bogus' }, { status: 'unknown' }, { kind: 'device', status: 'closed' }, { kind: 'result', status: 'open' }, { extra: 1 }, { service: '%_' }, { devicePub: 'x' }, { outpoint: 'x.0' }, { outpoint: 'a'.repeat(64) + '.4294967296' }, { outpoint: 'a'.repeat(64) + '.1e3' }]) {
    assert.throws(() => validateLookupQuery(q), undefined, JSON.stringify(q))
  }
})
