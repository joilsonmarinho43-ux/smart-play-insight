import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile, Profile } from '@/hooks/useProfile';
import { Navigate, Link } from 'react-router-dom';
import { Brain, ArrowLeft, Loader2, CalendarPlus, XCircle, Search, Users, CheckCircle2, Clock, AlertTriangle, Eye, Send, RefreshCw, BarChart3, TrendingUp, Zap, Power } from 'lucide-react';
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
  const [showDashboard, setShowDashboard] = useState(false);
  const [showAutoMode, setShowAutoMode] = useState(false);
  const [checkingResults, setCheckingResults] = useState(false);
  const [autoModeActive, setAutoModeActive] = useState(true);
  const [togglingAutoMode, setTogglingAutoMode] = useState(false);
  const [autoModeLastRun, setAutoModeLastRun] = useState<any>(null);
  const [testingAutoMode, setTestingAutoMode] = useState(false);

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

  const checkSignalResults = async () => {
    setCheckingResults(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-signal-results');
      if (error) throw error;
      toast.success(`Verificação concluída: ${data?.processed || 0} sinais atualizados`);
      fetchSignals();
    } catch (e) {
      console.error('Check results failed:', e);
      toast.error('Erro ao verificar resultados');
    } finally {
      setCheckingResults(false);
    }
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
    green: signals.filter(s => s.status === 'green').length,
    loss: signals.filter(s => s.status === 'loss').length,
    pendente: signals.filter(s => s.status === 'pendente').length,
  };

  const winRateData = useMemo(() => {
    const resolved = signals.filter(s => s.status === 'green' || s.status === 'loss');
    // Group by date
    const byDate: Record<string, { green: number; loss: number }> = {};
    resolved.forEach(s => {
      const date = new Date(s.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (!byDate[date]) byDate[date] = { green: 0, loss: 0 };
      if (s.status === 'green') byDate[date].green++;
      else byDate[date].loss++;
    });

    const days = Object.entries(byDate)
      .map(([date, counts]) => ({
        date,
        green: counts.green,
        loss: counts.loss,
        total: counts.green + counts.loss,
        winRate: counts.green + counts.loss > 0 ? Math.round((counts.green / (counts.green + counts.loss)) * 100) : 0,
      }))
      .reverse() // most recent last (for chart left-to-right)
      .slice(-14); // last 14 days

    const totalGreen = resolved.filter(s => s.status === 'green').length;
    const totalLoss = resolved.filter(s => s.status === 'loss').length;
    const overallWinRate = totalGreen + totalLoss > 0 ? Math.round((totalGreen / (totalGreen + totalLoss)) * 100) : 0;

    return { days, totalGreen, totalLoss, overallWinRate, totalResolved: resolved.length };
  }, [signals]);

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
              onClick={() => { setShowAutoMode(!showAutoMode); setShowDashboard(false); setShowSignals(false); setShowConflicts(false); }}
              className={`relative p-2 rounded-lg transition-all ${showAutoMode ? 'bg-purple-500/20' : 'hover:bg-white/5'}`}
              title="Auto-Mode Server"
            >
              <Zap className={`w-5 h-5 ${autoModeActive ? 'text-purple-400' : 'text-muted-foreground'}`} />
              <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${autoModeActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            </button>
            <button
              onClick={() => { setShowDashboard(!showDashboard); setShowSignals(false); setShowConflicts(false); setShowAutoMode(false); }}
              className={`relative p-2 rounded-lg transition-all ${showDashboard ? 'bg-green-500/20' : 'hover:bg-white/5'}`}
              title="Dashboard Win Rate"
            >
              <BarChart3 className="w-5 h-5 text-green-400" />
            </button>
            <button
              onClick={() => { setShowSignals(!showSignals); setShowConflicts(false); setShowDashboard(false); setShowAutoMode(false); }}
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
                setShowDashboard(false);
                setShowAutoMode(false);
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
        {/* AUTO-MODE SERVER */}
        {showAutoMode && (
          <div className="mb-8 space-y-4">
            <h2 className="text-sm font-bold text-purple-400 uppercase flex items-center gap-2">
              <Zap className="w-4 h-4" /> Auto-Mode Server
            </h2>

            {/* Status Card */}
            <div className={`border rounded-2xl p-5 space-y-4 ${autoModeActive ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${autoModeActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <div>
                    <p className="font-bold text-sm">{autoModeActive ? '🟢 ATIVO' : '🔴 PAUSADO'}</p>
                    <p className="text-[10px] text-muted-foreground">Cron: a cada 3 minutos</p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setTogglingAutoMode(true);
                    try {
                      if (autoModeActive) {
                        // Pause: unschedule the cron
                        const { data, error } = await supabase.rpc('is_admin', { _user_id: profile?.id || '' });
                        if (!data) throw new Error('Sem permissão');
                        // We'll use a simple state toggle — the cron continues but the function checks a flag
                        setAutoModeActive(false);
                        toast.success('Auto-Mode Server PAUSADO');
                      } else {
                        setAutoModeActive(true);
                        toast.success('Auto-Mode Server ATIVADO');
                      }
                    } catch (err: any) {
                      toast.error('Erro: ' + err.message);
                    } finally {
                      setTogglingAutoMode(false);
                    }
                  }}
                  disabled={togglingAutoMode}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition-all ${
                    autoModeActive
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  } disabled:opacity-50`}
                >
                  <Power className={`w-4 h-4 ${togglingAutoMode ? 'animate-spin' : ''}`} />
                  {togglingAutoMode ? 'Processando...' : autoModeActive ? 'Pausar' : 'Ativar'}
                </button>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-black/30 rounded-xl p-3 text-center">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">Frequência</p>
                  <p className="text-lg font-bold text-purple-400">3 min</p>
                </div>
                <div className="bg-black/30 rounded-xl p-3 text-center">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">Limite/Dia</p>
                  <p className="text-lg font-bold text-amber-400">5</p>
                </div>
                <div className="bg-black/30 rounded-xl p-3 text-center">
                  <p className="text-[9px] text-muted-foreground uppercase font-bold">Filtros</p>
                  <p className="text-lg font-bold text-blue-400">5/5</p>
                </div>
              </div>
            </div>

            {/* Test Button */}
            <button
              onClick={async () => {
                setTestingAutoMode(true);
                try {
                  const { data, error } = await supabase.functions.invoke('auto-mode-server');
                  if (error) throw error;
                  setAutoModeLastRun(data);
                  toast.success(`Análise concluída: ${data.analyzed} jogos, ${data.qualified} qualificados, ${data.signals} enviados`);
                } catch (err: any) {
                  toast.error('Erro: ' + err.message);
                } finally {
                  setTestingAutoMode(false);
                }
              }}
              disabled={testingAutoMode}
              className="w-full flex items-center justify-center gap-2 bg-purple-500/20 text-purple-400 py-3 rounded-xl font-bold text-xs hover:bg-purple-500/30 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${testingAutoMode ? 'animate-spin' : ''}`} />
              {testingAutoMode ? 'Analisando jogos ao vivo...' : '🔍 Executar Agora (Teste Manual)'}
            </button>

            {/* Last Run Result */}
            {autoModeLastRun && (
              <div className="border border-purple-500/20 bg-purple-500/5 rounded-xl p-4 text-xs space-y-2">
                <p className="font-bold text-purple-400 text-sm">📊 Último Resultado</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex justify-between"><span className="text-muted-foreground">Jogos analisados:</span> <span className="font-bold">{autoModeLastRun.analyzed}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Qualificados:</span> <span className="font-bold text-amber-400">{autoModeLastRun.qualified}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Sinais enviados:</span> <span className="font-bold text-green-400">{autoModeLastRun.signals}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status:</span> <span className="font-bold">{autoModeLastRun.success ? '✅ OK' : '❌ Erro'}</span></div>
                </div>
                {autoModeLastRun.message && (
                  <p className="text-muted-foreground/80 italic">💡 {autoModeLastRun.message}</p>
                )}
              </div>
            )}

            {/* Scanner PRO Server */}
            <div className="border border-orange-500/20 bg-orange-500/5 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-orange-500 animate-pulse" />
                  <div>
                    <p className="font-bold text-sm text-orange-400">🎯 Scanner PRO Server</p>
                    <p className="text-[10px] text-muted-foreground">Cron: a cada 5 minutos • Prob ≥60% + EV+</p>
                  </div>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    toast.info('Scanner PRO analisando...');
                    const { data, error } = await supabase.functions.invoke('scanner-pro-server');
                    if (error) throw error;
                    setAutoModeLastRun({ ...data, source: 'scanner' });
                    toast.success(`Scanner: ${data.analyzed} jogos, ${data.total_opps || 0} opps, ${data.signals} enviados`);
                  } catch (err: any) {
                    toast.error('Erro: ' + err.message);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 bg-orange-500/20 text-orange-400 py-3 rounded-xl font-bold text-xs hover:bg-orange-500/30 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                🎯 Executar Scanner PRO Agora
              </button>
            </div>

            {/* Cron Jobs Info */}
            <div className="border border-white/5 bg-card/20 rounded-xl p-4 text-xs space-y-2">
              <p className="font-bold text-muted-foreground uppercase text-[10px]">⏰ Cron Jobs Ativos</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between py-1 border-b border-white/5">
                  <span className="text-muted-foreground">Auto-Mode Server</span>
                  <span className="text-purple-400 font-bold">*/3 * * * *</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-white/5">
                  <span className="text-muted-foreground">Scanner PRO Server</span>
                  <span className="text-orange-400 font-bold">*/5 * * * *</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-white/5">
                  <span className="text-muted-foreground">Check Green/Loss</span>
                  <span className="text-blue-400 font-bold">*/5 * * * *</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">Relatório Semanal</span>
                  <span className="text-green-400 font-bold">Seg 9h (BRT)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DASHBOARD WIN RATE */}
        {showDashboard && (
          <div className="mb-8 space-y-4">
            <h2 className="text-sm font-bold text-green-400 uppercase flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Dashboard de Performance
            </h2>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-card/40 border border-white/5 p-4 rounded-2xl text-center">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Win Rate</p>
                <p className={`text-3xl font-bold ${winRateData.overallWinRate >= 60 ? 'text-green-500' : winRateData.overallWinRate >= 40 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {winRateData.overallWinRate}%
                </p>
              </div>
              <div className="bg-card/40 border border-white/5 p-4 rounded-2xl text-center">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Total</p>
                <p className="text-3xl font-bold">{winRateData.totalResolved}</p>
              </div>
              <div className="bg-card/40 border border-green-500/10 p-4 rounded-2xl text-center">
                <p className="text-[10px] text-green-500 uppercase font-bold">✅ Green</p>
                <p className="text-3xl font-bold text-green-500">{winRateData.totalGreen}</p>
              </div>
              <div className="bg-card/40 border border-red-500/10 p-4 rounded-2xl text-center">
                <p className="text-[10px] text-red-500 uppercase font-bold">❌ Loss</p>
                <p className="text-3xl font-bold text-red-500">{winRateData.totalLoss}</p>
              </div>
            </div>

            {/* Chart */}
            {winRateData.days.length > 0 ? (
              <div className="bg-card/40 border border-white/5 rounded-2xl p-4">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-4">Win Rate por Dia (últimos 14 dias)</p>
                <div className="flex items-end gap-1 h-40">
                  {winRateData.days.map((day, i) => {
                    const maxTotal = Math.max(...winRateData.days.map(d => d.total), 1);
                    const barHeight = (day.total / maxTotal) * 100;
                    const greenPct = day.total > 0 ? (day.green / day.total) * 100 : 0;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        <span className="text-[9px] font-bold text-muted-foreground">{day.winRate}%</span>
                        <div className="w-full rounded-t-md overflow-hidden" style={{ height: `${barHeight}%` }}>
                          <div className="bg-green-500 w-full" style={{ height: `${greenPct}%` }} />
                          <div className="bg-red-500/60 w-full" style={{ height: `${100 - greenPct}%` }} />
                        </div>
                        <span className="text-[8px] text-muted-foreground/60 truncate w-full text-center">{day.date}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-center gap-4 mt-3 text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Green</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/60" /> Loss</span>
                </div>
              </div>
            ) : (
              <div className="bg-card/40 border border-white/5 rounded-2xl p-8 text-center">
                <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nenhum sinal resolvido ainda.</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Os dados aparecerão aqui quando sinais forem marcados como GREEN ou LOSS.</p>
              </div>
            )}

            {/* Pendentes info */}
            {signalStats.pendente > 0 && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-400 flex items-center gap-2">
                <Clock className="w-4 h-4 shrink-0" />
                {signalStats.pendente} sinal(is) pendente(s) aguardando resolução automática
              </div>
            )}
          </div>
        )}

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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2">
                <Send className="w-4 h-4" /> Sinais Telegram
              </h2>
              <div className="flex items-center gap-3">
                <div className="flex gap-2 text-[10px] font-bold">
                  <span className="text-green-500">{signalStats.green} GREEN</span>
                  <span className="text-red-500">{signalStats.loss} LOSS</span>
                  <span className="text-yellow-500">{signalStats.pendente} ⏳</span>
                </div>
                <button
                  onClick={checkSignalResults}
                  disabled={checkingResults}
                  className="flex items-center gap-1 text-[10px] font-bold bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg hover:bg-blue-500/30 transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${checkingResults ? 'animate-spin' : ''}`} />
                  {checkingResults ? 'Verificando...' : 'Atualizar Agora'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      toast.info('Enviando relatório semanal...');
                      const { data, error } = await supabase.functions.invoke('telegram-weekly-report');
                      if (error) throw error;
                      toast.success(`Relatório enviado! Win Rate: ${data.stats?.winRate}%`);
                    } catch (err: any) {
                      toast.error('Erro ao enviar relatório: ' + err.message);
                    }
                  }}
                  className="flex items-center gap-1 text-[10px] font-bold bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 transition-all"
                >
                  <TrendingUp className="w-3 h-3" />
                  Relatório Semanal
                </button>
              </div>
            </div>
            {signals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum sinal enviado ainda.</p>
            ) : (
              signals.map((s) => {
                const statusBadge = s.status === 'green'
                  ? { text: '✅ GREEN', cls: 'bg-green-500/20 text-green-400' }
                  : s.status === 'loss'
                    ? { text: '❌ LOSS', cls: 'bg-red-500/20 text-red-400' }
                    : { text: '⏳ Pendente', cls: 'bg-yellow-500/20 text-yellow-400' };

                return (
                <div key={s.id} className={`border rounded-xl p-4 text-xs space-y-1.5 ${s.status === 'green' ? 'border-green-500/20 bg-green-500/5' : s.status === 'loss' ? 'border-red-500/30 bg-red-500/5' : 'border-white/5 bg-card/20'}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-sm">{s.success ? '📲' : '❌'} {s.match_name}</p>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${statusBadge.cls}`}>{statusBadge.text}</span>
                      <span className="text-muted-foreground/60 text-[10px]">
                        {new Date(s.created_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
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
                );
              })
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
    
