// Superbet Connect — OCR client-side (Fase 3)
// Tesseract.js v5 WASM. Pré-processa imagem com Canvas (grayscale + contraste)
// para melhorar leitura de odds/estatísticas. Devolve texto + confiança média.
//
// O worker é lazy — só baixa modelos quando o usuário envia imagem.

import { createWorker, type Worker } from 'tesseract.js';
import { OCR_LANGS } from '../config';

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(OCR_LANGS, 1, {
      // logger: (m) => console.debug('[ocr]', m),
    });
  }
  return workerPromise;
}

export interface OcrResult {
  text: string;
  confidence: number; // 0–100
  width: number;
  height: number;
  durationMs: number;
}

export async function preprocessToDataUrl(file: File | Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await fileToImage(file);
  const maxW = 1600;
  const scale = img.width > maxW ? maxW / img.width : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(img, 0, 0, w, h);

  // Grayscale + threshold suave para texto sobre fundo dark
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    // ganho de contraste em torno de 128
    const v = Math.max(0, Math.min(255, (y - 128) * 1.45 + 128));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
}

async function fileToImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image_decode_failed'));
      img.src = url;
    });
  } finally {
    // revoga depois do próximo frame para garantir que decodeImage terminou
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function runOcr(file: File | Blob): Promise<OcrResult> {
  const started = performance.now();
  const { dataUrl, width, height } = await preprocessToDataUrl(file);
  const worker = await getWorker();
  const { data } = await worker.recognize(dataUrl);
  return {
    text: (data.text ?? '').trim(),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
    width,
    height,
    durationMs: Math.round(performance.now() - started),
  };
}

export async function fileToBase64(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as never);
  }
  return btoa(binary);
}

export async function terminateOcr() {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch { /* noop */ }
  workerPromise = null;
}
