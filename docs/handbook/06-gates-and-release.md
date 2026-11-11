# 06 · 门禁与发布

> 命令清单以 `package.json` 为准，完整表格见生成物 [../generated/gates.md](../generated/gates.md)。
> 本文只解释「什么时候跑哪一组、失败了怎么办」。

---

## 1. 四组门禁

| 组 | 命令 | 包含 | 用途 |
|---|---|---|---|
| 快速 | `npm run typecheck` / `npm run test -- <file>` | 类型 + 指定测试 | 编辑期 |
| 本地总门禁 | `npm run preflight` | 24 步：类型、Lint、全量测试、模板/样式/CSS/内联样式、分层依赖、引擎注册、台账（program）、关系权威源、静默失败、热路径、写入入口、联动场景、自动化台账、dsh 隔离、JSDoc、any 预算、变更日志、文档（含 `docs/generated/*` 漂移）、构建、bundle 体积、发布资产 | 提交前 |
| 发布前 | `npm run preflight:release` | `preflight` + `test:cov` | 打 tag 前 |
| CI | `.github/workflows/ci.yml` | `preflight:release` 等价 + 生产依赖审计 + 构建产物入仓检查 + Playwright 用例解析 | PR / master |
| 发布 | `.github/workflows/release.yml` | 同一组门禁 + `check:release -- --tag` | 推 `v*` tag |

> `preflight` 不含覆盖率（太慢），但**包含** `check:release` 与 `build`；`preflight:release` 才跑 `test:cov`。
> 逐步展开以生成物 [../generated/gates.md](../generated/gates.md) 为准（`npm run gen:docs` 生成，禁止手改）；本文表格只做分组说明，新增门禁后不要在本文另抄一份清单。

## 2. 失败时的处理顺序

1. 先看输出最后 30 行，定位失败脚本。
2. 生成物类：`check:templates` / `check:styles` / `gen:docs` / `check:program` → 重新生成，不要手改。
3. 预算类：`check:css` / `check:inline-styles` → 降指标或按流程更新基线并写 `note`。
4. 架构类：`check:deps` / `check-engines` → 修 import 或按白名单登记，禁止直接改基线放行。
5. API 用法类：`check:obsidian-api` → 改用 `shared/paths` 单源 / `requestUrl` / `shared/logger` / 成对移除监听；确需新增才 `--update-baseline` 并写 `note`。
6. 样式写法类：`check:obsidian-api` 的 `style-element` / `static-style-assignment` → 按 §3 的写法约束改代码；存量按批次下降棘轮基线，**不得**为了过门禁上调。
7. 密钥类：`check:secrets` → 把密钥移出仓库（data.json 走 .gitignore）或改用短占位符；**禁止**为了让门禁过而放宽阈值。
8. 文档类：`check:docs` / `check:jsdoc` → 修链接/版本戳/注释，不要用 `--update-baseline` 掩盖回退。
9. 视图测试下限类：`check:view-tests` → 超 200 行的 `ui/` 文件必须被某个测试 import。
   优先把判定/格式化逻辑抽成纯函数并补单测（先例：`kb-format.ts` / `kb-book-filter.ts` / `kb-task-panel.ts`）；
   纯展示无逻辑才用 `--update-baseline --note "原因"` 登记。基线**只允许清单变短**，
   补了测试后应主动 `--update-baseline` 收紧。
10. 测试类：先复现单文件，再跑全量；不要跳过失败用例。

## 3. 样式写法约束（社区目录审核）

> 来源：Obsidian 社区目录自动审核的 `obsidianmd/no-forbidden-elements` 与
> `obsidianmd/no-static-styles-assignment`（均为 **Error**，不是建议项）+ 2026-11-09 实测打回。
> 违反后插件会被目录标记 Failed，用户端仍能用，但不会进入审核通过列表。

### 3.1 静态样式只允许放 `styles-src/*.css`

- **禁止**运行时创建 `<style>`：`document.createElement('style')`、`createEl('style')`、
  `addStyle()`、`insertAdjacentHTML(..., '<style>')` 都算违规。
- 弹窗/面板的样式在 `onOpen` 里注入是历史写法，已统一迁入
  `styles-src/20-runtime-modals.css`；新增样式直接写对应 `styles-src/<序号>-<域>.css`。
- 拼接顺序即层叠顺序：`npm run build:styles`；`check:styles` 校验 `styles.css` 与源一致。
- 唯一需要动态值的场景是主题变量：写入 `document.documentElement` 的自定义属性
  （`core/theme-manager.ts`），不拼整段 CSS 文本。

### 3.2 内联样式只允许「动态值」

| 写法 | 判定 |
|---|---|
| `el.style.width = '100%'` / `= 0` / `= \`100px\`` | ❌ 字面量，审核 Error |
| `el.style.cssText = '...'` | ❌ 审核 Error |
| `el.style.setProperty('color', 'red')` | ❌ 两个参数都是字面量 |
| `el.setAttribute('style', '...')` | ❌ 审核 Error |
| `el.style.width = width + 'px'` | ✅ 变量/表达式 |
| `el.style.transform = \`translateX(${x}px)\`` | ✅ 含插值的模板字符串 |
| `el.setCssProps({ '--nw-panel-w': value })` | ✅ 自定义属性（1.5+；1.4 走 `style.setProperty` 运行时探测） |
| `el.addClass('nw-is-active')` | ✅ 首选：状态用类，不用内联样式 |

