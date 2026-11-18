import './style.css';
import { newSession, ACCOUNT_PATH } from './chain.js';
import { buildTx, keyInfo, PLACEHOLDER_SATS, CLOSE_SATS } from './tx.js';
import { serviceId, createRegistry, devicesFor, signReading, validateReading, unregisteredDevice } from './devices.js';
import { matchCode, closeAddressForPatient, closeKeyForPatient, randomPeerKey } from './ecdh.js';

const app = document.getElementById('app');
// Demo reward a provider earns for fulfilling a patient's service contract.
// Real amounts and escrow are not decided yet.
const REWARD_SATS = 100;
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
  const key = session.nextKey();
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
  return t;
}
const contractById = (id) => contracts.find((c) => c.id === id);

/* ---------- Page 1: Welcome ---------- */
async function startSession() {
  session = newSession();
  keys = []; txs = []; contracts = []; visit = null;
  complaintSubmitted = false;
  registry = await createRegistry();
  view = 'intake';
  renderSession();
}

/* ---------- Page 2: Session ---------- */
function keyChip() {
  const k = keys[keys.length - 1];
  if (!k) return '';
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

function intakePanel() {
  return `<section class="intake" aria-labelledby="intake-title">
    <h1 id="intake-title">What brings you in today?</h1>
    <form id="intake-form">
      <textarea id="complaint" name="complaint" rows="6" maxlength="2000" required aria-label="Describe your symptoms or concerns" placeholder="Describe your symptoms or concerns"></textarea>
      <button class="btn-submit" type="submit">Get Help</button>
    </form>
  </section>`;
}

function rolesPanel() {
  const concerns = contracts.filter(c => c.initial);
  return `
    <section class="concerns" aria-label="Patient concerns">
      <div class="concerns-head"><h1>Active concerns</h1><button type="button" class="btn-back" id="new-concern">+ New concern</button></div>
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
        <button type="button" class="btn-ghost" id="add-peers">Add 4 requests from other peers</button>
        <p class="disclaimer">All BSV amounts are simulated allocations only. No coins are locked, transferred, or broadcast.</p>
      </section>`;
}

function providerPanel() {
  return `
    <section class="provider" aria-labelledby="prov-h">
      <div class="recip-head">${backBtn}<h1 id="prov-h" class="prov-title">Provider</h1></div>
      ${devicesPanel()}
      ${visitPanel()}
      ${contractsPanel()}
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
            ${keys.map((k) => { const t = txs.find((x) => x.key === k); return `<li><span class="chain-i">K${k.index}</span><span class="mono" title="${k.address}">${short(k.address, 10, 6)}</span><span class="chain-role" title="${esc(t.label || ROLE_LABEL[t.role])}">${esc(t.label || ROLE_LABEL[t.role])}</span></li>`; }).join('')}
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
  </header>
  <main class="session">
    ${view === 'intake' ? intakePanel() : view === 'recipient' ? recipientPanel() : view === 'provider' ? providerPanel() : rolesPanel()}
  </main>`;

  document.getElementById('intake-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.submitting === 'true') return;
    const form = event.currentTarget;
    const complaint = form.querySelector('#complaint').value.trim();
    if (!complaint) return;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    form.dataset.submitting = 'true';
    try {
      const svc = findService('consultation');
      const id = contracts.length + 1;
      const req = await addEvent('service', complaint, { label: 'Initial consultation', type: svc.type, group: svc.group, contractId: id, sid: svc.sid }, { extra: [svc.sid] });
      contracts.push({ id, svc, req, reqN: txs.length, status: 'open', reward: ONE_BSV_SATS, escrowSats: ONE_BSV_SATS, initial: true, complaint });
      complaintSubmitted = true;
      selectedConcernId = id;
      view = 'roles';
      renderSession();
    } catch (error) {
      submit.disabled = false;
      form.dataset.submitting = 'false';
      alert('Unable to prepare the demonstration transaction: ' + error.message);
    }
  });
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
