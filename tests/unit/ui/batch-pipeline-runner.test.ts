import { describe, it, expect } from 'vitest';
import {
    BATCH_STEP_MAX_ATTEMPTS,
    shouldRetryBatchStep,
} from '../../../ui/full-writer/batch-step-retry';
import { BATCH_STEP_KEYS, buildBatchTargets, isBodySettled } from '../../../ui/full-writer/batch-targets';
import { ALL_FULL_STEPS } from '../../../engine/step-definitions';

describe('buildBatchTargets', () => {
    it('按起始章与数量生成连续目标', () => {
        const targets = buildBatchTargets('第2卷', 2, 11, 3);
        expect(targets.map(t => t.chapterNum)).toEqual([11, 12, 13]);
        expect(targets.map(t => t.chapterName)).toEqual(['第11章', '第12章', '第13章']);
        expect(targets.every(t => t.volume === '第2卷' && t.volumeNum === 2)).toBe(true);
    });

    it('起始章小于 1 时收敛到 1', () => {
        const targets = buildBatchTargets('第1卷', 1, 0, 2);
        expect(targets.map(t => t.chapterNum)).toEqual([1, 2]);
    });

    it('数量为 0 或负数时返回空数组', () => {
        expect(buildBatchTargets('第1卷', 1, 1, 0)).toEqual([]);
        expect(buildBatchTargets('第1卷', 1, 1, -5)).toEqual([]);
    });
});

describe('BATCH_STEP_KEYS', () => {
    it('每个批量步骤都能在 11 步定义中找到，且顺序递增', () => {
        const indexes = BATCH_STEP_KEYS.map(key => {
            const step = ALL_FULL_STEPS.find(s => s.key === key);
            expect(step, `步骤 ${key} 未在 ALL_FULL_STEPS 中定义`).toBeTruthy();
            return step!.index;
        });
        const sorted = [...indexes].sort((a, b) => a - b);
        expect(indexes).toEqual(sorted);
    });

    it('批量流程不包含仅 UI 可执行的结算步骤', () => {
        // 结算由 BatchPipelineRunner.settle 直接调用 SettlementEngine，
        // 不走 StepRunner 的自动步骤（需要工作台容器）
        expect(BATCH_STEP_KEYS).not.toContain('settlement');
        expect(BATCH_STEP_KEYS).toContain('bodyGeneration');
        expect(BATCH_STEP_KEYS).toContain('analysisReport');
    });
});

describe('isBodySettled — 批量断点续跑不得重复结算', () => {
    const body = (status: string) => `---\nstatus: ${status}\ntags:\n  - 正文\n---\n\n正文内容`;

    it('settled / 已结算 / 已完稿 都判定为已结算', () => {
        expect(isBodySettled(body('settled'))).toBe(true);
        expect(isBodySettled(body('已结算'))).toBe(true);
        expect(isBodySettled(body('已完稿'))).toBe(true);
    });

    it('written / draft / pending 不算已结算', () => {
        expect(isBodySettled(body('written'))).toBe(false);
        expect(isBodySettled(body('draft'))).toBe(false);
        expect(isBodySettled(body('pending'))).toBe(false);
    });

    it('没有 frontmatter 或空正文不算已结算', () => {
        expect(isBodySettled('正文里提到 status: settled 也不算')).toBe(false);
        expect(isBodySettled('')).toBe(false);
        expect(isBodySettled(undefined)).toBe(false);
    });

    it('正文里出现同名状态不误判（只看 frontmatter）', () => {
        const text = `---\nstatus: written\n---\n\n他写道：status: settled`;
        expect(isBodySettled(text)).toBe(false);
    });
});

describe('shouldRetryBatchStep — 单步失败重试', () => {
    it('已产出内容时不重试', () => {
        expect(shouldRetryBatchStep({ produced: true, cancelled: false, attempts: 1 })).toBe(false);
    });

    it('取消后不重试', () => {
        expect(shouldRetryBatchStep({ produced: false, cancelled: true, attempts: 1 })).toBe(false);
    });

    it('空产出时首次失败重试一次，达到上限后停止', () => {
        expect(shouldRetryBatchStep({ produced: false, cancelled: false, attempts: 1 })).toBe(true);
        expect(shouldRetryBatchStep({ produced: false, cancelled: false, attempts: BATCH_STEP_MAX_ATTEMPTS })).toBe(false);
    });
});
