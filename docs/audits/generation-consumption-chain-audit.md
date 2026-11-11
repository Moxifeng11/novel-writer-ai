# 生成与消费链路审计：同人设定 / 知识库 / 指纹三层

- 审计时间：2026-11-11
- 触发：用户要求「查看生成和消费链路，包括同人设定卡和知识库，以及指纹，特别是指纹的三个层次设定」
- 基线：v4.83.0（`76dffa5`）

---

## 一、指纹的三个层次

| 层 | 定位 | 存储 | 是否参与注入 | UI 处理 |
|---|---|---|---|---|
| `template` 模板层 | **来源库**（只读素材） | `template-fingerprints.json` | ❌ **不参与** | 隐藏启用/强度控件，显示「来源库 · 复制到项目后生效」 |
| `global` 全局层 | 跨项目通用 | `global-fingerprints.json` + 项目级覆盖表 | ✅ | 可启用；启用状态**按项目覆盖** |
| `project` 项目层 | 本项目专用 | `pjControlDir(project)/.../fingerprints.json` | ✅ | 可启用 |

### 消费合并规则（`getEnabledFingerprints`）

```
projectEnabled = projectFingerprints.filter(fp => fp.enabled)
globalEnabled  = globalFingerprints.filter(fp => isGlobalEnabledForProject(fp.id, targetProject))
返回 [...projectEnabled, ...globalEnabled]
```

- **template 不在合并范围**是**明确设计**，不是遗漏：
  `ui/fingerprint-utils.ts#isSourceOnlyFingerprintScope` 的注释写明「模板层是来源库而非注入层」，
  且三处 UI 入口（指纹库视图 / 设置页 / 列表渲染）都隐藏了启用控件。
  设置页 `if (fp.scope === 'template') return;` 是防御性代码（开关根本不会渲染）。

---

## 二、发现并修复的真缺陷

### F1（已修）｜指纹消费链路首次运行静默为空

**症状**：11 步执行、模式注入、资产注册、润色、prompt-builder 这 5 条路径，
首次运行时启用的指纹**恒为空数组**——风格约束静默消失，无任何报错。

**根因（三件事叠加）**：
1. `StyleFingerprintLibrary` 构造函数**不加载任何数据**（只设置 embedding client）
2. `getEnabledFingerprints()` 直接读内存表 `this.projectFingerprints` / `this.globalFingerprints`
3. 6 个消费方里**只有 `co-writer-engine`** 在每轮前调 `reloadIfChanged`，
   其余 5 处（`step-runner` / `mode-injection` / `asset-registry` / `polish-editor` / `prompt-builder`）都不调

对照：`KnowledgeVectorStore.search` 有 `ensureLoaded()` 自愈，指纹库没有——属于**设计不一致**。

**修复**：`getEnabledFingerprints` 读取前先 `reloadIfChanged`（内部按文件签名比对，未变化时快速返回），
加载失败时退回内存数据并 warn，不阻断读取。所有消费方不必再各自记得先 reload。

**测试**：新增 5 条（新建实例直接读能拿到项目/全局指纹、另一实例禁用后自动同步、
重复读取幂等、坏文件不阻断）。旧实现在第 1 条即失败。

---

## 三、核查后确认「不是缺陷」的设计（避免误判）

| 项 | 核查结论 |
|---|---|
| template 层不参与注入 | ✅ 明确设计，三处 UI 一致隐藏控件并给提示 |
| global 层默认启用 + 项目覆盖 | ✅ 设计完整：`isGlobalEnabledForProject` 优先读项目覆盖表，缺省回落到指纹自身 `enabled` |
| 复制/提升是否 id 冲突 | ✅ `copyFingerprint` 用 `generateId()` 生成新 id，跨层不会串味 |
| 知识库检索新鲜度 | ✅ `search` 内部 `ensureLoaded()` → `reloadIfChanged()` |
| 同人设定读取新鲜度 | ✅ `co-writer-engine` 每次生成前 `readFanficRulesFromFS` 重读；UI 侧 `readFanficRules` 也是每次读文件 |
| 知识库→指纹转换 | ✅ 风格拆解缺失**抛错**不静默；samples 只用真实原文（注释明确拒绝拆解报告段落，避免模型模仿「分析报告腔」）；强制 `scope: 'project'` |

---

## 四、记录但未改动的设计问题（需产品决策）

### D1｜全局指纹的「强度配置」按项目存储

`loadIntensityConfigs(targetProject)` 只读
`pjControlDir(project)/.../intensity.json`（**项目级**文件）。

后果：给一个**全局指纹**配好强度后，切到另一个项目会回退默认值（`globalIntensity = 1.0`）。

**为什么不直接改**：
- 需要新增全局强度文件或"全局默认 + 项目覆盖"的两级结构
- 涉及数据迁移（现有项目级配置如何映射）
- 属于产品决策：全局指纹的强度**应该**是全局统一，还是允许按项目微调？两者都合理

**建议**：如果决定改，采用「全局默认 + 项目覆盖」两层（与 global 指纹的启用状态同构），
复用 `globalFingerprintStates` 的模式。

---

## 五、三条链路的新鲜度对照（本次审计的核心结论）

| 链路 | 数据读取方式 | 新鲜度机制 | 结论 |
|---|---|---|---|
| 知识库 | 向量库内存表 | `ensureLoaded()` 自愈 | ✅ 自愈 |
| 同人设定 | 每次读 Markdown 文件 | 每次生成前重读 | ✅ 天然新鲜 |
| **指纹** | 内存三张表 | **原：依赖调用方手动 reload** | ❌ **已修为自愈** |

**规律**：三条链路里，只有指纹把「刷新」的责任推给了调用方，而调用方有 5 处没履行。
凡是「读共享内存 + 由调用方负责刷新」的设计，都应当改为**读取前自愈**——
这是本次审计最有迁移价值的一条结论。

---

## 六、可复现命令

```powershell
cd .obsidian/plugins/novel-writer-ai
# 三层结构
Select-String -Path engine/style-fingerprint-library.ts -Pattern 'getEnabledFingerprints|isGlobalEnabledForProject'
# 消费方是否 reload
Select-String -Path engine/*.ts,ui/**/*.ts -Pattern 'reloadIfChanged|getEnabledFingerprints'
# template 是 source-only 的设计依据
Select-String -Path ui/fingerprint-utils.ts -Pattern 'isSourceOnlyFingerprintScope'
```
