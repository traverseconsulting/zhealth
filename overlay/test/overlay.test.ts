import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, ProtoWallet, Transaction, P2PKH, MerklePath, Utils } from '@bsv/sdk'
import type { Script } from '@bsv/sdk'
import {
  createZHealthNode, lockRecord, recordKey, unlockRecord, serviceBySlug, deviceMessage,
  svcIdBytes, hexBytes, TOPIC, LOOKUP_SERVICE, decodeRecord, SERVICES
} from '../src/index.js'
import type { ZHealthNode, ZHealthQuery } from '../src/index.js'

const tracker = { isValidRootForHeight: async () => true, currentHeight: async () => 1_000_000 }
let height = 900

/** A mined funding transaction (fake merkle proof accepted by the test chain tracker). */
function funding (key: PrivateKey): Transaction {
  const t = new Transaction()
  t.addOutput({ lockingScript: new P2PKH().lock(key.toAddress()), satoshis: 1000 })
  t.addOutput({ lockingScript: new P2PKH().lock(PrivateKey.fromRandom().toAddress()), satoshis: height }) // unique txid
  t.merklePath = new MerklePath(height++, [[{ offset: 0, hash: t.id('hex'), txid: true }]])
  return t
}

const payer = PrivateKey.fromRandom()
async function tx (outputs: Array<{ script: Script, sats?: number }>, spend?: { from: Transaction, index: number, wallet: ProtoWallet, keyID: string }): Promise<Transaction> {
  const t = new Transaction()
  if (spend != null) t.addInput({ sourceTransaction: spend.from, sourceOutputIndex: spend.index, unlockingScriptTemplate: unlockRecord(spend.wallet, spend.keyID) })
  t.addInput({ sourceTransaction: funding(payer), sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(payer) })
  for (const o of outputs) t.addOutput({ lockingScript: o.script, satoshis: o.sats ?? 1 })
  await t.sign()
  return t
}

async function setup (): Promise<{ node: ZHealthNode, registrar: ProtoWallet, regKey: string, rejects: string[] }> {
  const registrar = new ProtoWallet(PrivateKey.fromRandom())
  const regKey = await recordKey(registrar, 'registrar')
  const rejects: string[] = []
  const node = await createZHealthNode({ registrarKey: regKey, chainTracker: tracker, onReject: (_t, _i, r) => rejects.push(r) })
  return { node, registrar, regKey, rejects }
}

const submit = async (node: ZHealthNode, t: Transaction): Promise<number[]> => {
  const steak = await node.engine.submit({ beef: t.toBEEF(), topics: [TOPIC] })
  return steak[TOPIC]?.outputsToAdmit ?? []
}
const lookup = async (node: ZHealthNode, query: ZHealthQuery) => {
  const a = await node.engine.lookup({ service: LOOKUP_SERVICE, query })
  assert.equal(a.type, 'output-list')
  return a.outputs.map(o => ({ ...o, rec: decodeRecord(Transaction.fromBEEF(o.beef).outputs[o.outputIndex].lockingScript), seq: Number(Utils.toUTF8(o.context ?? [])) }))
}

const temp = serviceBySlug('temperature')!
const bp = serviceBySlug('bp')!

async function registerDevice (node: ZHealthNode, registrar: ProtoWallet, model: string, serial: string, slugs: string[]) {
  const key = PrivateKey.fromRandom()
  const t = await tx([{ script: await lockRecord(registrar, 'registrar', { kind: 'DEVICE', fields: [hexBytes(key.toPublicKey().toString()), model, serial, svcIdBytes(slugs.map(s => serviceBySlug(s)!.id))] }) }])
  return { key, t, admitted: await submit(node, t) }
}

async function patientRequest (node: ZHealthNode, slug: string, label?: string) {
  const s = serviceBySlug(slug)!
  const wallet = new ProtoWallet(PrivateKey.fromRandom())
  const keyID = 'request-' + Math.random().toString(36).slice(2)
  const t = await tx([{ script: await lockRecord(wallet, keyID, { kind: 'REQUEST', fields: [label ?? s.label, hexBytes(s.id)] }) }])
  return { wallet, keyID, t, A: await recordKey(wallet, keyID), admitted: await submit(node, t) }
}

async function result (node: ZHealthNode, device: PrivateKey, slug: string, value: string, opts: { tamper?: string, signAddr?: string } = {}) {
  const s = serviceBySlug(slug)!
  const doctor = new ProtoWallet(PrivateKey.fromRandom())
  const D = await recordKey(doctor, 'visit-1')
  const closeAddr = PrivateKey.fromRandom().toAddress() // A' (ECDH-derived in the app)
  const sig = device.sign(deviceMessage(s.id, value, D, opts.signAddr ?? closeAddr)).toDER() as number[]
  const text = `${s.label}: ${opts.tamper ?? value}`
  const t = await tx([
    { script: await lockRecord(doctor, 'visit-1', { kind: 'RESULT', fields: [text, hexBytes(s.id), hexBytes(device.toPublicKey().toString()), sig] }) },
    { script: new P2PKH().lock(closeAddr) }
  ])
  return { t, admitted: await submit(node, t) }
}

