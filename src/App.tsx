import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useProfile } from "@/hooks/useProfile";
import { useSessionGuard } from "@/hooks/useSessionGuard";
import { ReactNode } from "react";

import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Live from "./pages/Live";
import Favorites from "./pages/Favorites";
import Scanner from "./pages/Scanner";
import Elite from "./pages/Elite";
import Paywall from "./pages/Paywall";
import NotFound from "./pages/NotFound";
import { AppLayout } from "./components/AppLayout";

import { Loader2 } from "lucide-react";

// 🔥 CONFIGURAÇÃO PROFISSIONAL: Economiza API Pro
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,   // 🛡️ Impedimos o gasto de API ao alternar abas
      refetchOnReconnect: true,
      staleTime: 1000 * 60 * 5,     // Dados "frescos" por 5 minutos
      retry: 1,
    },
  },
});

const LoadingScreen = () => (
  <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
    <Loader2 className="w-8 h-8 text-primary animate-spin" />
  </div>
);

// 🛡️ PROTEÇÃO DE ACESSO PAGO
const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, profile, loading } = useProfile();
  useSessionGuard();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/auth" replace />;

  // Se não for admin e o acesso expirou
  const isExpired = profile?.subscription_expiry_date 
    ? new Date(profile.subscription_expiry_date) < new Date() 
    : true;

  if (!profile?.is_admin && isExpired) {
    return <Navigate to="/expired" replace />;
  }

  return <>{children}</>;
};

// 🛡️ PROTEÇÃO EXCLUSIVA ADMIN
const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { profile, loading } = useProfile();
  if (loading) return <LoadingScreen />;
  if (!profile?.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Rotas de Usuário Comum (Protegidas por Assinatura) */}
            <Route path="/" element={<ProtectedRoute><AppLayout><Index /></AppLayout></ProtectedRoute>} />
            <Route path="/live" element={<ProtectedRoute><AppLayout><Live /></AppLayout></ProtectedRoute>} />
            <Route path="/scanner" element={<ProtectedRoute><AppLayout><Scanner /></AppLayout></ProtectedRoute>} />
            <Route path="/elite" element={<ProtectedRoute><AppLayout><Elite /></AppLayout></ProtectedRoute>} />
            <Route path="/favorites" element={<ProtectedRoute><AppLayout><Favorites /></AppLayout></ProtectedRoute>} />
            
            {/* Rota de Gestão (Só para o Jamilson/Joilson) */}
            <Route path="/admin" element={<AdminRoute><AppLayout><Admin /></AppLayout></AdminRoute>} />
            
            {/* Rotas de Fluxo de Usuário */}
            <Route path="/expired" element={<Paywall />} />
            <Route path="/auth" element={<Auth />} />
            
            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
              
