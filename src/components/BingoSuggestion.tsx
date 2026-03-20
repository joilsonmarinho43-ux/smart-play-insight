import { useMemo, useState } from 'react';
import { MatchData } from '@/types/match';
import { analyzeMarkets } from '@/lib/matchAnalysis';
import { Sparkles, Trophy, TrendingUp, Copy, ChevronDown, ChevronUp, MessageCircle, Star } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  matches: MatchData[];
}

// 🎯 FORMATAÇÃO PROFISSIONAL PARA WHATSAPP
function generateWhatsappMessage(bingoMatches: any[]): string {
  const header = `🎯 *BINGO REAL — ANALISTA JOILSON*\n*Trade Esportivo Profissional*\n\n`;
  
  const body = bingoMatches.map(bm => {
    const matchHeader = `⚽ *${bm.homeTeam} vs ${bm.awayTeam}*\n`;
    const details = `🏆 ${bm.league || 'Liga'} • ⏰ ${bm.time || 'A definir'}\n`;
    const tips = bm.selectedMarkets.map((m: any) => `✅ *${m.market}* → _${m.probability}%_`).join('\n');
    return `${matchHeader}${details}${tips}\n`;
  }).join('\n');

  const footer = `\n📈 *Total:* ${bingoMatches.length} jogos selecionados\n🚀 _Análise baseada em Poisson & Médias Reais_`;
  
  return header + body + footer;
}

const BingoSuggestion = ({ matches }: Props) => {
  const [expanded, setExpanded] = useState(false);

  // 🔥 PROCESSAMENTO DO BINGO REAL
  const bingoData = useMemo(() => {
    if (!matches || matches.length === 0) return [];

    return matches
      .map(match => {
        // Usa a nova lógica agressiva do matchAnalysis
        const allMarkets = analyzeMarkets(match);
        // Filtra apenas o que é "Elite" para o Bingo (Probabilidade > 70%)
        const eliteMarkets = allMarkets.filter(m => m.probability >= 70);

        return {
          ...match,
          selectedMarkets: eliteMarkets
        };
      })
      .filter(m => m.selectedMarkets.length > 0)
      .slice(0, 12); // Limita aos 12 melhores jogos para o texto não ficar gigante
  }, [matches]);

  if (bingoData.length === 0) return null;

  const handleCopy = () => {
    const text = generateWhatsappMessage(bingoData);
    navigator.clipboard.writeText(text);
    toast.success('Bingo copiado com sucesso!');
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(generateWhatsappMessage(bingoData))}`;

  return (
    <div className="bg-card rounded-2xl border border-primary/40 overflow-hidden mb-6 shadow-lg animate-fade-in">
      {/* HEADER DO BINGO */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-gradient-to-r from-primary/20 to-transparent px-4 py-4 flex items-center justify-between cursor-pointer hover:bg-primary/25 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="bg-primary p-2 rounded-lg">
            <Trophy className="w-5 h-5 text-black" />
          </div>
          <div>
            <h2 className="text-base font-bold text-primary tracking-tight">BINGO REAL</h2>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold">Seleção de Valor • {bingoData.length} Jogos</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
           {expanded ? <ChevronUp className="text-primary" /> : <ChevronDown className="text-primary" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-3 bg-secondary/20 border-t border-primary/10">
          {bingoData.map((bm, idx) => (
            <div key={idx} className="bg-background/40 border border-border/50 rounded-xl p-3">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="text-sm font-bold leading-tight">{bm.homeTeam} <span className="text-primary/50 text-xs">vs</span> {bm.awayTeam}</h3>
                  <p className="text-[10px] text-muted-foreground mt-1">{bm.league} • {bm.time}</p>
                </div>
                <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
              </div>

              <div className="space-y-1.5">
                {bm.selectedMarkets.map((m: any, i: number) => (
                  <div key={i} className="flex justify-between items-center bg-primary/5 px-2 py-1.5 rounded-lg border border-primary/10">
                    <span className="text-xs font-medium">{m.market}</span>
                    <span className="text-xs font-bold text-primary">{m.probability}%</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AÇÕES */}
      <div className="px-4 py-3 bg-secondary/40 flex items-center justify-between border-t border-border/50">
        <span className="text-[10px] text-muted-foreground italic">Atualizado via API Pro</span>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 bg-secondary border border-border px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-secondary/80 transition-all"
          >
            <Copy className="w-3 h-3" /> Copiar
          </button>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 bg-green-500 text-black px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-green-400 transition-all"
          >
            <MessageCircle className="w-4 h-4" /> Enviar WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
};

export default BingoSuggestion;
                    
