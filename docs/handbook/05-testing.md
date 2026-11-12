# 05 · 测试

> 目标：测试是**行为契约**，不是覆盖率数字游戏。测试基线以 `docs/progress/program-status.json` 与 CI 实测为准，不在文档里写死。
>
> 本文分两部分：**标准**（什么算合格的测试）与**流程**（一次改动怎么走完测试）。
> 标准中可机械校验的四条由 `npm run check:test-standard` 在 preflight 强制执行。

---

## 1. 测试层级

| 层级 | 目录 | 用途 | 运行 |
|---|---|---|---|
| 单元 | `tests/unit/**` | 纯函数、引擎行为、状态机、契约 | `npm test` |
| 集成 | `tests/integration/**` | 跨模块（项目工作流、知识库链、三条数据流） | `npm test` |
| 基准 | `tests/benchmark/**` | 人味/质量基准 | `npm run eval:*` |
| E2E | `tests/e2e/**` | 真实 Obsidian Electron 旅程 | `npm run test:e2e` |

- 单元/集成共用 `tests/__mocks__/obsidian.ts`（`vitest.config.ts` 里 alias 到 `obsidian`）。
- E2E 使用独立 `--user-data-dir` + CDP，不复用本机 Obsidian 实例。

## 2. 常用命令

```bash
npm test                       # 全量单元/集成
npm run test:cov               # 带覆盖率门禁
npm run check:test-standard    # 测试标准门禁（.only / skip 理由 / 空断言 / 替身忠实性）
npx vitest run tests/unit/engine/body-writer.test.ts
npm run test:e2e               # 需 OBSIDIAN_PATH
npx playwright test --list     # 只校验用例可解析（CI 用）
```

## 3. 覆盖率阈值（当前）

与 `vitest.config.ts` 的 `coverage.thresholds` 一一对应（2026-11-07 核对）：

| 域 | lines | statements | branches | functions |
|---|---|---|---|---|
| `engine/**` | 52 | 52 | 52 | 40 |
| `services/**` | 36 | 36 | 40 | 26 |
| `core/**` | 45 | 45 | 49 | 14 |
| `shared/**` | 85 | 84 | 77 | 80 |
| `domains/**` | 84 | 82 | 70 | 70 |
| `ui/**` | 10 | 9 | 10 | 8 |

- 口径：`engine/`、`services/`、`core/`、`shared/`、`domains/`、`ui/` 全部纳入统计；排除 `tests/`、`**/*.d.ts`、Worker 入口、构建期嵌入资产与纯类型声明文件。无全局阈值。
- 2026-11-05 移除全局四项阈值、全部改为 per-glob：纳入 `ui/`、`domains/` 后全局并集从约 65% 摊薄到约 40%，全局阈值既不代表任何单一域，也压不住新纳入的低覆盖目录；per-glob 让每个域对自己的真实基线负责。
- `ui/**` 首期基线 3/3/4/3（2026-11-05 实测仅约 6%——此前全部 ui 文件游离在门禁之外）已于同日上拧到 10/9/10/8。
- `domains/**` 首期实测 lines 86.91 / statements 84.03 / branches 72.41 / functions 72.72，各下浮约 2 点取整为基线。
- 棘轮纪律：per-glob 阈值只升不降；下调必须在 PR 里说明理由。
- 语义注意：threshold glob 按相对路径精确匹配，`services/**` 阈值只管 `services/` 顶层目录；被 include 连带纳入统计的 `ui/services/` 由 `ui/**` 阈值接管。
- `preflight` 不含覆盖率，`preflight:release` 与 CI 才跑 `test:cov`。

---

## 4. 测试标准（硬规则）

> 以下 7 条是「一次改动能否合并」的判据。前 4 条由 `check:test-standard` 机械执行，后 3 条靠评审。

### 标准 1 · 测试替身必须忠实（**本项目头号缺陷来源**）

测试替身（`tests/__mocks__/obsidian.ts`、`tests/unit/ui/support/fake-dom.ts`、各种 `FakeFileSystem`）**必须复现真实环境的语义**，而不是「让测试好过」。

真实事故（2026-11-12）：mock 的 `getAbstractFileByPath` 对**点文件**也返回 `TFile`，而真实 Obsidian 不把点文件纳入 vault 索引。于是 `readFanficRules` 用 `getAbstractFileByPath('.project')` 读同人元数据、在生产里永远拿到 `null`（同人约束全线静默失效），**测试却全绿**。

