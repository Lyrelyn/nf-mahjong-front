# 南丰麻将规则引擎（`src/game/nanfeng/`）

## 入口

根地址进的**就是南丰麻将大厅**：`components/nanfeng/NanfengApp.vue` 复用旧版的页面骨架
（`.game-app` + `GameShellHeader` 顶栏的五个主题 / 声音 / 规则 + `.lobby` 布局），
把玩法名与「场次/玩法」两行换成南丰的「人数 / 买码」（`NanfengLobby.vue`，4 人局买码强制关闭）。
大厅保留「单机对战 / 联机对战」两个模式；联机入口已复原，但对接层与房间面板还没写完
（服务端见 `docs/nanfeng-online-integration-plan.md`）。
旧的莲花广麻大厅退到 `?game=lotus` 兜底，等删旧代码时一起移除。
`?players=4|5&ma=0|1|2|4` 直接开局（自动化用），`?debug=1` 显示投影数值。

## 来源与性质

本目录是**逐字移植**，不是重写。规则逻辑、常量、注释全部原样保留，仅在文件头注明来源：

- 代码：`nf-mahjong/assets/scripts/core/**`
- 单测：`nf-mahjong/tests/core/**`（改为与本目录共置的 `*.test.ts`，`@core/*` 别名改为相对路径）

移植纪律：**任何逻辑改动都必须先在 `docs/rules-confirmed.md` 里找到对应条款**（R-01~R-11、Q-01~Q-06、M6-1~M6-6），并同步更新单测。这份文档是规则的唯一权威。

## 牌编码

引擎内部统一使用**整数牌码**，与旧项目、后端 `app/core/nanfeng/tiles.py` 完全一致：

```
万 11..19   条 21..29   筒 31..39
风 41..44（东南西北）   箭 51..53（中/发/白）
```

前端契约层（`core/contracts/types.ts`）用的是字符串牌 `'m1'..'s9'`、`'east'..'white'`。

**两者只通过 [`tileCodec.ts`](./tileCodec.ts) 转换**：引擎之外不出现整数，引擎之内不出现字符串。
注意前端字母与南丰花色顺序不同：`m`=万 → 11，`s`=条 → 21，`p`=筒 → 31（不要按字母顺序硬套）。

## 目录

```
tiles.ts counts.ts melds.ts fanTags.ts ruleConfig.ts prng.ts
tileCodec.ts                 ← 本仓库新增：整数牌码 ↔ 字符串牌（唯一转换层）
hu/      huJudge jiaHu colors guiYi sevenPairs shiSanLan wordStraight decompose
action/  hand pengGang options arbiter
state/   phase gameState apply invariants
score/   scoreTable settle ma     ← ma 为本仓库新增（买码：码牌指向 + 张数）
sim/     randomAgent          ← 无头随机对局（fuzz，测试用）
testSupport/ fixtures         ← 测试夹具（只保留 core 相关部分，联机夹具已剔除）
```

## 与旧项目测试的两处差异（迁移时有意为之）

1. `rules-conformance.test.ts` 删掉了 R-10 里依赖 `@net/messages`（`REFUSE_REASONS`）的单个用例 —— 传输层一期不移植，原位留了注释；其余 R/Q/M6 断言全部保留。
2. `boundary.test.ts`（纯净层守护）把扫描目录改成 `src/game/nanfeng`，并跳过它自己（它内部含 `Date.now()` 示例字符串，搬进被扫描目录后会误伤自己）。断言与数值未改。

`ruleConfig.ts` 是可调数值的单一入口（`cap = 8`、`zimoDouble = false`、杠分 2/1/2、荒庄庄赔 1 等），
`judgeHu` 返回**标签集合**而非单一枚举，`settle` 负责封顶与零和。

## 买码（第 5 个参与者，R-09）

一期已实现（口径见 `docs/superpowers/specs/2026-11-08-nanfeng-ma-design.md`）：

- 张数 `cfg.buyCode.count ∈ {0,1,2,4}`，默认 0 = 普通 4 人局。
- 开局把牌墙**末尾** N 张留作码牌（`state/maTiles`）：不发牌、不摸牌，所以牌墙少 N 张、荒庄提前 N 张。
- 局中不公开；结算时按 `score/ma.ts` 的 `(点数−1)%4` 指相对庄家的座位，买码位**复制被指座位这一局的每一笔现金流**。
- 为此杠分除了净额 `roundGangScore` 还要记流向 `roundGangFlows`（明杠只由点杠者付，净额还原不出谁付给谁）。
- 零和的不变量是**五家**：`Σ scores + Σ roundGangScore + maScore === 0`。

## 本目录**不**包含

- **AI**：旧项目与后端都没有南丰 AI（后端只有 `_auto_discard_tile`）。AI 是独立模块，见 `ai/`。
- 联机/传输/房间：一期只做单机；WS 与 P2P 是二期。
- 视图投影：旧项目的投影在 `assets/scripts/game/projection.ts`（联机层），不在 core 内。
- 买码者中途进出（R-11）。**5 人换座已实现**（`runtime/match.ts` 的 `nextRound()`，见下文）。

## 5 人换座（R-02）

`NanfengMatch` 支持第 5 个人：`new NanfengMatch({ seats: 名册前 4 人, buyerId: 名册第 5 人 })`。
每局结束按 R-02 换一个人下场（点炮者 / 自摸者的对家 / 荒庄的庄家），**上局的买码者接管那把椅子** ——
座位位置与顺序不变，只有人换，所以 `dealer` 这类座位下标继续有效。

真人也在这套轮换里：轮空那一局 `snapshot.humanSeat === -1`，只能观战；`setViewSeat(seat)`
可以点头像切到任意一家的视角（投影层会把 `players` 重新排成"本家视角"，见 `projectToTable.ts` 顶部注释）。
