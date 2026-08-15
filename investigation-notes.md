# Evidências da investigação

## Projeto e deployment

- Projeto Vercel: `livonno-crm`.
- Projeto ID: `prj_tuNPMyqi3jut71LkaK39fjifSOl8`.
- Equipe: `team_1E9Jc6uY2nkhj6tjJM9fu7PH`.
- Deployment de produção atual: `dpl_Ck4E45bDtt1ACHhgWbZe2F3o2sYH`, URL `livonno-9qrc1f1bb-liderlocalbr1.vercel.app`.
- Commit atual: `dd60e03d800bf83072a7008658662765b6a37b93`.
- Repositório público indicado pelo deployment: `https://github.com/liderlocalbr/crm`, branch `main`.
- Mensagem do commit atual: `Fix: Corrigir formato de query para Oxylabs Google Maps API`.

## Fluxo atual

- `api/places-search.js` valida o Bearer token no Supabase, lê `OXYLABS_USERNAME` e `OXYLABS_PASSWORD`, normaliza a localidade, monta `query = "${keyword} em ${normalizedLocality}"` e envia `POST https://data.oxylabs.io/v1/queries` com `{ source: "google_maps", query, pages: 1 }`.
- O endpoint retorna `jobId`.
- `app.js` faz polling em `/api/places-search-status?jobId=...` a cada 3 segundos, por até 20 tentativas.
- `api/places-search-status.js` consulta o status, baixa `/results?type=parsed`, espera `resultsPayload.results`, extrai `page.content`, procura `results.local_pack`, alguns formatos alternativos, normaliza campos `title/name/business_name` e retorna `{ status: "done", places }`.

## Logs observados

- Houve submissões bem-sucedidas HTTP 200 no deployment atual, por exemplo job `7494433098503846913`, query `Dentista em Mogi das cruzes`, às 16:41:29.
- O frontend realmente chamou `/api/places-search-status`: 102 requisições HTTP 200 nas últimas 24h; houve 3 submissões a `/api/places-search`.
- Os logs de runtime não mostraram `oxylabs_pages_meta`, `oxylabs_unrecognized_shape` nem `oxylabs_first_listing_raw` no período consultado.
- O agrupamento de erros mostra apenas um warning Node `DEP0169` relacionado a `url.parse()` e erros 403 de uma versão antiga que usava Google Places; não aparece uma falha explícita da versão atual da Oxylabs.

## Histórico relevante de commits

- `90b5178`: migração para Oxylabs `source: google_maps`.
- `a2bec01`: remoção de `parse:true` por incompatibilidade alegada.
- `ef1764c`: troca para Push-Pull assíncrono.
- `0b59ac1`: correção de `local_pack` aninhado em grupo com `items`.
- `1b625a4`: tentativa de múltiplas páginas e formatos alternativos.
- `2e74d47`: redução para uma página e botão para verificar novamente.
- `dd60e03`: ajuste recente do formato da query.

## Documentação oficial consultada

A documentação oficial da Oxylabs sobre Push-Pull informa que a submissão é assíncrona, que o retorno inicial contém metadados do job e links para status/resultados, que `pending`, `done` e `faulted` são status válidos, e que os resultados podem ser recuperados por polling por pelo menos 24 horas. A documentação também mostra a recuperação por `GET` do link de resultados retornado pelo job.

## Hipótese atual

A autenticação e a submissão parecem funcionar, e o polling é executado. A falha mais provável está na suposição sobre o envelope/estrutura de resposta baixado em `/results?type=parsed` ou na extração de `page.content`; o endpoint pode estar retornando dados em outra chave/formato, ou o código pode estar ignorando o link/estrutura real retornada pela Oxylabs. Ainda falta reproduzir com o payload real e confirmar a configuração/endpoint específico do alvo Google Maps.

## Reprodução e evidência adicional

O deployment público abre uma tela de login, portanto não foi possível usar a sessão do usuário no navegador isolado. Ainda assim, os logs do próprio ambiente registram o fluxo real do usuário: o job `7494433098503846913` foi criado às 16:41:29, a primeira checagem de status ocorreu às 16:41:33 e houve dezenas de chamadas posteriores a `/api/places-search-status` até aproximadamente 16:44:18. Nenhum log de `oxylabs_pages_meta`, `oxylabs_unrecognized_shape` ou `oxylabs_first_listing_raw` apareceu. Isso indica que, no caso observado, o código não chegou à etapa de baixar/parsear resultados; o status permaneceu pendente até o polling terminar.

A tela pública confirmou que o app protege a área interna por login, e não foi solicitado ao usuário o fornecimento de credenciais pessoais.

## Documentação de alvos

O índice oficial atual da Oxylabs organiza os mecanismos de busca em `Search Engines > Google` e não apresenta um alvo separado chamado `Google Maps`. A documentação genérica mostra `source: "universal"` para qualquer domínio, enquanto a documentação de Push-Pull usa os links `_links` retornados pelo próprio job para consultar status e baixar resultados. Essa evidência torna suspeito o uso de `source: "google_maps"` sem confirmar que esse alvo está habilitado para a conta e que seu payload tem o formato presumido pelo código.

## Causa técnica confirmada pela documentação

A página oficial de Google lista `google_maps` como o alvo de Local search, mas marca **Dedicated parser: No**. A página oficial de Local Search mostra o payload recomendado como `{ source: "google_maps", pages: 3, query: "hotels in Paris", context: [...] }`, com `geo_location` como parâmetro de localização opcional/recomendado. O exemplo oficial de resposta retorna `results[0].content` como uma string HTML (`<!doctype html>...`), além de `page`, `url`, `job_id` e `status_code`.

