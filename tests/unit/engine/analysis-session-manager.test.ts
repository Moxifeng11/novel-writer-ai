import { describe, it, expect, beforeEach } from 'vitest';
import { AnalysisSessionManager } from '../../../engine/analysis-session-manager';
import { SuggestionManager } from '../../../engine/suggestion-manager';
import type { AnalysisSuggestion } from '../../../engine/types/analysis-suggestion';
import type { AnalysisSession, SessionMetadata } from '../../../engine/types/analysis-session';

function createMockPlugin() {
    return {
        app: {
            vault: {
                adapter: {
                    exists: async () => false,
                    read: async () => '',
                    write: async () => { },
                    mkdir: async () => { },
                    remove: async () => { },
                },
            },
        },
        manifest: {
            dir: 'test-plugin-dir',
        },
    };
}

function createMockSuggestion(
    overrides: Partial<AnalysisSuggestion> = {}
): AnalysisSuggestion {
    return {
        id: overrides.id ?? 'test-suggestion-1',
        type: (overrides.type as any) ?? 'character',
        status: (overrides.status as any) ?? 'pending',
        confidence: overrides.confidence ?? 0.8,
        source: overrides.source ?? 'rule',
        payload: overrides.payload ?? { name: '测试角色' },
        createdAt: overrides.createdAt ?? Date.now(),
        ...overrides,
    };
}

function createMockMetadata(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
    return {
        wordCount: overrides.wordCount ?? 1000,
        characterCount: overrides.characterCount ?? 5,
        layersUsed: overrides.layersUsed ?? ['rule'],
        durationMs: overrides.durationMs ?? 500,
    };
}

describe('AnalysisSessionManager — 构造与初始化', () => {
    it('构造函数初始化成功', () => {
        const plugin = createMockPlugin();
        const manager = new AnalysisSessionManager(plugin as any);
        expect(manager).toBeDefined();
    });

    it('初始会话列表为空', () => {
        const plugin = createMockPlugin();
        const manager = new AnalysisSessionManager(plugin as any);
        expect(manager.listSessions()).toEqual([]);
    });
});

describe('AnalysisSessionManager — 会话 CRUD', () => {
    let manager: AnalysisSessionManager;
    let plugin: any;

    beforeEach(() => {
        plugin = createMockPlugin();
        manager = new AnalysisSessionManager(plugin as any);
    });

    describe('createSession', () => {
        it('创建会话成功', () => {
            const session = manager.createSession({
                file: 'test/chapter1.md',
                title: '第一章测试',
                suggestions: [createMockSuggestion({ id: 's1' })],
                metadata: createMockMetadata(),
            });

            expect(session).toBeDefined();
            expect(session.id).toBeTruthy();
            expect(session.file).toBe('test/chapter1.md');
            expect(session.title).toBe('第一章测试');
            expect(session.suggestions.length).toBe(1);
            expect(session.createdAt).toBeGreaterThan(0);
            expect(session.updatedAt).toBeGreaterThan(0);
        });

        it('未提供 title 时使用文件路径提取标题', () => {
            const session = manager.createSession({
                file: 'test/chapter1.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            expect(session.title).toBe('chapter1');
        });

        it('创建会话后可通过 getSession 获取', () => {
            const created = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const fetched = manager.getSession(created.id);
            expect(fetched).toBeDefined();
            expect(fetched!.id).toBe(created.id);
        });

        it('创建会话时自动添加 analyze 操作日志', () => {
            const session = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata({ wordCount: 2000, characterCount: 10 }),
            });

            expect(session.actionLog.length).toBeGreaterThan(0);
            const analyzeLog = session.actionLog.find(l => l.type === 'analyze');
            expect(analyzeLog).toBeDefined();
            expect(analyzeLog!.details).toBeDefined();
            expect(analyzeLog!.details!.wordCount).toBe(2000);
            expect(analyzeLog!.details!.characterCount).toBe(10);
        });

        it('多个会话 ID 唯一', () => {
            const ids: string[] = [];
            for (let i = 0; i < 10; i++) {
                const session = manager.createSession({
                    file: `test${i}.md`,
                    suggestions: [],
                    metadata: createMockMetadata(),
                });
                ids.push(session.id);
            }
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(10);
        });
    });

    describe('getSession', () => {
        it('存在的 ID 返回会话', () => {
            const created = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const session = manager.getSession(created.id);
            expect(session).toBeDefined();
            expect(session!.id).toBe(created.id);
        });

        it('不存在的 ID 返回 undefined', () => {
            expect(manager.getSession('nonexistent')).toBeUndefined();
        });
    });

    describe('updateSession', () => {
        it('更新会话成功', () => {
            const created = manager.createSession({
                file: 'test.md',
                title: '原标题',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const result = manager.updateSession(created.id, { title: '新标题' });
            expect(result).toBe(true);

            const updated = manager.getSession(created.id);
            expect(updated!.title).toBe('新标题');
        });

        it('更新会话时 updatedAt 递增', () => {
            const created = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const originalUpdatedAt = created.updatedAt;

            const result = manager.updateSession(created.id, { title: '新标题' });
            expect(result).toBe(true);

            const updated = manager.getSession(created.id);
            expect(updated!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
        });

        it('多次更新时间戳递增', () => {
            const created = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const timestamps: number[] = [created.updatedAt];

            for (let i = 0; i < 3; i++) {
                manager.updateSession(created.id, { title: `标题${i}` });
                const session = manager.getSession(created.id);
                timestamps.push(session!.updatedAt);
            }

            for (let i = 1; i < timestamps.length; i++) {
                expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
            }
        });

        it('更新不存在的会话返回 false', () => {
            const result = manager.updateSession('nonexistent', { title: '新标题' });
            expect(result).toBe(false);
        });

        it('更新时不能修改 id 和 createdAt', () => {
            const created = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const originalId = created.id;
            const originalCreatedAt = created.createdAt;

            manager.updateSession(created.id, {
                id: 'fake-id',
                createdAt: 999999999999,
            } as any);

            const updated = manager.getSession(created.id);
            expect(updated!.id).toBe(originalId);
            expect(updated!.createdAt).toBe(originalCreatedAt);
        });
    });
});

describe('AnalysisSessionManager — 列表查询', () => {
    let manager: AnalysisSessionManager;
    let plugin: any;

    beforeEach(() => {
        plugin = createMockPlugin();
        manager = new AnalysisSessionManager(plugin as any);

        manager.createSession({
            file: 'file1.md',
            suggestions: [createMockSuggestion({ id: 's1' })],
            metadata: createMockMetadata(),
        });
        manager.createSession({
            file: 'file1.md',
            suggestions: [createMockSuggestion({ id: 's2' })],
            metadata: createMockMetadata(),
        });
        manager.createSession({
            file: 'file2.md',
            suggestions: [],
            metadata: createMockMetadata(),
        });
    });

    describe('listSessions', () => {
        it('列出所有会话', () => {
            const all = manager.listSessions();
            expect(all.length).toBe(3);
        });

        it('按文件过滤', () => {
            const file1Sessions = manager.listSessions('file1.md');
            expect(file1Sessions.length).toBe(2);

            const file2Sessions = manager.listSessions('file2.md');
            expect(file2Sessions.length).toBe(1);
        });

        it('空文件过滤返回空数组', () => {
            const result = manager.listSessions('nonexistent.md');
            expect(result).toEqual([]);
        });

        it('按 updatedAt 降序排列', () => {
            const sessions = manager.listSessions('file1.md');
            for (let i = 1; i < sessions.length; i++) {
                expect(sessions[i - 1].updatedAt).toBeGreaterThanOrEqual(sessions[i].updatedAt);
            }
        });
    });

    describe('getLatestSession', () => {
        it('获取文件最新会话', () => {
            const latest = manager.getLatestSession('file1.md');
            expect(latest).toBeDefined();
            expect(latest!.file).toBe('file1.md');
        });

        it('空文件返回 undefined', () => {
            const latest = manager.getLatestSession('nonexistent.md');
            expect(latest).toBeUndefined();
        });
    });
});

describe('AnalysisSessionManager — 操作日志', () => {
    let manager: AnalysisSessionManager;
    let plugin: any;

    beforeEach(() => {
        plugin = createMockPlugin();
        manager = new AnalysisSessionManager(plugin as any);
    });

    describe('logAction', () => {
        it('记录操作日志成功', () => {
            const session = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const result = manager.logAction(session.id, {
                type: 'adopt',
                suggestionId: 's1',
                details: { name: '测试' },
            });

            expect(result).toBe(true);

            const updated = manager.getSession(session.id);
            expect(updated!.actionLog.length).toBe(2);

            const adoptLog = updated!.actionLog.find(l => l.type === 'adopt');
            expect(adoptLog).toBeDefined();
            expect(adoptLog!.id).toBeTruthy();
            expect(adoptLog!.timestamp).toBeGreaterThan(0);
            expect(adoptLog!.suggestionId).toBe('s1');
        });

        it('记录操作日志后 updatedAt 更新', () => {
            const session = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const originalUpdatedAt = session.updatedAt;

            manager.logAction(session.id, { type: 'adopt' });

            const updated = manager.getSession(session.id);
            expect(updated!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
        });

        it('不存在的会话返回 false', () => {
            const result = manager.logAction('nonexistent', { type: 'adopt' });
            expect(result).toBe(false);
        });
    });

    describe('logActions', () => {
        it('批量记录操作日志', () => {
            const session = manager.createSession({
                file: 'test.md',
                suggestions: [],
                metadata: createMockMetadata(),
            });

            const result = manager.logActions(session.id, [
                { type: 'adopt', suggestionId: 's1' },
                { type: 'reject', suggestionId: 's2' },
                { type: 'modify', suggestionId: 's3' },
            ]);

            expect(result).toBe(true);

            const updated = manager.getSession(session.id);
            expect(updated!.actionLog.length).toBe(4);
        });
    });
});

describe('AnalysisSessionManager — 会话对比', () => {
    let manager: AnalysisSessionManager;
    let plugin: any;

    beforeEach(() => {
        plugin = createMockPlugin();
        manager = new AnalysisSessionManager(plugin as any);
    });

    it('对比两个会话的建议状态变化', () => {
        const session1 = manager.createSession({
            file: 'test.md',
            suggestions: [
                createMockSuggestion({ id: 's1', status: 'pending' }),
                createMockSuggestion({ id: 's2', status: 'pending' }),
            ],
            metadata: createMockMetadata({ wordCount: 1000, characterCount: 5 }),
        });

        const session2 = manager.createSession({
            file: 'test.md',
            suggestions: [
                createMockSuggestion({ id: 's1', status: 'adopted' }),
                createMockSuggestion({ id: 's2', status: 'pending' }),
                createMockSuggestion({ id: 's3', status: 'pending' }),
            ],
            metadata: createMockMetadata({ wordCount: 1500, characterCount: 7 }),
        });

        const diff = manager.compareSessions(session1.id, session2.id);

        expect(diff).toBeDefined();
        expect(diff.changedSuggestions).toContain('s1');
        expect(diff.changedSuggestions).toContain('s3');
        expect(diff.statsDiff.total).toBe(1);
        expect(diff.statsDiff.wordCount).toBe(500);
        expect(diff.statsDiff.characterCount).toBe(2);
    });

    it('对比角色变化（finalCharacters）', () => {
        const session1 = manager.createSession({
            file: 'test.md',
            characterResult: {
                finalCharacters: [
                    { name: '角色A' },
                    { name: '角色B' },
                ],
            },
            suggestions: [],
            metadata: createMockMetadata(),
        });

        const session2 = manager.createSession({
            file: 'test.md',
            characterResult: {
                finalCharacters: [
                    { name: '角色A' },
                    { name: '角色C' },
                ],
            },
            suggestions: [],
            metadata: createMockMetadata(),
        });

        const diff = manager.compareSessions(session1.id, session2.id);

        expect(diff.addedCharacters).toContain('角色C');
        expect(diff.removedCharacters).toContain('角色B');
    });

    it('对比角色变化（finalCharacters 缺失时回退 llmVerified / ruleCandidates）', () => {
        const session1 = manager.createSession({
            file: 'test.md',
            // 历史会话只有 LLM 复核结果
            characterResult: {
                llmVerified: [{ name: '角色A' }, { name: '角色B' }],
            },
            suggestions: [],
            metadata: createMockMetadata(),
        });

        const session2 = manager.createSession({
            file: 'test.md',
            // 另一条历史会话只有规则候选
            characterResult: {
                ruleCandidates: [{ name: '角色A' }, { name: '角色C' }],
            },
            suggestions: [],
            metadata: createMockMetadata(),
        });

        const diff = manager.compareSessions(session1.id, session2.id);

        expect(diff.addedCharacters).toContain('角色C');
        expect(diff.removedCharacters).toContain('角色B');
    });

    it('plotResult / otherResults 随导出导入原样保留', () => {
        const session = manager.createSession({
            file: 'test.md',
            plotResult: { arcs: [{ name: '主线', tension: 0.8 }] },
            otherResults: { analysisReport: '## 分析\n内容' },
            suggestions: [],
            metadata: createMockMetadata(),
        });

        const parsed = JSON.parse(manager.exportSession(session.id));
        parsed.id = 'roundtrip-id';
        const imported = manager.importSession(JSON.stringify(parsed));

        expect(imported.plotResult).toEqual({ arcs: [{ name: '主线', tension: 0.8 }] });
        expect(imported.otherResults).toEqual({ analysisReport: '## 分析\n内容' });
    });

    it('会话不存在时抛出错误', () => {
        const session = manager.createSession({
            file: 'test.md',
            suggestions: [],
            metadata: createMockMetadata(),
        });

        expect(() => manager.compareSessions(session.id, 'nonexistent')).toThrow();
    });
});

describe('AnalysisSessionManager — 导出/导入', () => {
    let manager: AnalysisSessionManager;
    let plugin: any;

    beforeEach(() => {
        plugin = createMockPlugin();
        manager = new AnalysisSessionManager(plugin as any);
    });

    describe('exportSession', () => {
        it('导出会话为 JSON 字符串', () => {
            const session = manager.createSession({
                file: 'test.md',
                title: '导出测试',
                suggestions: [createMockSuggestion({ id: 's1' })],
                metadata: createMockMetadata(),
            });

            const json = manager.exportSession(session.id);
            expect(typeof json).toBe('string');

            const parsed = JSON.parse(json);
            expect(parsed.id).toBe(session.id);
            expect(parsed.title).toBe('导出测试');
        });

        it('导出不存在的会话抛出错误', () => {
            expect(() => manager.exportSession('nonexistent')).toThrow();
        });
    });

    describe('importSession', () => {
        it('从 JSON 字符串导入会话', () => {
            const original = manager.createSession({
                file: 'test.md',
                title: '原始会话',
                suggestions: [createMockSuggestion({ id: 's1' })],
                metadata: createMockMetadata(),
            });

            const json = manager.exportSession(original.id);
            const parsed = JSON.parse(json);
            parsed.id = 'imported-id';

            const imported = manager.importSession(JSON.stringify(parsed));

            expect(imported).toBeDefined();
            expect(imported.id).toBe('imported-id');
            expect(imported.title).toBe('原始会话');
            expect(imported.suggestions.length).toBe(1);
        });

        it('导入时自动添加 import 操作日志', () => {
            const sessionData = {
                id: 'test-import',
                file: 'test.md',
                title: '测试导入',
                suggestions: [],
                actionLog: [],
                metadata: createMockMetadata(),
            };

            const imported = manager.importSession(JSON.stringify(sessionData));
            const importLog = imported.actionLog.find(l => l.type === 'import');
            expect(importLog).toBeDefined();
        });

        it('无效 JSON 抛出错误', () => {
            expect(() => manager.importSession('invalid json')).toThrow();
        });

        it('缺少字段时补全默认值', () => {
            const sessionData = {
                id: 'partial-session',
                file: 'test.md',
                title: '部分字段',
            };

            const imported = manager.importSession(JSON.stringify(sessionData));
            expect(imported.createdAt).toBeGreaterThan(0);
            expect(imported.updatedAt).toBeGreaterThan(0);
            expect(Array.isArray(imported.suggestions)).toBe(true);
            expect(Array.isArray(imported.actionLog)).toBe(true);
            expect(imported.metadata).toBeDefined();
        });
    });
});

describe('AnalysisSessionManager — SuggestionManager 同步', () => {
    let manager: AnalysisSessionManager;
    let plugin: any;

    beforeEach(() => {
        plugin = createMockPlugin();
        manager = new AnalysisSessionManager(plugin as any);
    });

    describe('syncFromSuggestionManager', () => {
        it('从 SuggestionManager 同步建议到会话', () => {
            const session = manager.createSession({
                file: 'test.md',
                suggestions: [createMockSuggestion({ id: 'old', status: 'pending' })],
                metadata: createMockMetadata(),
            });

            const suggestionManager = new SuggestionManager([
                createMockSuggestion({ id: 's1', status: 'adopted' }),
                createMockSuggestion({ id: 's2', status: 'rejected' }),
            ]);

            const result = manager.syncFromSuggestionManager(session.id, suggestionManager);
            expect(result).toBe(true);

            const updated = manager.getSession(session.id);
            expect(updated!.suggestions.length).toBe(2);
            expect(updated!.suggestions.find(s => s.id === 's1')!.status).toBe('adopted');
        });

        it('同步不存在的会话返回 false', () => {
            const suggestionManager = new SuggestionManager();
            const result = manager.syncFromSuggestionManager('nonexistent', suggestionManager);
            expect(result).toBe(false);
        });
    });

    describe('restoreSuggestionManager', () => {
        it('从会话恢复 SuggestionManager', () => {
            const suggestions = [
                createMockSuggestion({ id: 's1', status: 'adopted' }),
                createMockSuggestion({ id: 's2', status: 'pending' }),
                createMockSuggestion({ id: 's3', status: 'rejected' }),
            ];

            const session = manager.createSession({
                file: 'test.md',
                suggestions,
                metadata: createMockMetadata(),
            });

            const restored = manager.restoreSuggestionManager(session);
            expect(restored).toBeInstanceOf(SuggestionManager);
            expect(restored.getAllSuggestions().length).toBe(3);
            expect(restored.getStats().adopted).toBe(1);
            expect(restored.getStats().pending).toBe(1);
            expect(restored.getStats().rejected).toBe(1);
        });
    });

    it('同步后再恢复数据一致', () => {
        const session = manager.createSession({
            file: 'test.md',
            suggestions: [],
            metadata: createMockMetadata(),
        });

        const original = new SuggestionManager([
            createMockSuggestion({ id: 's1', status: 'adopted' }),
            createMockSuggestion({ id: 's2', status: 'pending' }),
        ]);

        manager.syncFromSuggestionManager(session.id, original);

        const updatedSession = manager.getSession(session.id)!;
        const restored = manager.restoreSuggestionManager(updatedSession);

        expect(restored.getAllSuggestions().length).toBe(original.getAllSuggestions().length);
        expect(restored.getStats()).toEqual(original.getStats());
    });
});

describe('AnalysisSessionManager — 索引统计', () => {
    let manager: AnalysisSessionManager;
    let plugin: any;

    beforeEach(() => {
        plugin = createMockPlugin();
        manager = new AnalysisSessionManager(plugin as any);
    });

    it('列表条目包含建议统计', () => {
        manager.createSession({
            file: 'test.md',
            suggestions: [
                createMockSuggestion({ id: 's1', status: 'pending' }),
                createMockSuggestion({ id: 's2', status: 'adopted' }),
                createMockSuggestion({ id: 's3', status: 'rejected' }),
            ],
            metadata: createMockMetadata(),
        });

        const list = manager.listSessions();
        expect(list.length).toBe(1);
        expect(list[0].suggestionStats).toBeDefined();
        expect(list[0].suggestionStats.total).toBe(3);
        expect(list[0].suggestionStats.pending).toBe(1);
        expect(list[0].suggestionStats.adopted).toBe(1);
        expect(list[0].suggestionStats.rejected).toBe(1);
    });

    it('列表条目包含角色数量', () => {
        manager.createSession({
            file: 'test.md',
            suggestions: [],
            metadata: createMockMetadata({ characterCount: 8 }),
        });

        const list = manager.listSessions();
        expect(list[0].characterCount).toBe(8);
    });
});
