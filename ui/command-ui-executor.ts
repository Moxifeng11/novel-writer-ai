/**
 * command-ui-executor.ts — 命令的 UI 执行层
 *
 * 从 core/command-registry.ts 拆分而来：core 不再 import 任何 ui 模块，
 * 只按命令 id 委托本执行器。Modal 构造、视图打开、旧命令提示与编辑器选区
 * 读取都集中在这里。core 侧仅保留命令定义表、注册与无 UI 依赖的逻辑
 * （示例项目导入、信息债刷新、元素提取、版本保存等）。
 */

import { App, Editor, MarkdownView, Notice } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { CommandIds } from '@/shared/command-ids';
import type { CreationMode } from '@/shared/creation-mode';
import { getCreationModeLabel } from '@/shared/creation-mode';
import { COMMAND_MODE_LABELS, commandAllowedModes } from '@/shared/command-mode-rules';
import { resolveProjectMode } from '@/shared/project-mode';
import type { CommandUiPayload, CommandUiPort, VersionFileContext } from '@/shared/command-ui-port';
import { createLogger } from '@/shared/logger';
import { getExecutionLedger } from '@/services/execution-ledger';
import type { ChapterVersionService } from '@/services/chapter-version-service';
import { ChapterVersionModal } from './chapter-version-modal';
import { RenameProjectModal } from './rename-project-modal';
import { CreateProjectModal } from './create-project-modal';
import { PreResearchModal } from './pre-research-modal';
import { ModeDocumentModal } from './mode-document-modal';
import { OperationConfirmModal } from './components/progress';
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



/**
 * CommandUiExecutorDeps 类型定义。
 */
export interface CommandUiExecutorDeps {
    app: App;
    plugin: NovelWriterPlugin;
    /**
     * 版本服务（由 main 从 engineRegistry 取，避免本模块依赖 engine-registry）
     *
      * @returns ChapterVersionService 或 null
     */
    getVersionService(): ChapterVersionService | null;
}

/**
 * CommandUiExecutor 类。
 */
export class CommandUiExecutor implements CommandUiPort {
    private readonly legacyCommandWarned = new Set<string>();

    constructor(private readonly deps: CommandUiExecutorDeps) {}

    /**
     * v4.20 实体链接迁移：扫描 → dry-run 预览 → 确认后写回。
     * 项目无关命令；未选项目时提示。
     */
    private async runEntityLinkMigration(project: string | undefined): Promise<void> {
        const { app } = this.deps;
        if (!project) {
            new Notice('请先选择一个项目（工作台项目卡或正文页）', 6000);
            return;
        }
        const { scanEntityLinkMigration, applyEntityLinkMigration } = await import('@/engine/entity-link-migrator');
        const plan = scanEntityLinkMigration(app, project);
        if (plan.changes.length === 0) {
            new Notice(`✅ 「${project}」共扫描 ${plan.scanned} 个实体，归属字段已是 wiki-link，无需迁移`, 6000);
            return;
        }
        const sample = plan.changes.slice(0, 6)
            .map((change: { entity: string; field: string; from: string; to: string | string[] }) => `${change.entity}·${change.field}: ${change.from} → ${Array.isArray(change.to) ? change.to.join('、') : change.to}`)
            .join('\n');
        const confirmed = await OperationConfirmModal.confirm(app, {
            title: '实体链接迁移（存量关系图谱化）',
            description: `扫描 ${plan.scanned} 个实体，发现 ${plan.changes.length} 处归属字段是纯字符串。\n\n${sample}

执行后这些字段将变为 wiki-link，出现在 Obsidian 关系图谱中。`,
            warning: '会直接修改实体文件 frontmatter（仅改动列出的字段）',
            confirmText: `执行迁移（${plan.changes.length} 处）`,
            cancelText: '取消',
        });
        if (!confirmed) return;
        const written = await applyEntityLinkMigration(app, project, plan);
        new Notice(`✅ 链接迁移完成：写入 ${written} 个实体文件，共 ${plan.changes.length} 处`, 8000);
    }

    /** 生成/刷新项目 Bases 看板 */
    private async runGenerateBases(project: string | undefined): Promise<void> {
        const { app } = this.deps;
        if (!project) {
            new Notice('请先选择一个项目（工作台项目卡或正文页）', 6000);
            return;
        }
        const ledger = getExecutionLedger();
        const runId = ledger.begin({ commandId: 'novel-writer-generate-bases', project, source: 'ui', label: '生成项目看板' });
        try {
            const { writeProjectBases } = await import('@/engine/note-properties-service');
            const written = await writeProjectBases(app, project);
            ledger.finish(runId, { status: 'done', detail: `已生成 ${written.length} 个看板` });
            new Notice(`✅ 已生成 ${written.length} 个看板到「${project}/.看板/」；可拖到右侧栏使用`, 7000);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            ledger.finish(runId, { status: 'failed', failure: message });
            new Notice(`生成看板失败：${message}`, 6000);
        }
    }

