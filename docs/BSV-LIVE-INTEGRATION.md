# zHealth BSV live integration — security and deployment contract

**Status: integration foundation, not production-ready.** The browser still constructs placeholder-input transactions; these are NOT funded and MUST NOT be broadcast. No real patient data is permitted.

## Required before live broadcast

1. **BSV network:** use `test` first; switch to `main` only after independent security review.
2. **Funding:** a testnet BSV wallet with spendable UTXOs and enough satoshis for transaction fees. Real UTXO references, values, change outputs, and current miner fee policy must be used. Never send private keys, wallet seeds, or WIFs to GitHub, CI, or the event API.
3. **Signer:** a user-controlled wallet/signing component must replace the current `client/web/src/tx.js` placeholder input. Only fully signed raw transactions may be sent to `broadcastSignedTransaction`.
4. **Server-side GitHub credential:** `GITHUB_TOKEN` fine-grained token with Contents read/write permission for `traverseconsulting/zhealth`, held ONLY in the deployed backend secret store. GitHub Pages cannot securely hold it.
5. **Authenticated backend:** a separately deployed HTTPS service must authenticate and rate-limit requests, enforce allowlisted event actions, validate signed transaction outputs against the event and public key, and use `createGitHubJournal`. Do not expose direct GitHub writes to anonymous browsers.
6. **Independent confirmation verifier:** provide a trusted header source and validate the transaction's Merkle inclusion proof against the header's Merkle root, plus header-chain validity. `verifyMining` deliberately refuses to mark mining verified without an injected verifier. Explorer-reported confirmations alone are insufficient.
7. **Operational durability:** queue/retry, idempotency keys, collision-safe sequence allocation, audit logging, and reorg handling must be implemented before accepting live writes. The simple journal's linear search is a prototype only.

## Lifecycle

- A consented, allowlisted application action becomes a **pending** `ZBLK000001` record in `blocks/`.
- The client funds/signs a transaction using a wallet; backend checks tx structure and binds its public key and OP_RETURN to the pending record.
- Backend broadcasts the signed transaction to BSV, then marks it **broadcast**.
- A monitor obtains a Merkle proof and validated header; only then may the record become **verified_mined**.
- ZBLK numbering is **event sequence**, not BSV block height. Multiple ZBLK events can appear in one mined BSV block.
- Never publish PHI, device readings, diagnoses, private keys, secrets, or patient identifiers to GitHub or OP_RETURN. Public event text must be non-sensitive.

## Local adapter test

`node --test test/bsv-live.test.mjs`

No BSV coins are spent by these tests. Broadcasting is stubbed. The tests are not evidence of successful mainnet/testnet broadcast or verified mining.

## Reference API

- WhatsOnChain raw transaction broadcast: `POST /v1/bsv/{main|test}/tx/raw`
- Transaction lookup: `GET /v1/bsv/{main|test}/tx/hash/{txid}`
- For production, prefer miner ARC policies and callbacks with independent proof validation.
