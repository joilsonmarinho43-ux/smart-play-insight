export type WebEvidence = { text: string; sourceUrl: string };
type Request = (endpoint: string, payload: unknown, headers: Record<string,string>, timeout: number) => Promise<any>;

// Only publisher content is evidence; Tavily's generated answer is never used.
export function normalizeSearchResults(data: any): WebEvidence[] {
  const seen = new Set<string>();
  return (Array.isArray(data?.results) ? data.results : []).slice(0, 5).flatMap((row: any) => {
    try {
      const url = new URL(row?.url);
      if (url.protocol !== 'https:' || url.username || url.password || seen.has(url.href)) return [];
      const raw = typeof row.raw_content === 'string' && row.raw_content.trim() ? row.raw_content : row.content;
      if (typeof raw !== 'string' || raw.trim().length < 40) return [];
      seen.add(url.href);
      return [{ sourceUrl: url.href, text: raw.trim().slice(0, 12000) }];
    } catch { return []; }
  });
}

export async function searchWebEvidence(apiKey: string, teams: string[], league: string, cutoff: number, request: Request): Promise<WebEvidence[]> {
  const searches = await Promise.allSettled(teams.slice(0, 2).map(team => request('https://api.tavily.com/search', {
    query: `${team} ${league} recent completed matches match statistics possession shots corners xG before ${new Date(cutoff).toISOString().slice(0,10)}`,
    search_depth: 'basic', topic: 'general', max_results: 3,
    include_answer: false, include_raw_content: 'text', auto_parameters: false,
  }, { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, 15000)));
  const seen = new Set<string>();
  const evidence = searches.flatMap(result => result.status === 'fulfilled' ? normalizeSearchResults(result.value) : []).filter(row => {
    if (seen.has(row.sourceUrl)) return false; seen.add(row.sourceUrl); return true;
  });
  if (!evidence.length && searches.every(result => result.status === 'rejected')) {
    // Propagate a sanitized status only, never a provider response or credential.
    const reason = searches[0].status === 'rejected' ? String(searches[0].reason?.message || '') : '';
    throw new Error(`WEB_SEARCH_FAILED:${reason.match(/HTTP_\d{3}/)?.[0] || 'UNAVAILABLE'}`);
  }
  return evidence;
}
