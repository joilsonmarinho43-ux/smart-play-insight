import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile, Profile } from '@/hooks/useProfile';
import { Navigate, Link } from 'react-router-dom';
import { Brain, ArrowLeft, Loader2, CalendarPlus, XCircle, Search, Users, CheckCircle2, Clock, AlertTriangle, Eye, Send, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const DAYS_OPTIONS = [3, 7, 15, 30];

interface SessionConflict {
  id: string;
  user_email: string;
  old_device_info: string;
  new_device_info: string;
  created_at: string;
  seen: boolean;
}

interface TelegramSignal {
  id: string;
  match_name: string;
  market: string;
  confidence: number;
  filters_validated: string | null;
  sensitivity: string | null;
  minute: number;
  score: string | null;
  poisson: string | null;
  reason: string | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
  status: string;
  telegram_message_id: number | null;
  match_id: string | null;
}

const Admin = () => {
  const { profile, loading: profileLoading } = useProfile();
  const [users, setUsers] = useState<Profile[]>([]);
  const [conflicts, setConflicts] = useState<SessionConflict[]>([]);
  const [signals, setSignals] = useState<TelegramSignal[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showSignals, setShowSignals] = useState(false);
  const [checkingResults, setCheckingResults] = useState(false);

  useEffect(() => {
    if (profile?.is_admin) {
      fetchUsers();
      fetchConflicts();
      fetchSignals();
    }
  }, [profile]);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Erro ao carregar banco de dados');
    } else if (data) {
      setUsers(data as Profile[]);
    }
    setLoading(false);
  };

  const fetchConflicts = async () => {
    const { data } = await supabase
      .from('session_conflicts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50) as { data: SessionConflict[] | null };

    if (data) {
      setConflicts(data);
    }
  };

  const fetchSignals = async () => {
    const { data } = await supabase
      .from('telegram_signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100) as { data: TelegramSignal[] | null };

    if (data) {
      setSignals(data);
    }
  };

  const markConflictsSeen = async () => {
    const unseenIds = conflicts.filter(c => !c.seen).map(c => c.id);
    if (unseenIds.length === 0) return;

    await supabase
      .from('session_conflicts')
      .update({ seen: true })
      .in('id', unseenIds);

    setConflicts(prev => prev.map(c => ({ ...c, seen: true })));
  };

  const grantDays = async (userId: string, days: number) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const now = new Date();
    const currentExpiry = user.subscription_expiry_date ? new Date(user.subscription_expiry_date) : new Date();
    const baseDate = currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from('profiles')
      .update({ subscription_expiry_date: newExpiry.toISOString() })
      .eq('id', userId);

    if (error) {
      toast.error('Erro na atualização');
    } else {
      toast.success(`Acesso estendido para ${user.email}`);
      fetchUsers();
    }
  };

  const revokeAccess = async (userId: string) => {
    const { error } = await supabase
      .from('profiles')
      .update({ subscription_expiry_date: null })
      .eq('id', userId);

    if (!error) {
      toast.success('Acesso removido');
      fetchUsers();
    }
  };

  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: users.length,
    active: users.filter(u => u.subscription_expiry_date && new Date(u.subscription_expiry_date) > new Date()).length,
    expired: users.filter(u => u.subscription_expiry_date && new Date(u.subscription_expiry_date) <= new Date()).length
  };

  const unseenConflicts = conflicts.filter(c => !c.seen).length;
  const signalStats = {
    total: signals.length,
    success: signals.filter(s => s.success).length,
    failed: signals.filter(s => !s.success).length,
  };

  if (profileLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  if (!profile?.is_admin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-foreground">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 hover:bg-white/5 rounded-full transition-all"><ArrowLeft className="w-5 h-5" /></Link>
            <div className="flex items-center gap-2">
              <Brain className="w-6 h-6 text-primary" />
              <h1 className="font-bold text-xl tracking-tight">CENTRAL DO ANALISTA</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowSignals(!showSignals); setShowConflicts(false); }}
              className={`relative p-2 rounded-lg transition-all ${showSignals ? 'bg-blue-500/20' : 'hover:bg-white/5'}`}
              title="Sinais Telegram"
            >
              <Send className="w-5 h-5 text-blue-400" />
              {signalStats.total > 0 && (
                <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {signalStats.total > 99 ? '99+' : signalStats.total}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setShowConflicts(!showConflicts);
                setShowSignals(false);
                if (!showConflicts) markConflictsSeen();
              }}
              className={`relative p-2 rounded-lg transition-all ${showConflicts ? 'bg-yellow-500/20' : 'hover:bg-white/5'}`}
            >
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              {unseenConflicts > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {unseenConflicts}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8">
        {/* ALERTAS DE COMPARTILHAMENTO */}
        {showConflicts && (
          <div className="mb-8 space-y-3">
            <h2 className="text-sm font-bold text-yellow-500 uppercase flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Alertas de Dispositivo Duplicado
            </h2>
            {conflicts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum alerta registrado.</p>
            ) : (
              conflicts.slice(0, 20).map((c) => (
                <div key={c.id} className={`border rounded-xl p-4 text-xs space-y-1 ${c.seen ? 'border-white/5 bg-card/20' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                  <p className="font-bold text-yellow-400">⚠️ {c.user_email}</p>
                  <p className="text-muted-foreground">
                    <span className="text-red-400">Antigo:</span> {c.old_device_info?.slice(0, 60) || 'Desconhecido'}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="text-green-400">Novo:</span> {c.new_device_info?.slice(0, 60) || 'Desconhecido'}
                  </p>
                  <p className="text-muted-foreground/60">
                    {new Date(c.created_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {/* HISTÓRICO DE SINAIS TELEGRAM */}
        {showSignals && (
          <div className="mb-8 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2">
                <Send className="w-4 h-4" /> Sinais Telegram
              </h2>
              <div className="flex gap-3 text-[10px] font-bold">
                <span className="text-green-500">{signalStats.success} ✓</span>
                {signalStats.failed > 0 && <span className="text-red-500">{signalStats.failed} ✗</span>}
              </div>
            </div>
            {signals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum sinal enviado ainda.</p>
            ) : (
              signals.map((s) => (
                <div key={s.id} className={`border rounded-xl p-4 text-xs space-y-1.5 ${s.success ? 'border-white/5 bg-card/20' : 'border-red-500/30 bg-red-500/5'}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-sm">{s.success ? '✅' : '❌'} {s.match_name}</p>
                    <span className="text-muted-foreground/60 text-[10px]">
                      {new Date(s.created_at).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-md font-bold">{s.market}</span>
                    <span className="bg-green-500/10 text-green-400 px-2 py-0.5 rounded-md font-bold">{s.confidence}%</span>
                    <span className="bg-white/5 text-muted-foreground px-2 py-0.5 rounded-md">{s.minute}'</span>
                    <span className="bg-white/5 text-muted-foreground px-2 py-0.5 rounded-md">{s.score}</span>
                    {s.filters_validated && <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-md">Filtros: {s.filters_validated}</span>}
                    {s.sensitivity && <span className="bg-white/5 text-muted-foreground px-2 py-0.5 rounded-md capitalize">{s.sensitivity}</span>}
                  </div>
                  {s.poisson && <p className="text-muted-foreground">🧮 {s.poisson}</p>}
                  {s.reason && <p className="text-muted-foreground/70 italic">💡 {s.reason}</p>}
                  {s.error_message && <p className="text-red-400 text-[10px]">Erro: {s.error_message}</p>}
                </div>
              ))
            )}
          </div>
        )}

        {/* DASHBOARD DE MÉTRICAS */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-card/40 border border-white/5 p-4 rounded-2xl">
            <div className="flex items-center gap-3 text-muted-foreground mb-1">
              <Users className="w-4 h-4" /> <span className="text-xs font-bold uppercase">Total de Usuários</span>
            </div>
            <p className="text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="bg-card/40 border border-white/5 p-4 rounded-2xl">
            <div className="flex items-center gap-3 text-green-500 mb-1">
              <CheckCircle2 className="w-4 h-4" /> <span className="text-xs font-bold uppercase text-muted-foreground">Assinaturas Ativas</span>
            </div>
            <p className="text-2xl font-bold text-green-500">{stats.active}</p>
          </div>
          <div className="bg-card/40 border border-white/5 p-4 rounded-2xl">
            <div className="flex items-center gap-3 text-red-500 mb-1">
              <Clock className="w-4 h-4" /> <span className="text-xs font-bold uppercase text-muted-foreground">Expirados</span>
            </div>
            <p className="text-2xl font-bold text-red-500">{stats.expired}</p>
          </div>
        </div>

        {/* BUSCA */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Buscar usuário por e-mail..." 
            className="w-full bg-card/60 border border-white/10 rounded-xl py-3 pl-10 pr-4 focus:border-primary/50 outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* LISTA DE USUÁRIOS */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin w-10 h-10 text-primary" /></div>
          ) : filteredUsers.map((user) => {
            const isExpired = user.subscription_expiry_date && new Date(user.subscription_expiry_date) < new Date();
            const isActive = user.subscription_expiry_date && new Date(user.subscription_expiry_date) >= new Date();

            return (
              <div key={user.id} className="bg-card/40 border border-white/5 rounded-2xl p-5 hover:border-primary/20 transition-all">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1">
                    <p className="font-bold text-sm">{user.email}</p>
                    <p className="text-[10px] text-muted-foreground">ID: {user.id}</p>
                    <div className="flex gap-2 mt-2">
                       {isActive && <span className="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded-md font-bold uppercase">Ativo</span>}
                       {isExpired && <span className="text-[10px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-md font-bold uppercase">Expirado</span>}
                       {!user.subscription_expiry_date && <span className="text-[10px] bg-yellow-500/10 text-yellow-500 px-2 py-0.5 rounded-md font-bold uppercase">Sem Acesso</span>}
                       {user.is_admin && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-md font-bold uppercase">Admin</span>}
                    </div>
                  </div>

                  {!user.is_admin && (
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                      {DAYS_OPTIONS.map(days => (
                        <button 
                          key={days} 
                          onClick={() => grantDays(user.id, days)}
                          className="flex-1 sm:flex-none text-[10px] font-bold border border-white/10 px-3 py-2 rounded-lg hover:bg-primary hover:text-black transition-all"
                        >
                          +{days} DIAS
                        </button>
                      ))}
                      <button 
                        onClick={() => revokeAccess(user.id)}
                        className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                        title="Remover Acesso"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default Admin;
    
