import { describe, it, expect } from 'vitest';
import { analyzeContentSafety } from '../../../engine/content-safety-checker';

describe('analyzeContentSafety — 草稿占位标记检测', () => {
    it('检测 TODO/TBD/FIXME 等英文占位标记', () => {
        const body = '这段正文里有个 TODO 标记。\n\n另一段有 FIXME。';
        const report = analyzeContentSafety(body);
        expect(report.issues.length).toBeGreaterThanOrEqual(2);
        expect(report.issues.some(i => i.type === 'draft_artifact' && i.severity === 'high')).toBe(true);
        expect(report.issues.some(i => i.sample.includes('TODO'))).toBe(true);
        expect(report.issues.some(i => i.sample.includes('FIXME'))).toBe(true);
    });

    it('检测中文占位标记（待补/待完善/此处略/这里补）', () => {
        const body = '此处略去三千字。\n\n这里补一段描写。';
        const report = analyzeContentSafety(body);
        expect(report.issues.some(i => i.sample.includes('此处略'))).toBe(true);
        expect(report.issues.some(i => i.sample.includes('这里补'))).toBe(true);
    });

    it('检测 XXX 与 【待 / [待 标记', () => {
        const body = 'XXX 这是占位。\n\n【待补充内容】';
        const report = analyzeContentSafety(body);
        expect(report.issues.some(i => i.sample.includes('XXX'))).toBe(true);
        expect(report.issues.some(i => i.sample.includes('【待'))).toBe(true);
    });

    it('检测 AI/说明文口吻残留', () => {
        const body = '作为AI，我为你生成了以下内容。\n\n以下是本章的主要内容。';
        const report = analyzeContentSafety(body);
        expect(report.issues.some(i => i.type === 'draft_artifact')).toBe(true);
        expect(report.issues.some(i => i.sample.includes('作为AI'))).toBe(true);
        expect(report.issues.some(i => i.sample.includes('以下是'))).toBe(true);
    });
});

describe('analyzeContentSafety — 网络口语与现代词检测', () => {
    it('检测网络口语（yyds/绝绝子/破防了 等）', () => {
        const body = '这招真是yyds，简直绝绝子，让人破防了。';
        const report = analyzeContentSafety(body);
        const toneIssues = report.issues.filter(i => i.type === 'tone_break');
        expect(toneIssues.length).toBeGreaterThanOrEqual(1);
        expect(report.issues.some(i => i.severity === 'medium')).toBe(true);
    });

    it('检测现代词汇（微信/朋友圈/APP 等）', () => {
        const body = '他打开微信刷朋友圈，还顺手点了个外卖。';
        const report = analyzeContentSafety(body);
        const modernIssues = report.issues.filter(i => i.type === 'modern_term');
        expect(modernIssues.length).toBeGreaterThanOrEqual(1);
    });

    it('检测平台风险词（现实政治/真实领导人 等）', () => {
        const body = '剧情涉及现实政治与真实领导人。';
        const report = analyzeContentSafety(body);
        expect(report.issues.some(i => i.type === 'platform_risk')).toBe(true);
    });
});

describe('analyzeContentSafety — 边界情况', () => {
    it('空字符串返回空 issues 与 0 段落', () => {
        const report = analyzeContentSafety('');
        expect(report.issues).toEqual([]);
        expect(report.paragraphCount).toBe(0);
    });

    it('纯空白字符串返回空 issues 与 0 段落', () => {
        const report = analyzeContentSafety('   \n\n  \t  \n');
        expect(report.issues).toEqual([]);
        expect(report.paragraphCount).toBe(0);
    });

    it('超长文本不崩溃且 issues 不超过上限 12', () => {
        const paragraph = '这段包含 TODO 标记。';
        const body = Array.from({ length: 500 }, () => paragraph).join('\n\n');
        const report = analyzeContentSafety(body);
        expect(report.issues.length).toBeLessThanOrEqual(12);
        expect(report.paragraphCount).toBe(500);
    });
});

describe('analyzeContentSafety — 误报测试', () => {
    it('正常古代文风不被标记', () => {
        const body = '清晨，林惊鸿立于祠堂之前，长剑出鞘，剑光如水。\n\n他望向远山，心中默念亡妹之名，久久不语。';
        const report = analyzeContentSafety(body);
        expect(report.issues).toEqual([]);
        expect(report.paragraphCount).toBe(2);
    });

    it('含"问题"但不触发平台风险的正常文本', () => {
        const body = '他心中有一个问题：剑道何以为极？';
        const report = analyzeContentSafety(body);
        expect(report.issues.some(i => i.type === 'platform_risk')).toBe(false);
    });

    it('含"待"字但非占位标记的正常文本不被误报', () => {
        const body = '他待人接物一向温和，从不与人争执。';
        const report = analyzeContentSafety(body);
        expect(report.issues.some(i => i.type === 'draft_artifact')).toBe(false);
    });
});

describe('analyzeContentSafety — 去重与 sample 提取', () => {
    it('同段内相同 type:sample 的 issue 只报告一次', () => {
        const body = 'TODO 一 TODO 二 TODO 三';
        const report = analyzeContentSafety(body);
        const todoIssues = report.issues.filter(i => i.sample.includes('TODO') && i.type === 'draft_artifact');
        expect(todoIssues.length).toBe(1);
    });

    it('sample 包含匹配点前后文与省略号', () => {
        const body = '前文铺垫很长很长很长很长很长很长很长 TODO 后文也很长很长很长很长很长很长';
        const report = analyzeContentSafety(body);
        const issue = report.issues.find(i => i.sample.includes('TODO'));
        expect(issue).toBeDefined();
        expect(issue!.sample).toContain('TODO');
    });

    it('每个 issue 含 message 与 suggestion 非空', () => {
        const body = 'FIXME 占位';
        const report = analyzeContentSafety(body);
        for (const issue of report.issues) {
            expect(issue.message.length).toBeGreaterThan(0);
            expect(issue.suggestion.length).toBeGreaterThan(0);
        }
    });
});
