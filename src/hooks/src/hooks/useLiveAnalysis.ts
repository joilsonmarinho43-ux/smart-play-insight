import { useQuery } from '@tanstack/react-query';
import { fetchLiveMatches } from '@/services/footballApi';
import { MatchData } from '@/types/match';

// Hook para leituras ao vivo com intervalo e refetch automático
export function useLiveAnalysis() {
  const { data, isLoading, error, isFetching, refetch } = useQuery<MatchData[]>({
    queryKey: ['live-analysis'],
    queryFn: fetchLiveMatches,
    refetchInterval: 10000, // 10s
    staleTime: 5000,
    retry: 1,
  });

  return { data: data ?? [], isLoading, isFetching, error, refetch };
    }
