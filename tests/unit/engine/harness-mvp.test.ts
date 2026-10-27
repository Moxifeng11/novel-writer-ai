import { describe, it, expect } from 'vitest';
import { RuleEngine } from '../../../engine/harness/rule-engine';
import { ContextAggregator } from '../../../engine/harness/context-aggregator';
import { CallLedger } from '../../../engine/harness/call-ledger';
import { parseDelimitedSections, parseJsonObject, validateFields } from '../../../engine/harness/structured-output';

describe('harness rule engine', () => {
    it('合并写作规则/模式约束/反AI约束且去重', () => {
        const engine = new RuleEngine();
        const compiled = engine.compile({
            mode: 'long',
            scope: 'body',
            writingRules: '每段一次回车',
            creationModePrompt: '【长篇约束】',
            antiAiRules: ['禁止排比升华'],
            extraRules: [{
                id: 'test.rule',
                mode: 'long',
                scope: 'body',
                severity: 'must',
                source: 'platform',
                promptText: '每段一次回车',
            }],
        });
        expect(compiled.promptBlock).toContain('【项目写作规则】');
        expect(compiled.promptBlock).toContain('【长篇约束】');
        expect(compiled.promptBlock).toContain('【AI 痕迹约束】');
        expect(compiled.promptBlock.match(/每段一次回车/g)?.length ?? 0).toBeLessThanOrEqual(2);
    });

    it('本地校验输出字数与元文本', () => {
        const engine = new RuleEngine();
        const compiled = engine.compile({ mode: 'long', scope: 'body' });
        const violations = engine.validate(compiled.rules, '好的，我将开始写。', {
            mode: 'long',
            scope: 'body',
            targetWords: 3000,
        });
        const ids = violations.map(v => v.ruleId);
        expect(ids).toContain('harness.output.no-meta');
        expect(ids).toContain('harness.length.min');
    });
});

describe('harness context aggregator', () => {
    it('聚合去重并按优先级排序', () => {
        const aggregator = new ContextAggregator();
        const result = aggregator.aggregate({
            projectId: 'p',
            mode: 'long',
            taskKey: 'test',
            fragments: [
                { key: 'low', title: '低优先', content: 'aaa', priority: 1 },
                { key: 'high', title: '高优先', content: 'bbb', priority: 10 },
                { key: 'dup', title: '低优先', content: 'aaa', priority: 1 },
            ],
        });
        expect(result.sections.map(section => section.title)).toEqual(['高优先', '低优先']);
        expect(result.promptText).toContain('【高优先】');
    });

    it('缓存同名任务并在失效后重建', () => {
        const aggregator = new ContextAggregator();
        const input = {
            projectId: 'p',
            mode: 'long' as const,
            taskKey: 'cache',
            fragments: [{ key: 'a', title: 'A', content: '1', priority: 1 }],
        };
        const first = aggregator.aggregate(input);
        const second = aggregator.aggregate(input);
        expect(second).toBe(first);
        aggregator.invalidate('p');
        const third = aggregator.aggregate(input);
        expect(third).not.toBe(first);
    });
});

describe('harness call ledger', () => {
    it('区分逻辑调用与网络调用', () => {
        const ledger = new CallLedger();
        const key = ledger.start('task', 'project');
        ledger.markLogical(key);
        ledger.markNetwork(key);
        ledger.markNetwork(key, true);
        const entry = ledger.end(key, true);
        expect(entry?.logicalCalls).toBe(1);
        expect(entry?.networkCalls).toBe(2);
        expect(entry?.retriedCalls).toBe(1);
    });
});

describe('harness structured output', () => {
    it('解析 JSON 对象并校验字段', () => {
        const parsed = parseJsonObject('```json\n{"issues":["a"],"rewritten":"正文"}\n```');
        expect(parsed).toEqual({ issues: ['a'], rewritten: '正文' });
        const issues = validateFields(parsed as Record<string, unknown>, [
            { key: 'issues', type: 'string[]', required: true, description: '' },
            { key: 'rewritten', type: 'string', required: true, description: '' },
            { key: 'selfCheck', type: 'string', required: false, description: '' },
        ]);
        expect(issues).toEqual([]);
    });

    it('解析定界符段落', () => {
        const sections = parseDelimitedSections(
            '========== INFO_PLAN ==========\n规划\n\n========== OUTLINE ==========\n大纲',
            { infoPlan: '========== INFO_PLAN ==========', outline: '========== OUTLINE ==========' },
        );
        expect(sections).toEqual({ infoPlan: '规划', outline: '大纲' });
    });
});
