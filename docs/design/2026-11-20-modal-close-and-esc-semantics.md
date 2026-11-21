# Modal 关闭与 Esc 语义（2026-11-20）

> 状态：现行（2026-11-20 起）。来源：交互审计 A-14，C 清单 P2 #19。

## 一、问题

Esc 与「点遮罩」在 Obsidian 里走同一条路：调用 `Modal.close()`。改造前全库 `onClose` 中检查未保存内容的为 **0**，长任务弹窗也从不说明「弹窗关掉后任务是被中断还是继续」。结果是同一次按键在不同界面含义不同，用户无法预判。

## 二、分层语义（唯一口径）

Esc / 点遮罩按**上下文**分四层，越靠上越「轻」：

| 层 | 典型界面 | Esc 语义 | 未保存内容 |
| --- | --- | --- | --- |
| L1 编辑面 | 协同写作视图、单元写作台、文笔润色 | 收起内联辅助（如建议列表），不退出编辑 | 自动保存（协同 1s 防抖 / 单元台 flush） |
| L2 搜索与筛选 | 设置页搜索、查找替换条、列表筛选 | 清空当前搜索词 / 关闭内联查找条 | 不涉及正文 |
| L3 表单弹窗 | 写作风格、全书规划、新增同人设定等 | 关闭弹窗；**有未保存修改时先询问** | `ModalDirtyGuard`：取消=留在弹窗，确认=丢弃并关闭 |
| L4 长任务弹窗 | 重建章节、继续创建、批量建章、备份元文件 | 关闭弹窗；**任务运行中先询问任务命运** | `ModalRunningGuard`：取消=留在弹窗，确认=关闭弹窗但任务继续 |

两条硬规则：

1. **关弹窗 ≠ 停任务**。L4 的四个任务都没有 AbortSignal 基建，确认文案只承诺「关闭后任务继续在后台跑（进度条仍在）」，不得暗示取消。要真正中止，必须另做取消基建（见 backlog）。
2. **非运行/非脏状态不拦**。两个守卫都只在需要时介入，正常关闭路径（保存成功、明确取消、完成后自动关）行为完全不变。

## 三、实现

- `ui/components/modal-dirty-guard.ts`：`markDirty()/markClean()/isDirty`，`attach(modal, app)` 覆写实例 `close()`。
- `ui/components/modal-running-guard.ts`：构造传 `isRunning` 探针，`attach(modal, app)` 同样覆写 `close()`；任务开始置 `running = true`，结束/finally 置 `false`，`onClose` 兜底重置。
- 两者都复用 `OperationConfirmModal.confirm(app, {...})`，都带 `confirming` 闸门（Esc 连按不叠加第二个确认框）与 `catch`（确认框自身异常时保持弹窗打开）。
- 拦截时机是**覆写 close**，因为 Esc、点遮罩、代码里的 `this.close()` 都经过它；放在 `onClose` 里已经关完了。

## 四、覆盖清单

| 弹窗 | 守卫 | 运行态入口 |
| --- | --- | --- |
| `ui/rebuild-chapters-modal.ts` | RunningGuard | `rebuild()` 进循环前置 true，`mainNotice.hide()` 前复位 |
| `ui/continue-chapters-modal.ts` | RunningGuard | 创建章节 / 生成续写两条路径各自置位，finally 与 catch 复位 |
| `ui/batch-create-modal.ts` | RunningGuard | 短篇/剧本建单元与按全书规划建章两条路径 |
| `ui/backup-yuan-modal.ts` | RunningGuard | `backup()` 的 finally 复位 |
| 全书规划 / 写作风格 / 新增同人设定 | DirtyGuard | 见 `docs/audits/2026-11-20-interaction-and-module-flow.md` §五 |

## 五、回归测试

- `tests/unit/ui/modal-running-guard.test.ts`：非运行放行、运行态确认时序、选留、连按不叠加、结束后不再询问、解除拦截。
- `tests/unit/ui/modal-running-guard-wiring.test.ts`：四个弹窗的挂载 / 置位 / 复位 / onClose 兜底。
- `tests/unit/ui/modal-dirty-guard.test.ts`、`tests/unit/ui/modal-guard-wiring.test.ts`：脏态一侧。

## 六、破坏性操作确认分级（A-7，2026-11-22）

与 Esc 分层正交的一条规则：**同一类破坏性操作，不论从哪个入口触发，确认强度只由「能否恢复」决定**。

| 档位 | 判定 | 形态 | 现有入口 |
| --- | --- | --- | --- |
| 不可恢复 | 删除后无法从界面找回（项目、整书） | **两步确认**（先讲影响面，再最终确认），两步都走 `OperationConfirmModal` | 删除项目（`ui/full-writer/project-selector-controller.ts` 的 `confirmDeleteProject`） |
| 可恢复 | 有备份 / 有版本历史 / 可重建 | 单次 `OperationConfirmModal` | 章节版本回滚、删除卷简介版本、删渠道 / 预设 / 提示词等 |
| 画布内轻删 | 单节点、可撤销或二次点击即恢复 | 按钮文案变「再点一次确认删除」，3 秒复位 | 规划画布节点删除 |

硬规则：

1. **只用一套确认组件**。不再新增专用确认 Modal，也不用 `window.confirm`（全仓 0，由 `tests/unit/ui/no-window-confirm.test.ts` 锁定）。
2. **确认文案必须能翻译**（`t()` + 双语资源），原生 confirm 之所以被下线就是因为它不可翻译。
3. **「不要求输入名称」**：两步确认已经足够防误触，输入项目名对中文用户反而是负担；这条在 A-7 里推翻审计原建议。
4. 回滚类确认必须展示**可恢复依据**（如「回滚前会自动保存当前版本作为备份」），否则用户无法判断风险。

落地：`ui/chapter-version-modal.ts` 的 `confirmRollback` 改走 `OperationConfirmModal`，自建 `RollbackConfirmModal` 与 `nw-rollback-*` 9 个样式类删除；文案键 `versionModal.rollback.{title,desc,note,stats,backup,confirm,done}`。回归：`tests/unit/ui/chapter-version-rollback-confirm.test.ts`。

## 七、backlog

- L4 真取消：四个任务接入 AbortSignal，确认框增加第三选项「停止任务」。
- ~~L1 撤销栈~~：已做（2026-11-20，A-17）—— 撤销栈移到 `shared/edit-history.ts`，协同视图与单元写作台共用同一套栈，见 `docs/audits/2026-11-20-interaction-and-module-flow.md` A-17 状态。
- 其余高危表单弹窗按 DirtyGuard 同模式接入（审计 C#3 剩余 7 个）。

