import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * L2-1（维度①二轮）：卸载屏障必须真正接在插件卸载路径上，且 drain 早于
 * disposeAll；协同正文保存与 Agent 会话 flush 必须登记进屏障。
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('UnloadBarrier 接线', () => {
    const main = read('main.ts');

    it('onunload 先 close，detach 后有界 drain，且早于 disposeAll', () => {
        expect(main).toContain('this._unloadBarrier.close()');
        const drainIdx = main.indexOf('await this._unloadBarrier.drain(2500)');
        const disposeIdx = main.indexOf('this.engineRegistry?.disposeAll()');
        expect(drainIdx).toBeGreaterThan(-1);
        expect(disposeIdx).toBeGreaterThan(drainIdx);
    });

    it('启动期 timer 有卸载守卫', () => {
        expect(main).toContain('if (this._isUnloaded) return;');
        expect(main).toContain('this.register(() => window.clearTimeout(reopenTimer))');
        expect(main).toContain('this.register(() => window.clearTimeout(updateTimer))');
    });

    it('协同保存与 Agent 会话 flush 登记进屏障', () => {
        expect(read('ui/co-writing-view.ts')).toContain('_unloadBarrier?.track(savePromise)');
        expect(read('ui/agent-workbench-view.ts')).toContain('_unloadBarrier?.track(flushPromise)');
    });
});
