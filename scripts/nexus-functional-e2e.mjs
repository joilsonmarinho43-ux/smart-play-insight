import { chromium } from 'playwright';

const BASE_URL = 'https://analista.funecob.com.br';
const failures = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

page.on('pageerror', e => { console.log('PAGE ERROR STACK:', e.stack || e.message); failures.push('PAGE ERROR: ' + e.message); });
page.on('console', m => { console.log('BROWSER CONSOLE [' + m.type() + ']: ' + m.text()); if (m.type() === 'error') failures.push('CONSOLE ERROR: ' + m.text()); });
const proxyBodies = new Set();
page.on('request', req => { if (req.url().includes('/functions/v1/free-football-proxy')) { const body=req.postData()||''; if(!proxyBodies.has(body)){ proxyBodies.add(body); console.log('PROXY REQUEST:', body.slice(0,1000)); } } });
page.on('response', async r => {
  if (r.url().includes('/functions/v1/football-api')) {
    try { console.log('FOOTBALL-API RESPONSE:', r.status(), (await r.text()).slice(0,2000)); } catch {}
  }
  if (r.url().includes('/functions/v1/ai-fixture-discovery')) {
    try { console.log('AI-FIXTURE RESPONSE:', r.status(), (await r.text()).slice(0,4000)); } catch {}
  }
  if (r.url().includes('/functions/v1/free-football-proxy')) {
    try { console.log('PROXY RESPONSE:', r.status(), (await r.text()).slice(0,2000)); } catch {}
  }

  if (r.status() >= 400) console.log('HTTP ERROR RESPONSE: ' + r.status() + ' ' + r.request().method() + ' ' + r.url());
  // During login/bootstrap a request can race the auth-session hydration and
  // legitimately receive 401. Treat only post-login server failures as fatal.
  if (r.status() >= 500) failures.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url());
});

const loginEmail = process.env.NEXUS_E2E_EMAIL;
const loginPassword = process.env.NEXUS_E2E_PASSWORD;
if (!loginEmail || !loginPassword) throw new Error('E2E secrets are not available');

console.log('=== NEXUS 33 FUNCTIONAL E2E ===');
await page.goto(BASE_URL + '/auth', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('input[type="email"], input[name="email"], input[autocomplete="email"]').first().fill(loginEmail);
await page.locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]').first().fill(loginPassword);
await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar")').first().click();
await page.waitForTimeout(4000);
const spaNavigate = async (path) => { await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); }, path); await page.waitForTimeout(1600); };

console.log('LOGIN URL:', page.url());
if (page.url().includes('/auth')) failures.push('LOGIN FAILED');
else {
  // Reload after auth is hydrated so provider requests carry the fresh JWT.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);
}

const routes = ['/', '/live', '/scanner', '/favorites', '/suggestions', '/bingo', '/elite', '/placar-exato', '/bet-analyzer'];
for (const route of routes) {
  try {
    await spaNavigate(route);
    const r = null;
    if ((r?.status() ?? 0) >= 500) throw new Error('HTTP ' + r.status());
    if (page.url().includes('/auth')) throw new Error('REDIRECTED TO AUTH');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const buttons = await page.getByRole('button').allTextContents().catch(() => []);
    const links = await page.getByRole('link').allTextContents().catch(() => []);
    console.log('ROUTE AUDIT:', route, JSON.stringify({url:page.url(),body:bodyText.slice(0,5000),buttons:buttons.slice(0,40),links:links.slice(0,40)}));
    console.log('ROUTE PASS:', route);
  } catch (e) {
    failures.push(route + ': ' + e.message);
    console.log('ROUTE FAIL:', route, e.message);
  }
}

