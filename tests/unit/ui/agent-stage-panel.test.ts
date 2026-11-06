/**
 * agent-stage-panel.test.ts — 工作台阶段面板视图模型
 */
import { describe, expect, it } from 'vitest';
import { resolveCreationFlow } from '../../../shared/creation-flow';
import { buildStagePanelModel, buildStagePrompt } from '../../../ui/agent-workbench/stage-panel';

const BASE_FACTS = {
    preResearchDone: false,
    docs: {},
    unitTotal: 0,
    unitTarget: 0,
    unitWritten: 0,
    nextUnitNumber: null,
    exportExists: false,
};

describe('buildStagePanelModel', () => {
    it('长篇：真实阶段、进度与下一步来自统一快照', () => {
        const flow = resolveCreationFlow('long', '长篇小说/示例', {
            ...BASE_FACTS,
            wizardDone: true,
            unitTotal: 10,
            unitWritten: 5,
            unitSettled: 4,
            nextUnitNumber: 6,
        });
        const model = buildStagePanelModel(flow, '长篇小说/示例');

        expect(model.modeLabel).toBe('长篇小说');
        expect(model.percent).toBe(56);
        expect(model.nextLabel).toBe('章节写作');
        expect(model.items.map(item => item.id)).toEqual(['wizard', 'chapters', 'settlement', 'export']);
        expect(model.items[1].ratioPercent).toBe(50);
        expect(model.items[1].state).toBe('active');
        expect(model.items[3].state).toBe('blocked');
        expect(model.items[3].progressText).toContain('先完成');
        expect(model.emptyText).toBe('');
    });

    it('短篇：前置完成后进入分节写作，导出被依赖阻塞', () => {
        const flow = resolveCreationFlow('short', '短篇小说/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 20,
            unitTarget: 20,
            nextUnitNumber: 1,
        });
        const model = buildStagePanelModel(flow, '短篇小说/示例');

        expect(model.modeLabel).toBe('短篇小说');
        expect(model.items.map(item => item.id)).toEqual(['research', 'outline', 'units', 'export']);
        expect(model.items[0].state).toBe('done');
        expect(model.items[2].state).toBe('active');
        expect(model.items[3].state).toBe('blocked');
        expect(model.items[3].progressText).toContain('先完成');
        expect(model.nextLabel).toBe('分节写作');
    });

    it('剧本：五阶段含分镜表，下一步停在分镜表', () => {
        const flow = resolveCreationFlow('script', '剧本/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true, storyboard: false },
            unitTotal: 12,
            unitWritten: 0,
            nextUnitNumber: 1,
        });
        const model = buildStagePanelModel(flow, '剧本/示例');

        expect(model.items.map(item => item.id)).toEqual(['research', 'outline', 'storyboard', 'units', 'export']);
        expect(model.items[2].state).toBe('active');
        expect(model.items[3].state).toBe('todo');
        expect(model.items[4].state).toBe('blocked');
        expect(model.nextLabel).toBe('分镜表');
    });

    it('剧本：分镜表完成后进入分集写作', () => {
        const flow = resolveCreationFlow('script', '剧本/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true, storyboard: true },
            unitTotal: 12,
            unitWritten: 0,
            nextUnitNumber: 1,
        });
        const model = buildStagePanelModel(flow, '剧本/示例');

        expect(model.items[3].state).toBe('active');
        expect(model.nextLabel).toBe('分集写作');
    });

    it('剧本：预填话术带分集单元标签', () => {
        const flow = resolveCreationFlow('script', '剧本/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 12,
            nextUnitNumber: 1,
        });
        const unitStage = flow.stages.find(stage => stage.id === 'units');
        expect(unitStage).toBeTruthy();
        expect(buildStagePrompt(unitStage!)).toContain('继续「分集写作」');
        expect(buildStagePrompt(unitStage!)).toContain('集');
    });

    it('无项目/无快照时给出占位文案而不是硬编码阶段', () => {
        expect(buildStagePanelModel(null, '').emptyText).toContain('未选择项目');
        expect(buildStagePanelModel(undefined, '长篇小说/示例').emptyText).toContain('阶段读取失败');
        expect(buildStagePanelModel(null, '').items).toEqual([]);
    });
});

describe('buildStagePrompt', () => {
    it('普通阶段生成可预填的一句话', () => {
        const flow = resolveCreationFlow('long', '长篇小说/示例', {
            ...BASE_FACTS,
            wizardDone: true,
            unitTotal: 10,
            unitWritten: 5,
            nextUnitNumber: 6,
        });
        const prompt = buildStagePrompt(flow.stages[1]);
        expect(prompt).toContain('继续「章节写作」');
        expect(prompt).toContain('继续写第6章');
    });

    it('阻塞阶段带上原因', () => {
        const flow = resolveCreationFlow('short', '短篇小说/示例', {
            ...BASE_FACTS,
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 20,
            unitTarget: 20,
            nextUnitNumber: 1,
        });
        const exportStage = flow.stages[3];
        expect(buildStagePrompt(exportStage)).toContain('先完成');
    });
});