- 状态切换优先 `nw-is-*` 类（`nw-is-active` / `nw-is-open` / `nw-is-collapsed`），
  CSS 里写对应规则，不要在 JS 里逐条改 `style`。
- 尺寸/坐标等连续值若必须内联，值必须来自变量或模板插值，且配注释说明原因。

### 3.3 门禁与基线

- `check:obsidian-api` 新增两条规则：`style-element`（目标 0）、
  `static-style-assignment`（棘轮基线，只降不升）。
- 存量清理按批次推进（B1–B4）；每批只改一层，先跑 `check:inline-styles` 看总量，
  再跑 `preflight:release`。**基线只能在指标下降后收紧**；确需上调必须在
  `--update-baseline --note` 里写清「为什么不是新增设计」。
- 新增门禁规则要有「故意违规必须报错」的自测
  （`tests/unit/architecture/obsidian-api-policy.test.ts`），否则规则可能空转。

### 3.4 API / HTML / Modal 审核约束（4.81.0）

社区审核按 `manifest.minAppVersion` 做类型级比对（`obsidianmd/no-unsupported-api`），
本地 `npm run lint` 已启用同一批规则（`eslint.config.mjs`，`projectService: true`）。
改 `minAppVersion` 前先跑 `npm run lint`，否则「本地全绿、审核 Failed」会重演。

| 约束 | 正确写法 | 为什么 |
|---|---|---|
| 最低版本 | `manifest.minAppVersion = 1.4.4`，`versions.json` 同步 | `FileManager.processFrontMatter` 自 1.4.4 起可用 |
| leaf 前台化 | `shared/workspace-reveal.ts::revealLeafCompat(workspace, leaf, { side })` | `Workspace.revealLeaf` 自 1.7.2 才定型；兼容实现用 `setActiveLeaf` + `expand()` |
| HTML 字符串落 DOM | `setSanitizedHtml` / `appendSanitizedHtml`（`ui/rendering/safe-html.ts`） | `innerHTML`/`outerHTML`/`insertAdjacentHTML` 均为审核 Error；`no-unsanitized` 只认 `sanitizeHTMLToDom` |
| 需要可编辑语义 | 用 `createElement`/`createTextNode` 构建 DOM（参考 `buildEntityMarkedFragment`） | `sanitizeHTMLToDom` 会剥离 `contenteditable` 等属性 |
| Modal 里的 Markdown | `private renderHost = new Component()`；`onOpen → load()`、`onClose → unload()` | `Modal` 不是 `Component`；把 `this.plugin` 传进去会被 `no-plugin-as-component` 判 Error 并造成生命周期泄漏 |
| 禁用元素/动态 `<style>` | 样式写 `styles-src/*.css`，状态用 `nw-is-*` 类 | `no-forbidden-elements` 为审核 Error |

对应回归：
- `tests/unit/architecture/official-review-rules.test.ts`（配置必须保持 error、源码不得回流）；
- `tests/unit/shared/workspace-reveal.test.ts`、`tests/unit/ui/rendering/safe-html.test.ts`、
  `tests/unit/architecture/modal-render-host.test.ts`。

## 4. 发布流程（当前口径）

> **社区目录要求**：Release tag 必须与 `manifest.version` **完全一致（不带 `v` 前缀）**，
> 因为 Obsidian 按 `releases/download/<version>/main.js` 下载。正式发版请用 `4.x.y`；
> `v*` tag 仅保留给历史版本，且不会被 Obsidian 识别。

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

## 5. 发布纪律

- `package.json.version` 是唯一真相源；`manifest.json`、`versions.json` 由 `sync-version` 同步。
- `docs/releases/vX.Y.Z.md` 必须存在，内容包含：为什么发、改了什么、怎么验证、影响与遗留。
- CHANGELOG 顶部必须是当前版本节点；不要新增散落的 `## Unreleased` 段。
- 只有版本节点提交；**可自行 push**（2026-11-11 放行）；**`tag` / `Release` 仍需用户明确授权**。
- 构建产物（`main.js`、`workers/`、`.hotreload`）不入库。

## 6. 回滚

| 情况 | 允许的动作 |
|---|---|
| Release 尚未创建 | 可以修正后移动 tag（`git tag -f` + `git push -f`），并重跑发布 |
| Release 已创建、资产有误 | **不要移动 tag**；发新补丁版本，旧 Release 保留可追溯 |
| 仅是资产上传失败 | 对同一 tag 重新运行 release 工作流（`--clobber` 覆盖资产） |
| 版本内容有严重缺陷 | 发新补丁并在 `docs/releases/` 写明回滚建议；不做同号覆盖 |
| 需要撤回版本 | 删除 GitHub Release 与 tag 属于破坏性操作，必须先经用户确认 |

## 7. 发布检查表

- [ ] `package.json` / `manifest.json` / `versions.json` / tag 四方一致。
- [ ] `docs/releases/vX.Y.Z.md` 已写，且没有承诺未验证的能力。
- [ ] `program-status.json` 的基线数字来自本次实测。
- [ ] `preflight:release` 全绿。
- [ ] 生成物漂移检查为空（`git diff --exit-code`）。
- [ ] E2E（如本次涉及 UI/启动/数据链路）已跑或明确记录未跑。

## 8. 相关

- 发布说明模板：[../releases/TEMPLATE.md](../releases/TEMPLATE.md)
- 故障处理：[07-runbook.md](07-runbook.md)
- 生成门禁表：[../generated/gates.md](../generated/gates.md)
