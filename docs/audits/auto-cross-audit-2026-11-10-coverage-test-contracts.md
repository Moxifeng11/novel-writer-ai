# 自动交叉审计 — 覆盖率盲区与测试契约 ④

> 日期：2026-11-10 · 基线：`419a9eb` · 维度：④ 覆盖率盲区与测试契约
> 方法：两个独立视角并行取证（① coverage 产物逐文件盲区 + 旧审计 C 系列时效复核；② E2E/CI 契约与 mock 漂移），交叉核对后合并。
> 本轮修复：**C-9（P1）已修** + 2 项顺带修复；其余入 fix queue。台账见 `docs/progress/auto-iterations.md` 第 14 轮。

## 一、Findings

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 / 修法 |
|---|---|---|---|---|---|---|
| C-9 | **P1** | tests/e2e/utils/obsidian-app.ts:75-81、playwright.config.ts、package.json:21 | E2E 复制插件根 `main.js/styles.css` 到临时 vault，只校验「存在」不校验「新鲜」；`test:e2e` 无前置 build；playwright 无 globalSetup | 源码改动后忘记 `npm run build` 直接跑 E2E | E2E 静默跑在旧产物上——测的不是当前代码，绿灯无意义 | **本轮已修**：新增 `scripts/check-e2e-fresh.mjs`（产物 mtime vs 源码最新 mtime，含 main.js↔源码、styles.css↔styles-src 两条链）+ `tests/e2e/global-setup.ts` + `playwright.config.ts` 接入 `globalSetup`（覆盖 `test:e2e/:ui/:headed` 全入口；`--list` 不执行 globalSetup，CI verify 零回归）。已实跑：新鲜=exit 0；`touch engine/context-manager.ts` 后=exit 1 并提示 build（已知限制：mtime 型检查对「内容回退但 mtime 变新」会误报，强制重建无害） |
| TC-1 | P2 | tests/e2e/full-journey.spec.ts:155/157 | `/s+/g` 匹配的是字母 s 而非空白 `\s+`，「忽略空白差异比对导出内容」的断言静默失效（两端同错恰好不爆红） | 每次导出断言 | 导出内容比对是弱断言，导出丢空白/丢段不会被抓 | **本轮已修**：两处改 `\s+/g` |
| TC-2 | P2 | tests/e2e/fixtures/mock-ai-server.mjs:528 | mock 分析报告只产旧 `RELATION:`，从不产 `RELATION_5D`——五维显式解析（relationship-engine.ts:249-266）在 E2E 全旅程零覆盖；GROWTH/PROMISE_*/ARC/UPDATE_FACTION 等同样零覆盖 | E2E 全旅程 | V2 关系五维只有单测/真实 AI 触达，E2E 契约缺口 | **本轮已修**：mock 增加 `RELATION_5D: 林玄\|苏晚\|trust+6,attraction+2\|…`；其余指令入 fix queue |
| C-8 | P2→**表述修正** | ci.yml:114-115/158-194 | 「CI 只跑 --list」不完全准确：存在 `e2e-obsidian` job（build→test:e2e），但被 `vars.OBSIDIAN_PATH != ''` 门控，未配置时 CI 实际只有 --list | 仓库变量未配置 | E2E 在 CI 从不执行（现状即如此） | 未修（需用户配置 CI 变量/runner，属环境决策）→ 待用户拍板项 |
| CV-1 | P2 | engine/ledger/ledger-link.ts（0/81 stmts、0/53 branches） | ledger 关联边/关联索引渲染完全无测试；错边会污染伏笔库/时间线看板数据 | 台账关联索引落盘 | 关联索引数据质量不可控 | 未修 → fix queue（纯函数，≤80 行测试可锁全分支，node 直跑零 mock） |
| CV-2 | P2 | ui/write-chapter-modal.ts（0.2%/0% branches 0/363） | 写盘编排层无测试（C-4 原样成立） | 一键成文 | 回归只能靠人工 | 未修 → fix queue（需先抽注入函数） |
| CV-3 | P2 | engine/mode-unit-settlement.ts（0/22） | 单元结算标 `status: settled` 零测试（C-5 尾巴；settlement-engine 本体已 53.78%，C-5 前半过时） | 短篇/剧本单元结算 | 假 settled 隐患 | 未修 → fix queue（参照 settle-light-failures 模式） |
| CV-4 | P3 | engine/context-manager.ts 17.06%、ai-scene-expander.ts 0%、export-manuscript-modal 1%、chapter-settlement-modal 0.6% | 上下文/扩写/导出/弹窗结算覆盖极低 | — | 长尾回归风险 | 未修 → fix queue（按价值排序） |

### 旧审计时效复核（2026-11-09 coverage-and-test-contracts.md）

- **C-4 未过时**（write-chapter-modal 仍 0.2%/0%）。
- **C-5 前半过时**：settlement-engine 已 53.78%/42.74%（本轮批次补测见效）；后半（mode-unit-settlement 0/22）仍有效，已并入 CV-3。
- **C-7 数字过时、方向成立**：analysis-report-engine branches 7.25% → 23.52%（apply-journal 测试见效）。

## 二、已排除项（交叉确认）

- coverage/coverage-summary.json 不存在（ Istanbul HTML 产物才是本次数据源）；tmp/cov-body-writer 为单文件临时产物，不代表全仓。
- 「最差 15 文件」多为类型桶/legacy/纯 UI 骨架，非数据热路径——真正热路径盲区在 0/1 文件之后（CV-1~CV-4 已按热路径重排）。
- settings-utils / emotion-curve-view 的「疑似测试引用」均为同名子串或 vi.mock 排除，按无测试计。
- 本轮 mock 增 RELATION_5D 不影响既有 E2E 断言：无任何用例检查 关系状态.md 的「禁止出现」，结算对五维增量幂等有单测覆盖。

## 三、本轮实跑结果

- `node scripts/check-e2e-fresh.mjs`：新鲜 → exit 0；`touch engine/context-manager.ts` → exit 1（提示 npm run build）；`npm run build` 后恢复 exit 0。
- `npx playwright test --list`：56 tests / 11 files 全部可解析（globalSetup 不影响 --list）。

## 四、待用户拍板项

- **C-8 残留**：是否在 GitHub 仓库配置 `vars.OBSIDIAN_PATH`（+ 可选 `vars.OBSIDIAN_E2E_RUNNER`）让 CI 真实执行 E2E？需要自备 Windows runner，属环境/成本决策，不自行决定。
