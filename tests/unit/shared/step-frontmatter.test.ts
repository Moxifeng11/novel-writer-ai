import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildStepFrontmatter,
    parseStepFrontmatter,
    type StepStatus,
    type BuildStepFrontmatterOptions,
    type ParsedStepFrontmatter,
} from '../../../shared/step-frontmatter';

describe('buildStepFrontmatter', () => {
    const fixedTimestamp = '2025-07-02T12:00:00.000Z';

    it('构建基本 frontmatter', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            timestamp: fixedTimestamp,
        });

        expect(fm).toContain('---');
        expect(fm).toContain('tags: [信息规划, 步骤结果]');
        expect(fm).toContain('卷: ""');
        expect(fm).toContain('章: ""');
        expect(fm).toContain('step_status: generated');
        expect(fm).toContain('step_model: ""');
        expect(fm).toContain(`step_timestamp: "${fixedTimestamp}"`);
    });

    it('tags 数组第二个元素固定为「步骤结果」', () => {
        const fm = buildStepFrontmatter({
            tag: '大纲摘要',
            timestamp: fixedTimestamp,
        });

        expect(fm).toContain('tags: [大纲摘要, 步骤结果]');
    });

    it('包含卷和章信息', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            volume: '第1卷',
            chapter: '第1章',
            timestamp: fixedTimestamp,
        });

        expect(fm).toContain('卷: "第1卷"');
        expect(fm).toContain('章: "第1章"');
    });

    it('自定义状态', () => {
        const statuses: StepStatus[] = ['pending', 'generated', 'reviewed', 'stale'];
        for (const status of statuses) {
            const fm = buildStepFrontmatter({
                tag: '信息规划',
                status,
                timestamp: fixedTimestamp,
            });
            expect(fm).toContain(`step_status: ${status}`);
        }
    });

    it('默认状态为 generated', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            timestamp: fixedTimestamp,
        });
        expect(fm).toContain('step_status: generated');
    });

    it('包含模型信息', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            model: 'doubao-pro-32k',
            timestamp: fixedTimestamp,
        });
        expect(fm).toContain('step_model: "doubao-pro-32k"');
    });

    it('未提供 timestamp 时使用当前时间', () => {
        const before = new Date().toISOString();
        const fm = buildStepFrontmatter({ tag: '信息规划' });
        const after = new Date().toISOString();

        const match = fm.match(/step_timestamp:\s*"?([^"\n]+)"?/);
        expect(match).toBeTruthy();
        const ts = match![1];
        expect(ts >= before).toBe(true);
        expect(ts <= after).toBe(true);
    });

    it('支持 extra 自定义字段', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            timestamp: fixedTimestamp,
            extra: {
                情感温度: '8',
                冲突强度: '高',
            },
        });

        expect(fm).toContain('情感温度: "8"');
        expect(fm).toContain('冲突强度: "高"');
    });

    it('extra 字段按 key 排序', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            timestamp: fixedTimestamp,
            extra: {
                zeta: 'last',
                alpha: 'first',
                beta: 'middle',
            },
        });

        const alphaIdx = fm.indexOf('alpha:');
        const betaIdx = fm.indexOf('beta:');
        const zetaIdx = fm.indexOf('zeta:');

        expect(alphaIdx).toBeLessThan(betaIdx);
        expect(betaIdx).toBeLessThan(zetaIdx);
    });

    it('extra 支持数组值', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            timestamp: fixedTimestamp,
            extra: {
                涉及人物: ['张三', '李四'],
            },
        });

        expect(fm).toContain('涉及人物: ["张三", "李四"]');
    });

    it('空值字段保留', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            timestamp: fixedTimestamp,
        });

        expect(fm).toContain('卷: ""');
        expect(fm).toContain('章: ""');
        expect(fm).toContain('step_model: ""');
    });

    it('正确转义包含特殊字符的值', () => {
        const fm = buildStepFrontmatter({
            tag: '信息规划',
            volume: '第1卷: 初入江湖',
            timestamp: fixedTimestamp,
        });

        expect(fm).toContain('卷: "第1卷: 初入江湖"');
    });
});