铁律：

- 替身对某个 API 的返回值，必须能在官方文档/实测里找到依据；找不到依据就写「未知」并在测试里显式标注。
- 已知的真实行为差异必须写进替身并加注释（例：点文件不入索引 → `return null`）。
- 替身守卫由 `check:test-standard` 与 `tests/unit/architecture/test-double-fidelity.test.ts` 双重锁定。

### 标准 2 · 失败路径与成功路径同权

**只测 happy path 的测试，等于没测。** 每个写操作/读操作至少覆盖：

| 路径 | 必须断言 |
|---|---|
| 成功 | 结果正确、副作用落盘 |
| **读失败**（抛错，不是「文件不存在」） | 不得用默认值覆盖磁盘；不得把「读不到」当「没有」 |
| **写失败** | 返回值/异常让调用方感知；不得提示成功 |
| 数据损坏（半截 JSON） | 先留档（`.corrupt-<ts>`）再重建，或拒绝覆盖 |

反例（已修）：`KnowledgeBaseConfigManager` 的测试组叫「读失败不得覆盖磁盘」，却只测了「坏 JSON」与「文件不存在」两种，**真正的读抛错没覆盖**——而缺陷恰恰在那里。

### 标准 3 · 回归锁：修一个 bug 必须留一条会红的测试

修 bug 的提交必须包含一条测试，且满足：

1. **改回旧代码时这条测试会红**（提交前用 `git stash` 或临时还原验证一次）；
2. 测试名写清**用户可见后果**，不是「调用不抛错」；
3. 如果根因在测试替身（如标准 1），先修替身，让**同类缺陷一起暴露**——这是最高价值的修法。

### 标准 4 · 禁止让测试静默失效

- `.only(` **绝不允许提交**（其余用例静默不跑，CI 绿得毫无意义）。
- `.skip(` 必须给理由：`test.skip(cond, '理由')`、`describeSkipReason()`，或附近 `// skip-reason:` 注释。
- 禁止空断言（`expect(true).toBe(true)`、`expect(1).toBe(1)`）。
- 禁止把「环境缺失导致的 skip」当成通过（见 §7 生产环境测试）。

### 标准 5 · 断言行为，不断言实现

- 断言公开入口的输入/输出/失败/边界，不断言私有方法被调用过。
- 并发/锁/回滚类改动必须有专门回归（参考 `body-writer-concurrent-write.test.ts`、`settlement-engine-behavior.test.ts`）。
- 架构约束用源码扫描测试固化（参考 `tests/unit/architecture/`）。

### 标准 6 · 一个用例只验证一个行为域

- 用例名是**可读的中文行为句**：`'配置存在但读取抛错时不得覆盖磁盘（用户自定义分类会丢）'`。
- 不用一个 `it` 同时断言落盘、提示、内存三件事——失败时无法定位。

### 标准 7 · 不写永久为真的占位测试

- 删掉的占位测试不要用 `describe.skip` 留尸；确实要保留的写 `skip-reason:`。
- 不为了覆盖率写「调用一次、断言不抛错」的测试。

---

## 5. 写一条好测试

```ts
// tests/unit/engine/xxx.test.ts
import { describe, expect, it } from 'vitest';

describe('模块名 — 行为域', () => {
    it('输入 A 时返回 B（可读的中文行为句）', async () => {
        // arrange：最小依赖，优先用 MockFileSystem/FakeFrontmatter
        // act：只调用一个公开入口
        // assert：断言行为，不断言实现细节
    });
});
```

约定：

- 断言「行为」而不是「调用了哪个私有方法」。
- 并发/锁/回滚类改动必须有专门的回归用例（参考 `body-writer-concurrent-write.test.ts`、`settlement-engine-behavior.test.ts`）。
- 架构约束用源码扫描测试固化（参考 `tests/unit/architecture/domain-isolation.test.ts`）。
- 不写永久为真的占位测试；删掉的占位测试不要用 `describe.skip` 留尸。

---

## 6. 生产环境测试（真实 Obsidian + 真实数据）

> 单元测试证明「逻辑对」，生产环境测试证明「在真的 Obsidian 里真的生效」。
> 本项目核心命题是「每一条用户以为生效的链路都必须真的生效且能被证明」——只有生产环境测试能给出这个证明。

### 6.1 三层验证矩阵

