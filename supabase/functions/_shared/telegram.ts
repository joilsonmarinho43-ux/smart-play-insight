// ═══════════════════════════════════════════════════════════════
// Telegram Bot API direto — sem connector-gateway.
// Helper compartilhado por todas edge functions.
// ═══════════════════════════════════════════════════════════════

const MAX_ATTEMPTS = 4;
const RETRY_DELAYS = [500, 1500, 3500];

export type TelegramResult = { ok: boolean; status: number; data: any; error?: string };

/** Escape HTML para parse_mode=HTML do Telegram (apenas &, <, > são obrigatórios). */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getTelegramBotToken(): string {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || Deno.env.get('TELEGRAM_API_KEY');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN/TELEGRAM_API_KEY not configured');
  return token;
}

/** Detecta erros permanentes do Telegram (não vale a pena tentar de novo). */
function isPermanentTelegramError(status: number, data: any): boolean {
  if (status === 400 || status === 401 || status === 403 || status === 404) return true;
  const desc = (data?.description || '').toString().toLowerCase();
  if (desc.includes('bot was blocked')) return true;
  if (desc.includes('chat not found')) return true;
  if (desc.includes('user is deactivated')) return true;
  if (desc.includes('message is not modified')) return true; // tratado como sucesso pelo caller
  return false;
}

async function callTelegram(method: string, botToken: string, body: Record<string, unknown>): Promise<TelegramResult> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data?.ok === true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : 'network error' };
  }
}

/** Wrapper genérico com retry exponencial + respeito a retry_after. */
export async function telegramRequest(
  method: 'sendMessage' | 'editMessageText',
  body: Record<string, unknown>,
  opts?: { botToken?: string; tag?: string },
): Promise<TelegramResult> {
  const botToken = opts?.botToken ?? getTelegramBotToken();
  const tag = opts?.tag ?? 'TG';
  let last: TelegramResult = { ok: false, status: 0, data: null };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await callTelegram(method, botToken, body);
    if (last.ok) {
      if (attempt > 1) console.log(`[${tag}] ✅ Telegram ${method} ok na tentativa ${attempt}`);
      return last;
    }

    // "message is not modified" → tratamos como sucesso lógico para edits
    const desc = (last.data?.description || '').toString();
    if (method === 'editMessageText' && desc.toLowerCase().includes('message is not modified')) {
      return { ok: true, status: last.status, data: { ...last.data, ok: true, _notModified: true } };
    }

    if (isPermanentTelegramError(last.status, last.data)) {
      console.error(`[${tag}] ❌ Telegram ${method} erro permanente [${last.status}]: ${desc || JSON.stringify(last.data)}`);
      return last;
    }

    let delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
    if (last.status === 429 && last.data?.parameters?.retry_after) {
      delay = Math.max(delay, Number(last.data.parameters.retry_after) * 1000);
    }
    const isTransient =
      last.status === 0 ||
      last.status === 429 ||
      last.status === 500 ||
      last.status === 502 ||
      last.status === 503 ||
      last.status === 504;

    if (!isTransient || attempt === MAX_ATTEMPTS) {
      console.error(`[${tag}] ❌ Telegram ${method} falhou [${last.status}] tentativa ${attempt}: ${desc || last.error || JSON.stringify(last.data)}`);
      return last;
    }
    console.log(`[${tag}] ⚠️ Telegram ${method} falhou [${last.status}] tentativa ${attempt}, retry em ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
  }
  return last;
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  opts?: { botToken?: string; tag?: string; parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown'; disablePreview?: boolean },
): Promise<TelegramResult> {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts?.parseMode ?? 'HTML',
    disable_web_page_preview: opts?.disablePreview ?? true,
  }, { botToken: opts?.botToken, tag: opts?.tag });
}

export async function editTelegramMessage(
  chatId: string | number,
  messageId: number | bigint,
  text: string,
  opts?: { botToken?: string; tag?: string; parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown'; disablePreview?: boolean },
): Promise<TelegramResult> {
  return telegramRequest('editMessageText', {
    chat_id: chatId,
    message_id: typeof messageId === 'bigint' ? Number(messageId) : messageId,
    text,
    parse_mode: opts?.parseMode ?? 'HTML',
    disable_web_page_preview: opts?.disablePreview ?? true,
  }, { botToken: opts?.botToken, tag: opts?.tag });
}
