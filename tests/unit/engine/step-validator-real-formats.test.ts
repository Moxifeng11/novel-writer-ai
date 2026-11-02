import { describe, expect, it } from 'vitest';
import { normalizeStepMarkup, validateStepResult } from '../../../engine/step-validator';

/**
 * 真实链路实测（第2章一键成文）暴露的三类误判：
 * 1. 正文字数/对话：写作规范输出中文弯引号，旧正则只认 ASCII " 与「」
 * 2. 质控标题带中文序号（`## 一、写作技法检查`）与包裹符（`## 【修改建议汇总】`）
 * 3. 三项必填齐全但缺一个加分项时永远到不了 85 分
 */
describe('step-validator — 真实模型输出格式兼容', () => {
    const curlyDialogueBody = [
        '# 第2章 环下旧痕',
        '',
        '　　砂打在脸上。沈砚把肩膀往绳栏上又抵了抵。',
        '　　“站直了。”父亲的声音压得极低。',
        '　　“知道了。”他低声应了一句。',
        '',
        `${'砂粒硌着脚趾，他一步一步往前挪。'.repeat(80)}`,
        '　　转到最后，就停不下来。',
    ].join('\n');

    it('中文弯引号对话被识别，不再误判「缺少对话描写」', () => {
        const result = validateStepResult('bodyGeneration', curlyDialogueBody);
        expect(result.missing).not.toContain('对话描写');
    });

    it('只有 ASCII 引号与「」的老格式仍然通过', () => {
        const ascii = curlyDialogueBody.replace(/“|”/g, '"');
        expect(validateStepResult('bodyGeneration', ascii).missing).not.toContain('对话描写');
        const corner = curlyDialogueBody.replace(/“/g, '「').replace(/”/g, '」');
        expect(validateStepResult('bodyGeneration', corner).missing).not.toContain('对话描写');
    });

    it('标题序号与包裹符被规范化（供各结构校验器按关键词匹配）', () => {
        const normalized = normalizeStepMarkup([
            '## 一、写作技法检查',
            '正文',
            '## 【修改建议汇总】',
            '正文',
            '## （三）质量评估',
            '正文',
        ].join('\n'));
        expect(normalized).toContain('## 写作技法检查');
        expect(normalized).toContain('## 修改建议汇总');
        expect(normalized).toContain('## 质量评估');
    });

    it('质控三项必填齐全但没有【修改建议】时仍判完成（加分项不应阻塞）', () => {
        const quality = [
            '## 一、写作技法检查',
            '逐句核对：无排比滥用，标点规范，段落节奏参差但合理。',
            '⚠️ 待改进：结尾总结句重复两次。',
            '',
            '## 二、连贯性审查',
            '设定冲突：无。人物OOC：无。前后衔接顺畅，锁脉环裂纹与第1章结尾的异常一致，'
                + '沈砚的伤势与上一章结算状态吻合，时间线连续。',
            '',
            '## 三、质量评估',
            '大纲偏离：无。信息密度合格，爽点分布均匀，结尾钩子与章纲要求一致，'
                + '没有出现提前揭示后续伏笔的问题。',
        ].join('\n');
        const result = validateStepResult('qualityControl', quality);
        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
    });

    it('质控缺整段必填模块时仍判不完整，并列出缺失项', () => {
        const partialQuality = [
            '## 一、写作技法检查',
            '逐句核对：无排比滥用，标点规范，段落节奏参差但合理。',
            '',
            '## 三、质量评估',
            '大纲偏离：无。信息密度合格。',
        ].join('\n');
        const result = validateStepResult('qualityControl', partialQuality);
        expect(result.valid).toBe(false);
        // v4.26：缺失项按「新六块」报；旧三块名（连贯性审查）任一出现也算点名成功
        expect(
            result.missing.some((m) => ['连贯性审查', '世界与设定观感'].includes(m)),
        ).toBe(true);
    });
});