describe('parseStepFrontmatter', () => {
    it('解析标准 frontmatter', () => {
        const content = `---
tags: [信息规划, 步骤结果]
卷: "第1卷"
章: "第1章"
step_status: generated
step_model: "doubao-pro-32k"
step_timestamp: "2025-07-02T12:00:00.000Z"
---

正文内容`;

        const result = parseStepFrontmatter(content);
        expect(result).not.toBeNull();
        expect(result!.tags).toEqual(['信息规划', '步骤结果']);
        expect(result!.volume).toBe('第1卷');
        expect(result!.chapter).toBe('第1章');
        expect(result!.step_status).toBe('generated');
        expect(result!.step_model).toBe('doubao-pro-32k');
        expect(result!.step_timestamp).toBe('2025-07-02T12:00:00.000Z');
    });

    it('无 frontmatter 返回 null', () => {
        const content = '# 标题\n\n普通文本内容';
        const result = parseStepFrontmatter(content);
        expect(result).toBeNull();
    });

    it('兼容旧格式 - 缺少 step 字段', () => {
        const content = `---
tags: [信息规划]
卷: "第1卷"
章: "第1章"
---

旧格式内容`;

        const result = parseStepFrontmatter(content);
        expect(result).not.toBeNull();
        expect(result!.tags).toEqual(['信息规划']);
        expect(result!.volume).toBe('第1卷');
        expect(result!.chapter).toBe('第1章');
        expect(result!.step_status).toBeUndefined();
        expect(result!.step_model).toBeUndefined();
        expect(result!.step_timestamp).toBeUndefined();
    });

    it('兼容旧格式 - 只有单个 tag', () => {
        const content = `---
tags: [大纲摘要]
卷: ""
章: ""
---

旧格式`;

        const result = parseStepFrontmatter(content);
        expect(result).not.toBeNull();
        expect(result!.tags).toEqual(['大纲摘要']);
    });

    it('解析带引号的值', () => {
        const content = `---
tags: [信息规划, 步骤结果]
卷: "第1卷"
章: "第1章: 开端"
---`;

        const result = parseStepFrontmatter(content);
        expect(result!.volume).toBe('第1卷');
        expect(result!.chapter).toBe('第1章: 开端');
    });

    it('解析不带引号的值', () => {
        const content = `---
tags: [信息规划, 步骤结果]
step_status: pending
step_model: doubao-pro-32k
---`;

        const result = parseStepFrontmatter(content);
        expect(result!.step_status).toBe('pending');
        expect(result!.step_model).toBe('doubao-pro-32k');
    });

    it('解析额外自定义字段', () => {
        const content = `---
tags: [信息规划, 步骤结果]
情感温度: "8"
冲突强度: 高
---`;

        const result = parseStepFrontmatter(content);
        expect(result!['情感温度']).toBe('8');
        expect(result!['冲突强度']).toBe('高');
    });

    it('解析数组类型的额外字段', () => {
        const content = `---
tags: [信息规划, 步骤结果]
涉及人物: ["张三", "李四"]
---`;

        const result = parseStepFrontmatter(content);
        expect(result!['涉及人物']).toEqual(['张三', '李四']);
    });

    it('处理跨行值', () => {
        const content = `---
tags: [信息规划, 步骤结果]
描述:
  这是一段
  多行描述
卷: "第1卷"
---`;

        const result = parseStepFrontmatter(content);
        expect(result!.volume).toBe('第1卷');
    });

    it('空 frontmatter 返回空 tags', () => {
        const content = `---
---`;
        const result = parseStepFrontmatter(content);
        expect(result).not.toBeNull();
        expect(result!.tags).toEqual([]);
    });
});

describe('build + parse 往返一致性', () => {
    it('构建后再解析，核心字段一致', () => {
        const options: BuildStepFrontmatterOptions = {
            tag: '信息规划',
            volume: '第1卷',
            chapter: '第1章',
            status: 'reviewed',
            model: 'doubao-pro-32k',
            timestamp: '2025-07-02T12:00:00.000Z',
            extra: {
                情感温度: '8',
                冲突强度: '高',
            },
        };

        const fm = buildStepFrontmatter(options);
        const parsed = parseStepFrontmatter(fm + '\n\n正文');

        expect(parsed).not.toBeNull();
        expect(parsed!.tags).toEqual(['信息规划', '步骤结果']);
        expect(parsed!.volume).toBe('第1卷');
        expect(parsed!.chapter).toBe('第1章');
        expect(parsed!.step_status).toBe('reviewed');
        expect(parsed!.step_model).toBe('doubao-pro-32k');
        expect(parsed!.step_timestamp).toBe('2025-07-02T12:00:00.000Z');
        expect(parsed!['情感温度']).toBe('8');
        expect(parsed!['冲突强度']).toBe('高');
    });
});
