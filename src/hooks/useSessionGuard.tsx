import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useProfile } from './useProfile';
import { toast } from 'sonner';

/**
 * Device-level session token.
 * Stored in localStorage so ALL tabs of the same browser/device share it.
 * This avoids the multi-tab logout loop: opening a 2nd tab no longer
 * generates a new token and kicks the original tab.
 */
const DEVICE_TOKEN_KEY = 'aj_device_session_token';

const getDeviceToken = (): string => {
  let token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
};

const getDeviceInfo = (): string => {
  const ua = navigator.userAgent;
  const platform = navigator.platform || 'unknown';
  return `${platform} | ${ua.slice(0, 120)}`;
};

// Module-level state survives HMR & remounts within the same tab
let moduleRegisteredForUser: string | null = null;
let registrationInFlight: Promise<void> | null = null;
let consecutiveMismatches = 0;

const POLL_INTERVAL_MS = 45_000;
const FIRST_CHECK_DELAY_MS = 10_000;
const MISMATCH_THRESHOLD = 2; // require 2 consecutive mismatches before logout

export const useSessionGuard = () => {
  const { session, signOut } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = session?.user?.id;
  const accessToken = session?.access_token;
  const isAdmin = profile?.is_admin === true;

  const registerSession = useCallback(async (): Promise<void> => {
    if (!accessToken || !userId) return;
    if (registrationInFlight) return registrationInFlight;

    registrationInFlight = (async () => {
      const sessionToken = getDeviceToken();
      const deviceInfo = getDeviceInfo();
      try {
        const { error } = await supabase.functions.invoke('register-session', {
          body: { session_token: sessionToken, device_info: deviceInfo },
        });
        if (error) {
          console.error('[SessionGuard] register-session error:', error);
          // Do NOT mark as registered — allow retry on next effect run
          moduleRegisteredForUser = null;
        } else {
          moduleRegisteredForUser = userId;
          consecutiveMismatches = 0;
        }
      } catch (err) {
        console.error('[SessionGuard] register-session exception:', err);
        moduleRegisteredForUser = null;
      } finally {
        registrationInFlight = null;
      }
    })();

    return registrationInFlight;
  }, [accessToken, userId]);

  const checkSession = useCallback(async () => {
    if (!userId) return;
    if (moduleRegisteredForUser !== userId) return; // not registered yet

    const sessionToken = getDeviceToken();

    const { data, error } = await supabase
      .from('active_sessions')
      .select('session_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      // Network/transient issue — never logout silently
      console.warn('[SessionGuard] check error (ignored):', error.message);
      return;
    }

    // No row yet — try to (re)register, do not logout
    if (!data) {
      moduleRegisteredForUser = null;
      registerSession();
      return;
    }

    if (data.session_token === sessionToken) {
      consecutiveMismatches = 0;
      return;
    }

    // Mismatch — require N consecutive checks to avoid race conditions during login on another tab
    consecutiveMismatches += 1;
    if (consecutiveMismatches < MISMATCH_THRESHOLD) {
      console.warn(`[SessionGuard] mismatch ${consecutiveMismatches}/${MISMATCH_THRESHOLD} — waiting before logout`);
      return;
    }

    toast.error('Sua conta foi acessada em outro dispositivo. Você foi desconectado.', {
      duration: 8000,
    });
    consecutiveMismatches = 0;
    moduleRegisteredForUser = null;
    await signOut();
  }, [userId, signOut, registerSession]);

  // Reset module state on logout / user change
  useEffect(() => {
    if (!accessToken) {
      moduleRegisteredForUser = null;
      consecutiveMismatches = 0;
    }
  }, [accessToken]);

  // Register once per user (admins skip)
  useEffect(() => {
    if (!accessToken || profileLoading || !userId) return;
    if (isAdmin) return;
    if (moduleRegisteredForUser === userId) return;
    registerSession();
  }, [accessToken, profileLoading, isAdmin, userId, registerSession]);

  // Poll
  useEffect(() => {
    if (!userId || profileLoading || isAdmin) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    timeoutRef.current = setTimeout(() => {
      checkSession();
      intervalRef.current = setInterval(checkSession, POLL_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [userId, profileLoading, isAdmin, checkSession]);
};
