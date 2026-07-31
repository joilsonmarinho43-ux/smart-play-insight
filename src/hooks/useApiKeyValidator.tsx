import { useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'api_key_validated_at';
const WARN_KEY = 'api_key_warned_at';
const REVALIDATE_AFTER = 1000 * 60 * 60 * 6; // 6h
const WARN_COOLDOWN = 1000 * 60 * 60 * 6; // não repetir aviso por 6h

/**
 * Validação automática da chave SportsRC no boot do app.
 * Faz um ping leve no edge function football-api e exibe toast caso falhe.
 * Cacheia sucesso por 6h para não desperdiçar cota.
 */
export function useApiKeyValidator() {
  useEffect(() => {
    const lastCheck = Number(localStorage.getItem(STORAGE_KEY) || 0);
    if (Date.now() - lastCheck < REVALIDATE_AFTER) return;

    const canWarn = () =>
      Date.now() - Number(localStorage.getItem(WARN_KEY) || 0) > WARN_COOLDOWN;
    const markWarned = () => localStorage.setItem(WARN_KEY, String(Date.now()));

    const validate = async () => {
      try {
        // Health-check do provider primário (SportsRC v2)
        const { data, error } = await supabase.functions.invoke('free-football-proxy', {
          body: { provider: 'sportsrc', path: '/', params: { type: 'account' } },
        });

        if (error) {
          if (canWarn()) {
            markWarned();
            toast.warning('Provedor SportsRC indisponível', {
              description: 'Seguindo com ESPN/cache. Os jogos continuam carregando.',
              duration: 6000,
            });
          }
          return;
        }

        if (data?.error === 'missing_key') {
          if (canWarn()) {
            markWarned();
            toast.error('Chave SportsRC ausente', {
              description: 'Configure SPORTSRC_API_KEY nos secrets.',
              duration: 8000,
            });
          }
          return;
        }

        if (data?.error === 'upstream_error') {
          const status = Number(data?.status);
          // 401/403 = chave inválida; 429 = cota diária. Nos dois casos o app
          // segue funcionando por ESPN/TheSportsDB + cache — aviso informativo.
          if (canWarn()) {
            markWarned();
            if (status === 429) {
              toast.warning('Limite diário da SportsRC atingido', {
                description: 'Usando ESPN/TheSportsDB e cache até a cota renovar.',
                duration: 6000,
              });
            } else {
              toast.warning('SportsRC recusou a requisição', {
                description: `Status ${status} — chave inválida ou plano expirado. Fontes alternativas ativas.`,
                duration: 7000,
              });
            }
          }
          return;
        }

        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch (err: any) {
        if (canWarn()) {
          markWarned();
          toast.warning('Não foi possível validar a API de futebol', {
            description: 'Seguindo com fontes alternativas e cache.',
            duration: 6000,
          });
        }
      }
    };

    // pequeno delay pra não competir com o load inicial
    const t = setTimeout(validate, 1500);
    return () => clearTimeout(t);
  }, []);
}
