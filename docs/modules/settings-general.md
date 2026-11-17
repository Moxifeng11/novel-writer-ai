# 设置页「通用」分区（general-sections）

> 状态：stable（视觉重构 Slice R 完成 2026-11-17）　｜　最后更新：2026-11-17　｜　Owner：dsh

## 1. 定位

- **用户视角**：Obsidian 设置 → 本插件中属于「通用/运维」的五个分区：📈 性能监控、📜 写作规则、ℹ️ 关于（版本 / 更新 / 支持作者 / 热重载）、🎭 角色识别、💡 建议设置。分区在设置侧栏里按 `section-factory.ts` 注册。
- **代码入口**
  - 全部五个分区：`ui/settings/general-sections.ts`（1257 行）。`PerformanceSection`（`:35`）、`RulesSection`（`:399`）、`AboutSection`（`:580`）、`RecognitionSection`（`:884`）、`SuggestionsSection`（`:1174`）。
  - 注册：`ui/settings/section-factory.ts:66`（recognition）、`:67`（suggestions）、`:73`（rules）、`:77`（performance）、`:80`（about）；分组见 `:56` 的 `ops`（projects / performance / about）。
  - 设置页宿主：`ui/settings-tab.ts`（侧栏、搜索、panelCache）；每个分区继承 `ui/settings/section-base.ts` 的 `SettingsSection`，由宿主传 `host`（`{ app, plugin, refresh(), reopen() }`）。
  - 性能报告弹窗：`PerformanceSection.showPerformanceReport(text)`（Modal + `textarea.nw-st-report-textarea`）；更新横幅：`PerformanceSection.renderBanner(host)`（不是 AboutSection 的方法）。
- **数据来源**：`plugin.settings`（监控开关、建议开关、角色识别阈值等）；`performanceMonitor`（`services/performance-monitor.ts`：内存 / 统计 / 慢操作 / 日志，日志上限 1000 条）；`plugin.engineRegistry.getOrNull(ENGINE_NAMES.UPDATE_CHECKER)` 取 `getUpdateLastResult()` / `getUpdateLastCheck()`；规则文件由 `RulesSection.mountRulesSection()` 读取。
- **样式**：`styles-src/36-settings-general.css`（380 行 / 9596 字节，41→42 个样式源），类前缀 `nw-st-`，**不加 `.nw-scope`**；按钮与文本框用元素限定选择器（`button.nw-st-*` / `textarea.nw-st-*`）。保留的壳类：`nw-settings-section`、`nw-h4-section`、`nw-empty-info-card`、`nw-status-row` / `nw-status-label`、`nw-settings-actions`、`nw-btn` 系、`nw-text-error`、`nw-support-author-*`、`setting-item-description`。

## 2. 现状（事实，不写愿望）

- **性能监控**：`h4.nw-h4-section` + `p.nw-st-lead` → 开关（原生 Setting）→（关闭时）`nw-empty-info-card nw-st-card-spaced nw-st-card--center` 空态卡 + `nw-st-muted-nowrap` →（开启时）`nw-st-stat-grid`（4 张 `nw-st-stat-card`，各含 `nw-st-stat-label` / `nw-st-stat-value`）→ `table.nw-st-table`（总体统计）→ 分类统计表 → 慢操作表 → `nw-st-scroll-box nw-st-scroll-box--tall` + `nw-st-scroll-item`（最近日志）→ `nw-st-btn-row`（`button.nw-st-btn` / `--danger` 清空 / `--lg` 生成报告）。
- **更新横幅**：`nw-st-update-banner`（渐变底）→ `nw-st-update-left`（`-title` / `-note`）+ `nw-st-update-actions`（`button.nw-st-banner-btn` 下载、`--ghost` 忽略）。
- **写作规则**：三种态共用 `nw-st-notice`（`--warning` / `--success`）+ `nw-st-lead--spaced`；操作行 `nw-st-btn-row`（`nw-btn` 系按钮）。
- **关于**：`nw-st-card`（版本卡：`nw-st-label` + `nw-st-version` + `nw-st-meta` + `nw-st-info-grid`（`nw-st-info-item` / `-label` / `-value`））→ `nw-st-btn-row nw-st-btn-row--mb24`（`button.nw-st-btn--primary --lg --fw500` 检查更新、`button.nw-st-btn--lg --bg-primary` 更新日志）→ 支持作者卡（壳类 `nw-support-author-*` + `nw-btn nw-btn-primary`）→ 热重载卡（`nw-st-about-card` + `nw-st-about-p` / `nw-st-about-line` + `nw-st-btn-row`）→ 说明段 `nw-st-lead` + `nw-st-strong`。
- **角色识别 / 建议设置**：以原生 `Setting` 控件为主，语义类只有 `nw-st-lead` / `nw-st-btn-row` 等少量排版类（`SuggestionsSection` 在本切片前就没有 `nw-u-*`）。
- **报告弹窗**：`modal` → 说明 `nw-st-lead` → `textarea.nw-st-report-textarea`（w100% / h400 / monospace / 12px）→ `nw-st-btn-row nw-st-btn-row--end`（`button.nw-st-btn` 复制、`button.nw-st-btn--primary` 关闭）。
- **历史包袱（Slice R 处理前）**：160 处 `nw-u-*`、11 处内联样式（全部是 `attr: { style: '...' }`）。

