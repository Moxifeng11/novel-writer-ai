/**
 * command-registry.ts — 命令注册与路由
 *
 * 职责：注册所有 Obsidian 命令、InternalRegistry 桥接、视图打开逻辑
 * 从 main.ts 拆分而来
 */

import { App, ItemView, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { InternalRegistry } from '../engine/internal-registry';
import { NovelWriterModal } from '../ui/main-modal';
import { CreateProjectModal } from '../ui/create-project-modal';
import { PlanBookModal } from '../ui/plan-book-modal';
import { WriteChapterModal } from '../ui/write-chapter-modal';
import { ReviewChapterModal } from '../ui/review-chapter-modal';
import { BatchCreateModal } from '../ui/batch-create-modal';
import { GenerateWorldviewModal } from '../ui/generate-worldview-modal';
import { GenerateCharacterModal } from '../ui/generate-character-modal';
import { GenerateFactionModal } from '../ui/generate-faction-modal';
import { GenerateLocationModal } from '../ui/generate-location-modal';
import { GenerateItemModal } from '../ui/generate-item-modal';
import { CrossVolumeStateModal } from '../ui/cross-volume-state-modal';
import { StyleDistillerModal } from '../ui/style-distiller-modal';
import { ContextInjectorModal } from '../ui/context-injector-modal';
import { ChapterSettlementModal } from '../ui/chapter-settlement-modal';
import { VolumeIntroModal } from '../ui/volume-intro-modal';
import { BatchChaptersModal } from '../ui/batch-chapters-modal';
import { ContinueChaptersModal } from '../ui/continue-chapters-modal';
import { AutoWriterModal } from '../ui/auto-writer-modal';
import { DiagnoseWriterModal } from '../ui/diagnose-writer-modal';
import { TomatoRankModal } from '../ui/tomato-rank-modal';
import { RebuildChaptersModal } from '../ui/rebuild-chapters-modal';
import { BackupYuanModal } from '../ui/backup-yuan-modal';
import { ProtectYuanModal } from '../ui/protect-yuan-modal';
import { NovelTagsModal } from '../ui/novel-tags-modal';
import { AiBuilderModal } from '../ui/ai-builder-modal';
import { AddFanficSettingModal } from '../ui/add-fanfic-setting-modal';
import { ProviderSwitcherModal } from '../ui/provider-switcher-modal';
import { FullWriterView, VIEW_TYPE as FULL_WRITER_VIEW_TYPE } from '../ui/full-writer-view';
import { CoWritingView, VIEW_TYPE_CO_WRITE } from '../ui/co-writing-view';
import { FloatWorkspaceManager } from '../ui/workspace-manager';
import { pjNarrativeOverview } from '../shared/paths';

/** CommandRegistry 所需的插件接口 */
export interface CommandRegistryDeps {
    app: App;
    registry: InternalRegistry;
    aiEngine: { extractElements(content: string): Promise<{ error?: string }> };
    ctxManager: any;
    foreshadowManager: { refreshInfoDebt(): void };
    workspaceManager?: FloatWorkspaceManager;
    /** 获取当前活动项目名 */
    getActiveProject(): string | null;
    /** 打开提供商切换弹窗 */
    openProviderSwitcher(): void;
    /** 刷新工作台面板 */
    refreshFullWriterContextPanel(): void;
    /** 执行 populateSettingLib */
    populateSettingLib(): Promise<void>;
    /** 工作台状态 */
    getWorkbenchState(): { project?: string; chapterName?: string; chapterNum?: number; volume?: string } | null;
    /** 是否为工作台上下文 */
    isWorkbenchContext(): boolean;
}

export class CommandRegistry {
    private readonly deps: CommandRegistryDeps;

    constructor(deps: CommandRegistryDeps) {
        this.deps = deps;
    }

    /** 注册 InternalRegistry 命令（供外部 API 调用） */
    registerInternalCommands(): void {
        const r = this.deps.registry;
        r.register('novel-writer-write-chapter', async () => new WriteChapterModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-plan-book', async () => new PlanBookModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-create-project', async () => new CreateProjectModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-volume-intro', async () => new VolumeIntroModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-batch-chapters', async () => new BatchChaptersModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-continue-chapters', async () => new ContinueChaptersModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-auto-writer', async () => new AutoWriterModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-diagnose', async () => new DiagnoseWriterModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-tomato-rank', async () => new TomatoRankModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-rebuild', async () => new RebuildChaptersModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-backup', async () => new BackupYuanModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-protect', async () => new ProtectYuanModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-tags', async () => new NovelTagsModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-ai-builder', async () => new AiBuilderModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-add-fanfic', async () => new AddFanficSettingModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-write-chapter-auto', async () => { WriteChapterModal.runBackground(this.deps.app, this.deps as any); });
        r.register('novel-writer-review-chapter', async () => new ReviewChapterModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-batch-create', async () => new BatchCreateModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-worldview', async () => new GenerateWorldviewModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-character', async () => new GenerateCharacterModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-faction', async () => new GenerateFactionModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-location', async () => new GenerateLocationModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-item', async () => new GenerateItemModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-refresh-info-debt', async () => { this.deps.foreshadowManager.refreshInfoDebt(); });
        r.register('novel-writer-cross-volume-state', async () => new CrossVolumeStateModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-style-distiller', async () => new StyleDistillerModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-context-injector', async () => new ContextInjectorModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-chapter-settlement', async () => new ChapterSettlementModal(this.deps.app, this.deps as any).open());
        r.register('novel-writer-full-writer', async () => { this.openFullWriterView(); });
        r.register('switch-provider', async () => this.deps.openProviderSwitcher());
        r.register('novel-writer-extract-elements', async () => { this.extractElementsCommand(); });
        r.register('populate-setting-lib', () => this.deps.populateSettingLib());
        r.register('novel-writer-co-writing', async () => { await this.openCoWritingFromActiveContext(); });
    }

    /** 注册 Obsidian 命令面板命令 */
    registerObsidianCommands(addCommand: (cmd: { id: string; name: string; callback: () => void }) => void): void {
        const exec = (id: string) => () => {
            this.deps.registry.execute(id).catch(err => console.error('[小说工坊]', err));
        };

        addCommand({ id: 'novel-writer-create-project', name: '新建项目', callback: exec('novel-writer-create-project') });
        addCommand({ id: 'novel-writer-plan-book', name: 'AI全书规划', callback: exec('novel-writer-plan-book') });
        addCommand({ id: 'novel-writer-volume-intro', name: '全书简介', callback: exec('novel-writer-volume-intro') });
        addCommand({ id: 'novel-writer-batch-chapters', name: '批量写正文〔旧〕', callback: exec('novel-writer-batch-chapters') });
        addCommand({ id: 'novel-writer-continue-chapters', name: '续写规划', callback: exec('novel-writer-continue-chapters') });
        addCommand({ id: 'novel-writer-auto-writer', name: '自动写作器〔旧〕', callback: exec('novel-writer-auto-writer') });
        addCommand({ id: 'novel-writer-diagnose', name: '流程诊断', callback: exec('novel-writer-diagnose') });
        addCommand({ id: 'novel-writer-tomato-rank', name: '番茄榜单分析', callback: exec('novel-writer-tomato-rank') });
        addCommand({ id: 'novel-writer-rebuild', name: '重建章节', callback: exec('novel-writer-rebuild') });
        addCommand({ id: 'novel-writer-backup', name: '备份元文件', callback: exec('novel-writer-backup') });
        addCommand({ id: 'novel-writer-protect', name: '保护元文件', callback: exec('novel-writer-protect') });
        addCommand({ id: 'novel-writer-tags', name: '作品标签分析', callback: exec('novel-writer-tags') });
        addCommand({ id: 'novel-writer-ai-builder', name: 'AI世界元素生成', callback: exec('novel-writer-ai-builder') });
        addCommand({ id: 'novel-writer-add-fanfic', name: '添加同人设定', callback: exec('novel-writer-add-fanfic') });
        addCommand({ id: 'novel-writer-write-chapter', name: 'AI写正文〔旧〕', callback: exec('novel-writer-write-chapter') });
        addCommand({ id: 'novel-writer-write-chapter-auto', name: '后台AI写正文〔旧〕', callback: exec('novel-writer-write-chapter-auto') });
        addCommand({ id: 'novel-writer-review-chapter', name: '连贯性审查', callback: exec('novel-writer-review-chapter') });
        addCommand({ id: 'novel-writer-batch-create', name: '批量建章', callback: exec('novel-writer-batch-create') });
        addCommand({ id: 'novel-writer-worldview', name: '生成世界观', callback: exec('novel-writer-worldview') });
        addCommand({ id: 'novel-writer-character', name: '生成人物', callback: exec('novel-writer-character') });
        addCommand({ id: 'novel-writer-faction', name: '生成势力', callback: exec('novel-writer-faction') });
        addCommand({ id: 'novel-writer-location', name: '生成地点', callback: exec('novel-writer-location') });
        addCommand({ id: 'novel-writer-item', name: '生成物品功法', callback: exec('novel-writer-item') });
        addCommand({ id: 'novel-writer-refresh-info-debt', name: '刷新信息债看板', callback: exec('novel-writer-refresh-info-debt') });
        addCommand({ id: 'novel-writer-cross-volume-state', name: '跨卷状态继承', callback: exec('novel-writer-cross-volume-state') });
        addCommand({ id: 'novel-writer-style-distiller', name: '文笔风格蒸馏', callback: exec('novel-writer-style-distiller') });
        addCommand({ id: 'novel-writer-context-injector', name: '上下文注入', callback: exec('novel-writer-context-injector') });
        addCommand({ id: 'novel-writer-chapter-settlement', name: '章节结算', callback: exec('novel-writer-chapter-settlement') });
        addCommand({ id: 'novel-writer-full-writer', name: '📖 完整写作工作台', callback: exec('novel-writer-full-writer') });
        addCommand({ id: 'novel-writer-co-writing', name: '✍️ 句级协同写作工作台', callback: exec('novel-writer-co-writing') });
        addCommand({ id: 'switch-provider', name: '快速切换 AI 提供商', callback: exec('switch-provider') });
        addCommand({ id: 'novel-writer-extract-elements', name: 'AI 元素提取', callback: exec('novel-writer-extract-elements') });
        addCommand({ id: 'novel-writer-populate-setting-lib', name: '从世界观生成设定库', callback: exec('populate-setting-lib') });
        addCommand({ id: 'novel-writer-rename-project', name: '重命名当前项目', callback: () => this.renameProject() });

        // 叙事总览（直接执行，不走 registry）
        addCommand({ id: 'novel-writer-narrative-overview', name: '叙事总览', callback: () => this.openNarrativeOverview() });
    }

    // ─── 视图操作 ───

    async openFullWriterView(): Promise<void> {
        const { workspace } = this.deps.app;
        const existing = workspace.getLeavesOfType(FULL_WRITER_VIEW_TYPE);
        let leaf: WorkspaceLeaf;
        if (existing.length > 0) {
            leaf = existing[0];
            for (let i = 1; i < existing.length; i++) existing[i].detach();
        } else {
            leaf = workspace.getLeaf('tab');
        }
        await leaf.setViewState({ type: FULL_WRITER_VIEW_TYPE, active: true });
        workspace.revealLeaf(leaf);
    }

    async activateCoWritingView(project?: string, chapterName?: string, volume?: string, chapterNum?: number): Promise<void> {
        const { workspace } = this.deps.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE)[0];
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_CO_WRITE, active: true });
        }
        workspace.revealLeaf(leaf);
        if (project || chapterName) {
            const view = leaf.view as CoWritingView;
            if (view) await view.openChapter(project || '', chapterName || '', volume || '第1卷', chapterNum || 1);
        }
        await this.deps.workspaceManager?.openAll();
    }

    async openCoWritingFromActiveContext(): Promise<void> {
        const wb = this.deps.getWorkbenchState();
        if (wb?.project && wb?.chapterNum) {
            await this.activateCoWritingView(wb.project, wb.chapterName || `第${wb.chapterNum}章`, wb.volume || '第1卷', wb.chapterNum);
            return;
        }
        const activeFile = this.deps.app.workspace.getActiveFile();
        const ctx = activeFile ? parseChapterFromPath(activeFile.path) : null;
        if (ctx) {
            await this.activateCoWritingView(ctx.project, ctx.chapterName, ctx.volume, ctx.chapterNum);
            new Notice(`✍️ 已绑定章节：${ctx.project} · ${ctx.volume} · 第${ctx.chapterNum}章`, 3000);
            return;
        }
        await this.activateCoWritingView();
        new Notice('已打开句级协同写作工作台。请先打开某章「正文」文件，或从完整写作工作台选择章节后再进入，即可自动绑定。', 6000);
    }

    // ─── 私有辅助 ───

    private async extractElementsCommand(): Promise<void> {
        const activeView = this.deps.app.workspace.getActiveViewOfType(ItemView);
        if (!activeView) { new Notice('请先打开一个 Markdown 文件'); return; }
        const file = (activeView as ItemView & { file?: TFile }).file ?? null;
        if (!file) { new Notice('未找到当前文件'); return; }
        const content = await this.deps.app.vault.read(file);
        const result = await this.deps.aiEngine.extractElements(content);
        if (result.error) {
            new Notice(`元素提取失败: ${result.error}`);
        } else {
            new Notice(`✅ 元素提取完成`, 5000);
        }
    }

    private renameProject(): void {
        const activeFile = this.deps.app.workspace.getActiveFile();
        if (!activeFile) { new Notice('请先打开项目中的文件'); return; }
        const project = activeFile.path.split('/')[0];
        new Notice(`当前项目: ${project}。请在文件浏览器中右键文件夹重命名，或通过生成世界观自动重命名。`);
    }

    private async openNarrativeOverview(): Promise<void> {
        const project = this.deps.getActiveProject();
        if (!project) { new Notice('请先选择项目'); return; }
        const overviewPath = pjNarrativeOverview(project);
        const file = this.deps.app.vault.getAbstractFileByPath(overviewPath);
        if (file instanceof TFile) {
            const leaf = this.deps.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
        } else {
            new Notice('叙事总览尚未生成，请先执行章节结算');
        }
    }
}

/** 从文件路径反解章节上下文 */
export function parseChapterFromPath(path: string): { project: string; volume: string; chapterNum: number; chapterName: string } | null {
    if (!path) return null;
    const m = path.match(/^(.+?)\/03-大纲与章节\/正文\/(第(\d+)卷)\/第(\d+)章_正文\.md$/);
    if (!m) return null;
    const project = m[1];
    const chapterNum = parseInt(m[4], 10);
    if (!project || !Number.isFinite(chapterNum)) return null;
    return { project, volume: m[2], chapterNum, chapterName: `第${chapterNum}章` };
}
