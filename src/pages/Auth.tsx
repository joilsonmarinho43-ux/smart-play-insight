import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Brain, Loader2, Mail, Lock, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          console.error('[AUTH] signIn error:', error);
          throw error;
        }
        navigate('/');
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) {
          console.error('[AUTH] signUp error:', error);
          throw error;
        }
        navigate('/');
      }
    } catch (err: any) {
      let msg = err.message || 'Erro inesperado';
      if (err.message === 'Invalid login credentials') {
        msg = 'E-mail ou senha incorretos.';
      } else if (err.message?.includes('User already registered')) {
        msg = 'E-mail já cadastrado. Faça login.';
      } else if (err.message?.includes('Password should be')) {
        msg = 'Senha muito curta (mínimo 6 caracteres).';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <Brain className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="font-display text-3xl text-foreground tracking-wider">ANALISTA JOILSON</h1>
          <p className="text-xs text-muted-foreground tracking-widest uppercase mt-1">Modelo Híbrido Ponderado</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground text-center">
            {isLogin ? 'Entrar' : 'Criar conta'}
          </h2>

          <div className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-secondary border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                placeholder="Senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-secondary border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {error && <p className="text-destructive text-sm text-center">{error}</p>}
          {message && <p className="text-accent text-sm text-center">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isLogin ? 'Entrar' : 'Cadastrar'}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? 'Não tem conta?' : 'Já tem conta?'}{' '}
            <button
              type="button"
              onClick={() => { setIsLogin(!isLogin); setError(''); setMessage(''); }}
              className="text-primary font-medium hover:underline"
            >
              {isLogin ? 'Cadastre-se' : 'Entrar'}
            </button>
          </p>
        </form>

        <a
          href="https://t.me/sinais_joilson"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-[#229ED9] to-[#1d8bbf] hover:from-[#1d8bbf] hover:to-[#1879a8] text-white font-bold py-2.5 rounded-lg shadow-lg shadow-[#229ED9]/30 transition-all text-sm"
        >
          <MessageCircle className="w-4 h-4" />
          Entrar no grupo do Telegram
        </a>

        <a
          href="https://wa.me/5591986215730?text=Olá,%20preciso%20de%20suporte%20no%20Analista%20Joilson."
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <MessageCircle className="w-4 h-4" />
          Falar com suporte no WhatsApp
        </a>
      </div>
    </div>
  );
};

export default Auth;
