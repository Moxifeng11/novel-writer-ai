/**
 * 「知识库素材 → 同人设定草稿 → 联网验证」纯逻辑（v4.83.1）
 *
 * 需求：同人设定可以先由知识库拆解内容生成，再用联网搜索验证，通过后补进设定库。
 *
 * 本文件锁定四个环节的纯逻辑：
 * 1. 知识库素材进 prompt 前必须围栏（拆解报告属外部内容，S3-2 同口径）
 * 2. 生成 prompt 明确「素材是二手提炼，不得扩写」
 * 3. 验证报告解析宽容但**不危险默认**（解析失败 ≠ 全部通过）
 * 4. 验证结论写进 meta，不自动放行审核
 */

import { describe, expect, it } from 'vitest';
import {
    formatKnowledgeMaterialsForPrompt,
    buildKnowledgeDraftPrompt,
    buildVerificationPrompt,
    parseVerificationReport,
    verdictOf,
    applyVerificationMeta,
    verificationVerdictLabel,
    type KnowledgeMaterial,
} from '../../../services/fanfic-knowledge-draft';

/** 构造素材 */
function material(partial: Partial<KnowledgeMaterial> = {}): KnowledgeMaterial {
    return {
        bookName: partial.bookName ?? '参考书',
        dimension: partial.dimension ?? 'character',
        sample: partial.sample ?? '主角出身贫寒，性格谨慎。',
        score: partial.score ?? 0.8,
    };
}

/** 带 frontmatter 的最小草稿 */
const DRAFT = `---
作品名称: 测试
作品类型: 长篇
作者: 某人
---

# 测试 同人设定

## 原作核心设定
- **世界观类型**：修真
`;

describe('formatKnowledgeMaterialsForPrompt — 素材围栏与预算', () => {
    it('每条素材带「书名·维度」标注并围栏', () => {
        const text = formatKnowledgeMaterialsForPrompt([material()]);
        expect(text).toContain('参考书·character');
        expect(text).toContain('主角出身贫寒');
        // 围栏标记（wrapUntrustedContent 会带出「知识库拆解素材」标签）
        expect(text).toContain('知识库拆解素材');
    });

    it('按相关度降序排列', () => {
        const text = formatKnowledgeMaterialsForPrompt([
            material({ bookName: '低分书', score: 0.2 }),
            material({ bookName: '高分书', score: 0.9 }),
        ]);
        expect(text.indexOf('高分书')).toBeLessThan(text.indexOf('低分书'));
    });

    it('空素材返回空串', () => {
        expect(formatKnowledgeMaterialsForPrompt([])).toBe('');
    });

    it('字符预算生效', () => {
        const long = material({ sample: '很长'.repeat(2000) });
        const text = formatKnowledgeMaterialsForPrompt([long], 200);
        expect(text.length).toBeLessThan(600);
    });
});

describe('buildKnowledgeDraftPrompt — 生成 prompt 语义', () => {
    it('明确告知素材是二手提炼、不得扩写', () => {
        const { system } = buildKnowledgeDraftPrompt('某书', '骨架', [material()]);
        expect(system).toContain('二手');
        expect(system).toContain('不得补全');
    });

    it('要求无依据处写「待核实」', () => {
        const { system } = buildKnowledgeDraftPrompt('某书', '骨架', [material()]);
        expect(system).toContain('待核实');
    });

    it('禁止引用衍生作品', () => {
        const { system } = buildKnowledgeDraftPrompt('某书', '骨架', [material()]);
        expect(system).toContain('同人');
        expect(system).toContain('衍生作品');
    });

    it('素材为空时给出明确占位（不让模型凭空写）', () => {
        const { system } = buildKnowledgeDraftPrompt('某书', '骨架', []);
        expect(system).toContain('没有可用素材');
    });

    it('user 段带作品名与骨架', () => {
        const { user } = buildKnowledgeDraftPrompt('遮天', '【骨架内容】', [material()]);
        expect(user).toContain('遮天');
        expect(user).toContain('【骨架内容】');
    });
});

