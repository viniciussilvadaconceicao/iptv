import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';
import path from 'path';
import { handleIncomingMessage } from './conversationService.js';
import { setPlan, getCustomer } from './customerService.js';
import { formatDateBR } from '../utils/date.js';
const { Client, LocalAuth, MessageMedia } = wweb;

let client = null;
let ready = false;
let initializing = false;
let lastQRAt = null;
let qrTimer = null;

let __waClient = null;
const __onReadyCallbacks = [];

export function onReady(cb) {
  if (typeof cb === 'function') __onReadyCallbacks.push(cb);
}
function __emitReady() {
  try { __onReadyCallbacks.splice(0).forEach(fn => fn()); } catch {}
}

export function toJid(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, '');
  return d.endsWith('@c.us') ? d : `${d}@c.us`;
}

export async function sendText(phone, message) {
  try {
    if (!__waClient) throw new Error('cliente WA não pronto');
    const jid = toJid(phone);
    if (!jid) throw new Error('telefone inválido');
    return await __waClient.sendMessage(jid, message);
  } catch (e) {
    console.error('[WA] sendText erro:', e?.message || e);
  }
}

/*
  Envia mídia a partir de base64.
  Por padrão envia como documento para evitar recompressão pelo WhatsApp (melhor qualidade).
  Para enviar como imagem (pode sofrer compressão) chame com { sendAsDocument: false }.
*/
export async function sendMediaFromBase64(phoneOrJid, rawBase64, caption = '', { sendAsDocument = true } = {}) {
  try {
    if (!__waClient) throw new Error('cliente WA não pronto');
    if (!rawBase64 || typeof rawBase64 !== 'string') throw new Error('base64 inválido');

    const jid = (String(phoneOrJid || '').includes('@')) ? phoneOrJid : toJid(phoneOrJid);
    if (!jid) throw new Error('destino inválido');

    let mime = 'image/jpeg';
    let b64 = rawBase64.trim();

    const dataUrlMatch = b64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1];
      b64 = dataUrlMatch[2];
    } else if (b64.startsWith('/9j/')) {
      mime = 'image/jpeg';
    } else if (b64.startsWith('iVBOR')) {
      mime = 'image/png';
    } else {
      const cleaned = b64.replace(/\s+/g, '');
      if (/^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length > 200) {
        b64 = cleaned;
      } else {
        throw new Error('conteúdo não parece base64 de imagem');
      }
    }

    const cleanBase64 = b64.replace(/\s+/g, '');
    const media = new MessageMedia(mime, cleanBase64);

    const opts = { caption: caption || '' };
    if (sendAsDocument) opts.sendMediaAsDocument = true;

    return await __waClient.sendMessage(jid, media, opts);
  } catch (err) {
    console.error('[WA] sendMediaFromBase64 erro:', err?.message || err);
    throw err;
  }
}

const ADMIN_PHONE = process.env.ADMIN_PHONE || '';
const ADMIN_JID = ADMIN_PHONE ? toJid(ADMIN_PHONE) : '';

function normalizeAdminPhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  return d;
}

