# 新手向导（Full Writer Wizard）

> 状态：stable　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：新建项目后的分步引导——从「故事结构」一路到「批量建章 / 完成」。
  原创 8 步、同人 9 步（同人第一步是「原作设定导入」）。
- **代码入口**
  - 外壳与流程控制：`ui/full-writer/wizard-controller.ts`（容器 `:186` `.nw-wizard-container`、
    内容区 `:225` `.nw-wizard-content-area`、步骤区 `:246` → 调渲染器）
  - 步骤渲染：`ui/full-writer/wizard-step-renderers.ts`（9 个 `renderWizard*Step(container, tab)`）
  - 步骤定义 / 类型：`ui/full-writer/wizard-types.ts`（`buildWizardSteps(projectType)`、
    `WizardTab`、`WizardStep`、`WizardStepStatus`）
  - 完成度校验：`ui/full-writer/wizard-checker.ts`
  - 构造/装配：`ui/full-writer-view.ts`（`:675` `new WizardStepRenderers(...)`）
  - 样式：`styles-src/30-wizard-steps.css`（Slice J 新增，`nw-wizard-*`）
- **相关数据**：项目目录下的 `01-设定/`、`02-大纲/`、`03-章节/`；进度状态在内存
  （`wizardStepResults`、`wizardStepExecuting`），切走再回来按项目文件重建。

## 2. 现状（事实，不写愿望）

- `wizard-controller` 负责左侧步骤条 + 右侧内容区；右侧每个步骤由 `wizard-step-renderers`
  的对应方法渲染，方法统一是 `async renderWizard<Step>Step(container: HTMLElement, tab: WizardTab): Promise<void>`。
- **真实祖先链只有两级**：`.nw-wizard-container` > `.nw-wizard-content-area` > stepContent。
  TS 里从未应用 `nw-wizard-root`（`04-workspace-layers.css` 里的相关规则是死选择器），
  所以向导侧样式统一用 `.nw-wizard-content-area ` 前缀拿到 (0,2,0) 特异性。
- 生成类步骤（世界观 / 设定库 / 实体）有「执行中」分支：按钮禁用 + 进度条 +
  `wizardStepExecuting` 集合标记；进度文案来自 `wizardStepResults['_worldviewProgress']` 之类。
- 历史包袱：本文件原先大量使用 `nw-u-*` 工具类 + 11 处内联 `style` 字符串；
  且工具类对 `<button>` 的 `background/color` 会被 Obsidian 自带 `.modal button`（0,1,1）压掉，
  实际渲染成白底黑字（设计意图是强调色 / 警告色）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| W-01 | P1 | 渲染器用 62 个 `nw-u-*` 工具类拼样式，语义不可读 | 语义类 `nw-wizard-*` | done（Slice J） |
| W-02 | P1 | 11 处内联 `style` 字符串（按钮/输入框） | 全部进样式表 | done（Slice J） |
| W-03 | P1 | 按钮背景/文字色被 Obsidian 规则压掉，白底黑字 | 恢复设计意图（强调色/警告色） | done（Slice J） |
| W-04 | P2 | 进度条 `animation: nw-progress-anim` 在 utility 类里，keyframes 定义在 09 号文件 | 语义类直接声明动画 | done（Slice J） |

## 4. 关键决策

- **2026-11-17（Slice J）**：沿用既有 `nw-wizard-*` 命名空间（不是新造前缀），新增
  `styles-src/30-wizard-steps.css`；选择器统一加 `.nw-wizard-content-area ` 前缀。
  理由：向导区没有 `.nw-scope` 祖先，而单类 (0,1,0) 打不过 Obsidian 的
  `.modal button` / `input[type=text]` (0,1,1)——Slice H 在批处理弹窗上已经踩过同一个坑。
- **不复用 `.nw-wizard-btn-primary`**：既有定义是 `padding:10px 20px / font-size:14px / var(--nw-accent)`，
  而向导内联按钮是 `6px 14px`，复用必改像素，故单独建 `nw-wizard-primary-btn` 等按钮族。
- **按钮配色按设计意图恢复**：before 的白底黑字是级联事故（工具类被压掉），
  不是设计；所以 after 的强调紫/警告橙是有意差异，已在像素报告中标注。
- **表单分组保持 `display:block`**：改成 flex 会把内部 `input`（inline-block）块化，
  丢掉基线留白，整张同人表单矮 13px（实测 394.9px → 382px）。

## 5. 验收记录

| 日期 | 操作 | 结果 | 证据 |
| --- | --- | --- | --- |
| 2026-11-17 | Slice J 语义化 + 像素校正（13 个场景） | 9 个场景 0px；4 个仅按钮配色差异（设计意图）；表单结构 0 差异 | `D:\nw-dev-vault\_visual-j\{before,after,diff}`；计算样式逐节点 diff 仅剩 color/bg/border |
| 2026-11-17 | 门禁 | typecheck / lint / inline-styles / utility / css / bundle / preflight 全绿 | preflight EXIT=0 |

## 6. 测试清单

- 纯逻辑：`tests/unit/ui/wizard-step-logic.test.ts`（步骤推进/校验）
- 动画完整性：`tests/unit/ui/css-animation-integrity.test.ts`（断言 `.nw-wizard-progress-bar` 带 `nw-progress-anim`）
- 回归：`tests/unit/ui/pure-helpers-coverage.test.ts`
- 实机：reload 后检查——原创/同人两套步骤条、生成中（按钮禁用 + 进度条动画）、
  实体页（生成/继续生成/实体管理按钮）、完成页统计表。

## 7. 剩余 backlog（P2/P3）

- [ ] 步骤条左侧（`nw-wizard-step-*`）仍在 03/04/12 号文件里，未纳入 30 号文件统一管理。
- [ ] 实体页的深色卡片（`.nw-wizard-entity-row`）配色偏重，可考虑跟主题令牌对齐。

## 8. 交接备注

- 改渲染器文案/结构时注意：9 个方法签名一致，新增步骤要同步 `buildWizardSteps` 与
  `wizard-controller` 的分支。
- 实机截图要在开发 vault（`D:\nw-dev-vault`）里做；向导读项目文件，先
  `plugin.createExampleProjectNow()` 造「示例项目」。
