# 门禁与脚本（生成物）

> 由 `npm run gen:docs` 从 `package.json` 生成，禁止手改。

## 脚本表

| 命令 | 说明 |
|---|---|
| `npm run any:baseline` | — |
| `npm run audit:deps` | 生产依赖安全审计 |
| `npm run automation:advise` | — |
| `npm run bench:hotpath` | getFiles 热路径基准 |
| `npm run build` | 版本同步 + 模板生成 + CSS 拼接 + esbuild 打包 |
| `npm run build:release` | 本地发布构建（preflight:release） |
| `npm run build:styles` | 拼接 styles-src → styles.css |
| `npm run check-engines` | EngineRegistry 实例白名单/超限检查 |
| `npm run check:any` | — |
| `npm run check:automation` | — |
| `npm run check:bundle` | — |
| `npm run check:changelog` | — |
| `npm run check:css` | CSS 预算与命名棘轮 |
| `npm run check:deps` | 分层依赖与循环依赖（棘轮） |
| `npm run check:docs` | 文档索引/链接/版本/编码检查 |
| `npm run check:dsh-isolation` | dsh 后端隔离检查 |
| `npm run check:hotpaths` | 热路径全库扫描检查 |
| `npm run check:inline-styles` | 内联样式基线棘轮 |
| `npm run check:jsdoc` | 注释覆盖率（棘轮） |
| `npm run check:linked-scenarios` | 联动场景文档锚点检查 |
| `npm run check:obsidian-api` | — |
| `npm run check:program` | 校验进度报告与台账一致 |
| `npm run check:relationship-authority` | 关系数据权威源契约检查 |
| `npm run check:release` | 发布资产/版本/tag/worker/模板嵌入一致性校验 |
| `npm run check:secrets` | — |
| `npm run check:silent-failures` | 用户操作型静默失败检查 |
| `npm run check:styles` | 校验 styles.css 与 styles-src 一致 |
| `npm run check:support-qr` | — |
| `npm run check:templates` | 校验模板生成物与 assets 一致 |
| `npm run check:write-entry` | — |
| `npm run css:baseline` | 更新 CSS 基线 |
| `npm run css:cleanup` | CSS 清理审计 |
| `npm run css:stats` | CSS 统计 |
| `npm run dev` | watch 构建 |
| `npm run eval:cowrite-local` | 本地协同评估 |
| `npm run eval:fingerprint` | 指纹检索评估 |
| `npm run eval:humanness` | 人味基准评估 |
| `npm run eval:quality` | 质量基准评估 |
| `npm run eval:rag` | RAG 检索评估 |
| `npm run gen:docs` | 生成 docs/generated/* |
| `npm run gen:support-qr` | — |
| `npm run gen:templates` | 把 assets/template-scaffold 嵌入 shared/template-scaffold-assets.generated.ts |
| `npm run handoff` | — |
| `npm run inline:baseline` | 更新内联样式基线 |
| `npm run lint` | ESLint（obsidianmd 推荐规则） |
| `npm run preflight` | 本地总门禁 |
| `npm run preflight:release` | 发布前门禁：preflight + 覆盖率 |
| `npm run program:render` | 渲染专项进度报告 |
| `npm run sample:human` | 真人样文抽样 |
| `npm run test` | Vitest 全量（单元 + 集成） |
| `npm run test:cov` | Vitest + 覆盖率门禁 |
| `npm run test:e2e` | Playwright（含 Electron 真实链路） |
| `npm run test:e2e:headed` | Playwright 有头模式 |
| `npm run test:e2e:report` | 查看 Playwright 报告 |
| `npm run test:e2e:ui` | Playwright UI 模式 |
| `npm run typecheck` | tsc --noEmit |
| `npm run version:sync` | 同步 package.json 版本到 manifest.json 与 versions.json |

## preflight 展开

```text
01. npm run typecheck
02. npm run lint
03. npm run test
04. npm run check:templates
05. npm run check:styles
06. npm run check:css
07. npm run check:inline-styles
08. npm run check:obsidian-api
09. npm run check:secrets
10. npm run check:deps -- --baseline .arch-baseline.json --require-baseline
11. npm run check-engines
12. npm run check:program
13. npm run check:relationship-authority
14. npm run check:silent-failures
15. npm run check:hotpaths
16. npm run check:write-entry
17. npm run check:linked-scenarios
18. npm run check:automation
19. npm run check:dsh-isolation
20. npm run check:jsdoc
21. npm run check:any
22. npm run check:changelog
23. npm run check:docs
24. npm run check:support-qr
25. npm run build
26. npm run check:bundle
27. npm run check:release
```

## 说明

- `npm test` 是 npm 内置脚本调用，等价于 `npm run test`。
- `preflight` 不含覆盖率；发布前用 `preflight:release`。
