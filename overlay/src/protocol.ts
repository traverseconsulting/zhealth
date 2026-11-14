/**
 * zHealth overlay protocol, version 1.
 *
 * Every zHealth record is a 1-satoshi PushDrop token (spendable, BRC-48 style):
 *
 *   <lockingKey> OP_CHECKSIG <field 0> <field 1> ... <signature> OP_DROP/OP_2DROP ...
 *
 * The fields are public. The last field is a signature by the locking key over
 * the concatenation of all earlier fields, so nobody can forge a record for a
 * key they do not hold. Spending a token is meaningful:
 *   REQUEST spent  -> the patient closed the service request
 *   DEVICE  spent  -> the registrar revoked the device
 *
 * Record kinds (field 0) and their fields:
 *   ROOT    [ROOT, v, name, topic, lookupService, sig]          locked to the registrar key
 *   DEVICE  [DEVICE, v, devicePub, model, serial, svcIds, sig]  locked to the registrar key
 *   REQUEST [REQUEST, v, label, svcId, sig]                     locked to the patient's one-time key A
 *   RESULT  [RESULT, v, "Label: value", svcId, devicePub, deviceSig, sig]
 *                                                               locked to the provider's visit key D
 *   CLOSE   [CLOSE, v, requestTxid, sig]                        spends REQUEST, locked to a fresh patient key
 *   EVENT   [EVENT, v, text, sig]                               Welcome / role selection
 *
 * The word "zhealth" never appears in a record's text. The overlay is
 * identified on-chain by its ROOT token, which names the topic and lookup service.
 */
import { Hash, PublicKey, Signature, Script, Utils, PushDrop, P2PKH, Transaction } from '@bsv/sdk'
import type { WalletInterface, WalletProtocol } from '@bsv/sdk'
import { CATALOG, CatalogEntry } from './catalog.js'

export const TOPIC = 'tm_zhealth'
export const LOOKUP_SERVICE = 'ls_zhealth'
export const VERSION = '1'
export const NETWORK_NAME = 'zHealth'
/** BRC-43 protocol used to derive record keys. Only affects key derivation; never written on-chain. */
export const PROTOCOL_ID: WalletProtocol = [0, 'zhealth']

export const KINDS = ['ROOT', 'DEVICE', 'REQUEST', 'RESULT', 'CLOSE', 'EVENT'] as const
export type Kind = typeof KINDS[number]

export const EVENT_TEXTS = ['Welcome to the Zhealth', 'Provider', 'Recipient']

/* ---------------- service IDs ---------------- */

const toHex = (a: number[]): string => Utils.toHex(a)
const utf8 = (s: string): number[] => Utils.toArray(s, 'utf8')
const fromUtf8 = (a: number[]): string => Utils.toUTF8(a)

/** Public service ID: SHA-256("zhealth.service/" + slug), first 8 bytes as hex. Same as client/web/src/devices.js. */
export function serviceId (slug: string): string {
  return toHex(Hash.sha256(utf8('zhealth.service/' + slug))).slice(0, 16)
}

export const SERVICES: Array<CatalogEntry & { id: string }> = CATALOG.map(c => ({ ...c, id: serviceId(c.slug) }))
const BY_ID = new Map(SERVICES.map(s => [s.id, s]))
export const serviceById = (id: string): (CatalogEntry & { id: string }) | undefined => BY_ID.get(id)
export const serviceBySlug = (slug: string): (CatalogEntry & { id: string }) | undefined => SERVICES.find(s => s.slug === slug)

/** Message a trusted device signs for a reading. Same as client/web/src/devices.js. */
export function deviceMessage (svcId: string, value: string, visitKeyHex: string, closeAddress: string): number[] {
  return utf8(`${svcId}|${value}|${visitKeyHex}|${closeAddress}`)
}

/* ---------------- decoding ---------------- */

export interface DecodedRecord {
  kind: Kind
  version: string
  lockingKey: string
  fields: number[][]
  // kind-specific, all public
  name?: string
  topic?: string
  lookupService?: string
  devicePub?: string
  model?: string
  serial?: string
  serviceIds?: string[]
  label?: string
  text?: string
  value?: string
  serviceId?: string
  deviceSig?: string
  requestTxid?: string
}

export class RecordError extends Error {}
const fail = (m: string): never => { throw new RecordError(m) }

const LIMIT = 512

/**
 * Decode a zHealth PushDrop token and verify its self-signature.
 * Throws RecordError for anything that is not a well-formed zHealth record.
 */
