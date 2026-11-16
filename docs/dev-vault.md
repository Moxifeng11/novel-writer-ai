# 独立开发 vault（避免污染写作 vault）

> 2026-11-17 建立。目标：**代码开发与测试尽量只在插件仓内完成**，界面级验证用独立 vault，
> 不再往真实写作 vault（`D:\小说工坊\小说工坊`）里塞示例项目、测试书、缓存。

## 1. 各环节要不要 vault

| 环节 | 需要 vault？ | 说明 |
| --- | --- | --- |
| `npm run typecheck` / `lint` | ❌ | 纯 TS 检查 |
| `npm run test`（956 文件 / 10092 用例） | ❌ | 单测用内存假对象，不碰磁盘 vault |
| `npm run build` / `build:styles` | ❌ | 产物写到插件仓 `main.js` / `styles.css` |
| `npm run preflight`（全部门禁） | ❌ | 上述全部 + 各类静态检查 |
| `npm run test:e2e` | ✅ 但自动建 | Playwright 用 `mkdtemp` 建临时 vault + 独立 userData，跑完即弃 |
| **界面级验证**（看界面、视觉基线、交互冒烟） | ✅ | 必须真有 vault 给 Obsidian 加载 |

结论：**日常 95% 的工作（改代码、跑门禁）只在插件仓内即可，不需要任何 vault。**

## 2. 为什么不能把插件仓本身当 vault

Obsidian 只从 `<vault>/.obsidian/plugins/<id>` 加载插件。若把插件仓当 vault，
就会出现 `novel-writer-ai/.obsidian/plugins/novel-writer-ai` 的嵌套——
vault 里那个 `.obsidian\.obsidian` 残留目录就是这么来的（已于 2026-11-17 备份后清理）。

## 3. 正确做法：独立 vault + 目录联接

```
D:\nw-dev-vault\                     ← 独立开发 vault（不在写作 vault 内）
  .obsidian\
    app.json / community-plugins.json / core-plugins.json / workspace.json
    plugins\novel-writer-ai  ──junction──▶ D:\小说工坊\小说工坊\.obsidian\plugins\novel-writer-ai
  写作知识库\                         ← 插件自动创建，正常
```

- **构建产物即时生效**：junction 指向开发目录，`npm run build` 后重启/重载插件即可。
- **运行期数据不污染仓库**：`data.json`、`data/` 写在开发目录，但已被 .gitignore 忽略。
- **主 vault 零污染**：示例项目、测试书、缓存全部落在 `D:\nw-dev-vault`。

### 3.1 一键创建 / 检查

```powershell
cd D:\小说工坊\小说工坊\.obsidian\plugins\novel-writer-ai

# 创建（幂等）：目录联接 + 最小配置
node scripts/dev-vault.mjs init --vault=D:\nw-dev-vault

# 检查目录联接与产物
node scripts/dev-vault.mjs status --vault=D:\nw-dev-vault

# 真实验证：起一个独立 user-data-dir 的 Obsidian 实例，确认插件确实加载
node scripts/dev-vault.mjs verify --vault=D:\nw-dev-vault
```

`verify` 成功输出形如：

```json
{ "ok": true, "vaultName": "nw-dev-vault", "enabled": ["novel-writer-ai"],
  "loaded": true, "version": "4.96.0", "commands": 110 }
```

该命令用独立 `--user-data-dir` 启动，**不会占用或干扰你正在用的 Obsidian 窗口**，
验证完自动退出实例。

### 3.2 手动在 Obsidian 里打开

首次需要手动打开一次：Obsidian → 打开其他库 → 打开文件夹作为库 → 选 `D:\nw-dev-vault`。
之后它会出现在库列表里，可直接切换。

### 3.3 用 CLI 定向到开发 vault

```powershell
obsidian vault=nw-dev-vault plugin:reload id=novel-writer-ai
obsidian vault=nw-dev-vault eval code="1+1"
```

（`obsidian` CLI 支持 `vault=<库名>`；不指定时默认连当前活动库。）

## 4. 注意事项

1. **不要在主 vault 里跑验证脚本**：视觉基线采集、示例项目导入、测试书注入都属于「界面级验证」，
   应在开发 vault 里做。
2. 开发 vault 里的作品数据**随时可删**（那是测试数据）；插件本身由 junction 指向源码仓，不会丢。
3. junction 方案在 Windows 上已验证可行（Obsidian 正常遍历并加载）。换机器重建时用 `init` 即可。
4. `main.js` / `styles.css` 不进 git，`git clone` 后必须先 `npm run build`。
