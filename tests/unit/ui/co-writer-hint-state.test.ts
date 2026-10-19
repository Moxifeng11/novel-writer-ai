import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

type HintCtx = {
    appliedHint: string | null;
    cursorHint: string;
    hintInput: { value: string };
    hintStateDisplay: { style: { display: string } };
    facade: { setCursorHint: ReturnType<typeof vi.fn> };
    refreshHintState: () => void;
    applyHint: () => void;
};

function makeCtx(inputValue: string, appliedHint: string | null): HintCtx {
    const ctx = {
        appliedHint,
        cursorHint: '',
        hintInput: { value: inputValue },
        hintStateDisplay: { style: { display: 'none' } },
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
        expect(ctx.hintStateDisplay.style.display).toBe('');
    });

    it('TR-H2: 修改任意字符 → 标识消失', () => {
        const ctx = makeCtx('下一段写雨夜追兵', '下一段写雨夜追兵');
        ctx.refreshHintState();
        expect(ctx.hintStateDisplay.style.display).toBe('');

        ctx.hintInput.value = '下一段写雨夜追兵（改）';
        ctx.refreshHintState();
        expect(ctx.hintStateDisplay.style.display).toBe('none');
    });

    it('TR-H3: 再次回车应用成功 → 标识恢复，并同步 cursorHint', () => {
        const ctx = makeCtx('换成冷色调描写', null);
        ctx.applyHint();

        expect(ctx.cursorHint).toBe('换成冷色调描写');
        expect(ctx.facade.setCursorHint).toHaveBeenCalledWith('换成冷色调描写');
        expect(ctx.appliedHint).toBe('换成冷色调描写');
        expect(ctx.hintStateDisplay.style.display).toBe('');
    });

    it('TR-H4: 清空输入并回车 → 记为已应用空指令，但标识隐藏', () => {
        const ctx = makeCtx('', '旧指令');
        ctx.applyHint();

        expect(ctx.cursorHint).toBe('');
        expect(ctx.appliedHint).toBe('');
        expect(ctx.hintStateDisplay.style.display).toBe('none');
    });

    it('TR-H5: 未应用任何指令 → 标识保持隐藏', () => {
        const ctx = makeCtx('随手输入但未回车', null);
        ctx.refreshHintState();
        expect(ctx.hintStateDisplay.style.display).toBe('none');
    });
});
