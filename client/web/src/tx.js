// Unfunded BSV transaction template with a zHealth OP_FALSE OP_RETURN output
// (spec 5.3). Pushes: "zhealth", "1", <text>, <pubkey>, <sig>.
// sig = ECDSA(secp256k1, low-S, DER) over SHA-256(utf8(text) || pubkey).
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils';

const OP_FALSE = 0x00, OP_RETURN = 0x6a, OP_PUSHDATA1 = 0x4c;

function push(data) {
  if (data.length <= 75) return concatBytes(Uint8Array.of(data.length), data);
  if (data.length <= 255) return concatBytes(Uint8Array.of(OP_PUSHDATA1, data.length), data);
  throw new Error('push too large for template');
}
const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64le0 = () => new Uint8Array(8);
const varint = (n) => { if (n < 0xfd) return Uint8Array.of(n); throw new Error('varint'); };
const reverse = (b) => Uint8Array.from(b).reverse();

export function buildTemplate(text, key) {
  const textBytes = utf8ToBytes(text);
  const msgHash = sha256(concatBytes(textBytes, key.publicKey));
  const sig = secp256k1.sign(msgHash, key.privateKey, { lowS: true }).toDERRawBytes();
  const pushes = [
    { label: 'protocol', value: 'zhealth', bytes: utf8ToBytes('zhealth') },
    { label: 'version', value: '1', bytes: utf8ToBytes('1') },
    { label: 'event', value: text, bytes: textBytes },
    { label: 'pubkey', value: key.pubHex, bytes: key.publicKey },
    { label: 'signature', value: bytesToHex(sig), bytes: sig },
  ];
  const script = concatBytes(Uint8Array.of(OP_FALSE, OP_RETURN), ...pushes.map((p) => push(p.bytes)));
  const tx = concatBytes(
    u32le(1),                       // version
    varint(1),                      // input count
    new Uint8Array(32), u32le(0),   // placeholder outpoint (unfunded)
    varint(0),                      // empty scriptSig (unsigned)
    u32le(0xffffffff),              // sequence
    varint(1),                      // output count
    u64le0(),                       // 0 sat data output
    varint(script.length), script,
    u32le(0),                       // locktime
  );
  const txid = bytesToHex(reverse(sha256(sha256(tx))));
  const verified = secp256k1.verify(sig, msgHash, key.publicKey);
  return {
    text, pushes, verified,
    scriptHex: bytesToHex(script),
    rawHex: bytesToHex(tx),
    txid,
    size: tx.length,
  };
}
