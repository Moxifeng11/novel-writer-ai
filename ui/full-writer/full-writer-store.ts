import { TFile } from 'obsidian';
import { WizardStep } from './wizard-types';
import { createPersistentWizardResults } from './wizard-results-store';
import { createLogger } from '../../shared/logger';
import type { CreationMode } from '../../shared/creation-mode';


const log = createLogger('FullWriterStore');
export type TabType = 'selector' | 'chapter' | 'wizard' | 'flow' | 'unit';

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

    setVar(key: string, value: string): void {
        this._vars[key] = value;
        this.scheduleNotify();
    }

    deleteVar(key: string): void {
        delete this._vars[key];
        this.scheduleNotify();
    }

    setVars(newVars: Record<string, string>): void {
        this._vars = { ...newVars };
        this.scheduleNotify();
    }

    mergeVars(additionalVars: Record<string, string>): void {
        this._vars = { ...this._vars, ...additionalVars };
        this.scheduleNotify();
    }

    pushNav(tabId: string): void {
        this._navStack.push(this._activeTabId);
        this._activeTabId = tabId;
        this.scheduleNotify();
    }

    popNav(): string | undefined {
        const prev = this._navStack.pop();
        if (prev) {
            this._activeTabId = prev;
        }
        this.scheduleNotify();
        return prev;
    }

    navigateTo(tabId: string): void {
        this._activeTabId = tabId;
        this.scheduleNotify();
    }

    findTab(id: string): WriterTab | undefined {
        return this._tabs.find(t => t.id === id);
    }

    findTabByChapterKey(chapterKey: string): WriterTab | undefined {
        return this._tabs.find(t => t.chapterKey === chapterKey);
    }

    addTab(tab: WriterTab, activate = true): void {
        this._tabs.push(tab);
        if (activate) {
            this._activeTabId = tab.id;
        }
        this.scheduleNotify();
    }

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

    updateTab(tabId: string, updates: Partial<WriterTab>): void {
        const tab = this._tabs.find(t => t.id === tabId);
        if (tab) {
            Object.assign(tab, updates);
            this.scheduleNotify();
        }
    }

    activateTab(tabId: string): void {
        if (this._tabs.some(t => t.id === tabId)) {
            this._activeTabId = tabId;
            this.scheduleNotify();
        }
    }

    resetNavState(): void {
        this._project = '';
        this._chapterName = '';
        this._chapterNum = 0;
        this._volume = '';
        this._chapDir = '';
        this._vars = {};
        this.scheduleNotify();
    }

    setNavigationState(partial: Partial<{
        project: string;
        chapterName: string;
        chapterNum: number;
        volume: string;
        chapDir: string;
    }>): void {
        if (partial.project !== undefined) this._project = partial.project;
        if (partial.chapterName !== undefined) this._chapterName = partial.chapterName;
        if (partial.chapterNum !== undefined) this._chapterNum = partial.chapterNum;
        if (partial.volume !== undefined) this._volume = partial.volume;
        if (partial.chapDir !== undefined) this._chapDir = partial.chapDir;
        this.scheduleNotify();
    }

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