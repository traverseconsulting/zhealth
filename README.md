# zHealth

zHealth is a peer-to-peer healthcare data system. Every healthcare interaction is a small, independent, FHIR-formatted event, signed with a one-time key from a user-controlled identity chain and recorded as a BSV transaction. Nodes validate events and earn per-event micro-payments. There is no central health information exchange.

zHealth runs on **[BSV Teranode](https://bsv-blockchain.github.io/teranode/topics/architecture/teranode-microservices-overview/)**. A zHealth node is an overlay service that sits next to Teranode. It enforces zHealth protocol rules, then submits transactions through Teranode's Propagation Service and reads chain data through the Asset Server and the Blockchain `Subscribe` stream.

## Documents

| Document | Purpose |
|---|---|
| [Whitepaper](docs/whitepaper/Whitepaper-ZHEALTH.pdf) | **Normative source.** Defines how zHealth works. |
| [Technical spec](docs/spec/zhealth-technical-spec.md) | Event schemas, settlement flow, node validation rules, Teranode integration. |
| [ADR 0001: Build on Teranode](docs/adr/0001-build-on-teranode.md) | Platform decision. |
| [JSON schemas](schemas/) | Machine-readable event, consent, quote, and receipt formats. |

If the spec and the whitepaper disagree, the whitepaper wins.

## Repository layout

```
docs/          whitepaper, technical spec, architecture decision records
schemas/       JSON Schema (draft 2020-12) for protocol objects
node/          zHealth node (Go): fee/halving, validation rules, Teranode clients
client/web/    zHealth web client: welcome, HD key chain, OP_RETURN templates
overlay/       zHealth overlay: tm_zhealth topic manager + ls_zhealth lookup service (public database)
```

## Node quick start

Requires Go 1.23+.

```bash
cd node
go test ./...
go run ./cmd/zhealth-node   # serves http://localhost:8080/v1/info
```

Current endpoints are scaffolding: `GET /v1/info`, `GET /v1/elements/{element}?n=<count>` (fee at a given count), `POST /v1/validate` (envelope checks only).

## Overlay quick start

Requires Node 20+ (22+ for the OverlayExpress production entry). See `overlay/README.md`.

```bash
cd overlay
npm install
npm test
```

## Status

Draft protocol (spec v0.2). The open issues are listed in spec Section 12. The most important one is **O-2**: readable on-chain FHIR (whitepaper) vs. the thesis prototype's encrypted off-chain storage.

## Security

Never commit private keys, WIFs, seeds, or settlement receipts. Receipts contain private keys by design.
