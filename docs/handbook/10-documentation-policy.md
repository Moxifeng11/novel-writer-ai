# 10 · 文档维护政策

> 状态：活跃 · 2026-11-17
> 文档不是交付后的附属品，是系统的一部分。本政策由 `npm run check:docs` 部分自动执行。

---

## 1. 真相源与复制规则

- 每个事实只有一个权威来源（见 [../README.md](../README.md) 第四节）。
- 其他文档只能：
  1. 链接到真相源；或
  2. 描述「如何得到这个数字」（命令），不写具体值。
- 禁止在多个文档同时维护「门禁清单、测试数量、版本号、文件数」。

### 1.1 状态三档（每份文档必须自证）

| 状态头 | 含义 | 典型文档 |
|---|---|---|
| `> 状态：活跃` | 现行规范/现状，可以据此开发 | CURRENT、README、BASELINE、handbook、modules、guides |
| `> 状态：参考` | 结构可信、细节可能过时，冲突时以代码为准 | ARCHITECTURE、DEVELOPMENT、API、PLAN、PERFORMANCE、CODE-INDEX |
| `> 状态：历史` | 某一时点的快照，只用于追溯 | PROGRAM、audits、analysis、_archive、旧 releases |

现状总入口是 [../CURRENT.md](../CURRENT.md)；文档怎么读见 [../README.md](../README.md) §〇。缺状态头的文档由 `check:docs` 直接拦下。

## 2. 生成物

以下文件只能由脚本写入：

| 文件 | 命令 |
|---|---|
| `docs/generated/code-index.md` | `npm run gen:docs` |
| `docs/generated/gates.md` | `npm run gen:docs` |
| `docs/generated/jsdoc-coverage.md` | `npm run check:jsdoc -- --report` |
| `docs/progress/PROGRAM-STATUS.md` | `npm run program:render` |

CI 用 `gen:docs --check` / `check:program` 比对；手改生成物会在下一次构建被覆盖并导致漂移失败。

## 3. 更新时机

| 变更 | 必须更新的文档 |
|---|---|
| 新增/改名命令、事件、设置键、frontmatter 字段 | [04-interface-contracts.md](04-interface-contracts.md) + 联动场景 |
| 分层/依赖规则变化 | [02-architecture.md](02-architecture.md) + `scripts/check-dependencies.mjs` |
| 新增门禁/脚本 | `package.json` + `docs/generated/gates.md`（自动）+ [06-gates-and-release.md](06-gates-and-release.md)（如流程变化） |
| 发布 | `CHANGELOG.md` + `docs/releases/vX.Y.Z.md` + `program-status.json` |
| 事故修复 | 代码事故注释 + `docs/audits/` 或发布说明 |
| 新增文档 | 登记到 [../README.md](../README.md) |

## 4. 版本戳

以下文件头部有「版本：vX.Y.Z」，必须等于 `package.json`：

- `README.md`
- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/API.md`
- `docs/PLAN.md`
- `docs/CODE-INDEX.md`
- `docs/CURRENT.md`

历史文档（`docs/audits/`、`docs/design/*/`、`docs/releases/` 旧版本）不参与校验，保持原样。

## 5. 归档

- 一次性取证 → `docs/audits/`，文件名带日期/版本。
- 被取代的设计 → 留在原位并在头部写「已被 X 取代」。
- 旧发布说明不删不改。
- 过时但仍需追溯的文档移到 `docs/_archive/`，并在原位置留一行链接。

## 6. 编码与格式

- UTF-8，无 BOM。
- 禁止 NUL、U+FFFD、典型乱码特征（具体列表见 `scripts/check-docs.mjs`）。
- 表格前保留空行；代码块标注语言。
- 相对链接优先，不写本机绝对路径。

## 7. 校验行为

`check:docs` 会检查：

1. `docs/README.md` 是否为已存在的文档建立了索引（handbook/adr/glossary/releases 模板）；
2. 相对链接是否可达；
3. 版本戳是否与 `package.json` 一致（含 `docs/CURRENT.md`）；
4. 现行/参考文档是否带 `> 状态：…` 头；
5. 现状类文档是否写死易漂移计数（「N 步 preflight」「N 道门」「N 个用例」等）；
6. 文档中出现的 `npm run <script>` 是否在 `package.json` 存在；
7. NUL/U+FFFD/乱码；
8. `docs/generated/*` 是否与生成结果一致。

失败时按输出修复，不要用跳过/白名单掩盖（除非在脚本里登记了历史例外并写明原因）。
