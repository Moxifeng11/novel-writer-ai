import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

type HintCtx = {
    appliedHint: string | null;
    cursorHint: string;
    hintInput: { value: string };
    hintStateDisplay: {
        toggleClass: (cls: string, force?: boolean) => void;
        classList: { contains: (cls: string) => boolean };
    };
    facade: { setCursorHint: ReturnType<typeof vi.fn> };
    refreshHintState: () => void;
    applyHint: () => void;
};

function makeCtx(inputValue: string, appliedHint: string | null): HintCtx {
    const hiddenClasses = new Set<string>(['nw-u-d-none']);
    const ctx = {
        appliedHint,
        cursorHint: '',
        hintInput: { value: inputValue },
        hintStateDisplay: {
            toggleClass: (cls: string, force?: boolean) => {
                if (force) hiddenClasses.add(cls);
                else hiddenClasses.delete(cls);
            },
            classList: { contains: (cls: string) => hiddenClasses.has(cls) },
        },
        facade: { setCursorHint: vi.fn() },
    } as unknown as HintCtx;
    ctx.refreshHintState = CoWritingView.prototype['refreshHintState'];
    ctx.applyHint = CoWritingView.prototype['applyHint'];
    return ctx;
}

describe('CoWritingView — NBI-04 临时指令「已应用」状态标识', () => {
    it('TR-H1: 已应用且输入未改动 → 显示标识', () => {
        const ctx = makeCtx('下一段写雨夜追兵', '下一段写雨夜追兵');
        ctx.refreshHintState();
        expect(ctx.hintStateDisplay.classList.contains('nw-u-d-none')).toBe(false);
    });

    it('TR-H2: 修改任意字符 → 标识消失', () => {
        const ctx = makeCtx('下一段写雨夜追兵', '下一段写雨夜追兵');
        ctx.refreshHintState();
        expect(ctx.hintStateDisplay.classList.contains('nw-u-d-none')).toBe(false);

        ctx.hintInput.value = '下一段写雨夜追兵（改）';
        ctx.refreshHintState();
        expect(ctx.hintStateDisplay.classList.contains('nw-u-d-none')).toBe(true);
    });

    it('TR-H3: 再次回车应用成功 → 标识恢复，并同步 cursorHint', () => {
        const ctx = makeCtx('换成冷色调描写', null);
        ctx.applyHint();

        expect(ctx.cursorHint).toBe('换成冷色调描写');
        expect(ctx.facade.setCursorHint).toHaveBeenCalledWith('换成冷色调描写');
        expect(ctx.appliedHint).toBe('换成冷色调描写');
        expect(ctx.hintStateDisplay.classList.contains('nw-u-d-none')).toBe(false);
    });

    it('TR-H4: 清空输入并回车 → 记为已应用空指令，但标识隐藏', () => {
        const ctx = makeCtx('', '旧指令');
        ctx.applyHint();

        expect(ctx.cursorHint).toBe('');
        expect(ctx.appliedHint).toBe('');
        expect(ctx.hintStateDisplay.classList.contains('nw-u-d-none')).toBe(true);
    });

    it('TR-H5: 未应用任何指令 → 标识保持隐藏', () => {
        const ctx = makeCtx('随手输入但未回车', null);
        ctx.refreshHintState();
        expect(ctx.hintStateDisplay.classList.contains('nw-u-d-none')).toBe(true);
    });
});