test('catalog has 33 services with unique public IDs that match the web client', () => {
  assert.equal(SERVICES.length, 33)
  assert.equal(new Set(SERVICES.map(s => s.id)).size, 33)
  assert.equal(temp.label, 'Take temperature')
  assert.match(temp.id, /^[0-9a-f]{16}$/)
})

test('ROOT identifies the overlay; only the registrar can publish it', async () => {
  const { node, registrar, regKey, rejects } = await setup()
  const good = await tx([{ script: await lockRecord(registrar, 'registrar', { kind: 'ROOT', fields: ['zHealth', 'tm_zhealth', 'ls_zhealth'] }) }])
  assert.deepEqual(await submit(node, good), [0])
  const imposter = new ProtoWallet(PrivateKey.fromRandom())
  const bad = await tx([{ script: await lockRecord(imposter, 'registrar', { kind: 'ROOT', fields: ['zHealth', 'tm_zhealth', 'ls_zhealth'] }) }])
  assert.deepEqual(await submit(node, bad), [])
  assert.match(rejects.at(-1)!, /registrar/)
  const roots = await lookup(node, { kind: 'root' })
  assert.equal(roots.length, 1)
  assert.equal(roots[0].rec.lockingKey, regKey)
  assert.equal(roots[0].rec.topic, 'tm_zhealth')
  await node.close()
})

test('devices: registrar-only, catalog service IDs, queryable by service', async () => {
  const { node, registrar, rejects } = await setup()
  const th = await registerDevice(node, registrar, 'Thermometer', 'TH-0001', ['temperature'])
  assert.deepEqual(th.admitted, [0])
  const vs = await registerDevice(node, registrar, 'Vital signs monitor', 'VS-0001', ['vitals', 'temperature', 'bp', 'pulse', 'spo2', 'resp'])
  assert.deepEqual(vs.admitted, [0])
  const rogue = await registerDevice(node, new ProtoWallet(PrivateKey.fromRandom()), 'Thermometer', 'FAKE-1', ['temperature'])
  assert.deepEqual(rogue.admitted, [])
  assert.match(rejects.at(-1)!, /only the registrar/)
  const unknownSvc = await tx([{ script: await lockRecord(registrar, 'registrar', { kind: 'DEVICE', fields: [hexBytes(PrivateKey.fromRandom().toPublicKey().toString()), 'X', 'X-1', hexBytes('00112233445566ff')] }) }])
  assert.deepEqual(await submit(node, unknownSvc), [])
  const forTemp = await lookup(node, { kind: 'device', service: 'temperature' })
  assert.deepEqual(forTemp.map(d => d.rec.serial).sort(), ['TH-0001', 'VS-0001'])
  const forBp = await lookup(node, { kind: 'device', service: bp.id })
  assert.deepEqual(forBp.map(d => d.rec.serial), ['VS-0001'])
  await node.close()
})

test('full visit: request -> trusted-device result -> patient close', async () => {
  const { node, registrar } = await setup()
  const th = await registerDevice(node, registrar, 'Thermometer', 'TH-0001', ['temperature'])
  const req = await patientRequest(node, 'temperature')
  assert.deepEqual(req.admitted, [0])

  let open = await lookup(node, { kind: 'request', service: 'temperature', status: 'open' })
  assert.equal(open.length, 1)
  assert.equal(open[0].rec.lockingKey, req.A)

  const res = await result(node, th.key, 'temperature', '36.8 °C')
  assert.deepEqual(res.admitted, [0], 'RESULT admitted; the P2PKH close output is ignored')
  const results = await lookup(node, { kind: 'result', devicePub: th.key.toPublicKey().toString() })
  assert.equal(results[0].rec.text, 'Take temperature: 36.8 °C')

  const closer = new ProtoWallet(PrivateKey.fromRandom())
  const close = await tx([{ script: await lockRecord(closer, 'close', { kind: 'CLOSE', fields: [hexBytes(req.t.id('hex'))] }) }],
    { from: req.t, index: 0, wallet: req.wallet, keyID: req.keyID })
  assert.deepEqual(await submit(node, close), [0])

  open = await lookup(node, { kind: 'request', service: 'temperature', status: 'open' })
  assert.equal(open.length, 0)
  const closed = await lookup(node, { kind: 'request', status: 'closed' })
  assert.equal(closed.length, 1)
  const row = await node.storage.query().where({ txid: req.t.id('hex') }).first()
  assert.equal(row?.spentBy, close.id('hex'))
  await node.close()
})

