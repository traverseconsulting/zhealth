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

export const DEVICE_MODELS = [
  { model: 'Thermometer', prefix: 'TH', services: ['temperature'], unit: '°C', read: () => (36.4 + Math.random() * 1.0).toFixed(1) + ' °C' },
  { model: 'Blood pressure monitor', prefix: 'BP', services: ['bp', 'pulse'], read: (slug) => (slug === 'pulse' ? `${62 + Math.floor(Math.random() * 20)} bpm` : `${112 + Math.floor(Math.random() * 16)}/${72 + Math.floor(Math.random() * 10)} mmHg`) },
  { model: 'Pulse oximeter', prefix: 'OX', services: ['spo2', 'pulse'], read: (slug) => (slug === 'pulse' ? `${62 + Math.floor(Math.random() * 20)} bpm` : `${95 + Math.floor(Math.random() * 5)}%`) },
  { model: 'Scale', prefix: 'SC', services: ['weight'], read: () => (55 + Math.random() * 35).toFixed(1) + ' kg' },
  { model: 'Glucometer', prefix: 'GL', services: ['glucose'], read: () => `${80 + Math.floor(Math.random() * 40)} mg/dL` },
];

const keyPair = () => { const k = PrivateKey.fromRandom(); return { privHex: k.toHex(), pubHex: k.toPublicKey().toString(), address: k.toPublicKey().toAddress() }; };

// Build the network: one registrar and one registered unit of each model.
export async function createRegistry() {
  const registrar = keyPair();
  const devices = [];
  for (const m of DEVICE_MODELS) {
    const key = keyPair();
    const serial = `${m.prefix}-${1000 + Math.floor(Math.random() * 9000)}`;
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

export const unregisteredDevice = () => ({ model: 'Thermometer', serial: 'unregistered', key: keyPair() });
