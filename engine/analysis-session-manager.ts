/**
 * analysis-session-manager.ts — 分析会话管理器
 *
 * 管理分析会话的创建、查询、更新、删除，以及持久化存储。
 * 支持会话列表查询、操作日志记录、会话对比和导入导出。
 *
 * 持久化方案：
 * - 存储位置：插件数据目录下的 .sessions/ 文件夹
 * - 每个会话一个 JSON 文件，文件名使用会话 ID
 * - 会话列表索引：_index.json
 * - 加载时读取索引，按需加载具体会话
 */

import { createLogger } from '../shared/logger';
import type {
    AnalysisSession,
    SessionAction,
    SessionListEntry,
    SessionDiff,
    SessionIndex,
    SuggestionStats,
    SessionMetadata,
} from './types/analysis-session';
import type { AnalysisSuggestion, SuggestionStatus } from './types/analysis-suggestion';
import { SuggestionManager } from './suggestion-manager';

const log = createLogger('AnalysisSessionManager');

const SESSIONS_DIR = '.sessions';
const INDEX_FILE = '_index.json';
const INDEX_VERSION = 1;

interface SessionCreateOptions {
    file: string;
    title?: string;
    characterResult?: any;
    plotResult?: any;
    otherResults?: Record<string, any>;
    suggestions: AnalysisSuggestion[];
    metadata: SessionMetadata;
}

export class AnalysisSessionManager {
    private sessions: Map<string, AnalysisSession> = new Map();
    private vault: any;
    private pluginDir: string;
    private sessionsDir: string;
    private indexPath: string;
    private index: SessionIndex;

    constructor(plugin: { app: { vault: any }; manifest: { dir: string } }) {
        this.vault = plugin.app.vault;
        this.pluginDir = plugin.manifest.dir;
        this.sessionsDir = `${this.pluginDir}/${SESSIONS_DIR}`;
        this.indexPath = `${this.sessionsDir}/${INDEX_FILE}`;
        this.index = {
            version: INDEX_VERSION,
            entries: [],
            updatedAt: Date.now(),
        };
    }

    // ============================================================
    // 会话 CRUD
    // ============================================================

    /**
     * 创建新的分析会话
     */
    createSession(options: SessionCreateOptions): AnalysisSession {
        const now = Date.now();
        const id = this.generateId();

        const session: AnalysisSession = {
            id,
            createdAt: now,
            updatedAt: now,
            file: options.file,
            title: options.title || this.extractTitleFromFile(options.file),
            characterResult: options.characterResult ?? null,
            plotResult: options.plotResult,
            otherResults: options.otherResults,
            suggestions: [...options.suggestions],
            actionLog: [
                {
                    id: this.generateActionId(),
                    timestamp: now,
                    type: 'analyze',
                    details: {
                        wordCount: options.metadata.wordCount,
                        characterCount: options.metadata.characterCount,
                    },
                },
            ],
            metadata: { ...options.metadata },
        };

        this.sessions.set(id, session);
        this.updateIndexEntry(session);

        return session;
    }

    /**
     * 获取会话
     */
    getSession(id: string): AnalysisSession | undefined {
        return this.sessions.get(id);
    }

    /**
     * 获取会话（如果内存中没有则从磁盘加载）
     */
    async getSessionOrLoad(id: string): Promise<AnalysisSession | undefined> {
        const cached = this.sessions.get(id);
        if (cached) return cached;

        try {
            const session = await this.loadSessionFromDisk(id);
            if (session) {
                this.sessions.set(id, session);
            }
            return session;
        } catch (err) {
            log.error('加载会话失败:', id, err);
            return undefined;
        }
    }

    /**
     * 更新会话
     */
    updateSession(id: string, updates: Partial<AnalysisSession>): boolean {
        const session = this.sessions.get(id);
        if (!session) return false;

        const updated: AnalysisSession = {
            ...session,
            ...updates,
            id: session.id,
            createdAt: session.createdAt,
            updatedAt: Date.now(),
        };

        this.sessions.set(id, updated);
        this.updateIndexEntry(updated);

        return true;
    }

