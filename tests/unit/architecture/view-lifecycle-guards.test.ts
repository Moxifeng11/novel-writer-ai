import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * L3-1（维度①三轮）：视图 onOpen 的 await 续体必须在视图关闭后失效。
 *
 * 三个具体约束：
 * 1. full-writer-view：onOpen 起手 begin()，每个 await 后核对，注册监听前再核对一次；
 *    onClose 必须 invalidate（否则 Component unload 后仍注册监听）。
 * 2. knowledge-base-view：同一个 View 实例重新 attach 时 viewClosed 必须复位，
 *    否则调度器订阅回调永久静默（viewClosed 只置 true 从不清）。
 * 3. 两个视图都不得在 await 之后才第一次订阅而不加守卫。
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('视图生命周期代次守卫接线', () => {
    const fw = read('ui/full-writer-view.ts');
    const kb = read('ui/views/knowledge-base-view.ts');

    it('full-writer：onOpen begin + await 后核对 + 注册监听前核对，onClose invalidate', () => {
        expect(fw).toContain('const openToken = this.openGuard.begin();');
        expect(fw.match(/this\.openGuard\.isCurrent\(openToken\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
        expect(fw).toContain('this.openGuard.invalidate();');

        // 注册监听必须发生在 onOpen 的 await 之后；此时必须已有一次代次核对
        const registerIdx = fw.indexOf("this.app.workspace.on('file-open'");
        const guardIdx = fw.lastIndexOf('this.openGuard.isCurrent(openToken)', registerIdx);
        expect(registerIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(registerIdx);
    });

    it('knowledge-base：onOpen 复位 viewClosed 并 begin，onClose 置位并 invalidate', () => {
        const onOpenStart = kb.indexOf('async onOpen()');
        const onOpenEnd = kb.indexOf('async onClose()');
        const onOpenBody = kb.slice(onOpenStart, onOpenEnd);

        expect(onOpenBody).toContain('this.viewClosed = false;');
        expect(onOpenBody).toContain('const openToken = this.openGuard.begin();');

        // 复位必须发生在首个 await 之前（否则 await 期间的回调仍被旧值拦截）
        const resetIdx = onOpenBody.indexOf('this.viewClosed = false;');
        const firstAwaitIdx = onOpenBody.indexOf('await ');
        expect(resetIdx).toBeGreaterThan(-1);
        expect(firstAwaitIdx).toBeGreaterThan(-1);
        expect(resetIdx).toBeLessThan(firstAwaitIdx);

        expect(kb).toContain('this.openGuard.invalidate();');
        expect(kb).toMatch(/async onClose\(\)[\s\S]*?this\.viewClosed = true;/);
    });
});
