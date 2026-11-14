/**
 * The public zHealth database: one row per admitted zHealth token.
 * Shared by the lookup service (writes, queries) and the topic manager
 * (device registry checks). Works on any Knex SQL backend (SQLite, MySQL, Postgres).
 */
import type { Knex } from 'knex'
import type { DecodedRecord } from './protocol.js'

export const TABLE = 'zhealth_records'

export interface RecordRow {
  seq: number
  txid: string
  outputIndex: number
  kind: string
  lockingKey: string
  serviceId: string | null
  label: string | null
  text: string | null
  devicePub: string | null
  model: string | null
  serial: string | null
  serviceIds: string | null
  requestTxid: string | null
  spent: boolean | number
  spentBy: string | null
  admittedAt: string
}

/** Knex migrations, usable directly with OverlayExpress.configureLookupServiceWithKnex. */
export const migrations = [{
  name: '2026-11-14-001-zhealth-records',
  async up (knex: Knex): Promise<void> {
    await knex.schema.createTable(TABLE, t => {
      t.increments('seq').primary()
      t.string('txid', 64).notNullable()
      t.integer('outputIndex').notNullable()
      t.string('kind', 16).notNullable().index()
      t.string('lockingKey', 66).notNullable().index()
      t.string('serviceId', 16).nullable().index()
      t.string('label', 128).nullable()
      t.text('text').nullable()
      t.string('devicePub', 66).nullable().index()
      t.string('model', 128).nullable()
      t.string('serial', 128).nullable()
      t.text('serviceIds').nullable()
      t.string('requestTxid', 64).nullable().index()
      t.boolean('spent').notNullable().defaultTo(false)
      t.string('spentBy', 64).nullable()
      t.timestamp('admittedAt').notNullable().defaultTo(knex.fn.now())
      t.unique(['txid', 'outputIndex'])
    })
  },
  async down (knex: Knex): Promise<void> {
    await knex.schema.dropTable(TABLE)
  }
}]

export interface DeviceInfo { devicePub: string, model: string, serial: string, serviceIds: string[], revoked: boolean, txid: string, outputIndex: number }

/** What the topic manager needs to know about trusted devices. */
export interface DeviceRegistry {
  findDevice: (devicePub: string) => Promise<DeviceInfo | undefined>
}

export class ZHealthStorage implements DeviceRegistry {
  private db?: Knex
  constructor (knex?: Knex) { this.db = knex }

  /** Late binding, for hosts (like OverlayExpress) that create the Knex client after the topic manager. */
  attach (knex: Knex): void { this.db = knex }

  get knex (): Knex {
    if (this.db == null) throw new Error('ZHealthStorage: no database attached')
    return this.db
  }

  async migrate (): Promise<void> {
    if (!(await this.knex.schema.hasTable(TABLE))) await migrations[0].up(this.knex)
  }

  async insert (txid: string, outputIndex: number, r: DecodedRecord): Promise<void> {
    await this.knex(TABLE).insert({
      txid,
      outputIndex,
      kind: r.kind,
      lockingKey: r.lockingKey,
      serviceId: r.serviceId ?? null,
      label: r.label ?? null,
      text: r.text ?? null,
      devicePub: r.devicePub ?? null,
      model: r.model ?? null,
      serial: r.serial ?? null,
      serviceIds: r.serviceIds?.join(',') ?? null,
      requestTxid: r.requestTxid ?? null
    }).onConflict(['txid', 'outputIndex']).ignore()
  }

  async markSpent (txid: string, outputIndex: number, spentBy: string | null): Promise<void> {
    await this.knex(TABLE).where({ txid, outputIndex }).update({ spent: true, spentBy })
  }

  async remove (txid: string, outputIndex: number): Promise<void> {
    await this.knex(TABLE).where({ txid, outputIndex }).del()
  }

  async findDevice (devicePub: string): Promise<DeviceInfo | undefined> {
    const row: RecordRow | undefined = await this.knex(TABLE)
      .where({ kind: 'DEVICE', devicePub })
      .orderBy('seq', 'desc')
      .first()
    if (row == null) return undefined
    return {
      devicePub,
      model: row.model ?? '',
      serial: row.serial ?? '',
      serviceIds: (row.serviceIds ?? '').split(',').filter(Boolean),
      revoked: Boolean(row.spent),
      txid: row.txid,
      outputIndex: row.outputIndex
    }
  }

  query (): Knex.QueryBuilder<RecordRow, RecordRow[]> {
    return this.knex<RecordRow>(TABLE)
  }
}
