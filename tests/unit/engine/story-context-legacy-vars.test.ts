import { describe, expect, it } from 'vitest';
import { formatStoryContextLegacyVars } from '../../../engine/context/story-context-graph';
import { applyStoryContextToVars } from '../../../engine/context/story-context-service';

/** 最小化 bundle：只测 legacy 映射，不跑图构建 */
function makeBundle(foreshadowStates: string[]): any {
    return {
        byKind: {
            worldview: [{ text: '节点世界观（被截断的 3200 字版本）' }],
            setting: [],
            character: [],
            faction: [],
            location: [],
            item: [],
            timeline: [],
            emotion: [],
            scene: [],
            foreshadow: foreshadowStates.map((state, i) => ({
                title: `伏笔${i}`,
                text: `伏笔${i}`,
                compactText: `伏笔${i}`,
                metadata: { state, legacyLine: `[${i}] 伏笔${i}（${state}）` },
            })),
        },
        formattedCrossLink: '',
        telemetry: { estimatedTokens: 0 },
        tier: 'cloud',
    };
}

describe('story-context — 只注入当前章该处理的伏笔', () => {
    it('later/upcoming/revealed 不进 unrevealedForeshadow', () => {
        const legacy = formatStoryContextLegacyVars(makeBundle(['due', 'overdue', 'later', 'upcoming', 'revealed', 'abandoned', 'unknown']));
        expect(legacy.unrevealedForeshadow).toContain('伏笔0');
        expect(legacy.unrevealedForeshadow).toContain('伏笔1');
        expect(legacy.unrevealedForeshadow).toContain('伏笔6');
        expect(legacy.unrevealedForeshadow).not.toContain('伏笔2'); // later
        expect(legacy.unrevealedForeshadow).not.toContain('伏笔3'); // upcoming
        expect(legacy.unrevealedForeshadow).not.toContain('伏笔4'); // revealed
    });
});

describe('story-context — 不静默缩短已注入的段', () => {
    it('worldView 已有更长压缩版时不被 3200 字节选覆盖', () => {
        const long = '长世界观'.repeat(2000);
        const vars: Record<string, string> = { worldView: long };
        applyStoryContextToVars(vars, makeBundle([]), { worldView: long } as any);
        expect(vars.worldView).toBe(long);
    });

    it('worldView 为空时用节点版补上', () => {
        const vars: Record<string, string> = {};
        applyStoryContextToVars(vars, makeBundle([]));
        expect(vars.worldView).toContain('节点世界观');
    });

    it('按章过滤过的伏笔列表不被节点版（含后续章节）覆盖', () => {
        const filtered = '[9] 第3章到期伏笔';
        const vars: Record<string, string> = { unrevealedForeshadow: filtered };
        applyStoryContextToVars(vars, makeBundle(['due', 'later']), { unrevealedForeshadow: filtered } as any);
        expect(vars.unrevealedForeshadow).toBe(filtered);
    });
});