export function decodeRecord (script: Script): DecodedRecord {
  let pd
  try { pd = PushDrop.decode(script) } catch { return fail('not a PushDrop token') }
  const lockingKey = pd.lockingPublicKey.toString()
  const all = pd.fields
  if (all.length < 3) fail('too few fields')
  const sig = all[all.length - 1]
  const fields = all.slice(0, -1)
  for (const f of fields) if (f.length > LIMIT) fail('field too long')
  const kind = fromUtf8(fields[0]) as Kind
  if (!KINDS.includes(kind)) fail('unknown record kind')
  const version = fromUtf8(fields[1])
  if (version !== VERSION) fail('unsupported version')

  let ok = false
  try { ok = pd.lockingPublicKey.verify(fields.flat(), Signature.fromDER(sig)) } catch { ok = false }
  if (!ok) fail('record signature does not match locking key')

  const r: DecodedRecord = { kind, version, lockingKey, fields }
  const n = fields.length
  const need = (k: number): void => { if (n !== k) fail(`${kind} needs ${k} fields`) }
  switch (kind) {
    case 'ROOT':
      need(5)
      r.name = fromUtf8(fields[2]); r.topic = fromUtf8(fields[3]); r.lookupService = fromUtf8(fields[4])
      break
    case 'DEVICE': {
      need(6)
      r.devicePub = pubHex(fields[2])
      r.model = fromUtf8(fields[3]); r.serial = fromUtf8(fields[4])
      const ids = fields[5]
      if (ids.length === 0 || ids.length % 8 !== 0) fail('bad service id list')
      r.serviceIds = []
      for (let i = 0; i < ids.length; i += 8) r.serviceIds.push(toHex(ids.slice(i, i + 8)))
      break
    }
    case 'REQUEST':
      need(4)
      r.label = fromUtf8(fields[2]); r.serviceId = svc(fields[3])
      break
    case 'RESULT':
      need(6)
      r.text = fromUtf8(fields[2]); r.serviceId = svc(fields[3])
      r.devicePub = pubHex(fields[4]); r.deviceSig = toHex(fields[5])
      break
    case 'CLOSE':
      need(3)
      if (fields[2].length !== 32) fail('bad request txid')
      r.requestTxid = toHex(fields[2])
      break
    case 'EVENT':
      need(3)
      r.text = fromUtf8(fields[2])
      break
  }
  return r
}

function pubHex (a: number[]): string {
  if (a.length !== 33) fail('bad public key')
  try { return PublicKey.fromString(toHex(a)).toString() } catch { return fail('bad public key') }
}
function svc (a: number[]): string {
  if (a.length !== 8) fail('bad service id')
  return toHex(a)
}

/** Base58 P2PKH addresses paid by a transaction (used to find the patient's close address A'). */
export function p2pkhAddresses (tx: Transaction): string[] {
  const out: string[] = []
  for (const o of tx.outputs) {
    const c = o.lockingScript.chunks
    if (c.length === 5 && c[0].op === 0x76 && c[1].op === 0xa9 && c[2].data?.length === 20 && c[3].op === 0x88 && c[4].op === 0xac) {
      out.push(Utils.toBase58Check(c[2].data, [0x00]))
    }
  }
  return out
}

/* ---------------- building (for clients, tests, the registrar) ---------------- */

/** Any wallet that can derive keys and sign: a full BRC-100 wallet or a ProtoWallet. */
export type KeyWallet = Pick<WalletInterface, 'getPublicKey' | 'createSignature'>

export interface RecordInput {
  kind: Kind
  /** Fields after [kind, version]. Strings are UTF-8; number[] is raw bytes. */
  fields: Array<string | number[]>
}

/** Build a zHealth PushDrop locking script for a wallet key (BRC-42 child of the wallet, keyID chosen by the caller). */
export async function lockRecord (wallet: KeyWallet, keyID: string, rec: RecordInput): Promise<Script> {
  const fields = [utf8(rec.kind), utf8(VERSION), ...rec.fields.map(f => typeof f === 'string' ? utf8(f) : f)]
  return await new PushDrop(wallet as WalletInterface).lock(fields, PROTOCOL_ID, keyID, 'self', true, true)
}

/** Public key that lockRecord(wallet, keyID, …) will lock to. */
export async function recordKey (wallet: KeyWallet, keyID: string): Promise<string> {
  const { publicKey } = await wallet.getPublicKey({ protocolID: PROTOCOL_ID, keyID, counterparty: 'self', forSelf: true })
  return publicKey
}

/** Unlocking template for spending a zHealth token (close a request, revoke a device). */
export function unlockRecord (wallet: KeyWallet, keyID: string): ReturnType<PushDrop['unlock']> {
  return new PushDrop(wallet as WalletInterface).unlock(PROTOCOL_ID, keyID, 'self')
}

export const svcIdBytes = (ids: string[]): number[] => ids.flatMap(id => Utils.toArray(id, 'hex'))
export const hexBytes = (h: string): number[] => Utils.toArray(h, 'hex')
export { P2PKH }
