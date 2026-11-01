/**
 * ContextManager.extractTopSection — 文笔风格「零、参考样本」小节定位契约
 *
 * 回归背景：`new RegExp(\`^##\s*${title}\`)` 在模板字符串里 `\s` 退化成字面量 `s`，
 * 实际正则为 `^##s*零、参考样本`，永远匹配不到 `## 零、参考样本`，
 * 导致样本校验恒失败、文笔样本静默不注入。
 */
import { describe, it, expect } from 'vitest';
import { ContextManager } from '../../../engine/context-manager';

type SectionExtractor = {
    extractTopSection: (content: string, title: string) => string;
    hasUsableStyleSamples: (content: string) => boolean;
};

const proto = ContextManager.prototype as unknown as SectionExtractor;

const SAMPLE = '他推开门，风从走廊尽头灌进来，桌上摊开的纸页被掀得哗啦响。他站着没动，等那阵风过去，才慢慢走到桌前把纸页一张张压住。' +
    '窗外的雨还没停，玻璃上挂着一层细密的水痕，路灯的光被拉成一条条晃动的线。他把外套脱下搭在椅背上，坐下，翻开最上面那张纸，' +
    '发现字迹被雨水洇开了一角，像是有人先他一步看过这些内容。';

const CONTENT = `## 零、参考样本

${SAMPLE}

## 一、句式与节奏

- 短句为主，偶尔长句收束。
`;

describe('extractTopSection', () => {
    it('能定位 `## 零、参考样本` 小节正文', () => {
        const section = proto.extractTopSection(CONTENT, '零、参考样本');
        expect(section.trim()).toBe(SAMPLE);
    });

    it('标题含正则元字符时仍能定位', () => {
        const content = `## 零、参考样本（v2）\n\n${SAMPLE}\n`;
        expect(proto.extractTopSection(content, '零、参考样本（v2）').trim()).toBe(SAMPLE);
    });

    it('小节不存在时返回空串', () => {
        expect(proto.extractTopSection(CONTENT, '九、不存在')).toBe('');
    });
});

describe('hasUsableStyleSamples', () => {
    it('样本达到 120 字即视为可用', () => {
        expect(proto.hasUsableStyleSamples(CONTENT)).toBe(true);
    });

    it('占位符未替换时视为不可用', () => {
        const placeholder = '## 零、参考样本\n\n（在此粘贴样本）\n';
        expect(proto.hasUsableStyleSamples(placeholder)).toBe(false);
    });
});
