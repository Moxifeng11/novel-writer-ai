# 拆解引擎设置分区（settings / deconstruction-section）

> 状态：stable（视觉重构 Slice Y 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：设置页「高级 → 🧬 拆解引擎」分区 —— 顶部一句话说明，其下五张卡：🎯 增强级别（默认质量级别下拉 + 低质量自动升级开关）、🧩 拆解维度（八维开关网格 + 商业/可读性两个补充开关）、🧠 向量增强（开关 / 模型名 / 缓存大小 / 批处理大小）、🤖 LLM 增强 · 实验性（警示条 + 开关 + 模型名）、⚙️ 性能（最大并发 / 采样模式 / 文本采样上限），底部右侧「↩️ 恢复默认」。
- **代码入口**
  - `ui/settings/deconstruction-section.ts`（336 行，CRLF 行尾）。`export class DeconstructionSection extends SettingsSection`（`:21`），`readonly asyncLoad = true`（`:23`，宿主会加统一「数据可能过期 · 刷新」条）。
  - `getDeconstructionEngineSettings()`（`:25`）：与 `DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS` 合并并把结果写回 `plugin.settings.deconstructionEngine`；`enabledDimensions` 为空时回落默认。
  - `ensureDeconstructionEngineSettingsPersists(update)`（`:42`）：改完立即 `plugin.saveSettings()`。
  - `render(container)`（`:53`）：同步渲染整页。
  - 装配：`ui/settings/section-factory.ts:71` `{ id: 'deconstruction', label: '🧬 拆解引擎', group: 'advanced', create: host => new DeconstructionSection(host) }`；分组见同文件 `:54`。
- **数据来源**：`plugin.settings.deconstructionEngine`（`DeconstructionEngineSettings`，类型在 `main.ts`）；维度清单 `ALL_BREAKDOWN_DIMENSIONS` / `DIMENSION_LABELS` 来自 `@/main`，`DIMENSION_DESC` 是本文件内的局部表（`:106`）。无自有状态、无异步读盘（`asyncLoad` 只影响宿主刷新条）。
- **样式**：新建 `styles-src/41-settings-deconstruction.css`（1640 字节 / 62 行 / 7 个选择器：`nw-st-dc-card` / `-card-title` / `-note` / `-note--warning` / `-dim-grid` / `-reset-row` / `button.nw-st-dc-reset-btn`），样式源 46 → **47**。**不套 `.nw-scope`**（与 Slice R 的 `36-settings-general.css`、Slice U 的 `38-settings-knowledge.css` 一致：设置页整体不在 scope 容器内）。

## 2. 现状（事实，不写愿望）