    /**
     * 删除会话
     */
    async deleteSession(id: string): Promise<boolean> {
        if (!this.sessions.has(id)) {
            const exists = await this.sessionFileExists(id);
            if (!exists) return false;
        }

        this.sessions.delete(id);
        this.index.entries = this.index.entries.filter(e => e.id !== id);
        this.index.updatedAt = Date.now();

        try {
            await this.deleteSessionFile(id);
            await this.saveIndex();
            return true;
        } catch (err) {
            log.error('删除会话文件失败:', id, err);
            return false;
        }
    }

    // ============================================================
    // 列表查询
    // ============================================================

    /**
     * 列出会话
     * @param file 可选，按文件路径过滤
     */
    listSessions(file?: string): SessionListEntry[] {
        let entries = [...this.index.entries];

        if (file) {
            entries = entries.filter(e => e.file === file);
        }

        return entries.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /**
     * 获取某个文件的最新会话
     */
    getLatestSession(file: string): SessionListEntry | undefined {
        const sessions = this.listSessions(file);
        return sessions.length > 0 ? sessions[0] : undefined;
    }

    // ============================================================
    // 操作日志
    // ============================================================

    /**
     * 记录操作日志
     */
    logAction(
        sessionId: string,
        action: Omit<SessionAction, 'id' | 'timestamp'>
    ): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        const logEntry: SessionAction = {
            ...action,
            id: this.generateActionId(),
            timestamp: Date.now(),
        };

        session.actionLog.push(logEntry);
        session.updatedAt = Date.now();

        this.sessions.set(sessionId, session);
        this.updateIndexEntry(session);

        return true;
    }

    /**
     * 批量记录操作日志
     */
    logActions(sessionId: string, actions: Array<Omit<SessionAction, 'id' | 'timestamp'>>): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        const now = Date.now();
        for (const action of actions) {
            session.actionLog.push({
                ...action,
                id: this.generateActionId(),
                timestamp: now,
            });
        }

        session.updatedAt = now;
        this.sessions.set(sessionId, session);
        this.updateIndexEntry(session);

