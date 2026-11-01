# tests/

Vitest + Playwright 测试基建。完整规范见 [docs/handbook/05-testing.md](../docs/handbook/05-testing.md)。

## 运行

```bash
npm test            # 单元 + 集成（全量）
npm run test:cov    # 带覆盖率门禁
npm run test:e2e    # Playwright（需 OBSIDIAN_PATH）
npx playwright test --list   # 只校验用例可解析
```

## 目录

| 目录 | 内容 |
|---|---|
| `tests/unit/` | 纯函数、引擎行为、状态机、契约、架构源码扫描 |
| `tests/integration/` | 跨模块工作流（项目创建、知识库链、联动场景） |
| `tests/e2e/` | 真实 Obsidian Electron 旅程（独立 userData + CDP） |
| `tests/benchmark/` | 人味/质量基准（`npm run eval:*`，不进 `npm test`） |
| `tests/__mocks__/` | `obsidian` 最小替身（vitest alias） |
| `tests/fixtures/` | 测试数据 |

## 约定

- 单元：`tests/unit/<layer>/<name>.test.ts`；集成：`tests/integration/<topic>.test.ts`。
- 用中文行为句命名 `it(...)`，断言行为而不是私有实现。
- 并发/锁/回滚类改动必须有专门回归用例（参考 `body-writer-concurrent-write.test.ts`、`settlement-engine-behavior.test.ts`）。
- 架构约束用源码扫描测试固化（参考 `tests/unit/architecture/domain-isolation.test.ts`）。
- 覆盖率阈值见 `vitest.config.ts`（`engine/services/core/shared` 分域阈值）。
- 不要保留永久为真的占位测试或 `describe.skip` 尸体。

## Obsidian Mock

`tests/__mocks__/obsidian.ts` 通过 `vitest.config.ts` 的 `resolve.alias` 重定向。缺失 API 时按需补最小实现，不要 mock 整模块。

## E2E

见 [tests/e2e/README.md](e2e/README.md)。未设置 `OBSIDIAN_PATH` 时 Electron 用例会 skip 且退出码 0（假绿），CI 用 `--list` 做解析校验。
