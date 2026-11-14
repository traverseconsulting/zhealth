/**
 * Production zHealth overlay node on OverlayExpress (Node.js 22+).
 * Adds SHIP/SLAP advertisement, GASP sync with other zHealth nodes, ARC/Arcade
 * broadcast and Chaintracks header validation.
 *
 *   SERVER_PRIVATE_KEY  node identity key (hex)
 *   HOSTING_FQDN        public host name, e.g. overlay.zhealth.example
 *   ZH_REGISTRAR_KEY    registrar public key (hex), the key the ROOT token is locked to
 *   KNEX_URL            mysql://... or postgres://...
 *   MONGO_URL           MongoDB for the SHIP/SLAP discovery services
 *   ARCADE_URL / ARC_API_KEY / CHAINTRACKS_URL as in the OverlayExpress README
 */
import { TOPIC, LOOKUP_SERVICE } from './protocol.js'
import { ZHealthStorage } from './storage.js'
import { ZHealthTopicManager } from './ZHealthTopicManager.js'
import { createZHealthLookupService } from './ZHealthLookupService.js'

const env = (k: string): string => { const v = process.env[k]; if (v == null) throw new Error(`missing ${k}`); return v }

const pkg = '@bsv/overlay-express'
const { default: OverlayExpress } = await import(pkg) as { default: any }

const server = new OverlayExpress('zhealth', env('SERVER_PRIVATE_KEY'), env('HOSTING_FQDN'))
server.configurePort(Number(process.env.PORT ?? 8080))
await server.configureKnex(env('KNEX_URL'))
await server.configureMongo(env('MONGO_URL'))

const storage = new ZHealthStorage()
server.configureTopicManager(TOPIC, new ZHealthTopicManager({ registrarKey: env('ZH_REGISTRAR_KEY'), registry: storage }))
server.configureLookupServiceWithKnex(LOOKUP_SERVICE, createZHealthLookupService(storage))

server.configureEnableGASPSync(process.env.ZH_GASP !== 'false')
if (process.env.ARCADE_URL != null) server.configureArcade(process.env.ARCADE_URL, { apiKey: process.env.ARCADE_API_KEY })
if (process.env.ARC_API_KEY != null) server.configureArcApiKey(process.env.ARC_API_KEY)
if (process.env.CHAINTRACKS_URL != null) server.configureChaintracks(process.env.CHAINTRACKS_URL, { apiPrefix: '/chaintracks/v2', reorgStream: true })

await server.configureEngine()
await server.start()
const shutdown = async (): Promise<void> => { await server.close() }
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })
