---
> **文档状态**：2026-11-02 已对照 v4.23.4 核实
> **对应版本**：4.24.0
> **维护要求**：目录结构、构建命令或门禁口径变化时同步更新本文档
---

# 小说工坊插件基线

## 当前基线

- 项目位置：`.obsidian/plugins/novel-writer-ai`（独立 git 仓；vault 根是另一个仓）
- 远端：`git@github.com:Moxifeng11/novel-writer-ai.git`
- 运行平台：Obsidian 插件（桌面端 + 移动端；系统级文件保护仅桌面端）
- 主要源码目录：`core/`、`engine/`、`services/`、`shared/`、`ui/`、`domains/`、`types/`
- 领域目录：`domains/kernel`（共享内核）、`domains/long`、`domains/short`、`domains/script`
- 测试目录：`tests/`（unit / integration / e2e / benchmark）

## 保留内容（纳入版本控制）

- 插件源码、类型定义、测试源码、构建配置
- `manifest.json`、`package.json`、`package-lock.json`、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.ts`、`playwright.config.ts`
- `CHANGELOG.md`、`docs/`（README、handbook、adr、glossary、releases、generated、progress、audits、design、research）
- 门禁基线：`.arch-baseline.json`、`.css-baseline.json`、`.inline-style-baseline.json`、`.jsdoc-baseline.json`
- 必要测试说明：`tests/README.md`、`tests/e2e/README.md`

## 不纳入版本控制

- 构建产物：`main.js`、`main.js.map`、`workers/`、`.hotreload`
- 依赖与覆盖率：`node_modules/`、`coverage/`
- 临时文件：`tc_*`、`tsc_*`、`diff_*`、`build_*`、截图、调试输出
- Playwright 报告与测试结果：`playwright-report/`、`test-results/`
- `.trae/`（跨工具过程资产；进度以 `docs/progress/program-status.json` 为准）

## 历史文档策略

- `docs/audits/`：按日期冻结的历史取证，不作为现状。
- `docs/releases/`：每个 tag 的发布说明，不删不改。
- `docs/_archive/`：被取代的方案与旧报告，保留可追溯性。
- `docs/design/`：设计时点快照；被取代时在头部标注。

## 验证命令

```bash
npm ci
npm run preflight
npm run test:cov
npm run check:release -- --tag vX.Y.Z   # 发布前
```

Obsidian 运行态验证：

```bash
obsidian plugin:reload id=novel-writer-ai
obsidian dev:console level=error
```

> 运行态重载后以 `dev:errors` 为空、且新字段/命令存在为准；仅看 manifest 版本可能仍是旧缓存。
