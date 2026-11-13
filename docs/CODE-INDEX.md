# 代码索引（Code Index）

> 版本：v4.93.0 · 更新：2026-11-12
> **文件清单与规模已改为生成物**：[generated/code-index.md](generated/code-index.md)（`npm run gen:docs`）。
> 本文只保留「按功能/按问题查找」的人工导航；不再维护逐文件清单与计数，避免漂移。

## 查找方式

1. **按文件**：打开 [generated/code-index.md](generated/code-index.md)，按层/路径查找。
2. **按符号**：`rg "export .*<名称>"` 或 `rg "<名称>" engine services shared core domains ui`。
3. **按命令**：`rg "novel-writer-" main.ts core shared ui`。
4. **按数据**：路径统一看 `shared/paths.ts` 的 `pj*`；frontmatter 字段见 [handbook/04-interface-contracts.md](handbook/04-interface-contracts.md)。

---

## 快速查找索引

### 按功能查找

| 你要做什么 | 去哪里找 |
|------------|----------|
| 添加新的 AI 调用 | `engine/ai-engine.ts` + `engine/prompts/` |
| 添加新的实体类型 | `engine/repository/domain/aggregates/` + `shared/entity-models.ts` |
| 添加新的 Repository | `engine/repository/` 下新建，参照 `character-repository.ts` |
| 添加新的状态切片 | `shared/store/createStore.ts` + 对应模块 |
| 修改 UI 组件 | `ui/components/` 或 `ui/cowrite/` |
| 添加新的质量检测 | `engine/quality/` |
| 修改拆解质量评分 / 交叉验证规则 | `engine/quality-scorer.ts` + `engine/deconstruction-scheduler.ts` |
| 添加新的风格维度 | `engine/style/style-dimensions-v2.ts` |
| 修改构建配置 | `scripts/build.js` |
| 添加新命令 | `shared/command-ids.ts`（id）+ `core/command-registry.ts`（注册）+ `ui/command-ui-executor.ts`（UI 执行，如需要）+ `main.ts`（装配） |
| 添加新的设置项 | `core/settings-service.ts` + `ui/appearance-settings.ts` |
| 修改拆解引擎配置（增强级别/维度/向量/LLM/性能） | `engine/deconstruction-scheduler.ts`（`DeconstructionEngineSettings`） + `main.ts`（`NovelWriterSettings.deconstructionEngine`） + `ui/settings/deconstruction-section.ts` / `ui/mini-settings-modal.ts`（`DeconstructionSection.render` / `renderDeconstructionTab`） |
| 修改指纹列表 / 作用域判定 | `ui/fingerprint-utils.ts`（`renderFingerprintList` / `isSourceOnlyFingerprintScope`；`template` 是来源库，不参与注入，三个入口统一用该判定隐藏启用/强度控件） |
| 修改 Worker 相关 | `services/worker-manager.ts` + `services/worker-protocol.ts` |

### 按问题查找

| 遇到的问题 | 检查文件 |
|------------|----------|
| AI 调用失败 | `engine/ai-engine.ts` |
| 数据读取/写入失败 | `engine/repository/base-markdown-repository.ts` |
| 性能问题 | `services/performance-monitor.ts` |
| 缓存问题 | `shared/multi-layer-cache.ts` |
| 引擎找不到 | `engine/engine-registry.ts` + `.engine-registry-whitelist.json` |
| 样式问题 | `styles-src/*.css`（改后 `npm run build:styles`；令牌在 `00-header.css`） |
| 测试失败 | `tests/unit/` 对应目录 |
| 拆解质量评分异常 / 交叉验证规则不生效 | `engine/quality-scorer.ts` + `engine/deconstruction-scheduler.ts` |
| 拆解引擎设置不生效 / 维度缺失 / 并发不对 / 全文分块未触发 | `engine/deconstruction-scheduler.ts`（`addTask` / `breakdownDimensionWithSegments` / `getSegmentedBreakdownConfig`） + `engine/scheduler-segment-integration.ts` + `main.ts`（`NovelWriterSettings.deconstructionEngine`） + 设置面板「🧬 拆解引擎」tab |
