# 开发文档总索引

> 本文件是 `docs/` 的唯一入口。新增文档必须在这里登记，否则 `npm run check:docs` 会失败。
> 版本：v4.64.0 · 2026-11-04 · 对应插件版本以 `package.json` 为准。

---

## 一、从这里开始

| 你的目标 | 先读 |
|---|---|
| 第一次参与开发 | [handbook/00-onboarding.md](handbook/00-onboarding.md) |
| 在本机跑起来 | [handbook/01-environment.md](handbook/01-environment.md) |
| 弄清分层与依赖 | [handbook/02-architecture.md](handbook/02-architecture.md) |
| 新增一个模块/功能 | [handbook/03-module-development.md](handbook/03-module-development.md) |
| 改公开 API / 命令 / 设置 | [handbook/04-interface-contracts.md](handbook/04-interface-contracts.md) |
| 写测试 | [handbook/05-testing.md](handbook/05-testing.md) |
| 跑门禁、发版、回滚 | [handbook/06-gates-and-release.md](handbook/06-gates-and-release.md) |
| 线上/本机出故障 | [handbook/07-runbook.md](handbook/07-runbook.md) |
| 提 PR 前自查 | [handbook/08-code-review.md](handbook/08-code-review.md) |
| 写注释/JSDoc | [handbook/09-comment-standard.md](handbook/09-comment-standard.md) |
| 维护文档本身 | [handbook/10-documentation-policy.md](handbook/10-documentation-policy.md) |
| 依赖升级 / 平台兼容 | [handbook/11-dependency-and-platform-compatibility.md](handbook/11-dependency-and-platform-compatibility.md) |
| 模板加载/渲染/缓存/销毁 | [handbook/12-template-lifecycle.md](handbook/12-template-lifecycle.md) |
| 双自动化运维（Trae/ZCode） | [handbook/13-dual-automation-ops.md](handbook/13-dual-automation-ops.md) |
| 用户使用手册 | [guides/USER-GUIDE.md](guides/USER-GUIDE.md) |
| 商业化落地指南 | [guides/COMMERCIAL-GUIDE.md](guides/COMMERCIAL-GUIDE.md) |
| 产品定位与用户 | [PRODUCT.md](PRODUCT.md) |
| 下一阶段排期 | [roadmap/ROADMAP.md](roadmap/ROADMAP.md) |
| 当前架构审计与问题清单 | [audits/v4.27.0-architecture-and-roadmap.md](audits/v4.27.0-architecture-and-roadmap.md) |
| 查术语 | [glossary.md](glossary.md) |

---

## 二、深度文档（保留，不重复维护）

| 文档 | 职责 | 与手册的关系 |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层、数据流、ADR-001~003、关键文件索引 | 手册 02 只给「唯一口径 + 边界差异」，深度内容看这里 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Repository / Store / 流式 / 缓存 / 新功能接入的详细做法 | 手册 03 是检查表，具体步骤看这里 |
| [API.md](API.md) | 类与接口签名参考 | 手册 04 定契约规则，签名看这里 |
| [PLAN.md](PLAN.md) | 结构路线、里程碑、提交纪律 | 手册 06 引用其发布纪律 |
| [PROGRAM.md](PROGRAM.md) | 专项任务组与验收口径 | 进度以 `docs/progress/program-status.json` 为准 |
| [regression/LINKED-SCENARIOS.md](regression/LINKED-SCENARIOS.md) | 四条联动链的自动化 + 手工验收 | 手册 05/06 引用 |
| [research/deepseek-harness/](research/deepseek-harness/) | dsh 事实档案与集成设计 | 手册 07 的 dsh 排障依据 |
| [design/](design/) | 设计包与决策 | 决策索引见 [adr/README.md](adr/README.md) |
| [audits/](audits/) | 历史审计与取证 | 历史快照，不作为现状 |
| [releases/TEMPLATE.md](releases/TEMPLATE.md) | 发布说明模板 |
| [releases/](releases/) | 每个版本的发布说明 | 发布流程见手册 06 |

## 三、生成物（禁止手改）

