import { describe, it, expect, vi } from 'vitest';
import { GuideAgentEngine } from '../../../engine/agent/conversation-engine';
import type { AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';

const ctx: AgentContext = { projects: ['长篇小说/旧书'], activeProject: '长篇小说/旧书' };

function makeEngine(port?: GuideAgentPort) {
    return new GuideAgentEngine(ctx, port);
}

async function startAt(engine: GuideAgentEngine, type: 'long' | 'short' | 'script') {
    engine.start();
    return engine.handle(type);
}

describe('GuideAgentEngine — 项目类型入口', () => {
    it('最前端先给长篇/短篇/剧本三个类型入口', () => {
        const turn = makeEngine().start();
        const labels = turn.messages.flatMap(m => m.chips || []).map(c => c.label);
        expect(labels.some(l => l.includes('长篇小说'))).toBe(true);
        expect(labels.some(l => l.includes('短篇小说'))).toBe(true);
        expect(labels.some(l => l.includes('剧本'))).toBe(true);
        expect(labels.some(l => l.includes('继续现有项目'))).toBe(true);
    });

    it('无项目时不显示继续入口', () => {
        const engine = new GuideAgentEngine({ projects: [], activeProject: null });
        const labels = engine.start().messages.flatMap(m => m.chips || []).map(c => c.label);
        expect(labels.some(l => l.includes('继续'))).toBe(false);
    });

    it('长篇先进入原创/同人分叉', async () => {
        const engine = makeEngine();
        const turn = await startAt(engine, 'long');
        const labels = turn.messages.flatMap(m => m.chips || []).map(c => c.label);
        expect(labels.some(l => l.includes('原创'))).toBe(true);
        expect(labels.some(l => l.includes('同人'))).toBe(true);
    });

    it('取消立即结束', async () => {
        const engine = makeEngine();
        engine.start();
        expect((await engine.handle('取消')).done).toBe(true);
    });
});

describe('GuideAgentEngine — 长篇原创路径', () => {
    it('频道 → 题材 → 结构 → 基调/金手指 → 创建 intent', async () => {
        const engine = makeEngine();
        await startAt(engine, 'long');
        await engine.handle('原创');
        let turn = await engine.handle('引导模式');
        expect(turn.messages.at(-1)?.text).toContain('项目名');

        await engine.handle('九霄逆行');
        turn = await engine.handle('男频');
        expect(turn.messages.at(-1)?.text).toContain('题材');
        await engine.handle('玄幻');
        turn = await engine.handle('三幕式');
        expect(turn.messages.at(-1)?.text).toContain('基调');
        await engine.handle('跳过');
        turn = await engine.handle('跳过');
        expect(turn.messages.at(-1)?.text).toContain('信息收集完毕');

        const confirmed = await engine.handle('确认创建');
        expect(confirmed.intent.kind).toBe('create_long_project');
        if (confirmed.intent.kind === 'create_long_project') {
            expect(confirmed.intent.params.projectType).toBe('original');
            expect(confirmed.intent.params.channel).toBe('男频');
            expect(confirmed.intent.params.storySettings.structureId).toBe('three_act');
        }
    });

    it('重复项目名被拒绝', async () => {
        const engine = makeEngine();
        await startAt(engine, 'long');
        await engine.handle('原创');
        await engine.handle('引导模式');
        const turn = await engine.handle('旧书');
        expect(turn.messages.at(-1)?.text).toContain('已存在');
    });
});

describe('GuideAgentEngine — 长篇同人路径', () => {
    it('追问原作、同人类型与改动范围', async () => {
        const engine = makeEngine();
        await startAt(engine, 'long');
        await engine.handle('同人');
        let turn = await engine.handle('引导模式');
        expect(turn.messages.at(-1)?.text).toContain('项目名');

        await engine.handle('同人测试书');
        turn = await engine.handle('斗罗大陆');
        expect(turn.messages.at(-1)?.text).toContain('题材');
        await engine.handle('玄幻');
        turn = await engine.handle('玄幻');
        expect(turn.messages.at(-1)?.text).toContain('同人类型');
        await engine.handle('CP向');
        turn = await engine.handle('平行世界');
        expect(turn.messages.at(-1)?.text).toContain('故事结构');
        await engine.handle('英雄之旅');
        await engine.handle('跳过');
        const confirmed = await engine.handle('确认创建');
        expect(confirmed.intent.kind).toBe('create_long_project');
        if (confirmed.intent.kind === 'create_long_project') {
            expect(confirmed.intent.params.projectType).toBe('fanfic');
            expect(confirmed.intent.params.sourceWork).toBe('斗罗大陆');
            expect(confirmed.intent.params.fanficType).toBe('CP向');
            expect(confirmed.intent.params.canonScope).toBe('平行世界');
        }
    });
});

describe('GuideAgentEngine — 短篇路径', () => {
    it('短平快节点：分类 → 故事核 → 冲突 → 情绪 → 反转 → 结尾', async () => {
        const engine = makeEngine();
        await startAt(engine, 'short');
        let turn = await engine.handle('引导模式');
        expect(turn.messages.at(-1)?.text).toContain('项目名');
        await engine.handle('短篇测试书');
        turn = await engine.handle('婚姻家庭');
        expect(turn.messages.at(-1)?.text).toContain('一句话故事');
        await engine.handle('被离婚的全职主妇发现丈夫转移财产，她要夺回女儿抚养权');
        await engine.handle('丈夫与婆家联手隐瞒财产');
        await engine.handle('先虐后爽，最后当众清算');
        await engine.handle('两次反转：财产证据反杀、女儿主动选择母亲');
        await engine.handle('女主拿到抚养权并重新开始事业');
        turn = await engine.handle('她最怕失去女儿，也最恨被当成无用的人');
        expect(turn.messages.at(-1)?.text).toContain('信息收集完毕');

        const confirmed = await engine.handle('确认创建');
        expect(confirmed.intent.kind).toBe('create_short_project');
        if (confirmed.intent.kind === 'create_short_project') {
            expect(confirmed.intent.params.projectName).toBe('短篇测试书');
            expect(confirmed.intent.params.targetSections).toBe(20);
            expect(confirmed.intent.params.preResearch.primaryCategory).toBe('婚姻家庭');
            expect(confirmed.intent.params.preResearch.endingPayoff).toContain('抚养权');
        }
    });
});

describe('GuideAgentEngine — 剧本路径', () => {
    it('补齐类型/钩子/角色/场景/集数/卡点', async () => {
        const engine = makeEngine();
        await startAt(engine, 'script');
        let turn = await engine.handle('引导模式');
        expect(turn.messages.at(-1)?.text).toContain('项目名');
        await engine.handle('短剧测试');
        turn = await engine.handle('都市逆袭');
        expect(turn.messages.at(-1)?.text).toContain('logline');
        await engine.handle('被当众羞辱的外卖员其实是隐退战神，他要护住妹妹');
        await engine.handle('妹妹被豪门当众泼酒');
        await engine.handle('身份压制与保护家人');
        await engine.handle('旧部集结、身份曝光、当众反杀');
        await engine.handle('主角、妹妹、豪门少爷、旧部首领');
        await engine.handle('宴会羞辱、仓库围堵、旧部集结');
        turn = await engine.handle('80');
        expect(turn.messages.at(-1)?.text).toContain('付费卡点');
        turn = await engine.handle('12');
        expect(turn.messages.at(-1)?.text).toContain('信息收集完毕');

        const confirmed = await engine.handle('确认创建');
        expect(confirmed.intent.kind).toBe('create_script_project');
        if (confirmed.intent.kind === 'create_script_project') {
            expect(confirmed.intent.params.projectName).toBe('短剧测试');
            expect(confirmed.intent.params.preResearch.targetEpisodes).toBe(80);
            expect(confirmed.intent.params.preResearch.paywallEpisode).toBe(12);
            expect(confirmed.intent.params.preResearch.scriptGenre).toBe('都市逆袭');
        }
    });
});

describe('GuideAgentEngine — 执行模式与自动链路', () => {
    it('长篇原创自动模式一次填完并立即产出创建 intent', async () => {
        const engine = makeEngine();
        await startAt(engine, 'long');
        await engine.handle('原创');
        const started = performance.now();
        const turn = await engine.handle('自动模式');
        const elapsed = performance.now() - started;

        expect(elapsed).toBeLessThan(500);
        expect(turn.intent.kind).toBe('create_long_project');
        expect(engine.getSlots().executionMode).toBe('auto');
        expect(engine.getSlots().projectName).toBeTruthy();
        expect(engine.getSlots().structureId).toBeTruthy();
        expect(engine.getSlots().channel).toBeTruthy();
        expect(turn.messages.some(m => m.text.includes('自动模式'))).toBe(true);
    });

    it('短篇/剧本自动模式都能直接产出创建 intent', async () => {
        const shortEngine = makeEngine();
        await startAt(shortEngine, 'short');
        const shortTurn = await shortEngine.handle('自动模式');
        expect(shortTurn.intent.kind).toBe('create_short_project');
        if (shortTurn.intent.kind === 'create_short_project') {
            expect(shortTurn.intent.params.preResearch.primaryCategory).toBeTruthy();
            expect(shortTurn.intent.params.preResearch.premise.length).toBeGreaterThanOrEqual(10);
        }

        const scriptEngine = makeEngine();
        await startAt(scriptEngine, 'script');
        const scriptTurn = await scriptEngine.handle('自动模式');
        expect(scriptTurn.intent.kind).toBe('create_script_project');
        if (scriptTurn.intent.kind === 'create_script_project') {
            expect(scriptTurn.intent.params.preResearch.targetEpisodes).toBe(80);
            expect(scriptTurn.intent.params.preResearch.scriptGenre).toBeTruthy();
        }
    });

    it('引导模式中可随时输入「自动完成」切换并保留已填值', async () => {
        const engine = makeEngine();
        await startAt(engine, 'long');
        await engine.handle('原创');
        await engine.handle('引导模式');
        await engine.handle('九霄逆行');
        const turn = await engine.handle('自动完成');
        expect(turn.intent.kind).toBe('create_long_project');
        expect(engine.getSlots().projectName).toBe('九霄逆行');
        expect(engine.getSlots().executionMode).toBe('auto');
    });

    it('关键选项提供预期效果、适用场景与风险说明', async () => {
        const engine = makeEngine();
        engine.start();
        await engine.handle('long');
        const turn = await engine.handle('原创');
        const modeChips = turn.messages.flatMap(m => m.chips || []);
        expect(modeChips.some(c => c.description && c.bestFor)).toBe(true);
        expect(modeChips.some(c => c.risk)).toBe(true);
    });
});

describe('GuideAgentEngine — 交互韧性', () => {
    it('AI 解析可一次填多个槽位', async () => {
        const aiParse = vi.fn(async () => ({
            projectName: '长夜行',
            channel: '女频',
            genre: '悬疑',
            structureId: 'kishotenketsu',
        }));
        const engine = makeEngine({ aiParse } as unknown as GuideAgentPort);
        await startAt(engine, 'long');
        await engine.handle('原创');
        await engine.handle('引导模式');
        const turn = await engine.handle('叫长夜行，女频，悬疑，用序破急');
        expect(aiParse).toHaveBeenCalled();
        expect(engine.getSlots().projectName).toBe('长夜行');
        expect(engine.getSlots().channel).toBe('女频');
        expect(engine.getSlots().structureId).toBe('kishotenketsu');
        expect(turn.messages.at(-1)?.text).toContain('基调');
    });

    it('上一步回到前一个槽位并清空该值', async () => {
        const engine = makeEngine();
        await startAt(engine, 'long');
        await engine.handle('原创');
        await engine.handle('引导模式');
        await engine.handle('九霄逆行');
        await engine.handle('男频');
        await engine.handle('上一步');
        expect(engine.getSlots().channel).toBeUndefined();
        expect(engine.getSlots().projectName).toBe('九霄逆行');
    });

    it('继续现有项目自动选中并打开向导', async () => {
        const engine = makeEngine();
        engine.start();
        let turn = await engine.handle('继续现有项目');
        expect(turn.messages.at(-1)?.text).toContain('已选择');
        turn = await engine.handle('打开项目向导');
        expect(turn.intent).toEqual({ kind: 'open_wizard', project: '长篇小说/旧书' });
    });

    it('创建成功回填后提供后续入口', async () => {
        const engine = makeEngine();
        await startAt(engine, 'short');
        await engine.handle('引导模式');
        await engine.handle('短篇测试书');
        await engine.handle('婚姻家庭');
        await engine.handle('一句话故事一句话故事');
        await engine.handle('核心冲突核心冲突');
        await engine.handle('情绪承诺');
        await engine.handle('反转设计反转');
        await engine.handle('结尾兑现结尾');
        await engine.handle('主角核心主角');
        await engine.handle('确认创建');
        const turn = engine.reportAction('create_short_project', { ok: true, projectId: '短篇小说/短篇测试书' });
        expect(turn.messages.at(-1)?.text).toContain('创建完成');
        const labels = turn.messages.at(-1)?.chips?.map(c => c.label) || [];
        expect(labels.some(l => l.includes('前期调研'))).toBe(true);

        const research = await engine.handle('编辑前期调研');
        expect(research.intent).toEqual({ kind: 'open_pre_research', mode: 'short', project: '短篇小说/短篇测试书' });
    });
});

describe('GuideAgentEngine — 确认阶段的否定词', () => {
    async function reachConfirm() {
        const engine = makeEngine();
        await startAt(engine, 'long');
        await engine.handle('原创');
        await engine.handle('引导模式');
        await engine.handle('九霄逆行');
        await engine.handle('男频');
        await engine.handle('玄幻');
        await engine.handle('三幕式');
        await engine.handle('跳过');
        const turn = await engine.handle('跳过');
        expect(turn.messages.at(-1)?.text).toContain('信息收集完毕');
        return engine;
    }

    it('「不是这个」不会被当成确认创建', async () => {
        const engine = await reachConfirm();

        const turn = await engine.handle('不是这个');

        expect(turn.intent.kind).not.toBe('create_long_project');
        expect(turn.intent.kind).toBe('none');
    });

    it('「不好，重新来」同样不创建', async () => {
        const engine = await reachConfirm();

        const turn = await engine.handle('不好，重新来');

        expect(turn.intent.kind).not.toBe('create_long_project');
    });
});
