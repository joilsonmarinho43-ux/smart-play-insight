import { chromium } from 'playwright';

const BASE_URL = 'https://analista.funecob.com.br';
const failures = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

page.on('pageerror', e => failures.push('PAGE ERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') failures.push('CONSOLE ERROR: ' + m.text()); });
page.on('response', r => {
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
console.log('LOGIN URL:', page.url());
if (page.url().includes('/auth')) failures.push('LOGIN FAILED');

const routes = ['/', '/live', '/scanner', '/favorites', '/suggestions', '/bingo', '/elite', '/placar-exato', '/bet-analyzer'];
for (const route of routes) {
  try {
    const r = await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    if ((r?.status() ?? 0) >= 500) throw new Error('HTTP ' + r.status());
    if (page.url().includes('/auth')) throw new Error('REDIRECTED TO AUTH');
    console.log('ROUTE PASS:', route);
  } catch (e) {
    failures.push(route + ': ' + e.message);
    console.log('ROUTE FAIL:', route, e.message);
  }
}

await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1800);
const matchLink = page.locator('a[href*="/match/"]').first();
if (await matchLink.count()) {
  const href = await matchLink.getAttribute('href');
  await page.goto(BASE_URL + href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  const required = ['Estatísticas completas','Posse','Finalizações','No alvo','Grandes chances','Escanteios','Impedimentos','Faltas','Cartões amarelos','xG'];
  const missing = required.filter(x => !body.includes(x));
  if (missing.length) failures.push('MATCH DETAILS MISSING: ' + missing.join(', '));
  else console.log('MATCH DETAILS PASS');
} else {
  failures.push('MATCH DATA EMPTY: nenhum link de jogo disponível na Home');
  console.log('MATCH DETAILS BLOCKED: no match link currently available');
}

await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1200);
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
    const r = await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    if ((r?.status() ?? 0) >= 500) throw new Error('HTTP ' + r.status());
    if (page.url().includes('/auth')) throw new Error('REDIRECTED TO AUTH');
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

const menu = page.getByRole('button', { name: /Menu/i }).first();
if (await menu.count()) { await menu.click(); await page.waitForTimeout(300); }
const logout = page.getByRole('button', { name: /SAIR/i }).first();
if (await logout.count()) {
  await logout.click(); await page.waitForTimeout(1200);
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