        return true;
    }

    // ============================================================
    // 建议状态同步
    // ============================================================

    /**
     * 从 SuggestionManager 同步建议状态到会话
     */
    syncFromSuggestionManager(sessionId: string, manager: SuggestionManager): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        session.suggestions = manager.toJSON();
        session.updatedAt = Date.now();

        this.sessions.set(sessionId, session);
        this.updateIndexEntry(session);

        return true;
    }

    /**
     * 从会话恢复 SuggestionManager
     */
    restoreSuggestionManager(session: AnalysisSession): SuggestionManager {
        const manager = new SuggestionManager();
        manager.fromJSON(session.suggestions);
        return manager;
    }

    // ============================================================
    // 持久化
    // ============================================================

    /**
     * 保存所有脏会话到磁盘
     */
    async saveToDisk(): Promise<void> {
        try {
            await this.ensureSessionsDir();
            await this.saveIndex();

            for (const session of this.sessions.values()) {
                await this.saveSessionToDisk(session);
            }

            log.info(`已保存 ${this.sessions.size} 个会话到磁盘`);
        } catch (err) {
            log.error('保存会话失败:', err);
            throw err;
        }
    }

    /**
     * 保存单个会话到磁盘
     */
    async saveSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) return false;

        try {
            await this.ensureSessionsDir();
            await this.saveSessionToDisk(session);
            await this.saveIndex();
            return true;
        } catch (err) {
            log.error('保存会话失败:', sessionId, err);
            return false;
        }
    }

    /**
     * 从磁盘加载索引
     */
    async loadFromDisk(): Promise<void> {
        try {
            await this.ensureSessionsDir();

            const indexExists = await this.fileExists(this.indexPath);
            if (indexExists) {
                const indexData = await this.readFile(this.indexPath);
                this.index = JSON.parse(indexData);
                log.info(`已加载会话索引，共 ${this.index.entries.length} 个会话`);
            } else {
                this.index = {
                    version: INDEX_VERSION,
                    entries: [],
                    updatedAt: Date.now(),
                };
                log.info('会话索引不存在，已创建空索引');
            }
        } catch (err) {
            log.error('加载会话索引失败:', err);
            this.index = {
                version: INDEX_VERSION,
                entries: [],
                updatedAt: Date.now(),
            };
        }
    }

    // ============================================================
    // 会话对比
    // ============================================================

    /**
     * 对比两个会话
     */
    compareSessions(sessionId1: string, sessionId2: string): SessionDiff {
        const s1 = this.sessions.get(sessionId1);
        const s2 = this.sessions.get(sessionId2);

        if (!s1 || !s2) {
            throw new Error('会话不存在，无法对比');
        }

        const chars1 = this.extractCharacterNames(s1.characterResult);
        const chars2 = this.extractCharacterNames(s2.characterResult);

        const charsSet1 = new Set(chars1);
        const charsSet2 = new Set(chars2);

        const addedCharacters = chars2.filter(c => !charsSet1.has(c));
        const removedCharacters = chars1.filter(c => !charsSet2.has(c));

        const sugMap1 = new Map(s1.suggestions.map(s => [s.id, s]));
        const sugMap2 = new Map(s2.suggestions.map(s => [s.id, s]));

        const changedSuggestions: string[] = [];
        for (const [id, sug2] of sugMap2) {
            const sug1 = sugMap1.get(id);
            if (!sug1) {
                changedSuggestions.push(id);
            } else if (sug1.status !== sug2.status) {
                changedSuggestions.push(id);
            }
        }
        for (const id of sugMap1.keys()) {
            if (!sugMap2.has(id)) {
                changedSuggestions.push(id);
            }
        }

        const stats1 = this.calculateSuggestionStats(s1.suggestions);
        const stats2 = this.calculateSuggestionStats(s2.suggestions);

        const statsDiff: Record<string, number> = {
            total: stats2.total - stats1.total,
            pending: stats2.pending - stats1.pending,
            adopted: stats2.adopted - stats1.adopted,
            rejected: stats2.rejected - stats1.rejected,
            modified: stats2.modified - stats1.modified,
            wordCount: (s2.metadata.wordCount || 0) - (s1.metadata.wordCount || 0),
            characterCount: (s2.metadata.characterCount || 0) - (s1.metadata.characterCount || 0),
        };

        return {
            addedCharacters,
            removedCharacters,
            changedSuggestions,
            statsDiff,
        };
    }

    // ============================================================
    // 导出/导入
    // ============================================================

    /**
     * 导出会话为 JSON 字符串
     */
    exportSession(id: string): string {
        const session = this.sessions.get(id);
        if (!session) {
            throw new Error(`会话不存在: ${id}`);
        }
        return JSON.stringify(session, null, 2);
    }

    /**
     * 从 JSON 字符串导入会话
     */
    importSession(json: string): AnalysisSession {
        let session: AnalysisSession;
        try {
            session = JSON.parse(json) as AnalysisSession;
        } catch (err) {
            throw new Error('JSON 解析失败: ' + (err as Error).message);
        }

        if (!session.id) {
            session.id = this.generateId();
        }

        if (!session.createdAt) session.createdAt = Date.now();
        if (!session.updatedAt) session.updatedAt = Date.now();
        if (!session.suggestions) session.suggestions = [];
        if (!session.actionLog) session.actionLog = [];
        if (!session.metadata) {
            session.metadata = {
                wordCount: 0,
                characterCount: 0,
                layersUsed: [],
                durationMs: 0,
            };
        }

        session.actionLog.push({
            id: this.generateActionId(),
            timestamp: Date.now(),
            type: 'import',
        });

        this.sessions.set(session.id, session);
        this.updateIndexEntry(session);

        return session;
    }

    // ============================================================
    // 内部方法 - 索引操作
    // ============================================================

    private updateIndexEntry(session: AnalysisSession): void {
        const stats = this.calculateSuggestionStats(session.suggestions);
        const entry: SessionListEntry = {
            id: session.id,
            title: session.title,
            file: session.file,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            characterCount: session.metadata.characterCount,
            suggestionStats: stats,
        };

        const existingIndex = this.index.entries.findIndex(e => e.id === session.id);
        if (existingIndex >= 0) {
            this.index.entries[existingIndex] = entry;
        } else {
            this.index.entries.push(entry);
        }

        this.index.updatedAt = Date.now();
    }

    private calculateSuggestionStats(suggestions: AnalysisSuggestion[]): SuggestionStats {
        const stats: SuggestionStats = {
            total: suggestions.length,
            pending: 0,
            adopted: 0,
            rejected: 0,
            modified: 0,
        };

        for (const sug of suggestions) {
            const status = sug.status as SuggestionStatus;
            if (status in stats) {
                stats[status]++;
            }
        }

        return stats;
    }

    // ============================================================
    // 内部方法 - 文件操作
    // ============================================================

    private async ensureSessionsDir(): Promise<void> {
        const exists = await this.dirExists(this.sessionsDir);
        if (!exists) {
            await this.createDir(this.sessionsDir);
            log.info('已创建会话目录:', this.sessionsDir);
        }
    }

    private async saveSessionToDisk(session: AnalysisSession): Promise<void> {
        const filePath = this.getSessionFilePath(session.id);
        const content = JSON.stringify(session, null, 2);
        await this.writeFile(filePath, content);
    }

    private async loadSessionFromDisk(id: string): Promise<AnalysisSession | undefined> {
        const filePath = this.getSessionFilePath(id);
        const exists = await this.fileExists(filePath);
        if (!exists) return undefined;

        const content = await this.readFile(filePath);
        return JSON.parse(content) as AnalysisSession;
    }

    private async sessionFileExists(id: string): Promise<boolean> {
        return this.fileExists(this.getSessionFilePath(id));
    }

    private async deleteSessionFile(id: string): Promise<void> {
        const filePath = this.getSessionFilePath(id);
        const exists = await this.fileExists(filePath);
        if (exists) {
            await this.deleteFile(filePath);
        }
    }

    private getSessionFilePath(id: string): string {
        return `${this.sessionsDir}/${id}.json`;
    }

    private async saveIndex(): Promise<void> {
        await this.writeFile(this.indexPath, JSON.stringify(this.index, null, 2));
    }

    // ============================================================
    // 内部方法 - Vault API 封装
    // ============================================================

    private async fileExists(path: string): Promise<boolean> {
        try {
            return await this.vault.adapter.exists(path);
        } catch {
            return false;
        }
    }

    private async dirExists(path: string): Promise<boolean> {
        try {
            return await this.vault.adapter.exists(path);
        } catch {
            return false;
        }
    }

    private async readFile(path: string): Promise<string> {
        return await this.vault.adapter.read(path);
    }

    private async writeFile(path: string, content: string): Promise<void> {
        await this.vault.adapter.write(path, content);
    }

    private async createDir(path: string): Promise<void> {
        await this.vault.adapter.mkdir(path);
    }

    private async deleteFile(path: string): Promise<void> {
        await this.vault.adapter.remove(path);
    }

    // ============================================================
    // 工具方法
    // ============================================================

    private generateId(): string {
        return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    private generateActionId(): string {
        return `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    private extractTitleFromFile(filePath: string): string {
        const parts = filePath.split(/[\\/]/);
        const fileName = parts[parts.length - 1] || filePath;
        return fileName.replace(/\.[^.]+$/, '');
    }

    private extractCharacterNames(characterResult: any): string[] {
        if (!characterResult) return [];

        const names: string[] = [];

        if (Array.isArray(characterResult.finalCharacters)) {
            for (const char of characterResult.finalCharacters) {
                if (char.name) names.push(char.name);
            }
        }

        if (names.length === 0 && Array.isArray(characterResult.llmVerified)) {
            for (const char of characterResult.llmVerified) {
                if (char.name) names.push(char.name);
            }
        }

        if (names.length === 0 && Array.isArray(characterResult.ruleCandidates)) {
            for (const char of characterResult.ruleCandidates) {
                if (char.name) names.push(char.name);
            }
        }

        return names;
    }
}
