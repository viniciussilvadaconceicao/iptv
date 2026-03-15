import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool as PgPool } from 'pg';

import { readDB } from '../data/dataStore.js';
import { pool } from '../data/pg.js';
import { daysRemaining, formatDateBR } from '../utils/date.js';
import { sendMessageQueued, broadcastQueued, ADMIN_PHONE, STORE_PHONE } from './notificationService.js';

// dedupe em arquivo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NOTIF_FILE = path.resolve(__dirname, '../data/notifications.json');

// Pool interno para o mesmo banco usado pelo bot/Admin (PGURL)
const PGURL = process.env.PGURL;
const internalPool = PGURL ? new PgPool({ connectionString: PGURL }) : null;

function loadDedup() {
  try {
    if (!fs.existsSync(NOTIF_FILE)) return { sent: {} };
    const raw = fs.readFileSync(NOTIF_FILE, 'utf-8');
    const json = JSON.parse(raw || '{}');
    return json && typeof json === 'object' ? (json.sent ? json : { sent: json }) : { sent: {} };
  } catch { return { sent: {} }; }
}
function saveDedup(state) {
  try {
    fs.mkdirSync(path.dirname(NOTIF_FILE), { recursive: true });
    fs.writeFileSync(NOTIF_FILE, JSON.stringify({ sent: state.sent || {} }, null, 2), 'utf-8');
  } catch (e) {
    console.error('[DueNotifier] Falha ao salvar dedup:', e?.message || e);
  }
}
function dedupKey(type, phone, endISO) { return `${type}|${phone}|${endISO}`; }

// catálogo simples de opções para texto
const planosRef = {
  '1': {
    '1': {label:'1 mês', dias:30, preco:30},
    '2': {label:'3 meses', dias:90, preco:90},
    '3': {label:'6 meses', dias:180, preco:170},
    '4': {label:'1 ano', dias:365, preco:300}
  },
  '2': {
    '1': {label:'1 mês', dias:30, preco:50},
    '2': {label:'3 meses', dias:90, preco:150},
    '3': {label:'1 ano', dias:365, preco:550}
  }
};
function buildListaRenovacao(screensCount){
  const key = String(screensCount === 2 ? 2 : 1);
  return Object.values(planosRef[key]).map(p=> `• ${p.label} — R$${p.preco}`).join('\n');
}
function buildPixInfo(){
  return '*🔐 PIX para pagamento*\n• Tipo: CPF\n• CPF: 13919297725\n• Banco: Itaú\n• Titular: Vinicius Silva da Conceição';
}
function buildRelatorioCliente(c, endBR, screens, statusLinha){
  const nome = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  const plano = c.plan?.durationLabel || 'Plano ativo';
  return (
`*📄 Relatório da sua Assinatura*

• Cliente: ${nome}
• WhatsApp: ${c.phone}
• Plano: ${plano}
• Telas: ${screens}
• Vencimento: ${endBR}
• Status: ${statusLinha}

*🔄 Opções de Renovação*
${buildListaRenovacao(screens)}

${buildPixInfo()}

Após o pagamento, envie o comprovante aqui para ativação imediata.`
  );
}

// Carrega clientes: usa sua VIEW quando há DATABASE_URL; senão cai no JSON
async function loadCustomers() {
  // Preferência: usar diretamente as tabelas locais (clientes/planos_cliente)
  // do mesmo banco que o bot/Admin usam (PGURL).
  if (internalPool) {
    const sql = `
      select
        c.telefone          as phone,
        c.nome              as first_name,
        c.sobrenome         as last_name,
        p.fim_em            as end_date,
        p.rotulo_duracao    as plan_duration_label,
        p.qtde_telas        as plan_screens_count
      from planos_cliente p
      join clientes c on c.telefone = p.telefone
      where p.status = 'active'
        and p.fim_em is not null
    `;
    const { rows } = await internalPool.query(sql);
    return rows.map(r => {
      const endISO = r.end_date ? new Date(r.end_date).toISOString() : null;
      const rem = endISO ? daysRemaining(endISO) : null;
      return {
        phone: r.phone,
        firstName: r.first_name || '',
        lastName: r.last_name || '',
        endDate: endISO,
        remDays: rem,
        plan: {
          durationLabel: r.plan_duration_label || null,
          screensCount: Number(r.plan_screens_count || 1) || 1
        }
      };
    }).filter(c => c.endDate);
  }

  // Fallback legado: usar DATABASE_URL + VIEW externa, se configurado
  if (process.env.DATABASE_URL) {
    const sql = process.env.DUE_NOTIFIER_QUERY || `
      select
        telefone                                           as phone,
        split_part(cliente,' ',1)                          as first_name,
        case when position(' ' in cliente)>0
             then substring(cliente from position(' ' in cliente)+1)
             else '' end                                   as last_name,
        encerra_em                                         as end_date,
        plano                                               as plan_duration_label,
        qtde_telas                                          as plan_screens_count,
        dias_restantes                                      as days_remaining
      from vw_relatorio_clientes
      where encerra_em is not null
    `;
    const { rows } = await pool.query(sql);
    return rows.map(r => {
      const endISO = r.end_date ? new Date(r.end_date).toISOString() : null;
      // Recalcula sempre os dias restantes pelo código, para não depender
      // de diferenças de cálculo na VIEW (evita casos em que D-1 não dispara).
      const rem = endISO ? daysRemaining(endISO) : null;
      return {
        phone: r.phone,
        firstName: r.first_name || '',
        lastName: r.last_name || '',
        endDate: endISO,
        remDays: rem,
        plan: {
          durationLabel: r.plan_duration_label || null,
          screensCount: Number(r.plan_screens_count || 1) || 1
        }
      };
    }).filter(c => c.endDate);
  }

  // fallback JSON legado
  const db = readDB();
  return (db.customers || [])
    .filter(c => c?.endDate)
    .map(c => ({
      phone: c.phone,
      firstName: c.firstName,
      lastName: c.lastName,
      endDate: c.endDate,
      remDays: daysRemaining(c.endDate),
      plan: {
        durationLabel: c.plan?.durationLabel,
        screensCount: c.plan?.screensCount || 1
      }
    }));
}