| 文件 | 生成命令 | 内容 |
|---|---|---|
| [generated/code-index.md](generated/code-index.md) | `npm run gen:docs` | 源码文件清单、层归属、行数、导出数、JSDoc 覆盖 |
| [generated/gates.md](generated/gates.md) | `npm run gen:docs` | 从 `package.json` 生成的门禁/脚本表 |
| [generated/jsdoc-coverage.md](generated/jsdoc-coverage.md) | `npm run check:jsdoc` | 按层/文件的注释覆盖率 |
| [progress/PROGRAM-STATUS.md](progress/PROGRAM-STATUS.md) | `npm run program:render` | 专项进度报告 |

生成物在 CI 用 `--check` 比对；改了源不重新生成会失败。

---

## 四、真相源责任表

同一事实只允许一个权威来源；其他文档只能链接，不能复制数字。

| 事实 | 唯一真相源 | 校验方式 |
|---|---|---|
| 插件版本 | `package.json` 的 `version` | `check:release`、`check:docs` |
| 运行时/开发依赖 | `package.json` + `package-lock.json` | `npm ci` |
| 门禁命令与顺序 | `package.json` 的 `scripts` | `gen:docs --check`、`check:docs` |
| 文件清单与规模 | `docs/generated/code-index.md` | `gen:docs --check` |
| 测试与 E2E 基线 | `docs/progress/program-status.json` 的 `baseline` | `check:program`、`check:docs` |
| 专项任务进度 | `docs/progress/program-status.json` | `check:program` |
| CSS 预算 | `.css-baseline.json` | `check:css` |
| 内联样式预算 | `.inline-style-baseline.json` | `check:inline-styles` |
| 分层/循环/引擎实例 | `.arch-baseline.json` | `check:deps`、`check-engines` |
| JSDoc 覆盖 | `.jsdoc-baseline.json` + `generated/jsdoc-coverage.md` | `check:jsdoc` |
| 发布资产清单 | `.github/workflows/release.yml` 的 `ASSETS` | `check:release` |
| 当前生效写作规则 | 运行时 `RulesService`；版本治理见 `research/` 与 `services/rules-registry.ts` | 单测 + 设置页 |
| 跨工具进度 | ~~`.trae/CURRENT-PROGRESS.md`~~（已弃用，且被 gitignore） | 改看 `program-status.json` |

---

## 五、新鲜度规则

1. **生成物不手改**：`docs/generated/**`、`docs/progress/PROGRAM-STATUS.md` 只能由脚本写入。
2. **版本戳**：README/CONTRIBUTING/ARCHITECTURE/DEVELOPMENT/API/PLAN 头部的版本必须等于 `package.json`；历史快照（`audits/`、`design/*/`、旧发布说明）不参与校验。
3. **计数不写死**：测试文件数、用例数、源码行数只出现在生成物或 `program-status.json`；其他文档引用时写「见生成报告」，不写具体数字。
4. **链接可达**：`check:docs` 校验本索引与 handbook 内的相对链接。
5. **编码**：文档不得含 NUL、U+FFFD 或典型乱码特征（具体特征列表见 `scripts/check-docs.mjs`）；`check:docs` 会拦截。
6. **历史文档冻结**：`docs/audits/`、`docs/_archive/`、旧版 `docs/releases/` 按日期冻结，只追加不改写。

---

## 六、新增文档的流程

1. 判断归属：教程/规范 → `handbook/`；决策 → `adr/`；一次性取证 → `audits/`；版本交付 → `releases/`。
2. 在本文件第二节登记一行（或加入对应目录的索引）。
3. 跑 `npm run check:docs`，确认链接、版本戳、编码都通过。
4. 若文档描述了「必须成立的事实」，优先把它变成门禁或单测，而不是只写文字。

---

## 七、相关命令速查

```bash
npm run check:docs        # 文档索引/链接/版本/编码
npm run check:jsdoc       # 注释覆盖率（棘轮）
npm run gen:docs          # 重新生成 docs/generated/*
npm run preflight         # 本地总门禁
npm run preflight:release # 发布前（含覆盖率与 check:release）
```
