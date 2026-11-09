# 自动交叉审计 — 生命周期 / API 兼容 / popout / 移动端 ①

> 日期：2026-11-10 · 基线：`c5d50b5` · 维度：① 生命周期/API 兼容/popout/移动端（轮换回起点）
> 方法：两个独立视角并行取证（① 2026-11-09 O 系列逐条对照当前 HEAD 复核；② 对 B3-B8 起新增代码做生命周期盲审），交叉核对后合并。**盲审抓到 2 个本轮新代码引入的 P1。**
> 本轮修复：**F-1/F-2（均 P1）已修**；回归 `tests/unit/engine/graph-validation-trigger.test.ts` 4 条已实跑。台账第 18 轮。

## 一、Findings

### 本轮新代码引入（盲审视角）

| # | 级别 | 位置 | 问题 | 触发条件 | 影响 | 状态 |
|---|---|---|---|---|---|---|
| F-1 | **P1** | engine/graph/graph-validation-trigger.ts（模块级 timers Map 无清理导出）+ main.ts onunload 零引用 | 结算后防抖 5s 的图谱校验定时器在插件 onunload 时不清理；回调捕获全局 `app`，卸载后照常读全库并写诊断文件（withWriteLock + fs.write 必然成功） | 结算后 5 秒内禁用/热重载/退出 | 「插件已卸载却凭空出现报告」；热重载时旧 timer 叠加 | **本轮已修**：新增导出 `cancelScheduledGraphValidations()`，main.ts onunload 调用；回归 `graph-validation-trigger.test.ts` 4 条（fake timers：未取消→执行 / cancel→不执行 / 同项目防抖不回归 / 直连路径） |
| F-2 | **P1** | main.ts `_entityRecheckAbort` Map（1793）+ onunload 零引用 | 在途 `runEntityStateRecheck`（AI 实体检测）在卸载后继续执行，完成后 `applyStateChanges`+`updateInvolvedEntities` **写实体文件**；abort 拦截点已存在（写前 `if (signal?.aborted) return`），只差 unload 触发 | 卸载时恰有 3s 防抖后的在途重检 | 卸载后仍改写实体 frontmatter/涉及字段 | **本轮已修**：onunload 开头 `for (const c of this._entityRecheckAbort.values()) c.abort()` + `clear()`（2 行） |
| F-3 | P2 | association-resolver.ts:191 就地改写共享缓存 `ledger.promises`；ledger-io.ts 签名不含承诺文件；settlement-engine.ts:194 写承诺后不 invalidate | 章节摘要的「未兑现承诺」字段读到空/过期承诺（同轮结算先写时间线/伏笔使缓存重建则 promises 恒为 []，否则读到上次注入的陈旧值） | 每次完整结算生成摘要 | 剧情记忆摘要承诺字段必错（空或陈旧） | 未修 → **fix queue 首候选**；修法 ≈16 行：resolver 用局部副本不污染缓存 + ledger-io 签名并入承诺文件 + settleStep_updatePromiseLedger 末尾 invalidateStoryLedger |
| F-4 | P3 | ledger-io.ts 模块级 cache 跨项目常驻；context-manager.ts:2500 `ledger.links = links` 就地改写 | 缓存有界（项目数）、links 为派生数据自愈 | 切项目/热重载 | 低 | 未修 → fix queue（文档标注只读约定 + onunload invalidateStoryLedger 1 行） |
| F-5 | P3 | main.ts:1951/1961/1969（1s/1s/3s 裸 setTimeout 弹窗/更新检查）、1013-1024（onLayoutReady+setTimeout(0) 会话修剪删文件） | unload 时未清理的既有异步资源（O-6 老账，非本批引入） | 启动后 3 秒内卸载 | 卸载后弹 Modal / 发网络请求 / 删会话文件 | 未修 → fix queue（模块级 unload 守卫 ≈4 行/处） |

### 2026-11-09 O 系列复核（O-1..O-10 现状）

| ID | 现判定 | 要点 |
|---|---|---|
| O-1 | **仍开放（P1）** | direct-fetch allowlist 整文件放行 ai-api-client/embedding 两 provider/co-writer local-utils；全链 0 处 requestUrl、0 处 Platform.isMobile——移动端无 CORS 豁免且无兜底。修法批次化：embedding 两 provider 先行（≈30 行/个） |
| O-2 | 仍开放（P2） | onload 5 处 await 后继续注册，中途 disable 无短路；onunload 有 2s/3s await 窗口无代次门闩；修法 ≈20 行（generation counter） |
| O-3 | 仍开放（P2，语义恶化） | 4.79.1 设置页承诺「热重载状态自动恢复」但 `_pendingReloadState` 是旧实例内存字段，承诺不成立；修法 ≈20 行（sessionStorage TTL） |
| O-4 | 仍开放（P2） | 主题/字体四处只写主 document；popout 不重放 |
| O-5 | **已修复** | scene-outline-controller hostEl + 宿主内查询 + 契约测试在位 |
| O-6 | 部分修复 | W-7 冷却/B-1 dispose 已修；main.ts A 类 6 处调度点仍缺守卫（含本轮 F-2 的 abort 全表已修一半——abort 已补，逐项句柄仍未存） |
| O-7 | 仍开放（P2） | 拖拽/悬停交互移动端不可达；修法 ≈30 行（⬆⬇按钮 + click 同 handler） |
| O-8 | 部分修复（降 P3） | 粘贴已修（4.81.0 resolveNodeWindow）；残余 1 行：polish-editor.ts:314 AI 润色仍读主窗口选区 |
| O-9 | 仍开放（P2） | 移动端首装默认请求 localhost（coWriteModelMode/embeddingEndpoint/fallbackPolicy 三处默认值无 Platform 分支）；修法 ≈25 行 |
| O-10 | 部分修复（降 P3） | minAppVersion 1.4.4 + lint 规则扩充已做；仍缺 obsidian@1.4.4 类型编译 job 与 setTitle/trashFile 防回归 pattern |

## 二、已排除项（交叉确认）

- 新模块（ledger/association-resolver/chapter-digest/graph-validator/entity-recheck-gate）minAppVersion 1.4.4 兼容：`getAllFolders/Modal.setTitle/innerHTML/cssText` 零命中；metadataCache 缺失时有 skipped 守卫；`getMarkdownFiles` 有 typeof 守卫。
- 新模块零 registerEvent/registerInterval/零 plugin-as-Component；main.ts 的 vault.on 均经 registerEvent 自动注销。
- entity-recheck-gate 纯内存、key 全路径、LRU 有界；write-lock drainSlot 自清理；memory-shard-writer 非本批引入。
- graph-validation-trigger 的 `unref?.()` 仅防测试挂起，与卸载语义无关（真正的清理是本轮 cancel）。

## 三、本轮实跑结果

- `graph-validation-trigger.test.ts` 4 条全过（fake timers：未取消→执行、cancel→不执行、防抖不回归、直连路径）。
- `tsc --noEmit` = 0。

## 四、待用户拍板项

- O-1（移动端 requestUrl 兜底）修法批次化需移动端真机手测，是否纳入下批？
- O-3（热重载承诺不成立）修法选 sessionStorage TTL 还是 data.json 临时字段？
- 上述均不阻塞本轮，已入 fix queue 排序。
