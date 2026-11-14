import './style.css';
import { newSession, ACCOUNT_PATH } from './chain.js';
import { buildTx, keyInfo, PLACEHOLDER_SATS } from './tx.js';

const app = document.getElementById('app');
const WELCOME_TEXT = 'Welcome to the Zhealth';

// Recipient page: direct patient care services. Each one is an event
// microservice; its spec 5.2 event type is recorded on the transaction card.
const SERVICES = {
  vitals: {
    title: 'Vital signs', color: '#0f5f5a', soft: '#e2efec',
    items: [
      { id: 'temperature', label: 'Take temperature', type: 'clinical.observation', desc: 'Body temperature' },
      { id: 'vitals', label: 'Take vitals', type: 'clinical.observation', desc: 'Full vital-sign set' },
      { id: 'bp', label: 'Take blood pressure', type: 'clinical.observation', desc: 'Systolic and diastolic' },
      { id: 'pulse', label: 'Check pulse', type: 'clinical.observation', desc: 'Heart rate' },
      { id: 'spo2', label: 'Check oxygen level', type: 'clinical.observation', desc: 'Pulse oximetry (SpO2)' },
      { id: 'resp', label: 'Count breathing rate', type: 'clinical.observation', desc: 'Respiratory rate' },
      { id: 'weight', label: 'Measure weight', type: 'clinical.observation', desc: 'Body weight' },
      { id: 'pain', label: 'Assess pain', type: 'clinical.observation', desc: 'Pain score 0–10' },
    ],
  },
  tests: {
    title: 'Tests and samples', color: '#6b3fa0', soft: '#efe8f7',
    items: [
      { id: 'glucose', label: 'Check blood sugar', type: 'clinical.observation', desc: 'Finger-stick glucose' },
      { id: 'blood', label: 'Draw blood', type: 'service.dispatch', desc: 'Blood sample for the lab' },
      { id: 'urine', label: 'Collect urine sample', type: 'service.dispatch', desc: 'Urinalysis' },
      { id: 'swab', label: 'Take a swab', type: 'service.dispatch', desc: 'Throat or nasal swab' },
      { id: 'ecg', label: 'Run ECG', type: 'service.dispatch', desc: 'Heart rhythm tracing' },
    ],
  },
  imaging: {
    title: 'Imaging', color: '#2f4f8f', soft: '#e5ebf6',
    items: [
      { id: 'xray', label: 'Take X-ray', type: 'clinical.imaging', desc: 'Radiograph' },
      { id: 'ultrasound', label: 'Do ultrasound', type: 'clinical.imaging', desc: 'Ultrasound scan' },
    ],
  },
  treatment: {
    title: 'Treatment', color: '#8a4b16', soft: '#f6eadf',
    items: [
      { id: 'medication', label: 'Give medication', type: 'clinical.medication', desc: 'Administer a dose' },
      { id: 'vaccine', label: 'Give vaccine', type: 'clinical.immunization', desc: 'Immunization' },
      { id: 'wound', label: 'Dress wound', type: 'service.dispatch', desc: 'Clean and bandage' },
      { id: 'iv', label: 'Start IV', type: 'service.dispatch', desc: 'Intravenous line' },
    ],
  },
};
const findService = (id) => {
  for (const [group, g] of Object.entries(SERVICES)) {
    const it = g.items.find((x) => x.id === id);
    if (it) return { group, ...it };
  }
  return null;
};

const ROLE_LABEL = { welcome: 'Welcome', provider: 'Provider', recipient: 'Recipient' };
let view = 'roles';   // 'roles' | 'recipient' | 'provider'
let session = null;   // HD session (in memory only)
let keys = [];        // derived keys, in order
let txs = [];         // { role, key, tpl }

const short = (h, a = 10, b = 8) => `${h.slice(0, a)}…${h.slice(-b)}`;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function addEvent(role, text, extra = {}) {
  const key = session.nextKey();
  const info = keyInfo(key.privHex);
  if (info.pubHex !== key.pubHex) throw new Error('key mismatch between HD derivation and BSV SDK');
  key.address = info.address;
  key.wif = info.wif;
  keys.push(key);
  txs.push({ role, key, ...extra, tpl: await buildTx(text, key.privHex) });
}

/* ---------- Page 1: Welcome ---------- */
function renderWelcome() {
  app.innerHTML = `
  <main class="welcome">
    <div class="welcome-inner">
      <p class="eyebrow">Peer-to-peer healthcare system</p>
      <button class="btn-welcome" id="welcome" type="button">
        <span>Welcome to zHealth</span>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </main>`;
  document.getElementById('welcome').addEventListener('click', async () => {
    session = newSession();
    keys = []; txs = [];
    await addEvent('welcome', WELCOME_TEXT);
    view = 'roles';
    renderSession();
    window.scrollTo(0, 0);
  });
}

