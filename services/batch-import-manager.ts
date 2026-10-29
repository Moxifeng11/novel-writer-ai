/**
 * batch-import-manager.ts — 批量导入管理器
 *
 * 功能：管理批量导入任务队列，支持并发控制、失败重试、导入历史、预设方案
 */

import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import { kbImportHistoryFile, kbImportPresetsFile, kbBookDir } from '../shared/paths';
import { KnowledgeBaseManager } from './knowledge-base-manager';
import { DeconstructionScheduler, type BreakdownDimension } from './deconstruction-scheduler';
import { ChapterRecognizer, type BookRecognitionResult } from './chapter-recognizer';
import { SerializedWriter } from '../shared/serialized-writer';
import { createLogger } from '../shared/logger';


const log = createLogger('BatchImportManager');
export type ImportTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'queued';

export type ImportSource = 'vault-file' | 'vault-folder' | 'local-file' | 'drag-drop';

export interface ImportBookPreview {
    id: string;
    filename: string;
    source: ImportSource;
    sourcePath?: string;
    content: string;
    selected: boolean;
    recognition: BookRecognitionResult;
    overrides: {
        name?: string;
        author?: string;
    };
}

export interface ImportTask {
    id: string;
    previewId: string;
    bookName: string;
    status: ImportTaskStatus;
    progress: number;
    error?: string;
    retryCount: number;
    maxRetries: number;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    bookId?: string;
    priority: number;
    dimensions: BreakdownDimension[];
    autoStartDeconstruction: boolean;
}

export interface ImportHistoryItem {
    id: string;
    importTime: number;
    totalCount: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
    books: Array<{
        bookId?: string;
        bookName: string;
        filename: string;
        status: 'success' | 'failed' | 'skipped';
        error?: string;
    }>;
    settings: ImportBatchSettings;
}

export interface ImportBatchSettings {
    themeTags: string[];
    techniqueTags: string[];
    customTags: string[];
    dimensions: BreakdownDimension[];
    autoStartDeconstruction: boolean;
    autoClassify: boolean;
    priority: number;
    concurrency: number;
    presetName?: string;
}

export interface ImportPreset {
    id: string;
    name: string;
    settings: ImportBatchSettings;
    createdAt: number;
    updatedAt: number;
}

export interface BatchImportProgress {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    activeTasks: number;
    overallProgress: number;
    currentTasks: ImportTask[];
}

const DEFAULT_SETTINGS: ImportBatchSettings = {
    themeTags: [],
    techniqueTags: [],
    customTags: [],
    dimensions: ['style', 'rhythm', 'technique', 'structure', 'character', 'foreshadow'],
    autoStartDeconstruction: true,
    autoClassify: true,
    priority: 0,
    concurrency: 2,
};

