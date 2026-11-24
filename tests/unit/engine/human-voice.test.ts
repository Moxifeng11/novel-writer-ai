import { describe, it, expect } from 'vitest';
import { HUMAN_VOICE_BLOCK, HUMAN_VOICE_SHORT, HUMAN_VOICE_WEAK_RULES } from '../../../engine/prompts/human-voice';
import { BODY_GENERATION_SYSTEM_PROMPT_V2 } from '../../../engine/prompts/body-v2-prompts';
import { BODY_GENERATION_SYSTEM_PROMPT } from '../../../engine/prompts/chapter-pipeline-prompts';
import { CO_WRITE_PROMPTS } from '../../../engine/prompts/co-write-prompts';
import { DEAI_REWRITE_SYSTEM_PROMPT } from '../../../engine/prompts/deai-prompts';

describe('人类写作节奏约束', () => {
    it('包含自然段、句长、对话与去总结规则', () => {
        expect(HUMAN_VOICE_BLOCK).toContain('自然段');
        expect(HUMAN_VOICE_BLOCK).toContain('不要一句一段');
        expect(HUMAN_VOICE_BLOCK).toContain('句长必须长短拉开');
        expect(HUMAN_VOICE_BLOCK).toContain('对话占 25%–45%');
        expect(HUMAN_VOICE_BLOCK).toContain('末段升华');
        expect(HUMAN_VOICE_BLOCK).toContain('不要用分号');
        expect(HUMAN_VOICE_BLOCK).toContain('省略号全文最多 2 处');
        expect(HUMAN_VOICE_BLOCK).toContain('破折号不要用');
        expect(HUMAN_VOICE_BLOCK).toContain('排比式感慨');
        expect(HUMAN_VOICE_BLOCK).toContain('承接它');
        expect(HUMAN_VOICE_SHORT).toContain('自然段');
        expect(HUMAN_VOICE_SHORT).toContain('不要一句一段');
    });

    // 回归护栏（2026-11-25）：139 段真人网文实测，≥40 字长句占 34%（P25 23%）。
    // 旧文案写死「35 字以上长句占 10%–20%」，模型严格照做后长句仅 10.4%——
    // 提示词成了 AI 腔的制造者。任何给长句设上限的表述都不许回到提示词里。
    it('长句不许设上限（否则模型会贴着上限写成匀速 AI 腔）', () => {
        for (const block of [HUMAN_VOICE_BLOCK, HUMAN_VOICE_SHORT, HUMAN_VOICE_WEAK_RULES]) {
            expect(block).not.toMatch(/长句[^。；]{0,12}占\s*\d+%/);
            expect(block).not.toMatch(/\d+\s*字以上[^。；]{0,8}占\s*\d+%/);
        }
        expect(HUMAN_VOICE_WEAK_RULES).toContain('四十字以上');
        expect(HUMAN_VOICE_WEAK_RULES).toContain('双峰');
    });

    it('破折号在三条人味块里都是禁止而非限量', () => {
        expect(HUMAN_VOICE_BLOCK).not.toContain('破折号全文最多 2 处');
        expect(HUMAN_VOICE_WEAK_RULES).toContain('破折号不要用');
        expect(HUMAN_VOICE_SHORT).toContain('不用分号和破折号');
    });

    it('V1/V2 正文系统提示词都注入 humanVoice 占位', () => {
        expect(BODY_GENERATION_SYSTEM_PROMPT).toContain('${humanVoice}');
        expect(BODY_GENERATION_SYSTEM_PROMPT_V2).toContain('${humanVoice}');
    });

    it('协同写作句级 system 注入自然段与对话约束', () => {
        expect(CO_WRITE_PROMPTS.sentenceSystem).toContain('自然段');
        expect(CO_WRITE_PROMPTS.sentenceSystem).toContain('对话占 25%–45%');
    });

    it('DEAI 重写提示词带标点硬规则', () => {
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('分号全部清零');
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('省略号全文最多 2 处');
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('破折号不要用');
    });

    it('DEAI 重写提示词要求恢复自然段而不是继续切碎', () => {
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('自然段');
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('不要一句一段');
        expect(DEAI_REWRITE_SYSTEM_PROMPT).toContain('对话和说话人的动作');
    });
});