- **外壳**：`render` 先 `container.createEl('section')` → `h3`「🧬 拆解引擎」→ `p.setting-item-description` 说明文字（这两处没有工具类，本轮未动）。
- **五张卡共用同一个类**：`nw-st-dc-card`（`:64/:96/:161/:224/:262`）。改前是同一串 5 个工具类：`nw-u-p-12px-16px nw-u-b-1px-solid-background-m nw-u-brd-6px nw-u-marginbottom-16px nw-u-bg-background-secondary`，即 padding 12px 16px / border 1px `var(--background-modifier-border)` / radius 6px / margin-bottom 16px / background `var(--background-secondary)`。
- **卡标题**：`h4.nw-st-dc-card-title`（margin 0 0 12px 0；font-size 14px），五张卡一致（`:66/:98/:163/:228/:264`）。
- **说明文字**：维度卡「选择默认启用的拆解维度…」用 `nw-st-dc-note`（12px / muted / margin-bottom 10px，`:101`）；LLM 卡警示条用 `nw-st-dc-note nw-st-dc-note--warning`（`:232`，额外一条 `color: var(--text-warning)`）。
- **维度网格**：`dimList` = `nw-st-dc-dim-grid`（`:104`，display grid / `repeat(auto-fill, minmax(180px, 1fr))` / gap 6px）。**八个维度恒渲染八行**（`ALL_BREAKDOWN_DIMENSIONS.forEach`），开关状态只影响 toggle 是否勾选，不影响 DOM 数量。
- **每维设置行**：`new Setting(dimList)` 后 `item.settingEl.addClass('nw-settings-inline-item')`（`:133`，`styles-src/26-cleanup-utilities.css:372` = padding 6px 0 + border-bottom none），这是既有外壳类，本轮未动。
- **底部**：`nw-st-dc-reset-row`（`:314`，flex / justify-content flex-end / margin-top 12px）内一颗 `button.nw-st-dc-reset-btn`（`:317`，padding 6px 16px / cursor pointer / border 1px `var(--background-modifier-border)` / radius 4px / font-size 13px / background `var(--background-primary)`）；点击先走 `OperationConfirmModal.confirm`，确认后重置并 `this.refresh()`。
- **数值回写**：四个滑块（缓存大小 / 批处理大小 / 最大并发）与文本采样上限在 `onChange` 里就地更新 `.setting-item-description` 文案（`:202/:218/:277`），不重绘整页。
- **历史包袱（Slice Y 处理前）**：47 处 `nw-u-*` 工具类（16 行） + 1 处内联 `style`（恢复默认按钮的 `attr: { style: '...' }` 整串）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| SY-01 | P0 | 47 处 `nw-u-*` 拼出五张卡的全部排版，语义不可读；同一串 5 个类在五处重复 | 合成 `nw-st-dc-card` + 6 个语义类，集中到 `41-settings-deconstruction.css` | done（Slice Y） |
| SY-02 | P1 | 「恢复默认」按钮把 6 条声明塞在 `attr.style` 字符串里，主题无法覆盖 | 改 `cls: 'nw-st-dc-reset-btn'` + `button.nw-st-dc-reset-btn` 元素限定规则 | done（Slice Y） |
| SY-03 | P1 | 说明文字与警示条只有颜色不同，靠工具类串区分 | 基类 `nw-st-dc-note` + 修饰类 `--warning` | done（Slice Y） |
| SY-04 | P2 | 卡片标题 `nw-u-m-0-0-12px-0 nw-u-fs-14px` 是排版工具类 | `nw-st-dc-card-title` | done（Slice Y） |
| SY-05 | P2 | 维度网格的 `repeat(auto-fill, minmax(180px, 1fr))` 藏在 `nw-u-gtc-repeat-auto-fill-minma-5` 这种被截断的名字里 | `nw-st-dc-dim-grid` 显式声明 | done（Slice Y） |

## 4. 关键决策

- **2026-11-17 前缀取 `nw-st-dc-*`**：设置页已有 `nw-st-*`（Slice R）与 `nw-st-kb-*`（Slice U）两族，拆解引擎属于设置页 `nw-st-*` 命名空间下的子域，取 `dc`（deconstruction）短名；全仓零碰撞。
- **2026-11-17 五张卡合成一个类**：原本五处逐字重复同一串 5 个工具类，合并成 `.nw-st-dc-card` 后声明逐条按被删工具类实际生效值复刻（padding / border / radius / margin-bottom / background），像素验收 3/3 零差异。
- **2026-11-17 按钮必须元素限定**：旧实现是 `attr.style`，特异性等同 inline，能压过 Obsidian 自带 `button` 规则；改成裸类会被压掉，所以写 `button.nw-st-dc-reset-btn`（与 Slice R/Slice U 结论一致）。
- **2026-11-17 警示条用修饰类而不是第二个基类**：`nw-st-dc-note--warning` 只加一条 `color`，其余几何继承基类，避免两份重复声明漂移。
- **2026-11-17 不新建「拆解引擎视图」样式**：本分区只有设置页形态，没有独立的视图/弹窗，因此单开一个 41 号文件即够，不往 `27-knowledge-base.css` 里塞（它与知识库视图无关）。

## 5. 验收记录

| 日期 | 项 | 结果 |
| --- | --- | --- |
| 2026-11-17 | `npx tsc --noEmit` | EXIT 0 |
| 2026-11-17 | `npm run build` | `[styles] 拼接 47 个源文件 → styles.css（31547 行）`；esbuild v4.96.1 成功 |
| 2026-11-17 | 单测 | `npx vitest run tests/unit/ui/settings-framework-wiring.test.ts tests/unit/ui/settings-no-duplicate-render.test.ts tests/unit/ui/settings-search.test.ts` → 3 files / 39 用例通过 |
| 2026-11-17 | 像素（3 场景 before/after） | PNG **3/3 = 0 px**；probes（各 166 元素）struct 0 / style 0 / rect 0，仅 15 个类串改名 |
| 2026-11-17 | 门禁 | `check:inline-styles` 526→**525**；`check:utility` 55/189→**46/142**（删 9 个零引用类，零引用 0）；`check:css` bytes **786456** / 31548 行 / uniqueClasses **4261** / hex 192 / rgbHsl 223；`check:bundle` main.js **5625149** / styles.css **786456** |
| 2026-11-17 | `npm run preflight` | EXIT=0：959 文件 / 10118 通过 + 3 skipped；check:release 通过（v4.96.1） |

