// zHealth identity chain (spec Section 4): hardened BIP32 path m/7348'/0'/i'.
import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils';

export const PURPOSE = 7348;
const HARDENED_OFFSET = 0x80000000;
export const ACCOUNT_PATH = `m/${PURPOSE}'/0'`;

export function newSession() {
  // 256-bit random seed from the browser CSPRNG.
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const master = HDKey.fromMasterSeed(seed);
  const account = master.derive(ACCOUNT_PATH);
  let next = 0;
  return {
    seedHex: bytesToHex(seed),
    rootPrivHex: bytesToHex(master.privateKey),
    rootPubHex: bytesToHex(master.publicKey),
    // Derive the next one-time key K_i. Each key signs exactly one event.
    nextKey() {
      const i = next++;
      const k = account.deriveChild(HARDENED_OFFSET + i);
      return {
        index: i,
        path: `${ACCOUNT_PATH}/${i}'`,
        privateKey: k.privateKey,
        publicKey: k.publicKey,
        privHex: bytesToHex(k.privateKey),
        pubHex: bytesToHex(k.publicKey),
      };
    },
  };
}
