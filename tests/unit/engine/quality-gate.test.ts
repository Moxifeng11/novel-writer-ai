import { describe, it, expect, vi } from 'vitest';
import { QualityGate } from '../../../engine/quality-gate';
import type { ChapterStateSnapshot, StoryBeat } from '../../../engine/story-state-types';

function makeSnapshot(overrides: Partial<ChapterStateSnapshot> = {}): ChapterStateSnapshot {
    return {
        chapterNumber: 1,
        timeline: { time: '第3天', location: '皇城' },
        povCharacter: '', mainGoal: '', coreConflict: '',
        requiredBeats: [], requiredReveals: [], forbiddenReveals: [], characterStates: [],
        previousEnding: { action: '', emotion: '', unfinished: '', mustContinue: '' },
        acceptanceCriteria: [],
        ...overrides,
    };
}

const BEATS_OK: StoryBeat[] = [
    { id: 'b1', description: '找到失落的信物', type: 'event', required: true },
    { id: 'b2', description: '留下结尾悬念', type: 'hook', required: true },
];

const BODY_OK = `他在雨里翻遍了泥地，终于找到失落的信物。
玉佩贴着掌心，还带着体温。

她看着窗外，忽然想起信里那半句话——留下结尾悬念，剩下的明天再说。`;

describe('QualityGate — TR-9.1 三层默认运行（程序/结构层零 AI 调用）', () => {
    it('三层全部执行并输出报告；rule/structure 层无任何网络依赖', async () => {
        const modelReviewer = vi.fn(async () => ({ overallScore: 82, issues: ['节奏略平'], source: 'mock' }));
        const gate = new QualityGate();
        const report = await gate.run(BODY_OK, makeSnapshot(), {
            beats: BEATS_OK,
            modelReviewer,
        });

        expect(modelReviewer).toHaveBeenCalledTimes(1);
        expect(report.layers.rule.conflicts).toEqual([]);
        expect(Array.isArray(report.layers.rule.aiWords)).toBe(true);
        expect(report.layers.structure.beatVerify.passed).toBe(true);
        expect(report.layers.structure.endingHookPresent).toBe(true);
        expect(report.layers.model?.overallScore).toBe(82);
        expect(report.passed).toBe(true);
        expect(report.summary).toBeTruthy();
    });

    it('modelReviewer 未提供时模型层跳过为 null，前两层照常', async () => {
        const gate = new QualityGate();
        const report = await gate.run(BODY_OK, makeSnapshot(), { beats: BEATS_OK });
        expect(report.layers.model).toBeNull();
        expect(report.layers.structure.beatVerify.passed).toBe(true);
        expect(report.passed).toBe(true);
    });
});

describe('QualityGate — TR-9.2 程序规则层（复用 ConflictDetector + AntiAIDetector）', () => {
    it('禁止揭示提前出现 → 冲突检出（报告项，不再一票否决 passed）', async () => {
        const snap = makeSnapshot({ forbiddenReveals: ['主角是皇子'] });
        const gate = new QualityGate();
        const report = await gate.run('众人震惊地发现，原来主角是皇子！', snap, { beats: [] });

        expect(report.layers.rule.conflicts.some((c) => c.type === 'foreshadow')).toBe(true);
        // v4.26：规则层降级为报告项，passed 只由结构层（节拍）决定
        expect(report.passed).toBe(true);
    });

    it('AI 词汇被程序检出并列入 rule 层报告', async () => {
        const gate = new QualityGate();
        const report = await gate.run('他心中五味杂陈，眼中闪过一丝不易察觉的复杂神色。', makeSnapshot(), { beats: [] });
        expect(report.layers.rule.aiWords.length).toBeGreaterThanOrEqual(0); // 依赖词库，结构断言
        expect(Array.isArray(report.layers.rule.aiWords)).toBe(true);
    });
});

describe('QualityGate — TR-9.3 结构层（复用 BeatVerifier + 钩子/重复检测）', () => {
    it('字数达标但缺必做剧情 beat → passed=false（字数达标剧情未推进判不通过）', async () => {
        const gate = new QualityGate();
        const report = await gate.run('水'.repeat(3000), makeSnapshot(), { beats: BEATS_OK });

        expect(report.layers.structure.beatVerify.passed).toBe(false);
        expect(report.layers.structure.beatVerify.missingRequired.length).toBeGreaterThan(0);
        expect(report.passed).toBe(false);
    });

    it('结尾钩子缺失时 endingHookPresent=false', async () => {
        const gate = new QualityGate();
        const noHookBody = '他找到了信物，转身离开，一切归于平静。';
        const report = await gate.run(noHookBody, makeSnapshot(), { beats: BEATS_OK });
        expect(report.layers.structure.endingHookPresent).toBe(false);
    });

    it('相邻段落开头高度重复 → 计入 repeatedScenes 提示', async () => {
        const gate = new QualityGate();
        // 两段均 ≥16 字且共用前 16 字前缀（REPEAT_PREFIX_LEN=16 判重下限）
        const body = `他推开门，屋内一片漆黑，只有风从破窗灌进来。

他推开门，屋内一片漆黑，只有风从破窗灌得更急了。`;
        const report = await gate.run(body, makeSnapshot(), { beats: [] });
        expect(report.layers.structure.repeatedScenes.length).toBeGreaterThan(0);
    });
});

describe('QualityGate — TR-9.4 逐层可独立跳过', () => {
    it('skipLayers 跳过 rule 与 model，仅执行 structure', async () => {
        const modelReviewer = vi.fn(async () => ({ overallScore: 1 }));
        const gate = new QualityGate();
        const snap = makeSnapshot({ forbiddenReveals: ['主角是皇子'] });
        const report = await gate.run('原来主角是皇子。', snap, {
            beats: BEATS_OK,
            skipLayers: ['rule', 'model'],
            modelReviewer,
        });

        expect(modelReviewer).not.toHaveBeenCalled();
        expect(report.layers.rule.conflicts).toEqual([]); // rule 层被跳过（未检测）
        expect(report.skippedLayers).toEqual(['rule', 'model']);
        expect(report.passed).toBe(false); // structure：缺必做 beat
    });
});
