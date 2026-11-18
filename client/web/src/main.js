import './style.css';
import { recordClickTransaction, downloadClickTransactions } from './click-transactions.js';
import { initializeJournal, appendHealthEvent, getJournal, exportHealthBlocks } from './healthblocks.js';
import { newSession, ACCOUNT_PATH } from './chain.js';
import { buildTx, keyInfo, PLACEHOLDER_SATS, CLOSE_SATS } from './tx.js';
import { serviceId, createRegistry, devicesFor, signReading, validateReading, unregisteredDevice } from './devices.js';
import { matchCode, sharedSecretHex, closeAddressForPatient, closeKeyForPatient, randomPeerKey } from './ecdh.js';

const app = document.getElementById('app');
// Demo reward a provider earns for fulfilling a patient's service contract.
// Real amounts and escrow are not decided yet.
const REWARD_SATS = 100;
const COMPLAINTS_LIST = 'COMPLAINTS_LIST';
function readComplaintsList() {
  try {
    const data = JSON.parse(localStorage.getItem(COMPLAINTS_LIST) || '[]');
    return Array.isArray(data) ? data.filter(item => item && typeof item.txid === 'string' && typeof item.rawHex === 'string') : [];
  } catch { return []; }
}
function saveComplaintTransaction(complaint, req) {
  const entries = readComplaintsList();
  const entry = {
    version: 1, format: 'BSV-raw-transaction', network: 'BSV-mainnet',
    broadcastStatus: 'pending', txid: req.tpl.txid, rawHex: req.tpl.rawHex,
    complaint, publicKey: req.key.pubHex, address: req.key.address,
    rewardSats: REWARD_SATS, status: 'open', createdAt: new Date().toISOString()
  };
  if (!entries.some(item => item.txid === entry.txid)) entries.push(entry);
  localStorage.setItem(COMPLAINTS_LIST, JSON.stringify(entries));
}

const ONE_BSV_SATS = 100_000_000;
const HALF_BSV_SATS = 50_000_000;


