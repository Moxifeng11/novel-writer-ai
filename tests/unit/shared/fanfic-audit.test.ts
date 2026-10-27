import { describe, expect, it } from 'vitest';
import { applyFanficReviewMeta, auditFanficSettings } from '../../../shared/fanfic-audit';
import { createCanonSource } from '../../../shared/canon-source';
import { formatFanficRulesForPrompt, parseFanficReviewStatus, parseFanficRules } from '../../../shared/fanfic-rules';

const BASE = `---
作品名称: 测试原作
作品类型: 玄幻
作者: 测试作者
世界观类型: 大陆
力量体系: 斗气
核心规则: 等级分明
---

# 测试原作 同人设定

## 原作核心设定
- **世界观类型**：大陆
- **力量体系**：斗气
- **核心规则**：等级分明

## 创作规则
- **必须遵守的原作规则**：不得改历史
- **允许改编的范围**：可新增支线
- **禁止触及的红线**：不得复活已死角色

## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---------|---------|---------|---------|----------------|
| 第一年 | 主角觉醒 | 甲 | 第1章 | 同一天 |
`;

describe('fanfic review gate', () => {
    it('识别 pending / approved / legacy', () => {
        expect(parseFanficReviewStatus('审核状态: pending')).toBe('pending');
        expect(parseFanficReviewStatus('审核状态: approved')).toBe('approved');
        expect(parseFanficReviewStatus('没有状态')).toBe('legacy');
    });

    it('pending 设定不会进入写作提示词', () => {
        const rules = parseFanficRules(`${BASE}\n审核状态: pending\n`, 'x.md');
        expect(rules.reviewStatus).toBe('pending');
        expect(formatFanficRulesForPrompt(rules)).toBe('');
    });

    it('写入审核状态不会破坏正文', () => {
        const updated = applyFanficReviewMeta(`${BASE}\n审核状态: pending\n`, {
            '审核状态': 'approved',
            '审核人': '测试',
        });
        expect(updated).toContain('审核状态: approved');
        expect(updated).toContain('审核人: 测试');
        expect(updated).toContain('## 原作剧情时间线');
        expect(updated.match(/审核状态:/g)?.length).toBe(1);
    });

    it('引用衍生来源时审核失败', () => {
        const sources = [createCanonSource({ url: 'https://www.lofter.com/x', title: '同人设定', excerpt: '衍生内容' }, 0)];
        const audit = auditFanficSettings(BASE, sources, { requireApproved: false });
        expect(audit.overall).toBe('fail');
        expect(audit.issues.some(issue => issue.code === 'derivative-source')).toBe(true);
    });

    it('没有来源时审核失败并标出 no-source', () => {
        const audit = auditFanficSettings(BASE, [], { requireApproved: false });
        expect(audit.issues.some(issue => issue.code === 'no-source')).toBe(true);
    });
});