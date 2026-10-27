import { describe, expect, it } from 'vitest';
import { getStepTemplateAuto } from '../../../engine/prompts/template-utils';

describe('getStepTemplateAuto — 创作模式覆盖块', () => {
    it('短篇/剧本模式块追加到 system prompt', () => {
        const template = getStepTemplateAuto('infoPlan', {
            creationModePrompt: '【创作模式：番茄短篇小说】测试约束',
        });
        expect(template?.systemPrompt).toContain('番茄短篇小说');
        expect(template?.systemPrompt).toContain('测试约束');
    });

    it('长篇没有模式块时保持原模板', () => {
        const template = getStepTemplateAuto('infoPlan', { creationModePrompt: '' });
        expect(template?.systemPrompt).not.toContain('番茄短篇小说');
        expect(template?.systemPrompt).not.toContain('红果短剧');
    });

    it('正文 V2 也存在模式块', () => {
        const template = getStepTemplateAuto('bodyGeneration', {
            characterSoulReady: '1',
            creationModePrompt: '【创作模式：红果短剧剧本】',
        });
        expect(template?.systemPrompt).toContain('红果短剧剧本');
    });
});
