import { describe, it, expect } from 'vitest';
import { HUMAN_VOICE_BLOCK, HUMAN_VOICE_SHORT } from '../../../engine/prompts/human-voice';
import { BODY_GENERATION_SYSTEM_PROMPT_V2 } from '../../../engine/prompts/body-v2-prompts';
import { BODY_GENERATION_SYSTEM_PROMPT } from '../../../engine/prompts/chapter-pipeline-prompts';
import { CO_WRITE_PROMPTS } from '../../../engine/prompts/co-write-prompts';
import { DEAI_REWRITE_SYSTEM_PROMPT } from '../../../engine/prompts/deai-prompts';

describe('人类写作节奏约束', () => {
    it('包含自然段、句长、对话与去总结规则', () => {
        expect(HUMAN_VOICE_BLOCK).toContain('自然段');
        expect(HUMAN_VOICE_BLOCK).toContain('不要一句一段');
        expect(HUMAN_VOICE_BLOCK).toContain('平均 20–30 字');
        expect(HUMAN_VOICE_BLOCK).toContain('对话占 25%–45%');
        expect(HUMAN_VOICE_BLOCK).toContain('不写升华');
        expect(HUMAN_VOICE_SHORT).toContain('自然段');
        expect(HUMAN_VOICE_SHORT).toContain('不要一句一段');
    });

    it('V1/V2 正文系统提示词都注入 humanVoice 占位', () => {
        expect(BODY_GENERATION_SYSTEM_PROMPT).toContain('${humanVoice}');
        expect(BODY_GENERATION_SYSTEM_PROMPT_V2).toContain('${humanVoice}');
    });

    it('协同写作句级 system 注入自然段与对话约束', () => {
        expect(CO_WRITE_PROMPTS.sentenceSystem).toContain('自然段');
        expect(CO_WRITE_PROMPTS.sentenceSystem).toContain('对话占 25%–45%');
    });

    it('DEAI 重写提示词要求恢复自然段而不是继续切碎', () => {
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('自然段');
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('不要一句一段');
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('对话和说话人的动作');
    });
});
