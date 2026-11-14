# 催更姬 DSH 插件架构分析 → Obsidian 小说 Agent 工作台融合方案

> 分析对象：`dsh-cuigengji-plugin` v0.6.0（DSH 插件，`C:\Users\admin\.dsh\profiles\desktop\node_modules\dsh-cuigengji-plugin`）
> 分析日期：2026-11-14 · 分析者：DSH 会话
> 本机对照：`novel-writer-ai` v4.96.0（Obsidian 插件，`D:\小说工坊\小说工坊\.obsidian\plugins\novel-writer-ai`）

---

## 0. 一句话结论

催更姬不是「一个更大的写作插件」，而是**把小说写作当成一个有事务语义、有作者/Agent 权限边界、有独立存储契约的领域系统**来做的。
我们插件强在生成流水线（步骤编排、质量闸门、成本统计、一致性审核），弱在**作者侧的领域数据模型**（规划/设定没有实体化，只有 Markdown 文件）。
融合方向不是照搬 UI，而是**把它的三个领域机制搬过来**：动作契约、实体化存储、规划画布。

---

## 1. 事实基础：两者根本不是同一类插件

| 维度 | 催更姬 | 我们（novel-writer-ai） |
|---|---|---|
| 宿主 | **DSH 插件**（`cordis.patch.yml` 注册进 DSH bundle） | **Obsidian 插件**（`main.ts` + `onload`） |
| 运行形态 | 服务端 `runtime/`（Node，动作调度/存储/事务）+ Web 客户端 `lib/client.js`（React 工作台） | 单进程（Obsidian 内 renderer + 少量 worker） |
| UI 技术 | React + TSX（`client/features/*`） | 原生 DOM + Obsidian API（`ui/*`） |
| AI 接入 | **DSH 原生工具调用**（7 个 Skill + MCP 工具） | 自建 HTTP 客户端 + 步骤流水线（`engine/ai-*`） |
| 数据存储 | 独立 `dataRoot`，**分文件 JSON + 索引 + 文件锁 + 事务恢复** | Vault 内 Markdown + 少量 `data/*.json` |
| 规模 | src 约 6 万行 / 136 个 client 文件 / 42 个 domain 文件 | 约 870 个 TS 文件（含测试工具链） |

> **关键约束**：DSH 的 `ctx.skills.register` / `ctx.rpc.register` / React 客户端注入在 Obsidian 里**都不存在**。
> 能搬的是**领域模型与工程契约**，不能搬的是宿主集成层。

---

## 2. 架构分层对照

| 催更姬模块 | 职责 | 我们的对应物 | 差距 |
|---|---|---|---|
| `client/WorkbenchShell.tsx` + `client/features/*` | 工作台外壳 + 9 个功能页（正文/规划/设定/预设/作品/统计/迁移…） | `ui/full-writer/*`（37 文件）+ `ui/views/*`（31 文件）+ `ui/agent-workbench-view.ts` | 我们页数不少，但**缺少「规划」与「设定」两个作者侧实体页** |
| `domain/`（42 文件） | 正文版本/目录/规划层级/资源/分组/历史/布局规则 | `engine/*`（生成）+ `shared/*`（统计/契约） | 我们有**生成域**，缺**作者域**（planning/memory 的纯模型） |
| `application/store.js`（58KB） | 统一动作 + 作者/Agent 边界 + 版本协调 + 持久化编排 | `main.ts`（2400+ 行）+ `ui/command-ui-executor.ts` | 我们的动作散在命令与 UI 里，**没有单一动作契约** |
| `application/libraries/` | 作品库切换 + 进行中操作互斥门 | 无（单 Vault 多项目目录） | 无多库概念，暂不需要 |
| `infrastructure/persistence/` | 分文件索引/按需读取/文件锁/事务恢复/布局迁移 | `shared/paths.ts` + 直接 `vault.adapter` 读写 | **无事务、无锁、无恢复日志**（已知会被外部编辑器打断） |
| `adapters/dsh/*` | RPC 路由 + Skill 注册 + 提示词注入 | `ui/command-ui-executor.ts` + 各 modal | 无 Skill 概念；提示词靠模板拼装 |
| `application/usage/` + `domain/usage/` | 独立用量账本（价格快照/余额/素材/来源） | `services/usage-ledger.ts` + `ui/usage-ledger-modal.ts` | 我们已有账本，**缺余额与价格快照** |
| `application/pet/` + `desktop/PetWindow.cs` | 陪伴层（状态机/气泡/Windows 原生窗口） | `ui/writing-pet.ts` + `shared/pet-geometry.ts` | 我们已有桌宠，**缺状态语义与用量联动**（本轮刚补） |

