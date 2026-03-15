import 'dotenv/config';
import { startScheduler } from './services/schedulerService.js';
import { initWhatsApp, isWhatsAppReady, onReady } from './services/waClient.js';
import { startDueNotifier } from './services/dueNotifierService.js';

// Tag de build para facilitar logs
const BUILD_TAG = 'BUILD-' + new Date().toISOString();
console.log(`\n=== Iniciando Unified WA Bot (${BUILD_TAG}) ===`);

// Handlers globais de erro
process.on('unhandledRejection', (reason) => {
  const msg = String(reason?.message || reason || '');
  console.error('[Global] UnhandledRejection:', reason);
  // Puppeteer crash: reagenda reinicialização se o WA não estiver pronto
  if (msg.includes('Execution context was destroyed') || msg.includes('Session closed') || msg.includes('Target closed')) {
    if (!isWhatsAppReady()) {
      console.log('[Global] Detectada queda do Puppeteer, reinicializando WA em 25s...');
      setTimeout(() => initWhatsApp(), 25000);
    }
  }
});
process.on('uncaughtException', (err) => {
  console.error('[Global] UncaughtException:', err);
});

// Inicializa WhatsApp (serviços iniciados só após conectar)
initWhatsApp();

// Quando o WhatsApp estiver pronto
onReady(async () => {
  // Inicia scheduler diário (08:00) — só depois que WA está conectado
  startScheduler({});

  // Notificador de vencimento a cada 60 min (já faz varredura inicial)
  startDueNotifier({ intervalMs: 60 * 60 * 1000 });

  console.log('[WhatsApp] READY: conectado. Scheduler e notificador iniciados.');
});

// Mensagens de instrução
console.log('\n🚀 Bot WhatsApp iniciado. Aguarde o QR (primeira vez) ou READY.');
console.log('Se nada aparecer em ~20s, verifique WA_HEADLESS ou apague a pasta de sessão.');

// Health check simples
setInterval(() => {
  if (isWhatsAppReady()) {
    // ok
  }
}, 30_000);

// Encerramento gracioso
function shutdown(sig) {
  console.log(`\n[Shutdown] Recebido ${sig}. Encerrando...`);
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));