## 3. 问题清单

| 编号 | 级别 | 现象 | 期望 | 状态 |
| --- | --- | --- | --- | --- |
| SG-01 | P0 | 160 处 `nw-u-*` 拼出五个分区的全部排版，语义不可读 | 语义类 `nw-st-*` 集中到 `styles-src/36-settings-general.css` | done（Slice R） |
| SG-02 | P1 | 11 处 `attr: { style: ... }` 内联样式（按钮 4 类、文本框 2 类、卡片/横幅/提示条） | 全部改 `cls:` + 语义类 | done（Slice R） |
| SG-03 | P1 | 按钮背景被工具类与 Obsidian 默认样式交叉覆盖（白底 / `--background-secondary` 混用） | 基类 + 修饰类，必要时元素限定；个例再加 `--bg-primary` | done（Slice R） |
| SG-04 | P2 | 同名类承担两套不同声明（`nw-st-btn-row--end` 与 `--mb24` 的 `flex-wrap` 不同） | 基类保留归纳值，差异用修饰类覆盖 | done（Slice R） |
| SG-05 | P2 | 五个分区零引用工具类残留，`check:utility` D 项会拦 | 删 23 个零引用 `nw-u-*` 定义 | done（Slice R） |

## 4. 关键决策

- **前缀 `nw-st-*`，不加 `.nw-scope`**：设置页不在 Modal 里（`ui/settings/writing-sections.ts:545` 直接往 section 渲染），与 Slice N 的提示词管理一致。作用域靠 `nw-settings-section` 祖先，不引入新命名空间。
- **按钮必须元素限定**：`.modal button`、Obsidian 默认 `button` 样式都是 (0,1,1)，单类 `.nw-st-btn` 只有 (0,1,0) 会被压掉 background/color（Slice L 的编辑弹窗就是这样变白底黑字）。所以写 `button.nw-st-btn, .modal button.nw-st-btn`——设置页与报告/更新日志弹窗共用同一套规则。
- **基类只收「多数派」声明，差异一律用修饰类**：三处真实偏差都是像素验收抓出来的，改前靠读内联样式看不出来：
  1. 「📜 更新日志」按钮原内联是 `background: var(--background-primary)`，而 `button.nw-st-btn` 基类给的是 `--background-secondary`（浅色主题 `#f6f6f6`，卡片是 `#ffffff`）→ 新增 `--bg-primary` 修饰类专供「与强调按钮并排的次要按钮」。
  2. 更新横幅的 ghost 按钮原内联**没有** `font-weight`，而基类写了 600 → `--ghost` 显式补 `font-weight: 400`。
  3. 报告弹窗底部 `nw-st-btn-row--end` 原内联不带 `flex-wrap`，基类有 `wrap` → `--end` 显式 `flex-wrap: nowrap`（`--mb24` 那条内联本来就带 wrap，保持基类）。
- **`nw-st-about-card` 独立成类，不并入 `nw-st-card`**：关于页两张卡的原内联没有 `margin-bottom: 20px`，合并会让页面多出空隙；语义类宁可按「声明并集」拆分，也不为了类名少而合并。
- **数值/状态不用内联色**：慢操作耗时用 `nw-st-duration`（`color: var(--text-error)`），提示条三态用 `--warning` / `--success` 修饰类；所有颜色都在 CSS。
- **删 23 个零引用工具类**：五个分区是最后一批使用者（`nw-u-p-10px-12px`、`nw-u-p-14px-18px`、`nw-u-h-400px`、`nw-u-resize-none`、`nw-u-fs-32px`、`nw-u-bg-linear-gradient-135deg-3`、`nw-u-fontfamily-monospace` 等）。删除后 `check:utility` 的 D 项从 23 个死定义归零；定义 185→162、引用 988→828。
- **两个 `style` 假阳性不处理**：性能页的 `wr.style` / `writing_style.style` 是数据字段（写作风格文本），不是内联样式；内联样式按 `attr: { style: ... }` 口径统计（改前 11 处）。

## 5. 验收记录（Slice R，2026-11-17）