| 层 | 环境 | 证明什么 | 入口 |
|---|---|---|---|
| L1 逻辑 | vitest + 忠实替身 | 分支/边界/失败路径 | `npm test` |
| L2 集成 | vitest + 假 vault（真实文件格式） | 跨模块链路 | `npm test` |
| **L3 生产** | **真实 Obsidian Electron + 真实 vault** | **界面与磁盘真的变了** | `npm run test:e2e` |

L3 不可被 L1/L2 替代。历史教训：三条数据流在 L1/L2 全绿，但在真实 vault 上「知识库 0 本书、指纹 0 枚、无 `.project`」→ 链路一条都验证不了（见 `docs/audits/three-flows-runtime-verification.md`）。

### 6.2 生产环境测试的四种手段

1. **真实 Obsidian E2E**（`tests/e2e/`）：独立 `--user-data-dir` + CDP，不复用本机实例；临时 vault 结束即删（`KEEP_E2E_VAULT=1` 保留排查）。
2. **mock AI 端点的完整旅程**（`tests/e2e/fixtures/mock-ai-server.mjs`）：不耗额度跑「创建 → 规划 → 正文 → 质控 → 分析 → 结算 → 导出」。
3. **真实 vault 只读验证**（`scripts/verify-three-flows.mjs`）：对用户真实 vault 做只读体检，输出「已验证 / 无法验证 / 有断点」三态，退出码 0/1/2。
4. **示例数据种子**（`scripts/seed-demo-vault.mjs`）：在临时目录生成最小真实数据集，让三条链路从「无法验证」变成「已验证」。

### 6.3 前提与开关

前提：

- 已 `npm run build`；
- `OBSIDIAN_PATH` 指向 Obsidian 可执行文件；
- 运行前关闭正在使用的 Obsidian（单实例锁）；
- 测试会在临时目录创建独立 vault，结束自动删除（`KEEP_E2E_VAULT=1` 保留）。

危险开关（必须显式开启，且**不得**写进默认脚本）：

- `E2E_REAL_AI=1`：会消耗真实 API 额度；
- `E2E_PERF=1`：性能采样；
- `E2E_REWRITE=1`：破坏性 E2E（当前无脚本消费，保留作通用红线）。

### 6.4 生产环境模拟（mock AI）覆盖表

| spec | project | 覆盖 |
|---|---|---|
| `full-journey.spec.ts` | `full-journey` | 长篇全链路、落盘/frontmatter/导出断言、禁用重启用数据保留 |
| `button-states.spec.ts` | `button-states` | 结算/步骤/协同工具/Agent 发送的忙碌态与防连点 |
| `view-lifecycle.spec.ts` | `view-lifecycle` | 生成中关闭视图、快速连切章节、监控面板重开 |

```bash
OBSIDIAN_PATH=... npx playwright test --project=full-journey
OBSIDIAN_PATH=... npx playwright test --project=button-states
OBSIDIAN_PATH=... npx playwright test --project=view-lifecycle
```

### 6.5 ⚠️ skip 不是通过

未设置 `OBSIDIAN_PATH` 时 Electron 用例会 skip 且退出码 0——**这是假绿**。CI 用 `playwright test --list` 只做解析校验。

因此：

- 任何「本次改动影响用户可见行为」的结论，**不得**只依据 skip 掉的 E2E；
- 发版前必须至少在一台真实 Obsidian 上手工跑一遍 §6.6 清单，并在 `docs/releases/` 记录结果；
- `check:test-standard` 要求所有 skip 写明理由，就是为了让「跳过」这件事在评审时可见。

### 6.6 发版前手工验收清单（真实 Obsidian）

按「用户以为生效的链路」逐条确认，每条都要**看到磁盘/界面真的变了**：

| # | 链路 | 验收动作 | 通过判据 |
|---|---|---|---|
| 1 | 创建项目 | 向导走完三步 | 项目目录、`.project`、模板文件都在；重启后仍在 |
| 2 | 同人约束 | 绑定同人设定后生成人物 | 生成结果里出现原作红线；`diagnose_flow` 报同人已生效 |
| 3 | 知识流 | 拆解一本书 → 检索 | 拆解报告落盘；检索命中；`rag_sources` 有归因 |
| 4 | 风格流 | 提取指纹 → 启用 → 写一章 | 指纹文件落盘；重启后仍启用；正文体现风格 |
| 5 | 约束流 | 写同人设定 → 审核 → 结算 | 审核状态落盘；结算表生成；约束进 prompt |
| 6 | 写章 | 一键写章 | 正文落盘、字数达标、frontmatter 正确 |
| 7 | 结算 | 章节结算 | 结算表/快照/总览都生成；实体卡被更新 |
| 8 | 导出 | 导出 EPUB/TXT | 文件可打开、章节齐全、投稿简介/标签在（EPUB 查 `dc:description`） |
| 9 | 数据安全 | 手动改坏一个 JSON → 重启 | 插件不崩、坏文件被留档为 `.corrupt-*`、数据未丢 |
| 10 | 自愈 | `diagnose_flow` 报断点 → `repair_flow` 修 | 修复后复诊为通；重启后仍通 |

