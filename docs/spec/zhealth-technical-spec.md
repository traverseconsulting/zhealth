# zHealth Technical Specification

Version 0.2 (Draft), November 14, 2026
Status: Draft for review
Normative source: "zHealth: A Peer-to-Peer Healthcare Data System" whitepaper (Samir Bhattarai). When this spec and the whitepaper disagree, the whitepaper wins. Fix the spec to match.

---

## 1. Scope and conventions

This document covers how the zHealth client, event format, settlement flow and peer node validation work. It turns the whitepaper into rules that can be built and tested.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY follow RFC 2119.

Items marked **[DECISION]** were not covered by the whitepaper and were chosen for this draft. Items marked **[OPEN]** need a decision from the project owner before implementation. Section 12 lists both.

### 1.1 Terminology

| Term | Meaning |
|---|---|
| Actor | The person or machine performing an action (patient, clinician, device, AI agent). |
| Session | A run of actions from one Actor that share one identity chain root, ending at settlement. |
| Identity chain | The HD key sequence K0 → K1 → … → Kn derived from a session root. |
| Event | One healthcare interaction, signed by exactly one chain key. |
| Pending list | Locally stored events that have been signed but not broadcast. |
| Settlement | Funding and broadcasting all pending events, then issuing a receipt. |
| Receipt | A private record of all keys, events and transaction IDs from one session. |
| Node | A peer that validates, publishes, stores and serves zHealth events. |
| Element type | The clinical data category that has its own fee halving curve (e.g., blood type). |
| Validation fee | The per-event fee paid to the publishing node (initially 50 satoshis). |
| Miner fee | The standard ledger transaction fee. |

### 1.2 Ledger

The reference ledger is Bitcoin SV (BSV), matching the existing prototype. The whitepaper says "a public ledger such as Bitcoin blockchain," and BSV fits that, with large data carrier outputs and low fees for single-event transactions.

