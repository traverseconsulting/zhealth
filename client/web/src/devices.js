// Service identifiers and trusted devices (spec draft, section 7.8).
//
// Service ID   svc = SHA-256("zhealth.service/" + slug)[0..8]  (8 bytes, 16 hex)
//              One fixed identifier per event microservice; every request and
//              result for that service carries it.
//
// Trusted device: a measuring device (thermometer, BP monitor, ...) holds its
// own key pair. The network registrar publishes a registration tx binding the
// device public key to the service IDs it may measure. At a visit, the device
// signs the reading:
//
//   msg = svc ‖ value ‖ D ‖ A'     (D = doctor visit key, A' = patient close address)
//   sig = ECDSA(device key, SHA-256(msg))
//
// The result tx carries  "<label>: <value>" <svc> <device pubkey> <sig>.
// A node accepts it only if the device is registered, is allowed that service
// ID, and the signature checks against the values in the same tx. Binding D
// and A' stops a captured reading being replayed in another result.
import { PrivateKey, PublicKey, Signature, Hash, Utils } from '@bsv/sdk';
import { buildTx } from './tx.js';

export const serviceId = (slug) => Utils.toHex(Hash.sha256(Utils.toArray(`zhealth.service/${slug}`, 'utf8'))).slice(0, 16);

const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const dec = (lo, hi, d = 1) => (lo + Math.random() * (hi - lo)).toFixed(d);
const hash8 = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
const lot = () => `${String.fromCharCode(65 + rnd(0, 25))}${String.fromCharCode(65 + rnd(0, 25))}${rnd(1000, 9999)}`;
const bp = () => `${rnd(110, 128)}/${rnd(70, 82)} mmHg`;

// Device models, grouped like the Recipient page. Each one may measure only
// the services listed; `units` is how many registered units the network has.
// Every one of the 33 microservices is covered by at least one model.
export const DEVICE_MODELS = [
  // Vital signs
  { group: 'Vital signs', model: 'Thermometer', prefix: 'TH', units: 2, services: ['temperature'], read: () => `${dec(36.4, 37.4)} °C` },
  { group: 'Vital signs', model: 'Vital signs monitor', prefix: 'VS', units: 1, services: ['vitals', 'temperature', 'bp', 'pulse', 'spo2', 'resp'],
    read: (s) => ({ vitals: `${dec(36.4, 37.3)} °C, ${bp()}, ${rnd(62, 84)} bpm, ${rnd(95, 99)}%, ${rnd(12, 18)}/min`, temperature: `${dec(36.4, 37.4)} °C`, bp: bp(), pulse: `${rnd(62, 84)} bpm`, spo2: `${rnd(95, 99)}%`, resp: `${rnd(12, 18)} breaths/min` }[s]) },
  { group: 'Vital signs', model: 'Blood pressure monitor', prefix: 'BP', units: 2, services: ['bp', 'pulse'], read: (s) => (s === 'pulse' ? `${rnd(62, 84)} bpm` : bp()) },
  { group: 'Vital signs', model: 'Pulse oximeter', prefix: 'OX', units: 1, services: ['spo2', 'pulse'], read: (s) => (s === 'pulse' ? `${rnd(62, 84)} bpm` : `${rnd(95, 99)}%`) },
  { group: 'Vital signs', model: 'Respiratory monitor', prefix: 'RM', units: 1, services: ['resp'], read: () => `${rnd(12, 18)} breaths/min` },
  { group: 'Vital signs', model: 'Scale', prefix: 'SC', units: 1, services: ['weight'], read: () => `${dec(55, 90)} kg` },
  { group: 'Vital signs', model: 'Pain assessment tablet', prefix: 'PA', units: 1, services: ['pain'], read: () => `${rnd(0, 6)}/10` },
  // Tests and samples
  { group: 'Tests and samples', model: 'Glucometer', prefix: 'GL', units: 1, services: ['glucose'], read: () => `${rnd(80, 120)} mg/dL` },
  { group: 'Tests and samples', model: 'Specimen labeler', prefix: 'SL', units: 1, services: ['blood', 'urine', 'swab', 'pap'],
    read: (s) => `${{ blood: 'Blood tube', urine: 'Urine cup', swab: 'Swab', pap: 'Cervical sample' }[s]} collected, label ${lot()}` },
  { group: 'Tests and samples', model: 'ECG machine', prefix: 'EC', units: 1, services: ['ecg'], read: () => `Sinus rhythm, ${rnd(60, 82)} bpm, tracing ${hash8()}` },
  // Lab tests
  { group: 'Lab tests', model: 'Hematology analyzer', prefix: 'HA', units: 1, services: ['cbc'], read: () => `WBC ${dec(4.5, 9.5)}, Hgb ${dec(12.5, 15.5)}, Plt ${rnd(180, 360)}` },
  { group: 'Lab tests', model: 'Chemistry analyzer', prefix: 'CA', units: 1, services: ['cmp', 'lipid'],
    read: (s) => (s === 'lipid' ? `LDL ${rnd(70, 130)}, HDL ${rnd(40, 70)}, TG ${rnd(70, 160)} mg/dL` : `Glu ${rnd(75, 105)}, Na ${rnd(136, 144)}, K ${dec(3.6, 4.8)}, Cr ${dec(0.7, 1.1)}`) },
  { group: 'Lab tests', model: 'HbA1c analyzer', prefix: 'A1', units: 1, services: ['a1c'], read: () => `${dec(4.8, 5.9)}%` },
  { group: 'Lab tests', model: 'Immunoassay analyzer', prefix: 'IA', units: 1, services: ['tsh'], read: () => `TSH ${dec(0.8, 3.5)} mIU/L` },
  { group: 'Lab tests', model: 'Urine analyzer', prefix: 'UA', units: 1, services: ['ua'], read: () => `Negative, SG 1.0${rnd(10, 25)}, pH ${dec(5.5, 7.0)}` },
  // Imaging
  { group: 'Imaging', model: 'Digital X-ray system', prefix: 'XR', units: 1, services: ['xray'], read: () => `2 views captured, image ${hash8()}` },
  { group: 'Imaging', model: 'Ultrasound scanner', prefix: 'US', units: 1, services: ['ultrasound'], read: () => `Scan captured, image ${hash8()}` },
  { group: 'Imaging', model: 'Mammography unit', prefix: 'MG', units: 1, services: ['mammogram'], read: () => `4 views captured, image ${hash8()}` },
  // Screenings
  { group: 'Screenings', model: 'Digital stethoscope', prefix: 'DS', units: 1, services: ['physical'], read: () => `Heart and lungs clear, audio ${hash8()}` },
  { group: 'Screenings', model: 'Vision screener', prefix: 'VI', units: 1, services: ['eye'], read: () => `20/${[20, 20, 25, 30][rnd(0, 3)]} both eyes` },
  { group: 'Screenings', model: 'Audiometer', prefix: 'AU', units: 1, services: ['hearing'], read: () => `Pass, ${[15, 20, 25][rnd(0, 2)]} dB both ears` },
  { group: 'Screenings', model: 'Screening tablet', prefix: 'ST', units: 1, services: ['depression'], read: () => `PHQ-9 score ${rnd(0, 9)}` },
  { group: 'Screenings', model: 'Dermatoscope', prefix: 'DM', units: 1, services: ['skin'], read: () => `${rnd(1, 4)} lesions imaged, image ${hash8()}` },
  { group: 'Screenings', model: 'FIT analyzer', prefix: 'FI', units: 1, services: ['colorectal'], read: () => 'FIT negative' },
  // Treatment
  { group: 'Treatment', model: 'Medication scanner', prefix: 'MS', units: 1, services: ['medication', 'vaccine'],
    read: (s) => (s === 'vaccine' ? `Dose given, lot ${lot()}` : `${[250, 500, 1000][rnd(0, 2)]} mg given, lot ${lot()}`) },
  { group: 'Treatment', model: 'Wound camera', prefix: 'WC', units: 1, services: ['wound'], read: () => `Dressed, ${dec(1, 4)} cm, image ${hash8()}` },
  { group: 'Treatment', model: 'Infusion pump', prefix: 'IP', units: 1, services: ['iv'], read: () => `Line started, ${[75, 100, 125][rnd(0, 2)]} mL/h` },
];

