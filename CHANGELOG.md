# Changelog

## 4.5.1 — 全流程测试 Bug 修复 (2026-06-29)

### 🐛 全流程 UI 测试发现的 Bug 修复

**P0：FullWriterView 多实例共存**
- `openFullWriterView` 复用 `existing[0]` 但不清理多余 leaf，导致多实例共存
- 多实例中未渲染的实例 `tabContent` 为 undefined，引发 `querySelector` 崩溃
- 修复：`existing.length > 1` 时 `detach()` 多余 leaf

**P0：协同写作正文路径错误**
- `getBodyPath`/`getStepResultDirs`/`getStepFilePath`/`checkPrerequisites` 用 `chapterName`（如"初始之痕"）作为路径前缀
- 与 `pjBodyFile`/`pjStepFile` 的 `第N章` 规范不一致，导致 `findBodyFileV4` 找不到正文文件
- 影响：章节结算、上下文采集、情节冗余检查全部失效
- 修复：全部改用 `第${chapterNum}章` 前缀

**P0：saveBody 丢失 frontmatter**
- `saveBody` 的 `modify(file, titleLine + body)` 覆盖整个文件，丢失 `涉及人物/涉及地点/涉及势力/涉及物品功法` 字段
- 导致 `settleLight` 无法写回实体状态
- 修复：保存前备份原 frontmatter，保存后通过 `processFrontMatter` 恢复关键字段

**P1：tabContent undefined 崩溃**
- `WizardStepExecutors` 构造函数时 `tabContent` 未初始化
- 修复：改为 getter 回调 `getTabContent: () => HTMLDivElement`

**P1：前置规划检查误报**
- `checkPrerequisites` 用 `chapterName` 拼接路径，找不到实际存在的文件
- 修复：改用 `第${chapterNum}章` 前缀，文件名改为 `信息规划.md`（与 `pjStepFile` 一致）

**P2：updateProgress null 检查缺失**
- tabContent 临时为 undefined 时崩溃
- 修复：添加 `if (!tc) return;` 防御性检查

### ✅ 验证
- TypeScript 编译：0 错误
- esbuild 构建：0 错误
- 全流程 UI 测试通过（项目创建→世界观→设定库→实体→大纲→建章→协同写作→章节结算）

---

## 4.5.0 — 数据安全架构升级 + 三层 Bug 修复 (2026-06-29)

### 🐛 三层完整链 Bug 修复（51 个 Bug，4 大根因簇）

**批次 1：模板-代码字段错位（10 P0）**
- 伏笔库 section "已揭示伏笔" → "已回收伏笔"，与常量/引擎一致
- 伏笔库解析从 6 列修正为 8 列索引（parts[0-7]），新增 relatedChars/relatedMainline
- 正文 frontmatter "涉及物品" → "涉及物品功法"，模板/类型/引擎/前端四处统一
- 时间线常量 TIMELINE_COLUMNS 从 4 列改为 7 列，与模板对齐
- 世界观模板从 6 section 扩展为 9 section，与 WV_SECTIONS 对齐
- 实体生成器 YAML 模板补充 entity_status/entity_created_at 等 4 个字段
- project-wizard-modal 统一用 wizard-types.ts 的 WizardStep 和 buildWizardSteps
- context-manager.ts 变量名 continuityReviewFile → reviewFile 修正

**批次 2：协同写作上下文塌陷（4 P0）**
- buildSnapshot 的 prevChaptersSummary 从 previous_chapter 对象正确读取 bodySummary/outline/ending/analysisReport
- ContextSnapshot 接口补充 settingLib/timeline/characterCores/triggeredMemories 4 个字段
- buildDirectionalPrompt system 段注入 allChars/allFactions/allLocs/allItems/writingRules
- buildDirectionalPrompt user 段注入 chapPlan/sceneExpansion/prevChaptersSummary/settingLib/timeline
- settlement-engine 新增 settleLight() 轻量结算（无分析报告时基于 frontmatter 写回实体）

**批次 3：路径/状态断裂（6 P0）**
- co-writing-view onClose 新增 ghostDebounceManager.dispose() 和 liveAnalysis.clearTimers()
- 删除 _liveTimerIds/clearLiveTimers/_addLiveTimer 死代码
- getBodyPath 改用 chapterName，与 getStepResultDirs 一致
- generate-worldview-modal 设定库路径改用 pjSettingLib() 函数
- CoWriterEngine 改为 plugin.coWriterEngine 单例共享（懒加载）

