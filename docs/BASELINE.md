# 仓库基线（Baseline）

> 状态：活跃 · 版本：v4.96.0 · 更新：2026-11-17
> 本文只回答「仓库怎么组织、什么进版本库、用哪些命令核对」。
> 现状总览与文档读法见 [CURRENT.md](CURRENT.md)；门禁命令以 `package.json` 为准。

## 1. 仓库位置

- 工作目录：`.obsidian/plugins/novel-writer-ai`（**独立 git 仓**；vault 根是另一个仓，vault 的 `.gitignore` 忽略整个 `.obsidian/`）
- 远端：`git@github.com:Moxifeng11/novel-writer-ai.git`
- 运行平台：Obsidian 插件（桌面端 + 移动端；系统级文件保护仅桌面端）
- 开发验证 vault：`D:\nw-dev-vault`（插件目录是 junction，指回本仓）

## 2. 源码目录

`core/`、`engine/`、`services/`、`shared/`、`ui/`、`domains/`（`kernel`/`long`/`short`/`script`）、`types/`、`utils/`、`workers/`、`styles-src/`、`tests/`（unit/integration/e2e/benchmark）、`scripts/`。
**没有 `src/`。**

## 3. 纳入版本控制

- 插件源码、类型定义、测试源码、构建配置
- `manifest.json`、`package.json`、`package-lock.json`、`tsconfig.json`、`eslint.config.mjs`、`vitest.config.ts`、`playwright.config.ts`
- `CHANGELOG.md`、`docs/`（README、CURRENT、handbook、modules、adr、glossary、releases、generated、progress、audits、analysis、_archive、design、research、planning）
- 门禁基线：`.arch-baseline.json`、`.any-baseline.json`、`.bundle-baseline.json`、`.coverage-baseline.json`、`.css-baseline.json`、`.inline-style-baseline.json`、`.jsdoc-baseline.json`、`.obsidian-api-baseline.json`、`.view-tests-baseline.json`
- 测试说明：`tests/README.md`、`tests/e2e/README.md`

## 4. 不纳入版本控制

- 构建产物：`main.js`、`main.js.map`、`workers/`、`.hotreload`
- 依赖与覆盖率：`node_modules/`、`coverage/`
- 临时文件：`tc_*`、`tsc_*`、`diff_*`、`build_*`、截图、调试输出
- Playwright 报告与结果：`playwright-report/`、`test-results/`
- `.trae/`（跨工具过程资产；进度以 `docs/progress/program-status.json` 为准）

## 5. 历史文档策略

见 [README.md](README.md) §四。一句话：`audits/`、`analysis/`、`_archive/`、旧版 `releases/` 只追加不改写，**不作为现状依据**。

## 6. 验证命令

```bash
npm ci
npm run preflight          # 本地总门禁（步骤以 package.json 为准）
npm run preflight:release  # 发布前（含覆盖率）
npm run check:release -- --tag vX.Y.Z
```

开发 vault 运行态验证：

```bash
node scripts/dev-vault.mjs status
node scripts/dev-vault.mjs verify --vault=D:\nw-dev-vault
obsidian plugin:reload id=novel-writer-ai
obsidian dev:errors
```

> 重载后以 `dev:errors` 为空、且新字段/命令存在为准；只看 manifest 版本可能是旧缓存。
