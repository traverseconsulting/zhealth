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

export async function downloadClickTransactions() {
  // Wait for any click transaction currently being serialized and saved.
  await queue.catch(() => {});
  const records = {};
  try {
    Object.assign(records, JSON.parse(localStorage.getItem(INDEX) || '{}'));
  } catch { /* OPFS may still be available */ }
  if (navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle(ROOT);
      for await (const [name, handle] of folder.entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
        records[name] = JSON.parse(await (await handle.getFile()).text());
      }
    } catch (error) { console.warn('Unable to read OPFS transactions', error); }
  }
  const names = Object.keys(records).sort();
  if (!names.length) return 0;
  const payload = {
    format: 'zHealth-BSV-demo-transaction-export',
    exportedAt: new Date().toISOString(),
    count: names.length,
    transactions: names.map(filename => ({ filename, ...records[filename] }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'zhealth-bsv-demo-transactions-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return names.length;
}