**Platform decision:** zHealth is built on **BSV Teranode**, the microservices-based BSV node ([Teranode Microservices Overview](https://bsv-blockchain.github.io/teranode/topics/architecture/teranode-microservices-overview/)). Section 2.1 describes the integration.

---

## 2. System architecture

```
 ┌──────────────┐  signed events   ┌──────────────┐   txs    ┌──────────────┐
 │ zHealth      │ ───────────────▶ │ zHealth Node │ ───────▶ │ BSV network  │
 │ Client       │ ◀─ fee quote ─── │ (validator)  │ ◀─ SPV ─ │ (miners)     │
 │ (wallet+app) │ ◀─ receipt data ─│              │          └──────────────┘
 └──────────────┘                  └──────┬───────┘
        │                                 │ gossip / sync
   local pending list               ┌─────▼────────┐
   + encrypted receipts             │ Peer nodes   │
                                    └──────────────┘
```

Components:

1. **Client:** Generates session keys, builds and signs events, holds the pending list, asks for fee quotes, funds settlement, and stores receipts.
2. **Node:** Validates events (Section 8), builds and broadcasts transactions, earns validation fees, keeps the event index, serves sync and proofs.
3. **Ledger:** Provides ordering, timestamps and Merkle proof-of-inclusion.

The client MUST work with any conforming node. Nodes MUST NOT need accounts, contracts or onboarding (whitepaper Section 9).

### 2.1 Teranode integration

A zHealth node is an **application-layer overlay service** that runs next to a Teranode node. It does not fork or change Teranode. Teranode enforces Bitcoin consensus rules, and the zHealth node enforces the zHealth protocol rules (Section 8) **before** a transaction reaches Teranode. All Teranode service roles below come from the [Teranode Microservices Overview](https://bsv-blockchain.github.io/teranode/topics/architecture/teranode-microservices-overview/).

```
                         zHealth Node (overlay)
 Client ──HTTP──▶ ┌──────────────────────────────────────────┐
                  │ API ─▶ zHealth Validator ─▶ Publisher    │
                  │          │                     │         │
                  │   Element/Pubkey Index ◀─ Chain Watcher  │
                  └──────────┼─────────────────────┼─────────┘
                             │ read                │ submit tx
         ┌───────────────────▼──────┐   ┌──────────▼─────────────┐
         │ Asset Server (HTTP/WS)   │   │ Propagation (gRPC/HTTP)│
         └──────────────────────────┘   └──────────┬─────────────┘
         ┌──────────────────────────┐   ┌──────────▼─────────────┐
         │ Blockchain Subscribe     │   │ Validator → Block      │
         │ (gRPC stream)            │   │ Assembly → Miners      │
         └──────────────────────────┘   └────────────────────────┘
                     Teranode
```

| zHealth need | Teranode service | How it's used |
|---|---|---|
| Broadcast event transactions (7.2 step 6) | **Propagation Service** | Submit raw (extended format) transactions over gRPC or HTTP. Propagation forwards to the Validator for consensus checks. |
| Learn about rejected transactions | **P2P Service** (rejected-tx notifications fed by the `kafka_rejectedTxConfig` topic) | Mark the event `failed` and start the 7.5 retry. |
| Fetch transactions, block headers, subtrees, UTXOs | **Asset Server** (HTTP/WebSocket) | `getTransaction`, `GetBlockHeader(s)`, `GetBestBlockHeader`, `GetBlock`, `GetSubtree`, `GetUTXO`. Used for sync (9.2), Merkle proofs (7.6), and checking funding outputs. |
| React to new blocks and reorgs | **Blockchain Service** `Subscribe` (gRPC server stream) | When a block is added, scan it for `zhealth` outputs and update the element counts and pubkey index (6.2, 8.3). On a reorg or block invalidation, roll back the affected counts. |
| Bitcoin-compatible tooling | **RPC Service** | Optional: `sendrawtransaction`, `getrawtransaction`, `getblockheader` for wallets and test tooling. |

Integration rules:

- **[DECISION]** Follow Teranode's own transport guidance. Use gRPC where zHealth needs a result before continuing (submit and confirm acceptance). Use the Blockchain `Subscribe` stream for chain-state changes. Use asynchronous messaging only for fire-and-forget notifications.
- zHealth events stay small (4 KB limit, 5.1), well under Teranode's roughly 1 MB Kafka message limit for validator transport.
- The zHealth node MUST NOT submit a transaction to Propagation until it passes Section 8. Teranode accepts any consensus-valid transaction, so zHealth validity is decided only by zHealth nodes.
- Element counts MUST be computed from blocks on the chain tip reported by the Blockchain Service, and MUST be reorg-safe. A count is final only after **[DECISION]** 6 confirmations. Fee quotes use counts at `ref_height` (6.3).
- A zHealth operator MAY run a full Teranode cluster, or connect to a Teranode operated by someone else through its Asset Server and Propagation endpoints. Either way the zHealth node verifies Merkle proofs against block headers itself (9.2).
- **[DECISION]** The zHealth node is written in Go, to match Teranode's stack and reuse the BSV Go libraries.

---

## 3. Cryptographic primitives

| Purpose | Algorithm |
|---|---|
| Signing | ECDSA over secp256k1 (DER-encoded, low-S) |
| Hashing | SHA-256; double SHA-256 for txids per ledger rules |
| Key derivation | BIP32 hierarchical deterministic derivation |
| Canonical JSON | RFC 8785 JSON Canonicalization Scheme (JCS) |
| Receipt encryption | AES-256-GCM, key from Argon2id(passphrase) |
| Randomness | OS CSPRNG only |

---

## 4. Identity chain

### 4.1 Session root

- When a session starts, the client MUST generate a new 256-bit seed from a CSPRNG and derive a BIP32 master key `m`.
- A session root MUST NOT be derived from, or linked to, any earlier session root, wallet key or user identifier.
- The session root MUST stay on the client device.

### 4.2 Key derivation

```
K_i = m / 7348' / 0' / i'        for i = 0, 1, 2, …
```

- `7348'` is the zHealth purpose index. **[DECISION]**
- All levels MUST use **hardened** derivation. With non-hardened derivation, one leaked child private key plus the parent public key exposes the whole chain. That would break the whitepaper's "one-way identity chain."
- `K_0` signs the first event in the session (usually `session.start`). `K_i` signs the i-th event.

### 4.3 One key, one event

- Each `K_i` MUST sign exactly one event.
- The client MUST keep a monotonic counter `i` and MUST NOT reuse an index, even after a failed broadcast. A failed event gets re-signed with the next index.
- The event's public key (`pubkey`) is the compressed SEC1 encoding of `K_i`'s public key (33 bytes, hex).

### 4.4 Chain proof

To prove ownership of an event history, the Actor shows the receipt (Section 7.6). A verifier checks that:

1. Each `pubkey` in the receipt comes from `m / 7348' / 0' / i'`, using the receipt's session root.
2. Each event signature verifies under its `pubkey`.
3. Each `txid` is on the ledger, with a valid Merkle proof.

Selective disclosure: an Actor MAY reveal single `(i, K_i private key, event, txid)` tuples instead of the session root, proving ownership of chosen events only.

### 4.5 Actors other than the patient

**[DECISION]** Every Actor (patient, clinician, device or AI agent) runs its own identity chain and signs its own events. A clinician entering a lab value signs with the clinician's session key, not the patient's. See Section 12, item O-3, on linking patient context.

---

## 5. Event schema

### 5.1 Envelope

Every event is a JSON object. The signed portion is the canonical (JCS) serialization of every field except `sig`.

```json
{
  "zh": "1",
  "type": "clinical.observation",
  "element": "Observation:LOINC:882-1",
  "ts": "2026-11-14T15:32:10Z",
  "seq": 3,
  "pubkey": "02a1…",
  "desc": "Blood type recorded",
  "fhir": { "...": "single FHIR element, see 5.4" },
  "consent": { "...": "see 5.5" },
  "fee": { "validation_sat": 50, "validator": "1Node…", "quote_id": "q_7f3c…" },
  "nonce": "b64:9xK…",
  "sig": "3045…"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `zh` | string | yes | Protocol version. MUST be `"1"` for this spec. |
| `type` | string | yes | One of the event types in 5.2. |
| `element` | string | if `fhir` present | Element type key, see 5.4.2. Sets the halving curve. |
| `ts` | string | yes | RFC 3339 UTC, to the second. Time the action was signed on the client. |
| `seq` | integer | yes | Derivation index `i`. Only meaningful to the key holder. |
| `pubkey` | string | yes | Hex, 33-byte compressed public key of `K_seq`. |
| `desc` | string | yes | Plain-language description, 1–140 characters, with no direct identifiers. |
| `fhir` | object | conditional | Required for clinical types (5.2); forbidden for `session.*`. |
| `consent` | object | yes | Consent metadata (5.5). |
| `fee` | object | yes | Validation fee commitment (6.4). |
| `nonce` | string | yes | 16 random bytes, base64. Stops matching identical events by their hash. |
| `sig` | string | yes | Hex DER ECDSA signature over `SHA-256(JCS(event without sig))` with `K_seq`. |

Size limit: the serialized event MUST NOT be more than **4 KB** **[DECISION]**. This enforces the whitepaper's "micro-level information" rule.

Note: `seq` shows the position inside a session, but without the root it doesn't link events. **[OPEN O-6]** Decide whether `seq` is published or kept only in the receipt.

### 5.2 Event types

| `type` | Whitepaper example | `fhir` | Typical FHIR resource |
|---|---|---|---|
| `session.start` | Logging into a system | forbidden | n/a |
| `session.end` | (implied by settlement) | forbidden | n/a |
| `appointment.schedule` | Scheduling an appointment | required | `Appointment` (status, serviceType, start) |
| `appointment.update` | n/a | required | `Appointment` |
| `demographics.update` | Updating demographic information | required | `Patient` (one generalized attribute, see 8.6) |
| `clinical.observation` | Entering a clinical value | required | `Observation` |
| `clinical.allergy` | Allergy entries | required | `AllergyIntolerance` |
| `clinical.immunization` | Immunization records | required | `Immunization` |
| `clinical.medication` | Medication orders | required | `MedicationRequest` |
| `clinical.diagnosis` | Diagnostic codes | required | `Condition` |
| `clinical.imaging` | Imaging findings | required | `DiagnosticReport` / `ImagingStudy` summary |
| `clinical.careplan` | Care-plan updates | required | `CarePlan` (one activity) |
| `record.view` | Viewing a record | optional | Reference to the viewed event `txid` only |
| `fhir.element` | Recording a FHIR element | required | Any allowed resource (8.5) |
| `service.dispatch` | AI agent services (Section 10) | required | `ServiceRequest` |

New types MUST get a protocol version bump or registry entry. Nodes MUST reject unknown types.

### 5.3 On-chain encoding

Each event is broadcast as **one transaction**:

| Output | Script | Value |
|---|---|---|
| 0 | `OP_FALSE OP_RETURN "zhealth" <zh> <event JSON bytes>` | 0 |
| 1 | P2PKH to `fee.validator` | `fee.validation_sat` |
| 2 (optional) | Change to a fresh client address | remainder |

- The prefix push MUST be the ASCII bytes `zhealth`. Nodes use it to find zHealth transactions.
- Inputs MUST come from the settlement funding transaction (7.4). Inputs MUST NOT be signed by event keys, so funding is never tied to identity keys.
- **[DECISION]** One event per transaction, as the whitepaper says ("broadcast as independent transactions").

### 5.4 FHIR payload

#### 5.4.1 Rules

- `fhir` MUST be one valid FHIR R4 resource (JSON) that carries **one** clinical data element. For example, an `Observation` has one `code` and one `value[x]`, and no `component` array unless the profile needs one (e.g., blood pressure).
- `fhir.subject`, `fhir.patient`, `fhir.performer`, `fhir.encounter` and any other `Reference` MUST be left out or replaced with an opaque `Reference.identifier` whose value is a hash commitment (see O-3). Literal references to server URLs MUST NOT appear.
- `fhir.id` MUST be left out. The event's `txid` is its canonical identifier.
- `fhir.meta.profile` SHOULD name the profile the event conforms to.

Example `clinical.observation` (blood type, as in whitepaper Section 6):

```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
  "code": { "coding": [{ "system": "http://loinc.org", "code": "882-1", "display": "ABO and Rh group [Type] in Blood" }] },
  "valueCodeableConcept": { "coding": [{ "system": "http://snomed.info/sct", "code": "278147001", "display": "Blood group O Rh(D) positive" }] },
  "effectiveDateTime": "2026-11"
}
```

Check every code against the current terminology release before using it in test fixtures.

#### 5.4.2 Element type key

```
element = <resourceType> ":" <code system short name> ":" <code>
```

Examples: `Observation:LOINC:882-1`, `Observation:LOINC:8310-5` (body temperature), `Immunization:CVX:208`, `Condition:ICD10:E11.9`.

- The key MUST be computed from `fhir.code.coding[0]` (or `vaccineCode`, `medicationCodeableConcept`, depending on the resource). Nodes MUST recompute it and reject a mismatch.
- **[OPEN O-4]** Granularity: the whitepaper lists categories ("vital signs," "laboratory results"). This draft uses one halving curve per code. Per-category curves are the alternative.

### 5.5 Consent metadata

The whitepaper says events include consent metadata but doesn't define it. **[DECISION]** Draft schema:

```json
{
  "basis": "patient-authorized",
  "scope": ["treatment", "research-deidentified", "public-health"],
  "granted_by": "self",
  "policy": "zh-consent-1",
  "expires": null
}
```

| Field | Rules |
|---|---|
| `basis` | One of `patient-authorized`, `treatment`, `emergency`, `legal-requirement`, `device-autonomous`. |
| `scope` | Non-empty subset of `treatment`, `payment`, `operations`, `research-deidentified`, `public-health`, `analytics`. |
| `granted_by` | `self` or `delegate` (e.g., guardian). Never a name. |
| `policy` | ID of a published consent policy version. |
| `expires` | RFC 3339 or `null`. This is advisory only, because ledger data can't be deleted (see O-2). |

Consent here records the purpose the Actor declared at publication. It can't revoke data after broadcast, and clients MUST say so in the UI before settlement.

---

## 6. Fees and halving

### 6.1 Validation fee

```
fee_sat(element, n) = floor( 50 / 2^floor(n / 210000) )
```

`n` is the number of **confirmed** zHealth events with that `element` key, counted in canonical ledger order (6.2) before the fee quote's reference height.

| Halving epoch | Events per element | Fee (sats) |
|---|---|---|
| 0 | 0 – 209,999 | 50 |
| 1 | 210,000 – 419,999 | 25 |
| 2 | 420,000 – 629,999 | 12 |
| 3 | 630,000 – 839,999 | 6 |
| 4 | 840,000 – 1,049,999 | 3 |
| 5 | 1,050,000 – 1,259,999 | 1 |
| 6+ | ≥ 1,260,000 | 0 |

Non-clinical events (`session.*`, `record.view` without `fhir`) use element key `meta:<type>` and follow their own curve.

**[OPEN O-5]** After epoch 6 the fee hits 0, and validators earn nothing for that element. Options: a 1-sat floor, or accept miner fees only.

### 6.2 Canonical count

All nodes MUST get the same `n`. Ordering:

1. Ledger block height, ascending.
2. Position of the transaction within the block, ascending.
3. Only transactions that pass full validation (Section 8) count. Invalid zHealth-prefixed transactions are ignored.

### 6.3 Fee quote

Before settlement, the client asks a node for a quote:

```json
// Request
{ "elements": { "Observation:LOINC:882-1": 1, "meta:session.start": 1 } }

// Response
{
  "quote_id": "q_7f3c…",
  "ref_height": 921004,
  "validator": "1Node…",
  "lines": [
    { "element": "Observation:LOINC:882-1", "count": 1, "n": 1033, "validation_sat": 50 },
    { "element": "meta:session.start", "count": 1, "n": 88211, "validation_sat": 50 }
  ],
  "miner_fee_rate_sat_per_kb": 1,
  "expires": "2026-11-14T15:42:10Z"
}
```

### 6.4 Tolerance

The fee in an event is fixed at signing, but confirmation happens later. A node MUST accept an event if `fee.validation_sat` is greater than or equal to the fee at **either** `ref_height` or the confirmation height. Underpayment is rejected (V-PAY-02). Overpayment is allowed.

### 6.5 Who earns the fee

**[DECISION]** The whitepaper says nodes "compete to publish validated events." In this draft, competition happens **at quote time**. The client asks one or more nodes for quotes and picks one (lowest total, best uptime, or the user's choice). The chosen node's address goes in `fee.validator` and in output 1. Because that's committed in the signed event, other nodes can't redirect the fee.

This fits whitepaper Section 6: with only one node, it quotes itself and gets its own 50 sats back. **[OPEN O-1]** confirms or replaces this model.

---

## 7. Settlement

### 7.1 State machine

```
            sign event
  IDLE ─────────────────▶ PENDING ──(user taps Settle)──▶ QUOTING
                            ▲  │                              │
                 sign more  └──┘                              ▼
                                                        AWAITING_FUNDS
                                                              │ funded
                                                              ▼
              NEW_SESSION ◀── KEYS_DESTROYED ◀── RECEIPT ◀── BROADCASTING
                                                              │ partial failure
                                                              ▼
                                                           RETRY (7.5)
```

### 7.2 Steps

Steps 1–7 match whitepaper Section 4.

| # | Step | Client behavior | Node behavior |
|---|---|---|---|
| 1 | Perform actions | For each action, derive `K_i`, build the event, sign it, append it to the pending list. Pre-validate locally with the Section 8 rules. | n/a |
| 2 | Accumulate | Keep the pending list encrypted on the device. Show the count and the planned public data. | n/a |
| 3 | Settle | The user taps Settle. Before going further, show what will become public and permanent (5.5). | n/a |
| 4 | Calculate | Get quote(s) (6.3), pick a validator, and set `fee` in each event. Events signed before the quote MUST be re-signed with new `K_i` indexes. **[DECISION]** Alternatively, the client gets the quote before signing the first event. | Return quote. |
| 5 | Funding request | Show the total: `Σ validation_sat + Σ miner_fee + dust/change`. Ask for payment from the user's wallet as one **funding transaction** with one output per event, each sized for that event's transaction. | n/a |
| 6 | Broadcast | Build one event transaction per event (5.3), spending its funding output. Send all of them to the chosen node. | Validate each one (Section 8), broadcast it to the ledger, return txid and status, gossip to peers. |
| 7 | Receipt | Once all transactions are accepted (in mempool), build the receipt (7.6), encrypt it, and offer save/export/discard. | Supply Merkle proofs after confirmation (on request). |
| 8 | Destroy keys | Overwrite the session seed and all derived private keys in memory and storage. Start a new session root. | n/a |

### 7.3 Total cost

```
total_sat = Σ_e fee_sat(e.element, n_e)
          + Σ_e ceil(size_bytes(tx_e) / 1000 × miner_rate)
          + ceil(size_bytes(funding_tx) / 1000 × miner_rate)
```

### 7.4 Funding transaction

- The funding transaction MUST come from the user's normal wallet and MUST NOT use identity chain keys.
- **[DECISION]** One funding transaction per settlement is simpler. It does link all events in the batch through a shared parent transaction, though, which weakens unlinkability (whitepaper Section 7). Mitigations, from simplest to strongest:
  1. Accept the linkage for an MVP and say so in the privacy notice.
  2. Fund each event from a separate wallet UTXO.
  3. Use node-sponsored funding: the node pays the miner fee, and the client pays the node in one separate payment. Only the node sees the link.
- **[OPEN O-7]** Choose the funding model before beta.

### 7.5 Failures

| Situation | Behavior |
|---|---|
| Quote expired | Get a new quote. If fees changed, re-sign affected events with new indexes. |
| Node rejects an event (Section 8) | Show the reason code. The user can fix it (new index), drop it, or cancel settlement. Funding stays unspent. |
| Partial broadcast | Retry the remaining transactions with another node. The receipt marks each event `confirmed`, `pending` or `failed`. |
| Not confirmed after N blocks (default 6) | Rebroadcast via any node. |
| Device lost before settlement | Pending events are lost. Nothing was published. |

Keys MUST NOT be destroyed (step 8) until every event is `accepted` or the user explicitly drops it.

### 7.6 Receipt schema

```json
{
  "zh_receipt": "1",
  "session_started": "2026-11-14T15:20:02Z",
  "settled": "2026-11-14T15:41:55Z",
  "ledger": "bsv-mainnet",
  "root": { "xprv": "xprv9s21…", "path": "m/7348'/0'" },
  "events": [
    {
      "seq": 0,
      "path": "m/7348'/0'/0'",
      "pubkey": "02a1…",
      "privkey_wif": "L1aW…",
      "type": "session.start",
      "desc": "Logged in",
      "event_hash": "sha256:…",
      "txid": "9f2c…",
      "status": "confirmed",
      "merkle_proof": { "block_hash": "…", "index": 412, "nodes": ["…"] }
    }
  ],
  "funding_txid": "c71a…",
  "validator": "1Node…",
  "totals": { "validation_sat": 100, "miner_sat": 3 }
}
```

- The whitepaper says the receipt contains "all key pairs used," so private keys are included. That makes the receipt **as sensitive as a password**.
- The client MUST encrypt receipts at rest (Section 3) and MUST let the user discard a receipt. That's the whitepaper's "grocery receipt" model.
- Export formats: encrypted JSON file, and an optional QR code holding just the `root.xprv` for small sessions.
- **[OPEN O-8]** Backup and recovery: should a lost receipt be recoverable at all? Allowing cloud backup changes the threat model.

---

## 8. Node validation rules

A node MUST run these checks, in order, before broadcasting or counting an event. The first failure rejects the event and returns a code.

### 8.1 Transport and encoding

| Code | Rule |
|---|---|
| V-ENC-01 | Transaction parses and passes ledger consensus and standardness rules. |
| V-ENC-02 | Output 0 is `OP_FALSE OP_RETURN` with first push `zhealth` and second push a supported `zh` version. |
| V-ENC-03 | Payload is valid UTF-8 JSON, ≤ 4 KB, no duplicate keys. |
| V-ENC-04 | Payload equals its JCS canonical form, apart from `sig` placement. |

### 8.2 Envelope

| Code | Rule |
|---|---|
| V-ENV-01 | All required fields present, no unknown top-level fields. |
| V-ENV-02 | `type` is in the registry (5.2). |
| V-ENV-03 | `ts` is valid RFC 3339 UTC, not more than 2 hours ahead of node time, not more than 30 days before broadcast. **[DECISION]** |
| V-ENV-04 | `desc` is 1–140 characters and passes the identifier check (8.6). |
| V-ENV-05 | `nonce` decodes to exactly 16 bytes. |
| V-ENV-06 | `fhir` presence matches the type's requirement. |

### 8.3 Signature and key

| Code | Rule |
|---|---|
| V-SIG-01 | `pubkey` is a valid compressed secp256k1 point. |
| V-SIG-02 | `sig` is valid low-S DER ECDSA over `SHA-256(JCS(event − sig))` under `pubkey`. |
| V-SIG-03 | `pubkey` has never appeared in any earlier valid zHealth event (one key, one event). Nodes keep a pubkey index. |
| V-SIG-04 | `pubkey` is not used to sign any input of this transaction (funding is kept apart from identity). |

### 8.4 Payment

| Code | Rule |
|---|---|
| V-PAY-01 | Output 1 is P2PKH to `fee.validator` with value `fee.validation_sat`. |
| V-PAY-02 | `fee.validation_sat ≥ fee_sat(element, n)` within the 6.4 tolerance. |
| V-PAY-03 | The miner fee meets the node's advertised minimum rate. |
| V-PAY-04 | When the node is the one broadcasting, `fee.validator` is that node's address, unless the node is relaying for another validator. |

### 8.5 FHIR conformance

| Code | Rule |
|---|---|
| V-FHIR-01 | `fhir` validates as FHIR R4 JSON against the base resource definition. |
| V-FHIR-02 | `resourceType` is allowed for the event `type` (5.2). |
| V-FHIR-03 | If `meta.profile` is set, the resource validates against that profile. |
| V-FHIR-04 | One element: one `code` and one `value[x]` (or the resource's equivalent). `component` only where the profile requires it. No `contained`, no `Bundle`. |
| V-FHIR-05 | Codes come from recognized systems (LOINC, SNOMED CT, ICD-10, RxNorm, CVX, UCUM units), and each code exists in the node's terminology snapshot. |
| V-FHIR-06 | `element` equals the key recomputed from the resource (5.4.2). |
| V-FHIR-07 | No literal `Reference.reference`, no `id`, no `text.div` narrative. |
| V-FHIR-08 | Units on `valueQuantity` use UCUM and are plausible for the code (e.g., body temperature 25–45 Cel). **[DECISION]** Plausibility tables are versioned. |

### 8.6 De-identification

Because events are published in readable form, nodes MUST block direct identifiers. This set is based on the HIPAA Safe Harbor identifier categories.

| Code | Rule |
|---|---|
| V-PRIV-01 | No names, street addresses, phone or fax numbers, emails, SSNs, MRNs, health plan numbers, account numbers, license or certificate numbers, vehicle or device serial numbers, URLs, IP addresses, biometric identifiers or full-face images, in any field. |
| V-PRIV-02 | Dates no finer than year-month (`YYYY-MM`) for clinical events. **[DECISION]** Day-level dates go in the receipt only. |
| V-PRIV-03 | No ages over 89. Ages are reported as the `90+` bucket. |
| V-PRIV-04 | Geography no finer than the first 3 digits of a ZIP code, and only where that area holds more than 20,000 people. |
| V-PRIV-05 | `demographics.update` carries one generalized attribute only (e.g., birth year, gender, 3-digit ZIP). |
| V-PRIV-06 | Free-text fields (`desc`, `note`, `valueString`) run through a pattern-and-NER identifier detector. Any match causes rejection. |

Pattern checks can't catch every identifier. Clients SHOULD run the same checks before signing, so users find problems before paying.

### 8.7 Consent

| Code | Rule |
|---|---|
| V-CON-01 | `consent` matches schema 5.5. |
| V-CON-02 | `policy` refers to a known, published consent policy version. |
| V-CON-03 | `basis = device-autonomous` only on event types allowed for devices or agents. |
| V-CON-04 | `basis = emergency` events MUST also carry `scope` containing `treatment`. |

### 8.8 Acceptance

An event that passes every rule is **valid**. The node then:

1. Broadcasts the transaction to the ledger (if it's the publisher).
2. Gossips the transaction ID to peers.
3. After confirmation, indexes it by `element`, `type`, `pubkey`, and block position, and increments the element count.
4. Stores the full transaction and Merkle proof for serving.

Peers MUST re-validate gossiped events independently. They don't trust the publisher's validation.

---

## 9. Network protocol

### 9.1 Node API (HTTP/JSON, draft)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/info` | Node version, validator address, min miner rate, terminology snapshot ID, chain tip. |
| POST | `/v1/quote` | Fee quote (6.3). |
| POST | `/v1/validate` | Dry-run validation of a signed event, with no broadcast. |
| POST | `/v1/events` | Submit signed event transactions for validation and broadcast. |
| GET | `/v1/events/{txid}` | Event payload, status, Merkle proof. |
| GET | `/v1/elements/{element}` | Current count `n`, epoch, fee. |
| GET | `/v1/sync?from_height=` | Paged list of valid zHealth txids and proofs from a height. |
| GET | `/v1/peers` | Known peer endpoints. |

### 9.2 Joining and sync

1. A new node gets peers from a seed list or from `/v1/peers`.
2. It downloads the event list via `/v1/sync` from height 0 (or a checkpoint). Alternatively, it rebuilds the list by scanning blocks from its Teranode Asset Server for `zhealth` outputs.
3. It checks each event's Merkle proof against block headers it has verified itself. It does not rely on the peer for this.
4. It re-runs Section 8 on every event and rebuilds element counts and the pubkey index.
5. When it's caught up, it starts quoting and validating.

Checkpoints: **[DECISION]** Nodes MAY publish signed `(height, element_counts_hash, pubkey_index_hash)` snapshots, so new nodes can compare state quickly. They still verify the history afterward.

### 9.3 Lightweight (SPV) clients

Lightweight clients keep block headers only. To check an event, they fetch the transaction and Merkle proof from any node and confirm it's in a header on the most-work chain. They trust the node's Section 8 validation, or they run the checks themselves for single events.

### 9.4 zHealth overlay (`tm_zhealth` / `ls_zhealth`)

**[DECISION]** The public zHealth database is a BRC-22/BRC-24 overlay. It is implemented in `overlay/`.

- Records are 1-sat PushDrop tokens with public fields and a self-signature: ROOT, DEVICE, REQUEST, RESULT, CLOSE and EVENT. They are spendable. Spending a REQUEST closes it; spending a DEVICE revokes it.
- `tm_zhealth` enforces the record rules, the trusted-device rule and the close rule (see `overlay/README.md`). `ls_zhealth` indexes them in SQL and answers queries.
- The ROOT token, locked to the registrar key, identifies the overlay on-chain. A joining node reads the registrar key from ROOT and replays the `since` feed (or uses GASP), re-validating each record and checking every SPV proof.
- Nodes advertise with SHIP/SLAP (BRC-88) when run on OverlayExpress.
- This replaces the `/v1/sync` path in 9.2 for overlay records. V-ENC-02 (a `zhealth` prefix in OP_RETURN) does not apply to overlay tokens.

---

## 10. Autonomous nodes and devices

Based on whitepaper Section 10. This is future scope and not needed for v1.

- A device (X-ray, analyzer, vital-sign monitor) is an Actor with its own identity chains, and MAY settle on a schedule (e.g., hourly).
- Device events use `consent.basis = device-autonomous` and SHOULD include `fhir.device` as an opaque model/calibration commitment, not a serial number (V-PRIV-01).
- An AI agent dispatches work as `service.dispatch` events, and the result comes back as a normal clinical event.
- A device or agent MAY also run as a node and earn validation fees.

---

## 11. Conformance test plan (outline)

| Area | Minimum tests |
|---|---|
| Key derivation | Fixed seed gives a known `K_0…K_4` (publish test vectors). Hardened-only derivation is enforced. |
| Signing | JCS canonicalization vectors. Signature verify and tamper-reject. |
| One key, one event | A second event with the same `pubkey` is rejected V-SIG-03. |
| Fees | Fee at n = 209,999 / 210,000 / 1,259,999 / 1,260,000. The tolerance window is honored. |
| FHIR | One valid and one invalid fixture per allowed resource type. Multi-element resource rejected V-FHIR-04. |
| Privacy | Fixture with a name / MRN / full date / ZIP-5 in each field is rejected with the right code. |
| Settlement | Happy path. Expired quote. Partial broadcast. Keys not destroyed until all events are accepted. |
| Sync | Fresh node rebuilds identical counts and pubkey index from a test chain. |

---

## 12. Decisions and open issues

### 12.1 Decisions made in this draft

| ID | Decision | Section |
|---|---|---|
| D-1 | BSV is the reference ledger, and the platform is Teranode. The zHealth node is an overlay service in Go. | 1.2, 2.1 |
| D-2 | Hardened BIP32 path `m/7348'/0'/i'`. | 4.2 |
| D-3 | Every Actor signs with its own chain. | 4.5 |
| D-4 | 4 KB event size limit. | 5.1 |
| D-5 | Consent metadata schema. | 5.5 |
| D-6 | One halving curve per coded element. | 5.4.2 |
| D-7 | Fee goes to the validator chosen at quote time, committed in the signed event. | 6.5 |
| D-8 | Year-month date precision on-chain. | 8.6 |

### 12.2 Open issues

| ID | Issue | Why it matters |
|---|---|---|
| O-1 | Confirm the "compete to publish" model (D-7) or replace it with another (first-to-confirm, rotating, stake-based). | Decides validator revenue and incentive fairness. |
| O-2 | **Readable on-chain data vs. the thesis prototype.** The thesis prototype keeps FHIR encrypted off-chain with BSV anchoring only. The whitepaper publishes readable FHIR on-chain. On-chain data can't be deleted, which clashes with consent expiry and with right-to-erasure laws in some jurisdictions. | Biggest privacy and regulatory risk. The thesis and the app should say which model each one uses. |
| O-3 | Patient context. Without a link between the clinician-signed result and the patient's chain, nobody can tell whose blood type it is. Options: a patient-supplied one-time commitment `H(patient K_j pubkey ‖ salt)` placed in `fhir.subject.identifier`, or a patient co-signature. | Needed for usable records. Must not bring back linkability. |
| O-4 | Halving granularity: per code (draft) vs. per category. | Changes fee economics and count bookkeeping. |
| O-5 | Behavior after the fee reaches 0. | Long-term validator incentive. |
| O-6 | Publish `seq` on-chain or keep it in the receipt only. | Small linkage signal. |
| O-7 | Funding model (7.4). | A shared funding parent links events in a batch. |
| O-8 | Receipt backup and recovery. | A lost receipt means losing proof of history. |
| O-9 | Source attestation. How does a reader know a lab value came from a real lab? Options: organization-signed attestations, device certificates. The whitepaper says organizations hold no identity profiles. | Clinical trust in published data. |
| O-10 | Re-identification from combined fields (timing, rare values, validator and location patterns), even with no direct identifiers. Needs a formal privacy review. | Whitepaper Section 7 claims correlation is infeasible. That claim needs testing. |

---

## Appendix A. Whitepaper traceability

| Whitepaper section | Spec sections |
|---|---|
| 2. Events | 5 |
| 3. Identity Chain | 4 |
| 4. Timestamping and Settlement | 7 |
| 5. Network | 8, 9 |
| 6. Economic Model | 6 |
| 7. Privacy | 4, 7.4, 7.6, 8.6, 12 (O-2, O-10) |
| 8. Enterprise Value (CIA) | 8 (integrity), 9 (availability), 8.6 (confidentiality) |
| 10. Autonomous Networks | 10 |
