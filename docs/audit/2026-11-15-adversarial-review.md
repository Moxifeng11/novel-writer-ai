# 对抗性审查报告（2026-11-15）

> 方法：**四路独立视角 + 主审交叉验证**。只把「多视角交叉证实」或「代码事实可直接复现」的问题列为真问题；
> 单一视角且无法复现的列为「待验证/伪问题候选」。所有修复都带回归测试提交。

## 一、审查视角

| 编号 | 视角 | 审查者 |
|---|---|---|
| A | Obsidian 官方审核规范 + 发布工程 | review-community（独立只读） |
| B | 首启体验 / 社区下载可用性 | review-onboarding（独立只读） |
| C | 数据安全与健壮性 | review-datasafety（独立只读） |
| D | 性能 / 移动端 / 插件生命周期 | review-perf（独立只读） |
| E | 主审（本会话）独立探测：设置默认值、视图生命周期、实机自检 | lead |

## 二、交叉验证后确认为真问题

| # | 问题 | 交叉来源 | 严重度 | 状态 |
|---|---|---|---|---|
| 1 | **首启向导把 API Key 抹成空串**：`persistKey` 先写 `providerKeys[id]` 再 `switchProviderByEndpoint`，切换逻辑用当前空 `apiKey` 回写同一 provider → Key 被覆盖；测试用的是内存值所以照样显示 ✅ | B + E（读 provider-manager 代码确认） | P0 | ✅ `e4fe07a9` |
| 2 | **覆盖前备份失败仍继续覆盖**：`backupBeforeOverwrite` 失败只 warn，唯一原稿被替换且无版本；且失败也占用 5 分钟节流窗口 | C（并指出测试固化了旧行为） | P0 | ✅ `e4fe07a9`（改为：失败阻断覆盖 + 另存旁路草稿 + 不占节流） |
| 3 | **事务恢复只扫 `长篇小说`**：短篇/剧本项目的中断事务永不回滚；损坏 journal 被直接删除，丢回滚线索 | C | P1 | ✅ `e4fe07a9`（改为按 `listProjectIds` 全模式扫描 + `.invalid` 留档） |
| 4 | **首启无法自助排错**：`firstRunComplete` 只写不读，跳过向导后再无提醒；设置页没有环境自检/模板补齐/使用说明入口 | B + E | P1 | ✅ `796eea84`（新增「首启与自检」页 + 一键补齐 + 自动召回向导 + 目录/标签/属性速查） |
| 5 | **社区下载拿不到 `workers/`**：目录只下发三件套，重活只能主线程降级 | A + D（D 指出 worker 与 main 体积重复） | P2 | ⏳ 待做（worker 内联/Blob） |
| 6 | **发布 tag 允许 `v*`** 与目录要求（tag == manifest.version）冲突，会产出无法关联的 Release | A | P1 | ✅ `e4fe07a9`（workflow 只收数字 tag + check-release 拒绝 v 前缀） |
| 7 | **卸载漏摘 2 个视图**（设定图/规划画布），热重载后残留空白页签 | D + E（核对 onunload 清单） | P2 | ✅ `e4fe07a9` |
| 8 | **启动串行 I/O 后才注册命令/视图**，慢设备上"命令面板空白"可感知 | D | P2 | ◑ `本轮`（状态栏「⏳ 初始化中」占位 + 失败态可见；未改注册顺序：视图工厂依赖引擎字段，提前注册有打开即崩风险） |
| 9 | **主包 5.19MB / CSS 569KB**，移动端首屏解析压力大 | A + D | P2 | ⏳ 待做（视图动态 import + 图片外移） |
| 10 | **首次统计扫描全量读正文**（应先读 frontmatter word_count） | D + E（复现路径一致） | P2 | ✅ `bea74a83`（优先 frontmatter，缺失才读全文） |
| 11 | **剪贴板无降级**（6 处 `navigator.clipboard` 未判空），移动端复制静默失效 | D | P2 | ✅ `1a16ed38`（统一 `copyText`：clipboard → execCommand 降级） |
| 12 | **重建章节会覆盖手写短稿**（≤150 字信息规划 / <100 字大纲判为骨架整篇覆盖，并删台账行） | C | P1 | ✅ `1a16ed38`（只有空/占位符算骨架；删台账行前备份到 `_versions/rebuild`） |
| 13 | **结算回滚日志只在内存**，崩溃后半套状态永久保留 | C | P1 | ✅ `2482fc2e`（实时落盘 `结算回滚-<章>.json` + 自检项 + `recoverInterruptedSettlement` 恢复入口） |
| 14 | **章节版本服务注入 fileTx 却未使用**，内容与索引两次独立写 | C | P1 | ✅ `1a16ed38`（内容+索引同事务，失败整体抛错） |
| 15 | **首启未确认即向库根写 56 个模板** | A | P2 | ✅ `bea74a83`（设置可关：`templateScaffoldOnStartup=false` 时只在建项目时落盘） |
| 16 | **私有 API** `app.commands` / `app.setting` 使用，且自建门禁漏检 | A | P1 | ✅ `2482fc2e`（收口到 `shared/obsidian-internal-bridge.ts`，门禁 private-api 扩展并只白名单该文件） |
| 17 | **`window.novelAI` 全局挂载** | A | P2 | ⏳ 待评估（外部脚本可能依赖，需用户确认） |
| 18 | **package.json 与 manifest 元数据不一致**（author） | A | P2 | ✅ `1a16ed38`（已对齐 author/description） |