---

## 3. 七个核心机制拆解

### 3.1 动作契约（`contracts/actions.js`）——最值得抄的一条

它把「Agent 能做什么」写成**三张冻结表**，而不是散落在工具实现里：

```js
TOOL_ACTIONS     // 按工具分组的动作白名单（6 个工具 × 4~28 个动作）
HUMAN_ACTIONS    // 人类可发起的全部动作（工具动作的超集）
isReadAction()   // 正则判定「读」动作 → 决定是否允许只读会话
changesProse()   // 判定「是否改动正文」→ 决定是否触发字数统计/结算
```

**为什么重要**：权限、审计、幂等、字数差计算全部依赖这一份契约，改一个动作只需要改一处。
我们的现状：命令 id 分散注册，动作语义（读/写正文/写设定）没有统一判定，导致
「哪些操作会改正文」「哪些会话只读」只能靠人记。

### 3.2 存储布局（`infrastructure/persistence/`）

```
dataRoot/
  library.json                      作品库与目录映射
  novels/<书名>/
    project.json                    作品信息
    chapters/index.json             正文与版本索引（不含全文）
    chapters/<卷>/<章--短ID>.json    按需读取的单章
    settings/index.json             人物/世界索引（不含全文）
    settings/entries/…/<卡--短ID>.json
    settings/groups.json            嵌套目录
    settings/relations.json         当前关系
    planning/index.json             规划摘要/关系/页面索引
    planning/<页面>/<事件--短ID>.json
    preset.json / variables.json
    history/{chapters,settings,planning}/…
  activity/<年>.json                每日写作统计
  runtime/{bindings,upgrade,requests}/ 会话绑定/升级阶段/幂等请求结果
```

三条设计原则：
1. **索引与正文分离**：列目录只读 `index.json`，正文按需单读（我们目前经常整文件扫）。
2. **短 ID + 可读名**：`<章名--短ID>.json`，改名不破坏引用。
3. **事务语义**：先暂存 → 提交索引 → 留恢复日志 → 重启后在同一文件锁内补完（我们没有）。

### 3.3 规划模型（`domain/planning/*`，19KB 核心）

- **节点 = 事件/选择/阶段，不是章节**（我们目前没有这个概念）
- 阶段通过 `parentId` **包含**子情节；包含 ≠ 因果，因果用 `edge`
- 独立「页」（page）= 画布；页内有嵌套文件夹、便签（台词/未决问题）
- 布局（坐标）与语义（层级/因果）分离；布局由工具计算，作者拖动不改关系
- `written` 状态必须有 `chapterRefs`（已保存正文版本）作为证据

### 3.4 设定模型（`domain/memory/*`）

- 卡 = 实体（人物/地点/组织/规则），`content` 全文 + `summary` 检索摘要 + `patch:{oldText,newText}`
- 嵌套 `groups` 即「资源查看范围」，不另建页面
- `relations` 独立存边（from/to/label/type）
- 历史逐次保存；`graph.restore` 生成**新的当前版本**（不删历史）
- `retired`（软删）≠ `delete`（真删）

我们的现状：设定是 Markdown frontmatter 文件（`01-世界架构/人物/*.md`），**无关系边、无版本历史、无 patch 语义**。

### 3.5 会话上下文（`application/bindings` + `adapters/dsh/prompt.js`）

- `novel.list` → `novel.focus` 记住本会话作品；**浏览界面不自动切书**
- 预设快照：会话首次读到某书预设时**固化**到 `runtime/presets/<会话>.json`，续聊不换
- `guidance`：常驻提示词只放稳定核心规则，详细规范按需 `guidance.read`
- 「作者浏览 ≠ 注入 AI」——界面选择不会自动进上下文

### 3.6 用量账本（`domain/usage/*` + `application/usage/service.ts` 26KB）

- 独立于作品库（`$DSH_HOME/cuigengji/usage`）
- **价格快照**：调用时记录当时单价，查询不重新计价
- 余额账户按身份分本，**不与本地模型估算相加**
- 来源密钥只经宿主凭据服务解析，导出不含密钥与聊天正文

我们已有账本（本轮补了默认参考价），但**价格随查询时间变**（没有快照），且无余额概念。

### 3.7 陪伴层（`client/features/pet/*` + `application/pet/desktop.ts`）

