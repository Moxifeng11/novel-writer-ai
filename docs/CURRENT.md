# 现状卡（CURRENT）

> 状态：活跃（唯一「现在是什么样」的权威入口）
> 版本：v4.96.1 · 更新：2026-11-17
> 维护规则：**发版或结构变化时必须同步本文**；本文不抄数字，数字只引用真相源。
> 读完本文再读别的文档；其他文档与本文冲突时，以本文 + 代码 + 生成物为准。

---

## 1. 这是什么

Obsidian 插件「小说工坊 AI」：长篇 / 短篇 / 剧本三域创作 + 知识库拆解 + AI Agent 工作台。
仓库是**独立 git 仓**（vault 的 `.obsidian/` 被 vault 忽略），日常开发全部在本仓内完成。

## 2. 代码结构（真实目录，2026-11-17 核对）

| 目录 | 职责 |
|---|---|
| `core/` | 命令注册、设置服务、插件生命周期装配 |
| `engine/` | 业务引擎：生成、结算、质控、修订、知识库、拆解、Agent/Harness |
| `services/` | 长流程与外围服务：执行台账、Worker、模型发现、备份 |
| `shared/` | 跨层原语：路径 `paths.ts`、缓存、存储、加密、写锁、类型 |
| `domains/` | 三域模型：`kernel`（共享）、`long`、`short`、`script` |
| `ui/` | 视图、弹窗、组件、工作台（`ui/full-writer/`）、设置页 |
| `types/` `utils/` `workers/` | 类型声明、工具函数、Worker 源码 |
| `styles-src/` | 样式源文件，拼接为根目录 `styles.css`（`npm run build:styles`） |
| `tests/` | unit / integration / e2e / benchmark |
| `scripts/` | 门禁、生成器、开发脚本 |

**没有 `src/`**。看到文档写 `src/...` 就是过时描述。

## 3. 质量与数字（不要手抄）

| 事实 | 唯一来源 |
|---|---|
| 版本 | `package.json` 的 `version` |
| 门禁步骤与命令 | `package.json` 的 `scripts`；可读版 `docs/generated/gates.md` |
| 文件清单与规模 | `docs/generated/code-index.md` |
| 测试/E2E 基线 | `docs/progress/program-status.json`；最近一次 `npm run preflight` 输出为实测值 |
| 体积/覆盖率/CSS/JSDoc 预算 | `.bundle-baseline.json`、`.coverage-baseline.json`、`.css-baseline.json`、`.jsdoc-baseline.json` |

提交前跑 `npm run preflight`（全量门禁）；发布前 `npm run preflight:release`。
门禁只允许指标下降/覆盖率上升；上调基线必须 `--update-baseline --note "原因"`。

## 4. 当前在做什么

| 载体 | 用途 |
|---|---|
| `docs/planning/2026-11-16-next-focus.md` | **下一步优先级**（P0 质量闭环入口 / P1 可发现性 / P2 技术债） |
| `docs/modules/INDEX.md` | 模块清单与推进顺序（一次只推进一个模块） |
| `docs/modules/<模块>.md` | 单模块现状、验收记录、待办 |
| `docs/design/2026-11-16-visual-refactor-standard.md` | 视觉重构标准（切片 A–M） |

## 5. 文档怎么读（重要）

1. **本文** → 2. `handbook/`（做法） → 3. `modules/`（某模块现状） → 4. `generated/`（数字）
5. `ARCHITECTURE.md` / `DEVELOPMENT.md` / `API.md` / `PLAN.md` 是**深度参考**，写作时点较早，可能与现状有偏差：**只取结构性结论，具体以代码为准**。
6. 其余一律是**历史**：`audits/`（含 2026-11-15 三份专项审计）、`analysis/`、`_archive/`、`releases/` 旧版、`design/` 旧方案、`PROGRAM.md`、`PLAN.md` §三/§四、`changelog/archive-*`。历史文档不作为现状依据。

### 常见误读纠正

| 容易误读 | 事实 |
|---|---|
| `PROGRAM.md` 的 G1–G7 是待办 | 61 项**全部 done**（v4.23–v4.25 已收口），本文档只是历史编排 |
| `PLAN.md` §三待办矩阵 / §四里程碑 | 2026-11-05～06 的时点快照，已由 `planning/` + `program-status.json` 取代 |
| `audits/` 里的审计当问题清单 | 审计是**当时**的取证；未修项请看 `planning/2026-11-16-next-focus.md` |
| `analysis/` 是现状分析 | 2026-11 一次性评测与取证，含大体积 JSON，只在复现实验时读 |
| `program-status.json` 的 `baseline.tests` 是精确值 | 是台账基线（±10% 校验），实测以最近一次 `preflight` 为准 |
| 文档里的 `vX.Y.Z 计划` | 写下时点的计划，不代表当前排期 |

## 6. 已废弃 / 已下线（不要再引用）

- `.trae/CURRENT-PROGRESS.md`：已弃用且被 gitignore，进度看 `program-status.json`。
- `window.novelAI` 全局挂载：已删除，并有 `global-namespace` 门禁。
- `rewrite-chapters` spec / `E2E_REWRITE`：随「九霄逆脉行」下线，无脚本消费。
- `src/` 目录、`ui/views/kb-panel.ts` 等旧文件名：不存在。
- `nw-u-*` 工具类：按切片退场改语义类，**新代码不要新增**。存量口径、剩余存量大户与清理记录见
  `docs/design/2026-11-16-visual-refactor-standard.md` §5.1（定义 267 个、零引用 0、TS 引用 1699 处）。
