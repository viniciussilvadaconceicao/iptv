#!/usr/bin/env node
import readlineSync from 'readline-sync';
import { createCustomer, setPlan, addScreens, getCustomer } from './services/customerService.js';
import { createTicket, listTickets } from './services/supportService.js';
import { getPaymentStatus, confirmPayment, renewPlan } from './services/paymentService.js';
import { startScheduler } from './services/schedulerService.js';
import { daysRemaining, formatDateBR } from './utils/date.js';
import { initWhatsApp, isWhatsAppReady, hasQR } from './services/waClient.js';
import 'dotenv/config';

let lastPhone = null; // telefone da última interação bem sucedida

// Centralização de ícones para padronização visual
const ICONS = {
  APP: '🌐',
  WELCOME: '🎬',
  NEW_USER: '👤',
  TIME: '⏳',
  SUPPORT: '🛠',
  PAYMENT: '💳',
  RECHARGE: '🔄',
  PLAN_BOX: '📦',
  SCREEN: '🖥',
  TV: '📺',
  SUMMARY: '📄',
  PIX: '🔐',
  ORIENTATION: '📌',
  PHONE: '📱',
  NAME: '📝',
  NEIGHBORHOOD: '📍',
  ALERT: '⚠',
  EXIT: '🚪',
  NOT_FOUND: '❓',
  CLOCK: '⏰',
  CHECK: '✅',
  FIRE: '🔥'
};

// Paleta simples e estilos ANSI
const BOLD = txt => `\x1b[1m${txt}\x1b[0m`;
const GREEN = txt => `\x1b[32m${txt}\x1b[0m`;
const CYAN = txt => `\x1b[36m${txt}\x1b[0m`;
const YELLOW = txt => `\x1b[33m${txt}\x1b[0m`;
const MAGENTA = txt => `\x1b[35m${txt}\x1b[0m`;
const RED = txt => `\x1b[31m${txt}\x1b[0m`;

// Agendamento 1x/dia às 09:00 (D-1 e D0 com deduplicação via dueNotifierService)
startScheduler({ hour: 9, minute: 0 });

if(process.env.WA_ENABLE !== 'false'){
  initWhatsApp();
  console.log('\nIniciando integração WhatsApp... (escaneie o QR quando aparecer)');
} else {
  console.log('\n[WhatsApp] Integração desativada (WA_ENABLE=false).');
}

function separator(label){
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(BOLD(label));
  console.log(line);
}

function table(headers, rows){
  const colWidths = headers.map((h,i)=> Math.max(h.length, ...rows.map(r => (r[i]+'').length)) );
  function fmtRow(r){
    return '│ ' + r.map((c,i)=> (c+'').padEnd(colWidths[i],' ') ).join(' │ ') + ' │';
  }
  const top = '┌' + colWidths.map(w=>'─'.repeat(w+2)).join('┬') + '┐';
  const mid = '├' + colWidths.map(w=>'─'.repeat(w+2)).join('┼') + '┤';
  const bot = '└' + colWidths.map(w=>'─'.repeat(w+2)).join('┴') + '┘';
  console.log(top);
  console.log(fmtRow(headers.map(h=>BOLD(h))));
  if(rows.length){
    console.log(mid);
    rows.forEach((r,i)=>{ console.log(fmtRow(r)); });
  }
  console.log(bot);
}

function pause(){ readlineSync.question(`\n${CYAN('Pressione Enter para continuar...')}`); }