// Varredura única (D-1 cliente; D0 cliente + admin)
export async function runDueSweepOnce({ notifyFn = console.log } = {}) {
  const list = await loadCustomers();
  const dedup = loadDedup();
  let sentCount = 0;

  for (const c of list) {
    const rem = c.remDays;
    if (rem === null || rem === undefined) continue;

    const endBR = formatDateBR(c.endDate);
    const screens = c.plan?.screensCount || 1;
    const nome = `${c.firstName || ''} ${c.lastName || ''}`.trim() || (c.firstName || 'Cliente');
    const planoLabel = c.plan?.durationLabel || 'Plano ativo';

    // D-5
    if (rem === 5) {
      const k = dedupKey('D-5', c.phone, c.endDate);
      if (!dedup.sent[k]) {
        const msg =
      `Olá, ${nome}! 😊\n\n` +
      `Passando para avisar que a sua fatura vence em *${endBR}*.\n\n` +
      `Esse é apenas um lembrete antecipado para você se programar com tranquilidade.\n` +
      `Qualquer dúvida, fico à disposição.`;
        sendMessageQueued(c.phone, msg);
        dedup.sent[k] = true;
        sentCount++;
        notifyFn?.(`[DueNotifier] D-5 para ${c.firstName} (${c.phone}).`);
      }
    }

    // D-1
    if (rem === 1) {
      const k = dedupKey('D-1', c.phone, c.endDate);
      if (!dedup.sent[k]) {
        const msg =
`Olá, ${nome}! 😊\n\n` +
`Passando para avisar que o vencimento do seu plano será amanhã (${endBR}).\n` +
`Caso queira já deixar a renovação programada, seguem as opções:\n\n` +
`*🔄 Opções de renovação*\n` +
`${buildListaRenovacao(screens)}\n\n` +
`${buildPixInfo()}\n\n` +
`Se preferir, após o pagamento é só enviar o comprovante por aqui para deixar tudo ativo sem interrupção. 👍`;
        sendMessageQueued(c.phone, msg);
        dedup.sent[k] = true;
        sentCount++;
        notifyFn?.(`[DueNotifier] D-1 para ${c.firstName} (${c.phone}).`);
      }
    }

    // D0
    if (rem === 0) {
      const kCli = dedupKey('D0-cli', c.phone, c.endDate);
      if (!dedup.sent[kCli]) {
        const msg =
`Olá, ${nome}! 😊\n\n` +
`Hoje é o dia de vencimento do seu plano (${endBR}). Seguem as informações para renovação:\n\n` +
`📄 *Dados da Assinatura*\n` +
`• Cliente: ${nome}\n` +
`• WhatsApp: ${c.phone}\n` +
`• Plano: ${planoLabel}\n` +
`• Telas: ${screens}\n` +
`• Vencimento: ${endBR}\n\n` +
`*🔄 Opções de renovação*\n` +
`${buildListaRenovacao(screens)}\n\n` +
`${buildPixInfo()}\n\n` +
`Após o pagamento, é só enviar o comprovante por aqui para ativação rápida. 👍`;
        sendMessageQueued(c.phone, msg);
        dedup.sent[kCli] = true;
        sentCount++;
        notifyFn?.(`[DueNotifier] D0 (cliente) para ${c.firstName} (${c.phone}).`);
      }

      const kAdm = dedupKey('D0-adm', c.phone, c.endDate);
      if (!dedup.sent[kAdm]) {
        const adminPlano = c.plan?.durationLabel || 'Plano ativo';
        const adminMsg =
`🛎️ VENCIMENTO HOJE
• Cliente: ${c.firstName} ${c.lastName} (${c.phone})
• Plano: ${adminPlano}
• Telas: ${screens}
• Vencimento: ${endBR}
• Status: VENCIDO HOJE`;
        const targets = [STORE_PHONE, ADMIN_PHONE].filter(Boolean);
        if (targets.length) broadcastQueued(targets, adminMsg);
        dedup.sent[kAdm] = true;
        sentCount++;
        notifyFn?.(`[DueNotifier] D0 (admin) reportado: ${c.firstName} (${c.phone}).`);
      }
    }
  }

  saveDedup(dedup);
  return sentCount;
}

// Agendador por intervalo (opcional)
export function startDueNotifier({ intervalMs = 60 * 60 * 1000, notifyFn = console.log } = {}) {
  notifyFn?.(`[DueNotifier] Agendado a cada ${Math.round(intervalMs/60000)} min.`);
  runDueSweepOnce({ notifyFn }).then(c => notifyFn?.(`[DueNotifier] Varredura inicial: ${c} notificação(ões).`))
    .catch(e => console.error('[DueNotifier] Erro varredura inicial:', e?.message || e));
  return setInterval(() => {
    runDueSweepOnce({ notifyFn })
      .then(c => notifyFn?.(`[DueNotifier] Varredura periódica: ${c} notificação(ões).`))
      .catch(e => console.error('[DueNotifier] Erro varredura periódica:', e?.message || e));
  }, intervalMs);
}