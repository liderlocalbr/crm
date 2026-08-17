# Investigação da busca de desentupidoras em Campinas

Fonte externa: https://vercel.com/crzap-vercel/livonno-crm
Fonte de logs: https://vercel.com/crzap-vercel/livonno-crm/logs
Data da consulta: 17/08/2026.

O painel do Vercel confirmou que o projeto `livonno-crm` está no escopo `crzap-vercel`, com deployment de produção Ready baseado no commit `726e249` (`feat: increase maps prospecting limit to 200`). O deployment exibido pelo painel é `dpl_CaRFuSmXZWRUuSEVDJRJVgDBidYx`, com domínio de produção `crzap.agencialiderlocar.com.br`.

Na visão de Logs, o intervalo padrão estava em `Last 30 minutes`, com filtros de nível mostrando 2 erros, 0 warnings e 0 fatals. A timeline ainda estava carregando e não exibiu mensagens detalhadas no conteúdo extraído. O escopo correto do time visto no HTML foi `team_uv6kNPLUFLO0JHzgGoSzLNe7`, mas a chamada MCP de listagem de projetos retornou erro nesse escopo; a investigação continuará pelo painel autenticado e/ou pelos endpoints de logs disponíveis.

## Evidência encontrada nos logs

Na timeline do Vercel, com intervalo `Last 30 minutes`, apareceu a chamada de 17/08/2026 às 11:49:12.83:

`GET 200 /api/places-search serper_maps_done {"query":"Desentupidora, Campinas - SP","batch":1,"count":1,"requestedCenter":"@-22.687853,-47.072126,12z","responseCenter":"@-22.788457,-47.2908393,18.0536z"}`

O lote inicial não apareceu com mensagem detalhada na extração, mas a soma observada no CRM foi 21, coerente com 20 resultados no lote 0 e somente 1 no lote 1. O endpoint devolve `hasMore: false` quando um lote tem menos de 20 itens; o front então encerra a paginação e oculta o botão. Portanto, o problema não foi o limite de 200: a paginação estava tratando um lote parcial como fim definitivo da cobertura geográfica. Também foi observada uma mudança grande no centro retornado pelo provedor, indicando que a segunda consulta foi uma nova área geográfica, não uma página tradicional do mesmo conjunto.