describe('buildVerificationPrompt — 验证 prompt 语义', () => {
    it('三类判定口径都在', () => {
        const { system } = buildVerificationPrompt(DRAFT, '【来源】');
        expect(system).toContain('supported');
        expect(system).toContain('unverified');
        expect(system).toContain('contradicted');
    });

    it('要求只依据来源、不得用模型记忆', () => {
        const { system } = buildVerificationPrompt(DRAFT, '【来源】');
        expect(system).toContain('不得使用模型记忆');
    });

    it('明确不要改写草稿（验证结论必须与草稿对应）', () => {
        const { system } = buildVerificationPrompt(DRAFT, '【来源】');
        expect(system).toContain('不要改写草稿');
    });

    it('无来源时给出明确占位', () => {
        const { system } = buildVerificationPrompt(DRAFT, '');
        expect(system).toContain('没有检索到可用来源');
    });
});

describe('parseVerificationReport — 宽容解析但不危险默认', () => {
    it('按三类分别收集', () => {
        const report = parseVerificationReport([
            'supported | 世界观类型=修真 | 来源 S1',
            'unverified | 主要人物 | 来源未提及',
            'contradicted | 力量体系=金丹 | 与 S2 矛盾',
        ].join('\n'));
        expect(report.supported).toHaveLength(1);
        expect(report.unverified).toHaveLength(1);
        expect(report.contradicted).toHaveLength(1);
        expect(report.supported[0]).toContain('修真');
    });

    it('兼容全角竖线与大小写', () => {
        const report = parseVerificationReport('SUPPORTED ｜ 某条目 ｜ 依据');
        expect(report.supported).toHaveLength(1);
    });

    it('无法解析的输出不会变成「全部通过」', () => {
        const report = parseVerificationReport('模型说了一堆废话，没有按格式输出。');
        expect(report.supported).toHaveLength(0);
        expect(report.unverified).toHaveLength(0);
        expect(report.contradicted).toHaveLength(0);
        // 关键：结论是 unknown 而不是 pass
        expect(verdictOf(report)).toBe('unknown');
    });

    it('忽略「结论：」行（不当作条目）', () => {
        const report = parseVerificationReport('结论：pass');
        expect(report.supported).toHaveLength(0);
    });

    it('保留原始输出便于排查', () => {
        const raw = 'supported | a | b';
        expect(parseVerificationReport(raw).raw).toBe(raw);
    });
});

describe('verdictOf — 结论判定优先级', () => {
    it('有矛盾即 fail（最高优先）', () => {
        expect(verdictOf({
            supported: ['a'], unverified: ['b'], contradicted: ['c'], raw: '',
        })).toBe('fail');
    });

    it('无矛盾但有存疑为 partial', () => {
        expect(verdictOf({
            supported: ['a'], unverified: ['b'], contradicted: [], raw: '',
        })).toBe('partial');
    });

    it('全部有支持为 pass', () => {
        expect(verdictOf({
            supported: ['a', 'b'], unverified: [], contradicted: [], raw: '',
        })).toBe('pass');
    });

    it('无任何条目为 unknown（不默认通过）', () => {
        expect(verdictOf({ supported: [], unverified: [], contradicted: [], raw: '' })).toBe('unknown');
    });
});

describe('applyVerificationMeta — 结论写进 meta', () => {
    it('写入验证结论、来源数与时间', () => {
        const out = applyVerificationMeta(DRAFT, {
            supported: ['a'], unverified: [], contradicted: [], raw: '',
        }, 3);
        expect(out).toContain('联网验证结论');
        expect(out).toContain('pass');
        expect(out).toContain('联网验证来源数');
        expect(out).toContain('3');
        expect(out).toContain('知识库生成');
    });

    it('fail 时摘要明确要求修正', () => {
        const out = applyVerificationMeta(DRAFT, {
            supported: [], unverified: [], contradicted: ['力量体系错了'], raw: '',
        }, 2);
        expect(out).toContain('fail');
        expect(out).toContain('必须修正');
    });

    it('不改变正文内容（只在 frontmatter 加 meta）', () => {
        const out = applyVerificationMeta(DRAFT, {
            supported: ['a'], unverified: [], contradicted: [], raw: '',
        }, 1);
        expect(out).toContain('## 原作核心设定');
        expect(out).toContain('- **世界观类型**：修真');
    });
});

describe('verificationVerdictLabel — 中文标签', () => {
    it('四种结论都有标签', () => {
        expect(verificationVerdictLabel('pass')).toContain('通过');
        expect(verificationVerdictLabel('partial')).toContain('存疑');
        expect(verificationVerdictLabel('fail')).toContain('矛盾');
        expect(verificationVerdictLabel('unknown')).toContain('无结论');
    });
});