- 状态机（idle/writing/thinking/celebrate/sleepy/error）+ 雪碧图切帧（本轮已移植）
- 气泡语义：用量/余额/今日进度（本轮已补今日与成本入口）
- Windows 原生透明窗口（`PetWindow.cs`）——**Obsidian 无法移植**（跨平台 + 沙箱）

---

## 4. 融合到 Obsidian 小说 Agent 工作台的落地方案

### P0（高价值、可独立交付）

| # | 借鉴机制 | 落地到我们哪里 | 产出 |
|---|---|---|---|
| 1 | **动作契约表** | 新增 `shared/action-contract.ts`：`ACTION_KINDS`（read/write-prose/write-setting/write-planning）+ `isReadAction`/`changesProse` 判定；`ui/command-ui-executor.ts` 与 `main.ts` 命令注册统一走它 | 所有命令带语义标签；「改正文」可自动触发字数统计/结算 |
| 2 | **实体化设定图** | 新增 `domains/memory/model.ts`（卡/目录/关系边）+ `services/memory-store.ts`（vault 内 `设定/` 分文件 + `index.json`）；现有 `01-世界架构/*.md` 迁移适配器 | 设定有 `relations`（人物关系不再只写在正文里）、有历史版本、可 patch |
| 3 | **规划事件画布** | 新增 `domains/planning/model.ts`（事件节点/阶段包含/因果边/页/文件夹）+ `ui/views/planning-canvas-view.ts` | 作者能画「事件图」而不是只有卷章大纲；节点≠章节 |

### P1（工程加固）

| # | 借鉴机制 | 落地 |
|---|---|---|
| 4 | 索引与全文分离 | 项目 `index.json`（章节/设定/规划摘要）+ 按需读全文；`context-manager` 改为先读索引 |
| 5 | 事务与恢复日志 | `services/file-tx.ts`：暂存 → 提交索引 → 恢复日志；启动时补完中断操作 |
| 6 | 价格快照 | `services/usage-ledger.ts` 记录调用时单价，查询不重算 |
| 7 | 会话预设快照 | 首次读预设即固化到项目 `runtime/presets/<会话>.json`，续聊不换 |

### P2（体验层）

| # | 借鉴机制 | 落地 |
|---|---|---|
| 8 | 只读/可写会话模式 | 用 P0-1 的契约表判定，只读会话拒绝写动作 |
| 9 | 幂等请求结果 | `runtime/requests/` 式去重（同一 requestId 重试返回同一结果） |
| 10 | 桌宠用量联动 | 桌宠状态机接用量事件（余额低 → error 表情；写完一章 → celebrate） |

---

## 5. 不建议照搬

| 项 | 原因 |
|---|---|
| React 客户端注入 / `ctx.rpc.register` | Obsidian 没有该宿主 API |
| `PetWindow.cs` Windows 原生窗口 | 跨平台 + 沙箱限制；我们用 DOM 浮层替代 |
| 多作品库（`LibraryService` 切换/互斥门） | 我们单 Vault 多项目目录，引入库概念收益低 |
| 完整备份/迁移体系（`transfer/` 93KB） | 我们的项目目录本身就是可移植的 Markdown，暂不需要包格式 |
| DSH Skill 注册机制 | Obsidian 无 Skill 概念；等价物是「提示词模板 + 步骤」 |

---

## 6. 三步走与验收

**第一步（P0-1 动作契约）**：`shared/action-contract.ts` + 单测 + 现有命令打标
验收：能回答「这条命令会不会改正文」，`changesProse` 覆盖全部写正文命令。

**第二步（P0-2 设定图）**：模型 + 存储 + 迁移 + 关系编辑 UI
验收：人物关系可建边、可查询；设定改删有历史；`patch` 语义与催更姬一致。

**第三步（P0-3 规划画布）**：事件节点/阶段/因果边 + 画布视图
验收：作者能在一个画布上摆事件、连线、嵌套阶段，且节点可关联正文版本作为 `written` 证据。

---

## 7. 与长期目标的关系

我们的长期目标是「用户相信存在的能力必须真的生效」。这三项恰好是**我们目前没有、但用户以为有**的部分：

- 用户以为「设定关系」存在 → 实际只有 Markdown 文件（无关系边）
- 用户以为「规划」存在 → 实际只有生成步骤的中间产物（无作者侧事件图）
- 用户以为「命令语义」有约束 → 实际没有统一契约，只读/写正文无法自动判定

因此 P0 三项不是「抄功能」，而是**补齐用户已经相信存在的能力**。
