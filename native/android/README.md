# Superbet Connect — Native Android Files

Estes arquivos implementam o **overlay flutuante (bolha)** que captura a tela
da Superbet via `MediaProjection`. Eles NÃO são copiados automaticamente para
o projeto Android pelo `npx cap sync` — o Capacitor só sincroniza `dist/` e
plugins NPM. Por isso, eles ficam aqui no repositório como referência e você
copia uma única vez após rodar `npx cap add android`.

## Pré-requisitos

1. Exportar o projeto pro seu GitHub e fazer `git pull`.
2. `npm install`
3. `npx cap add android` (cria a pasta `android/`)

## Passo a passo (one-time setup)

Substitua `app.lovable.03101480d5c041dd93e7913b636c81b0` se você mudar o `appId`
no `capacitor.config.ts`. A pasta de pacote correspondente fica em
`android/app/src/main/java/app/lovable/.../`.

### 1. Copiar os arquivos Kotlin

```bash
PKG_DIR="android/app/src/main/java/app/lovable/_03101480d5c041dd93e7913b636c81b0"
mkdir -p "$PKG_DIR/superbet"
cp native/android/SuperbetOverlayPlugin.kt "$PKG_DIR/superbet/"
cp native/android/OverlayService.kt        "$PKG_DIR/superbet/"
cp native/android/CaptureService.kt        "$PKG_DIR/superbet/"
cp native/android/PermissionActivity.kt    "$PKG_DIR/superbet/"
```

> O nome real do pacote depende de como o Android Studio escapou o appId.
> Se a pasta gerada for diferente, ajuste o `package app.lovable...` no topo
> de cada `.kt` para bater com a pasta real.

### 2. Registrar o plugin no `MainActivity.java` (ou `.kt`)

Abra `android/app/src/main/java/.../MainActivity.java` e adicione dentro de
`onCreate`, antes de `super.onCreate(savedInstanceState)`:

```java
registerPlugin(SuperbetOverlayPlugin.class);
```

Não esqueça o `import app.lovable._03101480d5c041dd93e7913b636c81b0.superbet.SuperbetOverlayPlugin;`
no topo do arquivo.

### 3. Mesclar o `AndroidManifest.xml`

Abra `android/app/src/main/AndroidManifest.xml` e:

a) Adicione estas permissões dentro de `<manifest>` (acima de `<application>`):

```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

b) Adicione estas declarações dentro de `<application>`:

```xml
<service
    android:name=".superbet.OverlayService"
    android:foregroundServiceType="specialUse"
    android:exported="false" />

<service
    android:name=".superbet.CaptureService"
    android:foregroundServiceType="mediaProjection"
    android:exported="false" />

<activity
    android:name=".superbet.PermissionActivity"
    android:theme="@android:style/Theme.Translucent.NoTitleBar"
    android:exported="false" />
```

### 4. Build

```bash
npm run build
npx cap sync android
npx cap run android
```

## Como funciona em runtime

```
JS (React) ─► SuperbetOverlayPlugin (Capacitor bridge)
                  │
                  ├─► requestPermissions(): abre PermissionActivity
                  │     ├─ Settings.canDrawOverlays?  → manda pro Settings
                  │     └─ MediaProjection consent dialog
                  │
                  ├─► startOverlay(): inicia OverlayService (FGS)
                  │     └─ desenha bolha laranja com WindowManager
                  │
                  └─► quando user toca a bolha:
                        OverlayService → CaptureService.captureFrame()
                          → ImageReader pega 1 frame
                          → converte pra PNG base64
                          → notifica plugin via broadcast
                          → plugin emite evento "overlayCaptured" pro JS
                          → JS chama supabase.functions.invoke('superbet-parse')
```

## Limitações

- **iOS não tem suporte**. Apple não permite overlays sobre outros apps.
- **MediaProjection expira** quando o app principal vai pra background por muito
  tempo. O usuário precisa reautorizar — a UI mostra esse estado.
- **Play Store** pode pedir justificativa pra `SYSTEM_ALERT_WINDOW` e
  `MediaProjection` em apps publicados. Pra APK distribuído direto, sem problema.
