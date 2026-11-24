/**
 * L0-L3 优先级仲裁 + 后章约束的回归测试（2026-11-25）。
 *
 * 这两个特性都来自云笔的信息，做了本仓适配：
 * - 仲裁体系：只搬层级骨架，不搬被 139 段基线证伪的具体条文
 * - 后章约束：云笔 next_chapter_constraint 的本仓实现（本仓此前只有前章原文）
 */
import { describe, it, expect } from 'vitest';
import { PRIORITY_ARBITRATION, hasPriorityArbitration } from '../../../engine/prompts/priority-system';
import { buildHumanVoiceBlock, HUMAN_VOICE_WEAK_RULES, HUMAN_VOICE_BLOCK } from '../../../engine/prompts/human-voice';
import { BODY_GENERATION_USER_TEMPLATE_V2 } from '../../../engine/prompts/body-v2-prompts';
import { BODY_GENERATION_USER_TEMPLATE_V4 } from '../../../engine/prompts/body-v4-prompts';
import { TEMPLATE_VAR_FALLBACK_KEYS } from '../../../ui/full-writer/template-vars-builder';

describe('L0-L3 优先级仲裁', () => {
    it('包含 L0/L1/L1.5/L2/L3 五层', () => {
        for (const layer of ['L0', 'L1', 'L1.5', 'L2', 'L3']) {
            expect(PRIORITY_ARBITRATION).toContain(layer);
        }
    });

    it('L0 覆盖视角/实体边界/衔接重复/后章保护四项', () => {
        expect(PRIORITY_ARBITRATION).toContain('L0a 视角约束');
        expect(PRIORITY_ARBITRATION).toContain('L0b 实体边界');
        expect(PRIORITY_ARBITRATION).toContain('L0c 衔接重复禁止');
        expect(PRIORITY_ARBITRATION).toContain('L0d 后章保护');
    });

    it('明确声明同层左侧优先 + 跨层高层覆盖', () => {
        expect(PRIORITY_ARBITRATION).toContain('同层冲突');
        expect(PRIORITY_ARBITRATION).toContain('左侧优先');
        expect(PRIORITY_ARBITRATION).toContain('跨层冲突');
        expect(PRIORITY_ARBITRATION).toContain('高层覆盖低层');
    });

    it('声明衔接锚点优先级：上一章原文 > 时间线 > 摘要章尾 > 大纲开头承接', () => {
        expect(PRIORITY_ARBITRATION).toContain('上一章结尾实际文本');
        expect(PRIORITY_ARBITRATION).toContain('时间线前情锚点');
        expect(PRIORITY_ARBITRATION).toContain('章尾悬念');
        expect(PRIORITY_ARBITRATION).toContain('开头承接字段');
    });

    it('不含被 139 段基线证伪的条文（对话≥50%/禁省略号/长句10-20%）', () => {
        // 这些是云笔的条文，实测不成立，不得随仲裁体系一起搬进来
        expect(PRIORITY_ARBITRATION).not.toContain('对话占 50%');
        expect(PRIORITY_ARBITRATION).not.toContain('禁止省略号');
        expect(PRIORITY_ARBITRATION).not.toMatch(/长句[^。]{0,10}占\s*\d+%/);
    });

    it('hasPriorityArbitration 能识别已注入的文本', () => {
        expect(hasPriorityArbitration(PRIORITY_ARBITRATION)).toBe(true);
        expect(hasPriorityArbitration('随便一段文本')).toBe(false);
    });
});

describe('仲裁块注入位置', () => {
    it('buildHumanVoiceBlock 把仲裁放在最前（先声明优先级再给具体规则）', () => {
        const block = buildHumanVoiceBlock({ mode: 'exemplar' });
        expect(block.startsWith(PRIORITY_ARBITRATION)).toBe(true);
        // 弱约束必须在仲裁之后
        expect(block.indexOf(PRIORITY_ARBITRATION)).toBeLessThan(block.indexOf('人味要求'));
    });

    it('quota 模式也注入仲裁', () => {
        const block = buildHumanVoiceBlock({ mode: 'quota' });
        expect(block.startsWith(PRIORITY_ARBITRATION)).toBe(true);
        expect(block).toContain(HUMAN_VOICE_BLOCK.slice(0, 20));
    });

    it('样文块位于仲裁之后、弱约束之前', () => {
        const exemplar = '【样文】这是一段真人文本示例';
        const block = buildHumanVoiceBlock({ mode: 'exemplar', exemplarBlock: exemplar });
        const iArb = block.indexOf(PRIORITY_ARBITRATION);
        const iEx = block.indexOf(exemplar);
        const iWeak = block.indexOf(HUMAN_VOICE_WEAK_RULES.slice(0, 10));
        expect(iArb).toBeLessThan(iEx);
        expect(iEx).toBeLessThan(iWeak);
    });
});

describe('后章约束（nextChapterHook）', () => {
    it('V2 正文模板注入 nextChapterHook 且带禁止泄露说明', () => {
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('${nextChapterHook}');
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('不得提前写出');
    });

    it('V4 正文模板也注入 nextChapterHook', () => {
        expect(BODY_GENERATION_USER_TEMPLATE_V4).toContain('${nextChapterHook}');
    });

    it('nextChapterHook 登记在 fallback 键表里（否则占位符会原样发给模型）', () => {
        expect(TEMPLATE_VAR_FALLBACK_KEYS).toContain('nextChapterHook');
    });

    it('上一章结尾仍在模板中（后章约束不能替换掉前章锚点）', () => {
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('${prevChapEnding}');
        expect(BODY_GENERATION_USER_TEMPLATE_V4).toContain('${prevChapEnding}');
    });
});
