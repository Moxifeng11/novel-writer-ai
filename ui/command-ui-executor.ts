/**
 * command-ui-executor.ts — 命令的 UI 执行层
 *
 * 从 core/command-registry.ts 拆分而来：core 不再 import 任何 ui 模块，
 * 只按命令 id 委托本执行器。Modal 构造、视图打开、旧命令提示与编辑器选区
 * 读取都集中在这里。core 侧仅保留命令定义表、注册与无 UI 依赖的逻辑
 * （示例项目导入、信息债刷新、元素提取、版本保存等）。
 */

import { App, Editor, MarkdownView, Notice } from 'obsidian';
import type NovelWriterPlugin from '../main';
import { CommandIds } from '../shared/command-ids';
import type { CommandUiPayload, CommandUiPort, VersionFileContext } from '../shared/command-ui-port';
import { createLogger } from '../shared/logger';
import type { ChapterVersionService } from '../services/chapter-version-service';
import { ChapterVersionModal } from './chapter-version-modal';
import { RenameProjectModal } from './rename-project-modal';
import { CreateProjectModal } from './create-project-modal';
import { PlanBookModal } from './plan-book-modal';
import { WriteChapterModal } from './write-chapter-modal';
import { ReviewChapterModal } from './review-chapter-modal';
import { QualityDashboardModal } from './quality-dashboard-modal';
import { StoryLinkageModal } from './story-linkage-modal';
import { BatchCreateModal } from './batch-create-modal';
import { BatchNovelsModal } from './batch-novels-modal';
import { GenerateWorldviewModal } from './generate-worldview-modal';
import { GenerateCharacterModal } from './generate-character-modal';
import { GenerateFactionModal } from './generate-faction-modal';
import { GenerateLocationModal } from './generate-location-modal';
import { GenerateItemModal } from './generate-item-modal';
import { CrossVolumeStateModal } from './cross-volume-state-modal';
import { StyleDistillerModal } from './style-distiller-modal';
import { ContextInjectorModal } from './context-injector-modal';
import { ExpandTextModal } from './expand-text-modal';
import { OutlineExpandModal } from './outline-expand-modal';
import { ChapterSettlementModal } from './chapter-settlement-modal';
import { IdeationModal } from './ideation-modal';
import { GoldenOpeningModal } from './golden-opening-modal';
import { StepResultViewerModal } from './step-result-viewer-modal';
import { VolumeIntroModal } from './volume-intro-modal';
import { BatchChaptersModal } from './batch-chapters-modal';
import { ContinueChaptersModal } from './continue-chapters-modal';
import { AutoWriterModal } from './auto-writer-modal';
import { DiagnoseWriterModal } from './diagnose-writer-modal';
import { TomatoRankModal } from './tomato-rank-modal';
import { RebuildChaptersModal } from './rebuild-chapters-modal';
import { BackupYuanModal } from './backup-yuan-modal';
import { ProtectYuanModal } from './protect-yuan-modal';
import { NovelTagsModal } from './novel-tags-modal';
import { AiBuilderModal } from './ai-builder-modal';
import { AddFanficSettingModal } from './add-fanfic-setting-modal';
import { UnifiedEntityManagerModal } from './unified-entity-manager-modal';
import { UnifiedEntityGenerateModal } from './unified-entity-generate-modal';
import { ExportManuscriptModal } from './export-manuscript-modal';
import { RewriteSuggestionModal } from './rewrite-suggestion-modal';
import { VIEW_TYPE_WRITING_FINGERPRINT } from './views/writing-fingerprint-view';
import { VIEW_TYPE_KNOWLEDGE_BASE } from './views/knowledge-base-view';

const log = createLogger('CommandUiExecutor');

export interface CommandUiExecutorDeps {
    app: App;
    plugin: NovelWriterPlugin;
    /** 版本服务（由 main 从 engineRegistry 取，避免本模块依赖 engine-registry） */
    getVersionService(): ChapterVersionService | null;
}

