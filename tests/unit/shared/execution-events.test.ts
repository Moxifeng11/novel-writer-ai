import { describe, it, expect } from 'vitest';
import {
    classifyStepFailure,
    createStepFailure,
    suggestionForFailure,
} from '../../../shared/execution-events';

describe('classifyStepFailure', () => {
    it('识别接口、保存、解析、截断与取消', () => {
        expect(classifyStepFailure('HTTP 401: invalid api key')).toBe('api');
        expect(classifyStepFailure('保存失败，请重试')).toBe('save');
        expect(classifyStepFailure('JSON 解析失败 unexpected token')).toBe('parse');
        expect(classifyStepFailure('输出被截断（finish_reason=length）')).toBe('truncated');
        expect(classifyStepFailure('已取消，结果未保存')).toBe('cancelled');
    });

    it('缺少字段与未达完成标准归为校验/不完整', () => {
        expect(classifyStepFailure('信息规划 未达到完成标准')).toBe('validation');
        expect(classifyStepFailure('内容不完整：缺少 冲突强度')).toBe('validation');
    });

    it('无法归类时回退为 exception', () => {
        expect(classifyStepFailure('something odd happened')).toBe('exception');
    });
});

describe('createStepFailure', () => {
    it('生成节点、原因、缺失项与可操作建议', () => {
        const failure = createStepFailure({
            stepKey: 'infoPlan',
            stepLabel: '信息规划',
            message: '信息规划 未达到完成标准',
            missing: ['冲突强度', '信息释放计划'],
        });

        expect(failure.stepKey).toBe('infoPlan');
        expect(failure.stepLabel).toBe('信息规划');
        expect(failure.kind).toBe('validation');
        expect(failure.missing).toEqual(['冲突强度', '信息释放计划']);
        expect(failure.suggestion).toContain('冲突强度');
        expect(failure.suggestion).toContain('重试本步');
        expect(failure.retryable).toBe(true);
        expect(failure.at).toBeGreaterThan(0);
    });

    it('截断错误建议提高输出上限或缩短输入', () => {
        const failure = createStepFailure({
            stepKey: 'bodyGeneration',
            stepLabel: '正文生成',
            message: '输出被截断',
        });
        expect(failure.kind).toBe('truncated');
        expect(failure.suggestion).toContain('输出上限');
    });

    it('取消默认不可自动重试', () => {
        const failure = createStepFailure({
            stepKey: 'bodyGeneration',
            stepLabel: '正文生成',
            message: '已取消',
        });
        expect(failure.kind).toBe('cancelled');
        expect(failure.retryable).toBe(false);
    });

    it('suggestionForFailure 对不完整错误附带缺失项', () => {
        expect(suggestionForFailure('incomplete', ['场景'])).toContain('场景');
    });
});
