# 开发文档总索引

> 状态：活跃 · 2026-11-17
> 本文件是 `docs/` 的唯一入口。新增文档必须在这里登记，否则 `npm run check:docs` 会失败。
> 版本：v4.96.0 · 2026-11-17 · 对应插件版本以 `package.json` 为准。
> **先读 [CURRENT.md](CURRENT.md)**：它回答「现在是什么样」，其余文档回答「怎么做」或「当时怎么想」。

---

## 〇、文档分三类（读之前先确认）

| 类型 | 目录 | 能否作为现状依据 |
|---|---|---|
| **现状 / 规范** | `CURRENT.md`、`handbook/`、`modules/`、`planning/`（最新一篇）、`generated/`、`progress/` | ✅ 可以 |
| **深度参考** | `ARCHITECTURE.md`、`DEVELOPMENT.md`、`API.md`、`PLAN.md` §一/§二/§五/§六、`adr/`、`research/` | ⚠️ 结构可信，细节可能过时；以代码为准 |
| **历史（只读）** | `audits/`（含 2026-11-15 三份专项审计）、`analysis/`、`_archive/`、`design/` 旧方案、`releases/` 旧版、`changelog/archive-*`、`PROGRAM.md`、`PLAN.md` §三/§四 | ❌ 不作为现状，只用于追溯 |

历史文档头部会写「状态：历史」。发现历史文档被当成现状引用，直接改引用，不要改历史文档本身。

---

## 一、从这里开始

| 你的目标 | 先读 |
|---|---|
| **搞清楚现状（第一步）** | [CURRENT.md](CURRENT.md) |
| 第一次参与开发 | [handbook/00-onboarding.md](handbook/00-onboarding.md) |
| 在本机跑起来 | [handbook/01-environment.md](handbook/01-environment.md) |
| 弄清分层与依赖 | [handbook/02-architecture.md](handbook/02-architecture.md) |
| 新增一个模块/功能 | [handbook/03-module-development.md](handbook/03-module-development.md) |
| 改公开 API / 命令 / 设置 | [handbook/04-interface-contracts.md](handbook/04-interface-contracts.md) |
| 写测试 | [handbook/05-testing.md](handbook/05-testing.md) |
| 跑门禁、发版、回滚 | [handbook/06-gates-and-release.md](handbook/06-gates-and-release.md) |
| 项目结构与标准 | [handbook/07-project-standard.md](handbook/07-project-standard.md) |
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
| 长期目标 | [LONG-TERM-GOAL.md](LONG-TERM-GOAL.md)（目标，不是排期） |
| 三方自动化协作协议 | [COLLABORATION-AUTOMATION.md](COLLABORATION-AUTOMATION.md) |
| 下一阶段排期 | [planning/2026-11-16-next-focus.md](planning/2026-11-16-next-focus.md) |
| 模块清单与推进顺序 | [modules/INDEX.md](modules/INDEX.md) |
| 查术语 | [glossary.md](glossary.md) |

---

## 二、深度参考（按需查阅，不重复维护）

| 文档 | 职责 | 使用注意 |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层、数据流、ADR 索引、关键文件 | 写作时点较早；目录/文件以 `generated/code-index.md` 与代码为准 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Repository / Store / 流式 / 缓存 / 接入步骤 | 同上；具体实现看代码 |
| [API.md](API.md) | 类与接口签名参考 | 签名以源码为准 |
| [PLAN.md](PLAN.md) | 模块地图、单一入口清单、版本与提交纪律 | §三/§四 已是历史快照，见文件头声明 |
| [BASELINE.md](BASELINE.md) | 仓库与版本控制基线（纳入/不纳入、验证命令） | 与 CURRENT §2/§3 配套 |
| [PERFORMANCE.md](PERFORMANCE.md) | 性能口径与已知热点 | 数字以基线文件为准 |
| [regression/LINKED-SCENARIOS.md](regression/LINKED-SCENARIOS.md) | 四条联动链的自动化 + 手工验收 | 手册 05/06 引用 |
| [research/deepseek-harness/](research/deepseek-harness/) | dsh 事实档案与集成设计 | 手册 07 的排障依据 |
| [design/](design/) | 设计包与决策 | 只作为方案来源；是否落地看代码 |
| [design/2026-11-16-visual-refactor-standard.md](design/2026-11-16-visual-refactor-standard.md) | 视觉重构标准与切片进度 | 现行规范 |
| [modules/MODULE-OPTIMIZATION-PLAYBOOK.md](modules/MODULE-OPTIMIZATION-PLAYBOOK.md) | 模块化优化制度：七步法 / 验收清单 | 每轮单模块优化按此执行 |
| [modules/api-config.md](modules/api-config.md) | API 配置模块现状与验收 | 模块页模板见 `modules/_TEMPLATE.md` |
| [releases/TEMPLATE.md](releases/TEMPLATE.md) | 发布说明模板 | 发布流程见手册 06 |

## 三、生成物（禁止手改）

| 文件 | 生成命令 | 内容 |
|---|---|---|
| [generated/code-index.md](generated/code-index.md) | `npm run gen:docs` | 源码文件清单、层归属、行数、导出数、JSDoc 覆盖 |
| [generated/gates.md](generated/gates.md) | `npm run gen:docs` | 从 `package.json` 生成的门禁/脚本表 |
| [generated/jsdoc-coverage.md](generated/jsdoc-coverage.md) | `npm run check:jsdoc` | 按层/文件的注释覆盖率 |
| [progress/PROGRAM-STATUS.md](progress/PROGRAM-STATUS.md) | `npm run program:render` | 专项进度报告 |

