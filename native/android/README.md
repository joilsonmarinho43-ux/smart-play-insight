# Superbet Connect — Native Android

Bolha flutuante (MediaProjection) + captura automática (AccessibilityService)
que detecta o card do jogo na Superbet e dispara o screenshot pro OCR.

## Integração automática (recomendado)

Após `npx cap add android` (rodado **uma vez** na sua máquina, fora do sandbox
do Lovable), basta usar o npm script — é **idempotente**, pode rodar quantas
vezes precisar e funciona como `postcap sync`:

```bash
git pull                       # pega o código mais recente do Lovable
npm install
npx cap add android            # apenas na 1ª vez
npm run build
npm run cap:sync               # roda `cap sync android` + integra os nativos
npx cap run android
```

`npm run cap:sync` executa `scripts/integrate-superbet-native.mjs`, que:

1. Copia `SuperbetOverlayPlugin.kt`, `OverlayService.kt`, `CaptureService.kt`,
   `AutoDetectService.kt` e `PermissionActivity.kt` para
   `android/app/src/main/java/<seu-pkg>/superbet/` (reescreve o `package` no
   topo de cada arquivo automaticamente, então não importa qual nome o
   Capacitor gerou).
2. Copia `auto_detect_config.xml` para `android/app/src/main/res/xml/`.
3. Adiciona ao `AndroidManifest.xml` (idempotente):
   - permissões `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE`,
     `FOREGROUND_SERVICE_MEDIA_PROJECTION`,
     `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`;
   - `<service>` para `OverlayService`, `CaptureService`, `AutoDetectService`;
   - `<activity>` `PermissionActivity` translúcida.
4. Registra `SuperbetOverlayPlugin` no `MainActivity` (Java **ou** Kotlin).
5. Adiciona `superbet_auto_description` / `superbet_auto_summary` em
   `res/values/strings.xml`.

> Se rodar `npx cap sync` direto (sem o `npm run cap:sync`), execute depois
> `npm run native:android` para reaplicar a integração — o `cap sync` pode
> sobrescrever o `AndroidManifest.xml`.

## Setup manual (fallback)

Caso prefira fazer à mão, veja `scripts/integrate-superbet-native.mjs` — cada
etapa está documentada lá em comentários.

## Como funciona a captura automática

```
Usuário abre Superbet → AutoDetectService recebe AccessibilityEvent
                          (apenas pacotes Superbet, filtrado no XML)
                            │
                  ┌─────────▼─────────┐
                  │ Lê árvore de nós  │
                  │ (texto + a11y)    │
                  └─────────┬─────────┘
                            │
              detecta placar (1x0), minuto (67'),
              ou "TimeA vs TimeB"?
                            │
                       sim ─┴─ não → ignora
                            │
                  debounce 4s + hash da
                  assinatura textual mudou?
                            │
                       sim ─┴─ não → ignora
                            │
                            ▼
              CaptureService.captureFrame()
              → screenshot vai pro OCR → engines
```

## Limitações

- iOS sem suporte (Apple não permite Acessibilidade pra outros apps nem overlays).
- Play Store exige justificativa pra Acessibilidade + MediaProjection.
  Pra APK distribuído direto, sem problema.
- MediaProjection expira no cold-start do app — usuário precisa reautorizar.
- Mudança grande no layout/textos da Superbet pode quebrar a heurística;
  ajuste regex em `AutoDetectService.kt`.
