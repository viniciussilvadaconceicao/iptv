import { STORE_PHONE, ADMIN_PHONE } from '../config/contacts.js';
import { isWhatsAppReady, getClient } from './waClient.js';

// ===== Config de rate limit via .env =====
const MIN_DELAY = parseInt(process.env.WA_MIN_DELAY_MS || '8000', 10);  // 8s
const MAX_DELAY = parseInt(process.env.WA_MAX_DELAY_MS || '15000', 10); // 15s

// ===== Utilidades =====
function formatTarget(t){
  if(t === STORE_PHONE) return `${t} (LOJA)`;
  if(t === ADMIN_PHONE) return `${t} (ADMIN)`;
  return t;
}
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function rand(min, max){
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : lo;
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

// ===== Fila com concorrência 1 =====
const q = [];
let running = false;

async function processQueue(){
  if (running) return;
  running = true;
  try {
    while(q.length){
      const job = q.shift();
      try {
        await job.fn();
      } catch (e) {
        console.error('[Notify][Queue] Falha ao enviar para', job.to, e?.message || e);
      }
      await sleep(rand(MIN_DELAY, MAX_DELAY));
    }
  } finally {
    running = false;
  }
}
function enqueue(fn, to){
  q.push({ fn, to });
  // disparo não bloqueante
  processQueue();
}

// ===== Envio imediato (compat) =====
export function sendMessage(to, message){
  try {
    const normalized = String(to || '').replace(/\D/g,'');
    if(!normalized){
      console.error('[WhatsApp] Número destino inválido:', to);
      return;
    }
    const jid = normalized + '@c.us';
    if(isWhatsAppReady() && getClient()){
      getClient().sendMessage(jid, message).catch(err=>{
        console.error('[WhatsApp] Erro ao enviar mensagem para', jid, err?.message || err);
        console.log(`\n[FALLBACK LOG -> ${formatTarget(to)}] ${message}`);
      });
    } else {
      console.log(`\n[PENDENTE WA -> ${formatTarget(to)}] ${message}`);
    }
  } catch (e) {
    console.error('[WhatsApp] Erro inesperado em sendMessage:', e?.message || e);
  }
}

// ===== Envio em massa (compat) =====
export function broadcast(toList, message){
  [...new Set(toList)].forEach(t=> sendMessage(t, message));
}

// ===== Versões com fila/atraso =====
export function sendMessageQueued(to, message){
  enqueue(() => Promise.resolve(sendMessage(to, message)), to);
}

export function broadcastQueued(toList, message){
  [...new Set(toList)].forEach(t => enqueue(() => Promise.resolve(sendMessage(t, message)), t));
}

export { STORE_PHONE, ADMIN_PHONE };