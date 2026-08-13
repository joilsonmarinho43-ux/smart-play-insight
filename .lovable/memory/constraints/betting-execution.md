---
name: Execução de apostas (Layback/Bolsa de Aposta)
description: Não existe API oficial pública da Layback/Bolsa de Aposta; só modo simulação é permitido até credenciamento oficial
type: constraint
---

Não existe API pública oficial da Bolsa de Aposta / Layback para execução de apostas.
A plataforma é white-label Betfair (BIAB) e a Layback é vendor certificado que consome a
Betfair Exchange API (https://developer.betfair.com/). O caminho oficial possível é o
Software Vendor Program da Betfair Brasil.

**Proibido:** inventar endpoints/tokens, reutilizar cookies de sessão, burlar auth/CAPTCHA, scraping agressivo.

**Arquitetura:** `src/services/bettingExecution/` com interface `BettingProvider`
(MockProvider = simulação; LaybackProvider = placeholder que sempre recusa).
Rota admin `/betting-execution`. Modo `live` só pode ser liberado quando
`provider.supportsRealOrders === true` e houver credenciamento oficial; credenciais
sempre em backend/Edge Function, nunca no frontend.
