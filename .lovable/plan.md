# Superbet Connect — Fase 5: Overlay Flutuante (Bolha)

Substitui o fluxo de Share Intent (que não funciona porque a Superbet não tem botão Compartilhar) por uma **bolha flutuante estilo Messenger** que fica por cima da Superbet e captura a tela atual com um toque.

## Como o usuário vai usar

```text
1. Abre o Analista Joilson → tela "Superbet Connect" → toca "Ativar bolha"
2. Sistema pede 2 permissões (uma vez só):
     • "Exibir sobre outros apps"   (SYSTEM_ALERT_WINDOW)
     • "Permitir gravação de tela"  (MediaProjection)
3. Bolha laranja aparece na borda da tela e fica visível em qualquer app
4. Usuário abre a Superbet, navega até o jogo desejado
5. Toca na bolha → flash de captura → screenshot vai pro Match Insight Pro
6. Notificação: "Jogo Flamengo x Palmeiras capturado — toque para ver análise"
7. Toque longo na bolha = menu (mover, ocultar, capturar+abrir leitura)
```

## Arquitetura

```text
┌─────────────────────────────────────────────────────────┐
│  APP ANDROID (Capacitor)                                │
│                                                         │
│  ┌──────────────────┐    ┌─────────────────────────┐   │
│  │ React UI         │◄──►│ Plugin Capacitor Custom │   │
│  │ /superbet-connect│    │ SuperbetOverlay         │   │
│  └──────────────────┘    └───────────┬─────────────┘   │
│                                      │                  │
│                          ┌───────────▼───────────┐     │
│                          │ Android Native (Kotlin)│    │
│                          │                        │    │
│                          │ • OverlayService       │    │
│                          │   (bubble + WindowMgr) │    │
│                          │ • CaptureService       │    │
│                          │   (MediaProjection)    │    │
│                          │ • PermissionActivity   │    │
│                          └───────────┬────────────┘    │
└──────────────────────────────────────┼─────────────────┘
                                       │ screenshot PNG (base64)
                                       ▼
                          ┌────────────────────────┐
                          │ Edge: superbet-parse   │
                          │ (já existe — v0.4.0)   │
                          │ OCR → Vision → SportsRC│
                          └────────────────────────┘
```

## Entregáveis

### 1. Plugin Capacitor nativo
- `android/app/src/main/java/.../SuperbetOverlayPlugin.kt`
  - `requestPermissions()` — pede SYSTEM_ALERT_WINDOW + MediaProjection
  - `startOverlay()` / `stopOverlay()`
  - `captureNow()` — força captura via JS (caso o user prefira disparar do app)
  - Event `overlayCaptured` → devolve `{ imageBase64, timestamp }` pro JS

### 2. Services Android (Kotlin)
- `OverlayService` (Foreground Service)
  - Cria a bolha com `WindowManager.LayoutParams(TYPE_APPLICATION_OVERLAY)`
  - Arrastável (touch listener), snap nas bordas
  - Toque curto = captura, toque longo = menu
- `CaptureService` (Foreground Service tipo `mediaProjection`)
  - Mantém o `MediaProjection` vivo entre capturas
  - Pega frame via `ImageReader` → converte pra PNG → base64
  - Notificação persistente obrigatória (Android exige pra MediaProjection)

### 3. Camada JS (`src/modules/superbet-connect/`)
- `native/overlayBridge.ts` — wrapper do plugin
- `hooks/useOverlay.ts` — `{ enabled, permissionStatus, enable(), disable(), lastCapture }`
- `components/OverlayControl.tsx` — card de ativação na página `/superbet-connect`
  - Estado da permissão (com instruções se negada)
  - Toggle ON/OFF
  - Última captura (preview + status do parser)
  - Fallback web: se não estiver no APK Android, mostra "Disponível apenas no app Android"

### 4. Integração com pipeline existente
- Captura → chama `useCaptureStore.submit({ imageBase64 })` (já existe)
- `superbet-parse` v0.4.0 já trata imagem: OCR client-side → Vision → SportsRC
- Sem mudanças no edge function

### 5. Atualizar AndroidManifest
- `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `POST_NOTIFICATIONS`
- Declarar os 2 services

### 6. Remover / aposentar Share Receiver
- `ShareReceiver.tsx` deixa de ser destaque (vira fallback escondido)
- Documentação no topo da página explica o novo fluxo com bolha

## Detalhes técnicos

- **MediaProjection**: usuário precisa autorizar a cada cold-start do app (limitação do Android, sem volta). A bolha vai indicar visualmente quando a permissão expirou e precisa reautorizar.
- **Bolha sobrevive em qualquer app** porque `OverlayService` roda como foreground service. Não morre quando o user troca pra Superbet.
- **Captura é silenciosa** — não aparece notificação de "tela sendo gravada" piscando (Android 14+ exige a notif persistente, que já vai estar lá).
- **Sandbox Lovable não roda Android**: vou deixar tudo pronto no código. Pra testar: `git pull` → `npm install` → `npx cap sync android` → `npx cap run android` no Android Studio.
- **Web/preview**: a página `/superbet-connect` detecta `Capacitor.isNativePlatform()`. Se for web, mostra apenas o `ManualPaste` (já implementado) e oculta o controle de overlay.

## Limitações que você precisa aceitar

- **Só Android**. iOS não permite overlays sobre outros apps (limitação da Apple, sem fallback).
- **Permissão SYSTEM_ALERT_WINDOW** abre tela de configurações do sistema — a Play Store pode pedir justificativa se você publicar lá. Pra distribuição interna (APK direto) não tem problema.
- **MediaProjection captura a tela inteira**, não só a área da Superbet. O OCR/Vision já filtra o que importa.
- **Não compilo APK aqui** — só preparo o código. Você compila no Android Studio.

## Fora de escopo desta fase
- Auto-captura inteligente (detectar mudança de tela e disparar sozinho)
- Captura de vídeo / momentum (só foto por enquanto)
- Reconhecimento automático de quando o user está na Superbet vs outro app
