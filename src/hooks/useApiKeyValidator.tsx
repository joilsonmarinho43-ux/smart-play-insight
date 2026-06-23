import { useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'api_key_validated_at';
const REVALIDATE_AFTER = 1000 * 60 * 60 * 6; // 6h

/**
 * Validação automática da API_FUTEBOL_KEY no boot do app.
 * Faz um ping leve no edge function football-api e exibe toast caso falhe.
 * Cacheia sucesso por 6h para não desperdiçar cota.
 */
export function useApiKeyValidator() {
  useEffect(() => {
    const lastCheck = Number(localStorage.getItem(STORAGE_KEY) || 0);
    if (Date.now() - lastCheck < REVALIDATE_AFTER) return;

    const validate = async () => {
      try {
        // Health-check do provider primário (SportsRC v2)
        const { data, error } = await supabase.functions.invoke('free-football-proxy', {
          body: { provider: 'sportsrc', path: '/', params: { type: 'account' } },
        });

        if (error) {
          toast.error('Falha ao validar SportsRC', {
            description: error.message || 'Verifique SPORTSRC_API_KEY.',
            duration: 8000,
          });
          return;
        }

        if (data?.error === 'missing_key') {
          toast.error('Chave SportsRC ausente', {
            description: 'Configure SPORTSRC_API_KEY nos secrets.',
            duration: 8000,
          });
          return;
        }

        if (data?.error === 'upstream_error') {
          toast.error('SportsRC respondeu com erro', {
            description: `Status ${data.status} — verifique a chave ou o limite diário.`,
            duration: 8000,
          });
          return;
        }


        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch (err: any) {
        toast.error('Erro ao validar API de futebol', {
          description: err?.message || 'Conexão falhou.',
          duration: 8000,
        });
      }
    };

    // pequeno delay pra não competir com o load inicial
    const t = setTimeout(validate, 1500);
    return () => clearTimeout(t);
  }, []);
}
