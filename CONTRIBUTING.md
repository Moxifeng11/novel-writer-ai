# 贡献指南

> 完整开发文档见 [docs/README.md](docs/README.md)。本文件只保留最短路径。

## 环境要求

- Node.js >= 20（仓库提供 `.nvmrc`，CI 固定 20）
- npm >= 10
- Obsidian 桌面端（仅 E2E 需要）

## 本地开发

```bash
npm ci             # 严格按 lockfile 安装
npm run build      # 生成 main.js / workers / styles.css
npm run dev        # watch 构建
```

将仓库目录放入 `<vault>/.obsidian/plugins/novel-writer-ai/` 后启用插件，改动后重载 Obsidian。

## 提交前自检

```bash
npm run preflight
```

一条命令覆盖类型、Lint、全量测试、模板/样式/CSS/内联/分层/引擎/台账/权威源/静默失败/热路径/联动/隔离、JSDoc、文档与生成物漂移、构建与发布资产校验。完整清单见 [docs/generated/gates.md](docs/generated/gates.md)。

涉及发布时再加：

```bash
npm run preflight:release
npm run check:release -- --tag vX.Y.Z
```

## 代码约定

- 分层以 `scripts/check-dependencies.mjs` 为唯一口径（[02-architecture.md](docs/handbook/02-architecture.md)），禁止反向依赖。
- 新增命令必须同时更新命令定义、内部注册与命令面板注册。
- 新增模块按 [03-module-development.md](docs/handbook/03-module-development.md) 的检查表执行。
- 注释/JSDoc 遵循 [09-comment-standard.md](docs/handbook/09-comment-standard.md)。
- 修改 `assets/template-scaffold/` 或 `styles-src/` 后必须重新构建。
- 构建产物（`main.js`、`workers/`）不入仓。
- 文档只改真相源，不复制数字；见 [10-documentation-policy.md](docs/handbook/10-documentation-policy.md)。

## 提交信息

Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`，可带 scope（如 `fix(v4.23.4): …`）。

## PR

- 使用 PR 模板，勾选 `preflight` 结果。
- 涉及数据写入/并发/迁移时，附回归用例与回滚方式。
- 评审标准见 [08-code-review.md](docs/handbook/08-code-review.md)。
