import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTOSAVE_DELAY_MS } from '@/shared/interaction-timing';

function read(relative: string): string {
    return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

/**
 * 交互节拍单一真源（审计 A-4 / C 清单 #7）。
 *
 * 正文自动保存过去在协同写作视图、单元写作台、场景细纲各写一个数字，
 * 这里用源码级断言锁住「只有一处定义、三处都引用」。
 */
describe('交互节拍常量', () => {
    it('自动保存节拍是 1000ms（三处共用同一口径）', () => {
        expect(AUTOSAVE_DELAY_MS).toBe(1000);
    });

    it('三个消费方都引用常量而不是各自写数字', () => {
        const consumers = [
            'ui/co-writing-view.ts',
            'ui/full-writer/unit-writer-controller.ts',
            'ui/full-writer/scene-outline-controller.ts',
        ];
        for (const file of consumers) {
            const src = read(file);
            expect(src, file).toContain('AUTOSAVE_DELAY_MS');
            expect(src, file).toContain("from '@/shared/interaction-timing'");
            expect(src, file).not.toMatch(/const AUTOSAVE_DELAY_MS\s*=/);
        }
    });

    it('常量只在 shared/interaction-timing.ts 定义一次', () => {
        const src = read('shared/interaction-timing.ts');
        expect(src.match(/export const AUTOSAVE_DELAY_MS/g)?.length).toBe(1);
    });
});
