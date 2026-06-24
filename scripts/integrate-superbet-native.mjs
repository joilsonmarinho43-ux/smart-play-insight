#!/usr/bin/env node
/**
 * Integra os arquivos de `native/android/` ao projeto Android gerado pelo
 * Capacitor (`npx cap add android`). Idempotente — pode rodar quantas vezes
 * quiser. Executa automaticamente como `postcap:sync`.
 *
 * O que faz:
 *  1. Copia *.kt para android/app/src/main/java/<pkg>/superbet/
 *  2. Copia auto_detect_config.xml para android/app/src/main/res/xml/
 *  3. Garante permissões + services + activity no AndroidManifest.xml
 *  4. Registra o plugin no MainActivity.(java|kt)
 *  5. Garante strings em values/strings.xml
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(ROOT, 'android');
const NATIVE_DIR = join(ROOT, 'native', 'android');

const log = (msg) => console.log(`[superbet-native] ${msg}`);
const warn = (msg) => console.warn(`[superbet-native] ⚠ ${msg}`);

if (!existsSync(ANDROID_DIR)) {
  warn(`pasta android/ não existe ainda. Rode:`);
  warn(`  npx cap add android`);
  warn(`depois execute novamente: npm run native:android`);
  process.exit(0);
}

// ---------- 1. Descobrir o package base do MainActivity ----------
function findMainActivity() {
  const javaRoot = join(ANDROID_DIR, 'app', 'src', 'main', 'java');
  const results = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/^MainActivity\.(java|kt)$/.test(name)) results.push(full);
    }
  }
  if (existsSync(javaRoot)) walk(javaRoot);
  if (results.length === 0) throw new Error('MainActivity não encontrada em android/app/src/main/java');
  return results[0];
}

const mainActivityPath = findMainActivity();
const mainActivityDir = dirname(mainActivityPath);
const isKotlin = mainActivityPath.endsWith('.kt');
const mainSrc = readFileSync(mainActivityPath, 'utf8');
const pkgMatch = mainSrc.match(/^package\s+([\w.]+);?/m);
if (!pkgMatch) throw new Error('Não foi possível ler package da MainActivity');
const basePkg = pkgMatch[1];
const superbetPkg = `${basePkg}.superbet`;
const superbetDir = join(mainActivityDir, 'superbet');
log(`package base: ${basePkg}`);
log(`destino plugin: ${superbetDir}`);

// ---------- 2. Copiar .kt reescrevendo o package ----------
mkdirSync(superbetDir, { recursive: true });
const ktFiles = readdirSync(NATIVE_DIR).filter((f) => f.endsWith('.kt'));
for (const file of ktFiles) {
  const src = readFileSync(join(NATIVE_DIR, file), 'utf8');
  const rewritten = src.replace(/^package\s+[\w.]+/m, `package ${superbetPkg}`);
  writeFileSync(join(superbetDir, file), rewritten);
  log(`✓ ${file}`);
}

// ---------- 3. Copiar XML do AccessibilityService ----------
const xmlDir = join(ANDROID_DIR, 'app', 'src', 'main', 'res', 'xml');
mkdirSync(xmlDir, { recursive: true });
copyFileSync(join(NATIVE_DIR, 'auto_detect_config.xml'), join(xmlDir, 'auto_detect_config.xml'));
log('✓ res/xml/auto_detect_config.xml');

// ---------- 4. Patch AndroidManifest.xml ----------
const manifestPath = join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');

const PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
];
for (const perm of PERMISSIONS) {
  if (!manifest.includes(`android:name="${perm}"`)) {
    manifest = manifest.replace(
      /<manifest\b[^>]*>/,
      (m) => `${m}\n    <uses-permission android:name="${perm}" />`,
    );
    log(`+ permission ${perm}`);
  }
}

const APPLICATION_ENTRIES = `
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
`;

if (!manifest.includes('.superbet.OverlayService')) {
  manifest = manifest.replace(/<\/application>/, `${APPLICATION_ENTRIES}    </application>`);
  log('+ services/activity em <application>');
}

writeFileSync(manifestPath, manifest);

// ---------- 5. Registrar plugin no MainActivity ----------
let mainUpdated = mainSrc;
if (!mainUpdated.includes('SuperbetOverlayPlugin')) {
  if (isKotlin) {
    if (!mainUpdated.includes(`import ${superbetPkg}.SuperbetOverlayPlugin`)) {
      mainUpdated = mainUpdated.replace(
        /^package[^\n]*\n/m,
        (m) => `${m}\nimport ${superbetPkg}.SuperbetOverlayPlugin\n`,
      );
    }
    if (/override fun onCreate\([^)]*\)\s*{/.test(mainUpdated)) {
      mainUpdated = mainUpdated.replace(
        /(override fun onCreate\([^)]*\)\s*{)/,
        `$1\n        registerPlugin(SuperbetOverlayPlugin::class.java)`,
      );
    } else {
      mainUpdated = mainUpdated.replace(
        /class MainActivity[^{]*\{/,
        (m) => `${m}\n    override fun onCreate(savedInstanceState: android.os.Bundle?) {\n        registerPlugin(SuperbetOverlayPlugin::class.java)\n        super.onCreate(savedInstanceState)\n    }\n`,
      );
    }
  } else {
    if (!mainUpdated.includes(`import ${superbetPkg}.SuperbetOverlayPlugin;`)) {
      mainUpdated = mainUpdated.replace(
        /^(package[^\n]*\n)/m,
        `$1\nimport ${superbetPkg}.SuperbetOverlayPlugin;\nimport android.os.Bundle;\n`,
      );
    }
    if (/public\s+void\s+onCreate\s*\(Bundle[^)]*\)\s*\{/.test(mainUpdated)) {
      mainUpdated = mainUpdated.replace(
        /(public\s+void\s+onCreate\s*\(Bundle[^)]*\)\s*\{)/,
        `$1\n        registerPlugin(SuperbetOverlayPlugin.class);`,
      );
    } else {
      mainUpdated = mainUpdated.replace(
        /(public class MainActivity[^{]*\{)/,
        `$1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(SuperbetOverlayPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n`,
      );
    }
  }
  writeFileSync(mainActivityPath, mainUpdated);
  log(`✓ MainActivity (${basename(mainActivityPath)}) registra SuperbetOverlayPlugin`);
} else {
  log('= MainActivity já registra o plugin');
}

// ---------- 6. strings.xml ----------
const stringsPath = join(ANDROID_DIR, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, 'utf8');
  const adds = [
    ['superbet_auto_description', 'Detecta o card do jogo na Superbet para enriquecer a análise.'],
    ['superbet_auto_summary', 'Captura automática Superbet → Analista Joilson'],
  ];
  let changed = false;
  for (const [name, value] of adds) {
    if (!new RegExp(`name="${name}"`).test(strings)) {
      strings = strings.replace(/<\/resources>/, `    <string name="${name}">${value}</string>\n</resources>`);
      changed = true;
      log(`+ string ${name}`);
    }
  }
  if (changed) writeFileSync(stringsPath, strings);
}

log('done.');
