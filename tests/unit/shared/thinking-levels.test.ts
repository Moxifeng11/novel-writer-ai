import { describe, it, expect } from 'vitest';
import {
    THINKING_LEVELS,
    nearestThinkingLevel,
    resolveTaskModelConfig,
    type TaskModelSettings,
} from '../../../shared/task-model';

const limits = () => ({ maxContext: 32768, maxOutput: 8192 });
const baseSettings: TaskModelSettings = {
    defaultModel: 'm',
    flashModel: 'm',
    proModel: 'm',
    apiEndpoint: 'https://api.example.com/v1/chat/completions',
};

describe('四级思考强度', () => {
    it('四个等级覆盖极速/标准/深度/极限', () => {
        expect(THINKING_LEVELS.map(item => item.level)).toEqual(['fast', 'standard', 'deep', 'max']);
        expect(THINKING_LEVELS.map(item => item.percent)).toEqual([0, 35, 70, 100]);
        expect(THINKING_LEVELS.map(item => item.mode)).toEqual(['off', 'auto', 'on', 'on']);
    });

    it('滑杆强度映射到最近等级', () => {
        expect(nearestThinkingLevel(0)).toBe('fast');
        expect(nearestThinkingLevel(30)).toBe('standard');
        expect(nearestThinkingLevel(60)).toBe('deep');
        expect(nearestThinkingLevel(95)).toBe('max');
    });

    it('显式强度 0：关闭思考且不预留预算', () => {
        const config = resolveTaskModelConfig({ ...baseSettings, thinkingIntensity: 0 }, 'body', limits);
        expect(config.thinkingMode).toBe('off');
        expect(config.thinkingBudget).toBe(0);
        expect(config.thinkingLevel).toBe('fast');
        expect(config.thinkingIntensity).toBe(0);
    });

    it('显式强度 50：自动模式 + 按强度缩放预算', () => {
        const config = resolveTaskModelConfig({ ...baseSettings, thinkingIntensity: 50 }, 'body', limits);
        expect(config.thinkingMode).toBe('auto');
        expect(config.thinkingLevel).toBe('standard');
        expect(config.thinkingBudget).toBe(Math.floor(8192 * 0.3 * 0.5));
    });

    it('显式强度 100：开启思考并使用最大自动预算', () => {
        const config = resolveTaskModelConfig({ ...baseSettings, thinkingIntensity: 100 }, 'body', limits);
        expect(config.thinkingMode).toBe('on');
        expect(config.thinkingLevel).toBe('max');
        expect(config.thinkingBudget).toBe(Math.floor(8192 * 0.3));
    });

    it('显式等级使用预设强度', () => {
        const config = resolveTaskModelConfig({ ...baseSettings, thinkingLevel: 'deep' }, 'body', limits);
        expect(config.thinkingLevel).toBe('deep');
        expect(config.thinkingIntensity).toBe(70);
        expect(config.thinkingMode).toBe('on');
    });

    it('任务级强度覆盖全局', () => {
        const settings: TaskModelSettings = {
            ...baseSettings,
            thinkingIntensity: 20,
            taskBudgets: { body: { thinkingIntensity: 100 } },
        };
        const config = resolveTaskModelConfig(settings, 'body', limits);
        expect(config.thinkingIntensity).toBe(100);
        expect(config.thinkingMode).toBe('on');
    });

    it('未设置新字段时保持旧 thinkingMode/预算行为', () => {
        const config = resolveTaskModelConfig({
            ...baseSettings,
            thinkingMode: 'on',
            thinkingBudget: 300,
        }, 'body', limits);
        expect(config.thinkingMode).toBe('on');
        expect(config.thinkingBudget).toBe(300);
        expect(config.thinkingLevel).toBe('deep');
        expect(config.thinkingIntensity).toBe(70);
    });

    it('任务级显式关闭优先于强度', () => {
        const settings: TaskModelSettings = {
            ...baseSettings,
            thinkingIntensity: 80,
            taskBudgets: { body: { thinkingMode: 'off' } },
        };
        const config = resolveTaskModelConfig(settings, 'body', limits);
        expect(config.thinkingMode).toBe('off');
        expect(config.thinkingBudget).toBe(0);
    });
});
