import { createCustomer, setPlan, addScreens, getCustomer } from './customerService.js';
import { getPaymentStatus, markPaid, renewPlan } from './paymentService.js';
import { daysRemaining, formatDateBR } from '../utils/date.js';

const ADMIN_PHONE = process.env.ADMIN_PHONE || null; // admin (somente números) via env

// Sessões, handoffs e aprovações pendentes
const sessions = new Map();
const adminHandoffs = new Map();
const pendingApprovals = new Map();

const ICONS = {
    WELCOME: '🎬', NEW: '👤', TIME: '⏳', SUPPORT: '🛠', PAY: '💳', EXIT: '🚪', PLAN: '📦',
    SCREEN: '🖥', TV: '📺', PIX: '🔐', OK: '✅', ALERT: '⚠', FIRE: '🔥', CHECK: '✅',
    LIGHT: '⚡', MONEY: '💲', ARROW: '➡️', CAL: '📅', PIN: '📌'
};

const NUMBER_EMOJI = { '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣', '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣' };
const DEVICE_ICONS = { 'TV Smart': '📺', 'Celular Android': '📱', 'Tablet Android': '📱', 'PC': '💻' };
const SEP = '━━━━━━━━━━━━━━';
const DEVICE_TYPE_OPTIONS = {
    '1': 'TV Smart',
    '2': 'TV Box',
    '3': 'Fire TV Stick',
    '4': 'Chromecast',
    '5': 'Celular Android',
    '6': 'Tablet Android',
    '7': 'PC'
};
const TV_BRAND_OPTIONS = {
    '1': 'Samsung',
    '2': 'LG',
    '3': 'Roku',
    '4': 'Philco',
    '5': 'Hisense',
    '6': 'TCL',
    '7': 'AOC',
    '8': 'Android TV / Google TV',
    '9': null
};
const TV_VIDEO_URLS = {
    samsung: process.env.TV_VIDEO_URL_SAMSUNG || '',
    lg: process.env.TV_VIDEO_URL_LG || '',
    roku: process.env.TV_VIDEO_URL_ROKU || '',
    philco: process.env.TV_VIDEO_URL_PHILCO || '',
    hisense: process.env.TV_VIDEO_URL_HISENSE || '',
    tcl: process.env.TV_VIDEO_URL_TCL || '',
    aoc: process.env.TV_VIDEO_URL_AOC || '',
    android: process.env.TV_VIDEO_URL_ANDROID || '',
    generic: process.env.TV_VIDEO_URL_GENERIC || ''
};

// Mensagem padrão de espera enquanto aguarda atendente
const WAITING_MSG = [
    '🕒 *Logo você será atendido.*',
    '✅ *Tempo médio de atendimento: 1 a 3 min.*'
].join('\n');

function getSession(phone) {
    const key = toPhoneKey(phone);
    if (!sessions.has(key)) sessions.set(key, { step: 'menu', temp: {} });
    return sessions.get(key);
}

function reset(phone) {
    const key = toPhoneKey(phone);
    const prev = sessions.get(key);
    if (prev?.temp?.menuTimer) clearTimeout(prev.temp.menuTimer);
    sessions.set(key, { step: 'menu', temp: {} });
}

function scheduleMenuTimeout(phone) {
    const key = toPhoneKey(phone);
    const s = getSession(key);
    if (s.temp.menuTimer) clearTimeout(s.temp.menuTimer);
    // Não agenda timeout se estiver em handoff
    if (s?.temp?.handoffActive) return;
    s.temp.menuTimer = setTimeout(async () => {
        try {
            reset(key);
            const { getClient } = await import('./waClient.js');
            const cli = getClient();
            if (cli) {
                const jid = key.endsWith('@c.us') ? key : key + '@c.us';
                await cli.sendMessage(jid, `${ICONS.ALERT} *ATENÇÃO!*\nNenhuma opção foi escolhida em 5 minutos. O atendimento foi encerrado automaticamente.\nEnvie qualquer mensagem para reabrir o atendimento.`);
            }
        } catch (e) {
            console.error('[SessionTimeout] falha ao encerrar sessão:', e?.message || e);
        }
    }, 5 * 60 * 1000);
}

/* Montagem de mensagens / menus */
function buildMarketing() {
    return [
        `${ICONS.FIRE} *Bem-vindo Ao ViniOnTV!*`,
        `${ICONS.CHECK} +1000 canais *HD / 4K*`,
        `${ICONS.CHECK} *SporTV, ESPN, UFC e Premiere*`,
        `${ICONS.CHECK} *Filmes,Series e lançamentos*`,
        `${ICONS.CHECK} Funciona em *TV, Celular e TV Box*`,
        `${ICONS.CHECK} *Teste grátis antes de assinar*`,
        `${ICONS.CHECK} *Suporte rápido pelo WhatsApp*`,
        ``,
        `Digite o número da opção 👇`
    ].join('\n');
}

function buildMainMenu() {
    const lines = [
        `${NUMBER_EMOJI['1']} 🚀liberar TESTE GRÁTIS `,
        `${NUMBER_EMOJI['2']} 💳 Assinar agora  `,
        `${NUMBER_EMOJI['3']} ⏳ Ver tempo da minha assinatura`,
        `${NUMBER_EMOJI['4']} 🔧 Suporte técnico`,
        `${NUMBER_EMOJI['5']} 💰 Pagamento / Renovação `,
        `${NUMBER_EMOJI['6']} 👨‍💻 Falar com atendente `,
        `${NUMBER_EMOJI['0']} ❌ Encerrar atendimento`
    ];

    const attention = [
        '',
        `⚠️*ATENÇÃO!*`,
        `Responda com o *número da opção acima* para continuar 👆.`,
        ''
    ].join('\n');

    return `${buildMarketing()}\n\n${SEP}\n*MENU PRINCIPAL*\n${lines.join('\n')}\n${SEP}\n${attention}`;
}

export async function sendMainMenuWithButtons(jid) {
    const { getClient } = await import('./waClient.js');
    const client = getClient();
    if (!client) return;

    await client.sendMessage(jid, buildMainMenu());
}


function planosFormat(telas) {
    if (telas === '1') {
        return [
            SEP,
            `${ICONS.PLAN} *Planos 1 Tela*`,
            `${NUMBER_EMOJI['1']} *1 mês*  – *R$30*`,
            `${NUMBER_EMOJI['2']} *3 meses* – *R$90*`,
            `${NUMBER_EMOJI['3']} *6 meses* – *R$170*`,
            `${NUMBER_EMOJI['4']} *12 meses* – *R$300*`,
            SEP
        ].join('\n');
    }
    return [
        SEP,
        `${ICONS.PLAN} *Planos 2 Telas*`,
        `${NUMBER_EMOJI['1']} *1 mês*  – *R$50*`,
        `${NUMBER_EMOJI['2']} *3 meses* – *R$150*`,
        `${NUMBER_EMOJI['3']} *12 meses* – *R$550*`,
        SEP
    ].join('\n');
}

/* Normalização / utilitários */
const DIGIT_REGEX = /[0-9]/;
function normChoice(raw) {
    if (!raw) return raw;
    const m = raw.match(DIGIT_REGEX);
    return m ? m[0] : raw.trim();
}

