# Pesquisa de feeds e projetos públicos — 2026-09-28

Objetivo: alimentar WIN, WDO, Nasdaq e Ouro com barras verificáveis e recentes, sem corretora e sem envio de ordens. Código aberto não equivale a dados de bolsa abertos.

| Projeto/fonte | Achado | Decisão |
| --- | --- | --- |
| [diogojrdev/profitdll-wrapper](https://github.com/diogojrdev/profitdll-wrapper) | Wrapper MIT de código para a ProfitDLL; a DLL proprietária não é fornecida. | Não usar: requer licença Nelogica e conexão à plataforma, fora do escopo desejado. |
| [nicksauro/data-downloader](https://github.com/nicksauro/data-downloader) | Baixa histórico WIN/WDO usando chave ProfitDLL e credenciais Profit em Windows. | Útil como referência de histórico, sem feed independente gratuito. |
| [hit25082000/Plataforma-Quantitativa](https://github.com/hit25082000/Plataforma-Quantitativa) | Distribui fluxo da ProfitDLL por ZeroMQ/WebSocket. | A camada de transporte é aberta, mas o dado de origem continua exigindo ProfitDLL. |
| [barchart/marketdata-api-js](https://github.com/barchart/marketdata-api-js) | SDK de streaming para serviço Barchart; README informa protocolo antigo em descontinuação. | SDK não concede assinatura de dados nem comprova cobertura B3 dos minis. |
| [brapi.dev](https://brapi.dev/faq/qual-a-frequencia) | A própria FAQ informa atraso aproximado de 30 min no plano gratuito, 15 min no Startup e 5 min no Pro. | Inadequado para entrada de 1 minuto, mesmo quando WIN/WDO são consultáveis sem token. |
| [Cedro Market Data](https://cedrotech.com/market-apis/api-websocket/) | Streaming B3; teste anunciado por 7 dias com documentação e credenciais após solicitação. | Candidato para B3, sujeito a acesso e validação de feed real time. |
| [CME Real-Time Futures API](https://www.cmegroup.com/market-data/real-time-futures-and-options-data-api.html) | WebSocket CME/COMEX; assinatura e onboarding no portal. | Candidato para futuros americanos, condicionado ao instrumento correspondente. |

Não reutilizar token encontrado em repositório público, scraping de interface privada ou dado atrasado apresentado como tempo real. O serviço mantém `SEM_ENTRADA` quando não recebe fonte autorizada recente. Antes de operar, confirmar se Nasdaq e Ouro na plataforma do usuário são os mesmos contratos do feed escolhido; dados de futuro não representam necessariamente o preço de um CFD.
