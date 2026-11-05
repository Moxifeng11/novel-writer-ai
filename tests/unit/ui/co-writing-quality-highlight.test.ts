import { describe, it, expect, vi, beforeAll } from 'vitest';
import { walkTextNodes } from '../../../ui/co-writing/quality-highlight';

/**
 * walkTextNodes 决定质量问题能定位到哪些文本节点：
 * 跳过 SCRIPT / STYLE / MARK，避免把脚本内容或已高亮标记再次替换。
 */
beforeAll(() => {
    (globalThis as Record<string, unknown>).Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
});

type FakeNode = {
    nodeType: number;
    nodeName?: string;
    childNodes?: FakeNode[];
    textContent?: string;
};

function fakeText(text: string): FakeNode {
    return { nodeType: 3, nodeName: '#text', textContent: text };
}

describe('co-writing quality-highlight walkTextNodes', () => {
    it('遇到文本节点直接回调', () => {
        const seen: string[] = [];
        walkTextNodes(fakeText('正文') as unknown as Node, (node) => seen.push(node.textContent || ''));
        expect(seen).toEqual(['正文']);
    });

    it('递归子节点并保持顺序', () => {
        const root: FakeNode = {
            nodeType: 1,
            nodeName: 'DIV',
            childNodes: [fakeText('第一段'), fakeText('第二段')],
        };
        const seen: string[] = [];
        walkTextNodes(root as unknown as Node, (node) => seen.push(node.textContent || ''));
        expect(seen).toEqual(['第一段', '第二段']);
    });

    it('跳过 SCRIPT / STYLE / MARK 子树', () => {
        const root: FakeNode = {
            nodeType: 1,
            nodeName: 'DIV',
            childNodes: [
                { nodeType: 1, nodeName: 'SCRIPT', childNodes: [fakeText('脚本')] },
                { nodeType: 1, nodeName: 'STYLE', childNodes: [fakeText('样式')] },
                { nodeType: 1, nodeName: 'MARK', childNodes: [fakeText('已高亮')] },
                fakeText('正文'),
            ],
        };
        const fn = vi.fn((node: Text) => node.textContent);
        walkTextNodes(root as unknown as Node, fn);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn.mock.calls[0][0].textContent).toBe('正文');
    });
});
