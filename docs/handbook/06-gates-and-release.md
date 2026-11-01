# 06 · 门禁与发布

> 命令清单以 `package.json` 为准，完整表格见生成物 [../generated/gates.md](../generated/gates.md)。
> 本文只解释「什么时候跑哪一组、失败了怎么办」。

---

## 1. 四组门禁

| 组 | 命令 | 包含 | 用途 |
|---|---|---|---|
| 快速 | `npm run typecheck` / `npm run test -- <file>` | 类型 + 指定测试 | 编辑期 |
| 本地总门禁 | `npm run preflight` | 类型、Lint、全量测试、模板/样式/CSS/内联/分层/引擎/台账/权威源/静默失败/热路径/联动/隔离、JSDoc、文档、生成物漂移、构建、发布资产 | 提交前 |
| 发布前 | `npm run preflight:release` | `preflight` + `test:cov` | 打 tag 前 |
| CI | `.github/workflows/ci.yml` | `preflight:release` 等价 + 生产依赖审计 + 构建产物入仓检查 + Playwright 用例解析 | PR / master |
| 发布 | `.github/workflows/release.yml` | 同一组门禁 + `check:release -- --tag` | 推 `v*` tag |

> `preflight` 不含覆盖率（太慢），但**包含** `check:release` 与 `build`；`preflight:release` 才跑 `test:cov`。

## 2. 失败时的处理顺序

1. 先看输出最后 30 行，定位失败脚本。
2. 生成物类：`check:templates` / `check:styles` / `gen:docs` / `check:program` → 重新生成，不要手改。
3. 预算类：`check:css` / `check:inline-styles` → 降指标或按流程更新基线并写 `note`。
4. 架构类：`check:deps` / `check-engines` → 修 import 或按白名单登记，禁止直接改基线放行。
5. 文档类：`check:docs` / `check:jsdoc` → 修链接/版本戳/注释，不要用 `--update-baseline` 掩盖回退。
6. 测试类：先复现单文件，再跑全量；不要跳过失败用例。

## 3. 发布流程（当前口径）

```bash
# 1) 版本（package.json 是唯一源）
npm version 4.24.0 --no-git-tag-version

# 2) 文档：CHANGELOG 合并为单一版本节点 + docs/releases/v4.24.0.md
#    台账：program-status.json 的 baseline（version/tests/e2e/ahead）
npm run program:render

# 3) 生成物
npm run gen:docs
npm run build

# 4) 门禁
npm run preflight:release
npm run check:release -- --tag v4.24.0

# 5) 提交与发布（需用户授权）
git add -A && git commit -m "feat(v4.24.0): …"
git tag -a v4.24.0 -m "v4.24.0"
git push origin master && git push origin v4.24.0
```

发布工作流会自动：

1. 重建并校验资产（`main.js`/`manifest.json`/`styles.css`/`versions.json`/两个 worker/zip）；
2. 用 `docs/releases/${TAG}.md` 作为 Release notes；
3. Release 已存在时覆盖上传资产（`--clobber`）。

## 4. 发布纪律

- `package.json.version` 是唯一真相源；`manifest.json`、`versions.json` 由 `sync-version` 同步。
- `docs/releases/vX.Y.Z.md` 必须存在，内容包含：为什么发、改了什么、怎么验证、影响与遗留。
- CHANGELOG 顶部必须是当前版本节点；不要新增散落的 `## Unreleased` 段。
- 只有版本节点提交；不自行 push/tag（需用户明确授权）。
- 构建产物（`main.js`、`workers/`、`.hotreload`）不入库。

## 5. 回滚

| 情况 | 允许的动作 |
|---|---|
| Release 尚未创建 | 可以修正后移动 tag（`git tag -f` + `git push -f`），并重跑发布 |
| Release 已创建、资产有误 | **不要移动 tag**；发新补丁版本，旧 Release 保留可追溯 |
| 仅是资产上传失败 | 对同一 tag 重新运行 release 工作流（`--clobber` 覆盖资产） |
| 版本内容有严重缺陷 | 发新补丁并在 `docs/releases/` 写明回滚建议；不做同号覆盖 |
| 需要撤回版本 | 删除 GitHub Release 与 tag 属于破坏性操作，必须先经用户确认 |

## 6. 发布检查表

- [ ] `package.json` / `manifest.json` / `versions.json` / tag 四方一致。
- [ ] `docs/releases/vX.Y.Z.md` 已写，且没有承诺未验证的能力。
- [ ] `program-status.json` 的基线数字来自本次实测。
- [ ] `preflight:release` 全绿。
- [ ] 生成物漂移检查为空（`git diff --exit-code`）。
- [ ] E2E（如本次涉及 UI/启动/数据链路）已跑或明确记录未跑。
- [ ] 真实链路（`E2E_REWRITE=1`）如未跑，在发布说明中写明。

## 7. 相关

- 发布说明模板：[../releases/TEMPLATE.md](../releases/TEMPLATE.md)
- 故障处理：[07-runbook.md](07-runbook.md)
- 生成门禁表：[../generated/gates.md](../generated/gates.md)