async function mainMenu(){
  // Não limpar se QR ainda não apareceu ou não conectado, para não sumir com o código ASCII
  if(isWhatsAppReady() || hasQR()){
    console.clear();
  }
  separator(`${ICONS.APP} BOT IPTV CLI`);
  // Bloco de marketing
  console.log(`\n${BOLD(`${ICONS.WELCOME} Bem-vindo ao IPTV da Delivi!`)}\n`);
  console.log(`${ICONS.FIRE} O que oferecemos:`);
  console.log(GREEN(`${ICONS.CHECK} Mais de 10.000 canais em HD/4K`));
  console.log(GREEN(`${ICONS.CHECK} Filmes e séries atualizados`));
  console.log(GREEN(`${ICONS.CHECK} Canais esportivos premium (SporTV, ESPN)`));
  console.log(GREEN(`${ICONS.CHECK} Suporte técnico profissional 24h`));
  console.log(GREEN(`${ICONS.CHECK} Garantia de qualidade e estabilidade`));
  console.log(GREEN(`${ICONS.CHECK} Preços acessíveis e justos`));
  console.log('\n');
  table(['Opção','Descrição'], [
    ['1', `${ICONS.NEW_USER} Novo Usuário`],
    ['2', `${ICONS.TIME} Tempo de Assinatura`],
    ['3', `${ICONS.SUPPORT} Suporte`],
    ['4', `${ICONS.PAYMENT} Pagamento / Recarga`],
    ['5', `${ICONS.EXIT} Sair`]
  ]);
  const opt = readlineSync.question(YELLOW('Escolha: '));
  switch(opt){
    case '1': await fluxoCadastro(); break;
    case '2': await fluxoTempo(); break;
    case '3': await fluxoSuporte(); break;
    case '4': await fluxoPagamento(); break;
    case '5': console.log(GREEN('Até logo!')); process.exit(0);
    default: console.log(RED('Opção inválida')); pause();
  }
  await mainMenu();
}

// Tabelas de planos
const planos = {
  '1': { // 1 tela
    '1': {label:'1 mês', dias:30, preco:30},
    '2': {label:'3 meses', dias:90, preco:90},
    '3': {label:'6 meses', dias:180, preco:170},
    '4': {label:'1 ano', dias:365, preco:300}
  },
  '2': { // 2 telas
    '1': {label:'1 mês', dias:30, preco:50},
    '2': {label:'3 meses', dias:90, preco:150},
    '3': {label:'1 ano', dias:365, preco:550}
  }
};

const marcasTV = {
  '1':'Samsung',
  '2':'LG',
  '3':'Roku',
  '4':'Philco'
};

const OPEN_HOUR = 8; // 08:00
const CLOSE_HOUR = 24; // até 23:59 efetivamente
function isOpen(){
  const now = new Date();
  const h = now.getHours();
  return h >= OPEN_HOUR && h < CLOSE_HOUR; // h<24 sempre verdade para 0-23
}
function assertOpen(){
  if(!isOpen()){
    console.log(RED(`\n${ICONS.CLOCK} Fora do horário de atendimento.`));
    console.log('Horário de funcionamento: 08:00 às 00:00 (todos os dias).');
    pause();
    return false;
  }
  return true;
}