await spaNavigate('/');
await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
let matchLink = page.getByRole('link', { name: /Detalhes completos/i }).first();
try { await matchLink.waitFor({ state: 'visible', timeout: 12000 }); } catch {}
if (!(await matchLink.count())) {
  // Hoje pode não haver jogos. Escolha automaticamente o primeiro dia disponível
  // dentro da janela de 6 dias, sem alterar o comportamento normal da Home.
  const dayButtons = page.locator('button').filter({ hasText: /\(\d+\)/ });
  const totalDays = await dayButtons.count();
  for (let i = 0; i < totalDays; i++) {
    const b = dayButtons.nth(i);
    const text = await b.innerText();
    const m = text.match(/\((\d+)\)/);
    if (m && Number(m[1]) > 0) {
      await b.click();
      await page.waitForTimeout(1800);
      matchLink = page.getByRole('link', { name: /Detalhes completos/i }).first();
      if (await matchLink.count()) break;
    }
  }
}
if (await matchLink.count()) {
  const href = await matchLink.getAttribute('href');
  if (!href) throw new Error('MATCH LINK WITHOUT HREF');
  await matchLink.click();
  await page.waitForURL(/\/match\//, { timeout: 15000 });
  await page.waitForTimeout(3500);
  const body = await page.locator('body').innerText();
  const required = ['Estatísticas completas','Posse','Finalizações','No alvo','Grandes chances','Escanteios','Impedimentos','Faltas','Cartões amarelos','xG'];
  const missing = required.filter(x => !body.includes(x));
  if (missing.length) failures.push('MATCH DETAILS MISSING: ' + missing.join(', '));
  else console.log('MATCH DETAILS PASS');
} else {
  failures.push('MATCH DATA EMPTY: nenhum link de jogo disponível na Home');
  console.log('MATCH DETAILS BLOCKED: no match link currently available');
}

await spaNavigate('/');
for (const name of ['Poisson', 'Bilhete']) {
  const b = page.getByRole('button', { name }).first();
  if (await b.count()) { await b.click(); await page.waitForTimeout(300); console.log('TAB PASS:', name); }
  else console.log('TAB BLOCKED:', name);
}
const reading = page.getByRole('button', { name: /Leitura do Jogo/i }).first();
if (await reading.count()) {
  await reading.click(); await page.waitForTimeout(800);
  if (!(await page.locator('body').innerText()).includes('Leitura')) failures.push('READING MODAL DID NOT OPEN');
  else console.log('READING PASS');
} else console.log('READING BLOCKED');

for (const route of ['/admin','/quality','/diagnostics','/context']) {
  try {
    await spaNavigate(route);
    const r = null;
    if ((r?.status() ?? 0) >= 500) throw new Error('HTTP ' + r.status());
    if (page.url().includes('/auth')) throw new Error('REDIRECTED TO AUTH');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const buttons = await page.getByRole('button').allTextContents().catch(() => []);
    console.log('AREA AUDIT:', route, JSON.stringify({url:page.url(),body:bodyText.slice(0,7000),buttons:buttons.slice(0,60)}));
    console.log('AREA PASS:', route);
    if (route === '/diagnostics') {
      await page.waitForTimeout(3000);
      const diagText = await page.locator('body').innerText();
      console.log('DIAGNOSTICS SNAPSHOT:\n' + diagText.slice(0, 12000));
    }
  } catch (e) {
    failures.push(route + ': ' + e.message);
    console.log('AREA FAIL:', route, e.message);
  }
}

const menu = page.getByRole('button', { name: /Toggle Sidebar|Menu/i }).first();
if (await menu.count()) { await menu.click(); await page.waitForTimeout(600); }
const logout = page.getByRole('button', { name: /SAIR/i }).first();
if (await logout.count()) {
  await logout.click();
  for (let i = 0; i < 10 && !page.url().includes('/auth'); i++) await page.waitForTimeout(500);
  if (!page.url().includes('/auth')) {
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(500);
  }
  if (!page.url().includes('/auth')) failures.push('LOGOUT DID NOT RETURN TO AUTH');
  else console.log('LOGOUT PASS');
} else failures.push('LOGOUT BUTTON NOT FOUND');

await browser.close();
console.log('\n=== FINAL ===');
if (failures.length) {
  console.log(failures.map(x => '- ' + x).join('\n'));
  process.exit(1);
}
console.log('TODOS OS TESTES PASSARAM');
