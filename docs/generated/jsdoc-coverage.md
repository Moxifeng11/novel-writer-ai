# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 15 | 65% | 48 | 48 | 100% | 43 |
| `domains/` | 11 | 30 | 20 | 67% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 938 | 62% | 1253 | 810 | 65% | 739 |
| `services/` | 28 | 151 | 110 | 73% | 202 | 136 | 67% | 66 |
| `shared/` | 163 | 1517 | 1040 | 69% | 149 | 132 | 89% | 457 |
| `ui/` | 189 | 493 | 183 | 37% | 632 | 222 | 35% | 161 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `ui/co-writing-view.ts` | 3 | 3 | 103 | 56 |
| `engine/style-vector-store.ts` | 11 | 10 | 17 | 11 |
| `ui/full-writer/execution-run-store.ts` | 5 | 5 | 16 | 15 |
| `engine/deconstruction-worker-manager.ts` | 3 | 3 | 21 | 16 |
| `engine/style-fingerprint-library.ts` | 7 | 5 | 65 | 14 |
| `engine/ai-engine.ts` | 2 | 2 | 33 | 16 |
| `ui/full-writer-view.ts` | 2 | 2 | 25 | 16 |
| `services/genre-preference-memory.ts` | 3 | 3 | 14 | 14 |
| `shared/template-validator.ts` | 25 | 17 | 0 | 0 |
| `ui/services/co-write-facade.ts` | 2 | 2 | 58 | 15 |
| `shared/mode-content.ts` | 19 | 16 | 0 | 0 |
| `shared/pre-research.ts` | 17 | 16 | 0 | 0 |
| `shared/creation-mode.ts` | 20 | 15 | 0 | 0 |
| `ui/views/knowledge-base-view.ts` | 10 | 10 | 5 | 5 |
| `engine/co-writer-engine.ts` | 8 | 4 | 45 | 10 |
| `engine/knowledge-tags.ts` | 2 | 2 | 12 | 12 |
| `engine/plot-divergence-engine.ts` | 8 | 7 | 7 | 7 |
| `engine/writing-profile.ts` | 8 | 8 | 7 | 6 |
| `shared/synopsis-spec.ts` | 15 | 14 | 0 | 0 |
| `engine/context/story-context-types.ts` | 13 | 13 | 0 | 0 |
| `engine/deconstructors/foreshadow-deconstructor.ts` | 17 | 0 | 15 | 13 |
| `engine/outline-to-text-expander.ts` | 8 | 7 | 6 | 6 |
| `engine/streaming/stream-parser.ts` | 9 | 9 | 4 | 4 |
| `engine/template-service.ts` | 2 | 2 | 12 | 11 |
| `engine/writing-quality-engine.ts` | 13 | 13 | 8 | 0 |
| `shared/file-cache.ts` | 3 | 3 | 10 | 10 |
| `shared/task-model.ts` | 19 | 13 | 0 | 0 |
| `shared/writing-stats.ts` | 25 | 13 | 0 | 0 |
| `engine/deconstructors/technique-deconstructor.ts` | 5 | 5 | 7 | 7 |
| `engine/harness/tool-registry.ts` | 6 | 6 | 6 | 6 |