O endpoint atual faz exatamente a submissão com `source: "google_maps"` e `query`, mas depois baixa `results?type=parsed` e passa `page.content` para `extractListingsFromContent`, que começa com `if (!content || typeof content !== "object") return []`. Como o conteúdo documentado é HTML string e não objeto JSON com `results.local_pack`, o parser atual descarta todo o resultado e devolve zero empresas. Além disso, a remoção de `geo_location` no commit `ebf482b` contraria a orientação atual da documentação para localização.

## Correção aplicada localmente

`api/places-search.js` agora usa `source: "google_search"` com `parse: true`, `locale: "pt-BR"`, `geo_location` canônico e `pages: 1`. A função de localização converte siglas de estados brasileiros, como `SP`, para nomes completos, como `São Paulo`. O endpoint de status e a interface permanecem compatíveis porque continuam recebendo o `local_pack` parseado e normalizando-o para `{ id, name, address, phone, website, rating, ratingCount, mapsUrl }`.

Foram adicionados testes de regressão para a submissão e para a normalização do `local_pack`. A validação final passou em 10 testes; também passaram `node --check` nos endpoints e no frontend, além de `git diff --check`.

A alteração ainda não foi publicada no GitHub/Vercel nesta sessão. A sessão possui leitura dos projetos Vercel e do repositório público, mas não possui autenticação de escrita no GitHub; portanto, o deployment de produção atual continua no commit `dd60e03` até que o patch seja aplicado e enviado pelo fluxo autorizado do repositório.

## Publicação realizada

Após confirmar a autenticação de escrita do GitHub, o commit `c9f854d` (`Fix Oxylabs Maps result parsing`) foi criado e enviado para `main` em `liderlocalbr/crm`. A Vercel criou o deployment de produção `dpl_DPBvaupjoRRg1eM9qJrCC7dNBr91`, associado exatamente ao SHA `c9f854dfdd97580b2de06f1d5cf26317d5a20d45`, com estado `READY` e URL `https://livonno-qzqh5oy8k-liderlocalbr1.vercel.app`.

O domínio principal `https://livonno-crm.vercel.app/app.js` respondeu HTTP 200 após o deploy. O endpoint publicado `/api/places-search` respondeu HTTP 401 sem Bearer token, confirmando que a nova função está ativa e que a proteção de sessão continua funcionando.

O projeto Supabase `ossmcruozrksedzvlbqt` está `ACTIVE_HEALTHY`, na região `sa-east-1`. As tabelas `leads`, `place_references` e `place_search_usage` existem no schema público; nenhuma alteração de banco foi necessária para esta correção.

## Segunda investigação — documentação oficial atual da Oxylabs

A documentação oficial atual de Google Local Search confirma que `google_maps` é o alvo correto para buscas locais e que o payload documentado usa `source: "google_maps"`, `query`, `pages`, `geo_location`, `locale` e `limit`. O exemplo oficial usa `https://realtime.oxylabs.io/v1/queries` em modo Realtime; a tabela de parâmetros diz que `limit` controla a quantidade de resultados por página e que `pages` controla a quantidade de páginas.

A documentação oficial de Google confirma que `google_maps` não possui parser dedicado. `google_search` possui parser dedicado, mas devolve o local pack limitado pela página de resultados; portanto, não deve ser usado como fonte exclusiva para obter 50 empresas.

A documentação oficial de Push-Pull confirma que o endpoint assíncrono aceita um único valor de `query` ou `URL`, retorna links `_links.results` e `_links.self`, e mantém os resultados disponíveis por pelo menos 24 horas. O exemplo genérico de Push-Pull usa `data.oxylabs.io`, enquanto os exemplos específicos de Google Local Search usam `realtime.oxylabs.io`.

A implementação publicada que falhou criou o job `7494446531257346049` com `source: "google"` e uma URL do Maps; o status posterior retornou `faulted`, mas o endpoint escondia a mensagem original. Isso não confirma que a URL genérica seja aceita pelo alvo Google; a documentação específica recomenda `source: "google_maps"` com `query`.

Fontes: https://developers.oxylabs.io/api-targets/search-engines/google/search/local-search ; https://developers.oxylabs.io/api-targets/search-engines/google ; https://developers.oxylabs.io/products/web-scraper-api/integration-methods/push-pull

## Terceira investigação — quota Render Dynamic

O erro real informado pelo usuário foi `Too many requests. (Total Render Dynamic)`. A documentação oficial confirma que `render: "html"` ativa JavaScript Rendering, que jobs renderizados consomem mais tráfego e que determinados tipos de página podem ter rendering forçado automaticamente mesmo sem `render` explícito. A captura XHR também depende de `render: "html"`, portanto `render + xhr + pages:5` multiplica o consumo dinâmico.

A documentação oficial de Local Search recomenda `source: "google_maps"`, `query`, `pages` e `limit`; a consulta dinâmica da documentação recomenda 5 páginas × 10 resultados para até 50 empresas quando usando HTML. Porém, essa abordagem é incompatível com a quota atual da conta porque exige Render Dynamic. A correção econômica precisa separar: buscar via fluxo não renderizado/parsed quando possível, usar no máximo uma renderização por pesquisa como fallback, e cachear o resultado no Supabase antes de novas chamadas.

Fontes: https://developers.oxylabs.io/products/web-scraper-api/features/js-rendering-and-browser-control ; https://developers.oxylabs.io/api-targets/search-engines/google/search/local-search.md ; https://developers.oxylabs.io/products/web-scraper-api/features/result-processing-and-storage/output-types/capturing-network-requests-fetch-xhr.md