function isChoiceStep(step) {
    return [
        'cadastro_telas',
        'cadastro_plano',
        'cadastro_dispositivo1_tipo',
        'cadastro_dispositivo1_marca',
        'cadastro_dispositivo2_tipo',
        'cadastro_dispositivo2_marca',
        'cadastro_confirm'
    ].includes(step);
}

function buildTVAppInstructions(brand) {
    const linhas = [SEP, '📥 Instalar aplicativo na TV', SEP];
    const b = (brand || '').toLowerCase();
    let videoKey = 'generic';
    if (b.includes('samsung')) {
        videoKey = 'samsung';
        linhas.push(
            '1) Abra a 📺*Samsung Apps* (loja da TV).',
            '2) Busque: *smartone IPTV*.',
            '3) Após a instalação, grave o codigo do *MAC*.'
        );
    } else if (b.includes('lg')) {
        videoKey = 'lg';
        linhas.push(
            '1) Abra a 📺*LG Content Store*.',
            '2) Busque: *smartone IPTV*.',
            '3) Após a instalação, grave o codigo do *MAC*.'
        );
    } else if (b.includes('roku')) {
        videoKey = 'roku';
        linhas.push(
            '1) Abra a 📺*loja de canais Roku*.',
            '2) Busque: *NinjaIPTV*.',
            '3) Após a instalação, grave o codigo do *MAC*.'
        );
    } else if (b.includes('philco')) {
        videoKey = 'philco';
        linhas.push(
            '1) Abra a 📺*Philco Store*.',
            '2) Busque: *NinjaIPTV*.',
            '3) Após a instalação, grave o codigo do *MAC*.'
        );
    } else if (b.includes('hisense') || b.includes('tcl') || b.includes('aoc') || b.includes('android tv') || b.includes('google tv')) {
        if (b.includes('hisense')) videoKey = 'hisense';
        else if (b.includes('tcl')) videoKey = 'tcl';
        else if (b.includes('aoc')) videoKey = 'aoc';
        else videoKey = 'android';
        linhas.push(
            '1) Abra a 📺*loja de apps da TV* (*Google Play Store* ou equivalente).',
            '2) Busque: *downloader*.',
            '3) Após a instalação, dentro do aplicativo digite o codigo 8418803.',
            '4) Com isso ira instalar automaticamente o UNITV.',
        );
    } else {
        videoKey = 'generic';
        linhas.push(
            '1) Abra a 📺*loja de apps da TV* (*Google Play Store* ou equivalente).',
            '2) Busque: *downloader*.',
            '3) Após a instalação, dentro do aplicativo digite o codigo 8418803.',
            '4) Com isso ira instalar automaticamente o UNITV.',
        );
    }
    const videoUrl = TV_VIDEO_URLS[videoKey] || TV_VIDEO_URLS.generic;
    if (videoUrl) {
        linhas.push('', `🎥 Vídeo explicativo: ${videoUrl}`);
    }
    linhas.push('', 'Envie OK para continuar.');
    return linhas.join('\n');
}

function buildOtherDeviceInstructions() {
    return [
        SEP,
        '📥 Instalar aplicativo no dispositivo',
        SEP,
        '1) Abra a app Store.',
        '2) Busque: *downloader*.',
        '3) Após a instalação, insira o codigo 8418803.',
        '4) Com isso ira instalar automaticamente o UNITV.',
        'Envie OK para continuar.'
    ].join('\n');
}

function buildDeviceTypeMenu(slot) {
    return [
        SEP,
        `${ICONS.SCREEN} *Dispositivo ${slot} - Tipo*`,
        `${NUMBER_EMOJI['1']} TV Smart 📺`,
        `${NUMBER_EMOJI['2']} TV Box 📦`,
        `${NUMBER_EMOJI['3']} Fire TV Stick 🔥`,
        `${NUMBER_EMOJI['4']} Chromecast 📡`,
        `${NUMBER_EMOJI['5']} Celular Android 📱`,
        `${NUMBER_EMOJI['6']} Tablet Android 📱`,
        `${NUMBER_EMOJI['7']} PC 💻`,
        SEP,
        'Digite o número referente ao assunto que você quer tratar:'
    ].join('\n');
}

function buildTVBrandMenu(slot) {
    return [
        SEP,
        `${ICONS.TV} *Marca / Sistema da TV (${slot}ª)*`,
        `${NUMBER_EMOJI['1']} Samsung`,
        `${NUMBER_EMOJI['2']} LG`,
        `${NUMBER_EMOJI['3']} Roku`,
        `${NUMBER_EMOJI['4']} Philco`,
        `${NUMBER_EMOJI['5']} Hisense`,
        `${NUMBER_EMOJI['6']} TCL`,
        `${NUMBER_EMOJI['7']} AOC`,
        `${NUMBER_EMOJI['8']} Android TV / Google TV`,
        `${NUMBER_EMOJI['9']} Outra`,
        SEP,
        '*Digite: 1, 2, 3, 4, 5, 6, 7, 8 ou 9:*'
    ].join('\n');
}

function isAdminPhone(p) { return ADMIN_PHONE && toPhoneKey(p) === toPhoneKey(ADMIN_PHONE); }
function normalizePhone(p) { return String(p || '').replace(/\D/g, ''); }
function toPhoneKey(p) {
    const n = normalizePhone(p);
    if (!n) return '';
    if (n.startsWith('55')) return n;
    if (n.length === 10 || n.length === 11) return '55' + n;
    return n;
}

function planPriceFor(plan) {
    if (!plan) return null;
    if (plan.price != null) return plan.price;
    const label = String(plan.durationLabel || '').toLowerCase();
    const planType = String(plan.planType || '').toLowerCase();
    const screens = Number(plan.screensCount || (planType.includes('2') ? 2 : 1));
    const is2 = screens >= 2 || planType.includes('2');

    if (label.includes('1 mês') || label.includes('1 mes')) return is2 ? 50 : 30;
    if (label.includes('3 meses')) return is2 ? 150 : 90;
    if (label.includes('6 meses')) return 170;
    if (label.includes('12 meses') || label.includes('1 ano')) return is2 ? 550 : 300;
    return null;
}

async function findCustomerByAny(qKey) {
    let c = null;
    let used = qKey;
    const tryKeys = [];
    if (qKey) tryKeys.push(qKey);
    const n = normalizePhone(qKey);
    if (n && n.startsWith('55')) tryKeys.push(n.slice(2));
    if (n && !n.startsWith('55') && (n.length === 10 || n.length === 11)) tryKeys.push('55' + n);

    for (const k of tryKeys) {
        try {
            c = await getCustomer(k);
            if (c) { used = toPhoneKey(c.phone || k); break; }
        } catch { }
    }
    return { customer: c, usedKey: used };
}

function isLikelyBase64Image(s) {
    if (!s || typeof s !== 'string') return false;
    const trimmed = s.trim();
    if (trimmed.startsWith('data:image/')) return true;
    if (trimmed.startsWith('/9j/')) return true;
    if (trimmed.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(trimmed)) return true;
    return false;
}

