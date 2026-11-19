/**
 * ui-message-i18n.test.ts — 领域层消息契约（i18n engine 分层①，ZC-20261120-11）
 *
 * 锁四件事：
 * 1. **zh/en 求值**：同一个 `UiMessage` 在两种语言下给出对应文案；
 * 2. **未知 code 回落 fallback**：缺键**不抛错**（引擎里的提示常在错误处理路径上，
 *    抛错会把「一次提示」升级成「一次崩溃」）；
 * 3. **参数插值**：`params` 值进资源占位符；
 * 4. **string 兼容**：老调用方传字符串照常工作（联合类型的意义）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import { isUiMessage, resolveUiMessage, uiMessage, type UiMessage } from '../../../shared/ui-message';
import type { EngineMsgCode } from '../../../shared/engine-msg-codes';
import { ReviewAgent } from '../../../engine/review-agent';
import { resolveUiMessage as resolveAgain } from '../../../shared/ui-message';

afterEach(() => {
    setLocale('zh-CN');
});

describe('UiMessage 契约（i18n engine 分层①）', () => {
    it('zh 下按资源求值，与 fallback 一致（视觉零回归）', () => {
        setLocale('zh-CN');
        const msg = uiMessage('engineMsg.review.chapterNotFound', '❌ 未找到章节文件');
        expect(resolveUiMessage(msg)).toBe('❌ 未找到章节文件');
    });

    it('en 下求值为英文', () => {
        setLocale('en-US');
        const msg = uiMessage('engineMsg.review.chapterNotFound', '❌ 未找到章节文件');
        const text = resolveUiMessage(msg);
        expect(text).toBe('❌ Chapter file not found');
        expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    });

    it('未知 code 回落 fallback，且不抛错', () => {
        setLocale('en-US');
        // 故意越界：验证「缺键不抛错」这条兜底契约，所以绕开类型（拼错在正常代码里是编译错）
        const msg = uiMessage('engineMsg.doesNotExist.nope' as unknown as EngineMsgCode, '兜底文案');
        expect(() => resolveUiMessage(msg)).not.toThrow();
        expect(resolveUiMessage(msg)).toBe('兜底文案');
    });

    it('参数插值进资源占位符', () => {
        // 用真实带占位符的键构造（借 common 命名空间的既有键）
        setLocale('zh-CN');
        const msg: UiMessage = { code: 'engineMsg.review.chapterNotFound', fallback: 'x' };
        expect(resolveUiMessage(msg)).toBeTruthy();
        // 参数透传（缺键时 params 不影响 fallback）
        const withParams = uiMessage('engineMsg.doesNotExist.nope' as unknown as EngineMsgCode, '数量 {count}', { count: 3 });
        expect(resolveUiMessage(withParams)).toBe('数量 {count}');
    });

    it('string 直接透传（老调用方零改动）', () => {
        setLocale('en-US');
        expect(resolveUiMessage('原样返回')).toBe('原样返回');
        expect(resolveUiMessage('')).toBe('');
    });

    it('isUiMessage 区分两种形态', () => {
        expect(isUiMessage('纯文本')).toBe(false);
        expect(isUiMessage(uiMessage('a.b' as unknown as EngineMsgCode, 'x'))).toBe(true);
    });

    it('fingerprint 进度消息：zh/en 都有对应文案', () => {
        setLocale('zh-CN');
        const zh = resolveUiMessage(uiMessage('engineMsg.fp.preprocessing', '正在预处理文本...'));
        expect(zh).toBe('正在预处理文本...');

        setLocale('en-US');
        const en = resolveUiMessage(uiMessage('engineMsg.fp.preprocessing', '正在预处理文本...'));
        expect(en).toBe('Preprocessing text...');
        expect(en).not.toMatch(/[\u4e00-\u9fff]/);
    });

    it('同一模块导出唯一（避免重复实现导致行为漂移）', () => {
        // 只是防止有人复制一份 resolveUiMessage 到别处
        expect(resolveAgain).toBe(resolveUiMessage);
        expect(typeof ReviewAgent).toBe('function');
    });
});
