import { describe, it, expect, vi } from 'vitest';
import { Vault } from 'obsidian';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { CoWriterEngine, ContextSnapshot } from '../../../engine/co-writer-engine';
import { PromptBuilder } from '../../../engine/prompt-builder';
import { pjProjectMeta } from '../../../shared/paths';

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

function makeEngine(app: any = {}) {
    const aiEngine = {
        getPlugin: () => ({
            settings: {
                coWriteModelMode: 'local',
                coWriteLocalModel: 'qwen2.5:7b',
                coWriteMaxTokens: 600,
            },
        }),
        callAI: vi.fn(async () => ({ content: '' })),
    };
    const engine = new CoWriterEngine(app, aiEngine as any, { gatherAll: vi.fn() } as any) as any;
    engine.snapshot = makeSnapshot();
    engine.chapterBrief = null;
    engine.promptBuilder = new PromptBuilder(() => engine.snapshot);
    return engine;
}

const FANFIC_BLOCK = [
    '【同人创作约束（最高优先级，违反即返工）】',
    '原作：《测试原作》',
    '【原作核心设定】',
    '- 原作力量体系：灵脉九境，越境必遭反噬',
].join('\n');

const PROJECT = '测试项目';
const SETTING_PATH = '04-项目总控/同人设定/测试原作设定.md';

function seedFanficProject(vault: any, settingBody: string): void {
    vault._seedFile(
        pjProjectMeta(PROJECT),
        `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${SETTING_PATH}\n`
    );
    vault._seedFile(SETTING_PATH, settingBody);
}

describe('CoWriterEngine 同人约束接线', () => {
    it('snapshot.fanficRulesContext 会进入续写 prompt', () => {
        const engine = makeEngine();
        engine.snapshot.fanficRulesContext = FANFIC_BLOCK;

        const { user } = engine.buildDirectionalPrompt('前文一句。', 'action', '');

        expect(user).toContain('【同人创作约束（最高优先级，违反即返工）】');
        expect(user).toContain('灵脉九境');
    });

    it('原创项目（空上下文）不出现同人块', () => {
        const engine = makeEngine();

        const { user } = engine.buildDirectionalPrompt('前文一句。', 'action', '');

        expect(user).not.toContain('【同人创作约束');
    });
});

describe('CoWriterEngine 静态上下文刷新', () => {
    it('refreshStaticContext 不能把 init 阶段加载的运行时上下文清空', async () => {
        const vault = new Vault() as any;
        seedFanficProject(vault, '# 测试原作 同人设定\n\n**力量体系**：灵脉九境\n');
        const engine = makeEngine({ vault });
        engine.snapshot.longTermMemoryContext = '已确认事实：主角失忆';
        engine.snapshot.crossVolumeContext = '上一卷结尾：城破';
        engine.snapshot.relationshipStates = [{ from: '甲', to: '乙', relation: '师徒' }] as any;
        engine.contextManager.gatherAll = vi.fn(async () => ({ data: {} }));

        await engine.refreshStaticContext();

        // 同人约束在刷新时会从磁盘重读，因此这里验证的是「刷新后仍在」而不是旧值
        expect(engine.snapshot.fanficRulesContext).toContain('灵脉九境');
        expect(engine.snapshot.longTermMemoryContext).toBe('已确认事实：主角失忆');
        expect(engine.snapshot.crossVolumeContext).toBe('上一卷结尾：城破');
        expect(engine.snapshot.relationshipStates).toHaveLength(1);
    });
});

describe('CoWriterEngine 同人约束覆盖全部生成入口', () => {
    it('迭代与联想 prompt 同样携带同人约束', () => {
        const engine = makeEngine();
        engine.snapshot.fanficRulesContext = FANFIC_BLOCK;

        const iteratePrompt = engine.promptBuilder.buildIteratePrompt('原候选一句话。', '前文一句话。', '更克制一些');
        const associationPrompt = engine.promptBuilder.buildAssociationPrompt('上下文一句话。', {
            type: 'dialogue',
            confidence: 0.9,
        });

        expect(iteratePrompt).toContain('灵脉九境');
        expect(associationPrompt).toContain('灵脉九境');
    });
});

describe('CoWriterEngine 同人人物按章节上下文选取', () => {
    const eightCharacters = Array.from(
        { length: 8 },
        (_, index) => `- **人物名**：角色${index + 1}\n  - **原作定位**：定位${index + 1}\n`,
    ).join('');

    it('本次已写正文提到第 8 位角色时，约束块包含该角色', async () => {
        const vault = new Vault() as any;
        seedFanficProject(vault, `# 测试原作 同人设定\n\n## 主要人物\n${eightCharacters}\n`);
        const engine = makeEngine({ vault });

        await engine.syncFanficRules(PROJECT, '角色8 推门进来，众人回头。');

        expect(engine.snapshot.fanficRulesContext).toContain('角色8');
        expect(engine.snapshot.fanficRulesContext).not.toContain('角色7');
    });

    it('没有已写正文时用本章大纲做相关度', async () => {
        const vault = new Vault() as any;
        seedFanficProject(vault, `# 测试原作 同人设定\n\n## 主要人物\n${eightCharacters}\n`);
        const engine = makeEngine({ vault });
        engine.snapshot.chapPlan = '本章：角色8 登场，与主角对峙。';

        await engine.syncFanficRules(PROJECT);

        expect(engine.snapshot.fanficRulesContext).toContain('角色8');
        expect(engine.snapshot.fanficRulesContext).not.toContain('角色7');
    });
});

describe('CoWriterEngine 同人设定热更新', () => {
    it('syncFanficRules 读取磁盘约束', async () => {
        const vault = new Vault() as any;
        seedFanficProject(vault, '# 测试原作 同人设定\n\n**世界观类型**：修真\n**力量体系**：灵脉九境\n');
        const engine = makeEngine({ vault });

        await engine.syncFanficRules(PROJECT);

        expect(engine.snapshot.fanficRulesContext).toContain('灵脉九境');
    });

    it('设定文件被编辑后，下一次生成前会读到新内容', async () => {
        const vault = new Vault() as any;
        seedFanficProject(vault, '# 测试原作 同人设定\n\n**力量体系**：灵脉九境\n');
        const engine = makeEngine({ vault });
        await engine.syncFanficRules(PROJECT);
        expect(engine.snapshot.fanficRulesContext).toContain('灵脉九境');

        // 用户在同人设定里把力量体系改了（未切章）
        vault._seedFile(SETTING_PATH, '# 测试原作 同人设定\n\n**力量体系**：金丹九转\n');
        await engine.syncFanficRules(PROJECT);

        expect(engine.snapshot.fanficRulesContext).toContain('金丹九转');
        expect(engine.snapshot.fanficRulesContext).not.toContain('灵脉九境');
    });
});
