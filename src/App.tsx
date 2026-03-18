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

const queryClient = new QueryClient();

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
            {/* Página principal */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              }
            />

            {/* Página ao vivo */}
            <Route
              path="/live"
              element={
                <ProtectedRoute>
                  <Live />
                </ProtectedRoute>
              }
            />

            {/* Admin */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <Admin />
                </ProtectedRoute>
              }
            />

            {/* Paywall */}
            <Route path="/expired" element={<PaywallRoute />} />

            {/* Login */}
            <Route
              path="/auth"
              element={
                <AuthRoute>
                  <Auth />
                </AuthRoute>
              }
            />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
