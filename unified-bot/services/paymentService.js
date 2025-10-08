import { getCustomer, setPlan } from './customerService.js';

function daysBetween(today, end){
  if(!end) return 0;
  const t = new Date(today); t.setHours(0,0,0,0);
  const e = new Date(end);   e.setHours(0,0,0,0);
  return Math.ceil((e - t) / 86400000);
}

// Status e total do plano atual
export async function getPaymentStatus(phone){
  const c = await getCustomer(phone);
  const p = c?.plan || {};
  const total = (p.price ?? 0) + (p.activationFee ?? 0);
  const dias = daysBetween(new Date(), c?.endDate);
  const status = dias > 0 ? 'PAGO' : 'PENDENTE';
  return { total, status, diasRestantes: Math.max(0, dias) };
}

// Marca como pago (renova usando o plano atual)
export async function markPaid(phone){
  const c = await getCustomer(phone);
  const p = c?.plan;
  if(!p?.durationDays) throw new Error('Plano atual não encontrado para aprovação.');
  await setPlan(phone, {
    screensCount: p.screensCount ?? null,
    planType: p.planType ?? null,
    durationLabel: p.durationLabel ?? `${p.durationDays} dias`,
    durationDays: p.durationDays,
    price: p.price ?? null,
    activationFee: p.activationFee ?? 0,
    totalPrice: p.totalPrice ?? null
  });
  return await getCustomer(phone);
}

// Renovar com dias/preço informados
export async function renewPlan(phone, { durationDays, price } = {}){
  const c = await getCustomer(phone);
  const p = c?.plan || {};
  const days = Number(durationDays || p.durationDays || 30);
  await setPlan(phone, {
    screensCount: p.screensCount ?? null,
    planType: p.planType ?? null,
    durationLabel: `${days} dias`,
    durationDays: days,
    price: (price != null) ? Number(price) : (p.price ?? null),
    activationFee: 0
  });
  return await getCustomer(phone);
}

// Alias compatível
export async function confirmPayment(phone){
  return markPaid(phone);
}