async function fluxoCadastro(){
  if(!assertOpen()) return;
  console.clear();
  separator(`${ICONS.NEW_USER} Cadastro de Novo Usuário`);
  const phone = readlineSync.question(`${ICONS.PHONE} Telefone (WhatsApp): `);
  const firstName = readlineSync.question(`${ICONS.NAME} Nome: `);
  const lastName = readlineSync.question(`${ICONS.NAME} Sobrenome: `);
  const bairro = readlineSync.question(`${ICONS.NEIGHBORHOOD} Bairro: `);
  let cliente;
  try{ cliente = createCustomer({phone, firstName, lastName, bairro}); }catch(e){ console.log(RED(e.message)); pause(); return; }
  lastPhone = phone; // armazenar para uso automático

  let telas = readlineSync.question(`${ICONS.SCREEN} Número de telas (1 ou 2): `);
  if(!['1','2'].includes(telas)){ console.log(RED('Valor inválido')); pause(); return; }

  console.log('\n');
  separator(`${ICONS.PLAN_BOX} Planos Disponíveis`);
  const rowsPlanos = Object.entries(planos[telas]).map(([k,v])=>[k, v.label, 'R$'+v.preco]);
  table(['Cod','Duração','Preço'], rowsPlanos);
  const planoOpt = readlineSync.question(YELLOW('Escolha o plano: '));
  const plano = planos[telas][planoOpt];
  if(!plano){ console.log(RED('Plano inválido')); pause(); return; }

  const screens = [];
  const tipos = {
    '1':'TV Smart',
    '2':'Celular Android',
    '3':'Tablet Android',
    '4':'PC'
  };

  function coletarTela(slot){
    console.log('\n');
    separator(`${ICONS.SCREEN} Tela ${slot}`);
    table(['Cod','Tipo'], Object.entries(tipos).map(([k,v])=>[k,v]));
    const tipoOpt = readlineSync.question('Tipo: ');
    const tipo = tipos[tipoOpt];
    if(!tipo){ console.log(RED('Tipo inválido')); return coletarTela(slot); }
    let brand = null; let mac = null;
    if(tipo==='TV Smart'){
      separator(`${ICONS.TV} TV Smart`);
      table(['Cod','Marca'], Object.entries(marcasTV).map(([k,v])=>[k,v]));
      const mOpt = readlineSync.question('Marca: ');
      brand = marcasTV[mOpt] || 'Outra';
    }
    // Agora todos os dispositivos precisam do MAC e usam o mesmo aplicativo
    console.log(MAGENTA('\nBaixe/Abra o aplicativo IBO Revenda no dispositivo e localize o MAC (geralmente em Informações / Sobre / Device ID).'));
    mac = readlineSync.question(`${ICONS.PIX} MAC: `); // reutilizando ícone de segurança
    screens.push({slot, type:tipo, brand, mac});
  }

  coletarTela(1);
  if(telas==='2') coletarTela(2);

  addScreens(phone, screens);

  const activationFee = screens.filter(s=>s.type==='TV Smart').length * 40; // 40 por TV smart
  const total = plano.preco + activationFee;
  setPlan(phone, {screensCount: parseInt(telas), planType: telas+'-telas', durationLabel:plano.label, durationDays:plano.dias, price:plano.preco, activationFee, totalPrice: total});

  console.log('\n');
  separator(`${ICONS.SUMMARY} Resumo do Cadastro`);
  table(['Campo','Valor'], [
    ['Telefone', phone],
    ['Nome', `${firstName} ${lastName}`],
    ['Bairro', bairro],
    ['Telas', telas],
    ['Plano', plano.label],
    ['Preço Plano', 'R$'+plano.preco],
    ['Taxa Ativação', 'R$'+activationFee],
    ['TOTAL', BOLD('R$'+total)]
  ]);
  console.log(GREEN('\nAguarde, um atendente irá responder em instantes.'));
  console.log(CYAN('\n[Relatório Admin Gerado]'));
  console.log(`CLIENTE ${firstName} ${lastName} (${phone}) | Bairro: ${bairro} | Telas: ${telas} | Total: R$${total}`);
  pause();
}

async function fluxoTempo(){
  if(!assertOpen()) return;
  console.clear();
  separator(`${ICONS.TIME} Tempo de Assinatura`);
  let phone = lastPhone;
  if(phone){
    const entrada = readlineSync.question(`Usar telefone detectado ${phone}? (Enter confirma ou digite outro): `);
    if(entrada.trim()) phone = entrada.trim();
  } else {
    phone = readlineSync.question('Telefone: ');
  }
  const tentar = async (numero)=>{
    const c = getCustomer(numero);
    if(!c || !c.endDate){
      fallbackClienteNaoEncontrado('Tempo de Assinatura', (novo)=>{ phone = novo; tentar(novo); });
      return;
    }
    lastPhone = numero;
    const rem = daysRemaining(c.endDate);
    table(['Plano','Expira','Dias Restantes'], [[c.plan.durationLabel, formatDateBR(c.endDate), rem]]);
    if(rem <= 0){
      console.log(RED(`\n${ICONS.RECHARGE} Plano expirado. Vamos para a recarga...`));
      pause();
      await fluxoRecarga(numero, c);
      return;
    } else if(rem === 1){
      console.log(YELLOW(`${ICONS.ALERT} Seu plano expira amanhã. Considere renovar para não ficar sem acesso.`));
    } else {
      console.log(GREEN('Plano ativo.'));
    }
    pause();
  };
  await tentar(phone);
}