// Patient page: direct patient care services. Each one is an event
// microservice; its spec 5.2 event type is recorded on the transaction card.
const SERVICES = {
  consultation: { title: 'Doctor consultation', color: '#0f5f5a', soft: '#e2efec', items: [
    { id: 'consultation', label: 'Doctor consultation', type: 'service.dispatch', desc: 'Initial patient complaint' },
  ] },
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
  labs: {
    title: 'Lab tests', color: '#a3366b', soft: '#f8e6ef',
    items: [
      { id: 'cbc', label: 'Complete blood count', type: 'service.dispatch', desc: 'CBC: red and white cells, platelets' },
      { id: 'cmp', label: 'Metabolic panel', type: 'service.dispatch', desc: 'Glucose, electrolytes, kidney, liver' },
      { id: 'lipid', label: 'Cholesterol panel', type: 'service.dispatch', desc: 'Lipids: LDL, HDL, triglycerides' },
      { id: 'a1c', label: 'HbA1c', type: 'service.dispatch', desc: '3-month blood sugar average' },
      { id: 'tsh', label: 'Thyroid test', type: 'service.dispatch', desc: 'TSH' },
      { id: 'ua', label: 'Urinalysis', type: 'service.dispatch', desc: 'Urine test panel' },
    ],
  },
  imaging: {
    title: 'Imaging', color: '#2f4f8f', soft: '#e5ebf6',
    items: [
      { id: 'xray', label: 'Take X-ray', type: 'clinical.imaging', desc: 'Radiograph' },
      { id: 'ultrasound', label: 'Do ultrasound', type: 'clinical.imaging', desc: 'Ultrasound scan' },
    ],
  },
  screenings: {
    title: 'Screenings', color: '#566419', soft: '#eef1dc',
    items: [
      { id: 'physical', label: 'Physical exam', type: 'service.dispatch', desc: 'Hands-on exam by a clinician' },
      { id: 'eye', label: 'Eye exam', type: 'service.dispatch', desc: 'Vision check' },
      { id: 'hearing', label: 'Hearing test', type: 'service.dispatch', desc: 'Audiometry' },
      { id: 'depression', label: 'Depression screening', type: 'clinical.observation', desc: 'Questionnaire score' },
      { id: 'skin', label: 'Skin check', type: 'service.dispatch', desc: 'Skin and mole exam' },
      { id: 'mammogram', label: 'Mammogram', type: 'clinical.imaging', desc: 'Breast screening X-ray' },
      { id: 'colorectal', label: 'Colorectal screening', type: 'service.dispatch', desc: 'FIT test or colonoscopy' },
      { id: 'pap', label: 'Pap test', type: 'service.dispatch', desc: 'Cervical screening' },
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
// Public service identifier per microservice (devices.js).
for (const g of Object.values(SERVICES)) for (const it of g.items) it.sid = serviceId(it.id);
let registry = null;  // trusted-device registry (simulated network state)

const findService = (id) => {
  for (const [group, g] of Object.entries(SERVICES)) {
    const it = g.items.find((x) => x.id === id);
    if (it) return { group, ...it };
  }
  return null;
};

const ROLE_LABEL = { welcome: 'Welcome', provider: 'Provider', recipient: 'Patient', fulfil: 'Fulfilment' };
let view = 'roles';   // 'intake' | 'roles' | 'recipient' | 'provider'
let session = null;   // HD session (in memory only)
let keys = [];        // derived keys, in order
let txs = [];
let contracts = [];
let visit = null;    // clinic visit state (ECDH matching)
let peerSeq = 0;
let complaintSubmitted = false;
let selectedConcernId = null;

const short = (h, a = 10, b = 8) => `${h.slice(0, a)}…${h.slice(-b)}`;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function deriveKey() {
  // Independent random seed for every newly generated BSV address.
  const key = newSession().nextKey();
  const info = keyInfo(key.privHex);
  if (info.pubHex !== key.pubHex) throw new Error('key mismatch between HD derivation and BSV SDK');
  key.address = info.address;
  key.wif = info.wif;
  return key;
}

async function addEvent(role, text, extra = {}, opts = {}) {
  const key = opts.key || deriveKey();
  keys.push(key);
  const t = { role, key, ...extra, tpl: await buildTx(text, key.privHex, opts.payTo || null, opts.extra || []) };
  txs.push(t);
  appendHealthEvent({ type: role, publicKey: key.pubHex, txid: t.tpl.txid, text });
  return t;
}
const contractById = (id) => contracts.find((c) => c.id === id);

/* ---------- Page 1: Welcome ---------- */
async function startSession() {
  session = newSession();
  initializeJournal(session.rootPubHex);
  keys = []; txs = []; contracts = []; visit = null;
  complaintSubmitted = false;
  registry = await createRegistry();
  view = 'welcome';
  renderSession();
}

/* ---------- Page 2: Session ---------- */
// Update only the header on clicks; preserve form input and page state.
function refreshClickAddress() {
  const key = deriveKey();
  keys.push(key);
  const oldChip = document.getElementById('copy-key');
  if (!oldChip) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = keyChip();
  oldChip.replaceWith(wrapper.firstElementChild);
  attachKeyCopy();
}

function attachKeyCopy() {
  document.getElementById('copy-key')?.addEventListener('click', async () => {
    const button = document.getElementById('copy-key');
    const key = keys[keys.length - 1];
    if (!key) return;
    try { await navigator.clipboard.writeText(key.privHex); button.title = 'Private key copied'; }
    catch { button.title = 'Clipboard unavailable'; }
  });
}

function keyChip() {
  const k = keys[keys.length - 1];
  if (!k) return '';
  return `
  <button type="button" class="keychip keychip-copy" id="copy-key" title="Hover to view private key; click to copy" aria-label="Current BSV address ${k.address}. Hover to view private key; click to copy private key.">
    <span class="keychip-label">Current BSV Address</span><span class="mono">${k.address}</span>
    <span class="keypop" role="tooltip"><span class="kp-label">Private key</span><span class="mono wrap">${k.privHex}</span></span>
  </button>`;
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
        ${t.role === 'service' && t.contractId ? `<span class="pill pill-contract">Contract #${t.contractId} · ${contractById(t.contractId).status}</span>` : ''}
        ${t.role === 'fulfil' ? `<span class="pill pill-provider">Closes a contract privately · +${REWARD_SATS} sat</span>` : ''}
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
          <div><dt>Script</dt><dd class="mono wrap">OP_FALSE OP_RETURN "${esc(x.text)}"${(x.extra || []).map((h) => ` ${h.length > 20 ? short(h, 8, 6) : h}`).join('')}</dd></div>
          ${t.sid ? `<div><dt>Service ID (public)</dt><dd class="mono">${t.sid}</dd></div>` : ''}
          ${t.device ? `<div><dt>Measured by trusted device</dt><dd>${esc(t.device.model)} ${t.device.serial} · <span class="mono">${short(t.device.key.pubHex, 8, 6)}</span></dd></div>` : ''}
          ${x.payTo ? `<div><dt>Output 1 · ${CLOSE_SATS} sat to patient's ECDH close address</dt><dd class="mono wrap">${x.payTo}</dd></div>` : ''}
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
        ${x.payTo ? `<li><span class="push-label">Output 1</span><span class="mono wrap">${x.payToAsm}</span></li>` : ''}
        <li><span class="push-label">OP_RETURN</span><span class="mono wrap">${x.opReturnAsm}</span></li>
      </ol>
      <div class="raw">
        <div class="raw-head"><span>Raw signed transaction</span><button type="button" class="btn-copy" data-copy="${x.rawHex}">Copy hex</button></div>
        <code class="mono wrap">${x.rawHex}</code>
      </div>
    </details>
  </article>`;
}

function welcomePanel() {
  return `<section class="entry-choice" aria-label="Choose patients or providers">
    
    <div class="entry-options">
      <button type="button" class="entry-option" id="enter-patient"><strong>Patients</strong></button>
      <button type="button" class="entry-option" id="enter-provider"><strong>Providers</strong></button>
    </div>
  </section>`;
}

function providerComplaintsPanel() {
  const concerns = readComplaintsList();
  return `<section class="concerns" aria-labelledby="provider-complaints-title">
    <div class="concerns-head"><h1 id="provider-complaints-title">Help the Patients</h1><button type="button" class="btn-back" id="home-entry">Back</button></div>
    <p class="concern-status">Complaints saved on this device as COMPLAINTS_LIST · BSV transactions awaiting broadcast.</p>
    ${concerns.length ? concerns.map(c => `<article class="concern-card">
      <div class="concern-body"><p class="concern-text">${esc(c.complaint)}</p>
      <span class="concern-status">${c.status === 'open' ? 'Open · Awaiting provider' : c.status === 'consulted' ? 'Consulted · Referral decision pending' : 'Consultation completed'}</span>
      <span class="concern-status mono">Tx ${short(c.txid, 10, 8)}</span><span class="concern-status">100 sats · 50 consultation / 50 referral or refund</span></div>
      <div class="concern-actions"><button type="button" class="btn-role" data-open-provider-tx="${c.txid}">Open complaint · 100 sats</button></div>
    </article>`).join('') : '<p class="empty">No active concerns found in this browser session.</p>'}
  </section>`;
}

function intakePanel() {
  return `<section class="intake" aria-labelledby="intake-title">
    <h1 id="intake-title">What brings you in today?</h1>
    <form id="intake-form">
      <textarea id="complaint" name="complaint" rows="6" maxlength="2000" required aria-label="Describe your symptoms or concerns" placeholder="Describe your symptoms or concerns"></textarea>
      <button class="btn-submit" type="submit">Get Help</button>
    </form>
  </section>`;
}

function registrationPanel() {
  return `<section class="intake" aria-labelledby="registration-title">
    <h1 id="registration-title">Your complaint is registered</h1>
    <button type="button" class="btn-submit" id="registration-continue">Continue</button>
  </section>`;
}

function rolesPanel() {
  const concerns = contracts.filter(c => c.initial);
  return `
    <section class="concerns" aria-label="Patient concerns">
      <div class="concerns-head"><h1>Active concerns</h1><div><button type="button" class="btn-back" id="export-healthblocks">Export hblk00000.dat</button> <button type="button" class="btn-back" id="new-concern">+ New concern</button></div></div>
      ${concerns.length ? concerns.map(c => `
        <article class="concern-card">
          <div class="concern-body">
            <p class="concern-text">${esc(c.complaint)}</p>
            <span class="concern-status">${c.status === 'open' ? 'Open · Awaiting provider' : 'Consultation completed'}</span>
            <span class="concern-status">BSV network: Not broadcast · Demo transaction only</span>
            <span class="concern-status mono">Tx ${short(c.req.tpl.txid, 10, 8)}</span>
          </div>
          <div class="concern-actions">
            <button type="button" class="btn-role" data-concern-role="provider" data-concern-id="${c.id}"><span class="role-name">Provider</span><span class="role-desc">Clinician, lab, device</span></button>
            <button type="button" class="btn-role" data-concern-role="recipient" data-concern-id="${c.id}"><span class="role-name">Patient</span><span class="role-desc">Patient receiving care</span></button>
          </div>
        </article>`).join('') : '<p class="empty">No concerns submitted yet.</p>'}
    </section>`;
}

const backBtn = `
        <button type="button" class="btn-back" id="back" aria-label="Back to roles">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Roles
        </button>`;

const resultDefault = (label) => (label === 'Take temperature' ? '37.0 °C' : label === 'Take blood pressure' ? '120/80 mmHg' : label === 'Check pulse' ? '72 bpm' : 'Normal');

function visitPanel() {
  const own = contracts.filter((c) => !c.peer && c.status === 'open');
  const v = visit;
  const step = (n, who, title, body, done) => `
        <li class="vstep ${done ? 'done' : ''}">
          <div class="vstep-head"><span class="vstep-n">${n}</span><span class="who who-${who.toLowerCase()}">${who}</span><span class="vstep-title">${title}</span></div>
          <div class="vstep-body">${body}</div>
        </li>`;
  if (!v) {
    return `
      <section class="visit" aria-labelledby="visit-h">
        <div class="section-head"><h2 id="visit-h">Clinic visit</h2><span class="count">ECDH matching</span></div>
        <p class="visit-lede">The patient walks in. The doctor finds the patient's contract among all open ones, posts the result and closes it, and neither the patient's key nor the request transaction appears in the result.</p>
        ${own.length
          ? `<button type="button" class="btn-submit" id="v-start">Start visit</button>`
          : `<p class="empty">Request a service on the Patient page first. That's the patient's contract.</p>`}
      </section>`;
  }
  const c = v.matchedId ? contractById(v.matchedId) : null;
  const s1 = step(1, 'Doctor', 'Show a one-time visit key',
    `<p>Doctor derives a new key and shows its public key to the patient, for example as a QR code.</p>
     <dl class="kv"><div><dt>Doctor public key D</dt><dd class="mono wrap">${v.D.pubHex}</dd></div></dl>`, true);
  const s2 = step(2, 'Patient', 'Compute a match code',
    v.code
      ? `<p>Patient computes the shared secret <span class="mono">S = a·D</span> from the private key that signed their request, then hashes it.</p>
         <dl class="kv"><div><dt>Match code M (shown to the doctor)</dt><dd class="mono code">${v.code}</dd></div>
         <div><dt>Patient's own contract</dt><dd>#${v.ownId} · ${esc(contractById(v.ownId).svc.label)}</dd></div></dl>
         <p class="note">M is useless to anyone who overhears it: mapping it to a contract needs the doctor's private key.</p>`
      : `<p>Patient picks their open contract and computes <span class="mono">S = a·D</span>. Nothing about their key leaves their device.</p>
         <div class="row"><label class="sr-only" for="v-own">Patient's contract</label>
         <select id="v-own">${own.map((x) => `<option value="${x.id}">#${x.id} · ${esc(x.svc.label)}</option>`).join('')}</select>
         <button type="button" class="btn-submit" id="v-code">Compute match code</button></div>`, !!v.code);
  const s3 = !v.code ? '' : step(3, 'Doctor', 'Find the exact contract',
    v.scan
      ? `<p>For every open contract, the doctor computes <span class="mono">d·A</span> from the request key <span class="mono">A</span>, hashes it and compares it with M.</p>
         <table class="scan"><thead><tr><th>Contract</th><th>Service</th><th>Doctor's code</th><th>Match</th></tr></thead><tbody>
         ${v.scan.map((r) => `<tr class="${r.match ? 'hit' : ''}"><td>#${r.id}</td><td>${esc(r.label)}</td><td class="mono">${r.code}</td><td>${r.match ? '<span class="pill pill-ok">Match</span>' : '<span class="muted">No</span>'}</td></tr>`).join('')}
         </tbody></table>
         <p class="note">${v.scan.filter((r) => r.match).length === 1 ? `Exactly one match: contract #${v.matchedId}.` : 'No unique match.'} ${v.scan.filter((r) => r.label === contractById(v.ownId).svc.label).length} open "${esc(contractById(v.ownId).svc.label)}" contracts were searched.</p>`
      : `<button type="button" class="btn-submit" id="v-scan">Scan ${contracts.filter((x) => x.status === 'open').length} open contracts</button>`, !!v.scan);
  const devs = c ? devicesFor(registry, c.svc.id) : [];
  const checks = (r) => `
         <ul class="checks">
           <li class="${r.registered ? 'ok' : 'bad'}">${r.registered ? 'Pass' : 'Fail'} · device key is in the network registry</li>
           <li class="${r.allowed ? 'ok' : 'bad'}">${r.allowed ? 'Pass' : 'Fail'} · device is registered for service ${c.svc.sid}</li>
           <li class="${r.sigOk ? 'ok' : 'bad'}">${r.sigOk ? 'Pass' : 'Fail'} · device signature covers this value, D and A'</li>
         </ul>`;
  const s4 = !c ? '' : step(4, 'Doctor', devs.length ? 'Take the reading with a trusted device' : 'Post the result and close the contract',
    v.resultTx
      ? `<p>Result posted, signed by the doctor's visit key. Output 1 pays ${CLOSE_SATS} sat to the patient's close address <span class="mono">A'</span>, derived from <span class="mono">A</span> and the shared secret (BRC-42).</p>
         <dl class="kv"><div><dt>OP_RETURN</dt><dd>“${esc(v.resultTx.tpl.text)}”</dd></div>
         <div><dt>Service ID</dt><dd class="mono">${c.svc.sid}</dd></div>
         ${v.reading ? `<div><dt>Measured by</dt><dd>${esc(v.reading.device.model)} ${v.reading.device.serial} · public key <span class="mono">${short(v.reading.device.key.pubHex, 8, 6)}</span></dd></div>
         <div><dt>Device signature</dt><dd class="mono wrap">${short(v.reading.sig, 16, 12)}</dd></div>` : ''}
         <div><dt>Close address A'</dt><dd class="mono wrap">${v.resultTx.tpl.payTo}</dd></div></dl>
         ${v.reading ? `<h3 class="checks-h">Network check before accepting the result ${v.check.ok ? '<span class="pill pill-ok">Accepted</span>' : '<span class="pill pill-bad">Rejected</span>'}</h3>${checks(v.check)}
         ${v.forged ? `<h3 class="checks-h">Same reading from an unregistered ${esc(v.reading.device.model.toLowerCase())} <span class="pill pill-bad">${v.forged.ok ? 'Accepted' : 'Rejected'}</span></h3>${checks(v.forged)}`
           : `<button type="button" class="btn-ghost" id="v-forge">Try the same reading from an unregistered device</button>`}`
         : '<p class="note">No trusted device is registered for this service yet, so the result was entered by hand and has no device signature.</p>'}`
      : devs.length
        ? `<p>${devs.length} registered device${devs.length > 1 ? 's' : ''} can measure ${esc(c.svc.label.toLowerCase())}. The chosen device takes the reading and signs it with its own registered key. Nobody types the value.</p>
           <div class="row"><label class="sr-only" for="v-device">Device</label>
           <select id="v-device">${devs.map((d, i) => `<option value="${i}">${esc(d.model)} ${d.serial}</option>`).join('')}</select>
           <button type="button" class="btn-submit" id="v-post">Take reading and close contract</button></div>`
        : `<div class="row"><label for="v-result">${esc(c.svc.label)} result</label>
           <input id="v-result" type="text" value="${esc(resultDefault(c.svc.label))}" maxlength="40" />
           <button type="button" class="btn-submit" id="v-post">Post result and close contract</button></div>
           <p class="note">No trusted device is registered for this service, so the result is entered by hand.</p>`, !!v.resultTx);
  const s5 = !v.resultTx ? '' : step(5, 'Patient', 'Confirm the result is theirs',
    `<p>Patient derives the close key <span class="mono">a'</span> from their key <span class="mono">a</span> and <span class="mono">D</span>, and checks it controls output 1.</p>
     <dl class="kv"><div><dt>Patient-derived address</dt><dd class="mono wrap">${v.patientClose.address}</dd></div></dl>
     <p class="note">${v.patientClose.address === v.resultTx.tpl.payTo ? '<span class="pill pill-ok">Output 1 belongs to the patient</span>' : '<span class="pill pill-bad">Address mismatch</span>'}</p>`, true);
  const pub = !v.resultTx ? '' : `
        <div class="public-view">
          <h3>What the public ledger sees</h3>
          <ul>
            <li><strong>Request tx</strong> signed by <span class="mono">${short(c.req.key.address, 8, 6)}</span>: “${esc(c.svc.label)}”</li>
            <li><strong>Result tx</strong> signed by <span class="mono">${short(v.D.address, 8, 6)}</span>: “${esc(v.resultTx.tpl.text)}”, paying <span class="mono">${short(v.resultTx.tpl.payTo, 8, 6)}</span></li>
            <li>No shared key, address or txid between them. The match code never goes on-chain. Only the patient and the doctor can link the two.</li>
          </ul>
        </div>`;
  return `
      <section class="visit" aria-labelledby="visit-h">
        <div class="section-head"><h2 id="visit-h">Clinic visit</h2><span class="count">ECDH matching</span>
          <button type="button" class="btn-link" id="v-reset">${v.resultTx ? 'New visit' : 'Cancel visit'}</button></div>
        <ol class="vsteps">${s1}${s2}${s3}${s4}${s5}</ol>
        ${pub}
      </section>`;
}

function devicesPanel() {
  if (!registry) return '';
  return `
      <details class="devices">
        <summary><span class="devices-h">Trusted devices</span><span class="count">${registry.devices.length} registered</span><span class="count">${new Set(registry.devices.flatMap((d) => d.services)).size} of ${Object.values(SERVICES).reduce((n, g) => n + g.items.length, 0)} services covered</span></summary>
        <p class="visit-lede">Each device has its own key pair. The network registrar <span class="mono">${short(registry.registrar.address, 8, 6)}</span> published one registration transaction per device, binding its public key to the public service IDs it may measure.</p>
        ${[...new Set(registry.devices.map((d) => d.group))].map((g) => `
        <h3 class="device-group">${g} <span class="muted">${registry.devices.filter((d) => d.group === g).length}</span></h3>
        <ul class="device-list">
          ${registry.devices.filter((d) => d.group === g).map((d) => `
          <li class="device">
            <div class="device-top"><strong>${esc(d.model)}</strong><span class="mono muted">${d.serial}</span>${d.reg.verified ? '<span class="pill pill-ok">Registered</span>' : ''}</div>
            <dl class="kv">
              <div><dt>Device public key</dt><dd class="mono wrap">${d.key.pubHex}</dd></div>
              <div><dt>Services</dt><dd>${d.services.map((sl, i) => `${esc(findService(sl).label)} <span class="mono svc-id">${d.svcIds[i]}</span>`).join(' · ')}</dd></div>
              <div><dt>Registration tx</dt><dd class="mono wrap">${d.reg.txid}</dd></div>
            </dl>
          </li>`).join('')}
        </ul>`).join('')}
      </details>`;
}

function contractsPanel() {
  const open = contracts.filter((c) => c.status === 'open');
  const done = contracts.filter((c) => c.status === 'fulfilled');
  const earned = done.reduce((a, c) => a + (c.doctorPaidSats || 0), 0);
  const card = (c) => {
    const g = SERVICES[c.svc.group];
    return `
        <li class="contract ${c.status}" style="--g:${g.color};--g-soft:${g.soft}">
          <div class="contract-main">
            <div class="contract-top">
              <span class="contract-id">#${c.id}</span>
              <span class="contract-name">${esc(c.svc.label)}</span>
              <span class="pill pill-type mono">${c.svc.type}</span>
              <span class="svc-id mono" title="Public service ID">${c.svc.sid}</span>
            </div>
            <div class="contract-meta">
              <span>${c.peer ? 'Requested by another peer' : `Requested in Tx ${c.reqN} · K${c.req.key.index} (you)`}</span>
              <span class="mono" title="${c.req.tpl.txid}">${short(c.req.tpl.txid, 8, 6)}</span>
            </div>
          </div>
          <div class="contract-side">
            <span class="reward">${c.escrowSats !== undefined ? (c.escrowSats / ONE_BSV_SATS).toFixed(2) + ' BSV demo' : c.reward + ' sat demo'}</span>
            ${c.status === 'open'
              ? `<span class="open-tag">Open</span>`
              : `<span class="fulfilled">Closed in Tx ${c.fulN} · K${c.ful.key.index}</span>`}
          </div>
          ${c.initial && c.status === 'open' ? `<div class="contract-actions"><button type="button" class="btn-submit" data-consult-complete="${c.id}">Complete consultation · 1 BSV</button><label>Request another service <select data-consult-service="${c.id}">${Object.values(SERVICES).flatMap(g => g.items).filter(it => it.id !== 'consultation').map(it => `<option value="${it.id}">${esc(it.label)}</option>`).join('')}</select></label><button type="button" class="btn-ghost" data-consult-refer="${c.id}">Pay doctor 0.5 BSV + refer 0.5 BSV</button></div>` : ''}
        </li>`;
  };
  return `
      <section class="contracts" aria-labelledby="ct-h">
        <div class="section-head">
          <h2 id="ct-h">Service contracts</h2>
          <span class="count">${open.length} open</span>
          <span class="count">${done.length} closed</span>
          <span class="count count-earned">${(earned / ONE_BSV_SATS).toFixed(2)} BSV demo doctor allocation</span>
        </div>
        ${contracts.length
          ? `<ol class="contract-list">${[...open, ...done].map(card).join('')}</ol>`
          : `<p class="empty">No contracts yet. Each service a patient requests shows up here for providers to fulfil.</p>`}

      </section>`;
}

function providerPanel() {
  const currentComplaint = contractById(selectedConcernId);
  const allocation = currentComplaint?.allocation;
  return `
    <section class="provider" aria-labelledby="prov-h">
      <div class="recip-head">${backBtn}<h1 id="prov-h" class="prov-title">Provider</h1></div>
      ${currentComplaint?.initial ? `<section class="contracts">
        <h2>Patient complaint · 100 sats</h2>
        <p>${esc(currentComplaint.complaint)}</p>
        <p><strong>Patient public key:</strong> <span class="mono wrap">${esc(currentComplaint.req.key.pubHex)}</span></p>
        ${currentComplaint.providerPublicKey ? `<p><strong>Provider public key:</strong> <span class="mono wrap">${esc(currentComplaint.providerPublicKey)}</span></p>
        <p><strong>ECDH handshake:</strong> ${currentComplaint.handshake?.verified === true ? 'Both sides verified' : 'Provider shared secret derived; patient-side confirmation pending'}</p>
        <p><strong>100 sats escrow:</strong> Demo reserved only — not funded or locked on BSV</p>` : ''}
        <p><strong>50 sats</strong> · Call / text consultation</p>
        <p><strong>50 sats</strong> · Referral reserve, or return to patient if unused</p>
        ${currentComplaint.status === 'open' ? `<button type="button" class="btn-submit" id="complete-complaint">Complete call / text · 50 sats</button>` : ''}
        ${currentComplaint.status === 'consulted' ? `<p>Consultation completed · 50 sats assigned to provider</p>
          <button type="button" class="btn-submit" id="refer-complaint">Referral needed · allocate 50 sats</button>
          <button type="button" class="btn-back" id="refund-complaint">No referral · return 50 sats to patient</button>` : ''}
        ${currentComplaint.status === 'fulfilled' ? `<p>Completed · ${allocation?.referral === 'refund' ? '50 sats returned to patient' : '50 sats reserved for referral'}</p>` : ''}
        <p class="concern-status">Local BSV-format demonstration only. No real satoshis are funded, locked, or transferred.</p>
      </section>` : ''}
      ${devicesPanel()}
      ${contractsPanel()}
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
            <span class="svc-id mono" title="Public service ID">${it.sid}</span>
          </button>`).join('')}
        </div>
      </div>`;
  return `
    <section class="recipient" aria-labelledby="recip-h">
      <div class="recip-head">${backBtn}<h1 id="recip-h">Patient</h1></div>
      ${Object.keys(SERVICES).map(group).join('')}
    </section>`;
}

function renderSession() {
  app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">z</span><span>zHealth</span></div>
    ${keyChip()}
    <button type="button" class="btn-back" id="download-transactions">Download Transactions</button>
  </header>
  <main class="session">
    ${view === 'welcome' ? welcomePanel() : view === 'provider-list' ? providerComplaintsPanel() : view === 'intake' ? intakePanel() : view === 'registration' ? registrationPanel() : view === 'recipient' ? recipientPanel() : view === 'provider' ? providerPanel() : rolesPanel()}
  </main>`;

  document.getElementById('download-transactions')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const count = await downloadClickTransactions();
      if (!count) alert('No saved transactions found yet.');
    } catch (error) { alert('Unable to download transactions: ' + error.message); }
    finally { button.disabled = false; }
  });
  document.getElementById('enter-patient')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      // Generate a fresh random HD seed for each Patient entry, independent of prior keys.
      session = newSession();
      const patientTx = await addEvent('patient', 'Patient', { label: 'Patient entry', type: 'identity.patient' });
      view = 'intake';
      renderSession();
    } catch (error) {
      button.disabled = false;
      alert('Unable to create Patient transaction: ' + error.message);
    }
  });
  document.getElementById('enter-provider')?.addEventListener('click', () => { view = 'provider-list'; renderSession(); });
  document.getElementById('home-entry')?.addEventListener('click', () => { view = 'welcome'; renderSession(); });
  app.querySelectorAll('[data-open-provider-tx]').forEach(b => b.addEventListener('click', () => {
    const saved = readComplaintsList().find(item => item.txid === b.dataset.openProviderTx);
    if (!saved) return;
    let concern = contracts.find(item => item.initial && item.req.tpl.txid === saved.txid);
    if (!concern) {
      const svc = findService('consultation');
      const id = Math.max(0, ...contracts.map(item => item.id)) + 1;
      concern = { id, svc, complaint: saved.complaint, initial: true, status: saved.status, allocation: saved.allocation,
        reward: saved.rewardSats, escrowSats: saved.status === 'open' ? saved.rewardSats : 0,
        req: { tpl: { txid: saved.txid, rawHex: saved.rawHex }, key: { pubHex: saved.publicKey, address: saved.address } } };
      contracts.push(concern);
    }
    if (!concern.providerPublicKey && concern.status === 'open') {
      const providerKey = deriveKey();
      const patientPublicKey = concern.req.key.pubHex;
      const providerSecret = sharedSecretHex(providerKey.privHex, patientPublicKey);
      const patientKey = keys.find(key => key.pubHex === patientPublicKey);
      const verified = patientKey ? sharedSecretHex(patientKey.privHex, providerKey.pubHex) === providerSecret : null;
      concern.providerPublicKey = providerKey.pubHex;
      concern.providerAddress = providerKey.address;
      concern.providerPrivateKey = providerKey.privHex;
      concern.handshake = { patientPublicKey, providerPublicKey: providerKey.pubHex,
        matchCode: matchCode(providerKey.privHex, patientPublicKey), verified };
      concern.escrowSats = 100;
      concern.escrowStatus = 'demo-reserved-not-funded';
      const savedList = readComplaintsList();
      const record = savedList.find(item => item.txid === saved.txid);
      if (record) {
        record.providerPublicKey = providerKey.pubHex;
        record.providerAddress = providerKey.address;
        record.handshakeStatus = verified === true ? 'verified-locally' : 'provider-derived-patient-unverified';
        record.escrowSats = 100;
        record.escrowStatus = 'demo-reserved-not-funded';
        localStorage.setItem(COMPLAINTS_LIST, JSON.stringify(savedList));
      }
      addEvent('provider.accept', 'Provider acceptance for complaint ' + saved.txid,
        { label: 'Provider ECDH acceptance', contractId: concern.id },
        { key: providerKey, extra: [patientPublicKey] }).then(acceptance => {
          concern.acceptance = acceptance;
          const list = readComplaintsList();
          const item = list.find(entry => entry.txid === saved.txid);
          if (item) { item.acceptanceTxid = acceptance.tpl.txid; item.acceptanceRawHex = acceptance.tpl.rawHex; localStorage.setItem(COMPLAINTS_LIST, JSON.stringify(list)); }
        }).catch(error => console.warn('Unable to prepare provider acceptance demo transaction', error));
    }
    selectedConcernId = concern.id;
    view = 'provider';
    renderSession();
  }));
  attachKeyCopy();
  document.getElementById('intake-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === 'true') return;
    const complaint = form.querySelector('#complaint').value.trim();
    if (!complaint) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    form.dataset.submitting = 'true';
    try {
      const svc = findService('consultation');
      const id = contracts.length + 1;
      const req = await addEvent('service', complaint, { label: 'Initial consultation', type: svc.type, group: svc.group, contractId: id, sid: svc.sid }, { extra: [svc.sid] });
      saveComplaintTransaction(complaint, req);
      contracts.push({ id, svc, req, reqN: txs.length, status: 'open', reward: REWARD_SATS, escrowSats: REWARD_SATS, initial: true, complaint });
      complaintSubmitted = true;
      selectedConcernId = id;
      view = 'registration';
      renderSession();
    } catch (error) {
      submit.disabled = false;
      form.dataset.submitting = 'false';
      alert('Unable to prepare the demonstration transaction: ' + error.message);
    }
  });
  document.getElementById('registration-continue')?.addEventListener('click', () => { view = 'welcome'; renderSession(); });
  document.getElementById('export-healthblocks')?.addEventListener('click', exportHealthBlocks);
  document.getElementById('new-concern')?.addEventListener('click', () => { view = 'intake'; renderSession(); });
  app.querySelectorAll('[data-concern-role]').forEach((b) =>
    b.addEventListener('click', async () => {
      const role = b.dataset.concernRole;
      selectedConcernId = Number(b.dataset.concernId);
      app.querySelectorAll('[data-concern-role]').forEach(x => (x.disabled = true));
      try {
        await addEvent(role, role === 'provider' ? 'Provider' : 'Patient');
        view = role;
        renderSession();
      } catch (error) { alert('Unable to open concern: ' + error.message); renderSession(); }
    }));
  app.querySelectorAll('.btn-svc').forEach((b) =>
    b.addEventListener('click', async () => {
      const svc = findService(b.dataset.svc);
      app.querySelectorAll('.btn-svc').forEach((x) => (x.disabled = true));
      const id = contracts.length + 1;
      const req = await addEvent('service', svc.label, { label: svc.label, type: svc.type, group: svc.group, contractId: id, sid: svc.sid }, { extra: [svc.sid] });
      contracts.push({ id, svc, req, reqN: txs.length, status: 'open', reward: REWARD_SATS });
      renderSession();
      app.querySelector('.tx')?.classList.add('tx-new');
    }));
  async function resolveConsultation(id, referral) {
    const c = contractById(id);
    if (!c || !c.initial || c.status !== 'open') return;
    const service = referral ? findService(app.querySelector(`[data-consult-service="${id}"]`).value) : null;
    const doctorPaidSats = referral ? HALF_BSV_SATS : ONE_BSV_SATS;
    const note = referral ? `Consultation referred: ${service.label}; simulated doctor allocation 0.5 BSV and new service escrow 0.5 BSV` : 'Consultation fulfilled; simulated doctor allocation 1 BSV';
    const ful = await addEvent('fulfil', note, { label: referral ? 'Consultation referral' : 'Consultation complete', contractId: c.id });
    c.ful = ful; c.fulN = txs.length; c.status = 'fulfilled'; c.doctorPaidSats = doctorPaidSats;
    c.escrowSats = 0;
    if (referral) {
      const req = await addEvent('service', `Follow-up requested: ${service.label}`, { label: service.label, type: service.type, group: service.group, contractId: contracts.length + 1, sid: service.sid }, { extra: [service.sid] });
      contracts.push({ id: contracts.length + 1, svc: service, req, reqN: txs.length, status: 'open', reward: HALF_BSV_SATS, escrowSats: HALF_BSV_SATS, parentId: c.id });
    }
    renderSession();
  }
  document.getElementById('complete-complaint')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const concern = contractById(selectedConcernId);
      if (!concern || concern.status !== 'open') return;
      const providerKey = deriveKey();
      const fulfil = await addEvent('fulfil', 'Call/text consultation · 50 sats allocated', { label: 'Call/text consultation', contractId: concern.id }, { key: providerKey });
      concern.ful = fulfil; concern.fulN = txs.length;
      concern.providerAddress = providerKey.address;
      concern.providerPrivateKey = providerKey.privHex;
      concern.allocation = { consultation: 50, referral: 'reserved', referralSats: 50 };
      concern.status = 'consulted'; concern.doctorPaidSats = 50; concern.escrowSats = 50;
      const saved = readComplaintsList();
      const item = saved.find(item => item.txid === concern.req.tpl.txid);
      if (item) { item.status = 'consulted'; item.providerAddress = providerKey.address; item.allocation = concern.allocation; localStorage.setItem(COMPLAINTS_LIST, JSON.stringify(saved)); }
      renderSession();
    } catch (error) { alert(error.message); renderSession(); }
  });
  for (const [id, outcome] of [['refer-complaint', 'referral'], ['refund-complaint', 'refund']]) {
    document.getElementById(id)?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        const concern = contractById(selectedConcernId);
        if (!concern || concern.status !== 'consulted') return;
        const description = outcome === 'refund' ? 'Unused referral reserve: return 50 sats to patient' : 'Referral needed: allocate 50 sats';
        const recipient = outcome === 'refund' ? concern.req.key.address : null;
        const transaction = await addEvent('fulfil', description, { label: description, contractId: concern.id }, recipient ? { payTo: recipient } : {});
        concern.referralTx = transaction;
        concern.allocation.referral = outcome;
        concern.status = 'fulfilled'; concern.escrowSats = 0;
        const saved = readComplaintsList();
        const item = saved.find(item => item.txid === concern.req.tpl.txid);
        if (item) { item.status = 'fulfilled'; item.allocation = concern.allocation; item.referralTxid = transaction.tpl.txid; localStorage.setItem(COMPLAINTS_LIST, JSON.stringify(saved)); }
        renderSession();
      } catch (error) { alert(error.message); renderSession(); }
    });
  }
  app.querySelectorAll('[data-consult-complete]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; await resolveConsultation(Number(b.dataset.consultComplete), false); }));
  app.querySelectorAll('[data-consult-refer]').forEach(b => b.addEventListener('click', async () => { b.disabled = true; await resolveConsultation(Number(b.dataset.consultRefer), true); }));
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  on('v-start', () => { visit = { D: deriveKey() }; renderSession(); });
  on('v-reset', () => { visit = null; renderSession(); });
  on('v-code', () => {
    const own = contractById(Number(document.getElementById('v-own').value));
    visit.ownId = own.id;
    visit.code = matchCode(own.req.key.privHex, visit.D.pubHex);       // patient: H(a·D)
    renderSession();
  });
  on('v-scan', () => {
    visit.scan = contracts.filter((x) => x.status === 'open').map((x) => {
      const code = matchCode(visit.D.privHex, x.req.key.pubHex);        // doctor: H(d·A)
      return { id: x.id, label: x.svc.label, code, match: code === visit.code };
    });
    const hits = visit.scan.filter((r) => r.match);
    visit.matchedId = hits.length === 1 ? hits[0].id : null;
    renderSession();
  });
  on('v-post', async (e) => {
    e.target.disabled = true;
    const c = contractById(visit.matchedId);
    const payTo = closeAddressForPatient(visit.D.privHex, c.req.key.pubHex, c.req.tpl.txid);   // doctor: A' from (d, A)
    const devs = devicesFor(registry, c.svc.id);
    let value, extra = [c.svc.sid], device = null;
    if (devs.length) {
      device = devs[Number(document.getElementById('v-device').value) || 0];
      value = device.read(c.svc.id);                                                       // device measures
      const sig = signReading(device, c.svc.sid, value, visit.D.pubHex, payTo);            // device signs
      extra = [c.svc.sid, device.key.pubHex, sig];
      visit.reading = { device, value, sig };
      visit.check = validateReading(registry, { svc: c.svc.sid, value, devicePub: device.key.pubHex, sig, D: visit.D.pubHex, closeAddr: payTo });
    } else {
      value = (document.getElementById('v-result').value || '').trim() || resultDefault(c.svc.label);
    }
    const text = `${c.svc.label}: ${value}`;
    c.ful = await addEvent('fulfil', text, { label: text, type: c.svc.type, contractId: c.id, sid: c.svc.sid, device }, { key: visit.D, payTo, extra });
    c.fulN = txs.length;
    c.status = 'fulfilled';
    visit.resultTx = c.ful;
    visit.patientClose = closeKeyForPatient(c.req.key.privHex, visit.D.pubHex, c.req.tpl.txid); // patient: a' from (a, D)
    renderSession();
  });
  on('v-forge', () => {
    const c = contractById(visit.matchedId);
    const fake = unregisteredDevice(visit.reading.device.model);
    const r = visit.reading, payTo = visit.resultTx.tpl.payTo;
    const sig = signReading(fake, c.svc.sid, r.value, visit.D.pubHex, payTo);
    visit.forged = validateReading(registry, { svc: c.svc.sid, value: r.value, devicePub: fake.key.pubHex, sig, D: visit.D.pubHex, closeAddr: payTo });
    renderSession();
  });
  on('add-peers', async (e) => {
    e.target.disabled = true;
    const picks = ['temperature', 'temperature', 'temperature', 'bp'];
    for (const id of picks) {
      const svc = findService(id);
      const k = randomPeerKey();
      const req = { role: 'peer', key: { ...k, index: null }, tpl: await buildTx(svc.label, k.privHex, null, [svc.sid]) };
      contracts.push({ id: contracts.length + 1, svc, req, peer: true, status: 'open', reward: REWARD_SATS });
    }
    peerSeq += picks.length;
    renderSession();
  });
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
  document.getElementById('end')?.addEventListener('click', () => {
    session = null; keys = []; txs = []; contracts = []; visit = null;
    startSession().catch(console.error);
  });
}

startSession().catch(console.error);

// Every action click gets a fresh independent address. The address chip itself
// retains its copy-private-key behavior without rotating on that click.
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.id === 'copy-key' || button.id === 'enter-patient' || button.disabled) return;
  const action = button.id || button.dataset.openProviderTx && 'open-complaint' || button.dataset.svc && 'select-service' || button.textContent.trim() || 'button-click';
  recordClickTransaction(action).catch(error => console.warn('Unable to save click demo transaction', error));
  if (keys.length) refreshClickAddress();
}, true);
