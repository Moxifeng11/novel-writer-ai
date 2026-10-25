import { describe, it, expect } from 'vitest';
import { KnowledgeInjector } from '../../../engine/knowledge-injector';
import type { InjectionContext } from '../../../engine/knowledge-injector';
import type { ChapterStateSnapshot, StoryBeat } from '../../../engine/story-state-types';

const BEATS: StoryBeat[] = [
    { id: 'b1', description: '在东市与线人接头', type: 'event', required: true },
];

function makeSnapshot(): ChapterStateSnapshot {
    return {
        chapterNumber: 3,
        timeline: { time: '第3天黄昏', location: '皇城东市' },
        povCharacter: '林晚',
        mainGoal: '拿到密信',
        coreConflict: '追兵将至',
        requiredBeats: [],
        requiredReveals: [],
        forbiddenReveals: ['主角是皇子'],
        characterStates: [
            {
                name: '林晚', emotion: '焦虑', injury: '左臂擦伤',
                goal: '找到信物', secret: '', relationships: '与萧然结盟',
            },
        ],
        previousEnding: { action: '', emotion: '', unfinished: '', mustContinue: '' },
        acceptanceCriteria: [],
    };
}

function makeContext(): InjectionContext {
    return {
        projectPath: '/test',
        outline: '林晚在东市与线人接头，追兵逼近。',
    };
}

const LONG_PROFILE = `${'设定'.repeat(800)}按需尾部标记`;

describe('KnowledgeInjector 知识注入预算', () => {
    it('未传预算时保持旧格式', async () => {
        const injector = new KnowledgeInjector(null as never);
        const result = await injector.injectForSceneBody(makeContext(), {
            snapshot: makeSnapshot(),
            beats: BEATS,
            candidates: [{ id: 'c1', name: '林晚', content: LONG_PROFILE, kind: 'character' }],
        });

        expect(result).toContain('## 写作指引');
        expect(result).toContain('### 本章必须遵循');
        expect(result).toContain('### 相关设定（按需注入）');
        expect(result).toContain('按需尾部标记');
    });

    it('预算充足时两段都保留', async () => {
        const injector = new KnowledgeInjector(null as never);
        const result = await injector.injectForSceneBody(makeContext(), {
            snapshot: makeSnapshot(),
            beats: BEATS,
            candidates: [{ id: 'c1', name: '林晚', content: '简短设定', kind: 'character' }],
            maxInputTokens: 4000,
        });

        expect(result).toContain('### 本章必须遵循');
        expect(result).toContain('### 相关设定（按需注入）');
        expect(result).toContain('简短设定');
    });

    it('预算紧张时截断按需层，必须层完整保留', async () => {
        const injector = new KnowledgeInjector(null as never);
        const result = await injector.injectForSceneBody(makeContext(), {
            snapshot: makeSnapshot(),
            beats: BEATS,
            candidates: [{ id: 'c1', name: '林晚', content: LONG_PROFILE, kind: 'character' }],
            maxInputTokens: 120,
        });

        expect(result).toContain('在东市与线人接头');
        expect(result).toContain('主角是皇子');
        expect(result).not.toContain('按需尾部标记');
        expect(result.length).toBeLessThan(LONG_PROFILE.length);
    });

    it('预算极小时丢弃按需层，必须层仍保留', async () => {
        const injector = new KnowledgeInjector(null as never);
        const result = await injector.injectForSceneBody(makeContext(), {
            snapshot: makeSnapshot(),
            beats: BEATS,
            candidates: [{ id: 'c1', name: '林晚', content: LONG_PROFILE, kind: 'character' }],
            maxInputTokens: 20,
        });

        expect(result).toContain('### 本章必须遵循');
        expect(result).toContain('在东市与线人接头');
        expect(result).not.toContain('相关设定（按需注入）');
    });
});
