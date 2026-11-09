import { describe, expect, it } from 'vitest';
import {
    buildSessionSnapshot,
    parseSessionSnapshot,
    snapshotMatchesContext,
} from '@/engine/agent/harness/session-snapshot';

/**
 * 会话恢复必须按当前项目状态校验：
 * 旧存档可能引用已删除的项目，恢复后会把「你有 1 个项目…」重新上屏。
 */
describe('Agent 会话快照上下文校验', () => {
    const startup = {
        type: 'user_message' as const,
        text: '（会话开始。用户有 1 个项目。）请开始对话引导。',
    };

    it('新快照写入项目集合与活动项目，解析后保持不变', () => {
        const snapshot = buildSessionSnapshot({
            events: [startup],
            callSeq: 1,
            memory: {},
            plan: [],
            context: { projects: ['长篇小说/甲'], activeProject: '长篇小说/甲' },
        });
        const parsed = parseSessionSnapshot(JSON.stringify(snapshot));
        expect(parsed?.context).toEqual({
            projects: ['长篇小说/甲'],
            activeProject: '长篇小说/甲',
        });
        expect(snapshotMatchesContext(parsed!, {
            projects: ['长篇小说/甲'],
            activeProject: '长篇小说/甲',
        })).toBe(true);
    });

    it('项目集合变化时拒绝恢复', () => {
        const snapshot = buildSessionSnapshot({
            events: [startup],
            callSeq: 1,
            memory: {},
            plan: [],
            context: { projects: ['长篇小说/甲'], activeProject: '长篇小说/甲' },
        });
        expect(snapshotMatchesContext(snapshot, {
            projects: [],
            activeProject: null,
        })).toBe(false);
    });

    it('旧档没有 context 时按启动占位中的项目数量兜底校验', () => {
        const snapshot = buildSessionSnapshot({
            events: [startup],
            callSeq: 1,
            memory: {},
            plan: [],
        });
        expect(snapshot.context).toBeUndefined();
        expect(snapshotMatchesContext(snapshot, { projects: [], activeProject: null })).toBe(false);
        expect(snapshotMatchesContext(snapshot, { projects: ['长篇小说/甲'], activeProject: null })).toBe(true);
    });

    it('旧档「用户还没有项目」只在当前仍无项目时可恢复', () => {
        const snapshot = buildSessionSnapshot({
            events: [{
                type: 'user_message',
                text: '（会话开始。用户还没有项目。）请开始对话引导。',
            }],
            callSeq: 0,
            memory: {},
            plan: [],
        });
        expect(snapshotMatchesContext(snapshot, { projects: [], activeProject: null })).toBe(true);
        expect(snapshotMatchesContext(snapshot, { projects: ['短篇小说/乙'], activeProject: null })).toBe(false);
    });

    it('没有启动占位的旧档不阻断恢复', () => {
        const snapshot = buildSessionSnapshot({
            events: [{ type: 'user_message', text: '继续写第一章' }],
            callSeq: 1,
            memory: {},
            plan: [],
        });
        expect(snapshotMatchesContext(snapshot, { projects: [], activeProject: null })).toBe(true);
    });
});
