# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 24 | 24 | 100% | 50 | 50 | 100% | 0 |
| `domains/` | 11 | 28 | 28 | 100% | 1 | 1 | 100% | 0 |
| `engine/` | 288 | 1585 | 1584 | 100% | 1239 | 1239 | 100% | 0 |
| `services/` | 32 | 187 | 187 | 100% | 221 | 221 | 100% | 0 |
| `shared/` | 177 | 1606 | 1606 | 100% | 149 | 149 | 100% | 0 |
| `ui/` | 236 | 724 | 724 | 100% | 648 | 648 | 100% | 0 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `engine/co-writer/local-model-utils.ts` | 9 | 1 | 0 | 0 |
| `engine/agent/agent-types.ts` | 23 | 0 | 0 | 0 |
| `engine/agent/conversation-engine.ts` | 1 | 0 | 5 | 0 |
| `engine/agent/dsh/dsh-launch.ts` | 6 | 0 | 0 | 0 |
| `engine/agent/dsh/dsh-process.ts` | 7 | 0 | 0 | 0 |
| `engine/agent/dsh/dsh-protocol.ts` | 4 | 0 | 4 | 0 |
| `engine/agent/dsh/dsh-session.ts` | 7 | 0 | 5 | 0 |
| `engine/agent/harness/agent-adapter.ts` | 2 | 0 | 0 | 0 |
| `engine/agent/harness/agent-loop.ts` | 6 | 0 | 0 | 0 |
| `engine/agent/harness/context-fit.ts` | 6 | 0 | 0 | 0 |
| `engine/agent/harness/creation-plan.ts` | 6 | 0 | 0 | 0 |
| `engine/agent/harness/harness-engine.ts` | 5 | 0 | 14 | 0 |
| `engine/agent/harness/harness-types.ts` | 14 | 0 | 0 | 0 |
| `engine/agent/harness/host-tools.ts` | 6 | 0 | 0 | 0 |
| `engine/agent/harness/prompt-sections.ts` | 2 | 0 | 0 | 0 |
| `engine/agent/harness/session-log.ts` | 1 | 0 | 10 | 0 |
| `engine/agent/harness/session-snapshot.ts` | 8 | 0 | 0 | 0 |
| `engine/agent/harness/spill-store.ts` | 6 | 0 | 0 | 0 |
| `engine/agent/harness/tool-registry.ts` | 5 | 0 | 6 | 0 |
| `engine/agent/harness/tool-result-pruner.ts` | 5 | 0 | 0 | 0 |
| `engine/ai-api-client-shared.ts` | 6 | 0 | 0 | 0 |
| `engine/ai-api-client.ts` | 1 | 0 | 5 | 0 |
| `engine/ai-api-stream.ts` | 4 | 0 | 0 | 0 |
| `engine/ai-batch-entity-generator.ts` | 1 | 0 | 4 | 0 |
| `engine/ai-chapter-helpers.ts` | 1 | 0 | 7 | 0 |
| `engine/ai-character-generator.ts` | 1 | 0 | 2 | 0 |
| `engine/ai-engine.ts` | 2 | 0 | 33 | 0 |
| `engine/ai-entity-generator.ts` | 1 | 0 | 3 | 0 |
| `engine/ai-lexicon.ts` | 3 | 0 | 0 | 0 |
| `engine/ai-outline-generator.ts` | 1 | 0 | 3 | 0 |

## @example 覆盖（公共入口）

| 文件 | 目标 | 有示例 | 覆盖 | 缺失符号 |
|---|---:|---:|---:|---|
| `engine/ai-api-client.ts` | 1 | 1 | 100% | — |
| `engine/ai-engine.ts` | 1 | 1 | 100% | — |
| `engine/body-writer.ts` | 4 | 4 | 100% | — |
| `engine/co-writer/create-session-store.ts` | 2 | 2 | 100% | — |
| `engine/engine-registry.ts` | 1 | 1 | 100% | — |
| `engine/settlement-engine.ts` | 1 | 1 | 100% | — |
| `services/rules-registry.ts` | 4 | 4 | 100% | — |
| `services/rules-service.ts` | 1 | 1 | 100% | — |
| `shared/file-cache.ts` | 1 | 1 | 100% | — |
| `shared/multi-layer-cache.ts` | 1 | 1 | 100% | — |
| `shared/progress-emitter.ts` | 1 | 1 | 100% | — |
| `shared/store/compose.ts` | 2 | 2 | 100% | — |
| `shared/store/createStore.ts` | 2 | 2 | 100% | — |
| `shared/store/middleware/persist.ts` | 3 | 3 | 100% | — |
| `shared/time-estimator.ts` | 2 | 2 | 100% | — |
| `shared/versioned-registry.ts` | 7 | 7 | 100% | — |
| `ui/components/ai-detection-report.ts` | 1 | 1 | 100% | — |
| `ui/components/analysis-report-panel.ts` | 1 | 1 | 100% | — |
| `ui/components/categorization-review-panel.ts` | 1 | 1 | 100% | — |
| `ui/components/character-review-panel.ts` | 1 | 1 | 100% | — |
| `ui/components/chart-toolbar.ts` | 1 | 1 | 100% | — |
| `ui/components/emotion-curve-view.ts` | 1 | 1 | 100% | — |
| `ui/components/empty-state.ts` | 1 | 1 | 100% | — |
| `ui/components/error-state.ts` | 1 | 1 | 100% | — |
| `ui/components/notice-helpers.ts` | 3 | 3 | 100% | — |
| `ui/components/progress/loading-overlay.ts` | 1 | 1 | 100% | — |
| `ui/components/progress/operation-confirm-modal.ts` | 1 | 1 | 100% | — |
| `ui/components/progress/progress-bar.ts` | 1 | 1 | 100% | — |
| `ui/components/progress/step-list.ts` | 1 | 1 | 100% | — |
| `ui/components/progress/task-card.ts` | 1 | 1 | 100% | — |
| `ui/components/smart-chart.ts` | 1 | 1 | 100% | — |
| `ui/services/co-write-facade.ts` | 1 | 1 | 100% | — |
