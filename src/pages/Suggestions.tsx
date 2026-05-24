import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { toast } from "sonner";
import { Lightbulb, Send, CheckCircle, Clock, Loader2, MessageSquarePlus, ChevronDown } from "lucide-react";

const categories = [
  { value: "UI", label: "Interface / Design", icon: "🎨" },
  { value: "Funcionalidade", label: "Funcionalidade", icon: "⚙️" },
  { value: "Performance", label: "Performance / Velocidade", icon: "⚡" },
  { value: "Bug", label: "Bug / Erro", icon: "🐛" },
  { value: "Outro", label: "Outro", icon: "💡" },
];

interface Suggestion {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  created_at: string;
}

export default function Suggestions() {
  const { profile } = useProfile();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Outro");
  const [loading, setLoading] = useState(false);
  const [mySuggestions, setMySuggestions] = useState<Suggestion[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showForm, setShowForm] = useState(true);

  const fetchSuggestions = async () => {
    setFetching(true);
    const { data, error } = await supabase
      .from("suggestions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar sugestões");
    } else {
      setMySuggestions(data || []);
    }
    setFetching(false);
  };

  useEffect(() => {
    fetchSuggestions();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      toast.error("Preencha todos os campos");
      return;
    }
    if (!profile?.id) {
      toast.error("Você precisa estar logado");
      return;
    }

    setLoading(true);
    const { error } = await supabase.from("suggestions").insert({
      user_id: profile.id,
      title: title.trim(),
      description: description.trim(),
      category,
      status: "pendente",
    });

    if (error) {
      toast.error("Erro ao enviar sugestão: " + error.message);
    } else {
      toast.success("Sugestão enviada com sucesso!");
      setTitle("");
      setDescription("");
      setCategory("Outro");
      fetchSuggestions();
    }
    setLoading(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "implementado": return "text-green-400 bg-green-500/10 border-green-500/20";
      case "revisado": return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "rejeitado": return "text-red-400 bg-red-500/10 border-red-500/20";
      default: return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "implementado": return <CheckCircle className="w-3.5 h-3.5" />;
      case "revisado": return <Clock className="w-3.5 h-3.5" />;
      default: return <Clock className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-foreground">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Lightbulb className="w-6 h-6 text-amber-400" />
          <div>
            <h1 className="font-bold text-xl tracking-tight">Sugestões de Melhoria</h1>
            <p className="text-xs text-muted-foreground">Ajude a melhorar o Nexus 33</p>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Toggle Form */}
        <button
          onClick={() => setShowForm(!showForm)}
          className="w-full flex items-center justify-between bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-xl p-4 hover:bg-amber-500/15 transition-colors"
        >
          <div className="flex items-center gap-3">
            <MessageSquarePlus className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-sm">Nova Sugestão</span>
          </div>
          <ChevronDown className={`w-5 h-5 text-amber-400 transition-transform ${showForm ? "rotate-180" : ""}`} />
        </button>

        {/* Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-[#111827] border border-white/10 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1.5">Título</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Adicionar filtros no Live Trader"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50 transition-colors"
                maxLength={120}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1.5">Categoria</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {categories.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                      category === c.value
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                        : "bg-black/30 border-white/5 text-gray-400 hover:border-white/10"
                    }`}
                  >
                    <span>{c.icon}</span>
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1.5">Descrição</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva sua sugestão em detalhes..."
                rows={4}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50 transition-colors resize-none"
                maxLength={1000}
              />
              <p className="text-[10px] text-gray-600 mt-1 text-right">{description.length}/1000</p>
            </div>

            <button
              type="submit"
              disabled={loading || !title.trim() || !description.trim()}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold py-3 rounded-xl hover:from-amber-400 hover:to-orange-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
              Enviar Sugestão
            </button>
          </form>
        )}

        {/* My Suggestions */}
        <div>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Lightbulb className="w-4 h-4" /> Minhas Sugestões
          </h2>

          {fetching ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
            </div>
          ) : mySuggestions.length === 0 ? (
            <div className="bg-[#111827] border border-white/10 rounded-xl p-8 text-center">
              <Lightbulb className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Você ainda não enviou nenhuma sugestão.</p>
              <p className="text-xs text-gray-600 mt-1">Sua opinião é muito importante para melhorar o app!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {mySuggestions.map((s) => (
                <div
                  key={s.id}
                  className="bg-[#111827] border border-white/10 rounded-xl p-4 hover:border-white/15 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-bold text-sm text-white">{s.title}</h3>
                    <span
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border shrink-0 ${getStatusColor(s.status)}`}
                    >
                      {getStatusIcon(s.status)}
                      {s.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed mb-3">{s.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-medium bg-white/5 px-2 py-1 rounded-md">
                      {categories.find((c) => c.value === s.category)?.icon} {categories.find((c) => c.value === s.category)?.label || s.category}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {new Date(s.created_at).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