    /** 补齐分层标签（dry-run 预览 → 执行） */
    private async runTagMigration(project: string | undefined): Promise<void> {
        const { app } = this.deps;
        if (!project) {
            new Notice('请先选择一个项目（工作台项目卡或正文页）', 6000);
            return;
        }
        const { scanTagMigration, applyTagMigration } = await import('@/engine/note-properties-service');
        const changes = scanTagMigration(app, project);
        if (changes.length === 0) {
            new Notice(`✅ 「${project}」的笔记已含层级标签，无需迁移`, 5000);
            return;
        }
        const totalTags = changes.reduce((sum, change) => sum + change.add.length, 0);
        const sample = changes.slice(0, 8)
            .map((change) => `${change.path.split('/').pop()}：+${change.add.join('、')}`)
            .join('\n');
        const confirmed = await OperationConfirmModal.confirm(app, {
            title: '补齐分层标签（保留原标签）',
            description: `共 ${changes.length} 个文件、${totalTags} 个标签待追加。\n\n${sample}

层级标签让 Obsidian 标签面板折叠成组，并供 Bases 看板筛选。`,
            warning: '只追加 nw/* 标签，不会删除或改名任何现有标签',
            confirmText: `执行（${changes.length} 个文件）`,
            cancelText: '取消',
        });
        if (!confirmed) return;
        const result = await applyTagMigration(app, changes);
        new Notice(`✅ 标签迁移完成：写入 ${result.written} 个文件，追加 ${result.added} 个标签`, 7000);
    }

    /** 补齐笔记属性（dry-run 预览 → 执行，只补空值） */
    private async runPropertyCompletion(project: string | undefined): Promise<void> {
        const { app } = this.deps;
        if (!project) {
            new Notice('请先选择一个项目（工作台项目卡或正文页）', 6000);
            return;
        }
        const { scanPropertyCompletion, applyPropertyCompletion } = await import('@/engine/note-properties-service');
        const changes = scanPropertyCompletion(app, project);
        if (changes.length === 0) {
            new Notice(`✅ 「${project}」的笔记属性已完整`, 5000);
            return;
        }
        const totalProps = changes.reduce((sum, change) => sum + change.fill.length, 0);
        const sample = changes.slice(0, 8)
            .map((change) => `${change.path.split('/').pop()}：+${change.fill.map((item) => item.key).join('、')}`)
            .join('\n');
        const confirmed = await OperationConfirmModal.confirm(app, {
            title: '补齐笔记属性',
            description: `共 ${changes.length} 个文件、${totalProps} 个属性缺失。\n\n${sample}

补齐后原生属性面板与 Bases 看板才能完整显示。`,
            warning: '只补缺失的空属性，已有值一律不覆盖',
            confirmText: `执行（${changes.length} 个文件）`,
            cancelText: '取消',
        });
        if (!confirmed) return;
        const result = await applyPropertyCompletion(app, changes);
        new Notice(`✅ 属性补齐完成：写入 ${result.written} 个文件，补 ${result.filled} 个属性`, 7000);
    }

    /**
     * 模式守卫：命令只允许在对应项目类型下执行。
     * 返回 true 表示已拦截（调用方直接 return）。
     */
    private async isBlockedByMode(id: string, project: string | undefined): Promise<boolean> {
        const allowed = commandAllowedModes(id);
        if (!allowed || !project) return false;
        const mode = await resolveProjectMode(this.deps.app, project);
        if (allowed.includes(mode)) return false;

        const label = COMMAND_MODE_LABELS[id] || id;
        const expected = allowed.map(item => getCreationModeLabel(item)).join(' / ');
        new Notice(
            `「${label}」仅适用于${expected}项目；当前项目是${getCreationModeLabel(mode)}。`
            + `请切换到对应项目，或从「创作流程」进入。`,
            8000,
        );
        return true;
    }

