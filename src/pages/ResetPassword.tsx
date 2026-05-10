import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Brain, Loader2, Lock, Eye, EyeOff, Check, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface PasswordRule {
  label: string;
  test: (pwd: string) => boolean;
}

const RULES: PasswordRule[] = [
  { label: 'Mínimo 8 caracteres', test: (p) => p.length >= 8 },
  { label: 'Pelo menos 1 letra maiúscula', test: (p) => /[A-Z]/.test(p) },
  { label: 'Pelo menos 1 letra minúscula', test: (p) => /[a-z]/.test(p) },
  { label: 'Pelo menos 1 número', test: (p) => /\d/.test(p) },
  { label: 'Pelo menos 1 caractere especial (!@#$% etc)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function strengthScore(password: string): number {
  return RULES.reduce((acc, rule) => acc + (rule.test(password) ? 1 : 0), 0);
}

function strengthColor(score: number): string {
  if (score <= 2) return 'bg-destructive';
  if (score <= 3) return 'bg-orange-400';
  if (score <= 4) return 'bg-yellow-400';
  return 'bg-emerald-500';
}

function strengthLabel(score: number): string {
  if (score <= 2) return 'Fraca';
  if (score <= 3) return 'Média';
  if (score <= 4) return 'Boa';
  return 'Forte';
}

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const score = useMemo(() => strengthScore(password), [password]);
  const allRulesMet = score === RULES.length;
  const passwordsMatch = password === confirm && confirm.length > 0;
  const canSubmit = ready && !loading && allRulesMet && passwordsMatch;

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!allRulesMet) {
      setError('A senha não atende todos os requisitos de segurança.');
      return;
    }
    if (!passwordsMatch) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage('Senha atualizada com sucesso! Redirecionando...');
      setTimeout(() => navigate('/'), 1500);
    } catch (err: any) {
      console.error('[RESET] updateUser error:', err);
      setError(err.message || 'Não foi possível atualizar a senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <Brain className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="font-display text-3xl text-foreground tracking-wider">REDEFINIR SENHA</h1>
          <p className="text-xs text-muted-foreground tracking-widest uppercase mt-1">Escolha uma nova senha segura</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-6 space-y-4">
          {!ready && (
            <p className="text-xs text-center text-muted-foreground">
              Validando link de recuperação...
            </p>
          )}

          <div className="space-y-3">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Nova senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-secondary border border-border rounded-lg pl-10 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Strength Meter */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Força da senha</span>
                <span className={`font-semibold ${score === 5 ? 'text-emerald-400' : score <= 2 ? 'text-destructive' : 'text-foreground'}`}>
                  {strengthLabel(score)}
                </span>
              </div>
              <div className="flex gap-1">
                {RULES.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-all ${i < score ? strengthColor(score) : 'bg-muted'}`}
                  />
                ))}
              </div>
            </div>

            {/* Requirements list */}
            <div className="space-y-1.5 bg-secondary/50 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Requisitos</p>
              <ul className="space-y-1">
                {RULES.map((rule, idx) => {
                  const ok = rule.test(password);
                  return (
                    <li key={idx} className="flex items-center gap-2 text-xs">
                      {ok ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                      )}
                      <span className={ok ? 'text-emerald-400' : 'text-muted-foreground'}>
                        {rule.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirmar nova senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full bg-secondary border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {confirm.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                {passwordsMatch ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-emerald-400">Senhas coincidem</span>
                  </>
                ) : (
                  <>
                    <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                    <span className="text-destructive">Senhas não coincidem</span>
                  </>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-destructive text-sm text-center">{error}</p>}
          {message && <p className="text-emerald-400 text-sm text-center">{message}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Atualizar senha
          </button>

          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Voltar ao login
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