async function handleAdminCommand(msg) {
  const tRaw = String(msg.body || '').trim();
  const t = tRaw.replace(/\s+/g, ' ').trim();

  if (/^\/?(?:aprovar|ativar)\b/i.test(t)) {
    try {
      const monthMatch = t.match(/(\d+)\s*(?:m|mes|m[eê]s|mês|meses)\b/i);
      const explicitMonths = monthMatch ? Number(monthMatch[1]) : null;
      const tNoMonths = monthMatch ? t.replace(monthMatch[0], ' ') : t;
      const phoneMatch = tNoMonths.match(/(\d{8,15})/);
      if (!phoneMatch) {
        await msg.reply('Número de telefone não encontrado no comando. Use: aprovar <telefone> [<N>m]');
        return true;
      }
      let phone = normalizeAdminPhone(phoneMatch[1]);
      if (!phone) {
        await msg.reply('Telefone inválido.');
        return true;
      }

      const c = await getCustomer(phone);
      if (!c) {
        await msg.reply(`Cliente não encontrado: ${phone}`);
        return true;
      }

      const price = c?.plan?.price ?? null;
      let opts;

      if (explicitMonths && explicitMonths > 0) {
        opts = { durationMonths: explicitMonths, durationLabel: `${explicitMonths} ${explicitMonths > 1 ? 'meses' : 'mês'}`, price };
      } else {
        const days = c?.plan?.durationDays || 30;
        const label = c?.plan?.durationLabel || `${days} dias`;
        const labelLower = String(label || '').toLowerCase();

        const labelMonthMatch = labelLower.match(/(\d+)\s*(?:m|mes|m[eê]s|mês|meses)\b/);
        if (labelMonthMatch) {
          const months = Number(labelMonthMatch[1]) || 1;
          opts = { durationMonths: months, durationLabel: label, price };
        } else if (/\b(?:1\s*)?(?:m|mes|m[eê]s|mês|meses)\b/.test(labelLower) && !/\bdia/.test(labelLower)) {
          opts = { durationMonths: 1, durationLabel: label, price };
        } else {
          opts = { durationDays: days, durationLabel: label, price };
        }
      }

      await setPlan(phone, opts);
      const c2 = await getCustomer(phone);
      const venc = c2?.endDate ? `\nVencimento: ${formatDateBR(c2.endDate)}.` : '';
      await sendText(phone, `✅ Pagamento confirmado!\nSeu acesso foi ativado.${venc}\nQualquer dúvida, responda esta mensagem.`);
      await msg.reply(`Aprovado: ${phone}${c2?.endDate ? ` • vence em ${formatDateBR(c2.endDate)}` : ''}`);
    } catch (e) {
      console.error('[WA][ADMIN]/aprovar erro:', e?.message || e);
      await msg.reply('Falha ao aprovar.');
    }
    return true;
  }

  let m = t.match(/^\/?renovar\s+(\d{8,15})\s+(\d{1,3})(?:\s+([\d,.]+))?$/i);
  if (m) {
    try {
      let phone = normalizeAdminPhone(m[1]);
      if (!phone) { await msg.reply('Telefone inválido.'); return true; }
      const days = Number(m[2]);
      const priceArg = m[3] ? Number(String(m[3]).replace(',', '.')) : undefined;

      const c = await getCustomer(phone);
      const label = `${days} dias`;
      const price = (typeof priceArg === 'number') ? priceArg : (c?.plan?.price ?? null);
      await setPlan(phone, { durationDays: days, durationLabel: label, price });
      const c2 = await getCustomer(phone);
      const venc = c2?.endDate ? formatDateBR(c2.endDate) : '-';
      await sendText(phone, [
        '🔁 Renovação confirmada!',
        `Seu acesso foi renovado por ${days} dias.`,
        `Novo vencimento: ${venc}.`
      ].join('\n'));
      await msg.reply(`Renovado: ${phone} • +${days}d • vence em ${venc}`);
    } catch (e) {
      console.error('[WA][ADMIN]/renovar erro:', e?.message || e);
      await msg.reply('Falha ao renovar.');
    }
    return true;
  }

  m = t.match(/^\/?status\s+(\d{8,15})$/i);
  if (m) {
    try {
      let phone = normalizeAdminPhone(m[1]);
      if (!phone) { await msg.reply('Telefone inválido.'); return true; }
      const c = await getCustomer(phone);
      if (!c) { await msg.reply(`Cliente não encontrado: ${phone}`); return true; }
      await msg.reply([
        '📄 Status do cliente',
        `📞 ${phone}`,
        `🖥 Telas: ${c?.plan?.screensCount || '-'}`,
        `🏷 Plano: ${c?.plan?.durationLabel || '-'}`,
        `💲 Valor: ${c?.plan?.price != null ? `R$${c.plan.price}` : '-'}`,
        `📅 Venc: ${c?.endDate ? formatDateBR(c.endDate) : '-'}` 
      ].join('\n'));
    } catch (e) {
      console.error('[WA][ADMIN]/status erro:', e?.message || e);
      await msg.reply('Falha ao consultar status.');
    }
    return true;
  }

  if (/^\/?(?:ajuda|help|\?)$/i.test(t)) {
    await msg.reply('Comandos: aprovar <fone> [<N>m] • renovar <fone> <dias> [preco] • status <fone>');
    return true;
  }

  return false;
}