生成物在 CI 用 `--check` 比对；改了源不重新生成会失败。

---

## 四、历史目录（只读，禁止当现状）

| 目录 | 内容 | 何时读 |
|---|---|---|
| [audits/](audits/) | 2026-11 起的审计取证（版本/日期命名） | 追溯某结论的来源 |
| [analysis/](analysis/) | 2026-11 一致性/长文评测与实验数据（含大 JSON） | 复现实验时 |
| [_archive/](_archive/) | 被取代的方案、旧报告 | 几乎不用 |
| [PROGRAM.md](PROGRAM.md) | G1–G7 专项编排（61 项已全部 done） | 查历史任务编号 |
| [CHANGELOG.md](../CHANGELOG.md) 与 [changelog/](changelog/) | 版本变更记录 | 查某版本改了什么 |

> `audits/` 里**没有**「当前问题清单」。未修项统一看 [planning/2026-11-16-next-focus.md](planning/2026-11-16-next-focus.md)。

---

## 五、真相源责任表

同一事实只允许一个权威来源；其他文档只能链接，不能复制数字。

| 事实 | 唯一真相源 | 校验方式 |
|---|---|---|
| 插件版本 | `package.json` 的 `version` | `check:release`、`check:docs` |
| 运行时/开发依赖 | `package.json` + `package-lock.json` | `npm ci` |
| 门禁命令与顺序 | `package.json` 的 `scripts` | `gen:docs --check`、`check:docs` |
| 文件清单与规模 | `docs/generated/code-index.md` | `gen:docs --check` |
| 测试与 E2E 基线 | `docs/progress/program-status.json` 的 `baseline` | `check:program`、`check:docs` |
| 专项任务进度 | `docs/progress/program-status.json` | `check:program` |
| 代码体积 | `.bundle-baseline.json` | `check:bundle` |
| 覆盖率 | `.coverage-baseline.json` | `check:coverage` |
| CSS 预算 | `.css-baseline.json` | `check:css` |
| 静态样式来源 | `styles-src/*.css`（拼接为 `styles.css`） | `check:styles`、`check:css` |
| 内联样式预算 | `.inline-style-baseline.json` | `check:inline-styles` |
| Obsidian API 用法（棘轮） | `.obsidian-api-baseline.json` | `check:obsidian-api` |
| 社区审核规则/最低版本 | `eslint.config.mjs` + `manifest.json` 的 `minAppVersion` | `npm run lint`、`tests/unit/architecture/official-review-rules.test.ts` |
| 密钥/密文泄露（推送前） | 被 git 跟踪的文件（`git ls-files`）+ `.gitignore` | `check:secrets` |
| 分层/循环/引擎实例 | `.arch-baseline.json` | `check:deps`、`check-engines` |
| JSDoc 覆盖 | `.jsdoc-baseline.json` + `generated/jsdoc-coverage.md` | `check:jsdoc` |
| 发布资产清单 | `.github/workflows/release.yml` 的 `ASSETS` | `check:release` |
| 当前生效写作规则 | 运行时 `RulesService`；版本治理见 `research/` 与 `services/rules-registry.ts` | 单测 + 设置页 |

---

## 六、新鲜度规则

1. **生成物不手改**：`docs/generated/**`、`docs/progress/PROGRAM-STATUS.md` 只能由脚本写入。
2. **版本戳**：`CURRENT.md`、README、ARCHITECTURE、DEVELOPMENT、API、PLAN、CODE-INDEX 头部的版本必须等于 `package.json`；历史快照不参与校验。
3. **计数不写死**：测试文件数、用例数、源码行数、门禁步数只出现在生成物、`program-status.json` 或「最近一次 preflight 输出」里；正文引用写「见生成报告」。`check:docs` 会拦「N 步 preflight」「N 个用例」这类写法。
4. **状态头**：`docs/` 下每个 `.md`（历史目录除外）必须有 `> 状态：活跃 | 参考 | 历史` 之一；`check:docs` 强制。
5. **链接可达**：`check:docs` 校验本索引与 handbook 内的相对链接。
6. **编码**：文档不得含 NUL、U+FFFD 或典型乱码特征；`check:docs` 会拦截。
7. **历史文档冻结**：`docs/audits/`、`docs/analysis/`、`docs/_archive/`、旧版 `docs/releases/` 按日期冻结，只追加不改写。

---

## 七、新增文档的流程

1. 判断归属：教程/规范 → `handbook/`；模块现状 → `modules/`；决策 → `adr/`；一次性取证 → `audits/`；版本交付 → `releases/`。
2. 在本文对应小节登记一行（或加入对应目录的索引）。
3. 头部写 `> 状态：...`（与 `> 版本：vX.Y.Z` 如适用）。
4. 跑 `npm run check:docs`，确认链接、版本戳、状态头、编码都通过。
5. 若文档描述了「必须成立的事实」，优先把它变成门禁或单测，而不是只写文字。

---

## 八、相关命令速查

```bash
npm run check:docs        # 文档索引/链接/版本/状态头/编码/计数
npm run check:jsdoc       # 注释覆盖率（棘轮）
npm run gen:docs          # 重新生成 docs/generated/*
npm run preflight         # 本地总门禁
npm run preflight:release # 发布前（含覆盖率与 check:release）
```
