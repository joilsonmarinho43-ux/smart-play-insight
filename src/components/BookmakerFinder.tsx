import { Search, ExternalLink, Copy, Check, ChevronRight } from "lucide-react";
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
  const tokens = original.split(/\s+/);
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
  const clean = original
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean !== original) variants.add(clean);

  // Remove categorias/sufixos que algumas casas escondem ou padronizam diferente
  const withoutCategory = clean
    .replace(/\b(U\d{2}|Sub\s?\d{2}|Women|Feminino|Feminina|Reserves?|Reservas|B)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutCategory && withoutCategory !== clean) {
    variants.add(withoutCategory);
    variants.add(stripAccents(withoutCategory));
  }

  // Apelidos/formatos curtos comuns em odds
  const aliasRules: Array<[RegExp, string]> = [
    [/\bManchester United\b/i, "Man United"],
    [/\bManchester City\b/i, "Man City"],
    [/\bInternazionale\b|\bInter Milano\b/i, "Inter Milan"],
    [/\bAtl[eé]tico Madrid\b/i, "Atletico Madrid"],
    [/\bAtl[eé]tico Mineiro\b/i, "Atletico MG"],
    [/\bAthletico Paranaense\b/i, "Athletico PR"],
    [/\bSão Paulo\b/i, "Sao Paulo"],
    [/\bSantos FC\b/i, "Santos"],
  ];
  aliasRules.forEach(([rule, alias]) => {
    if (rule.test(original)) variants.add(alias);
  });

  // Abreviação por iniciais (se múltiplas palavras significativas)
  if (filtered.length >= 2) {
    const initials = filtered.map((t) => t[0]?.toUpperCase()).join("");
    if (initials.length >= 2 && initials.length <= 4) variants.add(initials);
  }

  return Array.from(variants).filter(Boolean).slice(0, 6);
}

// Cada casa de aposta protege suas URLs internas de busca (mudam, expiram e
// dão 404 quando acessadas de fora). A abordagem confiável é abrir a HOME
// da casa — onde você já está logado — e colar o nome do jogo na busca
// interna do próprio site. Por isso copiamos o nome automaticamente.
const BOOKMAKERS: { name: string; url: string }[] = [
  { name: "Bet365", url: "https://www.bet365.bet.br/" },
  { name: "Betano", url: "https://www.betano.bet.br/" },
  { name: "Superbet", url: "https://superbet.bet.br/" },
  { name: "Sportingbet", url: "https://sports.sportingbet.bet.br/pt-br" },
  { name: "Betfair", url: "https://www.betfair.bet.br/" },
  { name: "KTO", url: "https://www.kto.bet.br/" },
  { name: "Pinnacle", url: "https://www.pinnacle.com/" },
  { name: "Esportes da Sorte", url: "https://esportesdasorte.bet.br/" },
];

