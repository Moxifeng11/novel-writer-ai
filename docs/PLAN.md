# 插件结构化规划（PLAN）

> 版本：v4.26.0 · 更新：2026-11-02
> 定位：**本文件是插件仓的唯一结构性规划入口**。代码是最终真相源；本文件只回答「有哪些模块、边界在哪、下一轮做什么」。
> 历史文档：`docs/audits/`（各轮取证）、`docs/releases/`（各版本交付）、`CHANGELOG.md`（变更流水）。
> **全系统优化专项**（16 板块 / 7 任务组 / 排期与验收）：[`docs/PROGRAM.md`](PROGRAM.md) · 进度报告：[`docs/progress/PROGRAM-STATUS.md`](progress/PROGRAM-STATUS.md)。
> **开发手册**：[`docs/README.md`](README.md)（环境、模块标准、接口契约、排障、评审、注释规范）。

---

## 一、模块地图（是谁、归哪层、边界）

分层门禁（唯一可执行口径，见 `scripts/check-dependencies.mjs`）：`ui → engine/services → shared/core`；`services → shared/core`；`shared` 只依赖自身；`core` 只依赖 `shared`。`check:deps` 为棘轮，存量冻结、只降不升。目标边界与差异见 [handbook/02-architecture.md](handbook/02-architecture.md)。

| 层 | 目录 | 职责 | 不该做的事 |
|---|---|---|---|
| 入口 | `main.ts` | 插件生命周期、视图/命令注册、`onunload` 清理 | 不写业务逻辑 |
| UI | `ui/` | 视图、弹窗、控制器；只通过 engine/service 公开方法 | 不直接读写 vault 业务文件 |
| 引擎 | `engine/` | 写作流水线、上下文、结算、Agent harness、RAG | 不依赖 `ui/`、不依赖 `main` 单例 |
| 服务 | `services/` | 版本、规则注册、执行登记表、知识库、性能监控 | 不 import `engine/`（迁移/批量导入/拆解调度已下沉 engine） |
| 共享 | `shared/` | 纯函数与通用原语：路径、格式、预算、体检、评分、缓存（file-cache/multi-layer/lru）、等待（yield）、存储键 | 不依赖任何业务层 |
| 核心 | `core/` | 设置服务、命令注册表、Provider | 不依赖 `ui/` |
| 门面 | `plugin-api.ts`（根级） | 对外 API 门面（与 main.ts 同性质，不属于分层） | 只做类型聚合，不放业务 |
| 领域 | `domains/` | 长篇/短篇/剧本三域声明（harness profile、工具目录、工厂） | 不复制通用逻辑 |

### 1.1 三条主数据流

```
一键成文（流水线）
  上下文加载 → 合并规划(5 模块) → 正文(V1..V4) → 质量控制 → 定向修订/闸门/复检
  → 分析报告(指令行) → 结算(实体/伏笔/时间线/关系/连续性账本) → 章节状态快照

协同写作（逐段）
  编辑器 → BodySaveController(身份快照/外部写入守卫) → BodyWriter(唯一落盘)
  → 实时质量分/建议/幽灵联想 → 结算同源回写

Agent（harness）
  会话日志 → 工具循环(host-tools) → 单次调用契约(single-call-runner)
  → 执行登记表(get_execution_status) → 上下文压缩/spill
```

### 1.2 单一入口清单（新增代码必须复用）

| 能力 | 唯一入口 |
|---|---|
| 正文落盘 | `engine/body-writer.ts`（frontmatter 保留、标题、格式契约、覆盖前备份） |
| 正文文件定位 | `engine/chapter-utils.ts::findBodyFileByChapterNum`（带章名优先） |
| 提示词 | `engine/prompts/*` + `prompt-registry.ts`（版本元数据） |
| 写作规则 | `services/rules-registry.ts`（多版本、只生效一个） |
| 上下文装配 | `engine/context-manager.ts` + `context/story-context-*` |
| 上下文体检 | `shared/context-hygiene.ts` |
| 修订闸门/复检 | `engine/revision/revision-guard.ts` |
| 结算 | `engine/settlement-engine.ts` + `settlement/*` |
| 长流程结果 | `services/execution-ledger.ts` |
| 设置默认值 | `core/settings-service.ts::getDefaultSettings` |
| 实体读取/统计 | `shared/entity-reader.ts::listEntityFiles / countProjectEntities` |
| 等待原语 | `shared/yield.ts::yieldToUI / nextFrame`（禁止裸 setTimeout 等待 UI） |
| 样式源 | `styles-src/*.css` → `npm run build:styles` 生成 `styles.css`（`check:styles` 校验一致） |

---

## 二、质量与治理机制（已落地）

