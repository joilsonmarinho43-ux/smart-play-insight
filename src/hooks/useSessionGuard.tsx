import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

// Generate a unique token per browser tab/device and persist it
const getSessionToken = (): string => {
  let token = localStorage.getItem('device_session_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('device_session_token', token);
  }
  return token;
};

const getDeviceInfo = (): string => {
  const ua = navigator.userAgent;
  const platform = navigator.platform || 'unknown';
  return `${platform} | ${ua.slice(0, 100)}`;
};

export const useSessionGuard = () => {
  const { session, signOut } = useAuth();
  const registeredRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const registerSession = useCallback(async () => {
    if (!session?.access_token) return;

    const sessionToken = getSessionToken();
    const deviceInfo = getDeviceInfo();

    try {
      await supabase.functions.invoke('register-session', {
        body: { session_token: sessionToken, device_info: deviceInfo },
      });
    } catch (err) {
      console.error('Failed to register session:', err);
    }
  }, [session?.access_token]);

  const checkSession = useCallback(async () => {
    if (!session?.user?.id) return;

    const sessionToken = getSessionToken();

    const { data, error } = await supabase
      .from('active_sessions')
      .select('session_token')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) {
      console.error('Session check error:', error);
      return;
    }

    // If the server has a different token, this device was kicked
    if (data && data.session_token !== sessionToken) {
      toast.error('Sua conta foi acessada em outro dispositivo. Você foi desconectado.', {
        duration: 8000,
      });
      localStorage.removeItem('device_session_token');
      await signOut();
    }
  }, [session?.user?.id, signOut]);

  // Register on first login
  useEffect(() => {
    if (!session?.access_token || registeredRef.current) return;
    registeredRef.current = true;
    registerSession();
  }, [session?.access_token, registerSession]);

  // Poll every 30s to check if this device is still the active one
  useEffect(() => {
    if (!session?.user?.id) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Check immediately
    checkSession();

    // Then every 30 seconds
    intervalRef.current = setInterval(checkSession, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [session?.user?.id, checkSession]);
};
