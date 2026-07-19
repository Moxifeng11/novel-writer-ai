import { App, Notice, TFile, Modal } from 'obsidian';
import { FullWriterStore, WriterTab } from './full-writer-store';
import { WizardTab } from './wizard-types';
import { MiniSettingsModal } from '../mini-settings-modal';
import NovelWriterPlugin from '../../main';
import { pjStepDir } from '../../shared/paths';
import { createLogger } from '../../shared/logger';


const log = createLogger('TabController');
export interface TabControllerDeps {
    app: App;
    plugin: NovelWriterPlugin;
    state: FullWriterStore;
    getTabBar: () => HTMLDivElement | null;
    getTabContent: () => HTMLDivElement | null;
    closeOutlineTreeModal: () => void;
    renderProjectSelector: () => Promise<void>;
    renderWizardTabContent: (tab: WizardTab, skipAutoAdvance?: boolean) => Promise<void>;
    renderInContainer: (container: HTMLElement) => Promise<void>;
    loadContext: () => Promise<void>;
    getChapterStateManager: () => any;
    calcResumeStepIndex: () => number;
    rebuildChapDirIfNeeded: (project: string, chapterName: string, volume: string, chapterNum?: number) => string;
}

export class TabController {
    private deps: TabControllerDeps;

    constructor(deps: TabControllerDeps) {
        this.deps = deps;
    }

    get state(): FullWriterStore {
        return this.deps.state;
    }

    get tabs(): WriterTab[] {
        return this.deps.state.tabs;
    }

    get activeTabId(): string {
        return this.deps.state.activeTabId;
    }

    async pushNav(tabId: string): Promise<void> {
        this.deps.state.pushNav(tabId);
        await this.activateTab(tabId);
    }

    popNav(): void {
        const prevTabId = this.deps.state.popNav();
        if (prevTabId) {
            this.activateTab(prevTabId);
        } else {
            this.activateTab('project-selector');
        }
    }

    async activateTab(tabId: string): Promise<void> {
        this.deps.closeOutlineTreeModal();
        const wasActive = this.deps.state.activeTabId === tabId;
        this.deps.state.activeTabId = tabId;
        this.renderTabBar();
        await this.renderTabContent();
        if (wasActive) {
            new Notice('已刷新当前页面', 2000);
        }
    }

    closeTab(tabId: string): void {
        const tab = this.deps.state.findTab(tabId);
        if (tab && tab.type === 'wizard') {
            const wizardTab = tab as WizardTab;
            const allDone = wizardTab.steps
                ?.filter(s => s.id !== 'complete')
                .every(s => s.status === 'done' || s.status === 'skipped');
            if (!allDone) {
                new Notice('⚠️ 项目已创建但未完成初始化，可在项目选择中手动完成各步骤', 5000);
            }
        }

        const idx = this.deps.state.tabs.findIndex(t => t.id === tabId);
        if (idx < 0) return;
        const newTabs = [...this.deps.state.tabs];
        newTabs.splice(idx, 1);
        this.deps.state.tabs = newTabs;

        if (this.deps.state.activeTabId === tabId) {
            const targetIdx = Math.min(idx, newTabs.length - 1);
            this.deps.state.activeTabId = newTabs[targetIdx]?.id || 'project-selector';
            this.renderTabBar();
            this.renderTabContent();
        } else {
            this.renderTabBar();
        }
    }

    async renderTabContent(): Promise<void> {
        const tabContent = this.deps.getTabContent();
        if (!tabContent) return;
        tabContent.empty();

        const activeTab = this.deps.state.findTab(this.deps.state.activeTabId);
        if (!activeTab) return;

        if (activeTab.type === 'selector') {
            await this.deps.renderProjectSelector();
        } else if (activeTab.type === 'wizard' && activeTab.project) {
            this.deps.state.setNavigationState({
                project: activeTab.project,
                chapterName: '',
                chapDir: '',
                volume: '',
                chapterNum: 0,
            });
            this.deps.getChapterStateManager().stepCompleted.clear();
            this.deps.getChapterStateManager().stepResults = {};
            await this.deps.renderWizardTabContent(activeTab as WizardTab);
            return;
        } else if (activeTab.type === 'chapter' && activeTab.project && activeTab.chapterName) {
            this.deps.state.setNavigationState({
                project: activeTab.project,
                chapterName: activeTab.chapterName,
                volume: activeTab.volume || '',
                chapDir: activeTab.chapDir || '',
                chapterNum: activeTab.chapterNum || 0,
            });

            const project = activeTab.project;
            const chapterName = activeTab.chapterName;
            const volume = activeTab.volume || '';
            const chapterNum = activeTab.chapterNum || 0;

            if (!activeTab.chapDir && project && chapterName && volume) {
                const chapDir = this.deps.rebuildChapDirIfNeeded(project, chapterName, volume, chapterNum);
                activeTab.chapDir = chapDir;
                this.deps.state.chapDir = chapDir;
                log.warn('[小说工坊] chapDir 为空，从上下文重建 (v4.0 步骤结果路径):', chapDir);
            }
            log.warn('[小说工坊] renderTabContent: chapDir=', this.deps.state.chapDir,
                'project=', project, 'volume=', volume, 'chapterName=', chapterName);

            this.deps.getChapterStateManager().currentStepIndex = 0;
            this.deps.getChapterStateManager().stepCompleted.clear();
            this.deps.getChapterStateManager().stepResults = {};

            await this.deps.loadContext();
            await this.deps.getChapterStateManager().restoreChapterState(this.deps.state.chapDir);
            this.deps.getChapterStateManager().currentStepIndex = this.deps.calcResumeStepIndex();
            await this.deps.renderInContainer(tabContent);
        }
    }

