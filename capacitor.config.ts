import type { CapacitorConfig } from '@capacitor/cli';

// Configuração do app nativo (Android). Habilita hot-reload apontando para o
// preview do Lovable durante o desenvolvimento. Para gerar APK:
//   1. Exportar projeto para GitHub
//   2. git pull && npm install
//   3. npx cap add android
//   4. npm run build && npx cap sync android
//   5. npx cap run android (precisa Android Studio instalado)
const config: CapacitorConfig = {
  appId: 'app.lovable.03101480d5c041dd93e7913b636c81b0',
  appName: 'Analista Joilson',
  webDir: 'dist',
  server: {
    url: 'https://03101480-d5c0-41dd-93e7-913b636c81b0.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
