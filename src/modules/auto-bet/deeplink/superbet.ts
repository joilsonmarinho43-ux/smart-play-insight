// ============================================================
// Superbet deep-link builder
// IMPORTANTE: a Superbet não expõe API pública para pré-montar
// bilhete. O que conseguimos com segurança é abrir a busca pelo
// nome do confronto, levando o usuário ao mercado certo em 1 toque.
// Quando a casa publicar um schema oficial, é só trocar aqui.
// ============================================================

import { SUPPORTED_HOUSES, type HouseId } from "../config";

export interface DeepLinkInput {
  house: HouseId;
  matchName: string;     // "Flamengo x Palmeiras"
  market?: string;       // "Over 2.5 FT"
}

export function buildDeepLink({ house, matchName, market }: DeepLinkInput): string {
  const base = SUPPORTED_HOUSES.find((h) => h.id === house)?.baseUrl ?? "";
  if (!base) return "";

  // Superbet: usar busca interna. Termo = times + mercado (opcional).
  const term = [matchName, market].filter(Boolean).join(" ").trim();
  const q = encodeURIComponent(term);

  // /pesquisa?q=... funciona tanto no app web quanto no site
  return `${base}/pesquisa?q=${q}`;
}
