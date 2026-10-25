import { describe, it, expect } from 'vitest';
import { assessContextReadiness } from '../../../engine/context-readiness';
import { buildStoryLinkage } from '../../../engine/story-linkage';
import type { GatheredContext } from '../../../engine/context/context-types';

function makeContext(overrides: Partial<GatheredContext['data']> = {}): GatheredContext {
    return {
        project: '测试项目',
        gatheredAt: '2026-10-24T00:00:00.000Z',
        issues: [],
        data: {
            character_state: [{ name: '沈渊' } as never],
            outline: { raw: '第1卷大纲：'.repeat(200), sections: [] },
            world_view: { raw: '世界观：九霄灵压体系。'.repeat(50), sections: [] },
            previous_chapter: {
                chapterNumber: 4,
                content: null,
                outline: null,
                ending: '上一章结尾：沈渊跳下废弃矿道，铜哨声从三个方向逼近。',
                analysisReport: null,
                continuityReview: null,
                infoPlan: null,
                bodySummary: null,
            },
            ...overrides,
        },
    };
}

describe('assessContextReadiness — 上下文输入完整性', () => {
    it('必做输入齐全时 ready=true', () => {
        const readiness = assessContextReadiness(makeContext(), 5);
        expect(readiness.ready).toBe(true);
        expect(readiness.requiredMissing).toEqual([]);
        expect(readiness.summary).toContain('输入完整');
    });

    it('缺人物时点名缺失，ready=false', () => {
        const readiness = assessContextReadiness(makeContext({ character_state: [] }), 5);
        expect(readiness.ready).toBe(false);
        expect(readiness.requiredMissing).toContain('人物状态');
    });

    it('世界观与设定库都为空时算缺失', () => {
        const readiness = assessContextReadiness(
            makeContext({ world_view: null, setting_lib: null }),
            5,
        );
        expect(readiness.ready).toBe(false);
        expect(readiness.requiredMissing).toContain('世界观 / 设定库');
    });

    it('首章不要求前章摘要，第 2 章起要求', () => {
        const first = assessContextReadiness(makeContext({ previous_chapter: null }), 1);
        expect(first.ready).toBe(true);

        const second = assessContextReadiness(makeContext({ previous_chapter: null }), 2);
        expect(second.ready).toBe(false);
        expect(second.requiredMissing).toContain('前章摘要 / 上章结尾');
    });

    it('context 为 null 时全部必做项缺失，不崩溃', () => {
        const readiness = assessContextReadiness(null, 3);
        expect(readiness.ready).toBe(false);
        expect(readiness.requiredMissing.length).toBeGreaterThanOrEqual(3);
        expect(readiness.summary).toContain('输入不完整');
    });

    it('展示条目包含条数/字数与失败模块', () => {
        const readiness = assessContextReadiness(
            makeContext({
                character_state: [{ name: 'A' }, { name: 'B' }] as never,
                _failedModules: ['伏笔'],
            }),
            5,
        );
        const chars = readiness.items.find((i) => i.key === 'character_state');
        expect(chars?.detail).toBe('2 人');
        const failed = readiness.items.find((i) => i.key === 'failed_modules');
        expect(failed?.ok).toBe(false);
        expect(failed?.detail).toContain('伏笔');
    });
});

describe('assessContextReadiness — Rev 186 关联索引', () => {
    it('未建立关联索引时显示「未建立」且不阻塞 ready', () => {
        const readiness = assessContextReadiness(makeContext(), 5);
        const item = readiness.items.find((i) => i.key === 'story_linkage');
        expect(item?.ok).toBe(false);
        expect(item?.required).toBe(false);
        expect(item?.detail).toContain('未建立');
        expect(readiness.ready).toBe(true);
    });

    it('有关联数据时显示到期/逾期/设定/规划计数与数据提示', () => {
        const linkage = buildStoryLinkage({
            chapterName: '第5章',
            chapterNum: 5,
            foreshadows: [
                { name: '残玉', plannedReveal: '第5章', relatedChars: '沈渊' },
                { name: '旧剑', plannedReveal: '第3章' },
                { name: '残玉', plannedReveal: '第5章', relatedChars: '沈渊' },
            ],
            settingTitles: ['沈渊'],
            planningText: '### 第5章 试炼\n- 沈渊进入试炼场',
        });
        const readiness = assessContextReadiness(makeContext({ story_linkage: linkage }), 5);
        const item = readiness.items.find((i) => i.key === 'story_linkage');
        expect(item?.ok).toBe(true);
        expect(item?.detail).toContain('到期 1');
        expect(item?.detail).toContain('逾期 1');
        expect(item?.detail).toContain('设定 1 条');
        expect(item?.detail).toContain('规划 2 段');
        expect(item?.detail).toContain('数据提示');
    });
});
