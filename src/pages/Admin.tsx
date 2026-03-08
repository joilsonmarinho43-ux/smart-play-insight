import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile, Profile } from '@/hooks/useProfile';
import { Navigate } from 'react-router-dom';
import { Brain, ArrowLeft, Loader2, CalendarPlus, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const DAYS_OPTIONS = [3, 7, 15, 30];

const Admin = () => {
  const { profile, loading: profileLoading } = useProfile();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.is_admin) {
      fetchUsers();
    }
  }, [profile]);

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setUsers(data as Profile[]);
    }
    setLoading(false);
  };

  const grantDays = async (userId: string, days: number) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const baseDate = user.subscription_expiry_date
      ? new Date(Math.max(new Date(user.subscription_expiry_date).getTime(), Date.now()))
      : new Date();

    const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from('profiles')
      .update({ subscription_expiry_date: newExpiry.toISOString() })
      .eq('id', userId);

    if (error) {
      toast.error('Erro ao atualizar acesso');
    } else {
      toast.success(`+${days} dias concedidos com sucesso`);
      fetchUsers();
    }
  };

  const revokeAccess = async (userId: string) => {
    const { error } = await supabase
      .from('profiles')
      .update({ subscription_expiry_date: null })
      .eq('id', userId);

    if (error) {
      toast.error('Erro ao remover acesso');
    } else {
      toast.success('Acesso removido');
      fetchUsers();
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!profile?.is_admin) {
    return <Navigate to="/" replace />;
  }

  const getStatus = (user: Profile) => {
    if (user.is_admin) return { label: 'Admin', className: 'bg-primary/20 text-primary' };

    if (user.subscription_expiry_date) {
      const expiry = new Date(user.subscription_expiry_date);
      if (new Date() <= expiry) {
        const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return { label: `Ativo (${daysLeft}d)`, className: 'bg-[hsl(145_60%_45%/0.2)] text-[hsl(145_60%_35%)]' };
      }
      return { label: 'Expirado', className: 'bg-destructive/20 text-destructive' };
    }

    return { label: 'Pendente', className: 'bg-[hsl(45_80%_50%/0.2)] text-[hsl(45_80%_35%)]' };
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/" className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Brain className="w-6 h-6 text-primary" />
          <h1 className="font-display text-2xl text-foreground tracking-wider">PAINEL ADMIN</h1>
          <span className="ml-auto text-xs text-muted-foreground">{users.length} usuários</span>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((user) => {
              const status = getStatus(user);
              return (
                <div key={user.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{user.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Criado: {new Date(user.created_at).toLocaleDateString('pt-BR')}
                        {user.subscription_expiry_date && (
                          <> · Expira: {new Date(user.subscription_expiry_date).toLocaleDateString('pt-BR')}</>
                        )}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${status.className}`}>
                      {status.label}
                    </span>
                  </div>

                  {!user.is_admin && (
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
                      {DAYS_OPTIONS.map((days) => (
                        <button
                          key={days}
                          onClick={() => grantDays(user.id, days)}
                          className="flex items-center gap-1 bg-secondary hover:bg-primary hover:text-primary-foreground text-muted-foreground px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        >
                          <CalendarPlus className="w-3 h-3" />
                          +{days} dias
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default Admin;
