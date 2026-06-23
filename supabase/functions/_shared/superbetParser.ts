// Superbet Connect — Parser de texto e URL (Fase 2)
// Regex + heurísticas. Zero dependências de runtime — compatível com Deno.

export const PARSER_VERSION = "v0.2.0-text-url";

const STRIP_ACCENTS = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const TEAM_TOKEN = "[A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9.'’\\- ]{1,30}";

// ---------- URL ----------
export function parseSuperbetUrl(url: string): {
  home?: string;
  away?: string;
  slug?: string;
  league?: string;
} {
  try {
    const u = new URL(url);
    if (!/superbet/i.test(u.hostname)) return {};
    // padrões observados: /pt-br/aposte/futebol/.../X-vs-Y ou /event/X-y
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    const slug = last.replace(/[?#].*$/, "");
    const m = slug.match(/^(.+?)[-_]vs[-_](.+?)(?:[-_]\d+)?$/i)
           ?? slug.match(/^(.+?)[-_]x[-_](.+?)(?:[-_]\d+)?$/i);
    if (m) {
      const home = m[1].replace(/[-_]+/g, " ").trim();
      const away = m[2].replace(/[-_]+/g, " ").trim();
      const league = parts.length >= 3 ? parts[parts.length - 2].replace(/[-_]+/g, " ") : undefined;
      return { home: titleCase(home), away: titleCase(away), slug, league };
    }
    return { slug };
  } catch {
    return {};
  }
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// ---------- Times no texto ----------
export function extractMatch(text: string): { home?: string; away?: string; minute?: number; score?: string; league?: string } {
  if (!text) return {};
  // "Flamengo 1 x 0 Palmeiras (67')"
  const live = text.match(
    new RegExp(`(${TEAM_TOKEN})\\s+(\\d{1,2})\\s*[xX:\\-]\\s*(\\d{1,2})\\s+(${TEAM_TOKEN})(?:[^\\d]{0,15}(\\d{1,3})['m´]?)?`)
  );
  if (live) {
    return {
      home: live[1].trim(),
      away: live[4].trim(),
      score: `${live[2]}-${live[3]}`,
      minute: live[5] ? Math.min(120, parseInt(live[5], 10)) : undefined,
    };
  }
  // "Flamengo vs Palmeiras" / "Flamengo x Palmeiras"
  const pre = text.match(new RegExp(`(${TEAM_TOKEN})\\s+(?:vs|x|×|-)\\s+(${TEAM_TOKEN})`, "i"));
  if (pre) return { home: pre[1].trim(), away: pre[2].trim() };
  return {};
}

// ---------- Odds ----------
const MARKET_PATTERNS: Array<{ re: RegExp; market: string; selection: string }> = [
  { re: /\b(?:resultado final|match\s*winner|1x2)\b[\s\S]{0,80}?\b(casa|home|1)\b[\s\S]{0,20}?(\d+[.,]\d{2})/i, market: "1X2", selection: "Home" },
  { re: /\b(?:resultado final|match\s*winner|1x2)\b[\s\S]{0,80}?\b(empate|draw|x)\b[\s\S]{0,20}?(\d+[.,]\d{2})/i, market: "1X2", selection: "Draw" },
  { re: /\b(?:resultado final|match\s*winner|1x2)\b[\s\S]{0,80}?\b(fora|away|2)\b[\s\S]{0,20}?(\d+[.,]\d{2})/i, market: "1X2", selection: "Away" },
  { re: /\b(?:ambas?\s*marcam|btts|both\s*to\s*score)\b[\s\S]{0,40}?\b(sim|yes)\b[\s\S]{0,20}?(\d+[.,]\d{2})/i, market: "BTTS", selection: "Yes" },
  { re: /\b(?:ambas?\s*marcam|btts|both\s*to\s*score)\b[\s\S]{0,40}?\b(n[ãa]o|no)\b[\s\S]{0,20}?(\d+[.,]\d{2})/i, market: "BTTS", selection: "No" },
];

// Over/Under genéricos: "Mais de 2.5 ... 1.80"
const OVER_RE = /\b(?:mais de|over|acima de)\s*(\d{1,2}[.,]\d)\b[\s\S]{0,30}?(\d+[.,]\d{2})/gi;
const UNDER_RE = /\b(?:menos de|under|abaixo de)\s*(\d{1,2}[.,]\d)\b[\s\S]{0,30}?(\d+[.,]\d{2})/gi;
const CORNER_HINT = /\b(escanteios?|corners?)\b/i;
const CARD_HINT = /\b(cart[õo]es?|cards?)\b/i;

export function extractOdds(text: string): Array<{ market: string; selection: string; price: number }> {
  const out: Array<{ market: string; selection: string; price: number }> = [];
  if (!text) return out;
  const seen = new Set<string>();
  const push = (market: string, selection: string, raw: string) => {
    const price = parseFloat(raw.replace(",", "."));
    if (!isFinite(price) || price < 1.01 || price > 1000) return;
    const key = `${market}|${selection}|${price}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ market, selection, price });
  };

  for (const p of MARKET_PATTERNS) {
    const m = text.match(p.re);
    if (m) push(p.market, p.selection, m[2]);
  }

  const decorate = (line: string, base: string) =>
    CORNER_HINT.test(line) ? `${base} Escanteios` : CARD_HINT.test(line) ? `${base} Cartões` : `${base} Gols`;

  for (const m of text.matchAll(OVER_RE)) {
    const line = nearby(text, m.index ?? 0);
    push(decorate(line, `Over ${m[1].replace(",", ".")}`), "Over", m[2]);
  }
  for (const m of text.matchAll(UNDER_RE)) {
    const line = nearby(text, m.index ?? 0);
    push(decorate(line, `Under ${m[1].replace(",", ".")}`), "Under", m[2]);
  }

  // Handicap Asiático "+0,5 ... 1.92"
  const ah = text.matchAll(/\b([+-]\d{1,2}[.,]\d)\b[\s\S]{0,30}?(\d+[.,]\d{2})/g);
  for (const m of ah) {
    push(`Handicap ${m[1]}`, m[1].startsWith("-") ? "Away" : "Home", m[2]);
  }

  return out.slice(0, 40);
}

function nearby(text: string, idx: number): string {
  return text.slice(Math.max(0, idx - 40), idx + 60);
}

// ---------- Stats ----------
const STAT_LABELS: Array<{ key: string; re: RegExp }> = [
  { key: "posse",         re: /\b(?:posse(?: de bola)?|possession)\b/i },
  { key: "finalizacoes",  re: /\b(?:finaliza[çc][õo]es|chutes|shots)\b/i },
  { key: "finalizacoes_no_gol", re: /\b(?:chutes? no gol|shots? on (?:target|goal))\b/i },
  { key: "escanteios",    re: /\b(?:escanteios?|corners?)\b/i },
  { key: "cartoes_amarelos", re: /\b(?:cart[õo]es? amarelos?|yellow cards?)\b/i },
  { key: "cartoes_vermelhos", re: /\b(?:cart[õo]es? vermelhos?|red cards?)\b/i },
  { key: "faltas",        re: /\b(?:faltas?|fouls?)\b/i },
  { key: "impedimentos",  re: /\b(?:impedimentos?|offsides?)\b/i },
  { key: "ataques_perigosos", re: /\b(?:ataques? perigosos?|dangerous attacks?)\b/i },
  { key: "defesas",       re: /\b(?:defesas?|saves?)\b/i },
];

export function extractStats(text: string): Record<string, { home?: number; away?: number }> {
  const out: Record<string, { home?: number; away?: number }> = {};
  if (!text) return out;
  const lines = text.split(/\r?\n+/);
  for (const line of lines) {
    for (const { key, re } of STAT_LABELS) {
      if (!re.test(line)) continue;
      // procura dois números na mesma linha: "Posse de bola  62%  38%"
      const nums = [...line.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*%?/g)].map((m) => parseFloat(m[1].replace(",", ".")));
      if (nums.length >= 2) {
        out[key] = { home: nums[0], away: nums[1] };
      }
      break;
    }
  }
  return out;
}

// ---------- H2H ----------
export function extractH2H(text: string): Array<{ date?: string; score?: string; home?: string; away?: string }> {
  const out: Array<{ date?: string; score?: string; home?: string; away?: string }> = [];
  if (!/h2h|confronto|último encontro|ultimo encontro/i.test(text)) return out;
  const re = new RegExp(`(\\d{2}[/.-]\\d{2}(?:[/.-]\\d{2,4})?)?\\s*(${TEAM_TOKEN})\\s+(\\d{1,2})\\s*[xX:\\-]\\s*(\\d{1,2})\\s+(${TEAM_TOKEN})`, "g");
  for (const m of text.matchAll(re)) {
    out.push({
      date: m[1]?.trim(),
      home: m[2].trim(),
      score: `${m[3]}-${m[4]}`,
      away: m[5].trim(),
    });
    if (out.length >= 10) break;
  }
  return out;
}

// ---------- Lineups ----------
export function extractLineups(text: string): { home?: string[]; away?: string[]; homeFormation?: string; awayFormation?: string } {
  if (!/escala[çc][ãa]o|titulares|lineups?/i.test(text)) return {};
  const out: { home?: string[]; away?: string[]; homeFormation?: string; awayFormation?: string } = {};
  const formations = [...text.matchAll(/\b(\d-\d-\d(?:-\d)?)\b/g)].map((m) => m[1]);
  if (formations[0]) out.homeFormation = formations[0];
  if (formations[1]) out.awayFormation = formations[1];
  // Heurística simples: linhas com vários nomes próprios separados por vírgula
  const candidates = text.split(/\r?\n/).filter((l) => {
    const commas = (l.match(/,/g) ?? []).length;
    return commas >= 5 && l.length < 400;
  });
  if (candidates[0]) out.home = candidates[0].split(",").map((s) => s.trim()).filter(Boolean).slice(0, 11);
  if (candidates[1]) out.away = candidates[1].split(",").map((s) => s.trim()).filter(Boolean).slice(0, 11);
  return out;
}

// ---------- Incidents ----------
export function extractIncidents(text: string): Array<{ minute?: number; type?: string; team?: "home" | "away"; detail?: string }> {
  if (!text) return [];
  const out: Array<{ minute?: number; type?: string; team?: "home" | "away"; detail?: string }> = [];
  const re = /(\d{1,3})['m´]\s+(?:-\s+)?(GOL|GOAL|CART[ÃA]O AMARELO|YELLOW|CART[ÃA]O VERMELHO|RED|SUBSTITUI[ÇC][ÃA]O|SUB|P[ÊE]NALTI|PENALTY|VAR)\b[^\n]{0,80}/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[2].toUpperCase();
    const type = /GOL|GOAL/.test(raw) ? "goal"
      : /AMAR|YELLOW/.test(raw) ? "yellow"
      : /VERM|RED/.test(raw) ? "red"
      : /SUB/.test(raw) ? "sub"
      : /P[ÊE]N|PENALTY/.test(raw) ? "penalty"
      : /VAR/.test(raw) ? "var"
      : "other";
    out.push({ minute: parseInt(m[1], 10), type, detail: m[0].trim() });
    if (out.length >= 30) break;
  }
  return out;
}

// ---------- Detector de tipo dominante ----------
export function detectDominantBlock(text: string): "odds" | "stats" | "h2h" | "lineup" | "incidents" | "mixed" {
  if (!text) return "mixed";
  const t = STRIP_ACCENTS(text).toLowerCase();
  const score = {
    odds: +/odd|cotac|cotaç|over|under|1x2|btts|ambas/.test(t) + +/(\d+[.,]\d{2})/.test(t),
    stats: +/posse|finaliz|chutes|escanteios|cartoes|cartões/.test(t),
    h2h: +/h2h|confronto|ultimo encontro|último encontro/.test(t),
    lineup: +/escala|titulares|lineup|formacao|formação/.test(t),
    incidents: +/'?\s+(gol|amarelo|vermelho|substituic|var|penalti)/.test(t),
  };
  let best: keyof typeof score = "odds";
  let bestN = -1;
  for (const k of Object.keys(score) as (keyof typeof score)[]) {
    if (score[k] > bestN) { bestN = score[k]; best = k; }
  }
  if (bestN <= 0) return "mixed";
  return best;
}

// ---------- Orquestrador ----------
export interface ParseInput {
  text?: string | null;
  sourceUrl?: string | null;
}

export interface ParseResult {
  kind: "text" | "url" | "image" | "mixed";
  match?: ReturnType<typeof extractMatch> & { league?: string };
  odds: ReturnType<typeof extractOdds>;
  stats: ReturnType<typeof extractStats>;
  h2h: ReturnType<typeof extractH2H>;
  lineups: ReturnType<typeof extractLineups>;
  incidents: ReturnType<typeof extractIncidents>;
  confidence: number;
  parserVersion: string;
  missingFields: string[];
  note?: string;
}

export function parseSuperbetPayload(input: ParseInput): ParseResult {
  const text = (input.text ?? "").trim();
  const url = (input.sourceUrl ?? "").trim();

  const fromUrl = url ? parseSuperbetUrl(url) : {};
  const fromText = text ? extractMatch(text) : {};
  const match = {
    home: fromText.home ?? fromUrl.home,
    away: fromText.away ?? fromUrl.away,
    league: fromUrl.league,
    minute: fromText.minute,
    score: fromText.score,
  };

  const odds = text ? extractOdds(text) : [];
  const stats = text ? extractStats(text) : {};
  const h2h = text ? extractH2H(text) : [];
  const lineups = text ? extractLineups(text) : {};
  const incidents = text ? extractIncidents(text) : [];

  const missing: string[] = [];
  if (!match.home || !match.away) missing.push("teams");
  if (odds.length === 0) missing.push("odds");
  if (Object.keys(stats).length === 0) missing.push("stats");

  // Confiança: peso por categoria detectada
  let score = 0;
  if (match.home && match.away) score += 0.35;
  if (odds.length > 0) score += Math.min(0.3, odds.length * 0.05);
  if (Object.keys(stats).length > 0) score += Math.min(0.2, Object.keys(stats).length * 0.04);
  if (h2h.length > 0) score += 0.08;
  if (lineups.home?.length || lineups.away?.length) score += 0.05;
  if (incidents.length > 0) score += Math.min(0.1, incidents.length * 0.02);
  const confidence = Math.min(1, score);

  const kind: ParseResult["kind"] =
    text && url ? "mixed" : url ? "url" : text ? "text" : "mixed";

  return {
    kind,
    match,
    odds,
    stats,
    h2h,
    lineups,
    incidents,
    confidence,
    parserVersion: PARSER_VERSION,
    missingFields: missing,
  };
}
