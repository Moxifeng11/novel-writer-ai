# settings-tab-regroup-fix：设置 6 分组一级 tab 不显示 — 定位与修复报告

- 日期：2026-11-14
- 任务来源：dsh 派单（任务板 `settings-tab-regroup-fix`；信箱「任务派发：设置 6 分组一级 tab 不显示（已提交但不生效）」）
- 前置提交：31bda235（结构）+ 7dcb3c75（样式）+ 6b1009e0（CSS 基线）——门禁全绿但界面不生效
- 修复提交：见台账第 155 轮

## 一、症状

用户在 Obsidian（1.14.5）打开「设置 → Novel Writer AI」：只见「📖 设置」标题 → 一个黑色空块 → 「模型设置」内容。**没有一级分组栏（6 个 pill），没有二级 tab 栏**。重开设置、reload 插件均无效。

## 二、根因：两层问题叠加

### 根因 ①（产品缺陷，本轮修复）：`renderBars` 首屏从未被调用

`ui/settings-tab.ts` 的 `display()` 在 31bda235 重构时，把 `renderBars()`（渲染 6 个一级分组 pill 与二级 tab）**只挂在了分组 pill / tab / 高级折叠 toggle 的 click 回调里**；`display()` 本体创建了 `groupBar` / `tabBar` 两个空 div 后直接 `renderActiveTab(true)` 渲染内容区——初屏没有任何点击，因此：

- `groupBar` = 空 div（6 个 pill 不存在，点击处理器也不存在）
- `tabBar` = 空 div（二级 tab 不存在）
- 内容区仍渲染当前 tab（api）→ 正是用户看到的「标题 → 空块 → 模型设置」

修复：`display()` 末尾、`renderActiveTab(true)` 之前主动调用一次 `renderBars()`。该处一行即修复；单测 `tests/unit/ui/settings-tab-groups.test.ts`（7 例）锁定——git stash 暂存修复实测 6/7 例转红（`expected [] to have a length of 6 but got +0` 即缺陷本体），恢复后全绿。

### 根因 ②（取证环境，dsh CLI 取证假阴性的原因）：Obsidian 1.14 把 Modal 渲染到独立窗口

`tests/e2e/utils/obsidian-app.ts` 的 `waitForModalPage` 注释已记录：**Obsidian 1.14 会把 Modal 渲染到独立的 about:blank 窗口，而不是主工作区页面**。设置弹窗同样如此：

- 主页面 `document.querySelectorAll('.nw-settings-group')` **永远为 0**——即使修复已生效
- `app.setting.pluginTabs` 条目（即 tab 实例）的 `containerEl` 会被收养进弹窗窗口的 document，主页面里 `document.contains(containerEl) === false`
- 首次启动还有插件的欢迎弹窗（`ui/welcome-modal.ts`，`.nw-modal`）可能与设置弹窗同窗叠加，进一步干扰判定

因此此前「CLI 侧 querySelector 全部为空」**不能作为界面未生效的证据**——量具看错了窗口。本轮 E2E 用 `waitForSettingsPage`（签名：`.vertical-tab-nav-item`，与欢迎弹窗区分）拿到承载窗口后再断言。

## 三、修复内容

| 文件 | 变更 |
| --- | --- |
| `ui/settings-tab.ts` | `display()` 在 `renderActiveTab(true)` 前主动调用 `renderBars()`（一行修复 + 注释说明） |
| `tests/unit/ui/settings-tab-groups.test.ts` | 新增 7 例：① 初屏 6 个 pill 与文案/顺序/激活态 ② 初屏二级 tab 仅 api（高级折叠）③ 点击分组真实切换（click 回调路径）④ 高级 toggle 展开与收起 ⑤ 折叠隐藏当前 tab 后 display() 回退组内首个可见 tab（accept ③）⑥ 回归锁 ⑦ 18 tab 归组完整性 |
| `tests/e2e/settings-regroup.spec.ts` | 新增真实 Obsidian E2E：欢迎弹窗「⚙️ 打开设置」用户路径 → 导航点进插件 tab → 断言 6 pill / 点击切换 / 高级展开收起 / 设置持久化 → 证据截图 |
| `tests/__mocks__/obsidian.ts` | 补 `PluginSettingTab` 替身（containerEl 构造时创建，复现真实语义） |
| `playwright.config.ts` | 注册 `settings-regroup` project（本仓 projects 均为显式 testMatch） |

## 四、证据

1. **真实 Obsidian E2E（OBSIDIAN_PATH 指向本机 Obsidian 1.14.5）**：`npx playwright test tests/e2e/settings-regroup.spec.ts` → **1 passed (6.2s)**。断言链：初屏 6 pill → 点击「写作与协同」→ tab 切换与 active 迁移 → 高级展开（modes/suggestions 出现且 `settingsUiShowAdvanced` 持久化到插件 settings）→ 收起回退。
2. **截图**：`docs/audits/settings-regroup-evidence.png`（设置弹窗内 6 个 pill 全部渲染、「写作与协同」active 高亮、二级 tab 与内容区正常）。
3. **回归锁**：`git stash push -- ui/settings-tab.ts` → 单测 6 例红 → `stash pop` → 7 例全绿。
4. `npm run preflight` EXIT=0；`npx tsc --noEmit` EXIT=0。

## 五、边界与说明

- `ui/settings/section-factory.ts` 与 `styles-src/` 无需改动（dsh 前置提交已完成装配表与样式）。
- E2E 在未设置 `OBSIDIAN_PATH` 的环境（含 CI）显式 skip，与既有 E2E 口径一致；CI `--list` 校验通过。
- 遗留观察：设置 tab 的 DOM 缓存（`panelCache`）在真实环境跨 display 复用路径未单独验证，但初屏路径已被本 spec 锁定。
