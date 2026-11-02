import { describe, expect, it } from 'vitest';
import { getStepTemplateAuto } from '../../../engine/prompts/template-utils';

describe('template-utils — 正文模板变体路由', () => {
    it('_bodyVariant=v3/v4 强制使用对应模板', () => {
        const v3 = getStepTemplateAuto('bodyGeneration', { _bodyVariant: 'v3' });
        const v4 = getStepTemplateAuto('bodyGeneration', { _bodyVariant: 'v4' });
        expect(v3?.systemPrompt).toContain('三条偏好');
        expect(v3?.userPrompt).toContain('台词清单');
        expect(v4?.systemPrompt).toContain('录音机');
        expect(v4?.userPrompt).toContain('每两三条对话之间');
    });

    it('V3/V4 模板不再引用禁用清单与工艺块', () => {
        for (const variant of ['v3', 'v4']) {
            const template = getStepTemplateAuto('bodyGeneration', { _bodyVariant: variant });
            expect(template?.systemPrompt).not.toContain('${negativeList}');
            expect(template?.systemPrompt).not.toContain('${craftConstraints}');
            expect(template?.userPrompt).not.toContain('${negativeList}');
        }
    });

    it('未指定变体时按灵魂层自动路由（有灵魂层 → V2）', () => {
        expect(getStepTemplateAuto('bodyGeneration', { characterSoulReady: '1' })?.systemPrompt).toContain('你活在他身体里');
        expect(getStepTemplateAuto('bodyGeneration', {})?.systemPrompt).not.toContain('你活在他身体里');
    });

    it('无法识别的变体名按 auto 处理，不抛错', () => {
        const template = getStepTemplateAuto('bodyGeneration', { _bodyVariant: 'v99', characterSoulReady: '1' });
        expect(template?.systemPrompt).toContain('你活在他身体里');
    });

    it('显式 v1 绕过灵魂层判断', () => {
        const template = getStepTemplateAuto('bodyGeneration', { _bodyVariant: 'v1', characterSoulReady: '1' });
        expect(template?.systemPrompt).not.toContain('你活在他身体里');
    });

    it('_countableHints=1 才追加可数硬指标，且只作用于正文步骤', () => {
        const on = getStepTemplateAuto('bodyGeneration', { _bodyVariant: 'v4', _countableHints: '1' });
        const off = getStepTemplateAuto('bodyGeneration', { _bodyVariant: 'v4' });
        expect(on?.systemPrompt).toContain('可数的硬指标');
        expect(off?.systemPrompt).not.toContain('可数的硬指标');
        const outline = getStepTemplateAuto('outline', { _countableHints: '1' });
        expect(outline?.systemPrompt).not.toContain('可数的硬指标');
    });
});
