import { TFile } from 'obsidian';
import { WizardStep } from './wizard-types';
import { createPersistentWizardResults } from './wizard-results-store';
import { createLogger } from '../../shared/logger';
import type { CreationMode } from '../../shared/creation-mode';


const log = createLogger('FullWriterStore');
/**
 * 页签类型结构定义。
 */
export type TabType = 'selector' | 'chapter' | 'wizard' | 'flow' | 'unit';

/**
 * 写入器页签结构定义。
 */
export interface WriterTab {
    id: string;
    label: string;
    type: TabType;
    chapterKey?: string;
    project?: string;
    chapterName?: string;
    volume?: string;
    chapDir?: string;
    chapterNum?: number;
    file?: TFile;
    projectType?: 'original' | 'fanfic';
    currentStepIdx?: number;
    steps?: WizardStep[];
    /** flow / unit 页签：所属模式 */
    mode?: CreationMode;
    /** unit 页签：单元编号与显示名（第N节/第N集） */
    unitNumber?: number;
    unitName?: string;
}

/**
 * FullWriterStateSnapshot 类型定义。
 */
export interface FullWriterStateSnapshot {
    project: string;
    chapterName: string;
    chapterNum: number;
    volume: string;
    chapDir: string;
    vars: Record<string, string>;
    isLoading: boolean;
    activeTabId: string;
    tabs: WriterTab[];
    navStack: string[];
}

type StateChangeListener = (snapshot: FullWriterStateSnapshot) => void;

/**
 * 完整写入器存储结构定义。
 */
export interface FullWriterStore {
    project: string;
    chapterName: string;
    chapterNum: number;
    volume: string;
    chapDir: string;
    vars: Record<string, string>;
    isLoading: boolean;
    activeTabId: string;
    tabs: WriterTab[];
    navStack: string[];
    wizardStepResults: Record<string, string>;
    wizardStepExecuting: Set<string>;

    setVar(key: string, value: string): void;
    deleteVar(key: string): void;
    setVars(newVars: Record<string, string>): void;
    mergeVars(additionalVars: Record<string, string>): void;

    pushNav(tabId: string): void;
    popNav(): string | undefined;
    navigateTo(tabId: string): void;

    findTab(id: string): WriterTab | undefined;
    findTabByChapterKey(chapterKey: string): WriterTab | undefined;
    addTab(tab: WriterTab, activate?: boolean): void;
    removeTab(tabId: string): void;
    updateTab(tabId: string, updates: Partial<WriterTab>): void;
    activateTab(tabId: string): void;

    resetNavState(): void;
    /**
     * setNavigationState 方法。
     * @param partial - 部分结果
     */
    setNavigationState(partial: Partial<{
        project: string;
        chapterName: string;
        chapterNum: number;
        volume: string;
        chapDir: string;
    }>): void;

    snapshot(): FullWriterStateSnapshot;
    subscribe(listener: StateChangeListener): () => void;
}

/**
 * FullWriterStoreImpl 类。
 */
export class FullWriterStoreImpl implements FullWriterStore {
    private _project = '';
    private _chapterName = '';
    private _chapterNum = 0;
    private _volume = '';
    private _chapDir = '';
    private _vars: Record<string, string> = {};
    private _isLoading = false;

    private _tabs: WriterTab[] = [];
    private _activeTabId = '';
    private _navStack: string[] = [];

    private _wizardStepResults: Record<string, string>;
    private _wizardStepExecuting: Set<string> = new Set();

    private _listeners: Set<StateChangeListener> = new Set();
    private _notificationPending = false;

    constructor() {
        this._wizardStepResults = createPersistentWizardResults(() => this._project);
    }

    get project(): string { return this._project; }
    set project(v: string) { this._project = v; this.scheduleNotify(); }

    get chapterName(): string { return this._chapterName; }
    set chapterName(v: string) { this._chapterName = v; this.scheduleNotify(); }

    get chapterNum(): number { return this._chapterNum; }
    set chapterNum(v: number) { this._chapterNum = v; this.scheduleNotify(); }

    get volume(): string { return this._volume; }
    set volume(v: string) { this._volume = v; this.scheduleNotify(); }

    get chapDir(): string { return this._chapDir; }
    set chapDir(v: string) { this._chapDir = v; this.scheduleNotify(); }

    get vars(): Record<string, string> { return this._vars; }
    set vars(v: Record<string, string>) { this._vars = v; this.scheduleNotify(); }

    get isLoading(): boolean { return this._isLoading; }
    set isLoading(v: boolean) { this._isLoading = v; this.scheduleNotify(); }

    get tabs(): WriterTab[] { return this._tabs; }
    set tabs(v: WriterTab[]) { this._tabs = v; this.scheduleNotify(); }

    get activeTabId(): string { return this._activeTabId; }
    set activeTabId(v: string) { this._activeTabId = v; this.scheduleNotify(); }

    get navStack(): string[] { return this._navStack; }
    set navStack(v: string[]) { this._navStack = v; this.scheduleNotify(); }

    get wizardStepResults(): Record<string, string> { return this._wizardStepResults; }
    get wizardStepExecuting(): Set<string> { return this._wizardStepExecuting; }

    /**
     * 设置单个变量。
     *
     * @param key - 键
     * @param value - 值
     */
    setVar(key: string, value: string): void {
        this._vars[key] = value;
        this.scheduleNotify();
    }

    /**
     * 删除变量。
     *
     * @param key - 键
     */
    deleteVar(key: string): void {
        delete this._vars[key];
        this.scheduleNotify();
    }