const keyPair = () => { const k = PrivateKey.fromRandom(); return { privHex: k.toHex(), pubHex: k.toPublicKey().toString(), address: k.toPublicKey().toAddress() }; };

// Build the network: one registrar and one registered unit of each model.
export async function createRegistry() {
  const registrar = keyPair();
  const devices = [];
  const serials = new Set();
  for (const m of DEVICE_MODELS) for (let u = 0; u < (m.units || 1); u++) {
    const key = keyPair();
    let serial;
    do serial = `${m.prefix}-${1000 + Math.floor(Math.random() * 9000)}`; while (serials.has(serial));
    serials.add(serial);
    const svcIds = m.services.map(serviceId);
    const text = `Device registered: ${m.model} ${serial}`;
    const reg = await buildTx(text, registrar.privHex, null, [key.pubHex, ...svcIds]);
    devices.push({ ...m, serial, key, svcIds, reg });
  }
  return { registrar, devices };
}

export const devicesFor = (registry, slug) => registry.devices.filter((d) => d.services.includes(slug));

const message = (svc, value, D, closeAddr) => Utils.toArray(`${svc}|${value}|${D}|${closeAddr}`, 'utf8');

export function signReading(device, svc, value, D, closeAddr) {
  return PrivateKey.fromHex(device.key.privHex).sign(message(svc, value, D, closeAddr)).toDER('hex');
}

// Node-side check of a result. Inputs come from the result tx alone plus the
// public registry (registration txs signed by the registrar).
export function validateReading(registry, { svc, value, devicePub, sig, D, closeAddr }) {
  const dev = registry.devices.find((d) => d.key.pubHex === devicePub);
  const registered = !!dev && dev.reg.verified && dev.reg.pubHex === registry.registrar.pubHex;
  const allowed = !!dev && dev.svcIds.includes(svc);
  let sigOk = false;
  try { sigOk = PublicKey.fromString(devicePub).verify(message(svc, value, D, closeAddr), Signature.fromDER(sig, 'hex')); } catch { sigOk = false; }
  return { registered, allowed, sigOk, ok: registered && allowed && sigOk, device: dev || null };
}

export const unregisteredDevice = (model = 'Thermometer') => ({ model, serial: 'unregistered', key: keyPair() });
