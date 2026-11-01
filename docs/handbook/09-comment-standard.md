# 09 · 注释与 JSDoc 规范

> 注释解释「为什么」和「怎么用」，不重复代码字面。
> 门禁：`npm run check:jsdoc`（棘轮，只允许覆盖率上升）。

---

## 1. 文件头（所有源码文件）

```ts
/**
 * xxx.ts — 一句话职责
 *
 * 目的：<解决什么问题>
 * 背景 / 事故背景（YYYY-MM-DD）：<为什么需要它；踩过什么坑>
 * 不变量：<调用方必须遵守或本模块保证的规则>
 * 使用方式：
 * ```ts
 * // 最小可运行示例（可选，跨模块入口必填）
 * ```
 */
```

要求：

- 第一行固定 `文件名 — 职责`。
- 「背景」写事实与日期，不写「优化了体验」这类空话。
- 「不变量」是可验证的句子（例如「同一路径写入必须串行」「status 不降级」）。

## 2. 导出声明

每个 `export class/interface/type/function/const/enum` 前必须有 JSDoc：

```ts
/**
 * 从规则文件内容解析版本号。
 *
 * @param text - 文件全文（可含 frontmatter）
 * @returns 版本号；无法识别时返回空串
 * @example
 * ```ts
 * extractVersion('---\nversion: "3.6.0"\n---') // '3.6.0'
 * ```
 */
export function extractVersion(text: string): string
```

规则：

- `@param`：每个参数一条，写语义与边界，不写类型（TS 已有）。
- `@returns`：非 `void` 必填；说明空值/错误值。
- `@throws`：同步抛错或 Promise reject 的条件。
- `@example`：跨模块入口、纯函数库、事故相关模块必填；示例必须能对应真实 API。
- `@deprecated`：写替代方案与计划移除版本。

## 3. 类与公开方法

```ts
/** 结算引擎：把章节报告落成实体/伏笔/时间线/正文状态，并在部分失败时回滚。 */
export class SettlementEngine {
    /**
     * 执行一次结算。
     *
     * @param project - 项目路径（`长篇小说/书名`）
     * @param report - 模型输出的结算报告文本
     * @returns 结算结果；`hasPartialFailure` 为 true 时已按 journal 回滚
     * @throws 仅当参数非法时抛出；业务失败通过返回值表达
     */
    async settle(project: string, report: string): Promise<SettlementResult>
}
```

- 只强制**公开方法**；私有方法在逻辑不直观时写一行 `//` 说明。
- UI 的内部渲染方法不强制 JSDoc，但跨模块回调/状态写入口必须写。

## 4. 事故注释格式

```ts
/**
 * 事故背景（2026-11-02）：tags 里的 v3.6.0 排在 version 之前，导致自定义变体
 * 被判成内置 3.6.0，启动反复弹「同版本不同内容」。
 * 不变量：版本解析必须优先读 frontmatter 的 version 字段。
 * 回归：tests/unit/shared/versioned-registry.test.ts
 */
```

四要素缺一不可：日期、触发条件、不变量、回归路径。

## 5. 行内注释

- 解释「为什么这样做」「这里有什么坑」，不要复述代码。
- 危险操作前写清楚后果与回滚方式。
- 不要留大段注释掉的代码；用 git 历史。
- `TODO` 必须带可执行条件：`// TODO(v4.25): 支持 …`，不要裸 `TODO`。

## 6. 不要这样写

```ts
// ❌ 复述代码
// 设置 status 为 settled
fm.status = 'settled';

// ❌ 空话
// 优化性能
items = items.filter(Boolean);

// ❌ 过时示例
/** @example writer.write('老接口') */  // 接口已改名
```

## 7. 门禁如何判定

`check:jsdoc` 使用 TypeScript AST：

- 统计 `engine/ services/ shared/ core/ domains/` 的导出声明，以及 `ui/` 的导出声明；
- 每个导出必须有紧邻的 JSDoc；
- 公开方法（`public` 或缺省）必须有 JSDoc；
- 对已注释函数检查 `@param` 覆盖与 `@returns`（非 `void`）；
- 与 `.jsdoc-baseline.json` 对比：**已注释数不得下降**；新文件/新导出必须全部有注释；
- 每次运行都会刷新 [generated/jsdoc-coverage.md](../generated/jsdoc-coverage.md)。

更新基线：

```bash
npm run check:jsdoc -- --update-baseline   # 仅在覆盖率上升后执行
```

## 8. 范本

- 文件头 + 接口逐项注释：[../../shared/file-system-port.ts](../../shared/file-system-port.ts)
- 事故背景 + 纯函数契约：[../../shared/versioned-registry.ts](../../shared/versioned-registry.ts)
- 唯一入口 + 不变量：[../../engine/body-writer.ts](../../engine/body-writer.ts)
- 协议事实固化：[../../engine/agent/dsh/dsh-protocol.ts](../../engine/agent/dsh/dsh-protocol.ts)
- 类级 `@example`：[../../shared/progress-emitter.ts](../../shared/progress-emitter.ts)
