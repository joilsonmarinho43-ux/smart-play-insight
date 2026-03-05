import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface Profile {
  id: string;
  email: string;
  is_admin: boolean;
  subscription_expiry_date: string | null;
  created_at: string;
}

export const useProfile = () => {
  const { session, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!session?.user?.id) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchProfile = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error('Profile fetch error:', error);
      }
      if (data) {
        setProfile(data as Profile);
      }
      setLoading(false);
    };

    fetchProfile();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, authLoading]);

  const hasAccess = useCallback((): boolean => {
    if (!profile) return false;
    if (profile.is_admin) return true;

    const now = new Date();
    const createdAt = new Date(profile.created_at);
    const trialEnd = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000);

    if (now <= trialEnd) return true;

    if (profile.subscription_expiry_date) {
      return now <= new Date(profile.subscription_expiry_date);
    }

    return false;
  }, [profile]);

  return { profile, loading: loading || authLoading, hasAccess, session };
};
