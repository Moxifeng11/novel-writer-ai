import { App, Notice, TFile, Modal } from 'obsidian';
import { FullWriterStore, WriterTab } from './full-writer-store';
import { WizardTab } from './wizard-types';
import NovelWriterPlugin from '../../main';
import { pjStepDir } from '../../shared/paths';
import { createLogger } from '../../shared/logger';
import { renderModelQuickSwitcher, type ModelQuickSwitcherHandle } from '../model-quick-switcher';


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
    /** 创作流程页签 */
    renderFlowTabContent?: (tab: WriterTab) => Promise<void>;
    /** 短篇/剧本单元写作页签 */
    renderUnitTabContent?: (tab: WriterTab) => Promise<void>;
    renderInContainer: (container: HTMLElement) => Promise<void>;
    loadContext: () => Promise<void>;
    getChapterStateManager: () => any;
    calcResumeStepIndex: () => number;
    rebuildChapDirIfNeeded: (project: string, chapterName: string, volume: string, chapterNum?: number) => string;
    /**
     * 离开当前章节（切章/回项目选择/向导）时取消在跑的一键任务。
     * 不取消的话，后续步骤会用新章节的 vars 生成、却按旧 ctx 写盘，关掉视图也还在烧 AI。
     */
    cancelActiveRun?: () => void;
}

export class TabController {
    private deps: TabControllerDeps;
    /** 模型快速切换器（Tab 栏右端）；重渲染时销毁旧实例避免刷新回调泄漏 */
    private modelSwitcher: ModelQuickSwitcherHandle | null = null;

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
        // 导航栈里可能留着已关闭的页签：先跳过，否则 activateTab 到已删除的 id
        // 会让 renderTabContent 在 empty() 之后 findTab 失败直接 return —— 界面空白。
        let prevTabId = this.deps.state.popNav();
        while (prevTabId && !this.deps.state.findTab(prevTabId)) {
            prevTabId = this.deps.state.popNav();
        }
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
        // 导航栈同步移除：留着已关闭的 id，之后「返回」会跳到不存在的页签
        if (this.deps.state.navStack.includes(tabId)) {
            this.deps.state.navStack = this.deps.state.navStack.filter(id => id !== tabId);
        }

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

        // 离开当前章节前先取消在跑的一键任务：编排器在 run() 开始时快照了 ctx，
        // 切章后继续跑会用新章节的 vars 生成、却写进旧章节目录（或反过来）。
        const leavingCurrentChapter = activeTab.type !== 'chapter'
            || activeTab.project !== this.deps.state.project
            || activeTab.chapterName !== this.deps.state.chapterName;
        if (leavingCurrentChapter) {
            this.deps.cancelActiveRun?.();
        }

        if (activeTab.type === 'selector') {
            await this.deps.renderProjectSelector();
        } else if (activeTab.type === 'flow' && activeTab.project) {
            await this.deps.renderFlowTabContent?.(activeTab);
            return;
        } else if (activeTab.type === 'unit' && activeTab.project) {
            await this.deps.renderUnitTabContent?.(activeTab);
            return;
        } else if (activeTab.type === 'wizard' && activeTab.project) {
            this.deps.state.setNavigationState({
                project: activeTab.project,
                chapterName: '',
                chapDir: '',
                volume: '',
                chapterNum: 0,
            });
            this.deps.getChapterStateManager().stepCompleted.clear();
            // 就地清空：编排器/步骤执行器在 run() 开始时捕获了 stepResults 引用，
            // 换新对象会让它们的写入落到孤儿对象，界面看不到已完成状态。
            const wizardCs = this.deps.getChapterStateManager();
            for (const key of Object.keys(wizardCs.stepResults)) delete wizardCs.stepResults[key];
            await this.deps.renderWizardTabContent(activeTab as WizardTab, true);
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
            // 就地清空（原因同上）：运行中重渲染不能把编排器手里的引用换掉
            for (const key of Object.keys(this.deps.getChapterStateManager().stepResults)) {
                delete this.deps.getChapterStateManager().stepResults[key];
            }

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
        this.modelSwitcher?.destroy();
        this.modelSwitcher = null;

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

        // 2026-10-28: 原右下角状态栏浮窗移除后，模型快速切换装配到 Tab 栏（四个主界面之一）。
        this.modelSwitcher = renderModelQuickSwitcher(tabBar, this.deps.plugin);

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

    async selectChapter(project: string, chapter: { chapter: string; volume: string; file: TFile | null }): Promise<void> {
        const volumeKey = chapter.volume || '';
        const chapKey = `${project}/${volumeKey}/${chapter.chapter}`;
        const chapterNum = parseInt(chapter.chapter.match(/\d+/)?.[0] || '0');
        const selVolN = parseInt(chapter.volume.match(/第(\d+)卷/)?.[1] || '1', 10);
        const chapDir = (chapter.volume && chapterNum > 0) ? pjStepDir(project, selVolN, chapterNum) : '';

        // Rev 185：chapterKey 必须带卷。旧实现只用 `项目/第N章`，跨卷同名章会复用错 tab；
        // 且复用旧 tab 时不同步 chapter/volume/chapDir，切章后仍用旧章节上下文，表现为「切换没反应」。
        const existingTab = this.deps.state.tabs.find(t => t.type === 'chapter' && (
            t.chapterKey === chapKey ||
            (t.project === project
                && t.chapterName === chapter.chapter
                // 只有「两边都没有卷信息」或「卷一致」才复用；跨卷同名章不能复用同一页签
                && (volumeKey ? t.volume === volumeKey : !t.volume))
        ));
        if (existingTab) {
            existingTab.chapterKey = chapKey;
            existingTab.chapterName = chapter.chapter;
            existingTab.volume = chapter.volume;
            existingTab.chapterNum = chapterNum;
            existingTab.chapDir = chapDir || existingTab.chapDir || '';
            // 页签标题必须跟着章节走（旧实现只改内部字段，标题仍是上一章）
            existingTab.label = `✍️ ${chapter.chapter}`;
            await this.activateTab(existingTab.id);
            if (this.deps.state.chapterName !== chapter.chapter) {
                new Notice('⚠️ 章节切换未生效，请重试或点击标题栏 🔄 刷新工作台');
            }
            return;
        }

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
            file: chapter.file ?? undefined
        };

        this.deps.state.addTab(newTab, true);
        this.renderTabBar();
        await this.renderTabContent();
        if (this.deps.state.chapterName !== chapter.chapter) {
            new Notice('⚠️ 章节切换未生效，请重试或点击标题栏 🔄 刷新工作台');
        }
    }
}
