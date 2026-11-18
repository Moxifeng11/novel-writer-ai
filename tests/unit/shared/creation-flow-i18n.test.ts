/**
 * creation-flow-i18n.test.ts — 创作流程双语（缺口⑦ 跨层数据②，ZC-20261120-02）
 *
 * **硬验收**（DSH 派单明确要求）：语言只影响展示文案，**不影响流程推进**。
 * 因此这里对每个模式、每种事实组合，逐项断言：
 * 1. stage.id / state / primaryAction / ratio / nextStageId / overallRatio 在 zh 与 en 下完全相等；
 * 2. 展示字段（label / description / progressText / ctaLabel / blockedReason）在 en 下全英文、
 *    且不出现键名回退；
 * 3. zh 下展示文案与迁移前逐字一致（零回归）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, t } from '../../../i18n';
import {
    resolveCreationFlow,
    formatCreationFlowSummary,
    stageDesc,
    stageLabel,
    type CreationFlowFacts,
} from '../../../shared/creation-flow';
import type { CreationMode } from '../../../shared/creation-mode';

afterEach(() => {
    setLocale('zh-CN');
});

/** 覆盖「全空 / 部分 / 全满 / 有正文但未结算」四类事实 */
function factMatrix(): CreationFlowFacts[] {
    return [
        {
            preResearchDone: false,
            docs: {},
            unitTotal: 0,
            unitTarget: 20,
            unitWritten: 0,
            nextUnitNumber: 1,
            exportExists: false,
        },
        {
            preResearchDone: true,
            docs: { storyCore: true, outline: true },
            unitTotal: 3,
            unitTarget: 20,
            unitWritten: 1,
            nextUnitNumber: 2,
            exportExists: false,
        },
        {
            preResearchDone: true,
            docs: { storyCore: true, outline: true, bible: true, storyboard: true },
            unitTotal: 3,
            unitTarget: 3,
            unitWritten: 3,
            unitSettled: 3,
            nextUnitNumber: null,
            exportExists: true,
        },
        {
            preResearchDone: false,
            docs: {},
            unitTotal: 2,
            unitTarget: 10,
            unitWritten: 2,
            unitSettled: 1,
            nextUnitNumber: null,
            exportExists: false,
        },
    ];
}

const MODES: CreationMode[] = ['long', 'short', 'script'];

/** 只取「行为字段」——语言无关的部分 */
function behaviorOf(snapshot: ReturnType<typeof resolveCreationFlow>) {
    return {
        overallRatio: snapshot.overallRatio,
        nextStageId: snapshot.nextStageId,
        nextUnitNumber: snapshot.nextUnitNumber,
        stages: snapshot.stages.map(stage => ({
            id: stage.id,
            state: stage.state,
            ratio: stage.ratio,
            primaryAction: stage.primaryAction,
            blockedBy: stage.blockedBy,
        })),
    };
}

describe('创作流程双语（缺口⑦ 跨层数据② · 硬验收）', () => {
    it('语言不影响流程推进：zh 与 en 的行为字段逐项相等', () => {
        for (const mode of MODES) {
            for (const facts of factMatrix()) {
                setLocale('zh-CN');
                const zhSnap = resolveCreationFlow(mode, '示例项目', facts);
                setLocale('en-US');
                const enSnap = resolveCreationFlow(mode, '示例项目', facts);
                expect(behaviorOf(enSnap), `${mode} / ${JSON.stringify(facts)}`).toEqual(behaviorOf(zhSnap));
            }
        }
    });

    it('zh：阶段名/描述/进度/按钮与迁移前逐字一致', () => {
        setLocale('zh-CN');
        const longSnap = resolveCreationFlow('long', '示例项目', factMatrix()[0]);
        expect(longSnap.stages.map(s => s.label)).toEqual([
            '初始化与全书规划',
            '章节写作',
            '章节结算',
            '成稿导出',
        ]);
        expect(longSnap.stages[0].progressText).toBe('尚未完成初始化向导');
        expect(longSnap.stages[0].ctaLabel).toBe('去完成初始化向导');
        // 无骨架时按钮模板是「创建 N 章骨架」——该阶段因前置未完成处于 blocked，
        // 按钮会换成「先完成：<前置阶段>」，所以这里断言模板本身与 blocked 文案
        expect(longSnap.stages[1].ctaLabel).toBe('先完成：初始化与全书规划');
        expect(longSnap.stages[1].progressText).toBe('尚未创建章节骨架');
        expect(t('creationFlow.cta.createUnitsWithTarget', { count: 20, unit: '章' })).toBe('创建 20 章骨架');

        const scriptSnap = resolveCreationFlow('script', '示例项目', factMatrix()[1]);
        expect(scriptSnap.stages.map(s => s.label)).toEqual([
            '前期调研',
            '分集大纲',
            '分镜表',
            '分集写作',
            '导出成稿',
        ]);

        const shortSnap = resolveCreationFlow('short', '示例项目', factMatrix()[1]);
        expect(shortSnap.stages.map(s => s.label)).toEqual(['前期调研', '分节大纲', '分节写作', '导出成稿']);
        expect(formatCreationFlowSummary(shortSnap)).toContain('下一步：');
    });

    it('en：阶段名/描述/进度/按钮/总览全英文，且无键名回退', () => {
        setLocale('en-US');
        for (const mode of MODES) {
            for (const facts of factMatrix()) {
                const snap = resolveCreationFlow(mode, '示例项目', facts);
                for (const stage of snap.stages) {
                    const fields = [stage.label, stage.description, stage.progressText, stage.ctaLabel, stage.blockedReason ?? ''];
                    for (const field of fields) {
                        expect(field, `${mode}/${stage.id}`).not.toMatch(/[\u4e00-\u9fff]/);
                        expect(field, `${mode}/${stage.id}`).not.toMatch(/creationFlow\./);
                    }
                }
                const summary = formatCreationFlowSummary(snap);
                // 项目名是 vault 数据（本用例固定「示例项目」），只校验模板部分
                expect(summary.replace('示例项目', '')).not.toMatch(/[\u4e00-\u9fff]/);
                expect(summary).not.toMatch(/creationFlow\./);
            }
        }
    });

    it('stageLabel/stageDesc 随语言切换，缺键时回落中文兜底', () => {
        setLocale('zh-CN');
        const zhSnap = resolveCreationFlow('long', '示例项目', factMatrix()[0]);
        expect(stageLabel(zhSnap.stages[0])).toBe('初始化与全书规划');
        expect(stageDesc(zhSnap.stages[0])).toBe('世界观、人物、势力与分卷章节规划');

        setLocale('en-US');
        expect(stageLabel(zhSnap.stages[0])).toBe('Setup & full-book planning');
        expect(stageDesc(zhSnap.stages[0])).toBe('Worldview, characters, factions and volume/chapter planning');

        // 无键的自定义阶段：回落原中文（保证新加阶段不显示键名）
        expect(stageLabel({ id: 'x', label: '自定义阶段', description: '自定义描述', action: 'wizard', weight: 1 }))
            .toBe('自定义阶段');
    });
});