export class CommandUiExecutor implements CommandUiPort {
    private readonly legacyCommandWarned = new Set<string>();

    constructor(private readonly deps: CommandUiExecutorDeps) {}

    /**
     * 执行 UI 类命令。
     * 返回 false 表示该 id 不属于 UI 执行器，由调用方维持原有处理。
     */
    async executeCommand(id: string, payload?: CommandUiPayload): Promise<boolean> {
        const { app, plugin } = this.deps;

        switch (id) {
            // ── 项目管理类 ──
            case CommandIds.CREATE_PROJECT:
                new CreateProjectModal(app, plugin).open();
                return true;
            case CommandIds.PLAN_BOOK:
                new PlanBookModal(app, plugin).open();
                return true;
            case CommandIds.VOLUME_INTRO:
                new VolumeIntroModal(app, plugin).open();
                return true;
            case CommandIds.BATCH_CHAPTERS:
                this.warnLegacyCommand('批量写正文〔旧〕');
                new BatchChaptersModal(app, plugin).open();
                return true;
            case CommandIds.BATCH_NOVELS:
                new BatchNovelsModal(app, plugin).open();
                return true;
            case CommandIds.CONTINUE_CHAPTERS:
                new ContinueChaptersModal(app, plugin).open();
                return true;
            case CommandIds.AUTO_WRITER:
                this.warnLegacyCommand('自动写作器〔旧〕');
                new AutoWriterModal(app, plugin).open();
                return true;
            case CommandIds.DIAGNOSE:
                new DiagnoseWriterModal(app, plugin).open();
                return true;
            case CommandIds.TOMATO_RANK:
                new TomatoRankModal(app, plugin).open();
                return true;
            case CommandIds.REBUILD_CHAPTERS:
                new RebuildChaptersModal(app, plugin).open();
                return true;
            case CommandIds.BACKUP_META:
                new BackupYuanModal(app, plugin).open();
                return true;
            case CommandIds.PROTECT_META:
                new ProtectYuanModal(app, plugin).open();
                return true;
            case CommandIds.TAGS_ANALYSIS:
                new NovelTagsModal(app, plugin).open();
                return true;
            case CommandIds.AI_BUILDER:
                new AiBuilderModal(app, plugin).open();
                return true;
            case CommandIds.ADD_FANFIC: {
                const project = plugin.getActiveProject();
                new AddFanficSettingModal(app, plugin, project || undefined).open();
                return true;
            }

            // ── 写作辅助类 ──
            case CommandIds.WRITE_CHAPTER:
                this.warnLegacyCommand('AI写正文〔旧〕');
                new WriteChapterModal(app, plugin).open();
                return true;
            case CommandIds.WRITE_CHAPTER_AUTO:
                this.warnLegacyCommand('后台AI写正文〔旧〕');
                WriteChapterModal.runBackground(app, plugin);
                return true;
            case CommandIds.REVIEW_CHAPTER:
                new ReviewChapterModal(app, plugin).open();
                return true;
            case CommandIds.QUALITY_DASHBOARD:
                new QualityDashboardModal(app, plugin).open();
                return true;
            case CommandIds.BATCH_CREATE:
                new BatchCreateModal(app, plugin).open();
                return true;
            case CommandIds.CROSS_VOLUME_STATE:
                new CrossVolumeStateModal(app, plugin).open();
                return true;
            case CommandIds.CHAPTER_SETTLEMENT:
                new ChapterSettlementModal(app, plugin).open();
                return true;
            case CommandIds.EXPAND_TEXT:
                this.expandText(payload?.editor);
                return true;
            case CommandIds.OUTLINE_EXPAND:
                this.outlineExpand(payload?.editor);
                return true;
            case CommandIds.REWRITE_SUGGESTION:
                this.rewriteSuggestion(payload?.editor);
                return true;

            // ── 知识库类 ──
            case CommandIds.WORLDVIEW:
                new GenerateWorldviewModal(app, plugin).open();
                return true;
            case CommandIds.CHARACTER:
                new GenerateCharacterModal(app, plugin).open();
                return true;
            case CommandIds.FACTION:
                new GenerateFactionModal(app, plugin).open();
                return true;
            case CommandIds.LOCATION:
                new GenerateLocationModal(app, plugin).open();
                return true;
            case CommandIds.ITEM:
                new GenerateItemModal(app, plugin).open();
                return true;
            case CommandIds.ENTITY_MANAGER: {
                const project = plugin.getActiveProject();
                if (!project) {
                    new Notice('⚠️ 请先选择或打开一个项目', 3000);
                    return true;
                }
                new UnifiedEntityManagerModal(app, plugin, project).open();
                return true;
            }
            case CommandIds.ENTITY_GENERATE: {
                const project = plugin.getActiveProject();
                new UnifiedEntityGenerateModal(app, plugin, project || undefined).open();
                return true;
            }
            case CommandIds.STYLE_DISTILLER:
                new StyleDistillerModal(app, plugin).open();
                return true;
            case CommandIds.CONTEXT_INJECTOR:
                new ContextInjectorModal(app, plugin).open();
                return true;
            case CommandIds.BATCH_DECONSTRUCT: {
                const { BatchDeconstructModal } = await import('./batch-deconstruct-modal');
                new BatchDeconstructModal(app, plugin).open();
                return true;
            }
            case CommandIds.CHARACTER_RECOGNITION: {
                const { CharacterRecognitionModal } = await import('./character-recognition-modal');
                new CharacterRecognitionModal(app, plugin).open();
                return true;
            }
            case CommandIds.FINGERPRINT_LIBRARY:
                await this.openFingerprintLibrary();
                return true;
            case CommandIds.OPEN_KNOWLEDGE_BASE:
                await this.openKnowledgeBase();
                return true;

            // ── 工具类 ──
            case CommandIds.IDEATION:
                new IdeationModal(app, plugin).open();
                return true;
            case CommandIds.GOLDEN_OPENING:
                new GoldenOpeningModal(app, plugin).open();
                return true;
            case CommandIds.STEP_RESULT_VIEWER:
                new StepResultViewerModal(app, plugin).open();
                return true;
            case CommandIds.STORY_LINKAGE_BOARD:
                new StoryLinkageModal(app, plugin).open();
                return true;
            case CommandIds.EXPORT_MANUSCRIPT:
                new ExportManuscriptModal(app, plugin, plugin.getActiveProject() ?? '').open();
                return true;

            // ── 版本与项目 ──
            case CommandIds.RENAME_PROJECT: {
                const project = payload?.project
                    ?? this.deps.plugin.getActiveProject()
                    ?? this.deps.app.workspace.getActiveFile()?.path.split('/')[0];
                if (!project) {
                    new Notice('请先打开项目中的文件');
                    return true;
                }
                new RenameProjectModal(this.deps.app, project).open();
                return true;
            }
            case CommandIds.VERSION_HISTORY:
                this.openVersionHistory(payload?.versionContext ?? null);
                return true;

            // ── 视图类 ──
            case CommandIds.FULL_WRITER:
                await plugin.openFullWriterHome();
                return true;
            case CommandIds.CO_WRITING:
                await plugin.openCoWritingFromActiveContext();
                return true;

            default:
                return false;
        }
    }