    /**
     * 覆盖变量集合。
     *
     * @param newVars - 新变量表
     */
    setVars(newVars: Record<string, string>): void {
        this._vars = { ...newVars };
        this.scheduleNotify();
    }

    /**
     * 合并变量集合。
     *
     * @param additionalVars - 附加变量
     */
    mergeVars(additionalVars: Record<string, string>): void {
        this._vars = { ...this._vars, ...additionalVars };
        this.scheduleNotify();
    }

    /**
     * 压入导航栈。
     *
     * @param tabId - 页签 ID
     */
    pushNav(tabId: string): void {
        this._navStack.push(this._activeTabId);
        this._activeTabId = tabId;
        this.scheduleNotify();
    }

    /**
     * 弹出导航栈。
     * @returns 标签 id 或 undefined
     */
    popNav(): string | undefined {
        const prev = this._navStack.pop();
        if (prev) {
            this._activeTabId = prev;
        }
        this.scheduleNotify();
        return prev;
    }

    /**
     * 跳转到标签页。
     *
     * @param tabId - 页签 ID
     */
    navigateTo(tabId: string): void {
        this._activeTabId = tabId;
        this.scheduleNotify();
    }

    /**
     * 按 id 查找标签页。
     *
     * @param id - 标识
     * @returns 标签页或 undefined
     */
    findTab(id: string): WriterTab | undefined {
        return this._tabs.find(t => t.id === id);
    }

    /**
     * 按章节键查找标签页。
     *
     * @param chapterKey - 章节键
     * @returns 标签页或 undefined
     */
    findTabByChapterKey(chapterKey: string): WriterTab | undefined {
        return this._tabs.find(t => t.chapterKey === chapterKey);
    }

    /**
     * 新增标签页。
     *
     * @param tab - 页签
     * @param activate = true - 参数
     */
    addTab(tab: WriterTab, activate = true): void {
        this._tabs.push(tab);
        if (activate) {
            this._activeTabId = tab.id;
        }
        this.scheduleNotify();
    }

    /**
     * 移除标签页。
     *
     * @param tabId - 页签 ID
     */
    removeTab(tabId: string): void {
        const idx = this._tabs.findIndex(t => t.id === tabId);
        if (idx >= 0) {
            this._tabs.splice(idx, 1);
            if (this._activeTabId === tabId) {
                const targetIdx = Math.min(idx, this._tabs.length - 1);
                this._activeTabId = this._tabs[targetIdx]?.id || 'project-selector';
            }
        }
        this.scheduleNotify();
    }

    /**
     * 更新标签页。
     *
     * @param tabId - 页签 ID
     * @param updates - 更新字段
     */
    updateTab(tabId: string, updates: Partial<WriterTab>): void {
        const tab = this._tabs.find(t => t.id === tabId);
        if (tab) {
            Object.assign(tab, updates);
            this.scheduleNotify();
        }
    }

    /**
     * 激活标签页。
     *
     * @param tabId - 页签 ID
     */
    activateTab(tabId: string): void {
        if (this._tabs.some(t => t.id === tabId)) {
            this._activeTabId = tabId;
            this.scheduleNotify();
        }
    }

    /**
     * 重置导航状态。
     */
    resetNavState(): void {
        this._project = '';
        this._chapterName = '';
        this._chapterNum = 0;
        this._volume = '';
        this._chapDir = '';
        this._vars = {};
        this.scheduleNotify();
    }

    /**
     * setNavigationState 方法。
     * @param partial - 部分结果
     */
    setNavigationState(partial: Partial<{
        project: string;
        chapterName: string;
        chapterNum: number;
        volume: string;
        chapDir: string;
    }>): void {
        // v4.25：跨卷快照属于「上一章会话」，切章必须清掉——
        // 否则先打开卷首章再切普通章节，旧卷快照会残留进下一章的 prevChaptersSummary。
        const chapterChanged = (partial.project !== undefined && partial.project !== this._project)
            || (partial.chapterNum !== undefined && partial.chapterNum !== this._chapterNum)
            || (partial.chapDir !== undefined && partial.chapDir !== this._chapDir);
        if (chapterChanged) delete this._vars['crossVolumeSnapshot'];
        if (partial.project !== undefined) this._project = partial.project;
        if (partial.chapterName !== undefined) this._chapterName = partial.chapterName;
        if (partial.chapterNum !== undefined) this._chapterNum = partial.chapterNum;
        if (partial.volume !== undefined) this._volume = partial.volume;
        if (partial.chapDir !== undefined) this._chapDir = partial.chapDir;
        this.scheduleNotify();
    }

    /**
     * 订阅状态变化。
     *
     * @param listener - 监听器
     * @returns 取消订阅函数
     */
    subscribe(listener: StateChangeListener): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    private scheduleNotify(): void {
        if (this._notificationPending) return;
        this._notificationPending = true;
        requestAnimationFrame(() => {
            this._notificationPending = false;
            this.notify();
        });
    }

    private notify(): void {
        if (this._listeners.size === 0) return;
        const snapshot = this.snapshot();
        for (const l of this._listeners) {
            try { l(snapshot); } catch (e) { log.warn('[FullWriterStore] listener error:', e); }
        }
    }

    /**
     * 导出状态快照。
     * @returns 快照
     */
    snapshot(): FullWriterStateSnapshot {
        return {
            project: this._project,
            chapterName: this._chapterName,
            chapterNum: this._chapterNum,
            volume: this._volume,
            chapDir: this._chapDir,
            vars: { ...this._vars },
            isLoading: this._isLoading,
            activeTabId: this._activeTabId,
            tabs: [...this._tabs],
            navStack: [...this._navStack],
        };
    }
}