截图：`D:\nw-dev-vault\_visual-r\{before,after}`，`diff-report.json`（`node D:\nw-tmp\diff-r.mjs` 生成）含像素与探针对比。宿主是自建 760px 宽 `.vertical-tab-content nw-settings-root` 容器（`#nw-r-host`），`plugin.settingsTab.containerEl = host; plugin.settingsTab.display()` 走真实渲染路径。

| 场景 | 尺寸 | PNG 差异 | 探针 |
| --- | --- | --- | --- |
| 01-perf-data（14 条确定性日志） | 760×1810 | 0 px | struct/style/rect 0 |
| 02-perf-off（空态卡） | 760×831 | 0 px | 0 |
| 03-rules（无规则文件 → 警告态） | 760×1238 | 0 px | 0 |
| 04-about（版本/按钮/支持作者/热重载） | 760×1547 | 0 px | 0 |
| 05-recognition | 760×1461 | 0 px | 0 |
| 06-suggestions | 760×638 | 0 px | 0 |
| 07-banner（更新横幅 664×67） | 664×67 | 0 px | 0 |
| 08-report-modal（性能报告弹窗 640×549） | 640×549 | 0 px | 0 |

- 探针：`struct` 差全 0、`rect` 差全 0（零位移）、`style` 差全 0；`cls` 差 62/3/7/21/4/0/7/4 = 108 条，全部是改名的预期差异。
- **第一轮曾出现 3 处偏差**（about 按钮底色、banner ghost 字重、报告弹窗按钮行 wrap），修完重跑后全部归零；三条已写进 §4。
- **同一提交附带**：三处装饰性 `catch {}`（缓存统计 / 更新横幅 / 版本信息）补 `// silent-ok: 理由` 显式豁免——`check:silent-failures` 的写上下文窗口因本次行变更把第三处扫了进来，豁免后基线 191 → 188（`.silent-failures-baseline.json`），没有改行为。
- **数据噪声的处理**：性能页的耗时/内存原本每轮都不同（`130.10ms` vs `130.00ms`、`71.46 MB` vs `60.92 MB`），首轮 01 场景差 1322 px（0.096%）。截图脚本改用「`Object.defineProperty(performance,'memory',...).` 固定内存 + `importLog(JSON.stringify(entries))` 固定耗时」后，两边数据完全一致，01 归零。

## 6. 测试清单

- `tests/unit/ui/settings-sections-dom.test.ts`（10 条，文案/DOM 结构；不断言类名，本切片无需改动）
- `tests/unit/ui/settings-no-duplicate-render.test.ts`（重复渲染防护）
- `tests/unit/ui/settings-framework-wiring.test.ts`（分区注册与跳转）
- `tests/unit/ui/metrics-format.test.ts`（从 `PerformanceSection` 抽出的耗时/内存格式化纯函数）
- 本轮复跑：`npx vitest run` 上述 4 个文件 → **53 tests 通过**。

## 7. Backlog

- 五个分区仍在同一个 1257 行文件里：按分区拆 `performance-section.ts` / `rules-section.ts` / `about-section.ts`。
- `RecognitionSection` 的阈值控件与图片上限常量重复维护，可收敛到一处。
- 性能页表格在窄窗口（<640px）会横向溢出，需要给 `nw-st-table` 加外层滚动容器。
- 「重新检查」已收敛到容器级重绘（`mountRulesSection`），但按钮 loading 只靠 `disabled` + 文案，缺 spinner。

## 8. 交接备注（下一位必读）

- **像素脚本**：`D:\nw-tmp\snap-r.mjs`（`--tag=after|before`），依赖临时钩子：`services/performance-monitor.ts` 末尾的 `// TEMP-SNAP-HOOK`（把实例挂到 `window.__nwPerf`）。**已在本切片提交前删除**；要重跑得先加回钩子再 `npm run build`。
- **对比脚本**：`D:\nw-tmp\diff-r.mjs`（`ROOT=D:/nw-dev-vault/_visual-r`）。注意它修的坑：探针字段是 `st`，不是 `s`；`diff-q.mjs` 因为读错字段，style 对比永远是 0。
- **dev vault 产物同步必须手拷**：`D:\nw-dev-vault\.obsidian\plugins\novel-writer-ai` 是真实目录（不是 junction），`npm run build` 只写仓内产物；每次截图前 `Copy-Item main.js,styles.css` 过去，否则截图拿到的是旧代码。
- **设置弹窗不在主 document**：`app.setting.open()` 的 `.modal-container` 数为 0，必须自建容器 + `settingsTab.containerEl = host` + `display()`；切 tab 前 `panelCache.clear()`，否则复用旧 DOM。
- **报告弹窗定位**：`.modal-container` 里可能有残留的「信任仓库作者」弹窗，要用「含 `textarea` 的容器」筛，不能取第一个 `.modal`。
