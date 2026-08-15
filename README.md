# Agência Líder Local CRM

CRM de prospecção da **Agência Líder Local**, baseado na planilha de métricas comerciais. Reúne pipeline de leads, registro diário, agenda de follow-ups, metas encadeadas e dashboard de conversão.

## Funcionalidades

- Autenticação por e-mail e senha com Supabase Auth
- Isolamento dos dados por usuário com Row Level Security (RLS)
- Pipeline configurável: adicionar, renomear e excluir etapas, além de movimentar cards por arrastar e soltar
- Cadastro e edição de leads, valor potencial e próximo follow-up
- Agenda de ligações, WhatsApp, reuniões, e-mails e tarefas com conexão OAuth e criação pela API do Google Agenda
- Registro diário por mês e resumo de receita
- Metas mensais recalculadas automaticamente a partir das taxas de conversão
- Dashboard ampliado com metas versus realizado, taxas reais e relógio/clima compactos ao lado da saudação
- Interface responsiva para desktop e celular

## Projeção inicial

| Etapa | Meta |
|---|---:|
| Leads | 1.650 |
| Mensagens (90%) | 1.485 |
| Reuniões agendadas (2%) | 30 |
| Reuniões realizadas (40%) | 12 |
| Negociações (70%) | 8 |
| Vendas (35%) | 3 |
| Receita (R$ 3.000 por venda) | R$ 9.000 |

## Desenvolvimento

O projeto é uma aplicação web sem etapa de compilação. Para executar localmente:

```bash
npm run dev
```

Abra `http://localhost:4173`. Para visualizar dados de demonstração apenas no ambiente local, use `http://localhost:4173/?demo=1`.

Validações de lógica:

```bash
npm test
npm run check
```

## Banco de dados

O schema está versionado na pasta `supabase/migrations`. A aplicação usa apenas a chave publicável do Supabase no navegador; nenhuma chave administrativa é exposta.
