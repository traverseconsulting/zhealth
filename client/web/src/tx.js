// BSV transaction per zHealth event, spent and signed by that event's own key.
//
//   Input 0  : placeholder P2PKH UTXO at the key's BSV address
//              unlocking script = <signature> <public key>   (SIGHASH_ALL|FORKID)
//   Output 0 : OP_FALSE OP_RETURN <text>   (0 sat)
//
// The funding UTXO is a placeholder (1 sat, all to miner fee). The signature
// commits to that outpoint, so a real funding UTXO means re-signing.
import { PrivateKey, Transaction, P2PKH, Script, OP, Spend, Utils } from '@bsv/sdk';

export const PLACEHOLDER_SATS = 1;

export function keyInfo(privHex) {
  const priv = PrivateKey.fromHex(privHex);
  const pub = priv.toPublicKey();
  return { priv, pubHex: pub.toString(), address: pub.toAddress(), wif: priv.toWif() };
}

function opReturn(text) {
  const s = new Script();
  s.writeOpCode(OP.OP_FALSE);
  s.writeOpCode(OP.OP_RETURN);
  s.writeBin(Utils.toArray(text, 'utf8'));
  return s;
}

// payTo: optional BSV address that receives a 1-sat P2PKH output (used to
// close a contract to the patient's ECDH-derived stealth address).
export const CLOSE_SATS = 1;
export async function buildTx(text, privHex, payTo = null) {
  const { priv, pubHex, address } = keyInfo(privHex);

  // Placeholder source transaction paying 1 sat to this key's address.
  const source = new Transaction();
  const srcSats = PLACEHOLDER_SATS + (payTo ? CLOSE_SATS : 0);
  source.addOutput({ lockingScript: new P2PKH().lock(address), satoshis: srcSats });

  const tx = new Transaction();
  tx.addInput({ sourceTransaction: source, sourceOutputIndex: 0, unlockingScriptTemplate: new P2PKH().unlock(priv) });
  tx.addOutput({ lockingScript: opReturn(text), satoshis: 0 });
  if (payTo) tx.addOutput({ lockingScript: new P2PKH().lock(payTo), satoshis: CLOSE_SATS });
  await tx.sign();

  const input = tx.inputs[0];
  const [sigHex, unlockPub] = input.unlockingScript.toASM().split(' ');
  const verified = new Spend({
    sourceTXID: source.id('hex'), sourceOutputIndex: 0, sourceSatoshis: srcSats,
    lockingScript: source.outputs[0].lockingScript, transactionVersion: tx.version,
    otherInputs: [], outputs: tx.outputs, inputIndex: 0,
    unlockingScript: input.unlockingScript, inputSequence: input.sequence, lockTime: tx.lockTime,
  }).validate();

  const raw = tx.toHex();
  return {
    text, address,
    txid: tx.id('hex'),
    rawHex: raw,
    size: raw.length / 2,
    sourceTxid: source.id('hex'),
    lockingAsm: source.outputs[0].lockingScript.toASM(),
    sigHex, unlockPub,
    pubMatches: unlockPub === pubHex,
    opReturnAsm: tx.outputs[0].lockingScript.toASM(),
    payTo, payToAsm: payTo ? tx.outputs[1].lockingScript.toASM() : null,
    verified,
  };
}
