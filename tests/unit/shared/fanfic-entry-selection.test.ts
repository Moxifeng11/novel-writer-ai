/**
 * 同人人物 / 势力注入：超过上限（6 条）时按当前章节上下文选取，而不是永远取前 6 条。
 *
 * 模板把「## 主要人物」「## 势力组织」当成本章可用的原作资料，
 * 但本地 8K 窗口只能注入 6 条。固定取前 6 条会让「本章真正出场、却排在第 7 位之后」的角色/势力
 * 完全不可见，模型只能靠猜——这与「模板承诺的结构必须被读取侧消费」相悖。
 */
import { describe, it, expect } from 'vitest';
import {
    formatFanficRulesForPrompt,
    parseFanficRules,
    FANFIC_MAX_INJECTED_CHARACTERS,
} from '../../../shared/fanfic-rules';

function characterSection(name: string): string {
    return `- **人物名**：${name}\n  - **原作定位**：定位${name}\n  - **在同人中的变化**：变化${name}\n`;
}

function factionSection(name: string): string {
    return `- **势力名**：${name}\n  - **原作定位**：定位${name}\n  - **在同人中的变化**：变化${name}\n`;
}

function buildContent(characterCount: number, factionCount = 0): string {
    const characters = Array.from({ length: characterCount }, (_, index) => characterSection(`角色${index + 1}`)).join('');
    const factions = Array.from({ length: factionCount }, (_, index) => factionSection(`势力${index + 1}`)).join('');
    return `# 测试原作 同人设定

## 主要人物
${characters}
## 势力组织
${factions}
`;
}

function format(characterCount: number, focusText?: string, factionCount = 0): string {
    const rules = parseFanficRules(buildContent(characterCount, factionCount), '设定.md');
    return formatFanficRulesForPrompt(rules, { focusText });
}

function sectionOf(text: string, title: string): string {
    const start = text.indexOf(title);
    if (start < 0) return '';
    const rest = text.slice(start + title.length);
    const nextSection = rest.indexOf('【');
    return nextSection >= 0 ? rest.slice(0, nextSection) : rest;
}

describe('同人人物注入按章节相关度选取', () => {
    it('本章提到第 8 位角色时，注入集合包含该角色', () => {
        const text = format(8, '本章：角色8 推门而入，众人回头。');
        const section = sectionOf(text, '【原作主要人物】');

        expect(section).toContain('角色8');
        expect(section).not.toContain('角色7');
        expect(section).toContain('（原作主要人物共 8 人，以上为与当前章节相关的 6 人）');
        expect(section.split('\n').filter((line) => /^- 角色\d+（/.test(line))).toHaveLength(
            FANFIC_MAX_INJECTED_CHARACTERS,
        );
    });

    it('没有章节上下文时保持原来的前 6 条（向后兼容）', () => {
        const text = format(8);
        const section = sectionOf(text, '【原作主要人物】');

        expect(section).toContain('角色6');
        expect(section).not.toContain('角色7');
        expect(section).toContain('（原作主要人物共 8 人，以上为前 6 人）');
    });

    it('提到次数多的角色排在前面', () => {
        const text = format(8, '角色8 先说话。角色7 点头。角色8 又补充了一句。');
        const section = sectionOf(text, '【原作主要人物】');

        expect(section.indexOf('角色8')).toBeLessThan(section.indexOf('角色7'));
        expect(section).toContain('角色8');
        expect(section).toContain('角色7');
    });

    it('势力组织按同一规则选取', () => {
        const text = format(2, '本章：势力8 出手干预。', 8);
        const section = sectionOf(text, '【原作势力组织】');

        expect(section).toContain('势力8');
        expect(section).not.toContain('势力7');
        expect(section).toContain('（原作势力组织共 8 个，以上为与当前章节相关的 6 个）');
    });

    it('未超过上限时不出现截断说明', () => {
        const text = format(3, '角色1 出场');

        expect(text).not.toContain('（原作主要人物共');
    });

    it('空 focusText 与未传 focusText 行为一致', () => {
        const text = format(8, '');

        expect(text).toContain('角色6');
        expect(text).not.toContain('角色7');
    });
});
