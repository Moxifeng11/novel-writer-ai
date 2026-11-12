# 生产环境测试报告 · 2026-11-13（obsidian-cli）

> 目的：用 Obsidian 官方 CLI 在**真实 vault + 真实 Obsidian 运行时**上验证 v4.85.0，
> 而不是靠单元测试或手工点击。方法已固化进 `docs/handbook/05-testing.md` §6.7。

## 一、环境

| 项 | 值 |
|---|---|
| Obsidian | 1.15.0（installer 1.14.5） |
| CLI | 内置 `obsidian` 命令（`Obsidian.com`） |
| Vault | 小说工坊（`D:\小说工坊\小说工坊`） |
| 规模 | 15275 文件 / 2659 目录 / 198 MB |
| 插件 | novel-writer-ai **4.85.0**（测试前运行实例是 4.81.1，已 `plugin:reload`） |

## 二、结果总表

| # | 测试 | 方法 | 结果 |
|---|---|---|---|
| 1 | 插件加载与版本 | `obsidian plugin id=novel-writer-ai` | ✅ 4.85.0 / enabled=true |
| 2 | 加载期错误 | `obsidian dev:errors` | ✅ No errors captured |
| 3 | 命令注册 | `obsidian commands` | ✅ 40+ 条 `novel-writer-ai:*` 命令 |
| 4 | **命令冒烟（8 条）** | `obsidian command id=...` × 8 | ✅ 全部 `Executed`，之后 `dev:errors` 仍为空 |
| 5 | 视图打开 | 上述命令 | ✅ 知识库 / 创作主页 / 完整写作 / 指纹库 / Agent 工作台 5 个视图 |
| 6 | **视图渲染内容** | `eval` 读 `containerEl.innerText` | ✅ 见 §三 |
| 7 | 知识库真实状态 | `eval` `knowledgeBaseManager.listBooks()` | ✅ 0 本（vault 确实没有书） |
| 8 | **向量库对账** | `eval` `reconcileWithIndex(ids)` | ✅ 报出 `diskUnloaded: 8` 个孤儿向量 |
| 9 | 同人设定库 | `adapter.list('元文件/05-同人设定库')` | ✅ 3 个文件（模板 / 哈利波特 / 斗罗大陆） |
| 10 | 数据安全 | 全库扫描 `.corrupt-` | ✅ 0 个（无损坏留档，说明未发生过读失败覆盖） |
| 11 | **点文件语义（根因验证）** | `eval` 写 `.project` 后比对两种读法 | ✅ 见 §四 |
| 12 | 临时数据清理 | `adapter.rmdir` | ✅ 测试目录已删除，`exists=false` |

## 三、视图渲染实测

| 视图 | 渲染字符数 | 关键内容 | 判定 |
|---|---|---|---|
| 写作指纹库 | 448 | 「写作指纹能力边界 未积累 0 指纹 0 已启用 0 样本 0」 | ✅ 空态引导正确 |
| 知识库管理 | 1980 | 「共 0 本书籍」「题材分类 全部/男频/女频/中性」「📂玄幻修仙0…」「🔗 向量对账」按钮 | ✅ 配置面板与对账入口都在 |
| 创作主页 | 311 | 「还没有长篇小说项目 新建长篇小说」 | ✅ 空态与入口正确 |

注：知识库视图里的「失败」字样是**状态筛选标签**（待处理/失败、已完成/失败），非错误信息。

## 四、点文件语义生产验证（v4.85.0 最大 bug 类的根因）

在真实 Obsidian 中创建 `_生产测试临时/.project` 后实测：

| 读法 | 结果 |
|---|---|
| `app.vault.getAbstractFileByPath('.project')` | **null** |
| `app.vault.adapter.read('.project')` | 正常读到内容 |
| `app.vault.getAbstractFileByPath('普通文件.md')` | 正常返回 TFile |

**结论**：仓库文档（`shared/paths.ts` v31 注释）的描述在真实环境成立。
v4.85.0 修复前有 5 处代码用第一种读法 → 在生产里恒返回 null（同人约束全线静默失效）；
修复后统一走 adapter。**这是生产环境给出的根因证据，不是推测。**

## 五、发现的问题

| 级别 | 问题 | 影响 | 建议 |
|---|---|---|---|
| **P2** | `knowledgeVectorStore.reconcileWithIndex()` 无参调用抛压缩错误 `o is not iterable` | 生产调用方都传了参数，暂不影响用户；但外部/调试调用会得到无法定位的错误 | 参数给默认值 `kbBookIds: readonly string[] = []` |
| **流程** | 运行中的 Obsidian 实例加载的是 **4.81.1**（旧版），磁盘已是 4.85.0 | 发版后若不重载，用户仍在跑旧代码，所有修复「看起来没生效」 | 发版流程加入 `obsidian plugin:reload id=novel-writer-ai` + 版本校验；写进发版清单 |

## 六、未覆盖项（需要 AI 额度或真实项目）

| 项 | 原因 |
|---|---|
| 创建项目 → 写章 → 结算 → 导出 全旅程 | vault 内无活跃项目；且 `hasApiKey=false`（未配置 API Key），AI 生成不可跑 |
| 三条数据流「写→读→生效」端到端 | 同上：无书可拆解、无指纹、无项目 |
| 同人约束在生成结果里生效 | 需要 AI 调用 |

**建议**：这些项在配好 API Key + 建一个测试项目后，用同一套 CLI 方法补测
（`obsidian eval` 可直接调用插件服务，不必点 UI）。

## 七、复现命令

```bash
# 版本与健康
obsidian plugin id=novel-writer-ai
obsidian dev:errors

# 重载到磁盘上的最新构建
obsidian plugin:reload id=novel-writer-ai

# 命令冒烟
obsidian command id=novel-writer-ai:novel-writer-open-home
obsidian command id=novel-writer-ai:novel-writer-fingerprint-library
obsidian dev:errors

# 真实状态（eval 在 Obsidian 上下文执行）
obsidian eval code="app.plugins.plugins['novel-writer-ai'].manifest.version"

# 截图
obsidian dev:screenshot path=".screenshots/x.png"
```
