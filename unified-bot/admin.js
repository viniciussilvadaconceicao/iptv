#!/usr/bin/env node
import 'dotenv/config';
import { URL } from 'url';

import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import { Adapter, Database, Resource } from '@adminjs/sql';
import ConnectPgSimple from 'connect-pg-simple';
import express from 'express';
import session from 'express-session';
import { Pool } from 'pg';

const PORT = Number(process.env.ADMINJS_PORT || 3030);
const ROOT_PATH = process.env.ADMINJS_ROOT_PATH || '/admin';
const DATABASE_URL = process.env.DATABASE_URL || process.env.PGURL;
const ADMIN_EMAIL = process.env.ADMINJS_EMAIL || 'admin@local';
const ADMIN_PASSWORD = process.env.ADMINJS_PASSWORD || 'troque-essa-senha';
const COOKIE_SECRET = process.env.ADMINJS_COOKIE_SECRET || 'troque-essa-chave-forte';

if (!DATABASE_URL) {
  throw new Error('Defina DATABASE_URL ou PGURL no .env para iniciar o painel AdminJS.');
}

AdminJS.registerAdapter({
  Database,
  Resource,
});

async function attachClienteNomeToRequest(request) {
  try {
    const telefone = request?.payload?.telefone;
    if (!telefone) return request;

    const pool = new Pool({ connectionString: DATABASE_URL });
    const res = await pool.query('SELECT nome, sobrenome FROM clientes WHERE telefone = $1', [telefone]);
    await pool.end();

    if (res.rowCount) {
      const { nome, sobrenome } = res.rows[0];
      const fullName = `${nome || ''} ${sobrenome || ''}`.trim();
      return {
        ...request,
        payload: {
          ...request.payload,
          cliente_nome: fullName || null,
        },
      };
    }
  } catch (error) {
    console.warn('[AdminJS] Falha ao preencher cliente_nome em dispositivos:', error?.message || error);
  }
  return request;
}

async function ensureVencimentosView() {
  try {
    const pool = new Pool({ connectionString: DATABASE_URL });
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
    await pool.end();
  } catch (error) {
    console.warn('[AdminJS] Não foi possível criar/atualizar view vw_vencimentos:', error?.message || error);
  }
}

async function ensureDispositivosHasAplicativo() {
  try {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS aplicativo TEXT');
    await pool.query('ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS cliente_nome TEXT');
    // Preenche/atualiza o nome do cliente em todos os dispositivos com base na tabela clientes
    await pool.query(`
      UPDATE dispositivos d
         SET cliente_nome = CONCAT(c.nome, ' ', c.sobrenome)
        FROM clientes c
       WHERE d.telefone = c.telefone;
    `);
    await pool.end();
  } catch (error) {
    console.warn('[AdminJS] Não foi possível garantir coluna aplicativo em dispositivos:', error?.message || error);
  }
}

async function ensurePlanosClienteHasClienteNome() {
  try {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('ALTER TABLE planos_cliente ADD COLUMN IF NOT EXISTS cliente_nome TEXT');
    await pool.query(`
      UPDATE planos_cliente p
         SET cliente_nome = CONCAT(c.nome, ' ', c.sobrenome)
        FROM clientes c
       WHERE p.telefone = c.telefone;
    `);
    await pool.end();
  } catch (error) {
    console.warn('[AdminJS] Não foi possível garantir coluna cliente_nome em planos_cliente:', error?.message || error);
  }
}

