import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Flame, AlertTriangle, Target, TrendingUp, Clock, Trophy, LineChart } from 'lucide-react';
import type { MatchReading } from '@/lib/matchReading';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reading: MatchReading | null;
  homeTeam: string;
  awayTeam: string;
}

const Section = ({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="bg-secondary/40 border border-border rounded-xl p-3.5">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-4 h-4 text-primary" />
      <h3 className="text-xs uppercase tracking-wider font-bold text-foreground">{title}</h3>
    </div>
    <div className="text-[15px] text-foreground leading-relaxed">{children}</div>
  </div>
);

export const MatchReadingModal = ({ open, onOpenChange, reading, homeTeam, awayTeam }: Props) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[88vh] overflow-y-auto bg-background border-primary/20 p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle className="font-display text-xl tracking-wide">
            📖 Leitura do Jogo
          </DialogTitle>
          <div className="text-xs text-muted-foreground">
            {homeTeam} <span className="opacity-60">vs</span> {awayTeam}
          </div>
        </DialogHeader>

        {!reading && (
          <div className="text-center text-sm text-foreground/80 py-10 px-4">
            <div className="text-foreground font-bold mb-1">Dados insuficientes</div>
            Esta partida ainda não possui histórico estatístico suficiente para gerar uma leitura real.
            <div className="text-xs text-muted-foreground mt-2">
              A análise só é exibida quando há médias confirmadas de gols, escanteios e amostra de jogos.
            </div>
          </div>
        )}

        {reading && (
          <div className="space-y-3 mt-2">
            <Section icon={LineChart} title="Resumo da Partida">
              <p>{reading.summary}</p>
            </Section>

            <Section icon={TrendingUp} title="Indicadores Encontrados">
              <ul className="space-y-1">
                {reading.indicators.map((i, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-primary">✔</span>
                    <span>{i}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section icon={Target} title="Leitura do Mercado">
              <p>{reading.marketRead}</p>
            </Section>

            <Section icon={Flame} title="Melhores Oportunidades">
              <div className="space-y-2.5">
                {reading.opportunities.map((op, k) => (
                  <div key={k} className="rounded-lg bg-secondary border border-primary/40 p-3">
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <span className="font-bold text-foreground text-base">
                        {k === 0 ? '🔥 ' : ''}
                        {op.market}
                      </span>
                      <span className="text-sm font-display font-bold px-2 py-0.5 rounded-md bg-primary text-primary-foreground">
                        {op.confidence}%
                      </span>
                    </div>
                    <ul className="text-sm text-foreground/80 space-y-0.5">
                      {op.reasons.map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>

            <Section icon={AlertTriangle} title="Alertas Importantes">
              <ul className="space-y-1">
                {reading.alerts.map((a, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-primary">⚠</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section icon={Trophy} title="Placares Prováveis">
              <div className="flex gap-2 flex-wrap">
                {reading.likelyScores.map((s, k) => (
                  <span
                    key={k}
                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-display font-bold text-base"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </Section>

            <Section icon={Clock} title="Timing da Partida">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-xs uppercase text-foreground/70 tracking-wider mb-1">
                    Maior pressão
                  </div>
                  <div className="font-display text-foreground text-lg">{reading.timing.pressure}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-foreground/70 tracking-wider mb-1">
                    Aceleração ofensiva
                  </div>
                  <div className="font-display text-foreground text-lg">{reading.timing.acceleration}</div>
                </div>
              </div>
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
