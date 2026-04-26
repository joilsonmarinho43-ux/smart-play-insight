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
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase.functions.invoke('football-api', {
          body: { date: today },
        });

        if (error) {
          toast.error('Falha na validação da API de futebol', {
            description: error.message || 'Verifique a chave API_FUTEBOL_KEY.',
            duration: 8000,
          });
          return;
        }

        // Se voltou error explícito da API (ex: token inválido)
        if (data?.error || data?.errors) {
          const msg =
            typeof data.error === 'string'
              ? data.error
              : data.errors?.token || data.errors?.requests || 'Chave inválida ou cota excedida.';
          toast.error('API de futebol indisponível', {
            description: String(msg),
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