function getDatabaseName(connectionString) {
  const url = new URL(connectionString);
  return url.pathname.replace(/^\//, '');
}

function buildResourceOptions() {
  return {
    clientes: {
      navigation: { name: 'Cadastro', icon: 'User' },
      sort: { sortBy: 'criado_em', direction: 'desc' },
      listProperties: ['telefone', 'nome', 'sobrenome', 'bairro', 'criado_em'],
      editProperties: ['telefone', 'nome', 'sobrenome', 'bairro'],
      showProperties: ['telefone', 'nome', 'sobrenome', 'bairro', 'criado_em'],
      properties: {
        // Usa o TELEFONE como título principal do registro (para aparecer nos selects)
        nome: {
          isTitle: false,
          isRequired: true,
          isVisible: { list: true, filter: true, show: true, edit: true },
        },
        sobrenome: {
          isRequired: true,
          isVisible: { list: true, filter: true, show: true, edit: true },
        },
        telefone: {
          isTitle: true,
          isRequired: true,
          isVisible: { list: true, filter: true, show: true, edit: true },
        },
        bairro: {
          isVisible: { list: true, filter: true, show: true, edit: true },
        },
        criado_em: { isVisible: { list: true, filter: true, show: true, edit: false } },
      },
    },
    dispositivos: {
      navigation: { name: 'Cadastro', icon: 'Monitor' },
      sort: { sortBy: 'id', direction: 'desc' },
      listProperties: ['cliente_nome', 'telefone', 'posicao', 'tipo', 'marca', 'aplicativo', 'mac', 'criado_em'],
      editProperties: ['telefone', 'posicao', 'tipo', 'marca', 'aplicativo', 'mac'],
      showProperties: ['cliente_nome', 'telefone', 'posicao', 'tipo', 'marca', 'aplicativo', 'mac', 'criado_em'],
      properties: {
        cliente_nome: {
          label: 'Cliente',
          isVisible: { list: true, filter: true, show: true, edit: false },
        },
        telefone: { label: 'Telefone' },
        posicao: { label: 'Quantidade de telas' },
        tipo: {
          label: 'Tipo',
          availableValues: [
            { value: 'TV Smart', label: 'TV Smart' },
            { value: 'TV Box', label: 'TV Box' },
            { value: 'Fire TV Stick', label: 'Fire TV Stick' },
            { value: 'Chromecast', label: 'Chromecast' },
            { value: 'Celular Android', label: 'Celular Android' },
            { value: 'Tablet Android', label: 'Tablet Android' },
            { value: 'PC', label: 'PC' },
          ],
        },
        marca: { label: 'Marca' },
        aplicativo: { label: 'Aplicativo' },
        mac: { label: 'MAC', isRequired: false },
        mac_maiusculo: { isVisible: false },
        criado_em: { isVisible: { list: true, filter: true, show: true, edit: false } },
      },
      actions: {
        new: {
          before: attachClienteNomeToRequest,
        },
        edit: {
          before: attachClienteNomeToRequest,
        },
      },
    },
    planos_cliente: {
      navigation: { name: 'Assinaturas', icon: 'Currency' },
      sort: { sortBy: 'criado_em', direction: 'desc' },
      listProperties: ['cliente_nome', 'telefone', 'status', 'inicio_em', 'fim_em'],
      showProperties: ['cliente_nome', 'telefone', 'tipo_plano', 'rotulo_duracao', 'status', 'inicio_em', 'fim_em', 'criado_em'],
      filterProperties: ['telefone', 'cliente_nome', 'status'],
      properties: {
        cliente_nome: {
          label: 'Cliente',
          isVisible: { list: true, filter: true, show: true, edit: false },
        },
        telefone: {
          label: 'Telefone',
        },
        rotulo_duracao: { isVisible: { list: false, filter: false, show: false, edit: false } },
        dias_duracao: { isVisible: { list: false, filter: false, show: false, edit: false } },
        status: {
          availableValues: [
            { value: 'active', label: 'Ativo' },
            { value: 'expired', label: 'Expirado' },
            { value: 'cancelled', label: 'Cancelado' },
            { value: 'pending', label: 'Pendente' },
          ],
        },
        criado_em: { isVisible: { list: true, filter: true, show: true, edit: false } },
        inicio_em: { isVisible: { list: true, filter: true, show: true, edit: true } },
        fim_em: { isVisible: { list: true, filter: true, show: true, edit: true } },
      },
      actions: {
        new: {
          before: attachClienteNomeToRequest,
        },
        edit: {
          before: attachClienteNomeToRequest,
        },
      },
    },
  };
}

async function buildAdmin() {
  // Garante que a coluna "aplicativo" exista antes de o AdminJS manipular dispositivos
  await ensureDispositivosHasAplicativo();
  // Garante que a coluna cliente_nome exista e esteja preenchida em planos_cliente
  await ensurePlanosClienteHasClienteNome();

  const db = await new Adapter('postgresql', {
    connectionString: DATABASE_URL,
    database: getDatabaseName(DATABASE_URL),
  }).init();

  const options = buildResourceOptions();

  return new AdminJS({
    rootPath: ROOT_PATH,
    branding: {
      companyName: 'ViniOnTV - Painel Administrativo',
      withMadeWithLove: false,
    },
    resources: [
      {
        resource: db.table('clientes'),
        options: options.clientes,
      },
      {
        resource: db.table('dispositivos'),
        options: options.dispositivos,
      },
      {
        resource: db.table('planos_cliente'),
        options: options.planos_cliente,
      },
    ],
    locale: {
      language: 'pt-BR',
      translations: {
        labels: {
          clientes: 'Clientes',
          dispositivos: 'Dispositivos',
          planos_cliente: 'Planos do Cliente',
        },
        resources: {
          dispositivos: {
            properties: {
              posicao: 'Quantidade de telas',
            },
          },
        },
      },
    },
  });
}

async function startAdminServer() {
  const app = express();
  const admin = await buildAdmin();

  const ConnectSession = ConnectPgSimple(session);
  const sessionStore = new ConnectSession({
    conString: DATABASE_URL,
    tableName: 'adminjs_sessions',
    createTableIfMissing: true,
  });

  const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email, password) => {
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          return { email };
        }
        return null;
      },
      cookieName: 'bot-iptv-admin',
      cookiePassword: COOKIE_SECRET,
    },
    null,
    {
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      secret: COOKIE_SECRET,
      name: 'bot-iptv-admin',
      cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
      },
    }
  );

  app.get('/', (_req, res) => {
    res.redirect(ROOT_PATH);
  });

  app.use(admin.options.rootPath, adminRouter);

  const server = app.listen(PORT, () => {
    console.log(`[AdminJS] Painel iniciado em http://localhost:${PORT}${admin.options.rootPath}`);
    console.log(`[AdminJS] Login: ${ADMIN_EMAIL}`);
    if (ADMIN_PASSWORD === 'troque-essa-senha') {
      console.log('[AdminJS] Atenção: altere ADMINJS_PASSWORD no .env antes de expor este painel.');
    }
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(
        `[AdminJS] A porta ${PORT} já está em uso. Se o painel já estiver aberto, acesse http://localhost:${PORT}${admin.options.rootPath}`
      );
      process.exit(1);
    }

    console.error('[AdminJS] Falha ao subir servidor HTTP:', error?.message || error);
    process.exit(1);
  });
}

startAdminServer().catch((error) => {
  console.error('[AdminJS] Falha ao iniciar painel:', error?.message || error);
  process.exit(1);
});