import { readDB, writeDB } from '../data/dataStore.js';
import { v4 as uuid } from 'uuid';

export function createTicket(phone, subject, description){
  const ticket = { id: uuid(), phone, subject, description, status: 'OPEN', createdAt: new Date().toISOString() };
  writeDB(data=>{ data.tickets.push(ticket); return data; });
  return ticket;
}

export function listTickets(phone){
  const db = readDB();
  return db.tickets.filter(t=>t.phone===phone);
}