/* Handoff / notificação admin */
async function openHandoff(clientPhoneKey, opts = {}) {
    const { notifyClient = true } = opts;
    if (!ADMIN_PHONE) return;
    const clientKey = toPhoneKey(clientPhoneKey);
    const adminKey = toPhoneKey(ADMIN_PHONE);
    adminHandoffs.set(adminKey, clientKey);

    try {
        const clientSession = getSession(clientKey);
        if (clientSession?.temp) {
            clientSession.temp.handoffFromAdmin = adminKey;
            clientSession.temp.handoffActive = true;
            clientSession.temp.handoffAssumed = false; // ainda não assumido
            clientSession.step = 'handoff_client';
            if (clientSession.temp.menuTimer) {
                clearTimeout(clientSession.temp.menuTimer);
                clientSession.temp.menuTimer = null;
            }
        }
    } catch (err) {
        console.error('[Handoff] falha marcar sessão do cliente:', err?.message || err);
    }

    try {
        const { getClient } = await import('./waClient.js');
        const cli = getClient();
        if (cli) {
            const adminJid = adminKey.endsWith('@c.us') ? adminKey : adminKey + '@c.us';
            const clientJid = clientKey.endsWith('@c.us') ? clientKey : clientKey + '@c.us';
            const adminMsg = [
                `🟢 *Solicitação de atendimento*\n`,
                `*DICAS DE ATENDIMENTO:*\n`,
                `*Número do cliente*: ${clientKey} \n`,
                `Use "assumir ${clientKey}" \n para assumir formalmente \n e no final do atendimento \n envie *fim* ou *encerrar* \n para encerrar o atendimento.`
            ].join('\n');
            const clientMsg = [
                `🟢 *Solicitando atendimento* \n`,
                `Um *atendente* foi solicitado`,
                ` e em breve irá atendê-lo.`,
                '',
                WAITING_MSG
            ].join('\n');
            await cli.sendMessage(adminJid, adminMsg);
            if (notifyClient) {
                await cli.sendMessage(clientJid, clientMsg);
            }
        }
    } catch (err) {
        console.error('[Handoff] falha notificar admin/cliente:', err?.message || err);
    }
}

async function closeHandoffByAdminKey(adminKey) {
    const adminK = toPhoneKey(adminKey);
    const clientKey = adminHandoffs.get(adminK);
    adminHandoffs.delete(adminK);
    if (!clientKey) return;

    const clientSession = getSession(clientKey);
    if (clientSession?.temp) {
        delete clientSession.temp.handoffFromAdmin;
        delete clientSession.temp.handoffActive;
        delete clientSession.temp.handoffAssumed;
    }

    try {
        reset(clientKey);
        const { getClient } = await import('./waClient.js');
        const cli = getClient();
        if (cli) {
            const adminJid = adminK.endsWith('@c.us') ? adminK : adminK + '@c.us';
            const clientJid = clientKey.endsWith('@c.us') ? clientKey : clientKey + '@c.us';
            await cli.sendMessage(adminJid, `🔴 Conexão encerrada com ${clientKey}`);
            await cli.sendMessage(clientJid, `🔴 O atendimento foi encerrado.\n Obrigado por usar nosso serviço!`);
            scheduleMenuTimeout(clientKey);
        }
    } catch (err) {
        console.error('[Handoff] falha encerrar e reiniciar bot para cliente:', err?.message || err);
    }
}

/* Aprovação para números não cadastrados */
async function requestApprovalForUnknown(clientPhoneKey) {
    if (!ADMIN_PHONE) return;
    const key = toPhoneKey(clientPhoneKey);
    pendingApprovals.set(key, { phone: key, ts: Date.now() });
    try {
        const { getClient } = await import('./waClient.js');
        const cli = getClient();
        if (!cli) return;
        const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
        const msg = [
            '🟡 *Solicitação de atendimento (não cadastrado)*',
            `Telefone: ${key}`,
            'O cliente não possui cadastro. Para iniciar atendimento use:',
            `- aceitar ${key}  (aceitar atendimento)`,
            `- recusar ${key}   (recusar atendimento)`,
            '',
            'Ou use "assumir <telefone>" para assumir diretamente.'
        ].join('\n');
        await cli.sendMessage(jid, msg);
    } catch (err) {
        console.error('[Approval] falha notificar admin:', err?.message || err);
    }
}

async function adminAccept(clientPhoneKey, adminKey) {
    const key = toPhoneKey(clientPhoneKey);
    const adm = toPhoneKey(adminKey);
    pendingApprovals.delete(key);
    adminHandoffs.set(adm, key);
    const clientSession = getSession(key);
    if (clientSession?.temp) {
        clientSession.temp.handoffFromAdmin = adm;
        clientSession.temp.handoffActive = true;
        clientSession.temp.handoffAssumed = true; // assumido formalmente
        clientSession.step = 'handoff_client';
        if (clientSession.temp.menuTimer) {
            clearTimeout(clientSession.temp.menuTimer);
            clientSession.temp.menuTimer = null;
        }
    }
    try {
        const { getClient } = await import('./waClient.js');
        const cli = getClient();
        if (!cli) return;
        const adminJid = adm.endsWith('@c.us') ? adm : adm + '@c.us';
        const clientJid = key.endsWith('@c.us') ? key : key + '@c.us';
        await cli.sendMessage(adminJid, `✅ Você aceitou e assumiu atendimento com ${key}`);
        await cli.sendMessage(clientJid, `🟢 Um atendente assumiu seu atendimento.`);
    } catch (err) {
        console.error('[Approval] falha notificar admin/client após aceitar:', err?.message || err);
    }
}

async function adminDecline(clientPhoneKey, adminKey) {
    const key = toPhoneKey(clientPhoneKey);
    pendingApprovals.delete(key);
    try {
        const { getClient } = await import('./waClient.js');
        const cli = getClient();
        if (!cli) return;
        const adminJid = toPhoneKey(adminKey).endsWith('@c.us') ? toPhoneKey(adminKey) : toPhoneKey(adminKey) + '@c.us';
        const clientJid = key.endsWith('@c.us') ? key : key + '@c.us';
        await cli.sendMessage(adminJid, `❌ Você recusou iniciar atendimento com ${key}`);
        await cli.sendMessage(clientJid, `🔴 Sua solicitação de atendimento foi recusada. Digite *menu* para opções.`);
        reset(key);
        getSession(key).temp._welcomed = true;
        scheduleMenuTimeout(key);
    } catch (err) {
        console.error('[Approval] falha notificar admin/client após recusar:', err?.message || err);
    }
}

