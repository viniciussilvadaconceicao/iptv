# Unified BOT IPTV (CLI MVP)

Menu:
1. Novo Usuário
2. Tempo de Assinatura Restante
3. Suporte
4. Pagamento
5. Sair

## Fluxo Cadastro
- Coleta telefone (ID), nome, sobrenome, bairro
- Nº de telas (1 ou 2)
- Escolha de plano conforme nº de telas
- Dispositivos (TV Smart / Celular Android / Tablet Android / PC)
- Se TV Smart: coleta marca + MAC e adiciona taxa de ativação (R$40 por TV)
- Calcula total = plano + taxas
- Grava em `data/db.json`

## Pagamento
- Marca pagamento manualmente (stub para futura integração Pix/MercadoPago)

## Suporte
- Cria tickets simples (assunto, descrição)

## Scheduler
- Avisa no console quando faltam 1 dia ou é o dia de expiração (intervalo de 60s em desenvolvimento)

## Próximos passos sugeridos
- Integração real WhatsApp
- Gateway pagamento
- Notificação push WhatsApp no vencimento
- Logs estruturados e testes automatizados
- Painel web

## Painel administrativo web

Foi adicionado um painel administrativo separado com AdminJS, sem substituir o bot.

### O que ele faz
- login administrativo
- CRUD visual no PostgreSQL
- visualização de clientes, planos e dispositivos
- edição via navegador

### O que ele não faz
- não desliga o bot do WhatsApp
- não apaga o `db.json`
- não altera o fluxo automático já existente

### Variáveis de ambiente do painel
Adicione no `.env` se quiser personalizar:

```env
ADMINJS_EMAIL=admin@local
ADMINJS_PASSWORD=troque-essa-senha
ADMINJS_COOKIE_SECRET=troque-essa-chave
ADMINJS_PORT=3030
ADMINJS_ROOT_PATH=/admin
```

### Executar painel
No diretório `unified-bot`:

```
npm install
npm run admin
```

Depois abra:

```
http://localhost:3030/admin
```

### Executar bot
O bot continua separado:

```
npm start
```

## Executar
Instalar dependências no diretório `unified-bot`:
```
npm install
npm start
```