> 第 17 项特别说明：`window.novelAI` 可能被 ZCode/Trae 侧脚本使用，删除前需确认，未擅自移除。

## 三、被交叉验证否掉的伪问题（未修）

| 候选 | 为什么不算真问题 |
|---|---|
| 「logo/图标缺失会导致审核不过」 | manifest 不含 icon 字段属正常；图标由目录侧提供 |
| 「没有 `getSettingDefinitions` 就是不合规」 | 社区不强制；本插件用自定义设置页 |
| 「main.js 必含 eval 风险」 | 已核查无 eval/new Function/CDN/远程脚本 |
| 「移动端必须 isDesktopOnly:true」 | 代码层 Node/Electron 调用均有 `Platform.isMobile` 守卫或 try 内动态加载；D 视角复核通过 |
| 「每章重复全库扫描导致卡顿」 | 关键循环（批量建章/重建）已复用一次索引，剩余为 P2 级 |

## 四、本轮实机验证

```
runSetupReadiness() → usable=true，ok 5 / warn 2 / missing 0
items: provider:ok model:ok templates:ok projects:ok folders:ok index:warn workspace:warn
writeUsageGuideNow() → 写作知识库/插件使用约定.md
```

`index:warn` 是因为当时未打开作品（会在打开后自动建索引），属预期。

## 五、已评估但本轮不做的决定（含理由）

| 项 | 决定 | 理由 |
|---|---|---|
| worker 内联（目录版无 workers） | 暂不做 | worker 产物 793KB，内联进 main.js 会把主包从 5.2MB 推到 6MB，违反 5MB 预算且移动端解析更差；现状是「功能可用、重活回主线程」的降级，不是功能缺失。已在《插件使用约定》写明。 |
| 视图动态 import 拆包 | 暂不做 | view 工厂在 onload 同步注册（Obsidian registerView 需要类），改动态 import 需重写注册与加载态，回归面覆盖首屏/移动端，收益（首屏解析）与风险不匹配；保留为后续专项。 |
| 启动注册顺序前移 | 部分做 | 见 #8：状态栏占位解决「以为没加载」的感知问题；把 registerView 前移会让「初始化中点开视图」命中未就绪引擎，风险高于收益。 |
| 删除 window.novelAI | 待用户决定 | 可能被 ZCode/Trae 外部脚本依赖，擅自删除会打断现有自动化。 |
