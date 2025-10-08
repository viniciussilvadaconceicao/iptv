// Executa 1x/dia às 08:00. Envia D-1 (cliente) e D0 (cliente + ADMIN) com deduplicação via dueNotifierService.
import { runDueSweepOnce } from './dueNotifierService.js';

let __timer = null;
let __lastRunKey = null; // 'YYYY-MM-DD' da última execução (evita rodar duas vezes no mesmo dia)

function pad(n){ return String(n).padStart(2,'0'); }
function todayKey(d = new Date()){
  const y = d.getFullYear(), m = pad(d.getMonth()+1), dd = pad(d.getDate());
  return `${y}-${m}-${dd}`;
}

function nextRunAt(hour=8, minute=0){
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

async function runDailyOnce(notifyFn){
  const key = todayKey();
  if (__lastRunKey === key) return; // já executou hoje
  const count = await runDueSweepOnce(); // DueNotifier decide D-1/D0 e controla duplicidade
  __lastRunKey = key;
  notifyFn?.(`[Scheduler] Execução diária concluída: ${count} notificação(ões) enviadas.`);
}

export function startScheduler({ hour=8, minute=0, notifyFn=console.log, ...rest } = {}){
  if (rest?.intervalMs) {
    notifyFn?.('[Scheduler] intervalMs ignorado. Usando execução diária às ' + `${pad(hour)}:${pad(minute)}.`);
  }
  if (__timer) { clearTimeout(__timer); __timer = null; }

  // Se iniciou após o horário de hoje, roda uma vez agora para não perder o dia (sem duplicar).
  const now = new Date();
  const todayRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (now >= todayRun) {
    runDailyOnce(notifyFn).catch(e => console.error('[Scheduler] Erro execução imediata:', e?.message || e));
  }

  function scheduleNext(){
    const next = nextRunAt(hour, minute);
    const delay = next.getTime() - Date.now();
    notifyFn?.(`[Scheduler] Próxima execução diária às ${pad(hour)}:${pad(minute)} (${next.toLocaleString('pt-BR')}).`);
    __timer = setTimeout(async () => {
      try {
        await runDailyOnce(notifyFn);
      } catch (e) {
        console.error('[Scheduler] Erro na execução diária:', e?.message || e);
      } finally {
        scheduleNext(); // agenda o próximo dia
      }
    }, delay);
  }

  scheduleNext();
}