# 独立开发 vault（运行数据与写作 vault 解耦）

> 状态：活跃 · 2026-11-17
> 2026-11-17 建立，同日完成「E-补」：插件目录由 junction 改为**真实目录 + 产物同步**，
> 开发 vault 独占自己的 `data.json` / `data/` / `.sessions/`，不再与写作 vault 共用。
> 目标：**代码开发与测试尽量只在插件仓内完成**；界面级验证用独立 vault，
> 不再往真实写作 vault（`D:\小说工坊\小说工坊`）里塞示例项目、测试书、缓存。

## 1. 各环节要不要 vault

| 环节 | 需要 vault？ | 说明 |
| --- | --- | --- |
| `npm run typecheck` / `lint` | ❌ | 纯 TS 检查 |
| `npm run test`（见 `docs/progress/program-status.json`） | ❌ | 单测用内存假对象，不碰磁盘 vault |
| `npm run build` / `build:styles` | ❌ | 产物写到插件仓 `main.js` / `styles.css` |
| `npm run preflight`（全部门禁） | ❌ | 上述全部 + 各类静态检查 |
| `npm run test:e2e` | ✅ 但自动建 | Playwright 用 `mkdtemp` 建临时 vault + 独立 userData，跑完即弃 |
| **界面级验证**（看界面、视觉基线、交互冒烟） | ✅ | 必须真有 vault 给 Obsidian 加载 |

结论：**日常 95% 的工作（改代码、跑门禁）只在插件仓内即可，不需要任何 vault。**

## 2. 为什么不能把插件仓本身当 vault

Obsidian 只从 `<vault>/.obsidian/plugins/<id>` 加载插件。若把插件仓当 vault，
就会出现 `novel-writer-ai/.obsidian/plugins/novel-writer-ai` 的嵌套——
vault 里那个 `.obsidian\.obsidian` 残留目录就是这么来的（已于 2026-11-17 备份后清理）。

## 3. 正确做法：独立 vault + 真实插件目录（只同步产物）

```
D:\nw-dev-vault\                      ← 独立开发 vault（不在写作 vault 内）
  .obsidian\
    app.json / community-plugins.json / core-plugins.json / workspace.json
    plugins\novel-writer-ai\           ← 真实目录（不是 junction）
      manifest.json / main.js / styles.css / versions.json   ← 从本仓同步
      workers\                                              ← 从本仓同步
      data.json / data\ / .sessions\ / pet-image.*          ← 开发 vault 私有
      .nw-dev-vault.json                                    ← 归属标记
  写作知识库\                          ← 插件自动创建，正常
```

- **运行数据完全独立**：`data.json`、`data/`、`.sessions/` 只存在于开发 vault 内，
  造样本书、跑测试、改设置都写不到写作 vault，也不会把测试残留写进真实设置。
- **产物需要显式同步**：早期用 junction 时 `npm run build` 后即时生效；现在改为
  `npm run build && node scripts/dev-vault.mjs sync`，多一步但换来数据隔离。
- **仓内文件绝不被删除**：`init` 迁移旧 junction 前会校验联接目标就是本仓，且只删联接本身。

### 3.1 命令

```powershell
cd D:\小说工坊\小说工坊\.obsidian\plugins\novel-writer-ai

# 首次创建 / 从旧 junction 迁移（幂等）
node scripts/dev-vault.mjs init --vault=D:\nw-dev-vault

# 每次改完代码：构建 + 同步产物
npm run build
node scripts/dev-vault.mjs sync --vault=D:\nw-dev-vault

# 检查：目录形态、产物新鲜度、运行数据归属
node scripts/dev-vault.mjs status --vault=D:\nw-dev-vault

# 真实验证：起一个独立 user-data-dir 的 Obsidian 实例，确认插件确实加载
node scripts/dev-vault.mjs verify --vault=D:\nw-dev-vault

# 清空开发 vault 的运行数据（重建空白 data.json）
node scripts/dev-vault.mjs reset-data --yes --vault=D:\nw-dev-vault
```

`verify` 成功输出形如：

```json
{ "ok": true, "expectedVault": "nw-dev-vault", "dataOwned": true,
  "vaultName": "nw-dev-vault", "enabled": ["novel-writer-ai"],
  "loaded": true, "version": "4.96.1", "commands": 110 }
```

该命令用独立 `--user-data-dir` 启动，**不会占用或干扰你正在用的 Obsidian 窗口**，
验证完自动退出实例。

独立 user-data 相当于全新配置，Obsidian 首次打开该 vault 会弹「是否信任仓库作者」；
脚本会自动点「信任仓库作者并启用插件」（不点则插件根本不加载，会假报 `loaded: false`），
并等到命令注册非零才判定就绪（否则会误报 `commands: 0`）。

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
2. **开发 vault 里的作品数据随时可删**（那是测试数据）；插件代码由本仓同步而来，不会丢。
3. 改完代码记得 `sync`：它按大小 + mtime 只拷贝变化过的文件；忘了同步时 `status` 会标「仓内更新」。
4. 仓根 `data.json` / `data/` 是**写作 vault 的运行数据**，不要删、不要提交（已在 .gitignore）。
5. `main.js` / `styles.css` 不进 git，`git clone` 后必须先 `npm run build`。
