// Temporary probe — diagnose why fixtures/statistics returns empty
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const key = Deno.env.get('API_FUTEBOL_KEY');
  if (!key) return new Response(JSON.stringify({ error: 'no key' }), { status: 500, headers: corsHeaders });

  // 1. live fixtures
  const liveRes = await fetch('https://v3.football.api-sports.io/fixtures?live=all', { headers: { 'x-apisports-key': key } });
  const live = await liveRes.json();
  const fixtures = (live?.response || []).slice(0, 5).map((f: any) => ({
    id: f.fixture.id,
    league: `${f.league?.name} (${f.league?.id})`,
    teams: `${f.teams?.home?.name} vs ${f.teams?.away?.name}`,
    minute: f.fixture?.status?.elapsed,
  }));

  // 2. probe stats for first 5
  const stats = [];
  for (const f of fixtures) {
    const sR = await fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${f.id}`, { headers: { 'x-apisports-key': key } });
    const sJ = await sR.json();
    stats.push({
      fixture: f,
      http: sR.status,
      errors: sJ?.errors,
      results: sJ?.results,
      response_length: (sJ?.response || []).length,
      sample_types: (sJ?.response?.[0]?.statistics || []).map((s: any) => s.type).slice(0, 5),
    });
  }

  return new Response(JSON.stringify({
    live_count: live?.response?.length,
    live_errors: live?.errors,
    fixtures,
    stats,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