test('results are rejected for untrusted readings', async () => {
  const { node, registrar, rejects } = await setup()
  const th = await registerDevice(node, registrar, 'Thermometer', 'TH-0001', ['temperature'])

  const unregistered = await result(node, PrivateKey.fromRandom(), 'temperature', '36.6 °C')
  assert.deepEqual(unregistered.admitted, []); assert.match(rejects.at(-1)!, /not registered/)

  const wrongService = await result(node, th.key, 'bp', '120/80 mmHg')
  assert.deepEqual(wrongService.admitted, []); assert.match(rejects.at(-1)!, /not trusted for bp/)

  const tampered = await result(node, th.key, 'temperature', '36.6 °C', { tamper: '39.9 °C' })
  assert.deepEqual(tampered.admitted, []); assert.match(rejects.at(-1)!, /signature/)

  const otherAddr = await result(node, th.key, 'temperature', '36.6 °C', { signAddr: PrivateKey.fromRandom().toAddress() })
  assert.deepEqual(otherAddr.admitted, []); assert.match(rejects.at(-1)!, /signature/)

  const badLabel = await patientRequest(node, 'temperature', 'Thermometer reading')
  assert.deepEqual(badLabel.admitted, []); assert.match(rejects.at(-1)!, /label/)

  // A CLOSE that does not spend its request
  const req = await patientRequest(node, 'temperature')
  const fake = await tx([{ script: await lockRecord(new ProtoWallet(PrivateKey.fromRandom()), 'close', { kind: 'CLOSE', fields: [hexBytes(req.t.id('hex'))] }) }])
  assert.deepEqual(await submit(node, fake), []); assert.match(rejects.at(-1)!, /must spend/)
  await node.close()
})

test('revoking a device (spending its token) stops new results', async () => {
  const { node, registrar, rejects } = await setup()
  const th = await registerDevice(node, registrar, 'Thermometer', 'TH-0001', ['temperature'])
  assert.deepEqual((await result(node, th.key, 'temperature', '36.7 °C')).admitted, [0])
  const revoke = await tx([{ script: new P2PKH().lock(payer.toAddress()) }], { from: th.t, index: 0, wallet: registrar, keyID: 'registrar' })
  await submit(node, revoke)
  assert.equal((await lookup(node, { kind: 'device', status: 'revoked' })).length, 1)
  assert.deepEqual((await result(node, th.key, 'temperature', '36.9 °C')).admitted, [])
  assert.match(rejects.at(-1)!, /revoked/)
  await node.close()
})

test('a joining node downloads the public database from an existing node and verifies every record', async () => {
  const a = await setup()
  await submit(a.node, await tx([{ script: await lockRecord(a.registrar, 'registrar', { kind: 'ROOT', fields: ['zHealth', 'tm_zhealth', 'ls_zhealth'] }) }]))
  const th = await registerDevice(a.node, a.registrar, 'Thermometer', 'TH-0001', ['temperature'])
  const bpm = await registerDevice(a.node, a.registrar, 'Blood pressure monitor', 'BP-0001', ['bp', 'pulse'])
  const r1 = await patientRequest(a.node, 'temperature')
  await patientRequest(a.node, 'bp')
  await result(a.node, th.key, 'temperature', '36.8 °C')
  await result(a.node, bpm.key, 'bp', '118/76 mmHg')
  await submit(a.node, await tx([{ script: await lockRecord(new ProtoWallet(PrivateKey.fromRandom()), 'close', { kind: 'CLOSE', fields: [hexBytes(r1.t.id('hex'))] }) }],
    { from: r1.t, index: 0, wallet: r1.wallet, keyID: r1.keyID }))

  // The joiner learns the registrar key from the ROOT token and starts an empty node.
  const root = (await lookup(a.node, { kind: 'root' }))[0]
  const b = await createZHealthNode({ registrarKey: root.rec.lockingKey, chainTracker: tracker })

  // Page through the feed in admission order and replay every record through tm_zhealth.
  let since = 0
  for (;;) {
    const page = await lookup(a.node, { since, limit: 3 })
    if (page.length === 0) break
    for (const o of page) {
      const steak = await b.engine.submit({ beef: o.beef, topics: [TOPIC] })
      assert.ok(steak[TOPIC].outputsToAdmit.includes(o.outputIndex), `record ${o.seq} (${o.rec.kind}) re-validated on the joiner`)
      since = o.seq
    }
  }

  const summary = async (n: ZHealthNode) => (await n.storage.query().orderBy('seq').select('txid', 'outputIndex', 'kind', 'spent'))
    .map(r => `${r.kind}:${r.txid}.${r.outputIndex}:${Number(r.spent)}`)
  assert.deepEqual(await summary(b), await summary(a.node))
  assert.equal((await lookup(b, { kind: 'request', status: 'open' })).length, 1)
  assert.equal((await lookup(b, { kind: 'request', status: 'closed' })).length, 1)
  await a.node.close(); await b.close()
})
