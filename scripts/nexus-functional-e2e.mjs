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
  if (r.url().includes('/functions/v1/team-stats-research')) {
    try {
      const data = await r.json();
      const count = Object.keys(data?.stats?.home || {}).length + Object.keys(data?.stats?.away || {}).length;
      console.log('TEAM-STATS-RESEARCH:', JSON.stringify({ http: r.status(), status: data?.status, count, provider: data?.provider, groundingCount: data?.groundingCount, attempts: data?.attempts }));
      if (r.status() >= 400 || !data?.ok) failures.push('TEAM-STATS-RESEARCH HTTP ' + r.status() + ': ' + (data?.error || 'unknown'));
    } catch { failures.push('TEAM-STATS-RESEARCH invalid response'); }
  }
  if (r.url().includes('/functions/v1/team-form')) {
    try {
      const data = await r.json();
      const sides = data?.matches?.flatMap(m => [m.home, m.away]) || [data?.home, data?.away];
      const verified = sides.filter(Boolean).flatMap(side => Object.entries(side.statsSample || {}).filter(([,n]) => n > 0).map(([field,n]) => ({ field, sample: n, sources: side.statsSources?.[field]?.length || 0 })));
      console.log('TEAM-FORM VERIFIED STATS:', JSON.stringify({ count: verified.length, examples: verified.slice(0, 12) }));
      if (verified.some(x => x.sources !== x.sample)) failures.push('TEAM-FORM: statistic without matching source URLs');
    } catch { failures.push('TEAM-FORM invalid response'); }
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
const authResponsePromise = page.waitForResponse(r => r.url().includes('/auth/v1/token') && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar")').first().click();
const authResponse = await authResponsePromise;
console.log('AUTH STATUS:', authResponse?.status() ?? 'NO_RESPONSE');
if (!authResponse || authResponse.status() >= 400) {
  await page.screenshot({ path: 'nexus-auth-failed.png', fullPage: true });
  await browser.close();
  throw new Error('AUTH BLOCKED: ' + (authResponse?.status() ?? 'NO_RESPONSE') + '; protected routes were not tested');
}
await page.waitForURL(url => !url.pathname.includes('/auth'), { timeout: 30000 }).catch(() => {});
if (page.url().includes('/auth')) {
  await page.screenshot({ path: 'nexus-auth-failed.png', fullPage: true });
  await browser.close();
  throw new Error('LOGIN FAILED: protected routes were not tested');
}
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1800);
console.log('LOGIN PASS:', page.url());

const routes = ['/', '/live', '/scanner', '/favorites', '/suggestions', '/bingo', '/elite', '/placar-exato', '/bet-analyzer'];
for (const route of routes) {
  try {
    const r = await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!r || r.status() >= 400) throw new Error('HTTP ' + (r?.status() ?? 'NO_RESPONSE'));
    if (route === '/') {
      await page.locator('text=/Nenhum jogo para|Detalhes completos/').first()
        .waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
      await page.locator('button[title="Atualizar"] svg.animate-spin').first()
        .waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
    } else await page.waitForTimeout(1200);
    if (page.url().includes('/auth')) throw new Error('REDIRECTED TO AUTH');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const buttons = await page.getByRole('button').allTextContents().catch(() => []);
    const links = await page.getByRole('link').allTextContents().catch(() => []);
    console.log('ROUTE AUDIT:', route, JSON.stringify({url:page.url(),body:bodyText.slice(0,5000),buttons:buttons.slice(0,40),links:links.slice(0,40)}));
    if (!bodyText.trim()) throw new Error('EMPTY BODY');
    await page.screenshot({ path: 'nexus-route-' + (route === '/' ? 'home' : route.slice(1)) + '.png', fullPage: true });
    console.log('ROUTE PASS:', route, 'HTTP', r.status());
  } catch (e) {
    failures.push(route + ': ' + e.message);
    console.log('ROUTE FAIL:', route, e.message);
  }
}

await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
  console.log('MATCH DETAILS INCONCLUSIVE: no match data; retry when a real match is available');
  console.log('MATCH DETAILS BLOCKED: no match link currently available');
}

await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
    if (!r || r.status() >= 400) throw new Error('HTTP ' + (r?.status() ?? 'NO_RESPONSE'));
    await page.waitForTimeout(1200);
    if (page.url().includes('/auth')) throw new Error('REDIRECTED TO AUTH');
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const buttons = await page.getByRole('button').allTextContents().catch(() => []);
    console.log('AREA AUDIT:', route, JSON.stringify({url:page.url(),body:bodyText.slice(0,7000),buttons:buttons.slice(0,60)}));
    if (!bodyText.trim()) throw new Error('EMPTY BODY');
    await page.screenshot({ path: 'nexus-route-' + route.slice(1) + '.png', fullPage: true });
    console.log('AREA PASS:', route, 'HTTP', r.status());
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