export const BookmakerFinder = ({ homeTeam, awayTeam }: Props) => {
  const homeVariants = useMemo(() => generateVariants(homeTeam), [homeTeam]);
  const awayVariants = useMemo(() => generateVariants(awayTeam), [awayTeam]);

  const [selHome, setSelHome] = useState(homeVariants[0] || homeTeam);
  const [selAway, setSelAway] = useState(awayVariants[0] || awayTeam);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  const query = `${selHome} vs ${selAway}`;
  const searchSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    const homeMain = homeVariants[0] || homeTeam;
    const awayMain = awayVariants[0] || awayTeam;

    suggestions.add(`${selHome} vs ${selAway}`);
    suggestions.add(`${selHome} x ${selAway}`);
    suggestions.add(`${selHome} - ${selAway}`);
    suggestions.add(`${selHome} ${selAway}`);
    suggestions.add(`${homeMain} vs ${awayMain}`);
    suggestions.add(`${homeMain} x ${awayMain}`);
    suggestions.add(`${homeMain} - ${awayMain}`);
    suggestions.add(`${homeMain} ${awayMain}`);
    homeVariants.slice(0, 3).forEach((h) => {
      awayVariants.slice(0, 3).forEach((a) => {
        suggestions.add(`${h} vs ${a}`);
        suggestions.add(`${h} x ${a}`);
        suggestions.add(`${h} - ${a}`);
        suggestions.add(`${h} ${a}`);
      });
    });
    suggestions.add(selHome);
    suggestions.add(selAway);

    return Array.from(suggestions).filter(Boolean).slice(0, 14);
  }, [awayTeam, awayVariants, homeTeam, homeVariants, selAway, selHome]);

  const searchPack = searchSuggestions.join("\n");
  const activeSearch = searchSuggestions[activeSearchIndex] || query;

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`"${text}" copiado — cole na busca da casa`);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const handleOpenBookmaker = async (b: { name: string; url: string }) => {
    window.open(b.url, "_blank", "noopener,noreferrer");
    toast.success(`${b.name} aberto. Agora copie uma das buscas sugeridas.`, { duration: 3500 });
  };

  const handleCopyNext = async () => {
    const text = searchSuggestions[activeSearchIndex] || query;
    await handleCopy(text, "guided");
    setActiveSearchIndex((current) => (current + 1) % Math.max(searchSuggestions.length, 1));
  };

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-primary" />
        <h3 className="text-xs uppercase tracking-wider font-bold text-foreground">
          🔎 Encontrar este jogo na casa de aposta
        </h3>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Abra a casa onde você já está logado e teste as buscas sugeridas. Nada é copiado sozinho:
        você escolhe qual variação usar.
      </p>

      {/* Busca guiada */}
      <div className="rounded-lg bg-background/40 border border-primary/30 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Busca guiada
            </div>
            <div className="text-sm font-bold text-foreground truncate">{activeSearch}</div>
          </div>
          <button
            onClick={handleCopyNext}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary/15 border border-primary/30 text-[10px] uppercase tracking-wider text-primary hover:bg-primary/25 transition-colors"
          >
            {copied === "guided" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copiar próxima
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Se não achar, volte aqui e toque novamente para copiar outra variação.
        </div>
      </div>

      {/* Variantes do mandante */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mandante — possíveis nomes
          </div>
          <button
            onClick={() => handleCopy(selHome, "home")}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary hover:opacity-80"
          >
            {copied === "home" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copiar
          </button>
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
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Visitante — possíveis nomes
          </div>
          <button
            onClick={() => handleCopy(selAway, "away")}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary hover:opacity-80"
          >
            {copied === "away" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copiar
          </button>
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

      {/* Confronto selecionado */}
      <div className="rounded-lg bg-background/40 border border-border px-3 py-2 text-xs flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-muted-foreground">Confronto selecionado: </span>
          <span className="font-bold text-foreground truncate">{query}</span>
        </div>
        <button
          onClick={() => handleCopy(query, "full")}
          className="shrink-0 flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary hover:opacity-80"
        >
          {copied === "full" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          Copiar
        </button>
      </div>

      {/* Pacote de buscas alternativas */}
      <div className="rounded-lg bg-background/40 border border-border px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Buscas alternativas
          </div>
          <button
            onClick={() => handleCopy(searchPack, "pack")}
            className="shrink-0 flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary hover:opacity-80"
          >
            {copied === "pack" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copiar tudo
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {searchSuggestions.slice(0, 6).map((s, index) => (
            <button
              key={`${s}-${index}`}
              onClick={() => handleCopy(s, `suggestion-${index}`)}
              className="max-w-full px-2.5 py-1 rounded-md text-[11px] font-medium border border-border bg-background/40 text-foreground/80 hover:bg-background/70 transition-colors truncate"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Botões das casas */}
      <div className="grid grid-cols-2 gap-2">
        {BOOKMAKERS.map((b) => (
          <button
            key={b.name}
            onClick={() => handleOpenBookmaker(b)}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/30 text-xs font-bold text-foreground transition-colors"
          >
            <span className="truncate">{b.name}</span>
            <ExternalLink className="w-3 h-3 opacity-70 shrink-0" />
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground italic leading-relaxed">
        💡 Casas de aposta bloqueiam links de busca externos (geram 404).
        Por isso o método mais seguro é abrir a casa e testar variações do nome
        dentro da busca interna. Módulo auxiliar — não influencia
        análises, probabilidades ou sinais.
      </p>
    </div>
  );
};