/* ---------- Page 2: Session ---------- */
function keyChip() {
  const k = keys[keys.length - 1];
  return `
  <div class="keychip" tabindex="0" aria-describedby="keypop" aria-label="Latest BSV address for K${k.index}. Hover or focus to reveal the private key.">
    <span class="keychip-tag">K${k.index}</span>
    <span class="mono">${k.address}</span>
    <div class="keypop" id="keypop" role="tooltip">
      <div class="kp-row"><span class="kp-label">BSV address (P2PKH)</span><span class="mono wrap">${k.address}</span></div>
      <div class="kp-row"><span class="kp-label">Path</span><span class="mono">${k.path}</span></div>
      <div class="kp-row"><span class="kp-label">Public key (33 bytes)</span><span class="mono wrap">${k.pubHex}</span></div>
      <div class="kp-row danger"><span class="kp-label">Private key (256-bit hex)</span><span class="mono wrap">${k.privHex}</span></div>
      <div class="kp-row danger"><span class="kp-label">Private key (WIF)</span><span class="mono wrap">${k.wif}</span></div>
    </div>
  </div>`;
}

function txCard(t, n) {
  const label = t.label || ROLE_LABEL[t.role];
  const x = t.tpl;
  return `
  <article class="tx" data-role="${t.role}">
    <header class="tx-head">
      <div class="tx-title">
        <span class="tx-num">Tx ${n + 1}</span>
        <span class="pill pill-${t.role}"${t.group ? ` style="background:${SERVICES[t.group].soft};color:${SERVICES[t.group].color}"` : ''}>${esc(label)}</span>
        ${t.type ? `<span class="pill pill-type mono">${t.type}</span>` : ''}
        <span class="pill ${x.verified ? 'pill-ok' : 'pill-bad'}">${x.verified ? 'Signature valid' : 'Signature invalid'}</span>
      </div>
      <span class="tx-meta mono">K${t.key.index} · ${t.key.path}</span>
    </header>

    <div class="flow">
      <div class="flow-box">
        <span class="flow-h">Input · signed by K${t.key.index}</span>
        <dl class="tx-fields">
          <div><dt>From BSV address</dt><dd class="mono wrap">${x.address}</dd></div>
          <div><dt>Public key (in unlocking script)</dt><dd class="mono wrap">${x.unlockPub}</dd></div>
          <div><dt>Signature</dt><dd class="mono wrap">${x.sigHex}</dd></div>
        </dl>
      </div>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <div class="flow-box">
        <span class="flow-h">Output · 0 sat</span>
        <dl class="tx-fields">
          <div><dt>OP_RETURN text</dt><dd class="tx-text">“${esc(x.text)}”</dd></div>
          <div><dt>Script</dt><dd class="mono wrap">OP_FALSE OP_RETURN "zhealth" "${esc(x.text)}"</dd></div>
        </dl>
      </div>
    </div>

    <dl class="tx-fields"><div><dt>Transaction ID</dt><dd class="mono wrap">${x.txid}</dd></div></dl>

    <details class="tx-details">
      <summary>Scripts and raw hex <span class="muted">(${x.size} bytes)</span></summary>
      <ol class="pushes">
        <li><span class="push-label">Spends</span><span class="mono wrap">${x.sourceTxid}:0 (placeholder, ${PLACEHOLDER_SATS} sat)</span></li>
        <li><span class="push-label">Locking</span><span class="mono wrap">${x.lockingAsm}</span></li>
        <li><span class="push-label">Unlocking</span><span class="mono wrap">&lt;sig&gt; ${x.unlockPub}</span></li>
        <li><span class="push-label">OP_RETURN</span><span class="mono wrap">${x.opReturnAsm}</span></li>
      </ol>
      <div class="raw">
        <div class="raw-head"><span>Raw signed transaction</span><button type="button" class="btn-copy" data-copy="${x.rawHex}">Copy hex</button></div>
        <code class="mono wrap">${x.rawHex}</code>
      </div>
    </details>
  </article>`;
}

function rolesPanel() {
  return `
    <section class="roles" aria-label="Choose a role">
      ${lastSigned()}
      <div class="role-buttons">
        <button type="button" class="btn-role" data-role="provider">
          <span class="role-name">Provider</span><span class="role-desc">Clinician, lab, device</span>
        </button>
        <button type="button" class="btn-role" data-role="recipient">
          <span class="role-name">Recipient</span><span class="role-desc">Patient receiving care</span>
        </button>
      </div>
    </section>`;
}

const backBtn = `
        <button type="button" class="btn-back" id="back" aria-label="Back to roles">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Roles
        </button>`;

