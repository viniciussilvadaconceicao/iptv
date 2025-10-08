import 'dotenv/config';
import { startScheduler } from './services/schedulerService.js';
import { initWhatsApp, isWhatsAppReady, onReady } from './services/waClient.js';
import { startDueNotifier, runDueSweepOnce } from './services/dueNotifierService.js';

// Tag de build para facilitar logs
const BUILD_TAG = 'BUILD-' + new Date().toISOString();
console.log(`\n=== Iniciando Unified WA Bot (${BUILD_TAG}) ===`);

// Handlers globais de erro
process.on('unhandledRejection', (reason) => {
  console.error('[Global] UnhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Global] UncaughtException:', err);
});

// Inicia serviços auxiliares
startScheduler({ intervalMs: 60_000 });

// Inicializa WhatsApp
initWhatsApp();

// Quando o WhatsApp estiver pronto
onReady(async () => {
  // Notificador de vencimento
  startDueNotifier({ intervalMs: 60 * 60 * 1000 });

  // Varredura inicial devidos
  try {
    const sent = await runDueSweepOnce();
    console.log(`[DueNotifier] Varredura inicial: ${sent} notificação(ões).`);
  } catch (e) {
    console.error('[DueNotifier] erro inicial:', e?.message || e);
  }

  console.log('[WhatsApp] READY: conectado.');
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