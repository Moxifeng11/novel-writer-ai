# ADR：知识库视图的 DOM 级测试是否引入 jsdom（G7-4 收尾）

- 状态：已决策（2026-11-01）
- 决策人：实现方（ZCode），验收：用户
- 关联：G7-4a/b/c/d、G6-5、`docs/regression/LINKED-SCENARIOS.md`

## 背景

G7-4 分批补覆盖后，唯一剩余缺口是 `ui/views/knowledge-base-view.ts` 的 DOM 级测试。
G7-4d 已把最容易回归的三条规则抽成纯模块 `ui/views/knowledge-detail-state.ts`
（换书清空字段、错误文案、列表刷新守卫），并配了 9 条单测。

剩下的缺口是「点击/排序/重绘」这类需要真实 DOM 的行为。

## 选项

### A. 引入 jsdom（+ @testing-library/dom）

- 成本：需要为 `TFile`/`TFolder`/`ItemView`/`Modal`/`metadataCache` 大量打桩；
  这些行为在 jsdom 里与 Obsidian 的 Electron 运行时（真实 workspace、异步 metadataCache）
  语义不同，桩本身就可能掩盖 bug（G7-4 期间已出现两次「测试桩按旧实现写」的假通过）。
- 收益：可以在 CI 里无 Electron 跑视图交互。
- 风险：新增 devDependency + 一套与生产环境不同的 DOM 语义，长期维护成本高于收益。

### B. 不引入 jsdom（选定）

- 视图逻辑继续抽纯模块（纯函数可测、无宿主依赖）；
- DOM 契约交给真实 Electron E2E：`tests/e2e/obsidian-plugin.spec.ts` 已有知识库侧栏、
  指纹库、Agent 工作台等真实点击用例；
- G6-5 也采用同一策略：结构契约用源码单测守，节点计数用 E2E 的 MutationObserver 实测。

## 决策

不引入 jsdom。G7-4 的覆盖目标调整为：

1. 纯状态/纯函数：单测覆盖（已完成，含 G7-4d 的 9 条）；
2. DOM 行为：由 Electron E2E 覆盖，新增交互时优先补 E2E，而不是补 jsdom 桩；
3. 确有「E2E 无法覆盖、纯函数也抽不出来」的交互时，再重新评估本决策。

## 后果

- `knowledge-base-view` 的 DOM 交互没有单元级测试；CI 若未配置 `OBSIDIAN_PATH`，
  E2E 会显式 skip，这部分只在本地/带 Electron 的流水线执行。
- 触发重评的条件：① 同类 DOM 交互缺口连续出现；② CI 环境无法运行 Electron；
  ③ Obsidian 官方提供可复用的测试宿主。

## 参考

- `ui/views/knowledge-detail-state.ts`、`tests/unit/ui/knowledge-detail-state.test.ts`
- `tests/e2e/obsidian-plugin.spec.ts`（真实 Electron 链路）
- `docs/design/g1-authority-decisions.md`（同类决策记录格式）
