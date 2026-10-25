# 贡献指南

## 环境要求

- Node.js >= 20
- npm >= 10

## 本地开发

```bash
npm install
npm run build      # 生成 main.js 与 workers/
npm run dev        # watch 模式
```

将仓库目录放入 `<vault>/.obsidian/plugins/novel-writer-ai/` 后启用插件。

## 提交前自检

```bash
npm run check:templates
npm run lint
npm run typecheck
npm run test:cov
npm run build
npm run check:release
```

以上命令与 CI 一致；覆盖率阈值会阻断低于基线的提交。

## 代码约定

- 分层：`ui/` → `engine/` / `services/` → `shared/`，禁止反向依赖（`npm run check:deps`）。
- 新增命令必须同时更新命令定义、内部注册与命令面板注册。
- 修改 `assets/template-scaffold/` 后运行 `npm run gen:templates`。
- 构建产物（`main.js`、`workers/`）不入仓。
- 文档与 CHANGELOG 随代码同步更新。

## 提交信息

推荐 Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`。
