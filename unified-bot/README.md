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

## Executar
Instalar dependências no diretório `unified-bot`:
```
npm install
npm start
```
