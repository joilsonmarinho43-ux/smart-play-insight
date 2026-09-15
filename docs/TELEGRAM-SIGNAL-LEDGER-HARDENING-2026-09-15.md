# Telegram Signal Ledger Hardening — 2026-09-15

## Evidência observada na VPS do NEXUS

A tabela `public.telegram_signals` apresentou:

- 158 registros;
- 56 com `model_probability` e `implied_probability` preenchidos;
- os 56/56 tinham as duas probabilidades iguais;
- 0 registros com `expected_value` preenchido;
- 91 registros com `status = void`.

Isso impede usar esses registros como evidência de uma probabilidade independente do modelo para calibração/valor.

## Causa localizada no código histórico

`daily-correct-score-broadcast` gravava explicitamente:

- `implied_probability = p.scoreProb`;
- `model_probability = p.scoreProb`.

Esse fluxo foi neutralizado na branch de hardening e não deve ser usado para fabricar evidência de probabilidade independente.

## Hardening aplicado

`telegram-signal` agora exige, antes de publicar:

1. decisão aprovada pelo Nexus Core;
2. `MODEL_ESTIMATE` como fonte da probabilidade;
3. `CALIBRATED` como estado de calibração;
4. `oddSource = OBSERVED`;
5. odd decimal real > 1;
6. confiança >= 85;
7. IA diferente de `BLOCK`.

Quando aprovado, o ledger grava separadamente:

- `model_probability`: probabilidade independente do modelo;
- `implied_probability = 100 / odd_observada`;
- `expected_value = (model_probability / 100) * odd_observada - 1`;
- `odd`: odd observada.

## Regra de segurança

Nenhuma odd é fabricada a partir da própria probabilidade do modelo para ser tratada como preço observado.

Até que o produtor do sinal forneça uma odd real com `oddSource = OBSERVED`, o publisher rejeita o sinal no gate downstream.

## Próxima etapa

Integrar o produtor live/pré-jogo à fonte real de odds e passar explicitamente:

`probabilidade NEXUS + odd observada + oddSource=OBSERVED`

Somente depois disso a série nova de `telegram_signals` deve ser usada para Brier, Log Loss, calibração e EV real.
