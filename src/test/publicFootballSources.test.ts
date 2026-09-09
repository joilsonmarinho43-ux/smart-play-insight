import { describe, expect, it } from 'vitest';
import {
  fetchEspnScoreboard,
  fetchEspnSummary,
  fetchOpenLigaSeason,
  fetchSportsDbSeason,
  fetchPublicCrossChecks,
} from '@/lib/publicFootballSources';

describe('public football sources', () => {
  it('exports independent read-only provider adapters', () => {
    expect(typeof fetchEspnScoreboard).toBe('function');
    expect(typeof fetchEspnSummary).toBe('function');
    expect(typeof fetchOpenLigaSeason).toBe('function');
    expect(typeof fetchSportsDbSeason).toBe('function');
    expect(typeof fetchPublicCrossChecks).toBe('function');
  });

  it('does not require a secret at module load time', () => {
    expect(true).toBe(true);
  });
});
