# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 15 | 65% | 48 | 48 | 100% | 43 |
| `domains/` | 11 | 30 | 20 | 67% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 604 | 40% | 1253 | 546 | 44% | 740 |
| `services/` | 28 | 151 | 49 | 32% | 202 | 123 | 61% | 66 |
| `shared/` | 163 | 1517 | 887 | 58% | 149 | 89 | 60% | 457 |
| `ui/` | 189 | 493 | 140 | 28% | 632 | 146 | 23% | 161 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `ui/co-writing-view.ts` | 3 | 3 | 103 | 78 |
| `shared/thresholds.ts` | 124 | 80 | 0 | 0 |
| `ui/services/co-write-facade.ts` | 2 | 2 | 58 | 53 |
| `engine/style-fingerprint-library.ts` | 7 | 5 | 65 | 44 |
| `shared/paths.ts` | 189 | 45 | 0 | 0 |
| `ui/svg-charts.ts` | 49 | 43 | 0 | 0 |
| `engine/batch-import-manager.ts` | 9 | 9 | 32 | 32 |
| `engine/deconstruction-scheduler.ts` | 8 | 7 | 33 | 29 |
| `engine/co-writer-engine.ts` | 8 | 4 | 45 | 26 |
| `engine/deconstructors/foreshadow-deconstructor.ts` | 17 | 17 | 15 | 13 |
| `engine/deconstructors/rhythm-deconstructor.ts` | 21 | 21 | 10 | 9 |
| `engine/knowledge-base-config.ts` | 5 | 5 | 23 | 23 |
| `engine/knowledge-injector.ts` | 13 | 7 | 23 | 21 |
| `engine/semantic-analyzer.ts` | 5 | 5 | 23 | 23 |
| `engine/style-vector-store.ts` | 11 | 10 | 17 | 16 |
| `engine/deconstruction-worker-manager.ts` | 3 | 3 | 21 | 21 |
| `engine/foreshadow-manager.ts` | 8 | 6 | 18 | 17 |
| `engine/vector-enhancer.ts` | 5 | 5 | 20 | 18 |
| `services/worldview-cache-service.ts` | 4 | 4 | 18 | 18 |
| `shared/multi-layer-cache.ts` | 6 | 6 | 16 | 16 |
| `shared/plugin-cache.ts` | 6 | 4 | 24 | 18 |
| `shared/story-structure.ts` | 23 | 22 | 0 | 0 |
| `ui/full-writer/full-writer-store.ts` | 5 | 5 | 17 | 17 |
| `engine/deconstructors/character-deconstructor.ts` | 14 | 14 | 8 | 7 |
| `engine/writing-quality-engine.ts` | 13 | 13 | 8 | 8 |
| `shared/webnovel-knowledge-base.ts` | 7 | 7 | 14 | 14 |
| `engine/co-writer/session-state.ts` | 34 | 20 | 0 | 0 |
| `engine/prompt-manager.ts` | 4 | 4 | 16 | 16 |
| `ui/full-writer/execution-run-store.ts` | 5 | 5 | 16 | 15 |
| `shared/store/types.ts` | 20 | 19 | 0 | 0 |
