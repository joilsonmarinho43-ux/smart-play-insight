import { Search, ExternalLink, Copy, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * Módulo independente: "🔎 Encontrar este jogo na casa de aposta"
 * NÃO interfere em nenhuma lógica de leitura, análise, probabilidade,
 * confiança, estatísticas, tendências, sinais ou motor de IA.
 * Função única: sugerir variações de nomes de times usadas por casas de
 * apostas e abrir buscas rápidas nas principais casas.
 */

interface Props {
  homeTeam: string;
  awayTeam: string;
}

// Sufixos/prefixos comuns que casas costumam remover/abreviar
const STRIP_TOKENS = [
  "FC", "F.C.", "CF", "C.F.", "AC", "A.C.", "SC", "S.C.",
  "EC", "E.C.", "AFC", "BK", "IF", "CD", "CSD", "AD", "SE",
  "Club", "Clube", "Atlético", "Atletico", "Athletic",
  "Sporting", "Real", "Deportivo", "United", "City",
  "de", "do", "da", "the", "of",
];

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function generateVariants(team: string): string[] {
  const variants = new Set<string>();
  const original = team.trim();
  if (!original) return [];

  variants.add(original);
  variants.add(stripAccents(original));

  // Remove tokens comuns
  let tokens = original.split(/\s+/);
  const filtered = tokens.filter(
    (t) => !STRIP_TOKENS.some((s) => s.toLowerCase() === t.toLowerCase()),
  );
  if (filtered.length && filtered.join(" ") !== original) {
    variants.add(filtered.join(" "));
    variants.add(stripAccents(filtered.join(" ")));
  }

  // Primeira palavra (apelido comum)
  if (tokens[0] && tokens[0].length >= 3) {
    variants.add(tokens[0]);
  }

  // Sem hífens/pontos
  const clean = original.replace(/[.\-]/g, " ").replace(/\s+/g, " ").trim();
  if (clean !== original) variants.add(clean);

  // Abreviação por iniciais (se múltiplas palavras significativas)
  if (filtered.length >= 2) {
    const initials = filtered.map((t) => t[0]?.toUpperCase()).join("");
    if (initials.length >= 2 && initials.length <= 4) variants.add(initials);
  }

  return Array.from(variants).filter(Boolean).slice(0, 6);
}

// URLs de busca interna das casas de aposta (Brasil).
// O usuário já está logado — a página de busca abre direto na conta dele
// e mostra os jogos correspondentes ao nome buscado.
const BOOKMAKERS: { name: string; build: (q: string) => string }[] = [
  {
    name: "Bet365",
    build: (q) => `https://www.bet365.bet.br/#/AS/B1/C1/D1002/E${encodeURIComponent(q)}/F2/`,
  },
  {
    name: "Betano",
    build: (q) => `https://www.betano.bet.br/search/?query=${encodeURIComponent(q)}`,
  },
  {
    name: "Superbet",
    build: (q) => `https://superbet.bet.br/pesquisa?query=${encodeURIComponent(q)}`,
  },
  {
    name: "Sportingbet",
    build: (q) =>
      `https://sports.sportingbet.bet.br/pt-br/search?query=${encodeURIComponent(q)}`,
  },
  {
    name: "Betfair",
    build: (q) =>
      `https://www.betfair.bet.br/sport/search?query=${encodeURIComponent(q)}`,
  },
  {
    name: "KTO",
    build: (q) => `https://www.kto.bet.br/search?q=${encodeURIComponent(q)}`,
  },
  {
    name: "Pinnacle",
    build: (q) => `https://www.pinnacle.com/en/search/#?q=${encodeURIComponent(q)}`,
  },
  {
    name: "Google",
    build: (q) => `https://www.google.com/search?q=${encodeURIComponent(q + " odds")}`,
  },
];

function buildSearchUrl(query: string, build: (q: string) => string) {
  return build(query);
}

export const BookmakerFinder = ({ homeTeam, awayTeam }: Props) => {
  const homeVariants = useMemo(() => generateVariants(homeTeam), [homeTeam]);
  const awayVariants = useMemo(() => generateVariants(awayTeam), [awayTeam]);

  const [selHome, setSelHome] = useState(homeVariants[0] || homeTeam);
  const [selAway, setSelAway] = useState(awayVariants[0] || awayTeam);

  const query = `${selHome} vs ${selAway}`;

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-primary" />
        <h3 className="text-xs uppercase tracking-wider font-bold text-foreground">
          🔎 Encontrar este jogo na casa de aposta
        </h3>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Casas de apostas costumam usar variações nos nomes dos times. Escolha a
        variação mais provável e busque diretamente na sua casa preferida.
      </p>

      {/* Variantes do mandante */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Mandante — possíveis nomes
        </div>
        <div className="flex flex-wrap gap-1.5">
          {homeVariants.map((v) => (
            <button
              key={v}
              onClick={() => setSelHome(v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                selHome === v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background/40 text-foreground/80 border-border hover:bg-background/70"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Variantes do visitante */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Visitante — possíveis nomes
        </div>
        <div className="flex flex-wrap gap-1.5">
          {awayVariants.map((v) => (
            <button
              key={v}
              onClick={() => setSelAway(v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                selAway === v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background/40 text-foreground/80 border-border hover:bg-background/70"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Busca atual */}
      <div className="rounded-lg bg-background/40 border border-border px-3 py-2 text-xs">
        <span className="text-muted-foreground">Buscando: </span>
        <span className="font-bold text-foreground">{query}</span>
      </div>

      {/* Botões das casas */}
      <div className="grid grid-cols-2 gap-2">
        {BOOKMAKERS.map((b) => (
          <a
            key={b.name}
            href={buildSearchUrl(query, b.build)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 text-xs font-bold text-foreground transition-colors"
          >
            <span>{b.name}</span>
            <ExternalLink className="w-3 h-3 opacity-70" />
          </a>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        Módulo auxiliar — não influencia análises, probabilidades ou sinais.
      </p>
    </div>
  );
};