async function fluxoSuporte(){
  if(!assertOpen()) return;
  console.clear();
  separator(`${ICONS.SUPPORT} Suporte`);
  let phone = lastPhone || readlineSync.question('Telefone: ');
  if(lastPhone){
    const entrada = readlineSync.question(`Usar telefone ${phone}? (Enter confirma ou digite outro): `);
    if(entrada.trim()) phone = entrada.trim();
  }
  const tentar = async (numero)=>{
    const c = getCustomer(numero);
    if(!c){
      fallbackClienteNaoEncontrado('Suporte', (novo)=>{ phone = novo; tentar(novo); });
      return;
    }
    lastPhone = numero;
    if(!c.plan){ console.log(RED('Cliente sem plano cadastrado.')); pause(); return; }
    const telasLabel = c.plan.screensCount === 2 ? '2 Telas' : '1 Tela';
    const dispositivosRows = (c.screens||[]).map(s=>[s.slot, s.type, (s.brand||'—'), (s.mac||'—')]);
    table(['Campo','Valor'], [
      ['WhatsApp', numero],
      ['Nome', `${c.firstName} ${c.lastName}`],
      ['Bairro', c.bairro],
      ['Assinatura', telasLabel],
      ['Plano', c.plan.durationLabel],
      ['Vencimento', c.endDate ? formatDateBR(c.endDate) : '—']
    ]);

    console.log('\n');
    if(dispositivosRows.length){
      separator(`${ICONS.SCREEN} Dispositivos`);
      table(['Slot','Tipo','Marca','MAC'], dispositivosRows);
    } else {
      console.log(YELLOW('Nenhum dispositivo cadastrado.'));
    }

    console.log('\n');
    separator(`${ICONS.ORIENTATION} Orientações`);
    console.log(GREEN('• Verifique se há conexão de internet estável.'));
    console.log(GREEN('• Se possível conecte TV e PC via cabo (Ethernet) direto no roteador.'));
    console.log(GREEN('• Utilize a rede Wi-Fi 5G (quando disponível) para melhor desempenho.'));
    console.log(GREEN('• Mantenha os equipamentos ligados enquanto aguarda o suporte.'));

    console.log(CYAN('\nUm atendente irá te responder em instantes.'));

    console.log(MAGENTA('\n[Relatório Suporte Enviado ao Admin]'));
    console.log(MAGENTA(`SUPORTE ${c.firstName} ${c.lastName} (${numero}) | Bairro: ${c.bairro} | Telas: ${telasLabel} | Plano: ${c.plan.durationLabel} | Venc: ${c.endDate}`));
    if(dispositivosRows.length){
      dispositivosRows.forEach(r=> console.log(MAGENTA(` - Slot ${r[0]}: ${r[1]} ${r[2]} MAC:${r[3]}`)) );
    }
    pause();
  };
  await tentar(phone);
}

