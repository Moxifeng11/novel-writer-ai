/**
 * ui-message.ts — 领域层向界面层的「消息契约」（i18n engine 分层①，ZC-20261120-11）
 *
 * ## 为什么需要
 *
 * 引擎层（`engine/`）目前有 65 个文件 / 8,613 字中文**直接拼给用户看**：
 * `review-agent.ts` 的 `'❌ 未找到章节文件'`、`fingerprint-extractor.ts` 的
 * `onProgress({ message: '正在预处理文本...' })`。后果有三：
 *
 * 1. **界面换语言改不了**——这些串不经 `t()`，en 用户永远看到中文；
 * 2. **展示知识泄漏到领域层**——引擎知道「怎么措辞给用户听」，这是界面的职责；
 * 3. **改文案要动引擎**——文案调整变成领域层改动，测试面变大。
 *
 * ## 契约
 *
 * `UiMessage = { code, params?, fallback? }`
 * - `code`：资源键（`engineMsg.<域>.<slug>`），唯一真源；
 * - `params`：插值参数（值本身是数据，不进资源）；
 * - `fallback`：**兜底中文**，资源缺键时返回它，**绝不抛错**。
 *   为什么保留兜底：引擎里的这些消息常在错误处理路径上，
 *   若因缺键抛异常会把「一次提示」升级成「一次崩溃」。
 *
 * ## 兼容
 *
 * 所有对外签名用 `UiMessage | string`（联合类型），老调用方传字符串照常工作。
 * 新调用方传 `UiMessage`，界面层用 `resolveUiMessage()` 求值。
 * 这样改造可以**一个文件一个文件地推进**，不需要一次性全改。
 */
import { hasMessage, t } from '@/i18n';
import type { EngineMsgCode } from '@/shared/engine-msg-codes';

/** 领域层发给界面的消息（结构化，可双语） */
export interface UiMessage {
    /**
     * 资源键（`engineMsg.<域>.<slug>`）。
     *
     * 类型来自自动生成的 `ENGINE_MSG_CODES`（审计 B7 / C 清单 #12）：
     * 拼错键名是编译错，而不是运行时静默退化成中文兜底。
     */
    code: EngineMsgCode;
    /** 插值参数 */
    params?: Record<string, string | number>;
    /**
     * 兜底中文：资源缺键时返回它，**不抛错**。
     *
     * 必填而不是可选——强制作者想清楚「这消息说了什么」，
     * 也保证 `t()` 缺失时用户仍能看到有意义的内容而不是键名。
     */
    fallback: string;
}

/** 界面层可接受的两种消息形态 */
export type UiMessageLike = UiMessage | string;

/**
 * 把 `UiMessage | string` 求值成当前语言的展示串。
 *
 * - `string` 原样返回（老调用方零改动）；
 * - `UiMessage` 查资源，缺键回落 `fallback`（不抛错）。
 *
 * @param message - 消息（结构化或纯文本）
 * @returns 当前语言的展示串
 * @example
 * ```ts
 * resolveUiMessage({ code: 'engineMsg.review.chapterNotFound', fallback: '❌ 未找到章节文件' });
 * ```
 */
export function resolveUiMessage(message: UiMessageLike): string {
    if (typeof message === 'string') return message;
    if (!message.code || !hasMessage(message.code)) return message.fallback;
    return message.params ? t(message.code, message.params) : t(message.code);
}

/**
 * 构造 `UiMessage`（少写重复的 `fallback` 字段名，也让 IDE 能补全 code）。
 *
 * @param code - 资源键
 * @param fallback - 兜底中文
 * @param params - 插值参数
 * @returns 结构化消息
 * @example
 * ```ts
 * uiMessage('engineMsg.review.chapterNotFound', '❌ 未找到章节文件');
 * ```
 */
export function uiMessage(
    code: EngineMsgCode,
    fallback: string,
    params?: Record<string, string | number>,
): UiMessage {
    return params ? { code, fallback, params } : { code, fallback };
}

/**
 * 判断是否为结构化消息（供需要分支的调用方）。
 *
 * @param message - 消息
 * @returns 是否为 `UiMessage`
 * @example
 * ```ts
 * isUiMessage('纯文本'); // false
 * ```
 */
export function isUiMessage(message: UiMessageLike): message is UiMessage {
    return typeof message === 'object' && message !== null && typeof message.code === 'string';
}

/**
 * 给已有的 `UiMessage` 补上插值参数（不修改原对象）。
 *
 * **为什么需要**：带占位符的消息（如 `'❌ 审查失败: {error}'`）的 fallback 只能写在
 * 常量表里一处；调用点拿到运行时的值后，用本函数补 params 而不是重新 `uiMessage(...)`
 * ——否则 fallback 会散落回各个调用点，集中管理的意义就没了。
 *
 * @param message - 基础消息
 * @param params - 插值参数
 * @returns 带参数的新消息
 * @example
 * ```ts
 * withParams(REVIEW_MSG.failed, { error: 'timeout' });
 * ```
 */
export function withParams(
    message: UiMessage,
    params: Record<string, string | number>,
): UiMessage {
    return { ...message, params };
}