    renderTabBar(): void {
        const tabBar = this.deps.getTabBar();
        if (!tabBar) return;
        tabBar.empty();

        const navStack = this.deps.state.navStack;
        if (navStack.length > 0) {
            const backBtn = tabBar.createEl('button', {
                text: '← 返回',
                cls: 'novel-writer-fw-back-btn',
                attr: {
                    title: '返回上一页',
                }
            });
            backBtn.addEventListener('click', () => { this.popNav(); });
        }

        for (const tab of this.deps.state.tabs) {
            const isSelector = tab.type === 'selector';
            const isActive = tab.id === this.deps.state.activeTabId;
            const tabClasses = ['novel-writer-fw-tab'];
            if (isActive) tabClasses.push('active');
            if (isSelector) tabClasses.push('is-selector');
            
            const tabEl = tabBar.createDiv({
                cls: tabClasses.join(' '),
            });
            tabEl.createSpan({ text: tab.label });

            if (tab.type !== 'selector') {
                const closeBtn = tabEl.createSpan({
                    text: ' ×',
                    cls: 'novel-writer-fw-tab-close',
                });
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTab(tab.id);
                });
            }

            tabEl.addEventListener('click', () => {
                this.activateTab(tab.id);
            });
        }

        const spacer = tabBar.createDiv({ cls: 'novel-writer-fw-tab-spacer' });

        const addBtn = tabBar.createEl('button', {
            text: '+',
            cls: 'novel-writer-fw-tab-btn novel-writer-fw-tab-btn-add nw-btn-project-add',
            attr: {
                title: '切换至项目选择页面',
            }
        });
        addBtn.addEventListener('click', () => {
            this.activateTab('project-selector');
        });

        const settingsBtn = tabBar.createEl('button', {
            text: '⚙️',
            cls: 'novel-writer-fw-tab-btn novel-writer-fw-tab-btn-settings nw-btn-settings',
            attr: {
                title: '工作台设置（模型选择、上下文范围、热重载等）',
            }
        });
        settingsBtn.addEventListener('click', () => {
            new MiniSettingsModal(this.deps.app, this.deps.plugin).open();
        });

        const reloadBtn = tabBar.createEl('button', {
            text: '🔄',
            cls: 'novel-writer-fw-tab-btn novel-writer-fw-tab-btn-reload nw-btn-reload',
            attr: {
                title: '热重载插件（按最新文件重新加载 UI 和后端）',
            }
        });
        reloadBtn.addEventListener('click', async () => {
            this.deps.plugin._pendingReloadState = {
                project: this.deps.state.project || '',
                chapterFileName: this.deps.state.chapterName || '',
                volume: this.deps.state.volume || '',
                chapDir: this.deps.state.chapDir || ''
            };

            this.deps.app.plugins.disablePlugin('novel-writer-ai');
            await this.deps.app.plugins.enablePlugin('novel-writer-ai');
        });
    }

    async selectChapter(project: string, chapter: { chapter: string; volume: string; file: TFile }): Promise<void> {
        const chapKey = `${project}/${chapter.chapter}`;

        const existingTab = this.deps.state.tabs.find(t => t.chapterKey === chapKey);
        if (existingTab) {
            await this.activateTab(existingTab.id);
            return;
        }

        const chapterNum = parseInt(chapter.chapter.match(/\d+/)?.[0] || '0');
        const selVolN = parseInt(chapter.volume.match(/第(\d+)卷/)?.[1] || '1', 10);
        const chapDir = (chapter.volume && chapterNum > 0) ? pjStepDir(project, selVolN, chapterNum) : '';

        const newTab = {
            id: `chapter-${Date.now()}`,
            label: `✍️ ${chapter.chapter}`,
            type: 'chapter' as const,
            chapterKey: chapKey,
            project,
            chapterName: chapter.chapter,
            volume: chapter.volume,
            chapDir,
            chapterNum,
            file: chapter.file
        };

        this.deps.state.addTab(newTab, true);
        this.renderTabBar();
        await this.renderTabContent();
    }
}
