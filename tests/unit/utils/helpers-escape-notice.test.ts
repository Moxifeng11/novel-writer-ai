/**
 * helpers-escape-notice.test.ts — F1/F2/F3 escapeHtml + M8 多流程进度通知
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeHtml, showProgress, hideProgress } from '../../../utils/helpers';
import { Notice } from 'obsidian';


describe('escapeHtml（F1/F2/F3 防 XSS）', () => {
    it('覆盖五大危险字符', () => {
        expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
        expect(escapeHtml('a&b')).toBe('a&amp;b');
        expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
        expect(escapeHtml("it's")).toBe('it&#39;s'); // F3：单引号补齐
    });

    it('恶意章节标题插值后不构成可执行标签', () => {
        const title = '</span><script>alert(1)</script>';
        const escaped = escapeHtml(title);
        expect(escaped).not.toContain('<script>');
        expect(escaped).toContain('&lt;script&gt;');
    });

    it('普通文本不变', () => {
        expect(escapeHtml('第3章 长夜未央')).toBe('第3章 长夜未央');
    });
});

describe('showProgress/hideProgress（M8 多流程隔离）', () => {
    const constructSpy = vi.fn();
    const hideSpy = vi.fn();

    beforeEach(() => {
        constructSpy.mockClear();
        hideSpy.mockClear();
        vi.spyOn(Notice.prototype, 'hide').mockImplementation(function (this: Notice) {
            hideSpy();
        });
        vi.spyOn(Notice.prototype, 'setMessage').mockImplementation(function (this: Notice) {
            return this;
        });
    });

    afterEach(() => {
        // 先还原 spy 再清槽位：清理动作不进入断言计数
        vi.restoreAllMocks();
        hideProgress('default');
        hideProgress('flow-a');
        hideProgress('flow-b');
    });

    it('默认槽位：同槽复用 Notice 并 setMessage（旧行为保持）', () => {
        showProgress('第一步');
        showProgress('第二步');
        expect(Notice.prototype.setMessage).toHaveBeenCalledWith('第二步');
    });

    it('不同 key 的并发流程各自独立，hide 互不干扰（M8 修复）', () => {
        showProgress('流程A进行中', 'flow-a');
        showProgress('流程B进行中', 'flow-b');

        // 流程 A 结束只 hide 自己
        hideProgress('flow-a');
        expect(hideSpy).toHaveBeenCalledTimes(1);

        // 流程 B 的槽位不受影响：再次 show 仍是 setMessage 复用
        showProgress('流程B更新', 'flow-b');
        expect(Notice.prototype.setMessage).toHaveBeenCalledWith('流程B更新');
    });

    it('hide 未注册 key 是安全空操作', () => {
        expect(() => hideProgress('never-exists')).not.toThrow();
    });
});
