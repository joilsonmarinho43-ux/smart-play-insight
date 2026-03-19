import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { ReactNode } from "react";

import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Live from "./pages/Live";
import Paywall from "./pages/Paywall";
import NotFound from "./pages/NotFound";

import { Loader2 } from "lucide-react";

// CONFIGURAÇÃO GLOBAL ANTI-CONSUMO DE API
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // BLOQUEIO 1: Não atualiza ao voltar para a aba
      refetchOnMount: false,       // BLOQUEIO 2: Não atualiza ao trocar de página no App
      refetchOnReconnect: false,   // BLOQUEIO 3: Não atualiza se o sinal 4G oscilar
      staleTime: 1000 * 60 * 10,   // BLOQUEIO 4: Considera o dado "novo" por 10 minutos
      retry: false,                // BLOQUEIO 5: Se der erro, não tenta de novo automaticamente
    },
  },
});

const LoadingScreen = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <Loader2 className="w-8 h-8 text-primary animate-spin" />
  </div>
);

type RouteProps = {
  children: ReactNode;
};

const ProtectedRoute = ({ children }: RouteProps) => {
  const { session, hasAccess, loading } = useProfile();
  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/auth" replace />;
  if (!hasAccess()) return <Navigate to="/expired" replace />;
  return <>{children}</>;
};

const PaywallRoute = () => {
  const { session, hasAccess, loading } = useProfile();
  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/auth" replace />;
  if (hasAccess()) return <Navigate to="/" replace />;
  return <Paywall />;
};

const AuthRoute = ({ children }: RouteProps) => {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (session) return <Navigate to="/" replace />;
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
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/live" element={<ProtectedRoute><Live /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/expired" element={<PaywallRoute />} />
            <Route path="/auth" element={<AuthRoute><Auth /></AuthRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
