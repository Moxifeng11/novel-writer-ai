---
> **文档状态**：2026-10-27 已对照 v4.20.0 核实
> **对应版本**：4.20.0（三模式创作流程 + 单元写作工作台 + 多格式成稿导出）
> **维护要求**：目录结构、构建命令或门禁口径变化时同步更新本文档
---

# 小说工坊插件基线

## 当前基线

- 项目位置：`.obsidian/plugins/novel-writer-ai`
- 管理方式：通过 Git/GitHub 管理，当前远端为 `git@github.com:Moxifeng11/novel-writer-ai.git`
- 运行平台：Obsidian 插件
- 主要源码目录：`core/`、`engine/`、`services/`、`shared/`、`ui/`、`domains/`、`types/`
- 领域目录：`domains/kernel`（共享内核）、`domains/long`、`domains/short`、`domains/script`
- 测试目录：`tests/`（单元、E2E、基准）

## 保留内容

- 插件源码、类型定义、测试源码、构建配置
- `manifest.json`、`package.json`、`package-lock.json`、`tsconfig.json`、`vitest.config.ts`、`playwright.config.ts`
- `CHANGELOG.md`
- `docs/BASELINE.md`
- 必要测试说明：`tests/README.md`、`tests/e2e/README.md`

## 清理策略

以下内容不作为基线文档或源码长期保留：

- 临时截图、临时脚本和调试输出
- 覆盖率报告与 Playwright 报告产物
- `tc_*`、`tsc_*`、`diff_*`、`build_*` 等一次性诊断文件
- 旧审计报告和阶段性计划文档

## 验证命令

```bash
npm run typecheck
npm run build
```

Obsidian 运行态验证：

```bash
obsidian plugin:reload id=novel-writer-ai
obsidian dev:console level=error
```
