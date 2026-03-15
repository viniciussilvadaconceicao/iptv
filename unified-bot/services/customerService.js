import { Pool } from 'pg';

const PGURL = process.env.PGURL;
if (!PGURL) {
  throw new Error('Defina PGURL no .env (ex: PGURL=postgres://postgres:sua_senha@localhost:5432/bot_iptv)');
}

const pool = new Pool({ connectionString: PGURL });

function normalizePhone(p){ return String(p||'').replace(/\D/g,''); }
function toNumber(n){ return n == null ? null : Number(n); }
function toDate(d){ return d ? new Date(d) : null; }

// Cria as tabelas em português
async function ensureSchema(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      telefone     VARCHAR(20) PRIMARY KEY,
      nome         TEXT NOT NULL,
      sobrenome    TEXT NOT NULL,
      bairro       TEXT,
      criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dispositivos (
      id            BIGSERIAL PRIMARY KEY,
      telefone      VARCHAR(20) NOT NULL REFERENCES clientes(telefone) ON DELETE CASCADE,
      posicao       INT NOT NULL,
      tipo          TEXT NOT NULL,
      marca         TEXT,
      mac           TEXT,
      mac_maiusculo TEXT,
      aplicativo    TEXT,
      cliente_nome  TEXT,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (telefone, posicao)
    );
  `);
  await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS aplicativo TEXT`);
  await pool.query(`ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS cliente_nome TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS planos_cliente (
      id               BIGSERIAL PRIMARY KEY,
      telefone         VARCHAR(20) NOT NULL REFERENCES clientes(telefone) ON DELETE CASCADE,
      cliente_nome     TEXT,
      tipo_plano       TEXT,
      qtde_telas       INT,
      rotulo_duracao   TEXT,
      dias_duracao     INT,
      preco            NUMERIC(10,2),
      taxa_ativacao    NUMERIC(10,2),
      preco_total      NUMERIC(10,2),
      inicio_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
      fim_em           TIMESTAMPTZ NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active', -- active | expired | cancelled | pending
      criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE planos_cliente ADD COLUMN IF NOT EXISTS cliente_nome TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_planos_cliente_telefone ON planos_cliente(telefone);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_planos_cliente_status ON planos_cliente(status);`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_plano_ativo_por_cliente
      ON planos_cliente(telefone) WHERE status = 'active';
  `);

  // View de vencimentos, combinando cliente, plano ativo e dispositivos
  await pool.query(`
    CREATE OR REPLACE VIEW vw_vencimentos AS
    SELECT
      c.telefone,
      c.nome,
      c.sobrenome,
      c.bairro,
      p.tipo_plano,
      p.rotulo_duracao,
      p.inicio_em,
      p.fim_em,
      p.status,
      GREATEST(0, (p.fim_em::date - now()::date))::int AS dias_restantes,
      d.posicao,
      d.tipo,
      d.marca,
      d.aplicativo,
      d.mac
    FROM clientes c
    LEFT JOIN planos_cliente p
      ON p.telefone = c.telefone
     AND p.status = 'active'
    LEFT JOIN dispositivos d
      ON d.telefone = c.telefone;
  `);
}
await ensureSchema();

// Cria/atualiza cliente
export async function createCustomer({ phone, firstName, lastName, bairro }){
  const tel = normalizePhone(phone);
  await pool.query(
    `INSERT INTO clientes (telefone, nome, sobrenome, bairro)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (telefone) DO UPDATE SET
       nome = EXCLUDED.nome,
       sobrenome = EXCLUDED.sobrenome,
       bairro = EXCLUDED.bairro`,
    [tel, (firstName||'').trim(), (lastName||'').trim(), bairro?.trim() || null]
  );
}

// Substitui os dispositivos (telas) do cliente
export async function addScreens(phone, dispositivos){
  const tel = normalizePhone(phone);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM dispositivos WHERE telefone=$1', [tel]);
    const nameRes = await client.query(
      'SELECT nome, sobrenome FROM clientes WHERE telefone=$1',
      [tel]
    );
    const fullName = nameRes.rowCount ? `${nameRes.rows[0].nome} ${nameRes.rows[0].sobrenome}` : null;
    if(Array.isArray(dispositivos)){
      for(const d of dispositivos){
        await client.query(
          `INSERT INTO dispositivos (telefone, posicao, tipo, marca, mac, mac_maiusculo, aplicativo, cliente_nome)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            tel,
            Number(d.slot),
            d.type,
            d.brand || null,
            d.mac || null,
            (d.macUpper || (d.mac ? String(d.mac).toUpperCase() : null)),
            d.app || null,
            fullName
          ]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e){
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Define um novo plano (expira o anterior ativo e insere um novo)
// Suporta durationMonths (meses calendário) OU durationDays (dias)
export async function setPlan(phone, {
  screensCount,
  planType,
  durationLabel,
  durationDays,
  durationMonths,
  price,
  activationFee = 0,
  totalPrice,
  status = 'active'
}){
  const tel = normalizePhone(phone);
  const days = durationDays != null ? Number(durationDays) : null;
  const months = durationMonths != null ? Number(durationMonths) : null;

  if ((!days && !months) || (days && days < 1 && months < 1)) {
    throw new Error('durationDays ou durationMonths inválido');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // expira plano ativo anterior
    await client.query(
      `UPDATE planos_cliente SET status='expired'
       WHERE telefone=$1 AND status='active'`,
      [tel]
    );

    // calcula inicio/fim no servidor usando interval de meses quando disponível
    let inicio, fim, diasCalc;
    const rNow = await client.query('SELECT now() AS agora');
    inicio = rNow.rows[0].agora;

    if (months && months > 0) {
      const rEnd = await client.query('SELECT (now() + make_interval(months => $1)) AS fim', [months]);
      fim = rEnd.rows[0].fim;
      // diferencia em dias entre as datas (inteiro)
      const rDays = await client.query(`SELECT ((($1::timestamptz + make_interval(months => $2))::date - $1::date)::int) AS dias`, [inicio, months]);
      diasCalc = rDays.rows[0].dias;
    } else {
      // fallback para dias
      const rEnd = await client.query('SELECT (now() + ($1 || \' days\')::interval) AS fim', [String(days)]);
      fim = rEnd.rows[0].fim;
      const rDays = await client.query('SELECT ((now() + ($1 || \' days\')::interval)::date - now()::date)::int AS dias', [String(days)]);
      diasCalc = rDays.rows[0].dias;
    }

    const nameRes = await client.query('SELECT nome, sobrenome FROM clientes WHERE telefone=$1', [tel]);
    const fullName = nameRes.rowCount ? `${nameRes.rows[0].nome} ${nameRes.rows[0].sobrenome}` : null;

    await client.query(
      `INSERT INTO planos_cliente
        (telefone, cliente_nome, tipo_plano, qtde_telas, rotulo_duracao, dias_duracao, preco, taxa_ativacao, preco_total, inicio_em, fim_em, status)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        tel,
        fullName,
        planType || (screensCount ? `${screensCount}-telas` : null),
        screensCount != null ? Number(screensCount) : null,
        durationLabel || (months ? `${months} mês(es)` : `${days} dias`),
        diasCalc,
        price != null ? Number(price) : null,
        activationFee != null ? Number(activationFee) : 0,
        totalPrice != null ? Number(totalPrice) : (price != null ? Number(price) + (activationFee||0) : null),
        inicio,
        fim,
        status
      ]
    );

    await client.query('COMMIT');
  } catch(e){
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Retorna dados do cliente + plano ativo + dispositivos
export async function getCustomer(phone){
  const tel = normalizePhone(phone);

  const cRes = await pool.query(
    `SELECT telefone, nome, sobrenome, bairro, criado_em
       FROM clientes
      WHERE telefone=$1`,
    [tel]
  );
  if (cRes.rowCount === 0) return null;
  const c = cRes.rows[0];

  const pRes = await pool.query(
    `SELECT *
       FROM planos_cliente
      WHERE telefone=$1
      ORDER BY (status='active') DESC, criado_em DESC
      LIMIT 1`,
    [tel]
  );
  const p = pRes.rowCount ? pRes.rows[0] : null;

  const dRes = await pool.query(
    `SELECT posicao, tipo, marca, mac, mac_maiusculo, aplicativo
       FROM dispositivos
      WHERE telefone=$1
      ORDER BY posicao ASC`,
    [tel]
  );

  return {
    phone: c.telefone,
    firstName: c.nome || '',
    lastName: c.sobrenome || '',
    bairro: c.bairro || '',
    plan: p ? (() => {
      const screensCount = toNumber(p.qtde_telas);
      let durationDays = toNumber(p.dias_duracao);
      let durationLabel = p.rotulo_duracao || null;

      // Se não tiver label/dias gravados (caso de planos criados via Admin), calcula pelos campos de data
      if ((!durationLabel || !durationDays) && p.inicio_em && p.fim_em) {
        const dStart = new Date(p.inicio_em);
        const dEnd = new Date(p.fim_em);
        const diffMs = dEnd.setHours(0,0,0,0) - dStart.setHours(0,0,0,0);
        const calcDays = Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
        durationDays = durationDays || calcDays;

        // Mapeia durações comuns para rótulos amigáveis
        if (calcDays >= 28 && calcDays <= 32) durationLabel = '1 mês';
        else if (calcDays >= 88 && calcDays <= 92) durationLabel = '3 meses';
        else if (calcDays >= 178 && calcDays <= 182) durationLabel = '6 meses';
        else if (calcDays >= 360 && calcDays <= 370) durationLabel = '12 meses';
        else durationLabel = `${calcDays} dias`;
      }

      return {
        planType: p.tipo_plano || null,
        screensCount,
        durationLabel,
        durationDays,
        price: p.preco != null ? Number(p.preco) : null,
        activationFee: p.taxa_ativacao != null ? Number(p.taxa_ativacao) : 0,
        totalPrice: p.preco_total != null ? Number(p.preco_total) : null
      };
    })() : null,
    startDate: toDate(p?.inicio_em),
    endDate: toDate(p?.fim_em),
    status: p?.status || null,
    devices: dRes.rows.map(r => ({
      slot: Number(r.posicao),
      type: r.tipo,
      brand: r.marca || null,
      mac: r.mac || null,
      macUpper: r.mac_maiusculo || null,
      app: r.aplicativo || null
    }))
  };
}