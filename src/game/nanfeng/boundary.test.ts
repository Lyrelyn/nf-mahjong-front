// 移植自 nf-mahjong/tests/core/boundary.test.ts（逻辑未改动）
//
// 唯一改动：文件扫描不再用 `node:fs`（本仓库没有 `@types/node`，`vue-tsc` 会报 TS2307），
// 改用 Vite 的 `import.meta.glob` + `?raw`。语义完全一致：扫描纯净层目录下所有 `.ts`，
// 剥离块注释后再检查禁区调用。
import { describe, it, expect } from 'vitest'

/**
 * 引擎禁区守护测试（spec §3.3 的硬性规则）：
 * 纯逻辑层不得依赖 Cocos、IO 或任何不确定来源。
 * 时间与随机数一律由参数注入，随机数用 core/prng.ts。
 *
 * 覆盖范围：`src/game/nanfeng/**` —— 规则引擎与 AI/运行时都在这里，必须纯净，
 * 否则回放与房主迁移都会失稳（时间要从参数进来，随机数要用注入的 PRNG）。
 * UI 组件（`src/components/nanfeng/**`）不在范围内，那里取时间戳是合法的。
 *
 * 两条避免误报的措施（Ruling 5）：
 *   1. 先剥离块注释再扫描 —— 注释里讨论这些名字（例如说明"不许用 Math.random"）不该算违规；
 *   2. 调用类模式要求后跟括号 —— 只抓真正的调用点。
 */
const PURE_DIRS = ['src/game/nanfeng'] as const

/** 本文件自己：它内部含 `Date.now()` 这类**示例字符串**（自检那条用例），必须排除。 */
const SELF_FILE = '/src/game/nanfeng/boundary.test.ts'

const RAW_FILES = import.meta.glob('/src/game/nanfeng/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FORBIDDEN: readonly [RegExp, string][] = [
  [/\bfrom\s+['"]cc['"]/, 'Cocos 引擎（cc）'],
  [/\bMath\.random\s*\(/, 'Math.random'],
  [/\bDate\.now\s*\(/, 'Date.now'],
  [/\bperformance\.now\s*\(/, 'performance.now'],
  [/\bfetch\s*\(/, 'fetch'],
]

function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

function walk(dir: string): string[] {
  const prefix = `/${dir}/`
  return Object.keys(RAW_FILES).filter((path) => path.startsWith(prefix) && path !== SELF_FILE)
}

describe('引擎禁区守护', () => {
  const files = PURE_DIRS.flatMap((dir) => walk(dir))

  it('至少扫描到纯净层目录下的文件（防止空目录导致守护测试空转）', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const dir of PURE_DIRS) {
      expect(walk(dir).length, `${dir} 一个文件都没扫到`).toBeGreaterThan(0)
    }
    expect(files.some((file) => file.includes('game'))).toBe(true)
  })

  it('纯净层不得依赖 Cocos、IO 或不确定来源', () => {
    for (const file of files) {
      const src = stripBlockComments(RAW_FILES[file] ?? '')
      for (const [pattern, label] of FORBIDDEN) {
        expect(src, `${file} 命中禁区：${label}`).not.toMatch(pattern)
      }
    }
  })

  it('剥离注释后仍能抓到真实的禁区调用（守护测试自身不得失效）', () => {
    const sneaky = ['/** 这里可以讨论 Date.now 这个词 */', 'const t = Date.now();'].join('\n')
    const cleaned = stripBlockComments(sneaky)
    expect(cleaned).toMatch(/\bDate\.now\s*\(/)
    const innocent = ['/** spec 规定不得使用 Math.random / Date.now */', 'export const x = 1;'].join('\n')
    expect(stripBlockComments(innocent)).not.toMatch(/\bMath\.random\s*\(/)
  })
})
