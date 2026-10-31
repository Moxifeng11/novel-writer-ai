/**
 * C1 — 双内核并存：注入 v1Engine 后，三个分析器必须被明确标记为「不生效」。
 *
 * 历史行为：QSE 在 v1Engine 存在时六维/总分全部取自 WritingQualityEngine，
 * rhythmAnalyzer / emotionAnalyzer / characterChecker 与 QSE_CALIBRATION 的
 * fallback 校准在生产路径完全不可达；quality-worker 与 heavy-task 仍在注入
 * characterChecker，调用方误以为逐人物比对已启用。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QualityScoreEngine, type ICharacterChecker } from '../../../../engine/quality/quality-score-engine';
import { WritingQualityEngine } from '../../../../engine/writing-quality-engine';

const TEXT = '林默推开木门，风灌进来，吹得桌上的信纸哗啦作响。他伸手按住纸角，指节发白。'
    .repeat(6);

/** 如果被调用，人物分会被拉到极低；V1 路径必须完全忽略它 */
function createHarshChecker(): ICharacterChecker {
    return {
        check: async () => ({
            overallScore: 1,
            characterResults: {},
            issues: [{ character: '林默', type: 'personality', description: '严重崩坏', severity: 'high' }],
        }),
    } as unknown as ICharacterChecker;
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('C1 — v1Engine 为唯一口径', () => {
    it('同时注入 v1Engine 与 checkers 时打一次 warn 并点名被忽略的分析器', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new QualityScoreEngine({
            v1Engine: new WritingQualityEngine(),
            characterChecker: createHarshChecker(),
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const message = warnSpy.mock.calls[0].map(String).join(' ');
        expect(message).toContain('v1Engine');
        expect(message).toContain('characterChecker');
    });

    it('只注入 v1Engine 时不打 warn（生产推荐配置）', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('注入 checker 后的结果必须与纯 V1 完全一致（证明 checker 未参与）', async () => {
        const pure = new QualityScoreEngine({ v1Engine: new WritingQualityEngine() });
        const withChecker = new QualityScoreEngine({
            v1Engine: new WritingQualityEngine(),
            characterChecker: createHarshChecker(),
        });

        const pureResult = await pure.evaluate(TEXT);
        const mixedResult = await withChecker.evaluate(TEXT);

        expect(mixedResult.overallScore).toBe(pureResult.overallScore);
        for (const dim of Object.keys(pureResult.dimensions) as Array<keyof typeof pureResult.dimensions>) {
            expect(mixedResult.dimensions[dim].score).toBe(pureResult.dimensions[dim].score);
        }
    });

    it('生产入口不得再向 QSE 注入 characterChecker（源码守卫）', () => {
        const files = [
            'engine/quality/quality-worker.ts',
            'engine/heavy-task-worker-manager.ts',
        ];

        for (const relative of files) {
            const source = stripComments(readFileSync(resolve(process.cwd(), relative), 'utf8'));
            const blocks = source.match(/new QualityScoreEngine\(\{[\s\S]*?\}\)/g) ?? [];
            expect(blocks.length, `${relative} 应至少构造一次 QualityScoreEngine`).toBeGreaterThan(0);
            for (const block of blocks) {
                expect(block, `${relative} 仍在向 QSE 注入无效分析器`).not.toContain('characterChecker');
            }
        }
    });
});
