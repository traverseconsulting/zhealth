# zHealth overlay (`tm_zhealth` / `ls_zhealth`)

The zHealth public database is an overlay network built on the BSV overlay services
libraries ([`@bsv/overlay`](https://bsv-blockchain.github.io/ts-stack/packages/overlays/)).
Any node can host it. Each node runs the same topic manager, so every node accepts the same
records, and it keeps its own SQL copy of the database.

| Part | Name | Standard | What it does |
|---|---|---|---|
| Topic manager | `tm_zhealth` | [BRC-22](https://github.com/bsv-blockchain/BRCs/blob/master/overlays/0022.md), [BRC-87](https://bsv.brc.dev/overlays/0087) | Network rules: which outputs become zHealth records |
| Lookup service | `ls_zhealth` | [BRC-24](https://github.com/bsv-blockchain/BRCs/blob/master/overlays/0024.md) | The public database: indexes records and answers queries |
| Discovery | SHIP / SLAP | [BRC-88](https://hub.bsvblockchain.org/brc/overlays/0088) | Nodes advertise that they host `tm_zhealth` / `ls_zhealth` (via OverlayExpress) |
| Node sync | GASP | — | Nodes exchange records and check each one with SPV (via OverlayExpress) |

## Records

Every record is a 1-satoshi **PushDrop token**: a public key with `OP_CHECKSIG`, then public
fields, then a signature by that key over the fields. The tokens are spendable, so spending
one carries meaning (closing a request, revoking a device). There is no `zhealth` marker
push: a field that is exactly `zhealth` (any case) is rejected. Text is matched byte for byte and
case-sensitively against the catalog, in sentence case (`Hearing test`, not `HEARING TEST`), per spec
5.3.1 and V-ENC-02. The overlay is identified on-chain by its **ROOT** token.

| Kind | Fields after `[kind, "1"]` | Locked to | Rule in `tm_zhealth` |
|---|---|---|---|
| ROOT | `tm_zhealth`, `ls_zhealth` | registrar key | Must be the configured registrar key |
| DEVICE | devicePub, model, serial, service IDs (8 bytes each) | registrar key | Registrar only; every service ID is in the catalog. **Spend = revoke.** |
| REQUEST | label, service ID | patient one-time key A | Service ID is in the catalog; label matches it |
| RESULT | `"Label: value"`, service ID, devicePub, device signature | provider visit key D | Device is registered, not revoked, and trusted for the service. The device signature covers `svcId\|value\|D\|A'`, where A' is a P2PKH output in the same tx |
| CLOSE | request txid | fresh patient key | Must spend that REQUEST token. **Spend of REQUEST = closed.** |
| EVENT | `Welcome to the Zhealth` / `Provider` / `Recipient` | session key | Text is one of these |

Service IDs are `SHA-256("zhealth.service/" + slug)`, first 8 bytes. They match `client/web/src/devices.js`.
There are 33 services (`src/catalog.ts`).

## Lookup queries

`POST /lookup` with `{ "service": "ls_zhealth", "query": { ... } }`. Answers are BRC-24 output
lists with BEEF, so every record can be checked against block headers.

```jsonc
{ "kind": "root" }                                         // identifies the overlay and registrar key
{ "kind": "device", "service": "temperature", "status": "active" }
{ "kind": "request", "service": "bp", "status": "open" }   // the contract board
{ "kind": "result", "devicePub": "02…" }
{ "outpoint": "<txid>.0" }
{ "since": 0, "limit": 1000 }                              // full feed in admission order (context = seq)
```

## Joining the network

1. Find a host for `ls_zhealth` via SLAP, or use a known URL.
2. Query `{ "kind": "root" }`, check its SPV proof, and read the registrar key from it.
3. Start a node with `ZH_REGISTRAR_KEY` set to that key.
4. Page through `{ "since": n }` and submit every BEEF to your own node. Your node re-runs
   `tm_zhealth` on each record and verifies every proof, so you don't have to trust the peer.
   With OverlayExpress, GASP does this automatically.

The test `a joining node downloads the public database…` runs these steps between two nodes.

## Run

```bash
npm install
npm test                                   # 8 end-to-end tests (Node 20+)
ZH_REGISTRAR_KEY=<hex> ZH_CHAIN=main npm run dev   # local node on :8080, SQLite
```

`ZH_CHAIN=dev` accepts any merkle root. Use it only with locally built test transactions.

Production (`src/node.ts`, Node 22+) runs on
[`@bsv/overlay-express`](https://www.npmjs.com/package/@bsv/overlay-express) with
MySQL/Postgres, MongoDB, SHIP/SLAP, GASP, ARC/Arcade broadcast and Chaintracks headers:

```bash
npm install @bsv/overlay-express
SERVER_PRIVATE_KEY=… HOSTING_FQDN=overlay.example ZH_REGISTRAR_KEY=… \
KNEX_URL=mysql://… MONGO_URL=mongodb://… npm run build && npm start
```

Transactions reach the network through ARC/Arcade, which sits in front of Teranode's
Propagation service.

## Known limits

- **Registrar.** A single registrar key registers devices. A multi-party registrar is future work.
- **GASP order.** A RESULT needs its DEVICE to be known first. Page-ordered replay guarantees
  this, but plain GASP does not. A follow-up can add `identifyNeededInputs`, or make
  results reference the device outpoint.
- **Revocations.** During historical sync, readings taken before a revocation are still accepted.
- **Web client.** The app still writes OP_RETURN templates. Moving it to these PushDrop tokens is
  the next step.
