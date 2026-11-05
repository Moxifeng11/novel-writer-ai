# StyleDeconstructor v1/v2 单入口设计说明

> 日期：2026-11-06 · 状态：**设计定稿，待用户批准实施**
> 审计来源：`docs/audits/v4.27.0-architecture-and-roadmap.md` P1-6「多实例状态源 —— v1/v2 风格库并存」剩余项
> 结论先行：**推荐方案 A——下线 V2 并行实现，V1 即唯一入口**。V2 是零调用方的死端点，删除即收敛，无数据迁移、无对外 API 破坏。

---

## 1. 事实清单（2026-11-06 全仓实测）

### 1.1 V1（现役唯一链路）

`StyleDeconstructor`（`engine/deconstructors/style-deconstructor.ts`）：

| 消费方 | 路径 |
|---|---|
| 拆解调度器 | `deconstruction-scheduler.runDimensionWithFallback` → `workerManager.analyzeStyle / analyzeStyleWithVector` |
| 分段集成 | `scheduler-segment-integration` 绑定同一对方法 |
| 重任务管理器 | `'style:analyze'` 任务：Worker 分发 + 主线程 fallback + `initMainThreadEngines` 引擎（3 处构造） |
| 增量聚合 | `incremental-result-aggregator.combineStyleResults` 按 V1 结果形状合并 |

### 1.2 V2（零调用方的死端点）

`StyleDeconstructorV2`（`engine/style/style-deconstructor-v2.ts`，**2,016 行**）：

| 检查项 | 结果 |
|---|---|
| 唯一入口 | `HeavyTaskWorkerManager.analyzeStyleV2()` → 任务 `'style:analyze:v2'` |
| 生产调用方 | **0**（`ui/`、`services/`、`domains/`、`plugin-api.ts`、`command-registry` 均无引用） |
| Worker 端实现 | 无——`workers/` 未注册该任务，只会走主线程 fallback |
| 结果落盘 | **无**——`StyleAnalysisResultV2`（12 维 `features` + `v1Result` + `stats`）没有任何持久化路径 |
| 指纹库关系 | `style-fingerprint-library` 与 `style-distill-service.analyzeStyleFromSource` 均**不经**两代拆解器 |
| 测试面 | `tests/unit/engine/style/style-deconstructor-v2.test.ts`（736 行）仅直测 V2 |
| 守卫登记 | V1/V2 均不在 `.engine-registry-whitelist.json`；V2 仅 `heavy-task` 1 处构造 |

### 1.3 结论性事实

1. 审计 P1-6 所述「v1/v2 并存」**不是数据格式分叉**，而是一套从未接线的平行实现。
2. V2 的 12 维情绪/场景特征从未被任何消费方读取；指纹维度由 `style-distill-service` 独立承担。
3. 删除 V2 不影响任何用户数据、任何 UI 功能、任何对外 API。

---

## 2. 目标与非目标

**目标**

1. P1-6 收口：文风拆解运行时仅剩 V1 一条链路、一个任务名（`style:analyze`）。
2. 删除 `style-deconstructor-v2.ts`（约 −2,016 行）与 736 行死测试；bundle 体积显著下降（以构建实测为准）。
3. 引擎守卫与文档基线同步收紧。

**非目标**

- 不修改 V1 的分析行为与结果结构；
- 不新增指纹维度、不动 `style-distill-service` / `style-fingerprint-library`；
- 不重构 `incremental-result-aggregator`。

---

## 3. 方案对比

| 方案 | 内容 | 代价 / 风险 | 判断 |
|---|---|---|---|
| **A · 下线 V2（推荐）** | 删除 V2 类 + `'style:analyze:v2'` 任务/回退/方法 + V2 测试 | 最低：零调用方、零落盘、零对外暴露 | ✅ 采纳 |
| B · V2 转正 | 调度器切 V2、落盘扩展 12 维字段 | 需迁移增量聚合器与结果合并、UI 展示；无消费需求支撑；高风险 | ❌ 不采纳 |
| C · 双轨文档化 | 保留现状只写说明 | 不解决审计项，死代码继续腐化 | ❌ 不采纳 |

**若未来需要 12 维特征**：在 `style-distill-service` 上按需新增维度并落盘到指纹契约，而不是复活 V2（重评条件见 §7）。

---

## 4. 兼容性分析

| 面 | 影响 |
|---|---|
| 用户数据 | 无——V2 结果从未持久化，无需迁移 |
| 对外 API | `analyzeStyleV2` 未进 `plugin-api.ts` / 命令表；删除不构成公开 API 破坏 |
| 任务表 | `'style:analyze:v2'` 从任务映射移除；外部手工触发（无证据存在）会得到「任务不存在」错误，发布说明标注 |
| 守卫基线 | `heavy-task` 少 1 处直接构造；`check-engines` 只会更好看 |
| 体积 | 预估 main.js −30~50 KB（2,016 行 + 大词表，以实测为准），基线按「只降不升」收紧 |

---

## 5. 实施清单（批准后执行，单提交完成）

1. 删除 `engine/style/style-deconstructor-v2.ts`；
2. `engine/heavy-task-worker-manager.ts`：移除 import、`styleDeconstructorV2` 字段、两处构造（`initMainThreadEngines` / Worker 任务映射）、`'style:analyze:v2'` fallback、`analyzeStyleV2()` 方法与 `StyleAnalysisResultV2` 类型引用；
3. 删除 `tests/unit/engine/style/style-deconstructor-v2.test.ts`；
4. 基线同步：`gen:docs`（JSDoc 基线收紧）、`check:bundle`（体积下降后收紧并写 note）、`program-status.json` changelog 登记；
5. `docs/releases/vX.Y.Z.md` 记录「移除未接线的 V2 拆解器（无公开 API 影响）」。

**纪律**：本实施不与 Notice/其他切片混提交；`E2E` 全量照跑。

---

## 6. 验收口径

```text
[ ] npx tsc --noEmit                 # 0 error
[ ] npm test                         # 全绿（文件/用例数 -1 文件）
[ ] npm run check-engines            # exit 0，无新增
[ ] grep -rn "StyleDeconstructorV2|style:analyze:v2" --include=*.ts \
      engine ui services core domains shared plugin-api.ts   # 运行时代码 0 命中
[ ] npm run build && npm run check:bundle   # 体积下降并收紧基线
[ ] npm run preflight:release        # 全绿
```

回滚：revert 该单提交即可；无数据、无配置迁移。

---

## 7. 重评条件（满足任一才考虑 12 维特征）

1. 指纹/蒸馏链出现对情绪弧、叙事距离等 V2 特征的真实产品需求；
2. `style-distill-service` 契约扩展方案（含落盘与 UI 展示）先行评审通过。

在此之前，V2 的词表如有可复用价值，按「拷贝进 `style-distill-service` 所需维度」处理，不保留整类。
