import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile, Profile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Brain, ArrowLeft, Loader2, UserPlus, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const Admin = () => {
  const { profile, loading: profileLoading } = useProfile();
  const { session } = useAuth();
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

  const extendSubscription = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const baseDate = user.subscription_expiry_date
      ? new Date(Math.max(new Date(user.subscription_expiry_date).getTime(), Date.now()))
      : new Date();

    const newExpiry = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from('profiles')
      .update({ subscription_expiry_date: newExpiry.toISOString() })
      .eq('id', userId);

    if (error) {
      toast.error('Erro ao atualizar assinatura');
    } else {
      toast.success('Assinatura renovada por +30 dias');
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
    const now = new Date();
    const trialEnd = new Date(new Date(user.created_at).getTime() + 3 * 24 * 60 * 60 * 1000);

    if (user.is_admin) return { label: 'Admin', className: 'pill-orange' };
    if (user.subscription_expiry_date && now <= new Date(user.subscription_expiry_date))
      return { label: 'Assinante', className: 'pill-green' };
    if (now <= trialEnd) return { label: 'Trial', className: 'pill-neutral' };
    return { label: 'Expirado', className: 'bg-destructive/20 text-destructive font-bold' };
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
                <div key={user.id} className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Criado: {new Date(user.created_at).toLocaleDateString('pt-BR')}
                      {user.subscription_expiry_date && (
                        <> · Expira: {new Date(user.subscription_expiry_date).toLocaleDateString('pt-BR')}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs ${status.className}`}>
                      {status.label}
                    </span>
                    {!user.is_admin && (
                      <button
                        onClick={() => extendSubscription(user.id)}
                        className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        +30 dias
                      </button>
                    )}
                  </div>
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
