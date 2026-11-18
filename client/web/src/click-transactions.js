import { buildTx, keyInfo } from './tx.js';
import { newSession } from './chain.js';

// Each click creates a separate BSV-serialized demonstration transaction.
// Browser OPFS is a private origin folder, not the user's visible Downloads folder.
const ROOT = 'zhealth-transactions';
const INDEX = 'ZHEALTH_CLICK_TRANSACTIONS';
const safeName = value => String(value || 'action').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64);
let sequence = 0;
let queue = Promise.resolve();

async function persist(filename, record) {
  const serialized = JSON.stringify(record, null, 2);
  // Maintain a readable browser-storage index even when OPFS is unavailable.
  try {
    const index = JSON.parse(localStorage.getItem(INDEX) || '{}');
    index[filename] = record;
    localStorage.setItem(INDEX, JSON.stringify(index));
  } catch (error) { console.warn('Click transaction index could not be saved', error); }
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle(ROOT, { create: true });
    const file = await folder.getFileHandle(filename, { create: true });
    const writer = await file.createWritable();
    await writer.write(serialized);
    await writer.close();
  }
}

export function recordClickTransaction(action) {
  const order = ++sequence;
  queue = queue.catch(() => {}).then(async () => {
    const key = newSession().nextKey();
    const publicInfo = keyInfo(key.privHex);
    const label = safeName(action);
    const tx = await buildTx('zHealth demo click: ' + label, key.privHex);
    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}_${order}_${label}_${tx.txid.slice(0, 12)}.json`;
    await persist(filename, {
      format: 'BSV-raw-transaction', demo: true, broadcastStatus: 'not-broadcast',
      broadcastable: false, reason: 'Placeholder funding inputs',
      action: label, timestamp: new Date().toISOString(),
      txid: tx.txid, rawHex: tx.rawHex, publicKey: key.pubHex,
      address: publicInfo.address
    });
  });
  return queue;
}
