# Camada financeira isolada

Rota `/trader` no mesmo login do NEXUS 33, com dados e lógica financeiros separados. Nenhum arquivo do FuneCob ou serviço da VPS é utilizado. Esta entrega não muda o deploy, o banco, as funções esportivas ou as filas existentes.

O painel inicia em **sem cotação atual verificada**. Para conectá-lo, configure `VITE_TRADER_ANALYSIS_URL` apontando para um endpoint HTTPS próprio que entregue um array JSON de snapshots, sem segredos no cliente. O backend do feed deve ter autenticação e proteção de acesso adequadas antes de expor preços licenciados; não publique feeds privados em uma URL aberta. Não inclua chaves de API em variáveis `VITE_`.

Cada item deve trazer `market` (`WIN`, `WDO`, `NASDAQ`, `OURO`), `instrument`, `source`, `bar_end` (ISO 8601 com fuso), `decision` (`CANDIDATA`, `AGUARDAR`, `SEM_ENTRADA`). Para candidata: `direction` (`COMPRA` ou `VENDA`), `reference_entry`, `stop`, `target`, `risk_points`, e opcionalmente `reward_risk`. O cliente bloqueia cotação com mais de 90 segundos, data futura e preço/stop/alvo inválidos; o backend deve bloquear barras atrasadas mais cedo e validar origem/licença, horários e vencimento.

O serviço independente ainda não foi implantado e nenhuma cotação ao vivo está conectada. O motor Python de protótipo anterior pode servir como referência, mas não comprovou vantagem estatística nem deve ser usado para operações reais sem histórico, custos, simulação e feed licenciado. A rota não envia ordens e não integra corretora ou mesa proprietária.
