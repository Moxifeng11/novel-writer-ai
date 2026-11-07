# 01 · 环境搭建

> 适用于 Windows / macOS / Linux。CI 使用 Ubuntu + Node 20；本地允许 Node ≥ 20，但以 CI 为准。

---

## 1. 必备工具

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | **20.x（推荐）**，最低 20 | 构建、测试、脚本 |
| npm | 随 Node（≥ 10） | 依赖与脚本 |
| Git | 任意较新版本 | 版本控制 |
| Obsidian 桌面端 | 最低 1.4.0 | 运行插件、E2E |
| zip / gh | 发布时 | release 工作流等效操作 |

> 仓库提供 `.nvmrc`（20）。使用 nvm/fnm 的开发者执行 `nvm use` 即可对齐。

## 2. 目录与仓库边界

```text
<vault>/
├── .obsidian/plugins/novel-writer-ai/   # 插件源码仓（在这里 npm install / npm run）
├── .obsidian/                            # Obsidian 配置
└── 长篇小说/ …                            # 小说内容（vault 仓，不要在这里跑 npm）
```

- 插件仓是独立 git 仓库；vault 根是另一个仓库。
- 插件以「已构建产物」被 Obsidian 加载：`main.js`、`manifest.json`、`styles.css`、`workers/`。

## 3. 首次搭建

```bash
cd "<vault>/.obsidian/plugins/novel-writer-ai"
npm ci                 # 严格按 lockfile 安装（不要用 npm install 代替）
npm run build          # 同步版本 + 生成模板 + 拼 CSS + esbuild
npm run test           # 确认基线
```

在 Obsidian 中：

1. 设置 → 第三方插件 → 关闭安全模式。
2. 启用「小说工坊 AI」。
3. 若已启用，重载：命令面板 → “Reload app without saving”，或禁用再启用插件。

## 4. 开发循环

```bash
npm run dev     # 前置生成 + esbuild --watch
```

- 只监听 TS 打包；**改 `styles-src/` 或 `assets/template-scaffold/` 需要重新跑 `npm run build`**（或至少 `build:styles` / `gen:templates`）。
- Obsidian 不会自动重载 `main.js`。没有热重载插件时，手动重载应用。
- 修改 `manifest.json` 的版本不会热生效；以 `package.json` 为准，重新构建。

## 5. 环境变量

| 变量 | 何时需要 | 说明 |
|---|---|---|
| `OBSIDIAN_PATH` | 跑 Electron E2E | 指向 Obsidian 可执行文件；未设置时 E2E 用例**显式 skip**（退出码 0，属假绿） |
| `E2E_REAL_AI=1` | 真实 AI 链路 | 会消耗 API 额度 |
| `E2E_VAULT_PATH` | 覆盖 E2E vault | 默认就是真实 vault，务必显式指定副本 |
| `E2E_REAL_PROJECT` | 指定项目（real-ai） | 默认 `长篇小说/九霄逆脉行`（该项目已删除，跑 real-ai 前需显式指定） |
| `KEEP_E2E_VAULT=1` | 保留现场 | 失败排查时使用 |
| `DEEPSEEK_API_KEY` | dsh 子进程 | 由插件运行时注入，不写配置文件 |

Windows（Git Bash）示例：

```bash
OBSIDIAN_PATH="C:\Users\<你>\AppData\Local\Programs\Obsidian\Obsidian.exe" npm run test:e2e
```

## 6. 首次构建会生成什么

| 产物 | 来源 | 是否入库 |
|---|---|---|
| `main.js` | `main.ts` + esbuild | 否 |
| `workers/*.js` | `engine/**/*-worker.ts` | 否 |
| `styles.css` | `styles-src/*.css` 拼接 | 是（生成物，勿手改） |
| `shared/template-scaffold-assets.generated.ts` | `assets/template-scaffold/**` | 是（生成物） |
| `manifest.json` / `versions.json` | `package.json` 同步 | 是 |

## 7. 常见环境故障

| 现象 | 诊断 | 处理 |
|---|---|---|
| `npm ci` 报 peer 冲突 | Node/npm 版本不对 | 切到 Node 20，删除 `node_modules` 重试 |
| `esbuild` 找不到入口 | 文件被移动/删除 | 检查 `scripts/build.js` 的三个入口 |
| Obsidian 不加载插件 | `manifest.json` 缺字段 / `main.js` 不存在 | `npm run build`；检查 manifest id/main |
| 改了样式不生效 | 只跑了 `dev` | `npm run build`（`dev` 不拼 CSS） |
| E2E 启动失败 | 已有 Obsidian 单实例 / 路径错 | 关闭正在运行的实例；确认 `OBSIDIAN_PATH` |
| 插件版本显示旧值 | Obsidian 缓存 | 重载应用；必要时删除 `.obsidian/plugins/novel-writer-ai/.hotreload` |

## 8. 安全检查

- 不要把 `data.json`、API Key、真实 vault 路径提交进仓库。
- E2E 临时 vault 不会复制 `data.json`，因此不会带真实 Key。
