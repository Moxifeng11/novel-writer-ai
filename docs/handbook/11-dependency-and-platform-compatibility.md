# 11 · 依赖治理与平台兼容

> 适用于发版前确认「依赖还能不能升、平台还能不能跑」。
> 命令以 `package.json` 为准；门禁总览见 [06-gates-and-release.md](06-gates-and-release.md)。

---

## 1. 依赖治理口径

| 层级 | 规则 | 门禁 |
|---|---|---|
| 运行时依赖 | 插件产物必须是零运行时依赖（`main.js` 自带 bundle） | `npm run check:release` |
| 生产依赖漏洞 | 只允许 0 个 high/critical | `npm run audit:deps`（CI / Release） |
| 开发依赖漏洞 | 允许中危，但必须有登记与上游 issue；高危必须当版修复 | 人工 + 本页登记 |
| 版本升级 | 每月 Dependabot 分组 PR；minor/patch 自动开，major 人工验证 | `.github/dependabot.yml` |
| 锁文件 | 提交 `package-lock.json`，CI 一律 `npm ci` | CI |

### 当前登记（2026-11-03）

- `npm audit`：23 条 moderate，全部来自 `eslint-plugin-obsidianmd` 内嵌的 `moment`；仅开发期，不进入插件产物，上游暂无修复。
- `eslint` 保持 9.x：ESLint 10 与现有 flat config / 插件生态尚未验证。
- `typescript` 保持 5.9.x：TypeScript 7 仍是预览版，构建与类型行为变化大。
- `@types/node` 保持 20.x：与 `engines.node >= 20` 对齐。
- `obsidian` 类型包大版本跟随宿主；升级时必须同步复核 `minAppVersion` 与 API 兼容。

升级窗口打开时，按以下顺序验证：

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run preflight
npm audit --omit=dev --audit-level=high
```

---

## 2. 平台矩阵

| 平台 | 自动化 | 手工冒烟 | 说明 |
|---|---|---|---|
| Windows 10/11 + Obsidian 1.14.x | Playwright Electron E2E、性能冒烟 | 每版 | 主开发环境 |
| Linux（CI Ubuntu） | `verify` 全门禁 + 单测 | 发版前抽查 | 路径大小写敏感 |
| macOS（CI） | 跨平台矩阵：`typecheck` + `npm test` | 发版前抽查 | 路径分隔符、字体渲染 |
| iOS / Android Obsidian | 静态检查 + `Platform.isMobile` 守卫 | 每版 | 不跑 Node/Worker/本地模型 |
| Obsidian 1.4.x（最低支持） | 类型层按 1.14 编译，API 使用需人工核对 | 每版 | `manifest.minAppVersion = 1.4.4` |
| Obsidian 1.5.x | 同 1.4.x | 每版 | 兼容层稳定 |

### 移动端约束

- `manifest.json` 必须保持 `isDesktopOnly: false`。
- 桌面能力（Worker、本地模型探测、`child_process`、文件系统直读）必须：
  1. 收口在 `shared/desktop-shell.ts` 等单一入口；
  2. 调用前判断 `Platform.isMobile` / `Platform.isDesktop`；
  3. 移动端走降级路径并给用户可见提示。
- 新增 `node:*` / `electron` / `child_process` 直接引用会被代码审查拦截；不要绕过 `shared/desktop-shell.ts`。

### Obsidian 最低版本约束

`minAppVersion` 是 1.4.4，但编译类型是当前最新版。升级类型包后必须检查：

1. 新增 API 是否在 1.4.4 已存在（对照 Obsidian 官方 changelog / d.ts 历史）。
2. 新 API 是否被 `Platform` 或 `app.version` 守卫。
3. 是否影响 `ItemView` / `Plugin` / `Setting` 等基础生命周期。

---

## 3. 发版前手工冒烟清单

每个版本至少执行一次，结果写进 `docs/releases/v<版本>.md`。

### 安装 / 启用 / 禁用 / 卸载

- [ ] 全新 vault 安装插件 → 启用 → 首启向导完成
- [ ] 禁用插件 → 无残留定时器/Worker/浮窗
- [ ] 重新启用 → 设置、项目、章节数据完整
- [ ] 卸载 → 仅删除插件目录，vault 数据保留

### 核心链路

- [ ] 创建长篇项目 → 一键流程跑到正文 → 结算
- [ ] 协同写作：打开章节 → 生成建议 → 采纳 → 保存
- [ ] 结算后润色 / 正文完成后润色入口可见且可执行
- [ ] 知识库拆解、指纹库、写作统计页面可打开
- [ ] 设置页：API、外观、创作模式、写作配置四组可保存并即时生效

### 兼容性

- [ ] Obsidian 1.4.x 启动无报错、工作台可打开
- [ ] Obsidian 最新版启动无报错
- [ ] 移动端：工作台可打开，桌面专属按钮显示禁用/提示而非崩溃
- [ ] 中英文路径、含空格路径、大小写混合路径各跑一次落盘

---

## 4. 出问题时的定位顺序

1. `npm run typecheck` / `npm run lint`：先排除静态错误。
2. `npm run check:deps`：确认没有新增循环依赖或分层越界。
3. `npm test -- <失败文件>`：单文件复现。
4. 平台相关：对比 Windows / macOS CI 结果，优先怀疑路径分隔符、大小写、编码。
5. 移动端：检查是否绕过 `Platform.isMobile` 守卫直接调用桌面 API。
6. 依赖相关：`npm ls <包>` 看是否被提升/重复安装；必要时 `npm ci` 重建。
