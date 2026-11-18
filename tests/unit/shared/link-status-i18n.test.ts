/**
 * link-status-i18n.test.ts — 链路状态双语（缺口⑦ 跨层数据③→⑦）
 *
 * 本测试在 ZC-20261120-07 之后重写。原版锁的是「中文双份字段在 zh/en 下逐字相等」，
 * 现在双份字段已删除（key 是唯一真源），所以断言改为锁真正的契约：
 *
 * 1. **key 稳定**：`nameKey`/`detailKey`/`titleKey`/`breakpointKey` 与语言完全无关
 *    （它们是结构标识，不该随 setLocale 变）；
 * 2. **展示按语言求值**：en 下全英文、无键名回退；
 * 3. **agent 输出固定中文**：`formatLinkStatusForAgent()` 在 en 界面下与 zh 逐字相等
 *    —— 这是删除双份字段后，保证「agent 输入不漂移」的唯一机制。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import {
    computeConstraintFlowStatus,
    computeKnowledgeFlowStatus,
    computeStyleFlowStatus,
    formatLinkStatusForAgent,
    linkBreakpointName,
    linkTitle,
    stageDetail,
    stageName,
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
    { sourceCount: 0, settingExists: false, reviewStatus: 'none' as const, bound: false, rulesHasContent: false },
    { sourceCount: 2, settingExists: true, reviewStatus: 'approved' as const, bound: true, rulesHasContent: true },
    { sourceCount: 0, settingExists: true, reviewStatus: 'pending' as const, bound: false, rulesHasContent: false },
];

function allStatuses(): LinkStatus[] {
    return [
        ...knowledgeInputs.map(input => computeKnowledgeFlowStatus(input)),
        ...styleInputs.map(input => computeStyleFlowStatus(input)),
        ...constraintInputs.map(input => computeConstraintFlowStatus(input)),
    ];
}

/** 只取结构标识：这些必须与语言无关 */
function structuralIds(statuses: LinkStatus[]) {
    return statuses.map(status => ({
        titleKey: status.titleKey,
        overall: status.overall,
        breakpointKey: status.breakpointKey,
        stages: status.stages.map(stage => ({
            nameKey: stage.nameKey,
            detailKey: stage.detailKey,
            detailParams: stage.detailParams,
            status: stage.status,
        })),
    }));
}

describe('链路状态双语（缺口⑦ 跨层数据⑦ · key 单一真源）', () => {
    it('结构标识与语言无关：zh 与 en 下 key 集合逐项相等', () => {
        setLocale('zh-CN');
        const zhIds = structuralIds(allStatuses());
        setLocale('en-US');
        const enIds = structuralIds(allStatuses());
        expect(enIds).toEqual(zhIds);
    });

    it('展示按语言求值：en 下环节名/说明/链路名全英文且无键名回退', () => {
        setLocale('en-US');
        for (const status of allStatuses()) {
            const title = linkTitle(status);
            expect(title, title).not.toMatch(/[\u4e00-\u9fff]/);
            expect(title).not.toMatch(/linkStatus\./);
            for (const stage of status.stages) {
                const name = stageName(stage);
                const detail = stageDetail(stage);
                expect(name, name).not.toMatch(/[\u4e00-\u9fff]/);
                expect(detail, detail).not.toMatch(/[\u4e00-\u9fff]/);
                expect(name).not.toMatch(/linkStatus\./);
                expect(detail).not.toMatch(/linkStatus\./);
            }
        }
    });

    it('zh 下展示与资源原文一致（拆解 / 知识流），en 下为对应译文', () => {
        setLocale('zh-CN');
        const status = computeKnowledgeFlowStatus(knowledgeInputs[3]);
        expect(linkTitle(status)).toBe('知识流');
        expect(stageName(status.stages[0])).toBe('拆解');
        expect(stageName(status.stages[1])).toBe('向量化');

        setLocale('en-US');
        expect(linkTitle(status)).toBe('Knowledge flow');
        expect(stageName(status.stages[0])).toBe('Breakdown');
        expect(stageName(status.stages[1])).toBe('Vectorization');
    });

    it('agent 诊断输出始终中文：en 界面下与 zh 逐字相等', () => {
        const run = () => allStatuses().map(status => formatLinkStatusForAgent(status)).join('\n');
        setLocale('zh-CN');
        const zhText = run();
        setLocale('en-US');
        const enText = run();
        // 完全一致：agent/LLM 输入不随界面语言漂移（这是删除双份字段后的保证机制）
        expect(enText).toBe(zhText);
        expect(enText).toMatch(/[\u4e00-\u9fff]/);
    });

    it('断点名随语言求值：breakpointKey 稳定，展示名双语', () => {
        // 知识库为空且嵌入不可用 → 环节序里「嵌入模型」先 broken，断点取第一个 broken
        const status = computeKnowledgeFlowStatus(knowledgeInputs[0]);
        expect(status.breakpointKey).toBe('linkStatus.stage.embedding');

        setLocale('zh-CN');
        expect(linkBreakpointName(status)).toBe('嵌入模型');
        setLocale('en-US');
        expect(linkBreakpointName(status)).toBe('Embedding model');
        // key 本身不随语言变
        expect(status.breakpointKey).toBe('linkStatus.stage.embedding');
    });

    it('无断点时 linkBreakpointName 返回空串', () => {
        const status = computeKnowledgeFlowStatus(knowledgeInputs[3]);
        expect(status.breakpointKey).toBeNull();
        expect(linkBreakpointName(status)).toBe('');
    });
});
