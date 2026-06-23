# Superbet Connect — Native Android Files

Implementa **bolha flutuante** (MediaProjection) e **captura automática**
(AccessibilityService) que detecta o card do jogo na Superbet e tira
screenshot direto pro OCR — sem precisar tocar na bolha.

Estes arquivos NÃO são copiados pelo `npx cap sync`. Copie uma única vez
após `npx cap add android`.

## Pré-requisitos
1. Exportar projeto pro GitHub → `git pull`
2. `npm install`
3. `npx cap add android`

## Setup (one-time)

```bash
PKG_DIR="android/app/src/main/java/app/lovable/_03101480d5c041dd93e7913b636c81b0"
mkdir -p "$PKG_DIR/superbet"
cp native/android/SuperbetOverlayPlugin.kt "$PKG_DIR/superbet/"
cp native/android/OverlayService.kt        "$PKG_DIR/superbet/"
cp native/android/CaptureService.kt        "$PKG_DIR/superbet/"
cp native/android/PermissionActivity.kt    "$PKG_DIR/superbet/"
cp native/android/AutoDetectService.kt     "$PKG_DIR/superbet/"

mkdir -p android/app/src/main/res/xml
cp native/android/auto_detect_config.xml android/app/src/main/res/xml/
```

> Se a pasta gerada pelo `cap add android` tiver nome diferente, ajuste o
> `package ...` no topo dos `.kt`.

### Registrar plugin no `MainActivity`

```java
// dentro de onCreate, antes de super.onCreate(...)
registerPlugin(SuperbetOverlayPlugin.class);
```

### Adicionar strings em `android/app/src/main/res/values/strings.xml`

```xml
<string name="superbet_auto_description">Detecta o card do jogo na Superbet para enriquecer a análise.</string>
<string name="superbet_auto_summary">Captura automática Superbet → Analista Joilson</string>
```

### Mesclar `AndroidManifest.xml`

Permissões (dentro de `<manifest>`):
```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Dentro de `<application>`:
```xml
<service
    android:name=".superbet.OverlayService"
    android:foregroundServiceType="specialUse"
    android:exported="false" />

<service
    android:name=".superbet.CaptureService"
    android:foregroundServiceType="mediaProjection"
    android:exported="false" />

<service
    android:name=".superbet.AutoDetectService"
    android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
    android:exported="false">
    <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService" />
    </intent-filter>
    <meta-data
        android:name="android.accessibilityservice"
        android:resource="@xml/auto_detect_config" />
</service>

<activity
    android:name=".superbet.PermissionActivity"
    android:theme="@android:style/Theme.Translucent.NoTitleBar"
    android:exported="false" />
```

### Build
```bash
npm run build && npx cap sync android && npx cap run android
```

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

- **Privacidade**: o XML restringe o service aos pacotes da Superbet apenas.
  Não recebemos eventos de WhatsApp, banco, etc.
- **Bateria**: filtros nativos + debounce + early-return tornam o custo
  mínimo. Service só processa quando Superbet está em foreground.
- **Toggle**: o usuário liga/desliga via switch no app. Estado fica em
  `SharedPreferences` (`superbet_auto.enabled`). Mesmo com Acessibilidade
  ativa, nada é capturado se o switch estiver OFF.

## Limitações
- iOS sem suporte (Apple não permite Acessibilidade pra outros apps nem overlays).
- Play Store exige justificativa pra Acessibilidade + MediaProjection. Pra APK
  distribuído direto, sem problema.
- MediaProjection expira no cold-start do app — usuário precisa reautorizar.
- Mudança grande no layout/textos da Superbet pode quebrar a heurística;
  ajustar regex em `AutoDetectService.kt`.