    // ─── 版本历史 ───

    private openVersionHistory(ctx: VersionFileContext | null): void {
        if (!ctx) {
            new Notice('请先打开一个 Markdown 文件');
            return;
        }
        const service = this.deps.getVersionService();
        if (!service) {
            new Notice('⚠️ 版本服务未就绪，请稍后重试');
            return;
        }
        const modal = new ChapterVersionModal(this.deps.app, {
            project: ctx.project,
            contentType: ctx.contentType,
            contentKey: ctx.contentKey,
            sourcePath: ctx.sourcePath,
            currentContent: ctx.content,
            onSaveVersion: async () => service.saveVersion(
                ctx.project,
                ctx.contentType,
                ctx.contentKey,
                ctx.sourcePath,
                ctx.content,
                { type: 'manual' },
            ),
            onRollback: async (version) => {
                const activeFile = this.deps.app.workspace.getActiveFile();
                const currentContent = activeFile ? await this.deps.app.vault.read(activeFile) : '';
                await service.rollbackToVersion(version, currentContent);
            },
        }, this.deps.plugin.engineRegistry);
        modal.open();
    }

    // ─── 视图与编辑器选区 ───

    private async openFingerprintLibrary(): Promise<void> {
        const { workspace } = this.deps.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_WRITING_FINGERPRINT);
        let leaf: ReturnType<typeof workspace.getLeaf>;
        if (existing.length > 0) {
            leaf = existing[0];
            for (let i = 1; i < existing.length; i++) existing[i].detach();
        } else {
            leaf = workspace.getLeaf('tab');
        }
        await leaf.setViewState({ type: VIEW_TYPE_WRITING_FINGERPRINT, active: true });
        workspace.revealLeaf(leaf);
        new Notice('🔍 已打开写作指纹库');
    }

    private async openKnowledgeBase(): Promise<void> {
        const { workspace } = this.deps.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_BASE);
        let leaf: ReturnType<typeof workspace.getLeaf>;
        if (existing.length > 0) {
            leaf = existing[0];
            for (let i = 1; i < existing.length; i++) existing[i].detach();
        } else {
            leaf = workspace.getLeaf('tab');
        }
        await leaf.setViewState({ type: VIEW_TYPE_KNOWLEDGE_BASE, active: true });
        workspace.revealLeaf(leaf);
    }

    /** 取命令面板透传的 editor；缺省时回落到当前 Markdown 视图 */
    private resolveEditor(editor?: Editor): Editor | null {
        if (editor) return editor;
        const view = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
        return view?.editor ?? null;
    }

    private expandText(editor?: Editor): void {
        const activeEditor = this.resolveEditor(editor);
        if (!activeEditor) {
            new Notice('请先打开 Markdown 编辑器并选中需要扩写的段落');
            return;
        }
        const selectedText = activeEditor.getSelection();
        new ExpandTextModal(this.deps.app, this.deps.plugin, selectedText, activeEditor).open();
    }

    private outlineExpand(editor?: Editor): void {
        const activeEditor = this.resolveEditor(editor);
        if (!activeEditor) {
            new Notice('请先打开 Markdown 编辑器并选中需要扩写的段落');
            return;
        }
        const selectedText = activeEditor.getSelection();
        const allText = activeEditor.getValue();
        const sourceText = selectedText || allText;
        const modal = new OutlineExpandModal(this.deps.app, this.deps.plugin, sourceText, {
            mode: selectedText ? 'paragraph' : 'chapter',
            targetWords: 3000,
        });
        modal.open();
    }

    private rewriteSuggestion(editor?: Editor): void {
        const activeEditor = this.resolveEditor(editor);
        if (!activeEditor) {
            new Notice('请先打开 Markdown 编辑器并选中需要改写的文本');
            return;
        }
        new RewriteSuggestionModal(this.deps.app, this.deps.plugin, activeEditor, activeEditor.getSelection()).open();
    }

    /** 旧版正文命令弃用提示：保留至 v5.0.0，届时删除实现（见 docs/DEVELOPMENT.md） */
    private warnLegacyCommand(name: string): void {
        log.warn(`[小说工坊] 旧版正文命令被调用：${name}（计划于 v5.0.0 移除）`);
        if (this.legacyCommandWarned.has(name)) return;
        this.legacyCommandWarned.add(name);
        new Notice(`⚠️「${name}」属于旧版正文链路，计划于 v5.0.0 移除；请改用协同写作工作台`, 6000);
    }
}
