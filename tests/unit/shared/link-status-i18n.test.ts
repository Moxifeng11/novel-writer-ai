/**
 * link-status-i18n.test.ts — 链路状态双语（缺口⑦ 跨层数据③，ZC-20261120-03）
 *
 * **稳定值契约（DSH 派单明确要求）**：agent 诊断（`formatLinkStatusForAgent`）的输出
 * 是 LLM 的输入，下游 repair-tools / diagnose-tools 可能对措辞做匹配。因此：
 * 1. `stage.name` / `status.breakpoint` / `status.title` 在 zh 与 en 下**逐字相等**
 *    （它们是稳定标识，不随语言漂移）；
 * 2. `stage.detail` 用 `t()` 求值，en 下全英文（给人看的说明）；
 * 3. `formatLinkStatusForAgent()` 的输出**始终是中文**（语言无关），并在注释里写明原因。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import {
    computeConstraintFlowStatus,
    computeKnowledgeFlowStatus,
    computeStyleFlowStatus,
    formatLinkStatusForAgent,
    linkTitle,
    stageDetail,
    stageName,
    type LinkStage,
    type LinkStatus,
} from '../../../shared/link-status-compute';

afterEach(() => {
    setLocale('zh-CN');
});

/** 覆盖 ok / broken / warn / unknown 四态 */
const knowledgeInputs = [
    { bookTotal: 0, breakdownCompleted: 0, vectorDone: 0, vectorFailed: 0, embeddingReady: false, storeReady: false, storeLoadedBooks: 0, orphanCount: 0 },
    { bookTotal: 3, breakdownCompleted: 0, vectorDone: 0, vectorFailed: 0, embeddingReady: true, storeReady: true, storeLoadedBooks: 0, orphanCount: 0 },
    { bookTotal: 3, breakdownCompleted: 3, vectorDone: 2, vectorFailed: 1, embeddingReady: true, storeReady: true, storeLoadedBooks: 2, orphanCount: 1 },
    { bookTotal: 3, breakdownCompleted: 3, vectorDone: 3, vectorFailed: 0, embeddingReady: true, storeReady: true, storeLoadedBooks: 3, orphanCount: 0 },
];

const styleInputs = [
    { templateCount: 0, globalCount: 0, projectCount: 0, enabledCount: 0, intensityDisabledCount: 0, embeddingReady: false },
    { templateCount: 2, globalCount: 0, projectCount: 0, enabledCount: 0, intensityDisabledCount: 0, embeddingReady: false },
    { templateCount: 1, globalCount: 2, projectCount: 1, enabledCount: 2, intensityDisabledCount: 1, embeddingReady: true },
    { templateCount: 0, globalCount: 1, projectCount: 1, enabledCount: 2, intensityDisabledCount: 0, embeddingReady: true },
];

const constraintInputs = [
    { sourceCount: 0, settingExists: false, reviewStatus: 'none' as const, bound: false, hasSubstance: false },
    { sourceCount: 2, settingExists: true, reviewStatus: 'approved' as const, bound: true, hasSubstance: true },
    { sourceCount: 0, settingExists: true, reviewStatus: 'pending' as const, bound: false, hasSubstance: false },
];

function allStatuses(): LinkStatus[] {
    return [
        ...knowledgeInputs.map(input => computeKnowledgeFlowStatus(input)),
        ...styleInputs.map(input => computeStyleFlowStatus(input as never)),
        ...constraintInputs.map(input => computeConstraintFlowStatus(input as never)),
    ];
}

/** 稳定标识：语言无关 */
function stableIds(statuses: LinkStatus[]) {
    return statuses.map(status => ({
        title: status.title,
        titleKey: status.titleKey,
        overall: status.overall,
        breakpoint: status.breakpoint,
        stages: status.stages.map((stage: LinkStage) => ({ name: stage.name, nameKey: stage.nameKey, status: stage.status })),
    }));
}

describe('链路状态双语（缺口⑦ 跨层数据③ · 稳定值契约）', () => {
    it('稳定值不变：name/breakpoint/title/overall 在 zh 与 en 下逐字相等', () => {
        setLocale('zh-CN');
        const zhIds = stableIds(allStatuses());
        setLocale('en-US');
        const enIds = stableIds(allStatuses());
        expect(enIds).toEqual(zhIds);
    });

    it('detail 按语言求值：en 全英文且无键名回退', () => {
        setLocale('en-US');
        for (const status of allStatuses()) {
            for (const stage of status.stages) {
                const detail = stageDetail(stage);
                expect(detail, `${status.title}/${stage.name}`).not.toMatch(/[\u4e00-\u9fff]/);
                expect(detail).not.toMatch(/linkStatus\./);
            }
        }
    });

    it('链路名与环节名按语言求值（zh 与原文一致）', () => {
        setLocale('zh-CN');
        const zhStatus = computeKnowledgeFlowStatus(knowledgeInputs[3]);
        expect(linkTitle(zhStatus)).toBe('知识流');
        expect(stageName(zhStatus.stages[0])).toBe('拆解');
        expect(stageName(zhStatus.stages[1])).toBe('向量化');

        setLocale('en-US');
        expect(linkTitle(zhStatus)).toBe('Knowledge flow');
        expect(stageName(zhStatus.stages[0])).toBe('Breakdown');
        expect(stageName(zhStatus.stages[1])).toBe('Vectorization');
    });

    it('agent 诊断输出始终中文（语言无关，刻意保留）', () => {
        const run = () => allStatuses().map(status => formatLinkStatusForAgent(status)).join('\n');
        setLocale('zh-CN');
        const zhText = run();
        setLocale('en-US');
        const enText = run();
        // 完全一致：agent/LLM 输入不随界面语言漂移
        expect(enText).toBe(zhText);
        expect(enText).toMatch(/[\u4e00-\u9fff]/);
    });

    it('未知环节名回落原值（新增环节不会显示键名）', () => {
        setLocale('en-US');
        const custom: LinkStage = { name: '自定义环节', status: 'ok', detail: 'x' };
        expect(stageName(custom)).toBe('自定义环节');
        expect(stageDetail({ name: 'y', status: 'ok', detail: '原说明' })).toBe('原说明');
    });
});
