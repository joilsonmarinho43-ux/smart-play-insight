import { describe, expect, it } from 'vitest';
import { classifyConfidence } from '@/lib/confidencePolicy';

describe('confidencePolicy safety', () => {
  it('does not authorize missing confidence', () => {
    expect(classifyConfidence(undefined).mode).toBe('discard');
    expect(classifyConfidence(null).mode).toBe('discard');
  });

  it('does not authorize invalid confidence', () => {
    expect(classifyConfidence(Number.NaN).mode).toBe('discard');
    expect(classifyConfidence(Number.POSITIVE_INFINITY).mode).toBe('discard');
  });

  it('preserves configured thresholds', () => {
    expect(classifyConfidence(85).mode).toBe('normal');
    expect(classifyConfidence(70).mode).toBe('conservative');
    expect(classifyConfidence(50).mode).toBe('info_only');
    expect(classifyConfidence(49.99).mode).toBe('discard');
  });
});