function scheduleQRWarning() {
  if (qrTimer) clearTimeout(qrTimer);
  qrTimer = setTimeout(() => {
    if (!ready && !lastQRAt) {
      console.log('[WhatsApp] ⚠ Ainda não recebemos um QR.');
    }
  }, 20000);
}

export function initWhatsApp() {
  if (process.env.WA_ENABLE === 'false') {
    console.log('[WhatsApp] Integração desativada por WA_ENABLE=false');
    return;
  }
  if (client || initializing) return;
  initializing = true;

  const sessionPath = process.env.WA_SESSION_PATH || '.wweb-session';
  const headless = (process.env.WA_HEADLESS || 'true') !== 'false';
  const chromePath = process.env.WA_CHROME_PATH;
  const chromeProfileDir = path.resolve(process.cwd(), '.chrome-profile-wa-bot');
  console.log(`[WhatsApp] Inicializando (headless=${headless}) sessão: ${sessionPath}`);
  if (chromePath) console.log(`[WhatsApp] Usando Chrome em: ${chromePath}`);
  console.log(`[WhatsApp] Perfil de Chrome isolado em: ${chromeProfileDir}`);

  try {
    client = new Client({
      takeoverOnConflict: true,
      takeoverTimeoutMs: 60_000,
      authStrategy: new LocalAuth({ dataPath: sessionPath }),
      restartOnAuthFail: true,
      puppeteer: {
        headless,
        executablePath: chromePath || undefined,
        args: [
          `--user-data-dir=${chromeProfileDir}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--ignore-certificate-errors',
          '--ignore-ssl-errors'
        ]
      }
    });
  } catch (e) {
    initializing = false;
    console.error('[WhatsApp] Erro criando client:', e);
    return;
  }

  scheduleQRWarning();

  client.on('loading_screen', (percent, message) => {
    console.log(`[WhatsApp] Carregando ${percent}% - ${message}`);
  });

  client.on('change_state', state => {
    console.log('[WhatsApp] Estado:', state);
  });

  client.on('qr', qr => {
    lastQRAt = new Date();
    console.log('\n[WhatsApp] Escaneie o QR abaixo no seu app (Aparelhos Conectados):');
    qrcode.generate(qr, { small: true });
    console.log('[WhatsApp] Se o QR expirar ele será atualizado automaticamente.');
  });

  client.on('ready', () => {
    ready = true;
    __waClient = client;
    console.log('\n[WhatsApp] ✅ Cliente conectado e pronto para enviar mensagens.');
    __emitReady();
  });

  client.on('auth_failure', msg => {
    console.error('[WhatsApp] ❌ Falha de autenticação:', msg);
    ready = false;
    __waClient = null;
    const _oldClient = client;
    client = null;
    setTimeout(async () => {
      try { await _oldClient.destroy(); } catch {}
      initializing = false;
      console.log('[WhatsApp] Reinicializando após auth_failure...');
      initWhatsApp();
    }, 30000);
  });

  client.on('disconnected', reason => {
    ready = false;
    __waClient = null;
    const _oldClient = client;
    client = null;
    console.log('[WhatsApp] Desconectado:', reason, '— Reinicializando em 20s...');
    setTimeout(async () => {
      try { await _oldClient.destroy(); } catch {}
      initializing = false;
      initWhatsApp();
    }, 20000);
  });

  client.on('message', async msg => {
    try {
      const from = msg.from || msg.author || msg.id?.remote || msg.key?.remoteJid;
      if (!from) return;
      if (from.endsWith('@g.us') || from.endsWith('@broadcast') || from.includes('@status')) return;
      if (msg.fromMe) return;

      if (ADMIN_JID && from === ADMIN_JID) {
        const handled = await handleAdminCommand(msg);
        if (handled) return;
      }

      const body =
        msg.body ||
        msg._data?.body ||
        '';

      if (!String(body).trim()) return;

      const reply = await handleIncomingMessage(from, body);
      if (reply) {
        await msg.reply(reply);
      }
    } catch (e) {
      console.error('[WhatsApp][ERR] Erro no handler de mensagem:', e?.message || e);
    }
  });

  try {
    client.initialize();
  } catch (e) {
    initializing = false;
    console.error('[WhatsApp] Erro ao inicializar:', e);
  }
}

export function isWhatsAppReady() { return ready; }
export function getClient() { return client; }
export function hasQR() { return !!lastQRAt; }