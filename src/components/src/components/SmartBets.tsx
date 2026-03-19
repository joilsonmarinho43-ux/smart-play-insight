import { useMemo } from 'react';
import { generateSmartBets } from '@/lib/bingoEngine';
import { Ticket, Copy, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  matches: any[];
}

function formatText(tickets: any[]) {
  const lines = ['🎯 *MULTI-BILHETES INTELIGENTES*', ''];

  tickets.forEach((t, i) => {
    lines.push(`🧾 *Bilhete ${i + 1}*`);

    t.picks.forEach((p: any) => {
      lines.push(
        `⚽ ${p.match.homeTeam} vs ${p.match.awayTeam}`
      );
      lines.push(`👉 ${p.market} (${p.probability}%)`);
    });

    lines.push(`🔥 Probabilidade Final: *${t.probability}%*`);
    lines.push('');
  });

  return lines.join('\n');
}

const SmartBets = ({ matches }: Props) => {
  const tickets = useMemo(() => {
    return generateSmartBets(matches);
  }, [matches]);

  if (!tickets.length) return null;

  return (
    <div className="bg-card border border-green-500/30 rounded-2xl p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Ticket className="text-green-400" />
        <h2 className="text-green-400 font-bold text-lg">
          MULTI-BILHETES
        </h2>
      </div>

      <div className="space-y-3">
        {tickets.map((t, i) => (
          <div key={i} className="border rounded-lg p-3">
            <div className="text-sm font-bold mb-2">
              Bilhete {i + 1}
            </div>

            {t.picks.map((p: any, j: number) => (
              <div key={j} className="flex justify-between text-xs mb-1">
                <span>
                  {p.match.homeTeam} vs {p.match.awayTeam}
                </span>
                <span className="text-green-400">
                  {p.market}
                </span>
              </div>
            ))}

            <div className="mt-2 text-right text-green-400 font-bold">
              {t.probability}%
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={() => {
            const text = formatText(tickets);
            navigator.clipboard.writeText(text);
            toast.success('Bilhetes copiados!');
          }}
          className="text-xs bg-green-500/20 px-3 py-1 rounded"
        >
          <Copy className="w-3 h-3 inline" /> Copiar
        </button>

        <a
          href={`https://wa.me/?text=${encodeURIComponent(formatText(tickets))}`}
          target="_blank"
        >
          <MessageCircle className="w-4 h-4 text-green-400" />
        </a>
      </div>
    </div>
  );
};

export default SmartBets;
