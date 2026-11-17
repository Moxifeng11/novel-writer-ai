/**
 * 智能扩写弹窗写回契约（功能缺口 #1）
 *
 * 背景：`applyResult()` 原先只弹「已应用扩写结果」就关窗，两个入口
 * （命令面板 / 协同写作）都没有接写回，`getExpandedText()` 全仓无调用者——
 * 用户点「应用」后正文一个字都没变。现在改为：
 * - 传 `onApply` → 回调真正落盘，成功才关窗，失败留窗（结果不丢）；
 * - 不传 `onApply` → 退化为复制到剪贴板，绝不出现「提示成功、实际没变」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubDocument } from './support/fake-dom';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

const { OutlineExpandModal } = await import('../../../ui/outline-expand-modal');

type WriteBack = (text: string) => void | Promise<void>;

function makeModal(onApply?: WriteBack) {
    const plugin = { aiEngine: {}, knowledgeInjector: undefined } as never;
    const modal = new OutlineExpandModal(
        {} as never,
        plugin,
        '原始大纲',
        onApply ? { onApply } : undefined,
    );
    const close = vi.spyOn(modal, 'close').mockImplementation(() => {});
    return { modal, close };
}

/** 直接设置结果文本（跳过 onOpen 的渲染与 AI 调用） */
function prime(modal: object, text: string): void {
    (modal as unknown as { expandedText: string }).expandedText = text;
}

function apply(modal: object): Promise<void> {
    return (modal as { applyResult: () => Promise<void> }).applyResult();
}

beforeEach(() => {
    stubDocument();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('OutlineExpandModal 应用结果（写回正文）', () => {
    it('有写回目标：回调收到去掉首尾空白的正文，成功后关窗', async () => {
        const seen: string[] = [];
        const { modal, close } = makeModal(text => { seen.push(text); });
        prime(modal, '  \n扩写后的正文\n  ');

        await apply(modal);

        expect(seen).toEqual(['扩写后的正文']);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('回调抛错：不关窗，结果留在弹窗里可重试', async () => {
        const { modal, close } = makeModal(() => { throw new Error('写盘失败'); });
        prime(modal, '扩写后的正文');

        await expect(apply(modal)).resolves.toBeUndefined();

        expect(close).not.toHaveBeenCalled();
        expect((modal as unknown as { expandedText: string }).expandedText).toBe('扩写后的正文');
    });

    it('回调异步失败：同样不关窗', async () => {
        const { modal, close } = makeModal(async () => { throw new Error('vault 拒绝写入'); });
        prime(modal, '扩写后的正文');

        await apply(modal);

        expect(close).not.toHaveBeenCalled();
    });

    it('没有写回目标：退化为复制到剪贴板并关窗', async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        const { modal, close } = makeModal();
        prime(modal, '扩写后的正文');

        await apply(modal);

        expect(writeText).toHaveBeenCalledWith('扩写后的正文');
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('没有写回目标且剪贴板不可用：不关窗（不制造假成功）', async () => {
        vi.stubGlobal('navigator', {});
        const { modal, close } = makeModal();
        prime(modal, '扩写后的正文');

        await apply(modal);

        expect(close).not.toHaveBeenCalled();
    });

    it('结果为空：不调用回调也不关窗', async () => {
        const onApply = vi.fn();
        const { modal, close } = makeModal(onApply);
        prime(modal, '   \n  ');

        await apply(modal);

        expect(onApply).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
});
