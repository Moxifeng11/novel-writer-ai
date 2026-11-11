/**
 * 同人考据来源分级：官方优先 + 二手补充 + 衍生排除（v4.83.1）
 *
 * 背景：安全审计 S3-3 把 `official` 收紧为「只认发行人域名」后，
 * `formatCanonSourcesForPrompt` 只保留 official/official-wiki —— 而同人创作最依赖的
 * wiki/百科（reference）全被丢弃，于是 prompt 里返回「没有可用的官方原著来源」，
 * 模型只能输出「待核实」。这是「同人设定补充不了」的直接原因。
 *
 * 本文件锁定修复后的语义：
 * 1. **官方优先**：有官方来源时只用官方，二手不参与
 * 2. **二手补充**：无官方时回落 reference，但 prompt 显式标注等级与冲突规则
 * 3. **衍生排除**：derivative（同人/改编/外传/fandom）**任何情况都不入选**
 */

import { describe, expect, it } from 'vitest';
import {
    classifyCanonSource,
    createCanonSource,
    formatCanonSourcesForPrompt,
    isAuthoritativeSource,
    isReferenceSource,
    selectSourcesForPrompt,
    selectAuthoritativeSources,
    type CanonSource,
} from '../../../shared/canon-source';

/** 构造来源（走真实分级逻辑） */
function source(url: string, title = '资料页', excerpt = '这是摘录内容，足够长以通过非空检查。'): CanonSource {
    return createCanonSource({ url, title, excerpt }, 0);
}

/** 起点（官方发行人域名） */
const OFFICIAL = () => source('https://www.qidian.com/book/123', '某书 - 起点中文网');
/** 百度百科（二手 reference） */
const BAIDU = () => source('https://baike.baidu.com/item/某书', '某书_百度百科');
/** 萌娘百科（二手 reference，v4.83.1 新增） */
const MOEGIRL = () => source('https://zh.moegirl.org.cn/某书', '某书 - 萌娘百科');
/** Fandom（衍生 derivative，必须排除） */
const FANDOM = () => source('https://somefandom.fandom.com/wiki/X', '某书 Wiki | Fandom');
/** 同人站（衍生 derivative） */
const AO3 = () => source('https://archiveofourown.org/works/1', '某书同人');

describe('来源分级口径', () => {
    it('发行人域名 → official', () => {
        expect(OFFICIAL().tier).toBe('official');
        expect(isAuthoritativeSource('official')).toBe(true);
    });

    it('百科/wiki → reference（v4.83.1 起含萌娘百科与 Bangumi）', () => {
        expect(BAIDU().tier).toBe('reference');
        expect(MOEGIRL().tier).toBe('reference');
        expect(source('https://bgm.tv/subject/1').tier).toBe('reference');
        expect(isReferenceSource('reference')).toBe(true);
    });

    it('Fandom / 同人站 → derivative，且不被任何档位接纳', () => {
        expect(FANDOM().tier).toBe('derivative');
        expect(AO3().tier).toBe('derivative');
        expect(isAuthoritativeSource('derivative')).toBe(false);
        expect(isReferenceSource('derivative')).toBe(false);
    });

    it('未知域名 → unknown，不进任何可入选集合', () => {
        const unknown = source('https://example.com/x', '某页面');
        expect(unknown.tier).toBe('unknown');
        expect(isAuthoritativeSource('unknown')).toBe(false);
        expect(isReferenceSource('unknown')).toBe(false);
    });
});

describe('selectSourcesForPrompt — 官方优先、二手补充、衍生排除', () => {
    it('有官方来源时只用官方，二手不参与', () => {
        const picked = selectSourcesForPrompt([OFFICIAL(), BAIDU(), MOEGIRL()]);
        expect(picked.authoritative).toHaveLength(1);
        expect(picked.references).toHaveLength(0);
    });

    it('无官方来源时回落到二手参考', () => {
        const picked = selectSourcesForPrompt([BAIDU(), MOEGIRL()]);
        expect(picked.authoritative).toHaveLength(0);
        expect(picked.references).toHaveLength(2);
    });

    it('衍生作品在任何情况下都不入选', () => {
        const onlyDerivative = selectSourcesForPrompt([FANDOM(), AO3()]);
        expect(onlyDerivative.authoritative).toHaveLength(0);
        expect(onlyDerivative.references).toHaveLength(0);

        const mixed = selectSourcesForPrompt([FANDOM(), BAIDU(), OFFICIAL()]);
        const allUrls = [...mixed.authoritative, ...mixed.references].map(s => s.url);
        expect(allUrls.some(url => url.includes('fandom'))).toBe(false);
    });

    it('空摘录的来源不入选', () => {
        const empty = source('https://baike.baidu.com/item/x', '标题', '');
        expect(selectSourcesForPrompt([empty]).references).toHaveLength(0);
    });
});

