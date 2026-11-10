/**
 * D3-13（维度② r3）：协同写作 onClose 必须把整个关闭流程同步登记进卸载屏障。
 *
 * 旧实现先 await saveHistory()，之后才 track(saveBody)；插件卸载 detach 叶子
 * 不 await onClose，drain 看到空集合立即返回 → 旧实例保存可能在新实例启动后落盘。
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWritingView } from '../../../ui/co-writing-view';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('CoWritingView.onClose — 屏障同步登记', () => {
    it('track 在 performClose 完成前就已登记（早于任何 await）', async () => {
        let resolveClose: (() => void) | null = null;
        const tracked: Array<Promise<unknown>> = [];

        const view = Object.create(CoWritingView.prototype) as Record<string, unknown>;
        view.performClose = () => new Promise<void>((resolve) => { resolveClose = resolve; });
        view.plugin = {
            _unloadBarrier: {
                track: (promise: Promise<unknown>) => {
                    tracked.push(promise);
                    return promise;
                },
            },
        };

        const closing = (view as unknown as { onClose: () => Promise<void> }).onClose();

        // 尚未 resolve performClose，但登记已经发生
        expect(tracked).toHaveLength(1);
        expect(resolveClose).not.toBeNull();

        resolveClose!();
        await closing;
    });

    it('契约：onClose 同步 track(performClose)，performClose 内部不再单独 track 保存', () => {
        const src = read('ui/co-writing-view.ts');
        const onCloseIdx = src.indexOf('async onClose() {');
        const trackIdx = src.indexOf('this.plugin?._unloadBarrier?.track(closing)', onCloseIdx);
        const awaitIdx = src.indexOf('await closing;', onCloseIdx);
        expect(onCloseIdx).toBeGreaterThan(-1);
        expect(trackIdx).toBeGreaterThan(onCloseIdx);
        expect(awaitIdx).toBeGreaterThan(trackIdx);

        // 旧写法（先 await 历史再 track savePromise）不得回潮
        expect(src).not.toContain('this.plugin?._unloadBarrier?.track(savePromise)');
        expect(src).toContain('private async performClose()');
    });
});
