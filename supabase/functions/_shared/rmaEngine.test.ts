import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { evaluateRMA } from './rmaEngine.ts';

describe('RMA red-reduction guards', () => {
  it('blocks estimated dangerous attacks without enough real volume', () => {
    const r = evaluateRMA({ minute: 20, pressure: 75, dangerousAttacks: 18, totalShots: 5, shotsOnGoal: 2, daEstimated: true });
    assertEquals(r.verdict, 'BLOQUEADO');
  });

  it('blocks very early samples without enough shots on target', () => {
    const r = evaluateRMA({ minute: 12, pressure: 70, dangerousAttacks: 12, totalShots: 5, shotsOnGoal: 2, daEstimated: false });
    assertEquals(r.verdict, 'BLOQUEADO');
  });

  it('can confirm a sustained high-quality live attack profile', () => {
    const r = evaluateRMA({ minute: 32, pressure: 72, dangerousAttacks: 24, totalShots: 12, shotsOnGoal: 6, daEstimated: false });
    assert(r.verdict === 'CONFIRMADO' || r.verdict === 'NEUTRO');
    assert(r.score >= 30);
  });
});
