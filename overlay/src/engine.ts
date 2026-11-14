/**
 * Build a self-contained zHealth overlay node (Engine + SQL storage) without
 * OverlayExpress. Used by the dev server and the tests.
 */
import { Engine, KnexStorage, KnexStorageMigrations } from '@bsv/overlay'
import type { ChainTracker } from '@bsv/sdk'
import knexLib from 'knex'
import type { Knex } from 'knex'
import { TOPIC, LOOKUP_SERVICE } from './protocol.js'
import { ZHealthStorage } from './storage.js'
import { ZHealthTopicManager } from './ZHealthTopicManager.js'
import { ZHealthLookupService } from './ZHealthLookupService.js'

export interface ZHealthNodeOptions {
  registrarKey: string
  chainTracker: ChainTracker | 'scripts only'
  /** Knex config; defaults to an in-memory SQLite database. */
  knex?: Knex.Config
  onReject?: (txid: string, outputIndex: number, reason: string) => void
}

export interface ZHealthNode {
  engine: Engine
  storage: ZHealthStorage
  knex: Knex
  close: () => Promise<void>
}

export async function createZHealthNode (o: ZHealthNodeOptions): Promise<ZHealthNode> {
  const knex = knexLib(o.knex ?? { client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } })
  const engineMigrations = KnexStorageMigrations.default as unknown as Array<{ up: (k: Knex) => Promise<void>, down: (k: Knex) => Promise<void> }>
  await knex.migrate.latest({
    migrationSource: {
      getMigrations: async () => engineMigrations.map((_, i) => String(i).padStart(3, '0')),
      getMigrationName: (n: string) => n,
      getMigration: async (n: string) => engineMigrations[Number(n)]
    }
  })
  const storage = new ZHealthStorage(knex)
  await storage.migrate()
  const engine = new Engine(
    { [TOPIC]: new ZHealthTopicManager({ registrarKey: o.registrarKey, registry: storage, onReject: o.onReject }) },
    { [LOOKUP_SERVICE]: new ZHealthLookupService(storage) },
    new KnexStorage(knex),
    o.chainTracker
  )
  return { engine, storage, knex, close: async () => { await knex.destroy() } }
}
