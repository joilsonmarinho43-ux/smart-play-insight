import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useProfile } from "@/hooks/useProfile";
import { useSessionGuard } from "@/hooks/useSessionGuard";
import { useApiKeyValidator } from "@/hooks/useApiKeyValidator";
import { useDataProviderHealthMonitor } from "@/hooks/useDataProviderHealthMonitor";
import { ReactNode } from "react";

import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Quality from "./pages/Quality";
import Diagnostics from "./pages/Diagnostics";
import Context from "./pages/Context";
import Live from "./pages/Live";
import MatchDetails from "./pages/MatchDetails";

import Favorites from "./pages/Favorites";
import Scanner from "./pages/Scanner";
import Elite from "./pages/Elite";
import Bingo from "./pages/Bingo";
import Suggestions from "./pages/Suggestions";
import Paywall from "./pages/Paywall";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import AutoPilot from "./pages/AutoPilot";
import WorldCup from "./pages/WorldCup";
import SuperbetConnect from "./pages/SuperbetConnect";
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
  useDataProviderHealthMonitor(!!profile?.is_admin);
  if (loading) return <LoadingScreen />;
  if (!profile?.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => {
  useApiKeyValidator();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {/*<Sonner />*/}
        <BrowserRouter>
          <Routes>
            {/* Rotas de Usuário Comum (Protegidas por Assinatura) */}
            <Route path="/" element={<ProtectedRoute><AppLayout><Index /></AppLayout></ProtectedRoute>} />
            <Route path="/live" element={<ProtectedRoute><AppLayout><Live /></AppLayout></ProtectedRoute>} />
            <Route path="/match/:id" element={<ProtectedRoute><AppLayout><MatchDetails /></AppLayout></ProtectedRoute>} />
            
            <Route path="/scanner" element={<ProtectedRoute><AppLayout><Scanner /></AppLayout></ProtectedRoute>} />
            <Route path="/elite" element={<ProtectedRoute><AppLayout><Elite /></AppLayout></ProtectedRoute>} />
            <Route path="/bingo" element={<ProtectedRoute><AppLayout><Bingo /></AppLayout></ProtectedRoute>} />
            <Route path="/favorites" element={<ProtectedRoute><AppLayout><Favorites /></AppLayout></ProtectedRoute>} />
            <Route path="/suggestions" element={<ProtectedRoute><AppLayout><Suggestions /></AppLayout></ProtectedRoute>} />
            <Route path="/autopilot" element={<ProtectedRoute><AppLayout><AutoPilot /></AppLayout></ProtectedRoute>} />
            <Route path="/world-cup" element={<ProtectedRoute><AppLayout><WorldCup /></AppLayout></ProtectedRoute>} />
            <Route path="/superbet-connect" element={<ProtectedRoute><AppLayout><SuperbetConnect /></AppLayout></ProtectedRoute>} />
            
            
            {/* Rota de Gestão (Só para o Jamilson/Joilson) */}
            <Route path="/admin" element={<AdminRoute><AppLayout><Admin /></AppLayout></AdminRoute>} />
            <Route path="/quality" element={<AdminRoute><AppLayout><Quality /></AppLayout></AdminRoute>} />
            <Route path="/diagnostics" element={<AdminRoute><AppLayout><Diagnostics /></AppLayout></AdminRoute>} />
            <Route path="/context" element={<AdminRoute><AppLayout><Context /></AppLayout></AdminRoute>} />
            
            {/* Rotas de Fluxo de Usuário */}
            <Route path="/expired" element={<Paywall />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            
            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
              
