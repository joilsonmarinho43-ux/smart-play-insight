# NEXUS 33 — Research Evidence Layer — 2026-09-15

## Objetivo
Complementar APIs gratuitas com pesquisa web da IA sem transformar ausência de dado em dado inventado.

## Regra de proveniência
Todo fato complementar deve carregar:
- `sourceType`: `API | WEB | MODEL | MARKET`
- `sourceName`
- `sourceUrl` quando disponível
- `observedAt`
- `observed`
- `estimated`
- `confidence`
- `type`
- `claim`

## O que a pesquisa pode complementar
Lesões, suspensões, escalações, forma publicada, H2H publicado, contexto competitivo, árbitro e clima, desde que exista fonte verificável.

## O que a pesquisa NÃO pode inventar
- probabilidade do modelo;
- xG não publicado como se fosse observado;
- estatística ausente;
- odd de mercado;
- EV.

Valores numéricos produzidos pelo motor continuam sendo `MODEL_ESTIMATE`. Uma odd só é considerada observada quando a origem é explicitamente `MARKET`, não estimada, com timestamp e fonte.

## Integração com o Decision Core
`decideNexus()` agora aceita `researchEvidence` e transforma somente evidências observadas e não estimadas em evidência auxiliar. A pesquisa pode aumentar a qualidade contextual, mas não altera diretamente a probabilidade do mercado nem pode promover um sinal sozinha.

O gate de sinal permanece exigindo `MODEL_ESTIMATE`, `CALIBRATED`, odd observada válida e demais critérios do Core.

## Próxima integração operacional
`match-context` deve entregar ao chamador a proveniência dos campos disponíveis. `match-analyst` pode usar `pesquisaWeb=true` para buscar somente os campos indisponíveis, devolver evidências com fonte/data e deixar ausente aquilo que não puder ser confirmado.

## Mercado
Não há fallback circular. Se nenhuma fonte real publicar a odd atual do mercado/linha correta, o NEXUS não calcula EV observado e o scanner permanece sem sinal.
