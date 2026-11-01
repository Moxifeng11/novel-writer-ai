/**
 * 会话事件日志纪律（C1）
 *
 * dsh 原则：日志是唯一事实源，事件可排序、可恢复、可重放；
 * 压缩摘要必须是独立事件类型，而不是伪装成用户消息靠前缀识别。
 */
import { describe, expect, it } from 'vitest';
import { AgentSessionLog } from '../../../engine/agent/harness/session-log';
import {
    buildSessionSnapshot,
    parseSessionSnapshot,
} from '../../../engine/agent/harness/session-snapshot';

describe('事件元数据', () => {
    it('append 自动补齐单调 seq 与 ts', () => {
        const log = new AgentSessionLog();
        log.append({ type: 'user_message', text: '一' });
        log.append({ type: 'assistant_message', text: '二' });
        const events = log.snapshot();
        expect(events.map(e => e.seq)).toEqual([1, 2]);
        expect(events.every(e => typeof e.ts === 'number' && (e.ts as number) > 0)).toBe(true);
    });

    it('恢复旧事件（无 seq）后继续 append 不重复编号', () => {
        const log = new AgentSessionLog();
        log.restore([
            { type: 'user_message', text: '旧一' },
            { type: 'assistant_message', text: '旧二' },
        ], 0);
        log.append({ type: 'user_message', text: '新' });
        const events = log.snapshot();
        expect(events[events.length - 1].seq).toBe(3);
    });

    it('恢复时保留历史 seq 最大值', () => {
        const log = new AgentSessionLog();
        log.restore([
            { type: 'user_message', text: 'a', seq: 7, ts: 1 },
        ], 0);
        log.append({ type: 'user_message', text: 'b' });
        expect(log.snapshot()[1].seq).toBe(8);
    });
});

describe('压缩摘要事件', () => {
    function seed(log: AgentSessionLog): void {
        log.append({ type: 'system_message', text: '系统' });
        for (let i = 0; i < 8; i++) {
            log.append({ type: 'user_message', text: `第${i}轮提问` });
            log.append({ type: 'assistant_message', text: `第${i}轮回答` });
        }
    }

    it('压缩生成 summary 类型，不再伪装成 user_message', () => {
        const log = new AgentSessionLog();
        seed(log);
        const removed = log.compactToSummary('早前内容摘要', 4);
        expect(removed).toBeGreaterThan(0);
        const events = log.snapshot();
        const summary = events.find(e => e.type === 'summary');
        expect(summary).toBeDefined();
        expect(summary?.text).toContain('早前内容摘要');
        expect(events.some(e => e.type === 'user_message' && e.text.includes('历史摘要'))).toBe(false);
        // 系统消息永远保留
        expect(events[0].type).toBe('system_message');
    });

    it('摘要仍进入模型转写（对模型语义不变）', () => {
        const log = new AgentSessionLog();
        seed(log);
        log.compactToSummary('早前内容摘要', 4);
        const turns = log.derive(100);
        expect(turns.some(turn => turn.role === 'user' && turn.text.includes('历史摘要'))).toBe(true);
    });
});

describe('快照往返', () => {
    it('summary / seq / ts / data 都能落盘再读回', () => {
        const log = new AgentSessionLog();
        log.append({ type: 'summary', text: '历史摘要' });
        log.append({ type: 'tool_result', callId: 'call_1_x', tool: 'x', ok: true, content: 'ok', data: { n: 1 }, durationMs: 12 });
        const snapshot = buildSessionSnapshot({
            events: log.allEvents(),
            callSeq: log.callCounter,
            memory: {},
            plan: [],
            now: 123,
        });
        const parsed = parseSessionSnapshot(JSON.stringify(snapshot));
        expect(parsed?.events.map(e => e.type)).toEqual(['summary', 'tool_result']);
        const result = parsed?.events[1] as { data?: Record<string, unknown>; durationMs?: number };
        expect(result.data).toEqual({ n: 1 });
        expect(result.durationMs).toBe(12);
        expect(parsed?.events.every(e => typeof e.seq === 'number')).toBe(true);
    });
});
