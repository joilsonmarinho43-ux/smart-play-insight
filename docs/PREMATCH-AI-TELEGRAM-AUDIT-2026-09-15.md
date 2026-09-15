# NEXUS 33 — Auditoria pré-jogo, IA e Telegram — 2026-09-15

## Objetivo
Reduzir REDs no pré-jogo sem permitir que a IA invente probabilidade ou aumente confiança.

## Fluxo auditado
Dados → contexto pré-jogo → motor quantitativo → leitura pré-jogo → IA auditora → Nexus Core → Prediction Ledger → Telegram.

## Problemas encontrados
1. A leitura pré-jogo era quantitativa, mas a IA era principalmente narrativa e não possuía uma saída estruturada de auditoria.
2. A pesquisa web era acionada apenas quando não existia reading, deixando casos com reading porém contexto incompleto sem verificação adicional.
3. O contexto marcava fadiga com base em objeto existente; isso foi corrigido anteriormente para exigir histórico real.
4. Lesões/desfalques eram permanentemente `unavailable` no match-context.
5. O Core podia chegar à decisão com mercado sem odd real observada, criando risco de confundir probabilidade do modelo com valor de mercado.
6. `telegram-signal` estava desativado para evitar caminho paralelo, mas não havia ainda um publisher downstream ligado ao Core + Ledger.
7. A calibração podia ser perdida no adapter pré-jogo quando o status vinha de `match.predictions`.
8. Dependência de build `lovable-tagger` permanecia no package.json embora Lovable não fosse mais parte da arquitetura operacional.

## Melhorias implementadas
### IA pré-jogo
- `match-analyst` v11 agora produz `aiAudit`:
  - `PASS`
  - `CAUTION`
  - `BLOCK`
- A IA é veto-only: nunca promove sinal e nunca cria probabilidade.
- `BLOCK` exige contradição crítica explícita; ausência comum vira `CAUTION`.
- Pesquisa web é usada para jogos sem dados suficientes, contexto incompleto ou até 2h do kickoff.
- Pesquisa permanece condicionada a Gemini + Google Search; modo normal usa Groq e Gemini Flash.
- Lovable AI Gateway foi removido.

### Contexto
- `match-context` v3 tenta buscar injuries além de lineups, odds, standing e h2h.
- Confiabilidade passa a considerar injuries como evidência adicional.
- Warnings explícitos para escalação esperada ausente, odds ausentes, fadiga ausente e injuries ausentes.

### Nexus Core
- Sinal pré-jogo exige simultaneamente:
  - mercado `MODEL_ESTIMATE`;
  - probabilidade `CALIBRATED`;
  - confiança mínima do Core;
  - qualidade de dados válida;
  - ausência de conflito de engine;
  - odd real observada > 1.
- Sem odd real, o resultado é `CONSERVATIVE`, não `SIGNAL`.
- Mercados heurísticos/unknown não podem ser selecionados como sinal.

### Prediction Ledger
- Recorder pré-jogo passa pelo contexto, leitura e auditoria IA antes de persistir.
- A auditoria IA só pode bloquear; indisponibilidade da IA não promove o sinal.
- Modelo atualizado para `poisson-xg-bayes-v2-red-hardening`.

### Telegram
- `telegram-signal` deixou de ser um gerador independente.
- Só publica quando recebe decisão `SIGNAL` já aprovada pelo Core, mercado calibrado e odd observada.
- Registra primeiro em `telegram_signals` e só então envia.
- Falha de envio vai para `telegram_outbox`.
- O Telegram não calcula probabilidade, EV ou confiança.

### Dependência
- `lovable-tagger` removido do `package.json`.

## Próxima etapa obrigatória
A implementação estrutural reduz caminhos de RED, mas ainda precisamos medir o histórico real. O próximo relatório deve calcular:
- Brier Score;
- Log Loss;
- curva de calibração;
- RED por mercado;
- RED por faixa de probabilidade;
- RED por faixa de confiança;
- RED por liga;
- RED por janela de minuto para sinais live;
- pré-jogo vs live;
- DA real vs estimado;
- odd real e CLV quando disponível;
- desempenho da IA `PASS/CAUTION/BLOCK`.

Nenhuma regra nova de corte deve ser criada a partir de amostra pequena; o objetivo é aprender com dados resolvidos e evitar overfitting.
