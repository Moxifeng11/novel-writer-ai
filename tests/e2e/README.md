# E2E 端到端测试

本目录使用 Playwright 的 Electron 支持启动真实 Obsidian，加载本插件并验证关键用户旅程。

## 运行前提

1. 已安装 Obsidian 桌面端（**不支持**移动端或浏览器模拟）。
2. 已构建插件：`npm run build`。
3. 已设置 `OBSIDIAN_PATH`，指向 Obsidian 可执行文件：
   - Windows：`C:\Users\<你>\AppData\Local\Obsidian\Obsidian.exe`
   - macOS：`/Applications/Obsidian.app/Contents/MacOS/Obsidian`
   - Linux：`/opt/Obsidian/obsidian`
4. 运行前退出正在使用的 Obsidian 实例，避免单实例锁导致测试窗口无法启动。

```bash
# PowerShell
$env:OBSIDIAN_PATH="C:\Users\me\AppData\Local\Obsidian\Obsidian.exe"
npm run test:e2e
```

未设置 `OBSIDIAN_PATH`（或路径不存在）时，Electron 用例会**明确跳过**并给出原因，不会执行任何占位断言。

## 测试隔离

每次运行会在系统临时目录创建独立 vault：

```
<tmp>/nw-e2e-vault-*/
├── .obsidian/
│   ├── community-plugins.json   # 仅启用 novel-writer-ai
│   ├── app.json
│   └── plugins/novel-writer-ai/
│       ├── main.js              # 复制自构建产物
│       ├── manifest.json
│       ├── styles.css
│       └── workers/
└── （测试创建的项目目录）
```

测试结束自动删除；设置 `KEEP_E2E_VAULT=1` 可保留现场用于排查。
不会复制本机 `data.json`，因此测试不会携带真实 API Key。

## 覆盖范围

| 旅程 | 状态 |
|---|---|
| 插件加载与命令注册 | ✅ |
| 创建项目 → 自动打开完整写作工作台 → 项目卡片可见 → 目录落盘 | ✅ |
| 世界观 / 角色生成 | ⏳ 未覆盖 |
| 章节撰写 / 协同写作 | ⏳ 未覆盖 |

`project-creation.spec.ts` 与 `project-card-interactions.spec.ts` 是旧的 Chromium 模拟用例，已标记 `describe.skip`，等待迁移到 Electron 链路。

## 常用命令

```bash
npm run test:e2e              # 运行全部（未配置 OBSIDIAN_PATH 时跳过 Electron 用例）
npx playwright test --list    # 仅校验用例可解析，不启动 Obsidian（CI 使用）
npm run test:e2e:ui           # UI 模式调试
npm run test:e2e:report       # 查看 HTML 报告
```

## CI 条件执行

`.github/workflows/ci.yml` 中的 `e2e-obsidian` job：

- 仅当仓库变量 `OBSIDIAN_PATH` 非空时运行，否则 job 显示 skipped。
- 可用仓库变量 `OBSIDIAN_E2E_RUNNER` 指定 runner（默认 `windows-latest`）。
- 由于需要本机安装 Obsidian，通常应指向**自托管 runner**；GitHub 托管 runner 不预装 Obsidian。
- 失败时上传 `playwright-report/` 与 `test-results/`。

常规 `verify` job 只执行 `npx playwright test --list`，确保用例语法与工程配置不会在合并后才暴露问题。

## 目录结构

```
tests/e2e/
├── pages/                      # 旧浏览器模拟的页面对象（仅存量用例使用）
├── utils/
│   ├── obsidian-app.ts         # 临时 vault、Electron 启动、信任弹窗、命令执行
│   ├── e2e-helpers.ts
│   ├── helpers.ts
│   └── test-data-generator.ts
├── obsidian-plugin.spec.ts     # 真实 Electron 链路
├── project-creation.spec.ts    # 已停用（skip）
├── project-card-interactions.spec.ts # 已停用（skip）
└── README.md
```

## 调试建议

- 首次打开带社区插件的 vault 时 Obsidian 会弹出信任提示，`obsidian-app.ts` 会自动点击“信任作者 / Trust author”类按钮；若 UI 文案变化，请更新 `clickTrustPromptIfPresent`。
- 用例通过 `app.commands.executeCommandById` 触发命令，避免依赖命令面板的键盘交互。注意 Obsidian 会把插件命令命名空间化为 `novel-writer-ai:<command-id>`，裸 ID 会返回 false（已由 `toObsidianCommandId()` 统一处理）。
- 插件命令 ID 可在运行中的 Obsidian 里用 `obsidian eval code="Object.keys(app.commands.commands).filter(id => id.includes('novel-writer-ai'))"` 核对。
- 若插件未被加载，先检查：构建产物是否最新、`.obsidian/community-plugins.json` 是否包含 `novel-writer-ai`、信任弹窗是否被阻塞。
- 失败时查看 `test-results/` 中的截图、视频与 trace。

## 参考资料

- [Playwright Electron](https://playwright.dev/docs/api/class-electron)
- [Playwright Test API](https://playwright.dev/docs/api/class-test)