function generateId(): string {
    return 'import_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export class BatchImportManager {
    private app: App;
    private baseDir?: string;
    private fs: FileSystemPort | null = null;
    private kbManager: KnowledgeBaseManager;
    private deconstructionScheduler: DeconstructionScheduler;
    private chapterRecognizer: ChapterRecognizer;

    private previews: Map<string, ImportBookPreview> = new Map();
    private tasks: Map<string, ImportTask> = new Map();
    private queue: string[] = [];
    private activeCount = 0;
    private history: ImportHistoryItem[] = [];
    private presets: ImportPreset[] = [];
    private settings: ImportBatchSettings = { ...DEFAULT_SETTINGS };

    private historyWriter = new SerializedWriter({ debug: false });
    private presetsWriter = new SerializedWriter({ debug: false });

    private progressCallbacks = new Set<(progress: BatchImportProgress) => void>();
    private taskCallbacks = new Set<(task: ImportTask) => void>();

    private abortControllers = new Map<string, AbortController>();

    constructor(
        app: App,
        kbManager: KnowledgeBaseManager,
        deconstructionScheduler: DeconstructionScheduler,
        baseDir?: string
    ) {
        this.app = app;
        this.kbManager = kbManager;
        this.deconstructionScheduler = deconstructionScheduler;
        this.baseDir = baseDir;
        this.chapterRecognizer = new ChapterRecognizer();
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    async init(): Promise<void> {
        const fs = this.getFS();
        const configDir = kbImportHistoryFile(this.baseDir).split('/').slice(0, -1).join('/');
        await fs.mkdir(configDir).catch(() => undefined);

        await this.loadHistory();
        await this.loadPresets();
    }

    private async loadHistory(): Promise<void> {
        const fs = this.getFS();
        const historyPath = kbImportHistoryFile(this.baseDir);
        try {
            const content = await fs.read(historyPath);
            const data = JSON.parse(content);
            if (Array.isArray(data)) {
                this.history = data;
            }
        } catch {
            this.history = [];
        }
    }

    private async saveHistory(): Promise<void> {
        await this.historyWriter.enqueueAutoClean(async () => {
            const fs = this.getFS();
            const historyPath = kbImportHistoryFile(this.baseDir);
            try {
                await fs.write(historyPath, JSON.stringify(this.history.slice(0, 100), null, 2));
            } catch (e) {
                log.warn('[BatchImportManager] 历史记录保存失败:', e);
            }
        }).catch(() => {});
    }

    private async loadPresets(): Promise<void> {
        const fs = this.getFS();
        const presetsPath = kbImportPresetsFile(this.baseDir);
        try {
            const content = await fs.read(presetsPath);
            const data = JSON.parse(content);
            if (Array.isArray(data)) {
                this.presets = data;
            }
        } catch {
            this.presets = [];
        }
    }

    private async savePresets(): Promise<void> {
        await this.presetsWriter.enqueueAutoClean(async () => {
            const fs = this.getFS();
            const presetsPath = kbImportPresetsFile(this.baseDir);
            try {
                await fs.write(presetsPath, JSON.stringify(this.presets, null, 2));
            } catch (e) {
                log.warn('[BatchImportManager] 预设保存失败:', e);
            }
        }).catch(() => {});
    }

    addPreview(file: { filename: string; content: string; source: ImportSource; sourcePath?: string }): ImportBookPreview {
        const recognition = this.chapterRecognizer.recognize(file.content, file.filename);
        const preview: ImportBookPreview = {
            id: generateId(),
            filename: file.filename,
            source: file.source,
            sourcePath: file.sourcePath,
            content: file.content,
            selected: true,
            recognition,
            overrides: {},
        };
        this.previews.set(preview.id, preview);
        return preview;
    }

    removePreview(previewId: string): void {
        this.previews.delete(previewId);
    }

    clearPreviews(): void {
        this.previews.clear();
    }

    getPreviews(): ImportBookPreview[] {
        return Array.from(this.previews.values());
    }

    getSelectedPreviews(): ImportBookPreview[] {
        return Array.from(this.previews.values()).filter(p => p.selected);
    }

    updatePreview(previewId: string, updates: Partial<ImportBookPreview>): void {
        const preview = this.previews.get(previewId);
        if (preview) {
            Object.assign(preview, updates);
        }
    }

    setSettings(settings: Partial<ImportBatchSettings>): void {
        this.settings = { ...this.settings, ...settings };
    }

    getSettings(): ImportBatchSettings {
        return { ...this.settings };
    }

    startImport(): string {
        const selected = this.getSelectedPreviews();
        const historyId = generateId();

        // 进度与「本次结果」都是按 tasks 全量统计的。不清掉上一批的终态任务，
        // 第二批会显示成 5/8、成功数翻倍，onComplete 也把历史批次算成本次。
        for (const [taskId, task] of Array.from(this.tasks)) {
            if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                this.tasks.delete(taskId);
            }
        }

        const historyItem: ImportHistoryItem = {
            id: historyId,
            importTime: Date.now(),
            totalCount: selected.length,
            successCount: 0,
            failedCount: 0,
            skippedCount: 0,
            books: [],
            settings: { ...this.settings },
        };

        selected.forEach(preview => {
            const taskId = generateId();
            const bookName = preview.overrides.name || preview.recognition.title;
            const task: ImportTask = {
                id: taskId,
                previewId: preview.id,
                bookName,
                status: 'queued',
                progress: 0,
                retryCount: 0,
                maxRetries: 3,
                createdAt: Date.now(),
                priority: this.settings.priority,
                dimensions: [...this.settings.dimensions],
                autoStartDeconstruction: this.settings.autoStartDeconstruction,
            };
            this.tasks.set(taskId, task);
            this.queue.push(taskId);

            historyItem.books.push({
                bookName,
                filename: preview.filename,
                status: 'skipped',
            });
        });

        this.history.unshift(historyItem);
        this.saveHistory();

        this.sortQueue();
        this.scheduleNext();

        return historyId;
    }

    private sortQueue(): void {
        this.queue.sort((a, b) => {
            const taskA = this.tasks.get(a);
            const taskB = this.tasks.get(b);
            if (!taskA || !taskB) return 0;
            return taskB.priority - taskA.priority;
        });
    }

    private scheduleNext(): void {
        const concurrency = this.settings.concurrency || 2;
        while (this.activeCount < concurrency && this.queue.length > 0) {
            const taskId = this.queue.shift();
            if (taskId) {
                this.runTask(taskId);
            }
        }
        this.emitProgress();
    }

    private async runTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;

        this.activeCount++;
        task.status = 'processing';
        task.startedAt = Date.now();

        const controller = new AbortController();
        this.abortControllers.set(taskId, controller);

        this.emitTask(task);
        this.emitProgress();

        try {
            const preview = this.previews.get(task.previewId);
            if (!preview) {
                throw new Error('预览数据不存在');
            }

            task.progress = 10;
            this.emitTask(task);

            const bookName = task.bookName;
            const author = preview.overrides.author || preview.recognition.author;
            const wordCount = preview.recognition.wordCount;

            // 幂等：自动重试与手动「重新导入」都会再次进到这里。
            // 旧实现无条件 addBook，失败发生在建书之后（写源文件/建拆解任务失败）时，
            // 每重试一次就多出一本「书名 (2)」「书名 (3)」，用户完全看不出原因。
            let book = task.bookId ? await this.kbManager.getBook(task.bookId) : undefined;
            if (!book) {
                book = await this.kbManager.addBook({
                    name: bookName,
                    author,
                    wordCount,
                    themeTags: [...this.settings.themeTags],
                    techniqueTags: [...this.settings.techniqueTags],
                    customTags: [...this.settings.customTags],
                    synopsis: '',
                    sourcePath: preview.sourcePath || preview.filename,
                }, { autoClassify: this.settings.autoClassify });
                task.bookId = book.id;
            }
            task.progress = 50;
            this.emitTask(task);

            await this.saveSourceText(book.name, preview.content);

            task.progress = 80;
            this.emitTask(task);

            if (task.autoStartDeconstruction && task.dimensions.length > 0) {
                await this.deconstructionScheduler.addTask(book.id, preview.content, task.dimensions);
            }

            task.status = 'completed';
            task.progress = 100;
            task.completedAt = Date.now();

            this.updateHistoryBook(task, 'success');

        } catch (error) {
            if (task.retryCount < task.maxRetries && !controller.signal.aborted) {
                task.retryCount++;
                task.status = 'queued';
                task.progress = 0;
                task.error = error instanceof Error ? error.message : String(error);
                this.queue.push(taskId);
                this.sortQueue();
            } else {
                task.status = 'failed';
                task.error = error instanceof Error ? error.message : String(error);
                task.completedAt = Date.now();
                this.updateHistoryBook(task, 'failed', task.error);
            }
        } finally {
            this.abortControllers.delete(taskId);
            this.activeCount--;

            this.emitTask(task);
            this.scheduleNext();
        }
    }

    private async saveSourceText(bookName: string, content: string): Promise<void> {
        const fs = this.getFS();
        const bookDir = kbBookDir(bookName, this.baseDir);
        const sourceFile = `${bookDir}/${bookName}.txt`;
        await fs.mkdir(bookDir).catch(() => undefined);
        await fs.write(sourceFile, content);
    }

    private updateHistoryBook(task: ImportTask, status: 'success' | 'failed' | 'skipped', error?: string): void {
        for (const item of this.history) {
            const bookEntry = item.books.find(b => b.bookName === task.bookName);
            if (bookEntry) {
                bookEntry.status = status;
                bookEntry.bookId = task.bookId;
                if (error) {
                    bookEntry.error = error;
                }
                break;
            }
        }
        this.recalculateHistoryCounts();
        this.saveHistory();
    }

    private recalculateHistoryCounts(): void {
        for (const item of this.history) {
            item.successCount = item.books.filter(b => b.status === 'success').length;
            item.failedCount = item.books.filter(b => b.status === 'failed').length;
            item.skippedCount = item.books.filter(b => b.status === 'skipped').length;
        }
    }

    cancelTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        if (task.status === 'queued') {
            this.queue = this.queue.filter(id => id !== taskId);
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.emitTask(task);
            this.emitProgress();
        } else if (task.status === 'processing') {
            const controller = this.abortControllers.get(taskId);
            if (controller) {
                controller.abort();
            }
            task.status = 'cancelled';
            task.completedAt = Date.now();
        }
    }

    pauseTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        if (task.status === 'queued') {
            this.queue = this.queue.filter(id => id !== taskId);
            task.status = 'pending';
            this.emitTask(task);
            this.emitProgress();
        }
    }

    resumeTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        if (task.status === 'pending') {
            task.status = 'queued';
            this.queue.push(taskId);
            this.sortQueue();
            this.scheduleNext();
        }
    }

    retryTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        if (task.status === 'failed' || task.status === 'cancelled') {
            task.status = 'queued';
            task.progress = 0;
            task.error = undefined;
            task.retryCount = 0;
            task.startedAt = undefined;
            task.completedAt = undefined;
            this.queue.push(taskId);
            this.sortQueue();
            this.scheduleNext();
        }
    }

    setTaskPriority(taskId: string, priority: number): void {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.priority = priority;
        if (task.status === 'queued') {
            this.sortQueue();
        }
    }

    getActiveTasks(): ImportTask[] {
        return Array.from(this.tasks.values()).filter(
            t => t.status === 'processing' || t.status === 'queued' || t.status === 'pending'
        );
    }

    getAllTasks(): ImportTask[] {
        return Array.from(this.tasks.values());
    }

    getTask(taskId: string): ImportTask | undefined {
        return this.tasks.get(taskId);
    }

    getProgress(): BatchImportProgress {
        const allTasks = Array.from(this.tasks.values());
        const totalTasks = allTasks.length;
        const completedTasks = allTasks.filter(t => t.status === 'completed').length;
        const failedTasks = allTasks.filter(t => t.status === 'failed').length;
        const activeTasks = allTasks.filter(t => t.status === 'processing');
        const overallProgress = totalTasks > 0
            ? Math.round((allTasks.reduce((sum, t) => sum + t.progress, 0) / (totalTasks * 100)) * 100)
            : 0;

        return {
            totalTasks,
            completedTasks,
            failedTasks,
            activeTasks: activeTasks.length,
            overallProgress,
            currentTasks: activeTasks,
        };
    }

    onProgress(callback: (progress: BatchImportProgress) => void): () => void {
        this.progressCallbacks.add(callback);
        return () => this.progressCallbacks.delete(callback);
    }

    onTaskUpdate(callback: (task: ImportTask) => void): () => void {
        this.taskCallbacks.add(callback);
        return () => this.taskCallbacks.delete(callback);
    }

    private emitProgress(): void {
        const progress = this.getProgress();
        for (const cb of this.progressCallbacks) {
            try {
                cb(progress);
            } catch (e) {
                log.warn('[BatchImportManager] 进度回调失败:', e);
            }
        }
    }

    private emitTask(task: ImportTask): void {
        for (const cb of this.taskCallbacks) {
            try {
                cb(task);
            } catch (e) {
                log.warn('[BatchImportManager] 任务回调失败:', e);
            }
        }
    }

    getHistory(): ImportHistoryItem[] {
        return [...this.history];
    }

    getHistoryItem(historyId: string): ImportHistoryItem | undefined {
        return this.history.find(h => h.id === historyId);
    }

    clearHistory(): void {
        this.history = [];
        this.saveHistory();
    }

    retryFailedFromHistory(historyId: string): void {
        const historyItem = this.history.find(h => h.id === historyId);
        if (!historyItem) return;

        const failedBooks = historyItem.books.filter(b => b.status === 'failed');
        for (const book of failedBooks) {
            const task = Array.from(this.tasks.values()).find(t => t.bookName === book.bookName);
            if (task) {
                this.retryTask(task.id);
            }
        }
    }

    getPresets(): ImportPreset[] {
        return [...this.presets];
    }

    savePreset(name: string, settings: ImportBatchSettings): ImportPreset {
        const preset: ImportPreset = {
            id: generateId(),
            name,
            settings: { ...settings },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.presets.push(preset);
        this.savePresets();
        return preset;
    }

    deletePreset(presetId: string): void {
        this.presets = this.presets.filter(p => p.id !== presetId);
        this.savePresets();
    }

    applyPreset(presetId: string): boolean {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset) return false;
        this.settings = { ...preset.settings };
        return true;
    }

    updatePreset(presetId: string, updates: Partial<ImportPreset>): void {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset) return;
        Object.assign(preset, updates);
        preset.updatedAt = Date.now();
        if (updates.settings) {
            preset.settings = { ...updates.settings };
        }
        this.savePresets();
    }

    async flush(): Promise<void> {
        await this.historyWriter.flush();
        await this.presetsWriter.flush();
    }

    get hasPendingWrites(): boolean {
        return this.historyWriter.isDirty || this.presetsWriter.isDirty;
    }

    getChapterRecognizer(): ChapterRecognizer {
        return this.chapterRecognizer;
    }
}