## 6. 测试清单

- `tests/unit/ui/settings-framework-wiring.test.ts:43`：只校验 `ui/settings/deconstruction-section.ts` 被 section-factory 装配，不断言类名 —— 本轮改名对它无影响。
- `tests/unit/ui/settings-no-duplicate-render.test.ts` / `settings-search.test.ts`：设置页整体行为（重复渲染、搜索索引），与类名无关。
- **没有**针对本分区的 DOM 渲染单测；视觉等价完全靠 before/after 像素验收（3 场景）兜底。
- 实机检查点：五张卡的 padding/border/背景一致、维度网格 4 列（760px 宽时）、LLM 警示条为 warning 色、恢复默认按钮外观与改前一致、滑块拖动后描述文案就地更新。

## 7. 剩余 backlog（P2/P3）

- [ ] 八个维度恒渲染八行（未启用的只是 toggle 未勾选），可考虑只渲染启用项 + 「更多维度」折叠；会改变布局，需单独验收。
- [ ] 四个滑块的「当前: N」文案靠 `onChange` 里就地改 `.setting-item-description`（三处重复的 `closest/querySelector` 逻辑），可抽小助手。
- [ ] 「恢复默认」只重置 `deconstructionEngine`，不动知识库其余设置；文案已写「所有自定义配置将丢失」，容易误解为全局重置，建议改成「拆解引擎所有配置」。
- [ ] 分区没有 DOM 单测，建议补一条「渲染出五张卡 + 八个维度开关 + 恢复默认按钮」的结构断言，防止将来再次改名时静默漂移。
- [ ] LLM 卡标注「实验性」，但开关与模型名在 `deep` 级别之外也可独立开启，缺少联动校验。

## 8. 交接备注

- **下一轮从哪开始**：本切片之后 `nw-u-*` 存量是 **46 个定义 / 142 次引用**（零引用 0），已无「存量大户」——长尾转「碰哪改哪」（新代码禁止新增 `nw-u-*`，由 `check:utility` 的零引用检查与评审把关）。
- **已知坑（本轮新踩）**
  1. **「八个维度恒渲染」会让场景数据看起来没生效**：截图脚本里改 `enabledDimensions`，DOM 元素数（166）与高度（1869）完全不变，只有 toggle 勾选状态变 —— 别把「尺寸没变」当成数据没注入，要 dump `input[type=checkbox]` 的 checked 或 `.setting-item-name` 列表确认。
  2. **设置分区可以绕过整页渲染**：`plugin.settingsTab.sections.get('deconstruction') || plugin.settingsTab.getSection('deconstruction')`（TS private 运行时可达）拿到实例后直接 `sec.render(host)`，不必开真设置弹窗；宿主沿用 `vertical-tab-content nw-settings-root nw-settings-tab-content` 三件套，`15-late-fixes.css` 的 `.nw-settings-tab-content .setting-item` 保护才会命中。
  3. **`attr: { style }` 也算内联样式**：`check:inline-styles` 把它计进 static；删掉这处后基线 526 → 525。
  4. **`style:` 字符串会假阳性**：本文件 `DIMENSION_DESC` 里有 `style: '分析文笔风格与语言特色'`，grep `style:` 会命中，实际是数据字段。
- **仓外临时脚本（勿提交）**：`D:\nw-tmp\snap-y.mjs`（before/after 采集，`--tag=`，产物 `D:/nw-dev-vault/_visual-y/<tag>/{png,probes.json}`）、`D:\nw-tmp\diff-y.mjs`（PNG + 探针对比，ROOT=`D:/nw-dev-vault/_visual-y`）。before 侧走 `git worktree add D:/nw-tmp/before-y 7fe79291` + node_modules junction + `npm run build`。
- **dev vault**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 是**真实目录**（不是 junction），每轮截图前手工 `Copy-Item main.js,styles.css` 过去。
