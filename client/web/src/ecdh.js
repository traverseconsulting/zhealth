// Private contract matching with ECDH (spec draft, section 7.7).
//
//   Patient request key  A = a·G   (one-time HD key that signed the request tx)
//   Doctor visit key     D = d·G   (one-time HD key, shown to the patient at the visit)
//   Shared secret        S = a·D = d·A
//
//   Match code  M  = SHA-256(S ‖ "zhealth-match")[0..8]   shown by the patient, never on-chain
//   Close key   A' = BRC-42 child of A with invoice "2-zhealth close-<request txid>"
//                    doctor derives A' from (d, A); patient derives a' from (a, D)
//
// Bystanders who see M can't map it to a contract without d. On-chain, the
// result tx shows D and A' only; neither A nor the request txid appears.
import { PrivateKey, PublicKey, Hash, Utils } from '@bsv/sdk';

const MATCH_TAG = Utils.toArray('zhealth-match', 'utf8');
const hex = (a) => Utils.toHex(a);

export const invoiceFor = (reqTxid) => `2-zhealth close-${reqTxid}`;

export function sharedSecretHex(privHex, otherPubHex) {
  return hex(PrivateKey.fromHex(privHex).deriveSharedSecret(PublicKey.fromString(otherPubHex)).encode(true));
}

export function matchCode(privHex, otherPubHex) {
  const S = PrivateKey.fromHex(privHex).deriveSharedSecret(PublicKey.fromString(otherPubHex)).encode(true);
  return hex(Hash.sha256([...S, ...MATCH_TAG])).slice(0, 16);
}

// Doctor side: patient's close address from (d, A).
export function closeAddressForPatient(doctorPrivHex, patientPubHex, reqTxid) {
  return PublicKey.fromString(patientPubHex).deriveChild(PrivateKey.fromHex(doctorPrivHex), invoiceFor(reqTxid)).toAddress();
}

// Patient side: close private key from (a, D).
export function closeKeyForPatient(patientPrivHex, doctorPubHex, reqTxid) {
  const k = PrivateKey.fromHex(patientPrivHex).deriveChild(PublicKey.fromString(doctorPubHex), invoiceFor(reqTxid));
  return { privHex: k.toHex(), address: k.toPublicKey().toAddress(), pubHex: k.toPublicKey().toString() };
}

export function randomPeerKey() {
  const k = PrivateKey.fromRandom();
  return { privHex: k.toHex(), pubHex: k.toPublicKey().toString(), address: k.toPublicKey().toAddress() };
}
