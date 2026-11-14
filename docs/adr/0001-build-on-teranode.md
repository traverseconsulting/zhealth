# ADR 0001: Build zHealth on BSV Teranode

- Status: Accepted
- Date: 2026-11-14

## Context

zHealth records each healthcare interaction as its own BSV transaction, so the ledger has to handle very high transaction volumes at low cost. Teranode is BSV's microservices node architecture. It is designed for more than 1 million transactions per second, using independently scalable services that talk over gRPC and Kafka ([Teranode Microservices Overview](https://bsv-blockchain.github.io/teranode/topics/architecture/teranode-microservices-overview/)).

## Decision

- zHealth targets Teranode as its ledger platform.
- A zHealth node is an **overlay service**. It does not modify Teranode. It:
  - submits validated event transactions through the **Propagation Service**,
  - reads transactions, headers, blocks, subtrees, and UTXOs through the **Asset Server**,
  - follows chain-state changes (new blocks, reorgs, invalidations) through the **Blockchain Service `Subscribe`** gRPC stream,
  - picks up rejected-transaction notifications from the **P2P Service**.
- zHealth protocol rules (spec Section 8) are enforced by zHealth nodes before submission. Teranode only enforces Bitcoin consensus.
- The zHealth node is written in **Go**, to match Teranode and the BSV Go libraries.
- Transport choice follows Teranode's guidance: gRPC when a result is needed, the Subscribe stream for chain state, async messaging for fire-and-forget.

## Consequences

- zHealth gets Teranode's scaling headroom without having to maintain a node fork.
- Element counts and the pubkey index have to be reorg-safe, driven by Subscribe notifications.
- Operators can run their own Teranode cluster or connect to one run by someone else. Either way, Merkle proofs are verified locally against headers.
