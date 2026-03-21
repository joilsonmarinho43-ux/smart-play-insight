import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useProfile } from './useProfile';
import { toast } from 'sonner';

// Persist session token in sessionStorage (per-tab) so HMR reloads don't generate new tokens
const getSessionToken = (): string => {
  let token = sessionStorage.getItem('device_session_token');
  if (!token) {
    // Also check localStorage for backward compat, then migrate
    token = localStorage.getItem('device_session_token');
    if (!token) {
      token = crypto.randomUUID();
    }
    sessionStorage.setItem('device_session_token', token);
  }
  // Keep localStorage in sync for the register-session check
  localStorage.setItem('device_session_token', token);
  return token;
};

const getDeviceInfo = (): string => {
  const ua = navigator.userAgent;
  const platform = navigator.platform || 'unknown';
  return `${platform} | ${ua.slice(0, 100)}`;
};

// Module-level flags survive HMR better than refs
let moduleRegistered = false;
let moduleRegisteredForUser = '';

export const useSessionGuard = () => {
  const { session, signOut } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const registrationDoneRef = useRef(false);

  const userId = session?.user?.id;
  const accessToken = session?.access_token;
  const isAdmin = profile?.is_admin;

  const registerSession = useCallback(async () => {
    if (!accessToken) return;

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
  }, [accessToken]);

  const checkSession = useCallback(async () => {
    if (!userId) return;
    if (!registrationDoneRef.current) return;

    const sessionToken = getSessionToken();

    const { data, error } = await supabase
      .from('active_sessions')
      .select('session_token')
      .eq('user_id', userId)
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
  }, [userId, signOut]);

  // Register on first login — wait for profile to load first
  useEffect(() => {
    if (!accessToken || profileLoading) return;
    // Admins skip session guard
    if (isAdmin) return;
    // Already registered for this user (survives HMR)
    if (moduleRegistered && moduleRegisteredForUser === userId) return;

    moduleRegistered = true;
    moduleRegisteredForUser = userId || '';
    registrationDoneRef.current = false;
    registerSession();
  }, [accessToken, profileLoading, isAdmin, userId, registerSession]);

  // Reset module flags when user changes (logout/login)
  useEffect(() => {
    if (!accessToken) {
      moduleRegistered = false;
      moduleRegisteredForUser = '';
      registrationDoneRef.current = false;
    }
  }, [accessToken]);

  // Poll every 30s to check if this device is still the active one
  useEffect(() => {
    if (!userId || profileLoading || isAdmin) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Delay first check to give registration time to complete
    const timeout = setTimeout(() => {
      checkSession();
      intervalRef.current = setInterval(checkSession, 30000);
    }, 8000);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [userId, profileLoading, isAdmin, checkSession]);
};
