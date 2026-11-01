# 00 · 新人上手

> 目标：让一个没接触过本仓库的开发者在半天内跑起来，一周内能独立完成一个小功能。
> 配套：环境搭建见 [01-environment.md](01-environment.md)，规范见 03–09。

---

## 1. 先建立三个认知

1. **这是两个仓库**
   - 插件源码仓：`<vault>/.obsidian/plugins/novel-writer-ai`（有 `package.json`、`git`、`docs/`）。
   - vault 仓：`<vault>` 根目录（存小说内容，不含插件源码）。
   - 所有 `npm` 命令都在插件仓执行；在 vault 根跑会找不到脚本。
2. **构建产物不入库**：`main.js`、`workers/`、`.hotreload` 是生成物，已在 `.gitignore`；不要手改、不要提交。
3. **门禁是合同**：`npm run preflight` 通过才算「可提交」；CI 与 release 在此基础上加覆盖率与发布校验。

## 2. 角色与产出

| 角色 | 主要产出 | 必须过的门禁 |
|---|---|---|
| 功能开发 | 模块 + 单测 + 文档更新 | `preflight` |
| 数据/结算改动 | 写锁、幂等、回滚、回归用例 | `preflight` + 联动链手工验收 |
| 发布负责人 | 版本、CHANGELOG、release notes、tag | `preflight:release` + E2E |
| 评审人 | 按 [08-code-review.md](08-code-review.md) 出结论 | — |

## 3. 第一天清单（约 2–4 小时）

- [ ] 读 [docs/README.md](../README.md) 的「真相源责任表」。
- [ ] 按 [01-environment.md](01-environment.md) 完成 `npm ci`、`npm run build`、在测试 vault 加载插件。
- [ ] 跑一次 `npm run test`，确认真实基线（不要相信文档里的旧数字）。
- [ ] 打开 `main.ts` 的 `onload`，对照 [02-architecture.md](02-architecture.md) 画出启动顺序。
- [ ] 随便改一个注释或文档，跑 `npm run check:docs`，熟悉反馈。

## 4. 第一周清单

- [ ] 读 [03-module-development.md](03-module-development.md)，挑一个现有模块对照检查表。
- [ ] 读 [05-testing.md](05-testing.md)，给一个纯函数补 2 条测试。
- [ ] 读 [09-comment-standard.md](09-comment-standard.md)，给一个导出补 JSDoc。
- [ ] 在本地跑一次完整 `npm run preflight`，记录耗时与失败点。
- [ ] 跟着发布负责人看一次发版（或读 [06-gates-and-release.md](06-gates-and-release.md) 的流程）。

## 5. 常见第一周问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `npm` 命令找不到脚本 | 在 vault 根执行 | `cd .obsidian/plugins/novel-writer-ai` |
| 插件改了没生效 | Obsidian 未重载 | 命令面板「Reload app without saving」或禁用/启用插件 |
| E2E 全 skip | 未设 `OBSIDIAN_PATH` | 见 01 的环境变量表 |
| `preflight` 报生成物不一致 | 改了 `assets/` 或 `styles-src/` 没重建 | `npm run build` |
| 改了文档但门禁说版本不对 | 头部版本戳落后 | 改成 `package.json` 的版本 |

## 6. 提问前先自查

1. 是否读了对应的 handbook 章节？
2. 是否跑了 `npm run preflight` 并保留完整输出？
3. 是否能描述「期望 / 实际 / 最小复现」？
4. 是否确认工作树没有其他人的未提交改动（本仓曾出现并发写入）？

## 7. 相关文档

- 环境与命令：[01-environment.md](01-environment.md)
- 分层与边界：[02-architecture.md](02-architecture.md)
- 提交与发布纪律：[06-gates-and-release.md](06-gates-and-release.md)
- 术语：[../glossary.md](../glossary.md)