/* Entrada principal de mensagens */
export async function handleIncomingMessage(fromRaw, body) {
    const phone = String(fromRaw || '').replace(/@c\.us$/, '');
    const phoneKey = toPhoneKey(phone);
    const raw = (body || '').trim();
    const session = getSession(phoneKey);

    if (session?.temp?.menuTimer) {
        clearTimeout(session.temp.menuTimer);
        session.temp.menuTimer = null;
    }

    // Se em handoff: repassa ao admin. Só envia WAITING_MSG se ainda NÃO foi assumido.
    if (!isAdminPhone(phoneKey) && session?.temp?.handoffActive && session?.temp?.handoffFromAdmin) {
        try {
            const adminKey = session.temp.handoffFromAdmin;
            const { getClient } = await import('./waClient.js');
            const cli = getClient();
            if (cli && adminKey) {
                const adminJid = adminKey.endsWith('@c.us') ? adminKey : adminKey + '@c.us';
                const prefix = `👤 *Cliente ${phoneKey}:*`;
                if (isLikelyBase64Image(raw)) {
                    try {
                        const { sendMediaFromBase64 } = await import('./waClient.js');
                        await sendMediaFromBase64(adminJid, raw, prefix);
                    } catch (err) {
                        try { await cli.sendMessage(adminJid, `${prefix}\n${raw}`); } catch {}
                        console.error('[Handoff] falha enviar imagem para admin via helper:', err?.message || err);
                    }
                } else {
                    await cli.sendMessage(adminJid, `${prefix}\n${raw}`);
                }
            }
            session.step = 'handoff_client';
        } catch (err) {
            console.error('[Handoff] falha repassar cliente->admin:', err?.message || err);
        }
        // Pausa total após assumir: não responder ao cliente
        if (session?.temp?.handoffAssumed) return '';
        return WAITING_MSG;
    }

    const text = isChoiceStep(session.step) ? normChoice(raw) : raw;

    // Admin: encaminhar livremente quando em handoff, ou processar comandos admin
    if (isAdminPhone(phoneKey)) {
        const adminKey = phoneKey;
        const parts = raw.split(/\s+/).filter(Boolean);
        const cmd = (parts[0] || '').toLowerCase();
        const adminCommands = ['ajuda', 'help', '?', 'admin', 'aprovar', 'pago', 'status', 'renovar', 'assumir', 'aceitar', 'recusar'];
        const inHandoff = adminHandoffs.has(adminKey);

        if (inHandoff && !adminCommands.includes(cmd)) {
            const endRegex = /\b(?:fim|encerrar|sair|end|0)\b/i;
            if (endRegex.test(raw)) {
                await closeHandoffByAdminKey(adminKey);
                return 'Conexão encerrada.';
            }
            const clientKey = adminHandoffs.get(adminKey);
            try {
                const { getClient } = await import('./waClient.js');
                const cli = getClient();
                if (cli && clientKey) {
                    const clientJid = clientKey.endsWith('@c.us') ? clientKey : clientKey + '@c.us';
                    const prefix = `👤 *Atendente:*`;
                    if (isLikelyBase64Image(raw)) {
                        try {
                            const { sendMediaFromBase64 } = await import('./waClient.js');
                            await sendMediaFromBase64(clientJid, raw, prefix);
                        } catch (err) {
                            try { await cli.sendMessage(clientJid, `${prefix}\n${raw}`); } catch {}
                            console.error('[Handoff] falha enviar imagem admin->cliente via helper:', err?.message || err);
                        }
                    } else {
                        await cli.sendMessage(clientJid, `${prefix}\n${raw}`);
                    }
                }
            } catch (err) {
                console.error('[Handoff] falha repassar admin->cliente:', err?.message || err);
            }
            return 'Mensagem enviada ao cliente.';
        }
    }

    // Comandos admin gerais
    if (isAdminPhone(phoneKey)) {
        const parts = raw.split(/\s+/).filter(Boolean);
        const cmd = (parts[0] || '').toLowerCase();

        if (['ajuda', 'help', '?', 'admin'].includes(cmd)) {
            return 'Comandos admin:\n- aprovar <telefone>\n- status <telefone>\n- renovar <telefone> <dias> [preco]\n- assumir <telefone>\n- aceitar <telefone>\n- recusar <telefone>';
        }

        if (cmd === 'assumir') {
            const tel = toPhoneKey(parts[1] || '');
            if (!tel) return 'Use: assumir <telefone>';
            const adminKey = toPhoneKey(phoneKey);
            adminHandoffs.set(adminKey, tel);
            const clientSession = getSession(tel);
            clientSession.temp.handoffFromAdmin = adminKey;
            clientSession.temp.handoffActive = true;
            clientSession.temp.handoffAssumed = true; // pausa total
            clientSession.step = 'handoff_client';
            if (clientSession.temp.menuTimer) {
                clearTimeout(clientSession.temp.menuTimer);
                clientSession.temp.menuTimer = null;
            }
            // Notifica o cliente que o atendimento foi assumido e que o bot está pausado
            try {
                const { getClient } = await import('./waClient.js');
                const cli = getClient();
                if (cli) {
                    const clientJid = tel.endsWith('@c.us') ? tel : tel + '@c.us';
                    await cli.sendMessage(clientJid, '🟢 Um atendente assumiu seu atendimento.');
                }
            } catch (err) {
                console.error('[Assumir] falha notificar cliente:', err?.message || err);
            }
            return `✅ Você assumiu a conversa com ${tel}`;
        }

        if (cmd === 'aceitar') {
            const tel = toPhoneKey(parts[1] || '');
            if (!tel) return 'Use: aceitar <telefone>';
            await adminAccept(tel, toPhoneKey(phoneKey));
            return `✅ Atendimento iniciado com ${tel}`;
        }

        if (cmd === 'recusar') {
            const tel = toPhoneKey(parts[1] || '');
            if (!tel) return 'Use: recusar <telefone>';
            await adminDecline(tel, toPhoneKey(phoneKey));
            return `❌ Atendimento recusado para ${tel}`;
        }

        const tel = toPhoneKey(parts[1] || '');

        if (cmd === 'aprovar' || cmd === 'pago') {
            if (!tel) return 'Use: aprovar <telefone>';
            try {
                await markPaid(tel);
                return `✅ Aprovado: ${tel}`;
            } catch (e) {
                return `❌ Falha ao aprovar: ${e?.message || e}`;
            }
        }

        if (cmd === 'status') {
            if (!tel) return 'Use: status <telefone>';
            try {
                const { total, status, diasRestantes } = await getPaymentStatus(tel);
                return `📊 ${tel}\nValor: R$${total}\nStatus: ${status}\nDias: ${diasRestantes}`;
            } catch (e) {
                return `❌ Falha status: ${e?.message || e}`;
            }
        }

        if (cmd === 'renovar') {
            const dias = parseInt(parts[2] || '', 10);
            const preco = parts[3] != null ? Number(parts[3]) : undefined;
            if (!tel || !dias) return 'Use: renovar <telefone> <dias> [preco]';
            try {
                await renewPlan(tel, { durationDays: dias, price: preco });
                return `🔁 Renovado ${tel} por ${dias} dia(s)${preco != null ? ` (R$${preco})` : ''}.`;
            } catch (e) {
                return `❌ Falha renovar: ${e?.message || e}`;
            }
        }
    }

    // Cancelar
    if (['cancel', 'sair', '0', 'encerrar'].includes((text || '').toLowerCase())) {
        reset(phoneKey);
        const s2 = getSession(phoneKey);
        s2.temp._welcomed = true;
        scheduleMenuTimeout(phoneKey);
        return `${ICONS.EXIT} Conversa encerrada. Envie qualquer mensagem para reabrir.`;
    }

    // Saudação / menu inicial
    if (session.step === 'menu' && !session.temp._welcomed) {
        session.temp._welcomed = true;
        scheduleMenuTimeout(phoneKey);
        const jid = phoneKey.endsWith('@c.us') ? phoneKey : phoneKey + '@c.us';
        await sendMainMenuWithButtons(jid);
        return; // Não retorna texto, pois já enviou os botões
    }

    if (['menu', 'help', '?'].includes((text || '').toLowerCase())) {
        reset(phoneKey);
        const s2 = getSession(phoneKey); s2.temp._welcomed = true;
        scheduleMenuTimeout(phoneKey);
        return `📌 Reiniciado.\n\n${buildMainMenu()}\n\nEnvie *1, 2, 3, 4, 5 ou 6*:`;
    }

    if (session.step === 'menu') {
        if (!session.temp._welcomed) {
            session.temp._welcomed = true;
            scheduleMenuTimeout(phoneKey);
            return `${buildMainMenu()}\n\nDigite o *número* referente ao *assunto*\nque você quer tratar: `;
        }

        switch (text) {
            case '1': {
                // Fluxo simples: registra pedido de teste e avisa o admin
                const { customer: c, usedKey } = await findCustomerByAny(phoneKey);
                const keyForContact = toPhoneKey(c?.phone || usedKey || phoneKey);

                if (ADMIN_PHONE) {
                    const nomeCli = c ? `${c.firstName} ${c.lastName}` : 'Não cadastrado';
                    const adminMsg = [
                        '📣 *TESTE GRATUITO SOLICITADO*',
                        `📞 Telefone: ${keyForContact}`,
                        `👤 Cliente: ${nomeCli}`,
                        '🧪 Pedido: Desbloquear teste (até 3 dias)',
                        `🕒 ${new Date().toLocaleString('pt-BR')}`,
                        '',
                        'Use "assumir <telefone>" para falar com o cliente e liberar o teste.'
                    ].join('\n');
                    (async () => {
                        try {
                            const { getClient } = await import('./waClient.js');
                            const cli = getClient();
                            if (cli) {
                                const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
                                await cli.sendMessage(jid, adminMsg);
                            }
                        } catch (err) {
                            console.error('[NotifyAdmin] Falha teste gratuito (menu 1):', err?.message || err);
                        }
                    })();
                    await openHandoff(keyForContact, { notifyClient: false });
                }

                // Mensagem para o usuário
                return `${ICONS.PLAN} *Teste gratuito solicitado* 🚀\nSeu pedido foi recebido com sucesso..\n\n⏳ Em breve um atendente irá liberar seu acesso para teste.`;
            }
            case '2': {
                const { customer: existing } = await findCustomerByAny(phoneKey);
                if (existing) {
                    reset(phoneKey);
                    getSession(phoneKey).temp._welcomed = true;
                    scheduleMenuTimeout(phoneKey);
                    return `${ICONS.NEW} *Cadastro*\nJá existe um cadastro para este número:\n*${existing.firstName} ${existing.lastName}*\nPlano: *${existing.plan?.durationLabel || '-'}*\nVencimento: *${existing.endDate ? formatDateBR(existing.endDate) : '-'}*\n\nSe deseja aumentar o plano ou cadastrar outro número use *menu* e escolha a opção 6 para falar com um atendente.`;
                }
                session.step = 'cadastro_nome_completo';
                session.temp = { phone: phoneKey, _welcomed: true };
                return `${ICONS.NEW} *Cadastro*\nEnvie pra min seu *Nome e Sobrenome* em uma única linha:`;
            }
            case '3': {
                const { customer: c } = await findCustomerByAny(phoneKey);
                if (c && c.endDate) {
                    const rem = daysRemaining(c.endDate);
                    reset(phoneKey); getSession(phoneKey).temp._welcomed = true;
                    scheduleMenuTimeout(phoneKey);
                    return `${ICONS.TIME} *Status da Assinatura*\nCliente: *${c.firstName} ${c.lastName}*\nPlano: *${c.plan.durationLabel}*\n${ICONS.CAL} Vencimento: *${formatDateBR(c.endDate)}*\nDias restantes: *${rem}*\n\nDigite *menu* para voltar.`;
                }
                session.step = 'tempo_phone';
                return `${ICONS.TIME} *Tempo de Assinatura*\nInforme o *telefone* (somente números) ou digite *menu* para usar seu WhatsApp:`;
            }
            case '4': {
                const { customer: c } = await findCustomerByAny(phoneKey);
                if (c) {
                    const msgUser = `${ICONS.SUPPORT} *Solicitação registrada*\nCliente: *${c.firstName} ${c.lastName}*\nPlano: *${c.plan?.durationLabel || '-'}*\n${ICONS.CAL} Vencimento: *${c.endDate ? formatDateBR(c.endDate) : '-'}*\n\n${WAITING_MSG}`;

                    if (ADMIN_PHONE) {
                        const keyForPayment = toPhoneKey(c.phone || phoneKey);
                        let status = '-';
                        let total = null;
                        try {
                            const st = await getPaymentStatus(keyForPayment);
                            status = st?.status ?? '-';
                            total = st?.total ?? null;
                        } catch { }
                        const valorPlano = planPriceFor(c.plan) ?? total ?? '-';
                        const adminMsg = [
                            '📣 *SUPORTE SOLICITADO*',
                            `📞 Telefone: ${keyForPayment}`,
                            `👤 Cliente: ${c.firstName} ${c.lastName}`,
                            `📦 Plano: ${c.plan?.durationLabel || '-'}`,
                            `💰 Valor Plano: ${valorPlano !== '-' ? `R$${valorPlano}` : '-'}`,
                            `📊 Status atual: ${status}`,
                            `${ICONS.CAL} Vencimento: ${c.endDate ? formatDateBR(c.endDate) : '-'}`,
                            `🕒 ${new Date().toLocaleString('pt-BR')}`,
                            '',
                            'A solicitação foi registrada. Você pode usar o comando admin "assumir <telefone>" para assumir a conversa.'
                        ].join('\n');
                        (async () => {
                            try {
                                const { getClient } = await import('./waClient.js');
                                const cli = getClient();
                                if (cli) {
                                    const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
                                    await cli.sendMessage(jid, adminMsg);
                                }
                            } catch (err) {
                                console.error('[NotifyAdmin] Falha suporte (menu 4):', err?.message || err);
                            }
                        })();
                        await openHandoff(toPhoneKey(c.phone || phoneKey));
                    }

                    // NÃO resetar aqui
                    return msgUser;
                }
                session.step = 'suporte_phone';
                return `${ICONS.SUPPORT} *Suporte*\nInforme o *telefone* do cadastro ou digite *meu*:`;
            }
            case '5': {
                const { customer: c, usedKey } = await findCustomerByAny(phoneKey);
                if (c && c.plan) {
                    const keyForPayment = toPhoneKey(c.phone || usedKey || phoneKey);
                    const { total, status } = await getPaymentStatus(keyForPayment);
                    const valorRecarga = planPriceFor(c.plan) ?? total;

                    const msgUser =
                        `${ICONS.PAY} *Dados Pagamento*\n` +
                        `Cliente: *${c.firstName} ${c.lastName}*\n` +
                        `Plano: *${c.plan.durationLabel}*\n` +
                        `Valor: *R$${valorRecarga}*\n` +
                        `Status: *${status}*\n` +
                        `PIX (CPF): *13919297725*\n` +
                        `Banco: *Itaú* (Vinicius)\n` +
                        `${ICONS.CAL} Vencimento Plano: *${c.endDate ? formatDateBR(c.endDate) : '-'}*\n` +
                        `Envie o comprovante e aguarde.\n\n` +
                        `${WAITING_MSG}`;

                    if (ADMIN_PHONE) {
                        const adminMsg = [
                            '📣 *RECARGA SOLICITADA*',
                            `📞 Telefone: ${keyForPayment}`,
                            `👤 Cliente: ${c.firstName} ${c.lastName}`,
                            `📦 Plano: ${c.plan.durationLabel}`,
                            `💰 Valor Recarga: R$${valorRecarga}`,
                            `📊 Status atual: ${status}`,
                            `${ICONS.CAL} Vencimento: ${c.endDate ? formatDateBR(c.endDate) : '-'}`,
                            `🕒 ${new Date().toLocaleString('pt-BR')}`,
                            '',
                            'A solicitação foi registrada. Você pode usar o comando admin "assumir <telefone>" para assumir a conversa.'
                        ].join('\n');
                        (async () => {
                            try {
                                const { getClient } = await import('./waClient.js');
                                const cli = getClient();
                                if (cli) {
                                    const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
                                    await cli.sendMessage(jid, adminMsg);
                                }
                            } catch (err) {
                                console.error('[NotifyAdmin] Falha recarga (menu 5):', err?.message || err);
                            }
                        })();
                        await openHandoff(keyForPayment);
                    }

                    // NÃO resetar aqui
                    return msgUser;
                }
                session.step = 'pag_phone';
                return `${ICONS.PAY} *Pagamento / Recarga*\nInforme o *telefone* do cadastro ou digite *meu*:`;
            }
            case '6': {
                const { customer: c, usedKey } = await findCustomerByAny(phoneKey);
                const keyForContact = toPhoneKey(c?.phone || usedKey || phoneKey);
                if (c) {
                    if (ADMIN_PHONE) {
                        let status = '-';
                        let total = null;
                        try {
                            const st = await getPaymentStatus(keyForContact);
                            status = st?.status ?? '-';
                            total = st?.total ?? null;
                        } catch { }
                        const valorPlano = planPriceFor(c.plan) ?? total ?? '-';
                        const adminMsg = [
                            '📣 *ATENDIMENTO SOLICITADO*',
                            `📞 Telefone: ${keyForContact}`,
                            `👤 Cliente: ${c.firstName} ${c.lastName}`,
                            `📦 Plano: ${c.plan?.durationLabel || '-'}`,
                            `💰 Valor Plano: ${valorPlano !== '-' ? `R$${valorPlano}` : '-'}`,
                            `📊 Status atual: ${status}`,
                            `${ICONS.CAL} Vencimento: ${c.endDate ? formatDateBR(c.endDate) : '-'}`,
                            `🕒 ${new Date().toLocaleString('pt-BR')}`,
                            '',
                            'Use "assumir <telefone>" ou envie mensagens para o cliente diretamente.'
                        ].join('\n');
                        (async () => {
                            try {
                                const { getClient } = await import('./waClient.js');
                                const cli = getClient();
                                if (cli) {
                                    const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
                                    await cli.sendMessage(jid, adminMsg);
                                }
                            } catch (err) {
                                console.error('[NotifyAdmin] Falha atendimento (menu 6):', err?.message || err);
                            }
                        })();
                        await openHandoff(keyForContact);
                    }
                    // NÃO resetar aqui
                    return `${ICONS.SUPPORT} *Solicitação registrada*\n\n${WAITING_MSG}`;
                } else {
                    session.temp.pendingApproval = true;
                    session.step = 'awaiting_admin_approval';
                    await requestApprovalForUnknown(phoneKey);
                    scheduleMenuTimeout(phoneKey);
                    return `${ICONS.SUPPORT} *Solicitação enviada*\nSeu pedido foi enviado para avaliação.\n${WAITING_MSG}`;
                }
            }
            default:
                scheduleMenuTimeout(phoneKey);
                return `Opção inválida.\n\n${buildMainMenu()}\n\nEnvie *1, 2, 3, 4, 5 ou 6*:`;
        }
    }

    // Fluxos de cadastro
    if (session.step.startsWith('cadastro_')) {
        return await handleCadastro(session, text);
    }

    // Tempo de assinatura fluxo
    if (session.step === 'tempo_phone') {
        const tL = (text || '').toLowerCase();
        const wantMy = ['meu', 'meu numero', 'meu número', 'meu telefone'].includes(tL);
        let q = toPhoneKey(wantMy ? phoneKey : text);
        let c = await getCustomer(q);
        if (!c && q.startsWith('55')) c = await getCustomer(q.slice(2));
        if (!c && !q.startsWith('55') && q.length >= 10) c = await getCustomer('55' + q);
        if (!c || !c.endDate) {
            scheduleMenuTimeout(phoneKey);
            return '❓ Telefone não encontrado ou sem plano. Tente outro ou digite *menu*.';
        }
        const rem = daysRemaining(c.endDate);
        reset(phoneKey); getSession(phoneKey).temp._welcomed = true;
        scheduleMenuTimeout(phoneKey);
        return `${ICONS.TIME} *Status da Assinatura*\nCliente: *${c.firstName} ${c.lastName}*\nPlano: *${c.plan.durationLabel}*\n${ICONS.CAL} Vencimento: *${formatDateBR(c.endDate)}*\nDias restantes: *${rem}*\n\nDigite *menu* para voltar.`;
    }

    // Suporte telefone fluxo
    if (session.step === 'suporte_phone') {
        const tL = (text || '').toLowerCase();
        const wantMy = ['meu', 'meu numero', 'meu número', 'meu telefone'].includes(tL);
        let q = toPhoneKey(wantMy ? phoneKey : text);
        let c = await getCustomer(q);
        if (!c && q.startsWith('55')) c = await getCustomer(q.slice(2));
        if (!c && !q.startsWith('55') && q.length >= 10) c = await getCustomer('55' + q);
        if (!c) {
            scheduleMenuTimeout(phoneKey);
            return '❓ Telefone não encontrado. Envie outro ou *menu*.';
        }

        if (ADMIN_PHONE) {
            const keyForPayment = toPhoneKey(c.phone || q);
            let status = '-';
            let total = null;
            try {
                const st = await getPaymentStatus(keyForPayment);
                status = st?.status ?? '-';
                total = st?.total ?? null;
            } catch { }
            const valorPlano = planPriceFor(c.plan) ?? total ?? '-';
            const adminMsg = [
                '📣 *SUPORTE SOLICITADO*',
                `📞 Telefone: ${keyForPayment}`,
                `👤 Cliente: ${c.firstName} ${c.lastName}`,
                `📦 Plano: ${c.plan?.durationLabel || '-'}`,
                `💰 Valor Plano: ${valorPlano !== '-' ? `R$${valorPlano}` : '-'}`,
                `📊 Status atual: ${status}`,
                `${ICONS.CAL} Vencimento: ${c.endDate ? formatDateBR(c.endDate) : '-'}`,
                `🕒 ${new Date().toLocaleString('pt-BR')}`,
                '',
                'A solicitação foi registrada. Você pode usar o comando admin "assumir <telefone>" para assumir a conversa.'
            ].join('\n');
            (async () => {
                try {
                    const { getClient } = await import('./waClient.js');
                    const cli = getClient();
                    if (cli) {
                        const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
                        await cli.sendMessage(jid, adminMsg);
                    }
                } catch (err) {
                    console.error('[NotifyAdmin] Falha suporte (suporte_phone):', err?.message || err);
                }
            })();
            await openHandoff(toPhoneKey(c.phone || q));
        }

        // NÃO resetar aqui
        return `${ICONS.SUPPORT} *Solicitação registrada*\nCliente: *${c.firstName} ${c.lastName}*\nPlano: *${c.plan?.durationLabel || '-'}*\n${ICONS.CAL} Vencimento: *${c.endDate ? formatDateBR(c.endDate) : '-'}*\n\n${WAITING_MSG}`;
    }

    // Pagamento fluxo
    if (session.step === 'pag_phone') {
        const tL = (text || '').toLowerCase();
        const wantMy = ['meu', 'meu numero', 'meu número', 'meu telefone'].includes(tL);
        let q = toPhoneKey(wantMy ? phoneKey : text);
        let c = await getCustomer(q);
        if (!c && q.startsWith('55')) c = await getCustomer(q.slice(2));
        if (!c && !q.startsWith('55') && q.length >= 10) c = await getCustomer('55' + q);
        if (!c || !c.plan) {
            scheduleMenuTimeout(phoneKey);
            return '❓ Telefone não encontrado ou sem plano. Envie outro ou *menu*.';
        }
        const keyForPayment = toPhoneKey(c.phone || q);
        const { total, status } = await getPaymentStatus(keyForPayment);
        const valorRecarga = planPriceFor(c.plan) ?? total;

        const msgUser =
            `${ICONS.PAY} *Dados Pagamento*\n` +
            `Cliente: *${c.firstName} ${c.lastName}*\n` +
            `Plano: *${c.plan.durationLabel}*\n` +
            `Valor: *R$${valorRecarga}*\n` +
            `Status: *${status}*\n` +
            `PIX (CPF): *13919297725*\n` +
            `Banco: *Itaú* (Vinicius)\n` +
            `${ICONS.CAL} Vencimento Plano: *${c.endDate ? formatDateBR(c.endDate) : '-'}*\n` +
            `Envie o comprovante e aguarde.\n\n` +
            `${WAITING_MSG}`;

        if (ADMIN_PHONE) {
            const adminMsg = [
                '📣 *RECARGA SOLICITADA*',
                `📞 Telefone: ${keyForPayment}`,
                `👤 Cliente: ${c.firstName} ${c.lastName}`,
                `📦 Plano: ${c.plan.durationLabel}`,
                `💰 Valor Recarga: R$${valorRecarga}`,
                `📊 Status atual: ${status}`,
                `${ICONS.CAL} Vencimento: ${c.endDate ? formatDateBR(c.endDate) : '-'}`,
                `🕒 ${new Date().toLocaleString('pt-BR')}`,
                '',
                'A solicitação foi registrada. Você pode usar o comando admin "assumir <telefone>" para assumir a conversa.'
            ].join('\n');
            (async () => {
                try {
                    const { getClient } = await import('./waClient.js');
                    const cli = getClient();
                    if (cli) {
                        const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
                        await cli.sendMessage(jid, adminMsg);
                    }
                } catch (err) {
                    console.error('[NotifyAdmin] Falha recarga (pag_phone):', err?.message || err);
                }
            })();
            await openHandoff(keyForPayment);
        }

        // NÃO resetar aqui
        return msgUser;
    }

    return 'Não entendi. Digite *menu* para opções.';
}

