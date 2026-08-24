// 🖼️ Renderiza SVG → PNG dentro do edge runtime (resvg-wasm) e envia como foto
// no Telegram (sendPhoto multipart). Usado pelo broadcast diário de Placar Exato.

import { initWasm, Resvg } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';

const WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
// Fontes TTF estáveis (jsdelivr/npm). URLs do repositório google/fonts retornam
// 404 e faziam o card sair em branco (sem glifos).
const FONT_REGULAR = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf';
const FONT_BOLD = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf';
/** Família disponível nos buffers acima — use-a nos templates SVG. */
export const CARD_FONT = 'DejaVu Sans';

let wasmReady: Promise<void> | null = null;
let fontsCache: Uint8Array[] | null = null;

async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(fetch(WASM_URL)).catch((e) => {
      wasmReady = null;
      throw e;
    });
  }
  return wasmReady;
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fonte indisponível [${r.status}]: ${url}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Um HTML de erro tem poucos KB; fontes reais passam de 50KB.
  if (buf.byteLength < 50_000) throw new Error(`fonte inválida (${buf.byteLength}B): ${url}`);
  return buf;
}

async function loadFonts(): Promise<Uint8Array[]> {
  if (fontsCache) return fontsCache;
  fontsCache = await Promise.all([fetchFont(FONT_REGULAR), fetchFont(FONT_BOLD)]);
  return fontsCache;
}

/** Converte um SVG em PNG. Lança erro se o runtime não suportar. */
export async function svgToPng(svg: string, width = 1080): Promise<Uint8Array> {
  await ensureWasm();
  const fontBuffers = await loadFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontBuffers,
      defaultFontFamily: CARD_FONT,
      sansSerifFamily: CARD_FONT,
      serifFamily: CARD_FONT,
      monospaceFamily: CARD_FONT,
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}


/** Escape para conteúdo textual de SVG. */
export function svgEscape(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(s: string, max: number): string {
  const t = String(s ?? '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Envia foto (bytes PNG) para o Telegram via multipart/form-data. */
export async function sendTelegramPhoto(
  botToken: string,
  chatId: string | number,
  png: Uint8Array,
  caption?: string,
  opts?: { filename?: string; tag?: string },
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const tag = opts?.tag ?? 'TG-PHOTO';
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption && caption.trim()) {
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', 'HTML');
  }
  form.append(
    'photo',
    new Blob([png as unknown as BlobPart], { type: 'image/png' }),
    opts?.filename ?? 'nexus33.png',
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok === true) return { ok: true, status: res.status, data };
      console.error(`[${tag}] falha [${res.status}]: ${JSON.stringify(data)}`);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, data };
      }
    } catch (e) {
      console.error(`[${tag}] erro de rede:`, e instanceof Error ? e.message : e);
      if (attempt === 3) return { ok: false, status: 0, data: null, error: String(e) };
    }
    await new Promise((r) => setTimeout(r, attempt * 1200));
  }
  return { ok: false, status: 0, data: null, error: 'sendPhoto failed' };
}
