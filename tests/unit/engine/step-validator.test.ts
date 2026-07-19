import { describe, it, expect } from 'vitest';
import { validateStepResult, isTemplateSkeleton } from '../../../engine/step-validator';

// 一个字段齐全、可达到 complete 的信息规划内容（5 项必填 + 3 场景加分）
// 注：场景用数字编号以命中正则 /场景\s*\d/
const VALID_INFO_PLAN = `核心冲突：主角与反派的生死对决即将在祠堂展开
情感温度：从平静到狂怒的剧烈过渡
冲突强度：从中等逐步升级到极限高压
熵预算与自信息：控制信息密度避免过早揭示真相
伏笔操作：埋下三处关键伏笔等待后续章节揭示
场景1：祠堂祭拜
场景2：后山追凶
场景3：灯下独坐`;

// 字段齐全的大纲摘要（3 必填 + 场景/地点/人物加分）
// 注：场景用数字编号以命中正则 /场景\s*\d/
const VALID_OUTLINE = `## 全书定位
这是一部以复仇与救赎为主线的东方玄幻小说，讲述少年剑客在乱世中寻找身世的故事。

## 关键场景
场景1：林家祠堂的血夜
场景2：后山追凶的雨夜
场景3：灯下独坐的顿悟
地点：京城、山门、密室

## 结尾钩子
主角终于看见亡妹的画像，真相浮出水面。

人物：林惊鸿、苏白、神秘老者`;

// 一段达到字数门槛的正文（>=2100 字，含对话与句末标点）
function makeValidBody(minLen = 2200): string {
    const paragraph = '他立于祠堂之前，长剑出鞘，剑光如水。林惊鸿望向远山，心中默念亡妹之名，久久不语。';
    let body = '# 第1章 祠堂血夜\n\n';
    body += '"你来了。"老者声音低沉。\n\n';
    while (body.length < minLen) {
        body += paragraph + '\n\n';
    }
    return body;
}

describe('validateStepResult — 未知步骤回退逻辑', () => {
    it('空内容返回 empty 级别与 0 分', () => {
        const r = validateStepResult('unknownStep', '');
        expect(r.level).toBe('empty');
        expect(r.score).toBe(0);
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('无内容');
    });

    it('内容过短（1-100 字）返回 skeleton', () => {
        const r = validateStepResult('unknownStep', '只有几十个字的短内容不足以通过校验');
        expect(r.level).toBe('skeleton');
        expect(r.valid).toBe(false);
    });

    it('中等内容（101-500 字）返回 partial', () => {
        const content = 'a'.repeat(200);
        const r = validateStepResult('unknownStep', content);
        expect(r.level).toBe('partial');
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('内容不足');
    });

    it('长内容（>500 字）未知步骤通过校验', () => {
        const content = 'a'.repeat(600);
        const r = validateStepResult('unknownStep', content);
        expect(r.level).toBe('complete');
        expect(r.valid).toBe(true);
        expect(r.score).toBe(80);
    });
});

describe('validateStepResult — infoPlan 信息规划', () => {
    it('空内容返回 empty', () => {
        const r = validateStepResult('infoPlan', '');
        expect(r.level).toBe('empty');
        expect(r.valid).toBe(false);
    });

    it('字段齐全的内容达到 complete', () => {
        const r = validateStepResult('infoPlan', VALID_INFO_PLAN);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
        expect(r.score).toBeGreaterThanOrEqual(85);
        expect(r.missing).toEqual([]);
    });

    it('缺字段时返回 missing 列表', () => {
        const r = validateStepResult('infoPlan', '核心冲突：一段足够长的核心冲突描述文本');
        expect(r.valid).toBe(false);
        expect(r.missing.length).toBeGreaterThan(0);
    });
});

describe('validateStepResult — outline 大纲摘要', () => {
    it('完整大纲达到 complete', () => {
        const r = validateStepResult('outline', VALID_OUTLINE);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
        expect(r.missing).toEqual([]);
    });

    it('只有空标题时非 complete', () => {
        const r = validateStepResult('outline', '## 全书定位\n## 关键场景\n## 结尾钩子');
        expect(r.valid).toBe(false);
    });
});

describe('validateStepResult — bodyGeneration 正文生成', () => {
    it('字数达标且含对话与结尾标点时 complete', () => {
        const body = makeValidBody();
        const r = validateStepResult('bodyGeneration', body);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('字数不足时 valid=false', () => {
        const body = '# 第1章\n\n短正文。';
        const r = validateStepResult('bodyGeneration', body);
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('字数达标');
    });
});

describe('validateStepResult — fix / finalFix 修正步骤', () => {
    it('字数与结构齐全时 complete', () => {
        const body = makeValidBody(2200);
        const r = validateStepResult('fix', body);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('finalFix 与 fix 共用同一校验器', () => {
        const body = makeValidBody(2200);
        const rFix = validateStepResult('fix', body);
        const rFinal = validateStepResult('finalFix', body);
        expect(rFix.valid).toBe(rFinal.valid);
    });

    it('内容不足时 valid=false', () => {
        const r = validateStepResult('fix', '太短');
        expect(r.valid).toBe(false);
    });
});

describe('validateStepResult — analysisReport 审查步骤', () => {
    it('包含问题分析、总结与细节时必填项齐全（missing 为空）', () => {
        // 注：源码 validateAuditStep 的 extraBonus 上限为 10（hasIssues?10:0），
        // 最高分 70+10=80 < 85，结构上无法达到 complete，此处按实际行为断言。
        const content = `## 问题分析
场景一存在人物OOC问题，需修正。

## 总结评价
整体结构良好，建议改进方向为强化情感铺垫。

第1节细节描述`;
        const r = validateStepResult('analysisReport', content);
        expect(r.missing).toEqual([]);
        expect(r.score).toBe(80);
        expect(r.level).toBe('partial');
    });

    it('缺总结评价时 missing 含"总结评价"', () => {
        const content = '## 问题分析\n发现若干问题需修正。\n\n第1节细节';
        const r = validateStepResult('analysisReport', content);
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('总结评价');
    });

    it('空内容返回 empty', () => {
        const r = validateStepResult('analysisReport', '');
        expect(r.level).toBe('empty');
        expect(r.valid).toBe(false);
    });
});

describe('isTemplateSkeleton — 模板骨架判断', () => {
    it('空内容判定为骨架', () => {
        expect(isTemplateSkeleton('')).toBe(true);
    });

    it('过短内容（<30 字）判定为骨架', () => {
        expect(isTemplateSkeleton('短内容')).toBe(true);
    });

    it('含（待 auto_writer 标记判定为骨架', () => {
        expect(isTemplateSkeleton('这是一段足够长的内容但是包含（待 auto_writer 标记')).toBe(true);
    });

    it('含（待定）标记判定为骨架', () => {
        expect(isTemplateSkeleton('这是一段足够长的内容但是包含（待定）标记')).toBe(true);
    });

    it('outline 步骤 <80 字判定为骨架', () => {
        expect(isTemplateSkeleton('短大纲内容', 'outline')).toBe(true);
    });

    it('正常长内容不判定为骨架', () => {
        expect(isTemplateSkeleton('a'.repeat(100))).toBe(false);
    });
});