/* Fluxo de cadastro detalhado */
async function handleCadastro(session, textRaw) {
    const t = session.temp;
    const text = isChoiceStep(session.step) ? normChoice(textRaw) : (textRaw || '').trim();

    switch (session.step) {
        case 'cadastro_nome_completo': {
            const parts = text.split(/\s+/).filter(Boolean);
            if (parts.length < 2) return 'Envie *Nome e Sobrenome* (ex: Maria Silva):';
            t.firstName = capitalize(parts.shift());
            t.lastName = parts.map(capitalize).join(' ');
            session.step = 'cadastro_bairro';
            return 'Informe seu *Bairro*:';
        }
        case 'cadastro_bairro':
            t.bairro = title(text);
            session.step = 'cadastro_telas';
            return `${SEP}\n${ICONS.SCREEN} *Quantidade de Telas*\n${NUMBER_EMOJI['1']} *1 Tela* – Uso individual\n${NUMBER_EMOJI['2']} *2 Telas* – Assista em dois dispositivos ao mesmo tempo\n${SEP}\nEnvie *1* ou *2*:`;
        case 'cadastro_telas':
            if (!['1', '2'].includes(text)) return '*Valor inválido.* Envie *1* ou *2*:';
            t.telas = text;
            session.step = 'cadastro_plano';
            return planosFormat(text) + `\n\n*Envie ${t.telas === '1' ? '1, 2, 3 ou 4' : '1, 2 ou 3'}:*`;
        case 'cadastro_plano': {
            const planos = t.telas === '1'
                ? { '1': { label: '1 mês', dias: 31, preco: 30 }, '2': { label: '3 meses', dias: 90, preco: 90 }, '3': { label: '6 meses', dias: 180, preco: 170 }, '4': { label: '1 ano', dias: 365, preco: 300 } }
                : { '1': { label: '1 mês', dias: 31, preco: 50 }, '2': { label: '3 meses', dias: 90, preco: 150 }, '3': { label: '1 ano', dias: 365, preco: 550 } };
        const plano = planos[text];
        if (!plano) return 'Código inválido. Repita apenas o número:';
        t.plano = plano;
        session.step = 'cadastro_dispositivo1_tipo';
        return buildDeviceTypeMenu(1);
        }
        case 'cadastro_dispositivo1_tipo': {
            const tipo = DEVICE_TYPE_OPTIONS[text];
            if (!tipo) return 'Código inválido. Digite 1, 2, 3, 4, 5, 6 ou 7:';
            t.dispositivos = [{ slot: 1, type: tipo }];
            if (tipo === 'TV Smart') {
                session.step = 'cadastro_dispositivo1_marca';
                return buildTVBrandMenu(1);
            }
            session.step = 'cadastro_dispositivo1_app';
            return buildOtherDeviceInstructions();
        }
        case 'cadastro_dispositivo1_marca': {
            if (!(text in TV_BRAND_OPTIONS)) {
                return 'Opção inválida. Digite 1, 2, 3, 4, 5, 6, 7, 8 ou 9:';
            }
            if (TV_BRAND_OPTIONS[text] === null) {
                    session.step = 'cadastro_dispositivo1_marca_outra';
                    return 'Digite a *Marca*:';
            }
            t.dispositivos[0].brand = TV_BRAND_OPTIONS[text];
            session.step = 'cadastro_dispositivo1_app';
            return buildTVAppInstructions(t.dispositivos[0].brand);
        }
        case 'cadastro_dispositivo1_marca_outra':
            t.dispositivos[0].brand = title(text);
            session.step = 'cadastro_dispositivo1_app';
            return buildTVAppInstructions(t.dispositivos[0].brand);
        case 'cadastro_dispositivo1_app': {
            const ok = (text || '').toLowerCase();
            if (!['ok', '1', 'continuar', 'prosseguir', 'seguir'].includes(ok)) return 'Envie "OK" para continuar.';
            session.step = 'cadastro_dispositivo1_mac';
            return 'Informe o *MAC* do dispositivo 1:';
        }
        case 'cadastro_dispositivo1_mac':
            t.dispositivos[0].mac = (text || '').trim();
            t.dispositivos[0].macUpper = (text || '').trim().toUpperCase();
            if (t.telas === '2') {
                session.step = 'cadastro_dispositivo2_tipo';
                return buildDeviceTypeMenu(2);
            }
            session.step = 'cadastro_confirm';
            return resumoCadastroTemp(t);
        case 'cadastro_dispositivo2_tipo': {
            const tipo2 = DEVICE_TYPE_OPTIONS[text];
            if (!tipo2) return 'Código inválido. Digite 1, 2, 3, 4, 5, 6 ou 7:';
            t.dispositivos.push({ slot: 2, type: tipo2 });
            if (tipo2 === 'TV Smart') {
                session.step = 'cadastro_dispositivo2_marca';
                return buildTVBrandMenu(2);
            }
            session.step = 'cadastro_dispositivo2_app';
            return buildOtherDeviceInstructions();
        }
        case 'cadastro_dispositivo2_marca': {
            if (!(text in TV_BRAND_OPTIONS)) {
                return 'Opção inválida. Digite: 1, 2, 3, 4, 5, 6, 7, 8 ou 9:';
            }
            if (TV_BRAND_OPTIONS[text] === null) {
                    session.step = 'cadastro_dispositivo2_marca_outra';
                    return 'Digite a *Marca*:';
            }
            t.dispositivos[1].brand = TV_BRAND_OPTIONS[text];
            session.step = 'cadastro_dispositivo2_app';
            return buildTVAppInstructions(t.dispositivos[1].brand);
        }
        case 'cadastro_dispositivo2_marca_outra':
            t.dispositivos[1].brand = title(text);
            session.step = 'cadastro_dispositivo2_app';
            return buildTVAppInstructions(t.dispositivos[1].brand);
        case 'cadastro_dispositivo2_app': {
            const ok2 = (text || '').toLowerCase();
            if (!['ok', '1', 'continuar', 'prosseguir', 'seguir'].includes(ok2)) return 'Envie "OK" para continuar.';
            session.step = 'cadastro_dispositivo2_mac';
            return 'Informe o *MAC* do dispositivo 2:';
        }
        case 'cadastro_dispositivo2_mac':
            t.dispositivos[1].mac = (text || '').trim();
            t.dispositivos[1].macUpper = (text || '').trim().toUpperCase();
            session.step = 'cadastro_confirm';
            return resumoCadastroTemp(t);
        case 'cadastro_confirm': {
            if ((text || '') === '2') {
                reset(t.phone);
                getSession(t.phone).temp._welcomed = true;
                scheduleMenuTimeout(t.phone);
                return '❌ Cancelado. Digite *menu* para recomeçar.';
            }
            if ((text || '') !== '1') return 'Opção inválida. Responda com *1* (Confirmar) ou *2* (Cancelar):';
            try {
                await createCustomer({ phone: t.phone, firstName: t.firstName, lastName: t.lastName, bairro: t.bairro });
            } catch (e) {
                return 'Erro ao criar cliente: ' + (e?.message || e);
            }
            await addScreens(t.phone, t.dispositivos);
            // Taxa de ativação removida: sempre 0
            const activationFee = 0;
            const total = t.plano.preco;
            await setPlan(t.phone, {
                screensCount: parseInt(t.telas, 10),
                planType: t.telas + '-telas',
                durationLabel: t.plano.label,
                durationDays: t.plano.dias,
                price: t.plano.preco,
                activationFee,
                totalPrice: total
            });
            const pixChave = '13919297725';
            const pixTipo = 'CPF';
            const pixBanco = 'Itaú (Vinicius)';
            const userSummary = [
                SEP,
                `✅ *CADASTRO CONCLUÍDO*`,
                SEP,
                `*Plano:* ${t.plano.label}`,
                `*Telas:* ${t.telas}`,
                `*Valor:* R$${t.plano.preco}`,
                `*Total a Pagar:* R$${total}`,
                '',
                `🔐 *PIX (${pixTipo})*: ${pixChave}`,
                `🏦 *Banco:* ${pixBanco}`,
                '',
                'Envie o *comprovante* aqui e *aguarde*.',
                'Um funcionário irá lhe atender em breve.',
                SEP
            ].join('\n');
            if (ADMIN_PHONE) {
                const adminMsg = [
                    '📣 *NOVO CADASTRO*',
                    `📞 Telefone: ${t.phone}`,
                    `👤 Nome: ${t.firstName} ${t.lastName}`,
                    `📌 Bairro: ${t.bairro}`,
                    `🖥 Telas: ${t.telas}`,
                    `📦 Plano: ${t.plano.label} (R$${t.plano.preco})`,
                    `💰 Total: R$${total}`,
                    '🔌 Dispositivos:',
                    t.dispositivos.map(d => ` - ${d.slot}) ${d.type}${d.brand ? ` (${d.brand})` : ''} MAC: ${d.mac || '-'}`).join('\n'),
                    `🕒 ${new Date().toLocaleString('pt-BR')}`,
                    '',
                    'A solicitação foi registrada. Você pode usar o comando admin "assumir <telefone>" para assumir a conversa.'
                ].join('\n');
                (async () => {
                    try {
                        const { getClient } = await import('./waClient.js');
                        const cli = getClient();
                        if (cli) {
                            const jid = toPhoneKey(ADMIN_PHONE).endsWith('@c.us') ? toPhoneKey(ADMIN_PHONE) : toPhoneKey(ADMIN_PHONE) + '@c.us';
                            await cli.sendMessage(jid, adminMsg);
                        }
                    } catch (err) {
                        console.error('[NotifyAdmin] Falha ao enviar notificação admin]:', err?.message || err);
                    }
                })();
                await openHandoff(t.phone);
            }
            // NÃO resetar aqui para manter handoff
            return userSummary + '\n\n' + WAITING_MSG;
        }
    }
    return 'Falha estado. Digite *menu*.';
}

