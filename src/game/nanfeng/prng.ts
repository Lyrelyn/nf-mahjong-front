// 移植自 nf-mahjong/assets/scripts/core/prng.ts（逻辑未改动）
/**
 * 伪随机数：引擎禁区里**唯一**允许的随机来源。
 *
 * 时间与随机数一律由参数注入（spec §3.3）：状态机接收 `Rng`，而不是自己去取随机数 ——
 * 这样同一颗种子能完整重放一局，fuzz 失败时可以把种子写进用例。
 *
 * 本文件属于引擎禁区（spec §3.3），且**不得**使用 `Math.random`。
 */

export interface Rng {
  /** [0, 1) 的伪随机数。 */
  next(): number;
}

/**
 * xorshift128，种子用 splitmix32 摊成 4 个状态字。
 *
 * 直接拿种子当状态会让 0、1 这类弱种子产生退化序列；先摊一次再预热 16 轮，
 * 相邻种子的牌墙才会明显不同（用例锁住了这一点）。
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const nextSeed = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };

  let a = nextSeed();
  let b = nextSeed();
  let c = nextSeed();
  let d = nextSeed();

  const nextUint32 = (): number => {
    const t = (a ^ (a << 11)) >>> 0;
    a = b;
    b = c;
    c = d;
    d = ((d ^ (d >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return d;
  };

  for (let i = 0; i < 16; i++) nextUint32(); // 预热

  return { next: () => nextUint32() / 0x100000000 };
}

/** Fisher–Yates 洗牌，返回新数组（不改动入参）。 */
export function shuffleWall<T>(wall: readonly T[], rng: Rng): T[] {
  const out = wall.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