| 机制 | 落点 | 作用 |
|---|---|---|
| 版本治理 | `shared/versioned-registry.ts` + 两个注册表 | 规则/模板多版本并存、哈希漂移检测、账本可归因 |
| 上下文体检 | `shared/context-hygiene.ts` | 重复段、规则×风格冲突、串章 |
| 修订闭环 | `revision-guard` + `StepRunner` | 只接受更优版本、可回滚、复检对照 |
| 三层验收 | `engine/quality-gate.ts` | 规则/结构/模型三层，正文后运行 |
| 连续性账本 | 人物卡四字段 + 章节状态快照 | 谁在哪/知道什么/伤到哪，最新优先带来源章 |
| 执行登记表 | `services/execution-ledger.ts` | Agent 可读长流程结果 |
| 门禁链 | `preflight` / `check:*` / CI | 类型/单测/模板/CSS/分层/引擎/发布 |

---

## 三、待办矩阵（按风险与成本）

来源：[v4.27 全插件审计](audits/v4.27-full-plugin-audit.md)（P0 六条已修）。

### Batch 2｜P1 正确性（下一轮主线）

| 组 | 条目 | 影响面 |
|---|---|---|
| 写锁收口 | 伏笔库/分析报告/版本回滚统一 `withWriteLock`（P1-1/2/3） | 结算与协同并发 |
| 缓存键 | `extractProjectFromPath` 最长匹配 + 契约缓存失效（P1-4/5/6） | 编辑设定后生成用旧上下文 |
| 跨模式 | `TARGETED_REVISION` 补 mode-rules；短/剧本 catalog 换命令；双向一致性测试（P1-7/8/9） | 短篇/剧本按钮失效、越界写入 |
| 静默失败 | 写作画像读失败留档、结算非 fm 失败置 partial（P1-10/11/12） | 数据被默认值覆盖 |
| UI 正确性 | file-open 判章、项目名校验+防重复提交、IME `isComposing`、实体检测去重、右侧 leaf 争用、一键失败可见（P1-13..18） | 交互与状态错乱 |

### Batch 3｜P2 低成本 + 门禁补强

- ✅ 覆盖率 include 已加 `shared/`（2026-11-01，G7-7）；`preflight` 已补 `lint`（`2116c86`）与 `build`（`4be401f`）；`check:release` 仍待评估（构建会重写产物，放 CI 更合适）
- 占位测试/无效断言清理；未定义 CSS 类补规则；状态类统一 `nw-is-*`
- `versions.json` 生成与校验；CODE-INDEX/README 脱节条目

### 真实链路

- `E2E_REWRITE=1` 全链回归（生成→质控→修订→复检→结算），核对归因字段/settled/账本/登记表
- 遗留：`word_count: 0`（SETTLE_ONLY 特有）、复检事件未进轮询 status

---

## 四、里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | v4.21.1 已发布（RAG/Agent/执行登记表） | ✅ |
| M1 | 人味重建 + 版本治理 + 上下文体检 + 修订闭环 | ✅ v4.22.0 |
| M2 | 全插件排查 Batch 2（P1 十八条） | 进行中：P1-3/P1-6/P1-12 已修（2026-11-02）；P1-5 `adapter.write` 绕过 `modify` 事件范围待定（改代码 vs 书面接受） |
| M3 | Batch 3 + 门禁补强 + 真实链路回归 | 进行中：`preflight` 已补 `lint`/`build`/文档与注释门禁；`check:release` 已入 preflight；`E2E_REWRITE=1` 待授权 |
| M4 | 发布 v4.23.x（远端 tag + Release） | ✅ v4.23.0 → v4.23.4 已发布 |

---

## 五、版本与提交纪律

- 只在**版本节点**提交：工作树累积 → 合并 CHANGELOG Unreleased 为单一版本节点 → 写 `docs/releases/vX.Y.Z.md` → 升版本 → 门禁全绿 → 本地提交。
- 不自行 push：远端发布由用户确认后执行（`release.yml` 已有资产一致性校验）。
- 每个提交必须可构建：按「运行时代码 → 测试/脚本 → 文档/版本」顺序分组。

## 六、文档真相源

| 文档 | 角色 | 更新时机 |
|---|---|---|
| `docs/README.md` | 文档总索引与真相源责任表 | 新增文档时 |
| `docs/PLAN.md`（本文件） | 结构与路线唯一入口 | 每轮收口 |
| `CHANGELOG.md` | 变更流水 | 每个版本节点 |
| `docs/releases/vX.Y.Z.md` | 版本交付说明 | 打版本时 |
| `docs/audits/vX.Y-*.md` | 取证与实验记录 | 审计/实验后 |
| `docs/generated/*` | 文件清单、门禁表、注释覆盖率（生成物） | `npm run gen:docs` |
| `docs/ARCHITECTURE.md` | 分层与数据流深度说明 | 结构变化时 |
| `docs/progress/program-status.json` | 专项进度与测试基线唯一源 | 每轮收口（`program:render`） |

> `.trae/CURRENT-PROGRESS.md` 已被 gitignore，不再作为真相源；跨工具进度以 `program-status.json` 为准。