    /**
     * 执行 UI 类命令。
     * 返回 false 表示该 id 不属于 UI 执行器，由调用方维持原有处理。
     * @param id - 标识
     * @param payload - 载荷
     * @returns 是否成功
     */
    async executeCommand(id: string, payload?: CommandUiPayload): Promise<boolean> {
        const { app, plugin } = this.deps;
        const resolveProject = (): string | undefined =>
            payload?.project
            ?? this.deps.plugin.getWorkbenchContext()?.project
            ?? this.deps.plugin.getActiveProject()
            ?? undefined;

        if (await this.isBlockedByMode(id, resolveProject())) return true;

        switch (id) {
            // ── 项目管理类 ──
            case CommandIds.CREATE_PROJECT:
                new CreateProjectModal(app, plugin).open();
                return true;
            case CommandIds.AGENT_GUIDE:
                void plugin.openAgentWorkbench();
                return true;
            case CommandIds.CREATE_SHORT:
                new PreResearchModal(app, plugin, 'short').open();
                return true;
            case CommandIds.CREATE_SCRIPT:
                new PreResearchModal(app, plugin, 'script').open();
                return true;
            case CommandIds.CREATION_FLOW:
                void plugin.openCreationFlow(resolveProject());
                return true;
            case CommandIds.WRITING_STATS:
                plugin.openWritingStats();
                return true;
            case CommandIds.TOGGLE_PET:
                plugin.toggleWritingPet();
                return true;
            case CommandIds.MIGRATE_ENTITY_LINKS:
                void this.runEntityLinkMigration(resolveProject());
                return true;
            case CommandIds.PROJECT_SIDE_PANEL:
                void plugin.openProjectSidePanel();
                return true;
            case CommandIds.GENERATE_BASES:
                void this.runGenerateBases(resolveProject());
                return true;
            case CommandIds.MIGRATE_NAMESPACE_TAGS:
                void this.runTagMigration(resolveProject());
                return true;
            case CommandIds.COMPLETE_PROPERTIES:
                void this.runPropertyCompletion(resolveProject());
                return true;
            case CommandIds.SHORT_RESEARCH: {
                const project = resolveProject();
                if (!project) {
                    new Notice('请先选择一个短篇项目');
                    return true;
                }
                new PreResearchModal(app, plugin, 'short', { project }).open();
                return true;
            }
            case CommandIds.SCRIPT_RESEARCH: {
                const project = resolveProject();
                if (!project) {
                    new Notice('请先选择一个剧本项目');
                    return true;
                }
                new PreResearchModal(app, plugin, 'script', { project }).open();
                return true;
            }
            case CommandIds.SHORT_STORY_CORE:
            case CommandIds.SHORT_OUTLINE:
            case CommandIds.SCRIPT_SCENE_BIBLE:
            case CommandIds.SCRIPT_OUTLINE:
            case CommandIds.SCRIPT_STORYBOARD: {
                const project = resolveProject();
                if (!project) {
                    new Notice('请先选择一个项目');
                    return true;
                }
                const config = id === CommandIds.SHORT_STORY_CORE
                    ? { mode: 'short' as const, kind: 'storyCore' as const }
                    : id === CommandIds.SHORT_OUTLINE
                        ? { mode: 'short' as const, kind: 'outline' as const }
                        : id === CommandIds.SCRIPT_SCENE_BIBLE
                            ? { mode: 'script' as const, kind: 'bible' as const }
                            : id === CommandIds.SCRIPT_OUTLINE
                                ? { mode: 'script' as const, kind: 'outline' as const }
                                : { mode: 'script' as const, kind: 'storyboard' as const };
                new ModeDocumentModal(app, plugin, config.mode, config.kind, project).open();
                return true;
            }
            case CommandIds.PLAN_BOOK:
                new PlanBookModal(app, plugin).open();
                return true;
            case CommandIds.VOLUME_INTRO:
                new VolumeIntroModal(app, plugin, plugin.getActiveProject() || undefined).open();
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
            case CommandIds.TARGETED_REVISION:
                // v4.25：通过工作台事件触发当前章的定向修订（闸门+备份+复检在 StepRunner 内）
                app.workspace.trigger('novel-writer:run-targeted-revision', {} as Record<string, never>);
                new Notice('已请求定向修订：请在写作工作台查看进度', 4000);
                return true;
            case CommandIds.QUALITY_DASHBOARD:
                new QualityDashboardModal(app, plugin).open();
                return true;
            case CommandIds.BATCH_CREATE:
                new BatchCreateModal(app, plugin, resolveProject()).open();
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
                new ExportManuscriptModal(app, plugin, resolveProject() ?? '').open();
                return true;
            case CommandIds.PRUNE_SESSIONS:
                // v4.34.0：手动会话清理；manual=true 忽略「启动时清理旧会话」开关
                void plugin.runSessionPrune(true);
                return true;

            // ── 版本与项目 ──
            case CommandIds.RENAME_PROJECT: {
                const project = payload?.project
                    ?? this.deps.plugin.getWorkbenchContext()?.project
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
            case CommandIds.OPEN_HOME:
                void plugin.openHomeView();
                return true;
            case CommandIds.JOB_CENTER:
                plugin.openJobCenter();
                return true;
            case CommandIds.PROJECT_HEALTH:
                plugin.openProjectHealth(resolveProject());
                return true;
            case CommandIds.ASSET_REGISTRY:
                plugin.openAssetRegistry(resolveProject());
                return true;
            case CommandIds.USAGE_LEDGER:
                plugin.openUsageLedger();
                return true;
            case CommandIds.BACKUP_CENTER:
                plugin.openBackupCenter(resolveProject());
                return true;
            case CommandIds.OPEN_ONBOARDING:
                plugin.openOnboarding();
                return true;
            case CommandIds.FULL_WRITER:
                await plugin.openFullWriterHome();
                return true;
            case CommandIds.CO_WRITING:
                await plugin.openCoWritingFromActiveContext();
                return true;

            // ── 设置 ──
            case CommandIds.OPEN_SETTINGS:
                plugin.openPluginSettings();
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