**批次 4：entity_* 状态链 + P1（20 P1）**
- 校验器补充 entity_status/entity_created_at 字段检查
- entity-state-manager 正则从双重转义修正为单反斜杠 /^(---\s*\n)/m
- 物品功法模板 entity_status 从 draft 改为 active
- 前端人物字段列表统一引用 CHARACTER_DISPLAY_KEYS 常量

**批次 5：P2 优化项和死代码清理（11 P2）**
- 删除 CrossViewStateManager 死代码
- suggestion-history-store/main.ts/create-project-modal 裸路径替换为 paths.ts 函数
- WizardStep.status 添加类型注释，明确与 CHAPTER_STATUS 不同

**编译错误修复**
- context-manager.ts:869 cachedRead 补充 getAbstractFileByPath() as TFile 转换
- TypeScript 编译 0 errors，esbuild 构建 0 errors

---

## 4.5.0 — 数据安全架构升级 (2026-06-27)

### 🛡️ P0 级数据安全增强

**1. 串行写入器（SerializedWriter）接入主设置保存**
- **main.ts** `saveSettings()` 改用 `SerializedWriter.enqueueAutoClean()`，保证设置写入原子性
- 防止高频保存（滑块拖动、连续切换）导致的并发写入冲突
- `onunload` 时触发 `flush()` 尽力确保所有写入完成
- 此前已在 style-learner / preference-memory 中使用

**2. 设置版本迁移机制**
- 新增 `shared/settings-migrator.ts` — 统一的 schemaVersion 迁移框架
- 当前 schemaVersion = 2，支持 v0→v1→v2 链式迁移
- 迁移失败时降级处理，不崩溃，保留原始数据
- `loadSettings` 自动检测版本并执行缺失的迁移
- 为未来格式升级提供安全保障，彻底解决用户数据丢失风险

**3. 缓存数据独立文件存储（渐进式）**
- 新增 `shared/plugin-cache.ts` — PluginCacheManager 缓存管理器
- 缓存文件路径：`.obsidian/plugins/novel-writer-ai/data/cache.json`
- 已分离缓存项：panelLayout（浮窗布局）、modelOverrideHistory（模型覆盖历史）
- 当前采用「双写」策略：settings 和 cache 同时写入，确保向后兼容
- 内置 SerializedWriter 串行写入，保证缓存文件原子性
- 下一版本可平滑切换为「读 cache 优先 + 从 settings 移除」

### 🔧 架构优化

**防抖系统全面统一**
- 6 个防抖场景 100% 接入 AdaptiveDebounceManager
- 新增协同写作场景：实时分析、设定守卫、幽灵联想
- 详见 v4.4.0 更新日志

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：161/161 通过
- 新增文件均通过严格类型检查

## 4.4.0 — 自适应防抖管理器版 (2026-06-27)

### 🚀 新增功能

**AdaptiveDebounceManager 自适应防抖管理器**
- **核心实现**：`shared/adaptive-debounce-manager.ts` — 统一防抖基础设施，支持固定延迟与自适应延迟两种模式
- **自适应算法**：根据输入速度动态调整延迟（快速输入→长延迟减少写入，慢速输入→短延迟提升响应）
  - 快速模式：>3 次/秒，延迟 500ms
  - 中速模式：1-3 次/秒，延迟 300ms
  - 慢速模式：<1 次/秒，延迟 100ms
- **内存管理**：自动清理 5 分钟未使用的 key 历史记录，防止内存泄漏
- **可配置**：支持自定义三档延迟、阈值、历史窗口、调试模式

### 🔧 架构优化

**防抖逻辑统一重构**
- **main.ts**：设置保存（500ms 固定）+ 正文变更实体状态重检（3000ms 固定）→ 改用 `debounceFixed`
- **polish-editor.ts**：润色编辑器自动保存（500ms 固定）→ 改用 `debounceFixed`，新增 `destroy()` 方法
- **live-analysis-controller.ts**：实时分析刷新 + 设定守卫检查（双定时器，trigger 敏感延迟）→ 改用 `debounceFixed`
- **co-writing-view.ts**：幽灵联想刷新（2600ms 固定）→ 改用 `debounceFixed`
- **消除重复模式**：移除 6 处重复的 setTimeout + clearTimeout 手动管理模式
- **资源清理**：统一 `dispose()` 接口，插件卸载时清理所有待执行定时器

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：161/161 通过（新增 20 个防抖管理器单元测试）
- 新增测试覆盖：基础防抖、自适应切换、内存管理、并发安全、dispose 清理等

## 4.3.1 — 技术债清理版 (2026-06-27)

### 🔧 代码质量改进