function lastSigned() {
  const t = txs[txs.length - 1];
  return `
      <div class="last-signed" role="status">
        <span class="pill pill-ok">Signed</span>
        <span>Tx ${txs.length} · <strong>${esc(t.label || ROLE_LABEL[t.role])}</strong> · K${t.key.index}</span>
        <span class="mono last-addr">${t.key.address}</span>
        <button type="button" class="btn-link" id="to-provider">View on Provider page →</button>
      </div>`;
}

function providerPanel() {
  return `
    <section class="provider" aria-labelledby="prov-h">
      <div class="recip-head">${backBtn}<h1 id="prov-h" class="prov-title">Provider</h1></div>
      <div class="grid">
        <section class="txlist" aria-labelledby="tx-h">
          <div class="section-head">
            <h2 id="tx-h">BSV transactions</h2>
            <span class="count">${txs.length}</span>
          </div>
          ${txs.map(txCard).reverse().join('')}
        </section>

        <aside class="chain" aria-labelledby="chain-h">
          <h2 id="chain-h">Identity chain</h2>
          <div class="root">
            <span class="kp-label">Root private key (256-bit, from your first click)</span>
            <span class="mono wrap reveal" tabindex="0" title="Hover or focus to reveal">${session.rootPrivHex}</span>
          </div>
          <ol class="chain-list">
            ${keys.map((k) => `<li><span class="chain-i">K${k.index}</span><span class="mono" title="${k.address}">${short(k.address, 10, 6)}</span><span class="chain-role" title="${esc(txs[k.index].label || ROLE_LABEL[txs[k.index].role])}">${esc(txs[k.index].label || ROLE_LABEL[txs[k.index].role])}</span></li>`).join('')}
          </ol>
          <p class="chain-path mono">${ACCOUNT_PATH}/i' (hardened)</p>
          <button type="button" class="btn-end" id="end">End session and discard keys</button>
        </aside>
      </div>
      <p class="disclaimer">Demo only. Keys live in this tab's memory and disappear when you close it or end the session. Each transaction is really signed by its key, but it spends a placeholder 1-sat input, so it won't be accepted until it's re-signed against a real funding UTXO. Nothing is broadcast. Don't send coins to these addresses.</p>
    </section>`;
}

function recipientPanel() {
  const group = (gid) => `
      <div class="svc-group" data-group="${gid}" style="--g:${SERVICES[gid].color};--g-soft:${SERVICES[gid].soft}">
        <h2 class="svc-h">${SERVICES[gid].title}</h2>
        <div class="svc-grid">
          ${SERVICES[gid].items.map((it) => `
          <button type="button" class="btn-svc" data-svc="${it.id}" data-group="${gid}">
            <span class="svc-name">${it.label}</span>
            <span class="svc-desc">${it.desc}</span>
          </button>`).join('')}
        </div>
      </div>`;
  return `
    <section class="recipient" aria-labelledby="recip-h">
      <div class="recip-head">${backBtn}<h1 id="recip-h">Recipient</h1></div>
      ${lastSigned()}
      ${Object.keys(SERVICES).map(group).join('')}
    </section>`;
}

function renderSession() {
  app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">z</span><span>zHealth</span></div>
    ${keyChip()}
  </header>
  <main class="session">
    ${view === 'recipient' ? recipientPanel() : view === 'provider' ? providerPanel() : rolesPanel()}
  </main>`;

  app.querySelectorAll('.btn-role').forEach((b) =>
    b.addEventListener('click', async () => {
      const role = b.dataset.role;
      app.querySelectorAll('.btn-role').forEach((x) => (x.disabled = true));
      await addEvent(role, role === 'provider' ? 'Provider' : 'Recipient');
      view = role;
      renderSession();
      app.querySelector('.tx')?.classList.add('tx-new');
    }));
  app.querySelectorAll('.btn-svc').forEach((b) =>
    b.addEventListener('click', async () => {
      const svc = findService(b.dataset.svc);
      app.querySelectorAll('.btn-svc').forEach((x) => (x.disabled = true));
      await addEvent('service', svc.label, { label: svc.label, type: svc.type, group: svc.group });
      renderSession();
      app.querySelector('.tx')?.classList.add('tx-new');
    }));
  document.getElementById('back')?.addEventListener('click', () => {
    view = 'roles';
    renderSession();
    window.scrollTo(0, 0);
  });
  app.querySelectorAll('.btn-copy').forEach((b) =>
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; }
      catch { b.textContent = 'Copy blocked'; }
      setTimeout(() => (b.textContent = 'Copy hex'), 1500);
    }));
  document.getElementById('to-provider')?.addEventListener('click', () => {
    view = 'provider';
    renderSession();
    window.scrollTo(0, 0);
  });
  document.getElementById('end')?.addEventListener('click', () => {
    session = null; keys = []; txs = []; view = 'roles';
    renderWelcome();
  });
}

renderWelcome();
