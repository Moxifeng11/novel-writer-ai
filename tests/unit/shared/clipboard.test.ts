import { describe, expect, it, vi } from 'vitest';
import { copyText } from '@/shared/clipboard';

describe('copyText', () => {
    it('优先用 navigator.clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        await expect(copyText('hi')).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith('hi');
        vi.unstubAllGlobals();
    });

    it('clipboard 抛错时降级 execCommand', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        const execCommand = vi.fn().mockReturnValue(true);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        vi.stubGlobal('document', {
            createElement: () => ({ value: '', setAttribute: () => {}, style: {}, select: () => {} }),
            body: { appendChild: () => {}, removeChild: () => {} },
            execCommand,
        });
        await expect(copyText('x')).resolves.toBe(true);
        expect(execCommand).toHaveBeenCalledWith('copy');
        vi.unstubAllGlobals();
    });

    it('都不可用返回 false 而不是抛错', async () => {
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('document', undefined);
        await expect(copyText('x')).resolves.toBe(false);
        vi.unstubAllGlobals();
    });
});
