// 移植自 nf-mahjong/tests/core/smoke.test.ts（逻辑未改动）
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