/* Resumo do cadastro */
function resumoCadastroTemp(t) {
    // Taxa de ativação removida do resumo: total é só o valor do plano
    const ativ = 0;
    const total = t.plano.preco;
    const info = [
        `*Nome:* ${t.firstName} ${t.lastName}`,
        `*Bairro:* ${t.bairro}`,
        `*Telas:* ${t.telas}`,
        `*Plano:* ${t.plano.label} (R$${t.plano.preco})`,
        '',
        `⚡ *TOTAL:* R$${total}`
    ].join('\n');
    const disp = t.dispositivos.map(d => {
        const linha1 = `${d.slot}) ${d.type}${d.brand ? ` (${d.brand})` : ''}`;
        const linha2 = `MAC: ${d.mac || '-'}`;
        return linha1 + '\n' + linha2;
    }).join('\n');
    return [
        SEP,
        `*${ICONS.PLAN} Resumo do Cadastro*`,
        SEP,
        info,
        '',
        '*Dispositivos*',
        disp,
        SEP,
        `${NUMBER_EMOJI['1']} ✅ *Confirmar*\n${NUMBER_EMOJI['2']} ❌ *Cancelar*\nEnvie *1 ou 2*:`
    ].join('\n');
}

/* Pequenas utilidades de texto */
function capitalize(s) { return (s || '').trim().charAt(0).toUpperCase() + (s || '').trim().slice(1).toLowerCase(); }
function title(s) { return (s || '').split(/\s+/).map(capitalize).join(' '); }