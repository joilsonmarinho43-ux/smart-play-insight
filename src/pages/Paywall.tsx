import { Brain, MessageCircle, LogOut, Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';

const Paywall = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();

  const expiryDate = profile?.subscription_expiry_date
    ? new Date(profile.subscription_expiry_date).toLocaleDateString('pt-BR')
    : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Brain className="w-14 h-14 text-primary mx-auto mb-3" />
          <h1 className="font-display text-3xl text-foreground tracking-wider">ANALISTA JOILSON</h1>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 space-y-6 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <Clock className="w-8 h-8 text-destructive" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">
              {expiryDate ? 'Acesso Expirado' : 'Acesso Pendente'}
            </h2>
            <p className="text-muted-foreground text-sm">
              {expiryDate
                ? `Sua assinatura expirou em ${expiryDate}.`
                : 'Sua conta ainda não foi liberada pelo administrador.'}
            </p>
          </div>

          <div className="bg-secondary rounded-xl p-4 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Plano mensal</p>
            <p className="text-3xl font-bold text-primary font-display tracking-wider">R$ 50,00</p>
            <p className="text-xs text-muted-foreground">Acesso completo por 30 dias</p>
          </div>

          <a
            href="https://wa.me/5591986215730?text=Olá,%20gostaria%20de%20ativar%20meu%20acesso%20ao%20Analista%20Pro%208.0.%20Meu%20e-mail:%20"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-[hsl(145_60%_45%)] text-[hsl(220_20%_10%)] py-3 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity"
          >
            <MessageCircle className="w-5 h-5" />
            Solicitar Acesso via WhatsApp
          </a>

          <button
            onClick={() => signOut()}
            className="flex items-center justify-center gap-2 w-full text-muted-foreground hover:text-foreground py-2 text-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
};

export default Paywall;