---

## 7. 流程：一次改动怎么走完测试

### 7.1 通用提交前检查

```bash
npx tsc --noEmit          # 类型
npm run check:test-standard # 测试标准（.only/skip/空断言/替身忠实性）
npx vitest run <相关测试>
npm run preflight         # 29 步门禁
```

### 7.2 按改动类型

| 改动类型 | 必做 |
|---|---|
| 新增功能 | 单元测试（成功 + 失败 + 边界）+ 若影响界面则补 E2E 或手工验收 |
| 修 bug | **回归锁测试**（标准 3）+ 验证「改回旧代码会红」 |
| 改 Obsidian API 用法 | 先查官方文档确认语义；若与替身不一致，**先改替身**再改代码 |
| 改数据格式/路径 | 检查所有读取方；补「旧格式仍可读」的测试 |
| 改门禁/脚本 | 补脚本自身测试；确认门禁对「空扫描/量具失效」会红 |
| 改 UI 渲染 | 用 `tests/unit/ui/support/fake-dom.ts`；断言真实文案/类名，不断言实现 |

### 7.3 修 bug 的标准动作（本项目反复验证有效）

1. **先复现**：写一条会红的测试（或证明现有测试为什么没抓到）。
2. **查根因层级**：是生产代码错，还是**测试替身不忠实**（标准 1）？
   - 若是替身：先修替身 → 让同类缺陷一起暴露 → 再逐个修（最高 ROI）。
3. **修最小面**：区分「不存在」与「失败」，失败不覆盖数据，损坏先留档。
4. **验证回归锁**：临时还原旧代码，确认新测试会红。
5. **跑全量**：`npx vitest run` + `npm run preflight`。
6. **记录**：`docs/audits/` 或提交信息里写清「什么输入 → 用户看到什么错误结果」。

### 7.4 评审时重点看

- 测试是否只覆盖 happy path；
- 是否有 `.only` / 无理由 `.skip` / 空断言；
- 是否引入新的测试替身行为差异（且未注释依据）；
- 修 bug 的提交有没有回归锁测试；
- 涉及写入的路径，读失败分支是否被覆盖。

---

## 8. 测试与文档的分工

- 测试 = **行为契约**：输入/输出/失败/边界。
- JSDoc `@example` = **用法契约**：怎么调用、最小可运行片段。
- 不要用测试重复写用法说明，也不要用 `@example` 代替失败路径测试。

## 9. 排查测试问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 全量通过但 CI 挂 | 本地 Node 版本不同 / 覆盖率未跑 | 用 Node 20，跑 `test:cov` |
| E2E 全 skip | 未设 `OBSIDIAN_PATH` | 设置后重跑；**不要当通过** |
| 测试随机失败 | 共享模块级缓存/时间依赖 | 隔离实例、注入时钟、避免模块级可变状态 |
| 覆盖率骤降 | 新增文件未测试 / 口径变化 | 看 `coverage/` 报告，补关键路径 |
| 测试里 Obsidian API 缺失 | mock 不完整 | 在 `tests/__mocks__/obsidian.ts` 补**忠实**实现（附依据），不要 mock 整个模块 |
| 生产坏了但测试全绿 | **替身不忠实**（标准 1） | 先修替身，让同类缺陷暴露 |

## 10. 相关文档

- 联动链与手工验收：[../regression/LINKED-SCENARIOS.md](../regression/LINKED-SCENARIOS.md)
- E2E 细节：[../../tests/e2e/README.md](../../tests/e2e/README.md)
- 门禁与发布：[06-gates-and-release.md](06-gates-and-release.md)
- 运行层验证报告：[../audits/three-flows-runtime-verification.md](../audits/three-flows-runtime-verification.md)
- 示例数据种子验证：[../audits/demo-seed-verification.md](../audits/demo-seed-verification.md)
