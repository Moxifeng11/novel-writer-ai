import { describe, expect, it, vi } from 'vitest';
import { appendSanitizedHtml, setSanitizedHtml } from '../../../../ui/rendering/safe-html';

/**
 * innerHTML 清零（4.81.0 社区审核）。
 *
 * 社区审核的 `no-unsanitized/property` 不接受 `innerHTML =`，唯一豁免是值经过
 * `sanitizeHTMLToDom`。这里钉住封装行为：替换前先 empty、追加不清空、
 * 空字符串不产生多余 fragment。
 */

function makeEl() {
    return {
        empty: vi.fn(),
        appendChild: vi.fn(),
    } as unknown as HTMLElement;
}

describe('setSanitizedHtml', () => {
    it('先清空再 append 清洗后的 fragment', () => {
        const el = makeEl();

        setSanitizedHtml(el, '<b>hi</b>');

        expect(el.empty).toHaveBeenCalledTimes(1);
        expect(el.appendChild).toHaveBeenCalledTimes(1);
        expect(el.appendChild).toHaveBeenCalledWith(expect.objectContaining({
            html: '<b>hi</b>',
            sanitized: true,
        }));
    });

    it('两次替换不会叠加旧内容（empty 先执行）', () => {
        const el = makeEl();
        setSanitizedHtml(el, '<i>a</i>');
        setSanitizedHtml(el, '<i>b</i>');

        expect(el.empty).toHaveBeenCalledTimes(2);
        const lastArg = (el.appendChild as unknown as { mock: { calls: unknown[][] } }).mock.calls[1][0];
        expect(lastArg).toMatchObject({ html: '<i>b</i>' });
    });
});

describe('appendSanitizedHtml', () => {
    it('只追加，不清空', () => {
        const el = makeEl();

        appendSanitizedHtml(el, '<span>x</span>');

        expect(el.empty).not.toHaveBeenCalled();
        expect(el.appendChild).toHaveBeenCalledTimes(1);
    });

    it('空字符串直接跳过，不生成空 fragment', () => {
        const el = makeEl();

        appendSanitizedHtml(el, '');

        expect(el.appendChild).not.toHaveBeenCalled();
    });
});
