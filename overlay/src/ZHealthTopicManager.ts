/**
 * tm_zhealth — the zHealth topic manager (BRC-22).
 *
 * Decides which outputs of a submitted transaction become part of the zHealth
 * overlay. These are the network's validation rules; every node that hosts
 * tm_zhealth runs the same code, so every node accepts the same records.
 */
import { Transaction, PublicKey, Signature } from '@bsv/sdk'
import type { AdmittanceInstructions } from '@bsv/sdk'
import type { TopicManager } from '@bsv/overlay'
import {
  TOPIC, LOOKUP_SERVICE, NETWORK_NAME, EVENT_TEXTS,
  decodeRecord, serviceById, deviceMessage, p2pkhAddresses, RecordError
} from './protocol.js'
import type { DecodedRecord } from './protocol.js'
import type { DeviceRegistry } from './storage.js'

export interface ZHealthTopicManagerOptions {
  /** Public key (hex) of the registrar that publishes the ROOT and registers trusted devices. */
  registrarKey: string
  /** Device registry, normally the lookup service's storage. */
  registry: DeviceRegistry
  /** Optional sink for rejection reasons, useful for logs and tests. */
  onReject?: (txid: string, outputIndex: number, reason: string) => void
}

type Mode = 'historical-tx' | 'current-tx' | 'historical-tx-no-spv'

export class ZHealthTopicManager implements TopicManager {
  constructor (private readonly opts: ZHealthTopicManagerOptions) {
    PublicKey.fromString(opts.registrarKey) // throws on a bad key
  }

  async identifyAdmissibleOutputs (beef: number[], previousCoins: number[], _offChain?: number[], mode: Mode = 'current-tx'): Promise<AdmittanceInstructions> {
    const tx = Transaction.fromBEEF(beef)
    const txid = tx.id('hex')
    const outputsToAdmit: number[] = []
    for (let i = 0; i < tx.outputs.length; i++) {
      let rec: DecodedRecord
      try {
        rec = decodeRecord(tx.outputs[i].lockingScript)
      } catch {
        continue // not a zHealth token (change, P2PKH payments, ...): ignore silently
      }
      try {
        await this.validate(rec, tx, previousCoins, mode)
        outputsToAdmit.push(i)
      } catch (e) {
        this.opts.onReject?.(txid, i, e instanceof Error ? e.message : String(e))
      }
    }
    // Retain every spent zHealth coin so the history (BRC-64) of closes and revocations stays queryable.
    return { outputsToAdmit, coinsToRetain: previousCoins }
  }

  private async validate (r: DecodedRecord, tx: Transaction, previousCoins: number[], mode: Mode): Promise<void> {
    const no = (m: string): never => { throw new RecordError(m) }
    switch (r.kind) {
      case 'ROOT':
        if (r.lockingKey !== this.opts.registrarKey) no('ROOT must be locked to the registrar key')
        if (r.name !== NETWORK_NAME || r.topic !== TOPIC || r.lookupService !== LOOKUP_SERVICE) no('ROOT names the wrong overlay')
        return

      case 'DEVICE': {
        if (r.lockingKey !== this.opts.registrarKey) no('only the registrar can register devices')
        if (r.model === '' || r.serial === '') no('device needs a model and serial')
        for (const id of r.serviceIds ?? []) if (serviceById(id) == null) no(`unknown service id ${id}`)
        return
      }

      case 'REQUEST': {
        const s = serviceById(r.serviceId ?? '') ?? no('unknown service id')
        if (r.label !== s.label) no(`label "${r.label}" does not match service ${s.slug}`)
        return
      }

      case 'RESULT': {
        const s = serviceById(r.serviceId ?? '') ?? no('unknown service id')
        const prefix = `${s.label}: `
        if (!(r.text ?? '').startsWith(prefix)) no(`result text must start with "${prefix}"`)
        const value = (r.text ?? '').slice(prefix.length)
        if (value.trim() === '') no('empty reading')
        const dev = await this.opts.registry.findDevice(r.devicePub ?? '') ?? no('device is not registered')
        // Live submissions need a device that is still trusted. During historical sync a
        // reading taken before a later revocation is still part of the record.
        if (dev.revoked && mode === 'current-tx') no('device has been revoked')
        if (!dev.serviceIds.includes(s.id)) no(`device ${dev.model} is not trusted for ${s.slug}`)
        const devKey = PublicKey.fromString(r.devicePub ?? '')
        const sig = Signature.fromDER(r.deviceSig ?? '', 'hex')
        const signed = p2pkhAddresses(tx).some(addr => devKey.verify(deviceMessage(s.id, value, r.lockingKey, addr), sig))
        if (!signed) no('device signature does not cover this reading, visit key and close address')
        return
      }

      case 'CLOSE': {
        const ok = previousCoins.some(idx => {
          const input = tx.inputs[idx]
          const src = input?.sourceTransaction
          if (src == null) return false
          if ((input.sourceTXID ?? src.id('hex')) !== r.requestTxid) return false
          try { return decodeRecord(src.outputs[input.sourceOutputIndex].lockingScript).kind === 'REQUEST' } catch { return false }
        })
        if (!ok) no('CLOSE must spend the REQUEST token it names')
        return
      }

      case 'EVENT':
        if (!EVENT_TEXTS.includes(r.text ?? '')) no('unknown event text')
    }
  }

  async getDocumentation (): Promise<string> {
    return DOCS
  }

  async getMetaData (): Promise<{ name: string, shortDescription: string, version: string }> {
    return { name: TOPIC, shortDescription: 'zHealth peer-to-peer healthcare records: service requests, trusted-device results, closes.', version: '1' }
  }
}

const DOCS = `# tm_zhealth

Admits zHealth PushDrop tokens (protocol version 1). Each token is locked to a key
and carries public fields signed by that key.

| Kind | Rule |
|---|---|
| ROOT | Locked to the registrar key; names zHealth / tm_zhealth / ls_zhealth. Identifies the overlay on-chain. |
| DEVICE | Locked to the registrar key; every service ID is in the catalog. Spending it revokes the device. |
| REQUEST | Service ID is in the catalog and the label matches it. Locked to the patient's one-time key. |
| RESULT | Text is "Label: value"; the device is registered, not revoked, trusted for the service, and its signature covers service, value, visit key and a P2PKH close address paid by the same transaction. |
| CLOSE | Spends the REQUEST token it names. |
| EVENT | One of: ${EVENT_TEXTS.join(', ')}. |

Spent zHealth coins are retained as history.`
