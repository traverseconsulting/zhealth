# zHealth Web Client

The first two screens of the zHealth client.

1. **Welcome:** the "Welcome to zHealth" button generates a random 256-bit seed (browser CSPRNG) and the BIP32 root key.
2. **Session:**
   - The top-right chip shows the latest public key. Hover or focus it to reveal that key's 256-bit private key.
   - **Provider** and **Recipient** each derive a brand-new key and build a new transaction template.
   - Every key comes from the same root, on the hardened path `m/7348'/0'/i'` (spec 4.2). K0 signs the welcome event.

Each transaction template is an unfunded, unsigned BSV transaction with one output:

```
OP_FALSE OP_RETURN "zhealth" "1" <text> <pubkey> <sig>
sig = ECDSA secp256k1 (low-S, DER) over SHA-256(utf8(text) || pubkey)
```

`<text>` is `Welcome to the Zhealth`, `Provider`, or `Recipient`.

Keys exist only in tab memory. Nothing is stored or broadcast.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # dist/
```

Libraries: `@scure/bip32`, `@noble/curves`, `@noble/hashes`.
