# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 15 | 65% | 48 | 48 | 100% | 43 |
| `domains/` | 11 | 30 | 20 | 67% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 884 | 59% | 1253 | 683 | 55% | 739 |
| `services/` | 28 | 151 | 49 | 32% | 202 | 123 | 61% | 66 |
| `shared/` | 163 | 1517 | 964 | 64% | 149 | 89 | 60% | 457 |
| `ui/` | 189 | 493 | 183 | 37% | 632 | 206 | 33% | 161 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `ui/co-writing-view.ts` | 3 | 3 | 103 | 56 |
| `engine/style-fingerprint-library.ts` | 7 | 5 | 65 | 44 |
| `shared/paths.ts` | 189 | 45 | 0 | 0 |
| `engine/co-writer-engine.ts` | 8 | 4 | 45 | 26 |
| `engine/semantic-analyzer.ts` | 5 | 5 | 23 | 23 |
| `engine/deconstruction-worker-manager.ts` | 3 | 3 | 21 | 21 |
| `engine/foreshadow-manager.ts` | 8 | 6 | 18 | 17 |
| `engine/style-vector-store.ts` | 11 | 10 | 17 | 12 |
| `services/worldview-cache-service.ts` | 4 | 4 | 18 | 18 |
| `shared/multi-layer-cache.ts` | 6 | 6 | 16 | 16 |
| `shared/plugin-cache.ts` | 6 | 4 | 24 | 18 |
| `shared/story-structure.ts` | 23 | 22 | 0 | 0 |
| `ui/full-writer/full-writer-store.ts` | 5 | 5 | 17 | 17 |
| `engine/writing-quality-engine.ts` | 13 | 13 | 8 | 8 |
| `shared/webnovel-knowledge-base.ts` | 7 | 7 | 14 | 14 |
| `engine/co-writer/session-state.ts` | 34 | 20 | 0 | 0 |
| `engine/prompt-manager.ts` | 4 | 4 | 16 | 16 |
| `ui/full-writer/execution-run-store.ts` | 5 | 5 | 16 | 15 |
| `shared/store/types.ts` | 20 | 19 | 0 | 0 |
| `engine/ai-engine.ts` | 2 | 2 | 33 | 16 |
| `engine/foreshadow-config-manager.ts` | 1 | 1 | 17 | 17 |
| `ui/full-writer-view.ts` | 2 | 2 | 25 | 16 |
| `services/genre-preference-memory.ts` | 3 | 3 | 14 | 14 |
| `shared/template-validator.ts` | 25 | 17 | 0 | 0 |
| `ui/services/co-write-facade.ts` | 2 | 2 | 58 | 15 |
| `shared/mode-content.ts` | 19 | 16 | 0 | 0 |
| `shared/pre-research.ts` | 17 | 16 | 0 | 0 |
| `shared/creation-mode.ts` | 20 | 15 | 0 | 0 |
| `ui/views/knowledge-base-view.ts` | 10 | 10 | 5 | 5 |
| `engine/context/context-types.ts` | 15 | 14 | 0 | 0 |
