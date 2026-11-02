# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 23 | 100% | 48 | 48 | 100% | 0 |
| `domains/` | 11 | 30 | 30 | 100% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 1508 | 100% | 1253 | 1253 | 100% | 0 |
| `services/` | 28 | 151 | 151 | 100% | 202 | 202 | 100% | 0 |
| `shared/` | 163 | 1517 | 1517 | 100% | 149 | 149 | 100% | 0 |
| `ui/` | 189 | 493 | 493 | 100% | 632 | 632 | 100% | 0 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `engine/agent/agent-types.ts` | 20 | 0 | 0 | 0 |
| `engine/agent/conversation-engine.ts` | 1 | 0 | 5 | 0 |
| `engine/agent/dsh/dsh-launch.ts` | 5 | 0 | 0 | 0 |
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
| `engine/ai-api-client.ts` | 1 | 0 | 5 | 0 |
| `engine/ai-batch-entity-generator.ts` | 1 | 0 | 4 | 0 |
| `engine/ai-chapter-helpers.ts` | 1 | 0 | 7 | 0 |
| `engine/ai-character-generator.ts` | 1 | 0 | 2 | 0 |
| `engine/ai-engine.ts` | 2 | 0 | 33 | 0 |
| `engine/ai-entity-generator.ts` | 1 | 0 | 3 | 0 |
| `engine/ai-lexicon.ts` | 3 | 0 | 0 | 0 |
| `engine/ai-outline-generator.ts` | 1 | 0 | 3 | 0 |
| `engine/ai-prompt-builder.ts` | 5 | 0 | 0 | 0 |
| `engine/ai-scene-expander.ts` | 2 | 0 | 3 | 0 |
| `engine/ai-scene-generator.ts` | 2 | 0 | 2 | 0 |
