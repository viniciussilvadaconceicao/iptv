// Utilidades de data robustas: aceitam Date, string (ISO/BR) ou timestamp

function toDate(input) {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'string') {
    const s = input.trim();
    // Suporte a DD/MM/YYYY
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    let d;
    if (br) {
      const [, dd, mm, yyyy] = br;
      d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    } else {
      // ISO ou outras strings parseáveis pelo Date
      d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
    }
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function todayISO(){
  const today = startOfDay(new Date());
  return toISODate(today);
}

export function addDays(dateLike, days){
  const d = toDate(dateLike);
  if (!d) return '';
  const base = startOfDay(d);
  base.setDate(base.getDate() + Number(days || 0));
  return toISODate(base);
}

export function daysBetween(aLike, bLike){
  const a0 = toDate(aLike);
  const b0 = toDate(bLike);
  if (!a0 || !b0) return 0;
  const a = startOfDay(a0);
  const b = startOfDay(b0);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export function daysRemaining(endLike){
  return daysBetween(todayISO(), endLike);
}

export function formatDateBR(dateLike){
  const d = toDate(dateLike);
  if(!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}