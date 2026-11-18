/**
 * 链路状态（阶段 A4）
 *
 * 长期目标阶段 A4：界面层要能看到链路**通/断/断点**。
 *
 * 与 `knowledge-capability`（能力阶段）的分工：那个回答「现在处于什么阶段」，
 * 本模块回答「具体断在哪一环」。用户困惑「我配了为什么没生效」时需要后者。
 *
 * 本文件锁三条链路的判定口径，特别是：
 * - 断点必须是**第一个** broken（修链路要从头修）
 * - template 层不进风格流环节，但要说明它只是来源库
 * - 骨架占位不算内容（约束流注入环节）
 */

import { describe, expect, it } from 'vitest';
import {
    summarizeLink,
    computeKnowledgeFlowStatus,
    computeStyleFlowStatus,
    computeConstraintFlowStatus,
    stageDetail,
    stageName,
    linkBreakpointName,
    type LinkStage,
} from '../../../ui/views/link-status';

/** 构造环节 */
/**
 * 构造环节。
 *
 * i18n 跨层数据⑦ 后 key 是唯一真源；这里的 key 直接当 nameKey/detailKey 用，
 * 断言文案时走 stageDetail()/stageName() 求值（fixture 用任意串即可）。
 */
function stage(key: string, status: LinkStage['status']): LinkStage {
    return { nameKey: key, status, detailKey: key };
}

describe('summarizeLink — 整体结论与断点', () => {
    it('全部 ok 时整体 ok 且无断点', () => {
        const result = summarizeLink('test.flow', [stage('a', 'ok'), stage('b', 'ok')]);
        expect(result.overall).toBe('ok');
        expect(result.breakpointKey).toBeNull();
    });

    it('断点取第一个 broken（修链路要从头修）', () => {
        const result = summarizeLink('test.flow', [
            stage('拆解', 'ok'),
            stage('向量化', 'broken'),
            stage('检索', 'broken'),
        ]);
        expect(result.overall).toBe('broken');
        expect(result.breakpointKey).toBe('向量化');
    });

    it('broken 优先于 warn', () => {
        const result = summarizeLink('test.flow', [stage('a', 'warn'), stage('b', 'broken')]);
        expect(result.overall).toBe('broken');
    });

    it('无 broken 有 warn 时整体 warn', () => {
        const result = summarizeLink('test.flow', [stage('a', 'ok'), stage('b', 'warn')]);
        expect(result.overall).toBe('warn');
        expect(result.breakpointKey).toBeNull();
    });

    it('只有 unknown 时整体 unknown（不冒充 ok）', () => {
        const result = summarizeLink('test.flow', [stage('a', 'unknown')]);
        expect(result.overall).toBe('unknown');
    });
});

describe('知识流：拆解 → 向量化 → 嵌入 → 检索 → 归因', () => {
    it('拆解完成但零向量 → 断在向量化', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 3,
            breakdownCompleted: 3,
            vectorDone: 0,
            vectorFailed: 0,
            embeddingReady: false,
            storeLoadedBooks: 0,
        });
        expect(status.breakpointKey).toBe('linkStatus.stage.vectorize');
    });

    it('向量化失败会说明检查嵌入模型', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 3,
            breakdownCompleted: 3,
            vectorDone: 0,
            vectorFailed: 3,
            embeddingReady: false,
            storeLoadedBooks: 0,
        });
        const vectorize = status.stages.find(s => s.nameKey === 'linkStatus.stage.vectorize');
        expect(vectorize?.status).toBe('broken');
        expect(vectorize ? stageDetail(vectorize) : '').toContain('嵌入模型');
    });

    it('向量就绪但部分失败 → 向量化环节 warn（不是断）', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 3,
            breakdownCompleted: 3,
            vectorDone: 2,
            vectorFailed: 1,
            embeddingReady: true,
            storeLoadedBooks: 2,
        });
        expect(status.stages.find(s => s.nameKey === 'linkStatus.stage.vectorize')?.status).toBe('warn');
        expect(status.overall).toBe('warn');
    });

    it('全部就绪时整体 ok（归因是 unknown 不算断）', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 2,
            breakdownCompleted: 2,
            vectorDone: 2,
            vectorFailed: 0,
            embeddingReady: true,
            storeLoadedBooks: 2,
        });
        // 归因环节是 unknown（运行时数据），不拉低整体：可判定环节全 ok → 整体 ok\n        expect(status.overall).toBe('ok');
        expect(status.breakpointKey).toBeNull();
    });

    it('空知识库时整体 unknown（不误报为断）', () => {
        const status = computeKnowledgeFlowStatus({
            bookTotal: 0,
            breakdownCompleted: 0,
            vectorDone: 0,
            vectorFailed: 0,
            embeddingReady: false,
            storeLoadedBooks: 0,
        });
        expect(status.overall).not.toBe('ok');
        // 嵌入模型不可用是确定的 broken
        expect(status.breakpointKey).toBe('linkStatus.stage.embedding');
    });
});

