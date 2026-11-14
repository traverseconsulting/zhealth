import './style.css';
import { newSession, ACCOUNT_PATH } from './chain.js';
import { buildTemplate } from './tx.js';

const app = document.getElementById('app');
const WELCOME_TEXT = 'Welcome to the Zhealth';

let session = null;   // HD session (in memory only)
let keys = [];        // derived keys, in order
let txs = [];         // { role, key, tpl }

const short = (h, a = 10, b = 8) => `${h.slice(0, a)}…${h.slice(-b)}`;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function addEvent(role, text) {
  const key = session.nextKey();
  keys.push(key);
  txs.push({ role, key, tpl: buildTemplate(text, key) });
}

/* ---------- Page 1: Welcome ---------- */
function renderWelcome() {
  app.innerHTML = `
  <main class="welcome">
    <div class="welcome-inner">
      <p class="eyebrow">Peer-to-peer healthcare data</p>
      <button class="btn-welcome" id="welcome" type="button">
        <span>Welcome to zHealth</span>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <p class="welcome-note">Clicking generates a random 256-bit key in this browser. Every action after that gets its own key, derived from that root.</p>
    </div>
  </main>`;
  document.getElementById('welcome').addEventListener('click', () => {
    session = newSession();
    keys = []; txs = [];
    addEvent('welcome', WELCOME_TEXT);
    renderSession();
  });
}

/* ---------- Page 2: Session ---------- */
function keyChip() {
  const k = keys[keys.length - 1];
  return `
  <div class="keychip" tabindex="0" aria-describedby="keypop" aria-label="Latest public key K${k.index}. Hover or focus to reveal the private key.">
    <span class="keychip-tag">K${k.index}</span>
    <span class="mono">${short(k.pubHex, 8, 6)}</span>
    <div class="keypop" id="keypop" role="tooltip">
      <div class="kp-row"><span class="kp-label">Path</span><span class="mono">${k.path}</span></div>
      <div class="kp-row"><span class="kp-label">Public key (33 bytes)</span><span class="mono wrap">${k.pubHex}</span></div>
      <div class="kp-row danger"><span class="kp-label">Private key (256-bit)</span><span class="mono wrap">${k.privHex}</span></div>
    </div>
  </div>`;
}

function txCard(t, n) {
  const label = { welcome: 'Welcome', provider: 'Provider', recipient: 'Recipient' }[t.role];
  return `
  <article class="tx" data-role="${t.role}">
    <header class="tx-head">
      <div class="tx-title">
        <span class="tx-num">Tx ${n + 1}</span>
        <span class="pill pill-${t.role}">${label}</span>
      </div>
      <span class="tx-meta mono">K${t.key.index} · ${t.key.path}</span>
    </header>
    <dl class="tx-fields">
      <div><dt>OP_RETURN text</dt><dd class="tx-text">“${esc(t.tpl.text)}”</dd></div>
      <div><dt>Public key</dt><dd class="mono wrap">${t.key.pubHex}</dd></div>
      <div><dt>Template txid</dt><dd class="mono wrap">${t.tpl.txid}</dd></div>
    </dl>
    <details class="tx-details">
      <summary>Output script and raw hex <span class="muted">(${t.tpl.size} bytes · signature ${t.tpl.verified ? 'verified' : 'invalid'})</span></summary>
      <ol class="pushes">
        <li><span class="op">OP_FALSE OP_RETURN</span></li>
        ${t.tpl.pushes.map((p) => `<li><span class="push-label">${p.label}</span><span class="mono wrap">${esc(p.value)}</span></li>`).join('')}
      </ol>
      <div class="raw">
        <div class="raw-head"><span>Raw transaction (unsigned, unfunded)</span><button type="button" class="btn-copy" data-copy="${t.tpl.rawHex}">Copy hex</button></div>
        <code class="mono wrap">${t.tpl.rawHex}</code>
      </div>
    </details>
  </article>`;
}

function renderSession() {
  app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">z</span><span>zHealth</span></div>
    ${keyChip()}
  </header>
  <main class="session">
    <section class="roles" aria-labelledby="roles-h">
      <h1 id="roles-h">Who are you in this interaction?</h1>
      <p class="lede">Each choice derives a new key from your root and builds its own transaction.</p>
      <div class="role-buttons">
        <button type="button" class="btn-role" data-role="provider">
          <span class="role-name">Provider</span><span class="role-desc">Clinician, lab, device</span>
        </button>
        <button type="button" class="btn-role" data-role="recipient">
          <span class="role-name">Recipient</span><span class="role-desc">Patient receiving care</span>
        </button>
      </div>
    </section>

    <div class="grid">
      <section class="txlist" aria-labelledby="tx-h">
        <div class="section-head">
          <h2 id="tx-h">Transaction templates</h2>
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
          ${keys.map((k) => `<li><span class="chain-i">K${k.index}</span><span class="mono">${short(k.pubHex, 10, 6)}</span><span class="chain-role">${txs[k.index].role}</span></li>`).join('')}
        </ol>
        <p class="chain-path mono">${ACCOUNT_PATH}/i' (hardened)</p>
        <button type="button" class="btn-end" id="end">End session and discard keys</button>
      </aside>
    </div>

    <p class="disclaimer">Demo only. Keys live in this tab's memory and disappear when you close it or end the session. Templates are not funded or broadcast. Don't send coins to these keys.</p>
  </main>`;

  app.querySelectorAll('.btn-role').forEach((b) =>
    b.addEventListener('click', () => {
      const role = b.dataset.role;
      addEvent(role, role === 'provider' ? 'Provider' : 'Recipient');
      renderSession();
      app.querySelector('.tx')?.classList.add('tx-new');
    }));
  app.querySelectorAll('.btn-copy').forEach((b) =>
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; }
      catch { b.textContent = 'Copy blocked'; }
      setTimeout(() => (b.textContent = 'Copy hex'), 1500);
    }));
  document.getElementById('end').addEventListener('click', () => {
    session = null; keys = []; txs = [];
    renderWelcome();
  });
}

renderWelcome();
