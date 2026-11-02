# JSDoc 覆盖率（生成物）

> 由 `npm run check:jsdoc -- --report` 生成，禁止手改。

| 层 | 文件 | 导出 | 已注释 | 导出覆盖 | 公开方法 | 已注释 | 方法覆盖 | 不完整 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `core/` | 6 | 23 | 15 | 65% | 48 | 48 | 100% | 43 |
| `domains/` | 11 | 30 | 20 | 67% | 1 | 1 | 100% | 0 |
| `engine/` | 271 | 1508 | 990 | 66% | 1253 | 878 | 70% | 743 |
| `services/` | 28 | 151 | 110 | 73% | 202 | 149 | 74% | 66 |
| `shared/` | 163 | 1517 | 1136 | 75% | 149 | 135 | 91% | 457 |
| `ui/` | 189 | 493 | 183 | 37% | 632 | 286 | 45% | 162 |

## 缺口最大的文件（按未注释导出数）

| 文件 | 导出 | 未注释 | 公开方法 | 未注释 |
|---|---:|---:|---:|---:|
| `ui/co-writing-view.ts` | 3 | 3 | 103 | 29 |
| `engine/style-fingerprint-library.ts` | 7 | 5 | 65 | 14 |
| `ui/views/knowledge-base-view.ts` | 10 | 10 | 5 | 5 |
| `engine/co-writer-engine.ts` | 8 | 4 | 45 | 10 |
| `engine/deconstructors/foreshadow-deconstructor.ts` | 17 | 0 | 15 | 13 |
| `engine/outline-to-text-expander.ts` | 8 | 7 | 6 | 6 |
| `engine/deconstructors/technique-deconstructor.ts` | 5 | 5 | 7 | 7 |
| `engine/harness/tool-registry.ts` | 6 | 6 | 6 | 6 |
| `engine/repository/domain/serializers/entity-factory.ts` | 1 | 0 | 12 | 12 |
| `shared/story-structure.ts` | 23 | 12 | 0 | 0 |
| `ui/full-writer/chapter-orchestrator.ts` | 9 | 8 | 4 | 4 |
| `ui/full-writer/streamlined-nav-presenter.ts` | 12 | 12 | 0 | 0 |
| `ui/settings/general-sections.ts` | 6 | 6 | 7 | 6 |
| `ui/settings/writing-sections.ts` | 6 | 6 | 6 | 6 |
| `ui/views/book-detail-renderer.ts` | 2 | 2 | 10 | 10 |
| `ui/views/knowledge-base-modals.ts` | 4 | 4 | 8 | 8 |
| `engine/knowledge-vector-store.ts` | 5 | 4 | 13 | 7 |
| `engine/step-runner.ts` | 1 | 0 | 17 | 11 |
| `shared/canon-source.ts` | 18 | 11 | 0 | 0 |
| `shared/multi-layer-cache.ts` | 6 | 6 | 16 | 5 |
| `shared/prompt-manager-types.ts` | 11 | 11 | 0 | 0 |
| `ui/views/writing-fingerprint-view.ts` | 3 | 3 | 8 | 8 |
| `engine/cache/preload-manager.ts` | 6 | 0 | 25 | 10 |
| `engine/harness/rule-engine.ts` | 8 | 8 | 2 | 2 |
| `engine/harness/trend-research-service.ts` | 8 | 8 | 2 | 2 |
| `engine/heavy-task-worker-manager.ts` | 2 | 2 | 9 | 8 |
| `engine/style-vector-store.ts` | 11 | 10 | 17 | 0 |
| `engine/text-segmenter.ts` | 10 | 9 | 2 | 1 |
| `services/checkpoint-manager.ts` | 4 | 4 | 6 | 6 |
| `shared/content-classifier.ts` | 11 | 10 | 0 | 0 |
