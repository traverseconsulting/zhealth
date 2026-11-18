// Browser-side prototype of a Bitcoin-inspired append-only healthcare event journal.
// Stores hashes and public metadata ONLY. No patient text or private keys.
// Local storage is neither public nor tamper-resistant; production needs an
// authenticated append-only server and a BSV commitment/broadcast service.
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const STORAGE_KEY = 'zhealth.healthblocks.v1';
const encoder = new TextEncoder();
const hash = value => bytesToHex(sha256(encoder.encode(value)));
const canonical = value => JSON.stringify(value);

function load() {
  try { const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return v?.version === 1 && Array.isArray(v.events) ? v : null;
  } catch { return null; }
}

export function initializeJournal(genesisPublicKey) {
  const existing = load();
  if (existing) return existing;
  const journal = { version: 1, folder: 'healthblocks', genesisPublicKey, events: [] };
  localStorage.setItem(STORAGE_KEY, canonical(journal));
  return journal;
}

export function appendHealthEvent({ type, publicKey, txid, text }) {
  const journal = load();
  if (!journal) throw new Error('Healthcare event journal has not been initialized');
  const previous = journal.events.at(-1);
  const record = {
    sequence: journal.events.length,
    type,
    publicKey,
    txid,
    payloadSha256: hash(text),
    previousHash: previous?.hash || '0'.repeat(64),
    recordedAt: new Date().toISOString(),
  };
  record.hash = hash(canonical(record));
  journal.events.push(record);
  localStorage.setItem(STORAGE_KEY, canonical(journal));
  return record;
}

export function getJournal() { return load(); }

export function exportHealthBlocks() {
  const journal = load();
  if (!journal) throw new Error('No journal found');
  const blob = new Blob([journal.events.map(e => canonical(e)).join('\n') + '\n'], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hblk00000.dat';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