**P2 级技术债修复**
- **通知时长常量化**：11 个文件 50+ 处硬编码 `showNotice` 时长替换为 `thresholds.ts` 中的 `NOTICE_ERROR`/`NOTICE_WARNING`/`NOTICE_CRITICAL` 常量
- **插件数据路径统一**：`shared/paths.ts` 新增 `pluginDataDir()`/`pluginPreferenceFile()`/`pluginStylePatternsFile()`，消除硬编码路径
- **伏笔解析代码去重**：`foreshadow-manager.ts` 提取共享 `parseForeshadowTableContent` 函数
- **分析报告状态透明化**：`analysis-report-engine.ts` `applyReportChanges` 返回结构化状态对象，用户可区分自动应用与待手动处理
- **JSON 解析容错增强**：`intervention-controller.ts` `callUnderstandingAPI` 添加 try-catch 保护

**依赖更新**
- `preference-memory.ts`、`style-learner.ts` 改用 `paths.ts` 统一路径函数
- `review-agent.ts`、`settlement-engine.ts`、`ai-api-client.ts` 等全面常量替换

### ✅ 质量保证
- TypeScript 编译：0 错误
- Vitest 测试：141/141 通过

## 4.1.1 — 架构重构版 (2026-06-25)

### 🏗️ 架构重构（引擎层回调模式）
- **step-runner-callbacks.ts 新增**：StepRunner 回调接口，engine 层通过 callbacks 与 UI 层解耦
- **step-runner.ts 重构**：移除所有 `new Notice()` 调用（52 处 → 改为 `this.callbacks.*`），移除 `showProgress/showSuccess/showError/hideProgress` 直接调用
- **shared/paths.ts 注释更新**：标记 `readProjectMeta` / `isProjectFolder` 为 Obsidian API 耦合（计划 v4.1.2 迁移）
- **settlement-engine.ts 注释更新**：标记 19 处 `new Notice()` 为待改进项（计划 v4.1.2 迁移）
- **engine → ui 依赖清理**：engine 层不再直接操作 DOM 或调用 Obsidian UI

### ✅ 质量保证
- TypeScript 编译：通过
- Vitest 测试：60/60 通过

## 4.0.0 — 稳定性增强版 (2026-06-25)

### 🚀 AI 引擎增强
- **SSE 流式输出**：正文生成期间实时反馈，支持用户中断
- **Token 精细化估算**：中英混合分层估算，模型特定 tokenizer 效率感知，提前拒绝超窗口输入
- **多模型智能并发**：推理模型 1 并发 / 标准 2 / Flash 4，429 限流自动退避
- **模型能力集中化**：`shared/model-capabilities.ts` 统一 65+ 模型配置，支持自定义供应商

### 🎨 CSS 架构重构
- **!important 839→299** (-64%)：提高选择器特异性替代 !important
- **重复选择器合并**：cowrite 三栏/suggestions/editor-wrap 去重
- **Fallback 变量收敛**：radius-lg/md/sm 与 :root 权威值完全一致
- **内联 CSS 迁移**：wizard 导航栏按钮样式 → CSS 类名

### 📐 架构优化
- **wizard-controller 抽离**：full-writer-view 2228 行 (-55%，基线 4954)
- **ai-engine 拆分**：ai-types.ts + ai-prompt-builder.ts 外迁 (2712 行)
- **双轨残留清理**：移除 6 个废弃阈值常量，@deprecated 注释清理

### 🧪 测试基础设施
- **Vitest 入库**：60/60 测试通过，89.6% 行覆盖
- Obsidian API Mock 完整实现

### 🔧 运行时稳定性
- **P0 全部修复**：8 项运行时 Bug 清零，0 崩溃路径
- **@ts-ignore 清零**：79→0，WizardViewAccess 接口替代 `as any`
- **静默吞错修复**：chapter-utils 3 处 catch → console.warn
- **监听器泄漏修复**：全部注册到 registerEvent()
- **settlement 回滚修复**：NEW 文件清理，伏笔库 hasPartialFailure
- **main.ts 侧边栏修复**：getLeaf('tab') + null 检查

### 📝 代码质量
- **console 降噪**：3 处冗余 log → debug
- **findBodyFileV4 修复**：恢复 v4 目录结构正文查找
- **类型安全加固**：WizardViewAccess 接口定义

---

## 3.3.0 (2026-06)

- V2 灵魂驱动架构：角色灵魂层 + 情绪弧规划 + Scene 展开
- 关系引擎 + 情绪审计
- 句级协同写作工作台
- 文笔风格自学习 (E1)
- 多模型 fallback 切换
- tsc --noEmit 0 error

## 3.2.0 及更早

- 全流程 AI 长篇小说创作系统
- 防 OOC、设定追踪、多 Agent 协作
- 跨卷状态继承、文笔风格蒸馏
- QuickAdd + Obsidian 集成
