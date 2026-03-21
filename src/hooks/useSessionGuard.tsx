import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useProfile } from './useProfile';
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
  const { profile } = useProfile();
  const registeredRef = useRef(false);
  const registrationDoneRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const registerSession = useCallback(async () => {
    if (!session?.access_token) return;

    const sessionToken = getSessionToken();
    const deviceInfo = getDeviceInfo();

    try {
      const { error } = await supabase.functions.invoke('register-session', {
        body: { session_token: sessionToken, device_info: deviceInfo },
      });
      if (!error) {
        registrationDoneRef.current = true;
      } else {
        console.error('Failed to register session:', error);
      }
    } catch (err) {
      console.error('Failed to register session:', err);
    }
  }, [session?.access_token]);

  const checkSession = useCallback(async () => {
    if (!session?.user?.id) return;
    // Don't check until we've successfully registered this device
    if (!registrationDoneRef.current) return;

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

    if (data && data.session_token !== sessionToken) {
      toast.error('Sua conta foi acessada em outro dispositivo. Você foi desconectado.', {
        duration: 8000,
      });
      await signOut();
    }
  }, [session?.user?.id, signOut]);

  // Register on first login
  useEffect(() => {
    if (!session?.access_token || registeredRef.current) return;
    registeredRef.current = true;
    registrationDoneRef.current = false;
    registerSession();
  }, [session?.access_token, registerSession]);

  // Reset refs when session changes (new login)
  useEffect(() => {
    if (!session?.access_token) {
      registeredRef.current = false;
      registrationDoneRef.current = false;
    }
  }, [session?.access_token]);

  // Poll every 30s to check if this device is still the active one
  useEffect(() => {
    if (!session?.user?.id) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Delay first check to give registration time to complete
    const timeout = setTimeout(() => {
      checkSession();
      intervalRef.current = setInterval(checkSession, 30000);
    }, 5000);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [session?.user?.id, checkSession]);
};
