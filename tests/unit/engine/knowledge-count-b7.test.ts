/**
 * B7 — 「已注入 N 条知识库片段」必须按预算裁剪后实际保留的条数计数。
 *
 * 历史实现：检索到几条就写几条（`generateDirectionalCandidate` / `suggestStream` /
 * 改写 / 迭代四处），而 prompt 装配会把 knowledge 段整段丢弃或从尾部截断，
 * 于是提示与事实不符。这里锁定：
 * 1. 纯函数按「完整出现」计数；
 * 2. 超预算时引擎写实际保留数 + 未注入数；
 * 3. 无裁剪时文案不变。
 */

import { describe, it, expect, vi } from 'vitest';

const noticeLog = vi.hoisted(() => [] as Array<{ message: string; timeout?: number }>);

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class Notice {
        message: string;
        timeout?: number;
        constructor(message: string, timeout?: number) {
            this.message = message;
            this.timeout = timeout;
            noticeLog.push({ message, timeout });
        }
        setMessage(): this {
            return this;
        }
        hide(): void {}
    }
    return { ...actual, Notice };
});

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { countRetainedPromptParts } from '../../../shared/prompt-budget';
import { CoWriterEngine, ContextSnapshot } from '../../../engine/co-writer-engine';
import { PromptBuilder } from '../../../engine/prompt-builder';
import { CoWritingView } from '../../../ui/co-writing-view';

function makeSnapshot(): ContextSnapshot {
    return {
        project: '测试项目',
        chapterName: '第1章',
        allChars: '',
        allFactions: '',
        allLocs: '',
        allItems: '',
        foreshadows: { unrevealed: [], revealed: [], abandoned: [] },
        relationshipStates: [],
        crossVolumeContext: '',
        longTermMemoryContext: '',
        fanficRulesContext: '',
        worldView: '',
        worldType: '',
        writingStyle: '',
        writingRules: '',
        protagonistSoulDetail: '',
        emotionPlan: '',
        sceneExpansion: '',
        chapPlan: '',
        prevChaptersSummary: '',
        settingLib: '',
        timeline: '',
        characterCores: '',
        triggeredMemories: '',
        precedingText: '',
        cursorHint: '',
        currentMode: 'continue',
        gatheredAt: Date.now(),
        dirtyFields: new Set(),
    };
}

function makeEngine() {
    const aiEngine = {
        getPlugin: () => ({
            settings: {
                coWriteModelMode: 'local',
                coWriteModel: 'qwen2.5:7b',
                coWriteLocalModel: 'qwen2.5:7b',
                coWriteMaxTokens: 600,
            },
        }),
        callAI: vi.fn(async () => ({ content: '' })),
    };
    const engine = new CoWriterEngine({} as any, aiEngine as any, { gatherAll: vi.fn() } as any) as any;
    engine.snapshot = makeSnapshot();
    engine.chapterBrief = null;
    engine.promptBuilder = new PromptBuilder(() => engine.snapshot);
    engine.referenceBookIds = ['参考书'];
    engine.annotateSuggestionRisk = (suggestion: unknown) => suggestion;
    engine.callCoWriteAIStream = async function* () {
        return { content: '他抬头看向星图，低声说了一句。' };
    };
    return engine;
}

async function drainStream(engine: any): Promise<void> {
    const stream = engine.suggestStream('前文一句。', '', 'continue', 0);
    while (true) {
        const result = await stream.next();
        if (result.done) break;
    }
}

describe('B7 — countRetainedPromptParts', () => {
    it('完整保留的条目全部计数，空白条目忽略', () => {
        expect(countRetainedPromptParts(['片段一', '', '  ', '片段二'], '片段一\n片段二')).toBe(2);
    });

    it('被截断到一半的条目不计入', () => {
        expect(countRetainedPromptParts(['片段一完整内容', '片段二完整内容'], '片段一完整内容\n片段二完')).toBe(1);
    });

    it('整段丢弃与空 prompt 都归零', () => {
        expect(countRetainedPromptParts(['片段一', '片段二'], '')).toBe(0);
        expect(countRetainedPromptParts(['片段一', '片段二'], '只有已写内容')).toBe(0);
    });
});

describe('B7 — 引擎按实际注入条数记账', () => {
    it('预算充足时计数等于检索条数，且无未注入条目', async () => {
        const engine = makeEngine();
        engine.promptBuilder.getKnowledgePromptParts = vi.fn(async () => ['片段一', '片段二']);

        await drainStream(engine);

        expect(engine.lastKnowledgeCount).toBe(2);
        expect(engine.lastKnowledgeDroppedCount).toBe(0);
    });

    it('预算极小时 knowledge 段被整段丢弃：注入数为 0，未注入数等于检索条数', async () => {
        const engine = makeEngine();
        engine.promptBuilder.getKnowledgePromptParts = vi.fn(async () => [
            `【参考片段一】${'内容'.repeat(400)}`,
            `【参考片段二】${'内容'.repeat(400)}`,
        ]);
        engine.getCoWriteInputBudget = () => ({ maxInputTokens: 600, modelId: 'qwen2.5:7b' });

        await drainStream(engine);

        expect(engine.lastKnowledgeCount).toBe(0);
        expect(engine.lastKnowledgeDroppedCount).toBe(2);
    });

    it('本次检索失败时两个计数都归零，不沿用上一次数字', async () => {
        const engine = makeEngine();
        engine.promptBuilder.getKnowledgePromptParts = vi.fn(async () => {
            throw new Error('向量库不可用');
        });
        engine.lastKnowledgeCount = 3;
        engine.lastKnowledgeDroppedCount = 2;

        await drainStream(engine);

        expect(engine.lastKnowledgeCount).toBe(0);
        expect(engine.lastKnowledgeDroppedCount).toBe(0);
    });
});

describe('B7 — 提示文案', () => {
    function showNotice(facade: { lastKnowledgeCount: number; lastKnowledgeDroppedCount?: number }) {
        const host = { facade, warnFanficRulesOnce: vi.fn() };
        (CoWritingView.prototype as unknown as {
            showKnowledgeInjectionNotice: (this: typeof host) => void;
        }).showKnowledgeInjectionNotice.call(host);
    }

    it('无裁剪时文案保持原样', () => {
        noticeLog.length = 0;
        showNotice({ lastKnowledgeCount: 2, lastKnowledgeDroppedCount: 0 });
        expect(noticeLog.map(n => n.message)).toEqual(['✅ 完成\n已注入 2 条知识库片段']);
    });

    it('部分裁剪时补充未注入数量', () => {
        noticeLog.length = 0;
        showNotice({ lastKnowledgeCount: 2, lastKnowledgeDroppedCount: 1 });
        expect(noticeLog.map(n => n.message)).toEqual(['✅ 完成\n已注入 2 条知识库片段（另 1 条因预算不足未注入）']);
    });

    it('全部被裁剪时提示不再谎称已注入', () => {
        noticeLog.length = 0;
        showNotice({ lastKnowledgeCount: 0, lastKnowledgeDroppedCount: 3 });
        expect(noticeLog.map(n => n.message)).toEqual(['⚠️ 注意\n知识库片段因预算不足未注入（3 条）']);
    });
});
