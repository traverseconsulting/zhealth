# zHealth Web Client

The first two screens of the zHealth client.

1. **Welcome:** the "Welcome to zHealth" button generates a random 256-bit seed (browser CSPRNG) and the BIP32 root key.
2. **Session:**
   - The top-right chip shows the **BSV address** (P2PKH) of the latest key. Hover or focus it to reveal the address, path, public key and private key (hex and WIF).
   - **Provider** and **Recipient** each derive a brand-new key, and that key signs its own BSV transaction.
   - Every key comes from the same root, on the hardened path `m/7348'/0'/i'` (spec 4.2). K0 signs the welcome event.

Each transaction is built and signed with the official BSV SDK (`@bsv/sdk`):

```
Input 0   spends a P2PKH UTXO at the key's address
          unlocking script: <signature> <public key>   (SIGHASH_ALL | FORKID)
Output 0  OP_FALSE OP_RETURN <text>          (0 sat)
```

`<text>` is `Welcome to the Zhealth`, `Provider`, or `Recipient`. The app checks every signature with the SDK's script interpreter.

The funding UTXO is a 1-sat **placeholder**. The signature is real but commits to that placeholder outpoint, so the transaction has to be re-signed against a real funding UTXO before it can be broadcast.

Keys exist only in tab memory. Nothing is stored or broadcast.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # dist/
```

Libraries: `@bsv/sdk` (addresses, WIF, transactions, signing), `@scure/bip32` (HD derivation). The app checks that both libraries derive the same public key for every key.
