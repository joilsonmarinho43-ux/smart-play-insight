import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Lightbulb, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface SuggestionRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  created_at: string;
}

interface ProfileRow {
  id: string;
  email: string;
}

const STATUS_OPTIONS = ['pendente', 'revisado', 'implementado', 'rejeitado'];

const statusColor: Record<string, string> = {
  pendente: 'bg-yellow-500/20 text-yellow-400',
  revisado: 'bg-blue-500/20 text-blue-400',
  implementado: 'bg-green-500/20 text-green-400',
  rejeitado: 'bg-red-500/20 text-red-400',
};

export const AdminSuggestionsPanel = () => {
  const [items, setItems] = useState<SuggestionRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('todos');

  const fetchData = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('suggestions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Erro ao carregar sugestões');
      setLoading(false);
      return;
    }

    setItems((data || []) as SuggestionRow[]);

    const ids = Array.from(new Set((data || []).map((s: any) => s.user_id)));
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', ids);
      const map: Record<string, string> = {};
      (profs || []).forEach((p: ProfileRow) => { map[p.id] = p.email; });
      setProfiles(map);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from('suggestions')
      .update({ status })
      .eq('id', id);
    if (error) return toast.error('Erro ao atualizar');
    toast.success('Status atualizado');
    setItems(prev => prev.map(s => s.id === id ? { ...s, status } : s));
  };

  const deleteSuggestion = async (id: string) => {
    if (!confirm('Excluir esta sugestão?')) return;
    const { error } = await supabase.from('suggestions').delete().eq('id', id);
    if (error) return toast.error('Erro ao excluir');
    toast.success('Sugestão excluída');
    setItems(prev => prev.filter(s => s.id !== id));
  };

  const counts = {
    total: items.length,
    pendente: items.filter(i => i.status === 'pendente').length,
    revisado: items.filter(i => i.status === 'revisado').length,
    implementado: items.filter(i => i.status === 'implementado').length,
    rejeitado: items.filter(i => i.status === 'rejeitado').length,
  };

  const categoryCounts = items.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] || 0) + 1;
    return acc;
  }, {});

  const filtered = filter === 'todos' ? items : items.filter(i => i.status === filter);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-amber-400 uppercase flex items-center gap-2">
        <Lightbulb className="w-4 h-4" /> Sugestões dos Usuários
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(['total', 'pendente', 'revisado', 'implementado', 'rejeitado'] as const).map(k => (
          <div key={k} className="bg-black/30 border border-white/10 rounded-xl p-3 text-center">
            <p className="text-[9px] text-muted-foreground uppercase font-bold">{k}</p>
            <p className="text-xl font-bold">{counts[k]}</p>
          </div>
        ))}
      </div>

      {Object.keys(categoryCounts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(categoryCounts).map(([cat, n]) => (
            <span key={cat} className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10">
              {cat}: <b>{n}</b>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {['todos', ...STATUS_OPTIONS].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-[11px] px-3 py-1 rounded-full font-bold uppercase ${
              filter === s ? 'bg-amber-500/30 text-amber-300' : 'bg-white/5 text-muted-foreground hover:bg-white/10'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-amber-400" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-8">Nenhuma sugestão.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => (
            <div key={s.id} className="border border-white/10 bg-black/30 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {profiles[s.user_id] || s.user_id.slice(0, 8)} · {new Date(s.created_at).toLocaleString('pt-BR')}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${statusColor[s.status] || 'bg-white/10'}`}>
                  {s.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{s.category}</span>
              </div>
              <p className="text-xs text-foreground/80 whitespace-pre-wrap">{s.description}</p>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                <select
                  value={s.status}
                  onChange={(e) => updateStatus(s.id, e.target.value)}
                  className="text-[11px] bg-black/50 border border-white/10 rounded-lg px-2 py-1"
                >
                  {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <button
                  onClick={() => deleteSuggestion(s.id)}
                  className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                >
                  <Trash2 className="w-3 h-3" /> Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