describe('风格流：指纹库 → 启用 → 强度 → 注入', () => {
    it('只有模板层时说明模板不参与注入', () => {
        const status = computeStyleFlowStatus({
            templateCount: 3,
            globalCount: 0,
            projectCount: 0,
            enabledCount: 0,
            intensityDisabledCount: 0,
            embeddingReady: true,
        });
        const library = status.stages.find(s => s.nameKey === 'linkStatus.stage.fingerprintLib');
        expect(library?.status).toBe('warn');
        expect(stageDetail(library!)).toContain('模板');
        // 只有模板层是 warn 不是断：模板可复制到项目，链路并非走不通
        expect(status.breakpointKey).toBeNull();
        expect(status.overall).toBe('warn');
    });

    it('有指纹但全未启用 → 断在启用', () => {
        const status = computeStyleFlowStatus({
            templateCount: 0,
            globalCount: 1,
            projectCount: 1,
            enabledCount: 0,
            intensityDisabledCount: 0,
            embeddingReady: true,
        });
        expect(status.breakpointKey).toBe('linkStatus.stage.enabled');
    });

    it('全部启用但强度都是 0 → 断在强度', () => {
        const status = computeStyleFlowStatus({
            templateCount: 0,
            globalCount: 0,
            projectCount: 2,
            enabledCount: 2,
            intensityDisabledCount: 2,
            embeddingReady: true,
        });
        expect(status.breakpointKey).toBe('linkStatus.stage.intensity');
        expect(stageDetail(status.stages.find(s => s.nameKey === 'linkStatus.stage.intensity')!)).toContain('强度都是 0');
    });

    it('部分强度为 0 → 强度环节 warn 且整体 warn', () => {
        const status = computeStyleFlowStatus({
            templateCount: 0,
            globalCount: 0,
            projectCount: 2,
            enabledCount: 2,
            intensityDisabledCount: 1,
            embeddingReady: true,
        });
        expect(status.stages.find(s => s.nameKey === 'linkStatus.stage.intensity')?.status).toBe('warn');
        expect(status.overall).toBe('warn');
    });

    it('嵌入不可用只让注入环节 warn（特征仍可注入）', () => {
        const status = computeStyleFlowStatus({
            templateCount: 0,
            globalCount: 0,
            projectCount: 1,
            enabledCount: 1,
            intensityDisabledCount: 0,
            embeddingReady: false,
        });
        const inject = status.stages.find(s => s.nameKey === 'linkStatus.stage.inject');
        expect(inject?.status).toBe('warn');
        expect(stageDetail(inject!)).toContain('特征可注入');
    });
});

describe('运行时降级影响整体状态（阶段 B1）', () => {
    it('环节全 ok 但有运行时降级 → 整体 warn（静态检查看不到「配了但运行中回退」）', () => {
        const status = computeStyleFlowStatus({
            templateCount: 0,
            globalCount: 0,
            projectCount: 1,
            enabledCount: 1,
            intensityDisabledCount: 0,
            embeddingReady: true,
            degradations: ['V2 检索异常，回退全量注入'],
        });
        expect(status.overall).toBe('warn');
        expect(status.breakpointKey).toBeNull();
        expect(status.degradations).toHaveLength(1);
    });

    it('有断点时仍以断点为准（降级只是附加信息）', () => {
        const status = computeConstraintFlowStatus({
            sourceCount: 1,
            settingExists: true,
            reviewStatus: 'pending',
            bound: false,
            rulesHasContent: true,
            degradations: ['考据来源抓取失败'],
        });
        expect(status.overall).toBe('broken');
        expect(status.breakpointKey).toBe('linkStatus.stage.review');
    });

    it('无降级时不改变原有判定', () => {
        const status = computeStyleFlowStatus({
            templateCount: 0,
            globalCount: 0,
            projectCount: 1,
            enabledCount: 1,
            intensityDisabledCount: 0,
            embeddingReady: true,
        });
        expect(status.overall).toBe('ok');
        expect(status.degradations).toBeUndefined();
    });
});

describe('约束流：考据 → 设定 → 审核 → 绑定 → 注入', () => {
    it('待审核设定 → 断在审核（不能绑定）', () => {
        const status = computeConstraintFlowStatus({
            sourceCount: 3,
            settingExists: true,
            reviewStatus: 'pending',
            bound: false,
            rulesHasContent: true,
        });
        expect(status.breakpointKey).toBe('linkStatus.stage.review');
    });

    it('已审核但未绑定 → 断在绑定', () => {
        const status = computeConstraintFlowStatus({
            sourceCount: 3,
            settingExists: true,
            reviewStatus: 'approved',
            bound: false,
            rulesHasContent: true,
        });
        expect(status.breakpointKey).toBe('linkStatus.stage.bind');
    });

    it('已绑定但内容是占位 → 断在注入', () => {
        const status = computeConstraintFlowStatus({
            sourceCount: 3,
            settingExists: true,
            reviewStatus: 'approved',
            bound: true,
            rulesHasContent: false,
        });
        expect(status.breakpointKey).toBe('linkStatus.stage.inject');
    });

    it('全通时整体 ok', () => {
        const status = computeConstraintFlowStatus({
            sourceCount: 3,
            settingExists: true,
            reviewStatus: 'approved',
            bound: true,
            rulesHasContent: true,
        });
        expect(status.overall).toBe('ok');
        expect(status.breakpointKey).toBeNull();
    });

    it('没有考据来源只算 warn（仍可人工写设定）', () => {
        const status = computeConstraintFlowStatus({
            sourceCount: 0,
            settingExists: true,
            reviewStatus: 'approved',
            bound: true,
            rulesHasContent: true,
        });
        expect(status.stages.find(s => s.nameKey === 'linkStatus.stage.research')?.status).toBe('warn');
        expect(status.overall).toBe('warn');
    });

    it('legacy 审核记录是 warn 不是断（不阻塞老项目）', () => {
        const status = computeConstraintFlowStatus({
            sourceCount: 2,
            settingExists: true,
            reviewStatus: 'legacy',
            bound: true,
            rulesHasContent: true,
        });
        expect(status.stages.find(s => s.nameKey === 'linkStatus.stage.review')?.status).toBe('warn');
        expect(status.breakpointKey).toBeNull();
    });
});
