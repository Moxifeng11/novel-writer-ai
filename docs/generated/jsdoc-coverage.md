# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 15 | 65% | 48 | 48 | 100% | 43 |
| `domains/` | 11 | 30 | 20 | 67% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 1036 | 69% | 1253 | 981 | 78% | 751 |
| `services/` | 28 | 151 | 110 | 73% | 202 | 149 | 74% | 66 |
| `shared/` | 163 | 1517 | 1162 | 77% | 149 | 138 | 93% | 457 |
| `ui/` | 189 | 493 | 225 | 46% | 632 | 344 | 54% | 163 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `shared/story-structure.ts` | 23 | 12 | 0 | 0 |
| `engine/style-vector-store.ts` | 11 | 10 | 17 | 0 |
| `services/checkpoint-manager.ts` | 4 | 4 | 6 | 6 |
| `shared/content-classifier.ts` | 11 | 10 | 0 | 0 |
| `ui/full-writer/execution-panels.ts` | 4 | 4 | 6 | 6 |
| `ui/full-writer/wizard-step-renderers.ts` | 1 | 1 | 9 | 9 |
| `ui/services/co-write-facade.ts` | 2 | 2 | 58 | 8 |
| `ui/views/book-detail-renderer.ts` | 2 | 0 | 10 | 10 |
| `engine/deconstructors/rhythm-deconstructor.ts` | 21 | 0 | 10 | 9 |
| `engine/dimension-keywords.ts` | 9 | 9 | 0 | 0 |
| `engine/embedding/openai-provider.ts` | 2 | 0 | 9 | 9 |
| `engine/harness/call-ledger.ts` | 3 | 3 | 6 | 6 |
| `engine/incremental-result-aggregator.ts` | 3 | 3 | 6 | 6 |
| `engine/promise-ledger.ts` | 11 | 9 | 0 | 0 |
| `engine/quality-scorer.ts` | 4 | 4 | 5 | 5 |
| `engine/stream-text-reader.ts` | 3 | 3 | 6 | 6 |
| `engine/token-bucket-rate-limiter.ts` | 3 | 2 | 7 | 7 |
| `services/chapter-recognizer.ts` | 5 | 4 | 5 | 5 |
| `services/worldview-cache-service.ts` | 4 | 4 | 18 | 5 |
| `shared/entity-field-mappings.ts` | 10 | 9 | 0 | 0 |
| `ui/co-write-floating-panel.ts` | 2 | 2 | 8 | 7 |
| `ui/full-writer/tab-controller.ts` | 2 | 2 | 7 | 7 |
| `engine/agent/dsh/dsh-session.ts` | 7 | 6 | 5 | 2 |
| `engine/ai-chapter-helpers.ts` | 1 | 1 | 7 | 7 |
| `engine/ai-engine.ts` | 2 | 2 | 33 | 6 |
| `engine/ai-worldview-generator.ts` | 2 | 1 | 7 | 7 |
| `engine/anti-ai-detector.ts` | 6 | 6 | 7 | 2 |
| `engine/embedding/ollama-provider.ts` | 2 | 0 | 8 | 8 |
| `engine/engine-registry.ts` | 13 | 1 | 34 | 7 |
| `engine/foreshadow-manager.ts` | 8 | 6 | 18 | 2 |