describe('formatCanonSourcesForPrompt — prompt 语义', () => {
    it('有官方时输出官方段并标注等级', () => {
        const prompt = formatCanonSourcesForPrompt([OFFICIAL()]);
        expect(prompt).toContain('【官方原著资料】');
        expect(prompt).toContain('等级：官方原著');
        expect(prompt).not.toContain('【二手参考资料】');
    });

    it('只有二手时输出二手段，并明确要求标注「据二手资料」', () => {
        const prompt = formatCanonSourcesForPrompt([BAIDU(), MOEGIRL()]);
        expect(prompt).toContain('【二手参考资料】');
        expect(prompt).toContain('据二手资料');
        expect(prompt).toContain('等级：参考资料');
    });

    it('官方与二手同时存在时只渲染官方段（二手被官方优先挤掉）', () => {
        const prompt = formatCanonSourcesForPrompt([OFFICIAL(), BAIDU()]);
        expect(prompt).toContain('【官方原著资料】');
        expect(prompt).not.toContain('【二手参考资料】');
        expect(prompt).not.toContain('baike.baidu.com');
    });

    it('衍生来源即使只有它也不进 prompt，返回待核实', () => {
        const prompt = formatCanonSourcesForPrompt([FANDOM(), AO3()]);
        expect(prompt).toContain('待核实');
        expect(prompt).not.toContain('fandom.com');
        expect(prompt).not.toContain('archiveofourown');
    });

    it('空来源返回待核实提示', () => {
        expect(formatCanonSourcesForPrompt([])).toContain('待核实');
    });

    it('三种来源齐备时规则段写明「衍生已排除」与「冲突以官方为准」', () => {
        const prompt = formatCanonSourcesForPrompt([OFFICIAL()]);
        expect(prompt).toContain('冲突时一律以官方为准');
        expect(prompt).toContain('衍生作品');
        expect(prompt).toContain('已从来源中排除');
    });

    it('摘录仍被围栏（S3-2 不被本次改动破坏）', () => {
        const prompt = formatCanonSourcesForPrompt([BAIDU()]);
        expect(prompt).toContain('原著摘录');
        expect(prompt).toMatch(/【|\[UNTRUSTED|untrusted/i);
    });

    it('字符预算仍然生效', () => {
        const long = createCanonSource({
            url: 'https://baike.baidu.com/item/长',
            title: '长条目',
            excerpt: '很长的摘录'.repeat(500),
        }, 0);
        const prompt = formatCanonSourcesForPrompt([long], 300);
        expect(prompt.length).toBeLessThan(1200);
    });
});

describe('向后兼容：selectAuthoritativeSources 语义不变', () => {
    it('仍然只返回官方两档（其他调用方依赖）', () => {
        const picked = selectAuthoritativeSources([OFFICIAL(), BAIDU(), MOEGIRL()]);
        expect(picked).toHaveLength(1);
        expect(picked[0].tier).toBe('official');
    });
});

describe('classifyCanonSource 的 derivative 优先级', () => {
    it('衍生关键词优先于官方域名（标题写「同人」的起点页也不算官方）', () => {
        expect(classifyCanonSource({ url: 'https://www.qidian.com/x', title: '某书同人' })).toBe('derivative');
    });

    it('百科域名 + 官方字样标题仍是 reference（S3-3：标题不能授予权威）', () => {
        expect(classifyCanonSource({ url: 'https://baike.baidu.com/item/x', title: '官方原著设定' })).toBe('reference');
    });
});
