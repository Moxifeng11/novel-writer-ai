/**
 * T8 步骤执行门禁测试（2026-11-27）
 */
import { describe, it, expect } from 'vitest';
import { decideStepGate, buildStepGatePrompt } from '../../../shared/step-gate';
import { ALL_FULL_STEPS } from '../../../engine/step-definitions';

describe('decideStepGate 三档判定', () => {
    const bodyStep = { key: 'bodyGeneration', auto: false, required: true };
    const autoStep = { key: 'contextLoad', auto: true, required: true };
    const cheapStep = { key: 'outline', auto: false, required: false };

    it('auto 步骤永不确认（即使 mode=all）', () => {
        expect(decideStepGate(autoStep, { mode: 'all' })).toBe('auto-run');
    });

    it('off 模式：所有步骤都直接跑', () => {
        expect(decideStepGate(bodyStep, { mode: 'off' })).toBe('auto-run');
        expect(decideStepGate(cheapStep, { mode: 'off' })).toBe('auto-run');
    });

    it('costly 模式（默认）：只确认高成本步骤', () => {
        expect(decideStepGate(bodyStep, { mode: 'costly' })).toBe('needs-confirm');
        expect(decideStepGate(cheapStep, { mode: 'costly' })).toBe('auto-run');
    });

    it('all 模式：所有手动步骤都确认', () => {
        expect(decideStepGate(bodyStep, { mode: 'all' })).toBe('needs-confirm');
        expect(decideStepGate(cheapStep, { mode: 'all' })).toBe('needs-confirm');
    });

    it('未传设置时默认 costly', () => {
        expect(decideStepGate(bodyStep)).toBe('needs-confirm');
        expect(decideStepGate(cheapStep)).toBe('auto-run');
    });

    it('质量控制与分析报告也算高成本', () => {
        expect(decideStepGate({ key: 'qualityControl', auto: false, required: false })).toBe('needs-confirm');
        expect(decideStepGate({ key: 'analysisReport', auto: false, required: false })).toBe('needs-confirm');
    });
});

describe('ALL_FULL_STEPS 真实步骤校验', () => {
    it('正文生成步骤在 costly 模式下需要确认', () => {
        const body = ALL_FULL_STEPS.find(s => s.key === 'bodyGeneration');
        expect(body).toBeDefined();
        expect(decideStepGate(body!, { mode: 'costly' })).toBe('needs-confirm');
    });

    it('上下文加载（auto）永不确认', () => {
        const ctxLoad = ALL_FULL_STEPS.find(s => s.auto && !s.key);
        expect(ctxLoad).toBeDefined();
        expect(decideStepGate(ctxLoad!, { mode: 'all' })).toBe('auto-run');
    });

    it('信息规划不在高成本清单（costly 模式不打断）', () => {
        const infoPlan = ALL_FULL_STEPS.find(s => s.key === 'infoPlan');
        expect(infoPlan).toBeDefined();
        expect(decideStepGate(infoPlan!, { mode: 'costly' })).toBe('auto-run');
    });
});

describe('buildStepGatePrompt 结构化描述', () => {
    it('返回 code + 步骤标签 + 章节名（不含文案）', () => {
        const p = buildStepGatePrompt({ label: '✍️ 正文生成', key: 'bodyGeneration', auto: false, required: true }, '第12章 暗巷');
        expect(p.code).toBe('step-gate-confirm');
        expect(p.stepLabel).toContain('正文生成');
        expect(p.chapterName).toBe('第12章 暗巷');
    });

    it('文案由界面层求值（shared 不持有界面文案）', () => {
        const p = buildStepGatePrompt({ key: 'bodyGeneration', auto: false, required: false }, '第1章');
        // 不带 title/description/steps —— 那些是 i18n 的职责
        expect(p.stepLabel).toBe('bodyGeneration'); // label 缺失时退回 key
        expect(Object.keys(p).sort()).toEqual(['chapterName', 'code', 'stepKey', 'stepLabel']);
    });
});
