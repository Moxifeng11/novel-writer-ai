/**
 * verify-flows-parity.test.ts — 镜像判定库与真源逐分支 parity（残余技术债闭合）
 *
 * 历史：verify-three-flows.mjs 的判定函数按行镜像 shared/link-status-compute.ts
 * （.mjs 不能 import TS），镜像体此前内联在脚本里，漂移只能靠人工 diff——
 * 对抗审计 #A9 之前的「fingerprint-library vs 写作指纹库」路径 bug 正是这类漂移。
 *
 * 现在镜像体抽到 scripts/lib/verify-flows-lib.mjs，vitest 可以**同时 import 真源
 * （shared，TS）与镜像（.mjs）**，对同一组输入深比较输出：shared 语义一旦变更而
 * 镜像没跟上，本文件当场变红。
 */
import { describe, expect, it } from 'vitest';
import {
    computeKnowledgeFlowStatus as sharedKnowledge,
    computeStyleFlowStatus as sharedStyle,
    computeConstraintFlowStatus as sharedConstraint,
    summarizeLink as sharedSummarize,
} from '../../../shared/link-status-compute';
import { sanitizeName as sharedSanitizeName } from '../../../shared/paths';
import {
    computeKnowledgeFlowStatus as mirrorKnowledge,
    computeStyleFlowStatus as mirrorStyle,
    computeConstraintFlowStatus as mirrorConstraint,
    summarizeLink as mirrorSummarize,
    mirrorSanitizeName,
} from '../../../scripts/lib/verify-flows-lib.mjs';

/** 遍历过的输入清单（parity 覆盖计数用） */
const covered: string[] = [];

describe('parity：镜像库 ↔ shared 真源（同输入必须同输出）', () => {
    it('summarizeLink：四种 overall 组合与断点提取', () => {
        const stagesOk = [{ name: 'A', status: 'ok' as const, detail: 'x' }];
        const stagesBroken = [
            { name: 'A', status: 'ok' as const, detail: 'x' },
            { name: 'B', status: 'broken' as const, detail: 'y' },
        ];
        const cases = [
            { title: 't', stages: stagesOk, breakpoint: null, degradations: undefined },
            { title: 't', stages: stagesBroken, breakpoint: 'B', degradations: undefined },
            { title: 't', stages: [{ name: 'A', status: 'warn' as const, detail: 'w' }], breakpoint: null, degradations: ['d'] },
            { title: 't', stages: [{ name: 'A', status: 'unknown' as const, detail: '?' }], breakpoint: null, degradations: undefined },
        ];
        for (const input of cases) {
            expect(mirrorSummarize(input.title, input.stages, input.degradations))
                .toEqual(sharedSummarize(input.title, input.stages, input.degradations));
            covered.push('summarize:' + input.stages[0].status);
        }
    });

    it('computeKnowledgeFlowStatus：空库 / 全就绪 / 孤儿 / 全失败 / 未加载 五分支', () => {
        const cases = [
            { bookTotal: 0, breakdownCompleted: 0, vectorDone: 0, vectorFailed: 0, embeddingReady: false, storeLoadedBooks: 0, storeReady: false },
            { bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0, embeddingReady: true, storeLoadedBooks: 1, storeReady: true },
            // DSH-20261112-17 环节级呈现：orphanCount>0 → 检索 warn + detail 附注
            { bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0, embeddingReady: true, storeLoadedBooks: 1, storeReady: true, orphanCount: 1 },
            { bookTotal: 2, breakdownCompleted: 2, vectorDone: 0, vectorFailed: 2, embeddingReady: false, storeLoadedBooks: 0, storeReady: true },
            { bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0, embeddingReady: true, storeLoadedBooks: 0, storeReady: false },
        ];
        for (const input of cases) {
            expect(mirrorKnowledge(input)).toEqual(sharedKnowledge(input));
            covered.push('knowledge:' + (input.orphanCount ?? 'no-orphan') + '/' + input.storeLoadedBooks);
        }
    });

    it('computeStyleFlowStatus：空库 / 仅模板 / 全就绪 / 强度全 0 / 嵌入不可用', () => {
        const cases = [
            { templateCount: 0, globalCount: 0, projectCount: 0, enabledCount: 0, intensityDisabledCount: 0, embeddingReady: true },
            { templateCount: 3, globalCount: 0, projectCount: 0, enabledCount: 0, intensityDisabledCount: 0, embeddingReady: true },
            { templateCount: 1, globalCount: 2, projectCount: 1, enabledCount: 3, intensityDisabledCount: 0, embeddingReady: true },
            { templateCount: 0, globalCount: 1, projectCount: 1, enabledCount: 2, intensityDisabledCount: 2, embeddingReady: true },
            { templateCount: 0, globalCount: 1, projectCount: 0, enabledCount: 1, intensityDisabledCount: 0, embeddingReady: false },
        ];
        for (const input of cases) {
            expect(mirrorStyle(input)).toEqual(sharedStyle(input));
            covered.push('style:inj' + (input.globalCount + input.projectCount));
        }
    });

    it('computeConstraintFlowStatus：五种审核状态 × 绑定/内容组合', () => {
        const reviewStatuses = ['approved', 'legacy', 'pending', 'rejected', 'none'] as const;
        for (const reviewStatus of reviewStatuses) {
            const input = {
                sourceCount: reviewStatus === 'approved' ? 2 : 0,
                settingExists: reviewStatus !== 'none',
                reviewStatus,
                bound: reviewStatus === 'approved',
                rulesHasContent: reviewStatus === 'approved',
            };
            expect(mirrorConstraint(input)).toEqual(sharedConstraint(input));
            covered.push('constraint:' + reviewStatus);
        }
    });

    it('sanitizeName parity：控制字符/保留字/首尾点/空回落（与 shared/paths.ts 同输入同输出）', () => {
        const inputs = [
            '晨星志', 'Fate/Zero', 'a:b*c?', '  x  ', '.hidden.', '..', '',
            "tab\there", "con'tinue", '已净化_原名',
        ];
        for (const input of inputs) {
            expect(mirrorSanitizeName(input)).toBe(sharedSanitizeName(input));
            covered.push('sanitize:' + String(input));
        }
        // undefined 也同语义：真源签名是 string、运行时会抛 TypeError——镜像必须同行为（防御性差异也是漂移）
        expect(() => sharedSanitizeName(undefined as never)).toThrow(TypeError);
        expect(() => mirrorSanitizeName(undefined)).toThrow(TypeError);
    });

    it('parity 覆盖计数：四类判定合计 ≥17 组输入', () => {
        expect(covered.length).toBeGreaterThanOrEqual(17);
    });
});
