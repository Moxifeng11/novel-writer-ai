# 05 · 测试

> 目标：测试是行为契约，不是覆盖率数字游戏。测试基线以 `docs/progress/program-status.json` 与 CI 实测为准，不在文档里写死。

---

## 1. 测试层级

| 层级 | 目录 | 用途 | 运行 |
|---|---|---|---|
| 单元 | `tests/unit/**` | 纯函数、引擎行为、状态机、契约 | `npm test` |
| 集成 | `tests/integration/**` | 跨模块（项目工作流、知识库链） | `npm test` |
| 基准 | `tests/benchmark/**` | 人味/质量基准 | `npm run eval:*` |
| E2E | `tests/e2e/**` | 真实 Obsidian Electron 旅程 | `npm run test:e2e` |

- 单元/集成共用 `tests/__mocks__/obsidian.ts`（`vitest.config.ts` 里 alias 到 `obsidian`）。
- E2E 使用独立 `--user-data-dir` + CDP，不复用本机 Obsidian 实例。

## 2. 常用命令

```bash
npm test                       # 全量单元/集成
npm run test:cov               # 带覆盖率门禁
npx vitest run tests/unit/engine/body-writer.test.ts
npm run test:e2e               # 需 OBSIDIAN_PATH
npx playwright test --list     # 只校验用例可解析（CI 用）
```

## 3. 覆盖率阈值（当前）

| 域 | lines | statements | branches | functions |
|---|---|---|---|---|
| 全局 | 30 | 30 | 60 | 15 |
| `engine/**` | 52 | 52 | 74 | 40 |
| `services/**` | 36 | 36 | 67 | 26 |
| `core/**` | 45 | 45 | 74 | 14 |
| `shared/**` | 90 | 90 | 82 | 80 |

- 口径：`engine/`、`services/`、`core/`、`shared/`；不含 `ui/`、`domains/`、`workers/`。
- 阈值只允许上调；下调需在 PR 说明理由。
- `preflight` 不含覆盖率，`preflight:release` 与 CI 才跑 `test:cov`。

## 4. 写一条好测试

```ts
// tests/unit/engine/xxx.test.ts
import { describe, expect, it } from 'vitest';

describe('模块名 — 行为域', () => {
    it('输入 A 时返回 B（可读的中文行为句）', async () => {
        // arrange：最小依赖，优先用 MockFileSystem/FakeFrontmatter
        // act：只调用一个公开入口
        // assert：断言行为，不断言实现细节
    });
});
```

约定：

- 断言「行为」而不是「调用了哪个私有方法」。
- 并发/锁/回滚类改动必须有专门的回归用例（参考 `body-writer-concurrent-write.test.ts`、`settlement-engine-behavior.test.ts`）。
- 架构约束用源码扫描测试固化（参考 `tests/unit/architecture/domain-isolation.test.ts`）。
- 不写永久为真的占位测试；删掉的占位测试不要用 `describe.skip` 留尸。

## 5. E2E

前提：

- 已 `npm run build`；
- `OBSIDIAN_PATH` 指向 Obsidian 可执行文件；
- 运行前关闭正在使用的 Obsidian（单实例锁）；
- 测试会在临时目录创建独立 vault，结束自动删除（`KEEP_E2E_VAULT=1` 保留）。

危险开关：

- `E2E_REWRITE=1`：**会改写真实 vault 章节**，必须先把目标复制到副本并设置 `E2E_VAULT_PATH`。
- `E2E_REAL_AI=1`：会消耗真实 API 额度。

未设置 `OBSIDIAN_PATH` 时 Electron 用例会 skip 且退出码 0（**假绿**），CI 用 `playwright test --list` 只做解析校验。

## 6. 测试与文档的分工

- 测试 = **行为契约**：输入/输出/失败/边界。
- JSDoc `@example` = **用法契约**：怎么调用、最小可运行片段。
- 不要用测试重复写用法说明，也不要用 `@example` 代替失败路径测试。

## 7. 排查测试问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 全量通过但 CI 挂 | 本地 Node 版本不同 / 覆盖率未跑 | 用 Node 20，跑 `test:cov` |
| E2E 全 skip | 未设 `OBSIDIAN_PATH` | 设置后重跑；不要当通过 |
| 测试随机失败 | 共享模块级缓存/时间依赖 | 隔离实例、注入时钟、避免模块级可变状态 |
| 覆盖率骤降 | 新增文件未测试 / 口径变化 | 看 `coverage/` 报告，补关键路径 |
| 测试里 Obsidian API 缺失 | mock 不完整 | 在 `tests/__mocks__/obsidian.ts` 补最小实现，不要 mock 整个模块 |

## 8. 相关文档

- 联动链与手工验收：[../regression/LINKED-SCENARIOS.md](../regression/LINKED-SCENARIOS.md)
- E2E 细节：[../../tests/e2e/README.md](../../tests/e2e/README.md)
- 门禁与发布：[06-gates-and-release.md](06-gates-and-release.md)
