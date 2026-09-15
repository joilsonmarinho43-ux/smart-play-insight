# NEXUS 33 — Red Hardening 2026-09-15

## Objetivo
Reduzir falsos positivos nas análises ao vivo sem aumentar artificialmente a confiança do modelo.

## Alterações implementadas

### 1. IA
- Removido o fallback legado do Lovable AI Gateway.
- Fluxo normal: Groq -> Gemini 2.5 Flash -> safe fallback.
- Pesquisa: Gemini 2.5 Pro + Google Search.
- Versão do cache do `match-analyst` elevada para `v10` para invalidar resultados antigos.

### 2. RMA
- DA estimado não pode sustentar sinal sozinho.
- Exigência maior de finalizações reais/SoG quando DA é estimado.
- Penalização adicional para amostras muito precoces.
- Limiar de confirmação elevado de `>40` para `>=55`.
- Bloqueio de pressão elevada com pouco SoG.

### 3. Projeção de gols
- DA desconhecido passa a ser tratado como estimado por padrão.
- Peso do DA estimado reduzido.
- Peso de escanteios reduzido.
- Peso máximo da evidência ao vivo reduzido para evitar extrapolação agressiva.
- Limite superior conservador na taxa de xG/min.
- Incluído `evidenceQuality`.

### 4. Contexto
- Corrigido bug em que `fatigue.home`/`fatigue.away` eram objetos truthy mesmo sem dados, fazendo o `reliabilityScore` contar fadiga inexistente.
- Fadiga agora só conta como evidência quando há timestamps válidos.
- Novo warning `fatigue_unavailable`.

### 5. Testes
- Adicionados testes unitários para os novos bloqueios do RMA.

## Próxima etapa obrigatória
Antes de elevar novamente o volume de sinais, comparar o histórico de sinais contra resultados reais e medir:

- Brier Score;
- Log Loss;
- calibração por faixa de probabilidade;
- taxa de RED por mercado;
- RED por minuto de entrada;
- RED com DA real vs estimado;
- RED por liga;
- RED por mercado;
- CLV quando houver odd real observada.

O objetivo desta fase é **reduzir falsos positivos**, não prometer uma taxa de acerto fixa.
