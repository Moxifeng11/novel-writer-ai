import { describe, expect, it } from 'vitest';
import {
    formatPlanForPrompt,
    parsePlanSteps,
    summarizePlanUpdate,
} from '../../../engine/agent/harness/creation-plan';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import type { AgentSessionEvent } from '../../../engine/agent/harness/harness-types';

describe('creation-plan — 创作计划（dsh plan-mode 移植）', () => {
    it('解析合法步骤并保留顺序与状态', () => {
        const steps = parsePlanSteps([
            { step: '配置世界观', status: 'done' },
            { step: '写第1章正文', status: 'in_progress' },
            { step: '导出成稿', status: 'pending' },
        ]);
        expect(steps).toEqual([
            { step: '配置世界观', status: 'done' },
            { step: '写第1章正文', status: 'in_progress' },
            { step: '导出成稿', status: 'pending' },
        ]);
    });

    it('非法状态回落为 pending，空 step 丢弃', () => {
        const steps = parsePlanSteps([
            { step: '有效步骤', status: 'done' },
            { step: '', status: 'done' },
            { step: '状态乱写', status: 'whatever' },
            'not-an-object',
        ]);
        expect(steps).toEqual([
            { step: '有效步骤', status: 'done' },
            { step: '状态乱写', status: 'pending' },
        ]);
    });

    it('超过 8 步截断，空数组/非数组返回 null', () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ step: `步骤${i}`, status: 'pending' }));
        expect(parsePlanSteps(many)).toHaveLength(8);
        expect(parsePlanSteps([])).toBeNull();
        expect(parsePlanSteps('nope')).toBeNull();
        expect(parsePlanSteps(null)).toBeNull();
    });

    it('渲染给提示词与 UI 摘要', () => {
        const steps = [
            { step: '配置世界观', status: 'done' as const },
            { step: '写第1章正文', status: 'in_progress' as const },
            { step: '导出成稿', status: 'pending' as const },
        ];
        const prompt = formatPlanForPrompt(steps);
        expect(prompt).toContain('1. [已完成] 配置世界观');
        expect(prompt).toContain('2. [进行中] 写第1章正文');
        expect(prompt).toContain('3. [ ] 导出成稿');
        expect(formatPlanForPrompt([])).toContain('尚未建立');

        const summary = summarizePlanUpdate(steps);
        expect(summary).toContain('1/3 完成');
        expect(summary).toContain('写第1章正文');
    });
});

describe('session-log — 会话压缩（dsh compaction 移植）', () => {
    function seed(count: number): AgentSessionLog {
        const log = new AgentSessionLog();
        log.append({ type: 'system_message', text: '系统约束' });
        for (let i = 0; i < count; i++) {
            log.append({ type: 'user_message', text: `用户第${i}条` });
            log.append({ type: 'assistant_message', text: `助手第${i}条` });
        }
        return log;
    }

    it('压缩后保留摘要节点与最近轮次，系统消息不丢', () => {
        const log = seed(10);
        const before = log.size;
        const removed = log.compactToSummary('早期：用户想写玄幻长篇，已建项目。', 4);

        expect(removed).toBeGreaterThan(0);
        expect(log.size).toBeLessThan(before);

        const turns = log.derive();
        expect(turns[0].text).toContain('历史摘要');
        expect(turns[0].text).toContain('玄幻长篇');
        // 最近轮次仍在
        expect(turns.some(t => t.text.includes('用户第9条'))).toBe(true);
        // 系统消息保留
        expect(log.snapshot().some(e => e.type === 'system_message' && e.text === '系统约束')).toBe(true);
    });

    it('切割点落在工具配对平衡处：不产生悬空 tool 结果', () => {
        const log = new AgentSessionLog();
        log.append({ type: 'system_message', text: 'sys' });
        for (let i = 0; i < 8; i++) {
            log.append({ type: 'user_message', text: `u${i}` });
            log.append({ type: 'assistant_message', text: `a${i}` });
            const callId = log.nextCallId('demo');
            log.append({ type: 'tool_call', callId, tool: 'demo', args: {} });
            log.append({ type: 'tool_result', callId, tool: 'demo', ok: true, content: `r${i}` });
        }
        log.compactToSummary('摘要', 4);

        const events = log.snapshot();
        const callIds = new Set<string>();
        for (const event of events) {
            if (event.type === 'tool_call') callIds.add(event.callId);
        }
        // 每个 tool_result 都有同批次（未被摘掉）的 tool_call
        for (const event of events) {
            if (event.type === 'tool_result') {
                expect(callIds.has(event.callId)).toBe(true);
            }
        }
    });

    it('轮次太少时不压缩', () => {
        const log = seed(1);
        expect(log.compactToSummary('摘要', 10)).toBe(0);
    });

    it('空日志不压缩', () => {
        const log = new AgentSessionLog();
        expect(log.compactToSummary('摘要', 5)).toBe(0);
    });
});
