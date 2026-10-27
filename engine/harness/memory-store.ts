/**
 * memory-store.ts - five-layer memory records with pending/confirmed/rejected.
 *
 * AI-generated memory never becomes confirmed automatically. Records are stored
 * under {project}/Harness/memory/<status>/ and never touch正文 files.
 */
import type { DataAdapter } from 'obsidian';
import type { CreationMode } from '../../shared/creation-mode';
import { resolveProjectRoot } from '../../domains/kernel/project-locator';
import { createLogger } from '../../shared/logger';

const log = createLogger('HarnessMemory');

export type MemoryStatus = 'pending' | 'confirmed' | 'rejected';
export type MemoryScope = 'chapter' | 'section' | 'episode' | 'scene' | 'project' | 'global';
export type MemoryKind =
    | 'fact'
    | 'entity-state'
    | 'relationship'
    | 'timeline-event'
    | 'foreshadow'
    | 'promise'
    | 'style-pattern'
    | 'user-preference'
    | 'continuity-risk';

export interface MemoryRecord {
    schemaVersion: 1;
    id: string;
    mode: CreationMode;
    scope: MemoryScope;
    kind: MemoryKind;
    title: string;
    content: string;
    status: MemoryStatus;
    source: 'ai' | 'tool' | 'user' | 'rule';
    confidence: number;
    createdAt: number;
    updatedAt: number;
    citations?: Array<{
        sourceId: string;
        title: string;
        uri?: string;
        snippet: string;
        score: number;
        kind: 'vault' | 'knowledge' | 'external';
        verified: boolean;
        retrievedAt: number;
    }>;
}

export interface MemoryRecordInput {
    id?: string;
    mode: CreationMode;
    scope: MemoryScope;
    kind: MemoryKind;
    title: string;
    content: string;
    source?: MemoryRecord['source'];
    confidence?: number;
    citations?: MemoryRecord['citations'];
}

export interface MemoryIndexEntry {
    id: string;
    mode: CreationMode;
    scope: MemoryScope;
    kind: MemoryKind;
    title: string;
    status: MemoryStatus;
    updatedAt: number;
}

export const MEMORY_DIR = 'Harness/memory';

export function memoryDir(projectId: string): string {
    return `${resolveProjectRoot(projectId)}/${MEMORY_DIR}`;
}

export function memoryRecordPath(projectId: string, status: MemoryStatus, id: string): string {
    return `${memoryDir(projectId)}/${status}/${id}.json`;
}

export function createMemoryRecord(input: MemoryRecordInput): MemoryRecord {
    if (!input.title.trim()) throw new Error('MemoryRecord: title 不能为空');
    if (!input.content.trim()) throw new Error('MemoryRecord: content 不能为空');
    const now = Date.now();
    const id = input.id || `mem_${now}_${Math.random().toString(36).slice(2, 8)}`;
    const source = input.source || 'ai';
    return {
        schemaVersion: 1,
        id,
        mode: input.mode,
        scope: input.scope,
        kind: input.kind,
        title: input.title.trim(),
        content: input.content.trim(),
        // AI 产出永远 pending；非 AI 也先 pending，必须显式确认。
        status: 'pending',
        source,
        confidence: Math.max(0, Math.min(1, input.confidence ?? 0.5)),
        createdAt: now,
        updatedAt: now,
        citations: input.citations,
    };
}

export class MemoryStore {
    private cache: MemoryRecord[] | null = null;

    constructor(
        private readonly adapter: DataAdapter,
        private readonly projectId: string,
    ) {}

    private async ensureDir(path: string): Promise<void> {
        if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
    }

    private async ensureLayout(): Promise<void> {
        for (const status of ['pending', 'confirmed', 'rejected'] as const) {
            await this.ensureDir(`${memoryDir(this.projectId)}/${status}`);
        }
    }

    async savePending(record: MemoryRecord): Promise<MemoryRecord> {
        await this.ensureLayout();
        const next: MemoryRecord = { ...record, status: 'pending', updatedAt: Date.now(), schemaVersion: 1 };
        await this.adapter.write(memoryRecordPath(this.projectId, 'pending', next.id), JSON.stringify(next, null, 2));
        this.cache = null;
        return next;
    }

    async confirm(id: string): Promise<MemoryRecord | null> {
        return this.move(id, 'pending', 'confirmed');
    }

    async reject(id: string): Promise<MemoryRecord | null> {
        return this.move(id, 'pending', 'rejected');
    }

    private async move(id: string, from: MemoryStatus, to: MemoryStatus): Promise<MemoryRecord | null> {
        await this.ensureLayout();
        const fromPath = memoryRecordPath(this.projectId, from, id);
        if (!(await this.adapter.exists(fromPath))) return null;
        const record = JSON.parse(await this.adapter.read(fromPath)) as MemoryRecord;
        const next: MemoryRecord = { ...record, status: to, updatedAt: Date.now() };
        await this.adapter.write(memoryRecordPath(this.projectId, to, id), JSON.stringify(next, null, 2));
        await this.adapter.remove(fromPath);
        this.cache = null;
        return next;
    }

    async list(status?: MemoryStatus): Promise<MemoryRecord[]> {
        if (status) {
            return this.listStatus(status);
        }
        if (this.cache) return [...this.cache];
        const all = [
            ...(await this.listStatus('pending')),
            ...(await this.listStatus('confirmed')),
            ...(await this.listStatus('rejected')),
        ];
        this.cache = all;
        return [...all];
    }

    /** RAG / prompt 只允许读取 confirmed。 */
    async listConfirmed(): Promise<MemoryRecord[]> {
        return this.listStatus('confirmed');
    }

    private async listStatus(status: MemoryStatus): Promise<MemoryRecord[]> {
        const dir = `${memoryDir(this.projectId)}/${status}`;
        if (!(await this.adapter.exists(dir))) return [];
        try {
            const list = await this.adapter.list(dir);
            const records: MemoryRecord[] = [];
            for (const file of list.files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const raw = JSON.parse(await this.adapter.read(file)) as MemoryRecord;
                    if (raw?.schemaVersion === 1 && raw.status === status) records.push(raw);
                } catch (e) {
                    log.warn('skip invalid memory record:', file, e);
                }
            }
            return records.sort((a, b) => b.updatedAt - a.updatedAt);
        } catch (e) {
            log.warn('memory list failed:', e);
            return [];
        }
    }

    async buildIndex(): Promise<MemoryIndexEntry[]> {
        const all = await this.list();
        return all.map(record => ({
            id: record.id,
            mode: record.mode,
            scope: record.scope,
            kind: record.kind,
            title: record.title,
            status: record.status,
            updatedAt: record.updatedAt,
        }));
    }
}