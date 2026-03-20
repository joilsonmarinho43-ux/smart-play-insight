import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile, Profile } from '@/hooks/useProfile';
import { Navigate, Link } from 'react-router-dom';
import { Brain, ArrowLeft, Loader2, CalendarPlus, XCircle, Search, Users, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';

const DAYS_OPTIONS = [3, 7, 15, 30];

const Admin = () => {
  const { profile, loading: profileLoading } = useProfile();
  const [users, setUsers] = useState<Profile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.is_admin) {
      fetchUsers();
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

  // Filtro de busca em tempo real
  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: users.length,
    active: users.filter(u => u.subscription_expiry_date && new Date(u.subscription_expiry_date) > new Date()).length,
    expired: users.filter(u => u.subscription_expiry_date && new Date(u.subscription_expiry_date) <= new Date()).length
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
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8">
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
    