async function fluxoPagamento(){
  if(!assertOpen()) return;
  console.clear();
  separator(`${ICONS.PAYMENT} Pagamento / Recarga`);
  let phone = lastPhone || readlineSync.question('Telefone: ');
  if(lastPhone){
    const entrada = readlineSync.question(`Usar telefone ${phone}? (Enter confirma ou digite outro): `);
    if(entrada.trim()) phone = entrada.trim();
  }
  const tentar = async (numero)=>{
    const c = getCustomer(numero);
    if(!c){
      fallbackClienteNaoEncontrado('Pagamento/Recarga', (novo)=>{ phone = novo; tentar(novo); });
      return;
    }
    lastPhone = numero;
    if(!c.plan){ console.log(RED('Cliente sem plano definido')); pause(); return; }
    const telasLabel = c.plan.screensCount === 2 ? '2 Telas' : '1 Tela';
    const tecnologias = (c.screens || []).map(s=> s.type + (s.brand?`(${s.brand})`:'' ) ).join(', ');
    const { status, total } = await getPaymentStatus(numero);
    table(['Campo','Valor'], [
      ['WhatsApp', numero],
      ['Nome', `${c.firstName} ${c.lastName}`],
      ['Bairro', c.bairro],
      ['Assinatura', telasLabel],
      ['Plano', c.plan.durationLabel],
      ['Vencimento', c.endDate ? formatDateBR(c.endDate) : '—'],
      ['Tecnologias', tecnologias || '—'],
      ['Valor Total', 'R$'+total],
      ['Status', status]
    ]);
    console.log('\n');
    separator(`${ICONS.PIX} Dados para Pagamento PIX`);
    table(['Chave','Valor'], [
      ['Tipo', 'CPF'],
      ['CPF', '13919297725'],
      ['Banco', 'Itaú'],
      ['Titular', 'Vinicius Silva da Conceição']
    ]);
    console.log(YELLOW('\nApós efetuar o pagamento, envie o comprovante (imagem ou texto).'));
    console.log(CYAN('Um de nossos atendentes irá responder em alguns instantes.'));
    console.log(MAGENTA('\n[Notificação Admin] Pedido de pagamento/recarga:'));
    console.log(MAGENTA(`CLIENTE ${c.firstName} ${c.lastName} (${numero}) | Plano ${c.plan.durationLabel} ${telasLabel} | Total R$${total}`));
    if(status!=='PAID'){
      const op = readlineSync.question('\nMarcar pagamento como confirmado agora? (s/n): ');
      if(op.toLowerCase()==='s'){
        await confirmPayment(numero);
        console.log(GREEN('Pagamento marcado como confirmado.'));
      }
    }
    const rec = readlineSync.question('\nDeseja realizar uma recarga/renovação agora? (s/n): ');
    if(rec.toLowerCase()==='s') { await fluxoRecarga(numero, c); return; }
    pause();
  };
  await tentar(phone);
}

async function fluxoRecarga(phoneParam, customerObj){
  if(!assertOpen()) return;
  console.clear();
  separator(`${ICONS.RECHARGE} Recarga / Renovação`);
  let phone = phoneParam || lastPhone || readlineSync.question('Telefone: ');
  const tentar = async (numero)=>{
    let c = customerObj || getCustomer(numero);
    if(!c){
      fallbackClienteNaoEncontrado('Recarga', (novo)=>{ phone = novo; customerObj = null; tentar(novo); });
      return;
    }
    customerObj = c;
    if(!c.plan){ console.log(RED('Cliente sem plano base.')); pause(); return; }
    const telas = c.plan.screensCount === 2 ? '2' : '1';
    const planTable = planos[telas];
    const rows = Object.entries(planTable).map(([k,v])=>[k, v.label, 'R$'+v.preco]);
    table(['Cod','Duração','Preço'], rows);
    const opt = readlineSync.question('Escolha nova duração: ');
    const escolhido = planTable[opt];
    if(!escolhido){ console.log(RED('Opção inválida')); pause(); return; }
    const confirmar = readlineSync.question(`Confirmar renovação de ${escolhido.label} por R$${escolhido.preco}? (s/n): `);
    if(confirmar.toLowerCase()!=='s'){ console.log(YELLOW('Cancelado.')); pause(); return; }
    const updated = await renewPlan(numero, {durationDays: escolhido.dias, price: escolhido.preco});
    table(['Novo Fim','Plano Base','Dias Adicionados'], [[formatDateBR(updated.endDate), escolhido.label, escolhido.dias]]);
    console.log(GREEN('Renovação aplicada com sucesso.'));
    pause();
  };
  await tentar(phone);
}

function fallbackClienteNaoEncontrado(contexto, retryCallback){
  console.log(RED(`\n${ICONS.NOT_FOUND} Cliente não encontrado no fluxo: ${contexto}.`));
  table(['Opção','Ação'], [
    ['1','Informar outro número'],
    ['2','Ir para Novo Usuário'],
    ['0','Voltar ao menu']
  ]);
  const op = readlineSync.question('Escolha: ');
  if(op==='1'){
    const novo = readlineSync.question('Digite outro número (somente dígitos): ');
    return retryCallback(novo.trim());
  } else if(op==='2'){
    fluxoCadastro();
    return;
  } else {
    return; // volta ao menu automaticamente após fluxo atual
  }
}

await mainMenu();