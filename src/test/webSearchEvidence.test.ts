import { describe, expect, it, vi } from 'vitest';
import { normalizeSearchResults, searchWebEvidence } from '../../supabase/functions/_shared/web-search-evidence';

const content = 'Published match report containing dates, team names and match statistics.';
describe('independent search evidence', () => {
  it('accepts publisher text, ignores generated answers, removes unsafe and duplicate URLs', () => {
    const rows = normalizeSearchResults({ answer: 'Invented answer', results: [
      { url: 'https://example.com/match', raw_content: content, content: 'summary' },
      { url: 'https://example.com/match', content },
      { url: 'javascript:alert(1)', content },
      { url: 'https://user:secret@example.com/match', content },
      { url: 'https://example.org/match', raw_content: null, content },
    ] });
    expect(rows).toEqual([{ sourceUrl: 'https://example.com/match', text: content }, { sourceUrl: 'https://example.org/match', text: content }]);
  });
  it('retrieves pages without any Gemini request and preserves a successful team when the other fails', async () => {
    const request = vi.fn().mockResolvedValueOnce({ results: [{ url: 'https://example.com/match', content }] }).mockRejectedValueOnce(new Error('HTTP_429'));
    const result = await searchWebEvidence('test-only', ['Home', 'Away'], 'League', Date.UTC(2026,8,24), request);
    expect(result).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    for (const call of request.mock.calls) {
      expect(call[0]).toBe('https://api.tavily.com/search');
      expect(call[1]).toMatchObject({ include_answer: false, include_raw_content: 'text', search_depth: 'basic', max_results: 3 });
      expect(call[2]).toMatchObject({ Authorization: 'Bearer test-only' });
    }
  });
  it('does not return provider error contents or credentials', async () => {
    const request = vi.fn().mockRejectedValue(new Error('HTTP_401 sensitive-response'));
    await expect(searchWebEvidence('test-only', ['Home'], 'League', Date.now(), request)).rejects.toThrow('WEB_SEARCH_FAILED:HTTP_401');
  });
});
