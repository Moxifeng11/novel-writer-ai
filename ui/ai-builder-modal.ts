import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { ContextManager } from '@/engine/context-manager';
import { AIEngine } from '@/engine/ai-engine';
import { mkdirp } from '@/utils/helpers';
import { CHARACTER_BODY_SECTIONS } from '@/shared/format-constants';
import { validateCharacterOutput } from '@/shared/template-validator';
import { createLogger } from '@/shared/logger';
import { ProjectRenameService } from '@/services/project-rename-service';
import { validateProjectName } from '@/shared/project-name';

const log = createLogger('AiBuilderModal');
import {
    pjWorldview, pjSettingLib,
    pjCharsDir, pjFactionsDir, pjLocsDir, pjItemsDir,
    SUBDIR_CHARS,
} from '@/shared/paths';
import { saveEntities, type EntityKind } from '@/shared/entity-persistence';
import { ensureEntityIntegrity } from '@/shared/entity-integrity';
import { countProjectEntities } from '@/shared/entity-reader';
import { mergeFanficRequirement } from '@/shared/fanfic-rules';
import { readFanficPromptBlockWithNotice } from './fanfic-prompt-notice';
import { UnifiedEntityGenerateModal } from './unified-entity-generate-modal';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from './components/notice-helpers';

// ── 实体类型配置 ──
interface EntityTypeConfig {
    id: string;
    label: string;
    icon: string;
    folder: string;
    template: string;
    isFile: boolean;
    needName: boolean;
    description: string;
    /** 该类型拥有的实体分节（用于完整性检测） */
    sections: readonly string[];
    /** 对应 AIEngine 上的生成方法名，世界观类型可为 undefined */
    engineMethod: 'generateCharacters' | 'generateFaction' | 'generateLocation' | 'generateItem' | undefined;
}

// 批次 4：势力 / 地点 / 物品功法生成已统一到 unified-entity-generate-modal，
// 本仪表盘只保留世界观与角色创作入口（底部提供跳转按钮）。
const ENTITY_TYPES: EntityTypeConfig[] = [
    {
        id: 'worldview', label: '世界观总览', icon: '🌍', folder: '',
        template: '世界观总览模板.md', isFile: true, needName: false,
        description: '为项目创建世界观总览骨架/详细设定',
        sections: [], engineMethod: 'generateItem', // 世界观走独立流程
    },
    {
        id: 'character', label: '人物', icon: '👤', folder: SUBDIR_CHARS,
        template: '人物模板.md', isFile: false, needName: false,
        description: '批量生成角色卡（姓名/身份/动机/技能等）',
        sections: CHARACTER_BODY_SECTIONS, engineMethod: 'generateCharacters',
    },
];

// ── 实体保存映射：统一走 shared/entity-persistence ──
const ENTITY_KIND_BY_ID: Record<string, EntityKind | undefined> = {
    character: 'characters',
    faction: 'factions',
    location: 'locations',
    item: 'items',
};

const ENTITY_DIR_BY_KIND: Record<EntityKind, (project: string) => string> = {
    characters: pjCharsDir,
    factions: pjFactionsDir,
    locations: pjLocsDir,
    items: pjItemsDir,
};

// ── 视图状态 ──
type ViewMode = 'dashboard' | 'generation';

// ── 生成参数 ──
interface GenerateParams {
    count: number;
    prompt: string;
    name: string;
}

/**
 * AiBuilderModal 类。
 */
export class AiBuilderModal extends Modal {
    private plugin: NovelWriterPlugin;
    private contextManager: ContextManager;
    private aiEngine: AIEngine;
    private viewMode: ViewMode = 'dashboard';
    private selectedType: EntityTypeConfig | null = null;
    private selectedProject: string = '';
    private worldContent: string = '';
    private settingLibContent: string = '';
    private existingCounts: Record<string, number> = {};
    /** 项目数量：仅多项目时展示「← 切换项目」入口 */
    private projectCount = 0;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.contextManager = plugin.ctxManager;
        this.aiEngine = plugin.aiEngine;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl, modalEl } = this;
        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.addClass('novel-writer-modal');
        contentEl.addClass('novel-writer-ai-builder-modal');
        contentEl.addClass('nw-entity-scope');
        modalEl.addClass('novel-writer-ai-builder-modal-root');

        // Rev 184：原 96vw × 96vh 近乎全屏，改为带上限的自适应尺寸
        modalEl.style.width = 'min(1300px, 94vw)';
        modalEl.addClass('nw-modal-xl');
        modalEl.style.height = 'min(90vh, 900px)';
        modalEl.style.maxHeight = 'min(90vh, 900px)';
        modalEl.style.margin = '0 auto';
        modalEl.style.position = 'relative';

        // 异步初始化：检测项目数量决定入口
        (async () => {
            const projects = await this.contextManager.detectProjects();
            this.projectCount = projects.length;
            if (projects.length === 0) {
                this.renderEmptyState();
            } else if (projects.length === 1) {
                // 单项目：直接进入仪表盘
                this.selectedProject = projects[0];
                await this.loadWorldContent(projects[0]);
                this.renderDashboard();
            } else {
                // 多项目：展示增强型项目矩阵
                this.renderProjectMatrix(projects);
            }
        })();
    }

    // ─────── 空状态 ───────
    private renderEmptyState(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '✨ AI世界元素生成器' });
        const empty = contentEl.createDiv({ cls: 'novel-writer-ai-builder-empty' });
        empty.createEl('div', { text: '📂', cls: 'novel-writer-ai-builder-empty-icon' });
        empty.createEl('p', { text: '尚未创建任何项目', cls: 'novel-writer-ai-builder-empty-text' });
        empty.createEl('p', {
            text: '请先在「完整工作台」中创建小说项目。',
            cls: 'novel-writer-ai-builder-empty-hint',
        });
    }

    // ─────── 增强型项目矩阵 ───────
    private async renderProjectMatrix(projects?: string[]): Promise<void> {
        if (!projects) projects = await this.contextManager.detectProjects();
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '✨ AI世界元素生成器' });
        contentEl.createEl('p', {
            text: '选择项目进入世界元素管理，或直接在卡片上快速操作。',
            cls: 'novel-writer-ai-builder-subtitle',
        });

        const grid = contentEl.createDiv({ cls: 'novel-writer-ai-builder-project-matrix' });

        for (const project of projects) {
            const stats = await this.getProjectEntityStats(project);
            const totalEntities = stats.characters + stats.factions + stats.locations + stats.items;
            const hasWorldview = stats.worldview > 0;
            // 完成度：世界观(40%) + 实体填充(60%，每类最多15%)
            const entityFill = Math.min((totalEntities / 12) * 60, 60);
            const completion = Math.round((hasWorldview ? 40 : 0) + entityFill);

            const card = grid.createDiv({ cls: 'novel-writer-ai-builder-project-bigcard' });

            // 卡片头部：项目名称 + 完成度
            const header = card.createDiv({ cls: 'novel-writer-ai-builder-bigcard-header' });
            const nameRow = header.createDiv({ cls: 'novel-writer-ai-builder-bigcard-namerow' });
            nameRow.createSpan({ text: '📁', cls: 'novel-writer-ai-builder-bigcard-folder' });
            nameRow.createEl('h3', { text: project, cls: 'novel-writer-ai-builder-bigcard-title' });

            const progressWrap = header.createDiv({ cls: 'novel-writer-ai-builder-bigcard-progress' });
            const progressBar = progressWrap.createDiv({ cls: 'novel-writer-ai-builder-bigcard-progress-bar' });
            const progressFill = progressBar.createDiv({ cls: 'novel-writer-ai-builder-bigcard-progress-fill' });
            progressFill.style.width = `${completion}%`;
            const progressLabel = progressWrap.createDiv({ cls: 'novel-writer-ai-builder-bigcard-progress-label' });
            progressLabel.setText(`${completion}%`);

            // 统计区：5 个实体类型的视觉化计数
            const statsArea = card.createDiv({ cls: 'novel-writer-ai-builder-bigcard-stats' });
            const statDefs = [
                { key: 'worldview', icon: '🌍', label: '世界观', count: stats.worldview },
                { key: 'characters', icon: '👤', label: '人物', count: stats.characters },
                { key: 'factions', icon: '🏰', label: '势力', count: stats.factions },
                { key: 'locations', icon: '📍', label: '地点', count: stats.locations },
                { key: 'items', icon: '⚔️', label: '物品', count: stats.items },
            ];
            for (const sd of statDefs) {
                const box = statsArea.createDiv({ cls: 'novel-writer-ai-builder-bigcard-statbox' });
                box.createDiv({ text: sd.icon, cls: 'novel-writer-ai-builder-bigcard-stat-icon' });
                box.createDiv({ text: String(sd.count), cls: 'novel-writer-ai-builder-bigcard-stat-num' });
                box.createDiv({ text: sd.label, cls: 'novel-writer-ai-builder-bigcard-stat-label' });
                if (sd.count > 0) box.addClass('has-content');
            }

            // 操作区
            const actions = card.createDiv({ cls: 'novel-writer-ai-builder-bigcard-actions' });

            // 进入按钮（主操作）
            const enterBtn = actions.createEl('button', {
                text: '进入项目 →',
                cls: 'novel-writer-ai-builder-bigcard-btn primary',
            });
            enterBtn.onclick = () => {
                this.selectedProject = project;
                this.loadWorldContent(project).then(() => this.renderDashboard());
            };

            // 快速操作：如果没有世界观，显示生成世界观
            if (!hasWorldview) {
                const quickBtn = actions.createEl('button', {
                    text: '🌍 生成世界观',
                    cls: 'novel-writer-ai-builder-bigcard-btn',
                });
                quickBtn.onclick = async () => {
                    this.selectedProject = project;
                    await this.loadWorldContent(project);
                    const wvCfg = ENTITY_TYPES.find(c => c.id === 'worldview');
                    if (wvCfg) this.openGenerationPanel(wvCfg);
                };
            } else if (totalEntities === 0) {
                const quickBtn = actions.createEl('button', {
                    text: '👤 批量生成人物',
                    cls: 'novel-writer-ai-builder-bigcard-btn',
                });
                quickBtn.onclick = async () => {
                    this.selectedProject = project;
                    await this.loadWorldContent(project);
                    const charCfg = ENTITY_TYPES.find(c => c.id === 'character');
                    if (charCfg) this.openGenerationPanel(charCfg, 'batch');
                };
            }

            // 卡片整体可点击进入
            card.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).tagName === 'BUTTON') return;
                this.selectedProject = project;
                this.loadWorldContent(project).then(() => this.renderDashboard());
            });
        }
    }

    // ─────── 获取项目实体统计 ───────
    private async getProjectEntityStats(project: string): Promise<{
        worldview: number; characters: number; factions: number; locations: number; items: number;
    }> {
        // Rev 192：统计口径统一到 shared/entity-reader（原 entity-stats 已并入），避免各入口各自数文件
        return countProjectEntities(this.app, project);
    }

    // ─────── 加载世界观内容 ───────
    private async loadWorldContent(project: string): Promise<void> {
        this.worldContent = '';
        this.settingLibContent = '';
        try {
            const woPath = pjWorldview(project);
            const woFile = this.app.vault.getAbstractFileByPath(woPath);
            if (woFile) this.worldContent = await this.app.vault.read(woFile as TFile);
        } catch (e) { /* ignore */ }
        // 读取设定库
        try {
            const sf = this.app.vault.getAbstractFileByPath(pjSettingLib(project));
            if (sf instanceof TFile) {
                const raw = await this.app.vault.read(sf);
                // 设定库只有注释占位符时视为空
                if (raw.trim().replace(/<!--[\s\S]*?-->/g, '').trim().length > 0) {
                    this.settingLibContent = raw;
                }
            }
        } catch (e) { /* ignore */ }
        // 刷新统计数据
        this.existingCounts = await this.getProjectEntityStats(project);
    }

    // ═══════════════════════════════════════════
    // 仪表盘视图
    // ═══════════════════════════════════════════
    private async renderDashboard(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        this.viewMode = 'dashboard';
        this.selectedType = null;

        // 顶部面包屑
        const breadcrumb = contentEl.createDiv({ cls: 'novel-writer-ai-builder-breadcrumb' });
        // Rev 192：只有多项目时「切换项目」才可达；单项目下该按钮点了等于没反应
        if (this.projectCount > 1) {
            const backBtn = breadcrumb.createEl('button', {
                text: '← 切换项目',
                cls: 'novel-writer-ai-builder-back-btn',
            });
            backBtn.onclick = async () => {
                const projects = await this.contextManager.detectProjects();
                this.projectCount = projects.length;
                if (projects.length > 1) {
                    this.renderProjectMatrix(projects);
                } else {
                    new Notice('当前只有一个项目', 3000);
                }
            };
        }

        breadcrumb.createSpan({ text: `▸ ${this.selectedProject}`, cls: 'novel-writer-ai-builder-current' });

        // 标题区
        const header = contentEl.createDiv({ cls: 'novel-writer-ai-builder-header' });
        header.createEl('h2', { text: `✨ ${this.selectedProject} — 世界元素` });

        // 世界观状态提示
        this.renderWorldviewStatus(contentEl);

        // 实体类型卡片网格
        const cardGrid = contentEl.createDiv({ cls: 'novel-writer-ai-builder-card-grid' });

        for (const cfg of ENTITY_TYPES) {
            const count = this.existingCounts[cfg.id === 'worldview' ? 'worldview' : 'characters'] || 0;

            const card = cardGrid.createDiv({ cls: 'novel-writer-ai-builder-entity-card' });

            // 卡片头部
            const cardHeader = card.createDiv({ cls: 'novel-writer-ai-builder-card-header' });
            cardHeader.createSpan({ text: cfg.icon, cls: 'novel-writer-ai-builder-card-icon' });
            const info = cardHeader.createDiv({ cls: 'novel-writer-ai-builder-card-info' });
            info.createDiv({ text: cfg.label, cls: 'novel-writer-ai-builder-card-title' });
            info.createDiv({
                text: count > 0 ? `已有 ${count} 个` : '尚未生成',
                cls: `novel-writer-ai-builder-card-count ${count > 0 ? 'has-content' : ''}`,
            });

            // 卡片描述
            card.createDiv({ text: cfg.description, cls: 'novel-writer-ai-builder-card-desc' });

            // 卡片操作区
            const actions = card.createDiv({ cls: 'novel-writer-ai-builder-card-actions' });

            if (cfg.id === 'worldview') {
                if (count > 0) {
                    actions.createEl('button', {
                        text: '重新生成',
                        cls: 'novel-writer-ai-builder-action-btn warning',
                    }).onclick = (e) => {
                        e.stopPropagation();
                        this.openGenerationPanel(cfg);
                    };
                    actions.createEl('button', {
                        text: '打开文件',
                        cls: 'novel-writer-ai-builder-action-btn',
                    }).onclick = async (e) => {
                        e.stopPropagation();
                        const f = this.app.vault.getAbstractFileByPath(pjWorldview(this.selectedProject));
                        if (f) {
                            await this.plugin.safeOpenFile(f as TFile);
                        }
                    };
                } else {
                    actions.createEl('button', {
                        text: '生成世界观',
                        cls: 'novel-writer-ai-builder-action-btn primary',
                    }).onclick = (e) => {
                        e.stopPropagation();
                        this.openGenerationPanel(cfg);
                    };
                }
            } else {
                actions.createEl('button', {
                    text: '单个生成',
                    cls: 'novel-writer-ai-builder-action-btn primary',
                }).onclick = (e) => {
                    e.stopPropagation();
                    this.openGenerationPanel(cfg, 'single');
                };
                actions.createEl('button', {
                    text: '批量生成',
                    cls: 'novel-writer-ai-builder-action-btn',
                }).onclick = (e) => {
                    e.stopPropagation();
                    this.openGenerationPanel(cfg, 'batch');
                };
            }

            // 卡片整体点击：如果世界观且未生成、或者非世界观，点卡片也进入
            if (cfg.id === 'worldview' && count === 0) {
                card.style.cursor = 'pointer';
                card.addEventListener('click', () => this.openGenerationPanel(cfg));
            }
        }

        // 批次 4：势力 / 地点 / 物品功法已统一到独立实体生成器，这里只保留跳转入口
        const unifiedHint = contentEl.createDiv({
            cls: 'novel-writer-ai-builder-worldview-hint',
            text: '势力 / 地点 / 物品功法已统一到「实体生成器」，需要生成请前往：',
        });
        const unifiedBtn = unifiedHint.createEl('button', {
            text: '🏰 打开统一实体生成器',
            cls: 'novel-writer-ai-builder-action-btn primary',
        });
        unifiedBtn.onclick = () => {
            this.close();
            new UnifiedEntityGenerateModal(this.app, this.plugin, this.selectedProject).open();
        };
    }

    // ─────── 世界观状态提示 ───────
    private renderWorldviewStatus(container: HTMLElement): void {
        const statusBar = container.createDiv({ cls: 'novel-writer-ai-builder-worldview-status' });
        if (this.worldContent) {
            statusBar.addClass('has-worldview');
            statusBar.createSpan({ text: '✅ 世界观已就绪' });
            statusBar.createSpan({ text: ' — 生成实体将自动引用世界观设定', cls: 'novel-writer-ai-builder-worldview-hint' });
        } else {
            statusBar.addClass('no-worldview');
            statusBar.createSpan({ text: '⚠️ 尚未设定世界观' });
            statusBar.createSpan({ text: ' — 建议先生成世界观，以获得更连贯的实体设定', cls: 'novel-writer-ai-builder-worldview-hint' });
        }
    }

    // ═══════════════════════════════════════════
    // 生成面板（单选或批量）
    // ═══════════════════════════════════════════
    private openGenerationPanel(cfg: EntityTypeConfig, mode: 'single' | 'batch' = 'single'): void {
        this.selectedType = cfg;
        this.viewMode = 'generation';
        const { contentEl } = this;
        contentEl.empty();

        // 面包屑
        const breadcrumb = contentEl.createDiv({ cls: 'novel-writer-ai-builder-breadcrumb' });
        const backBtn = breadcrumb.createEl('button', {
            text: '← 返回仪表盘',
            cls: 'novel-writer-ai-builder-back-btn',
        });
        backBtn.onclick = () => this.loadWorldContent(this.selectedProject).then(() => this.renderDashboard());

        breadcrumb.createSpan({ text: `▸ ${cfg.icon} ${cfg.label}`, cls: 'novel-writer-ai-builder-current' });

        // 标题
        contentEl.createEl('h2', { text: `${cfg.icon} 生成${cfg.label}` });
        contentEl.createEl('p', { text: cfg.description, cls: 'novel-writer-ai-builder-subtitle' });

        if (cfg.id === 'worldview') {
            this.renderWorldviewForm(contentEl, cfg);
        } else if (mode === 'batch') {
            this.renderBatchForm(contentEl, cfg);
        } else {
            this.renderSingleForm(contentEl, cfg);
        }
    }

    // ─────── 世界观生成表单 ───────
    private renderWorldviewForm(container: HTMLElement, cfg: EntityTypeConfig): void {
        const form = container.createDiv({ cls: 'novel-writer-ai-builder-form' });

        // 世界名称
        form.createEl('label', { text: '世界名称', cls: 'novel-writer-ai-builder-label' });
        const worldNameInput = form.createEl('input', {
            type: 'text',
            placeholder: '如：九州大陆、星海纪元',
            cls: 'nw-input novel-writer-input',
            value: this.selectedProject,
        });

        // 题材
        form.createEl('label', { text: '题材倾向', cls: 'novel-writer-ai-builder-label' });
        const genreInput = form.createEl('input', {
            type: 'text',
            placeholder: '如：玄幻、仙侠、科幻',
            cls: 'nw-input novel-writer-input',
        });

        // 主题
        form.createEl('label', { text: '核心主题（可选）', cls: 'novel-writer-ai-builder-label' });
        const themeInput = form.createEl('input', {
            type: 'text',
            placeholder: '如：废柴逆袭、群雄争霸',
            cls: 'nw-input novel-writer-input',
        });

        // 自定义需求
        form.createEl('label', { text: '特殊需求（可选）', cls: 'novel-writer-ai-builder-label' });
        const customInput = form.createEl('textarea', {
            placeholder: '对世界观的特殊要求...',
            cls: 'nw-textarea novel-writer-textarea',
        });

        // 生成按钮
        const generateBtn = form.createEl('button', {
            text: '🚀 生成世界观',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        generateBtn.onclick = async () => {
            const worldName = worldNameInput.value.trim() || this.selectedProject;
            const genre = genreInput.value.trim();
            const theme = themeInput.value.trim();
            const custom = customInput.value.trim();

            if (!this.plugin.hasAiCredentials) {
                new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000);
                return;
            }

            const genNotice = new Notice('⏳ 正在生成世界观总览...', 0);
            try {
                // P1-4: generateWorldviewSkeleton 是 AIEngine 公有方法，无需 as any 强转
                const skeleton = await this.aiEngine.generateWorldviewSkeleton(
                    worldName, this.selectedProject, genre, theme, custom
                );
                if (!skeleton || skeleton.error) {
                    genNotice.hide();
                    showErrorNotice(skeleton?.error || '未知错误', { title: '世界观生成失败', timeout: 8000 });
                    return;
                }
                const content = skeleton.content || '';

                // 确认覆盖
                const savePath = pjWorldview(this.selectedProject);
                const existingFile = this.app.vault.getAbstractFileByPath(savePath);
                if (existingFile) {
                    const ok = window.confirm('世界观总览已存在，是否覆盖？');
                    if (!ok) { genNotice.hide(); return; }
                }

                const parentDir = savePath.substring(0, savePath.lastIndexOf('/'));
                if (!this.app.vault.getAbstractFileByPath(parentDir)) {
                    await mkdirp(this.app, parentDir);
                }
                if (existingFile instanceof TFile) {
                    await this.app.vault.modify(existingFile, content);
                } else {
                    await this.app.vault.create(savePath, content);
                }
                genNotice.hide();

                // ★ 从世界观内容中提取小说名称并自动重命名项目
                const nameMatch = content.match(/【项目名称】(.+?)【\/项目名称】/);
                if (nameMatch && nameMatch[1]?.trim()) {
                    const novelName = nameMatch[1].trim()
                        .replace(/[\\/:*?"<>|]/g, '')
                        .slice(0, 50);
                    const oldProjectPath = this.selectedProject;
                    const validation = validateProjectName(novelName, [oldProjectPath]);
                    if (!validation.valid) {
                        showWarningNotice(`AI 建议的项目名不可用：${validation.error}。保留原项目名「${oldProjectPath}」`, { timeout: 6000 });
                    } else if (validation.normalized !== oldProjectPath) {
                        try {
                            const result = await new ProjectRenameService(this.app).rename(oldProjectPath, validation.normalized);
                            if (result.warnings.length > 0) {
                                showSuccessNotice(`世界观已生成！项目已重命名；${result.warnings.join('；')}`, { timeout: 10000 });
                            } else {
                                showSuccessNotice(`世界观已生成！项目已自动命名为「${validation.normalized}」`, { timeout: 5000 });
                            }
                            this.selectedProject = result.newProject;
                        } catch (renameErr) {
                            log.warn('[小说工坊] 项目重命名失败:', renameErr);
                            showSuccessNotice('世界观已生成！项目名保持不变', { timeout: 5000 });
                        }
                    } else {
                        showSuccessNotice('世界观已生成！', { timeout: 5000 });
                    }
                } else {
                    showSuccessNotice('世界观已生成！', { timeout: 5000 });
                }

                // 刷新并返回仪表盘
                await this.loadWorldContent(this.selectedProject);
                this.renderDashboard();

                // 打开文件（使用重命名后的路径）
                const openPath = pjWorldview(this.selectedProject);
                const file = this.app.vault.getAbstractFileByPath(openPath);
                if (file) {
                    await this.plugin.safeOpenFile(file as TFile);
                }
            } catch (e) {
                genNotice.hide();
                showErrorNotice((e as { message?: string }).message || '未知错误', { title: '生成失败', timeout: 8000 });
            }
        };
    }

    // ─────── 单个实体生成表单 ───────
    private renderSingleForm(container: HTMLElement, cfg: EntityTypeConfig): void {
        const form = container.createDiv({ cls: 'novel-writer-ai-builder-form' });

        form.createEl('label', { text: `${cfg.label}名称`, cls: 'novel-writer-ai-builder-label' });
        const nameInput = form.createEl('input', {
            type: 'text',
            placeholder: `输入${cfg.label}名称`,
            cls: 'nw-input novel-writer-input',
        });

        if (cfg.id === 'character') {
            form.createEl('label', { text: '数量', cls: 'novel-writer-ai-builder-label' });
            const countInput = form.createEl('input', {
                type: 'number',
                placeholder: '人物数量',
                cls: 'nw-input novel-writer-input',
                value: '5',
            });
            (countInput as HTMLInputElement).min = '1';
            (countInput as HTMLInputElement).max = '20';

            form.createEl('label', { text: '人物描述提示词（可选）', cls: 'novel-writer-ai-builder-label' });
            const promptInput = form.createEl('textarea', {
                placeholder: '告诉AI你想要什么样的人物，如：主角是一个冷酷的杀手，有一个温柔的妹妹；反派是曾经的恩师...',
                cls: 'nw-textarea novel-writer-textarea',
            });

            const generateBtn = form.createEl('button', {
                text: '👤 生成人物',
                cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
            });
            generateBtn.onclick = async () => {
                const count = parseInt((countInput as HTMLInputElement).value) || 5;
                const prompt = (promptInput as HTMLTextAreaElement).value.trim();
                await this.doGenerateEntities(cfg, { count, prompt, name: '' });
            };
        } else {
            form.createEl('label', { text: '描述/定位（可选）', cls: 'novel-writer-ai-builder-label' });
            const descInput = form.createEl('textarea', {
                placeholder: `描述该${cfg.label}在故事中的作用/定位`,
                cls: 'nw-textarea novel-writer-textarea',
            });

            const generateBtn = form.createEl('button', {
                text: `${cfg.icon} 生成${cfg.label}`,
                cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
            });
            generateBtn.onclick = async () => {
                const name = (nameInput as HTMLInputElement).value.trim();
                if (!name) {
                    new Notice(`❌ 请输入${cfg.label}名称`, 3000);
                    return;
                }
                const desc = (descInput as HTMLTextAreaElement).value.trim();
                await this.doGenerateEntities(cfg, { count: 1, prompt: desc, name });
            };
        }
    }

    // ─────── 批量生成表单 ───────
    private renderBatchForm(container: HTMLElement, cfg: EntityTypeConfig): void {
        const form = container.createDiv({ cls: 'novel-writer-ai-builder-form' });

        form.createEl('label', { text: '生成数量', cls: 'novel-writer-ai-builder-label' });
        const countInput = form.createEl('input', {
            type: 'number',
            placeholder: '数量',
            cls: 'nw-input novel-writer-input',
            value: '3',
        });
        (countInput as HTMLInputElement).min = '1';
        (countInput as HTMLInputElement).max = '20';

        form.createEl('label', { text: '共同特征/要求（可选）', cls: 'novel-writer-ai-builder-label' });
        const batchPromptInput = form.createEl('textarea', {
            placeholder: cfg.id === 'character'
                ? '这批人物的共同特征，如：都是宗门弟子、都是反派势力成员...'
                : `这批${cfg.label}的共同特征...`,
            cls: 'nw-textarea novel-writer-textarea',
        });

        if (!this.worldContent) {
            form.createEl('label', { text: '题材倾向', cls: 'novel-writer-ai-builder-label' });
            const genreInput = form.createEl('input', {
                type: 'text',
                placeholder: '如：玄幻、仙侠',
                cls: 'nw-input novel-writer-input',
            });

            form.createEl('label', { text: '故事逻辑方针', cls: 'novel-writer-ai-builder-label' });
            const logicInput = form.createEl('input', {
                type: 'text',
                placeholder: '如：硬核设定',
                cls: 'nw-input novel-writer-input',
            });

            const generateBtn = form.createEl('button', {
                text: `${cfg.icon} 批量生成${cfg.label}`,
                cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
            });
            generateBtn.onclick = async () => {
                const count = parseInt((countInput as HTMLInputElement).value) || 3;
                const batchPrompt = (batchPromptInput as HTMLTextAreaElement).value.trim();
                const genre = (genreInput as HTMLInputElement).value.trim();
                const logic = (logicInput as HTMLInputElement).value.trim();
                const parts: string[] = [];
                if (genre) parts.push(`题材倾向：${genre}`);
                if (logic) parts.push(`故事逻辑方针：${logic}`);
                if (batchPrompt) parts.push(`批量生成要求：${batchPrompt}`);
                await this.doGenerateEntities(cfg, { count, prompt: parts.join('\n'), name: '' });
            };
        } else {
            const generateBtn = form.createEl('button', {
                text: `${cfg.icon} 批量生成${cfg.label}`,
                cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
            });
            generateBtn.onclick = async () => {
                const count = parseInt((countInput as HTMLInputElement).value) || 3;
                const batchPrompt = (batchPromptInput as HTMLTextAreaElement).value.trim();
                await this.doGenerateEntities(cfg, { count, prompt: batchPrompt ? `批量生成要求：${batchPrompt}` : '', name: '' });
            };
        }
    }

    // ═══════════════════════════════════════════
    // 核心生成逻辑
    // ═══════════════════════════════════════════

    private async doGenerateEntities(cfg: EntityTypeConfig, params: GenerateParams): Promise<void> {
        if (!this.plugin.hasAiCredentials) {
            new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000);
            return;
        }

        const folder = `${this.selectedProject}/${cfg.folder}`;
        await mkdirp(this.app, folder);

        const genNotice = new Notice(`⏳ 正在生成${cfg.label}...`, 0);

        try {
            if (cfg.id === 'character' || params.count > 1) {
                // 批量模式：使用 generateCharacters 或重复调用单个方法
                await this.generateBatch(cfg, params, genNotice);
            } else {
                // 单个模式
                await this.generateSingle(cfg, params, genNotice);
            }

            genNotice.hide();
            // 刷新统计
            await this.loadWorldContent(this.selectedProject);
            this.renderDashboard();
        } catch (e) {
            genNotice.hide();
            showErrorNotice((e as { message?: string }).message || '未知错误', { title: `${cfg.label}生成失败`, timeout: 8000 });
            log.error(`[小说工坊] ${cfg.label}生成失败:`, e);
        }
    }

    private async generateSingle(cfg: EntityTypeConfig, params: GenerateParams, genNotice: Notice): Promise<void> {
        let worldView = this.worldContent || '';
        let settingLib = this.settingLibContent || '';
        if (!worldView) {
            // 尝试重新加载
            await this.loadWorldContent(this.selectedProject);
            worldView = this.worldContent || '';
            settingLib = this.settingLibContent || '';
        }

        // 同人项目：原作核心设定与创作规则必须进入实体生成要求，
        // 否则人物/势力/地点会脱离原作体系，成为后续 OOC 检测的错误基准
        const fanficBlock = await readFanficPromptBlockWithNotice(this.app, this.selectedProject);
        const requirement = (extra?: string): string => mergeFanficRequirement(fanficBlock, extra);

        switch (cfg.engineMethod) {
            case 'generateCharacters': {
                const result = await this.aiEngine.generateCharacters(worldView, params.count || 1, requirement(params.prompt) || undefined, undefined, undefined, undefined, settingLib);
                if (result.error) throw new Error(result.error);
                await this.saveGeneratedContent(cfg, result.content, true);
                break;
            }
            case 'generateFaction': {
                const result = await this.aiEngine.generateFaction(worldView, params.name, requirement(params.prompt));
                if (result.error) throw new Error(result.error);
                await this.saveSingleContent(cfg, params.name, result.content);
                break;
            }
            case 'generateLocation': {
                const result = await this.aiEngine.generateLocation(worldView, params.name, requirement(params.prompt));
                if (result.error) throw new Error(result.error);
                await this.saveSingleContent(cfg, params.name, result.content);
                break;
            }
            case 'generateItem': {
                const result = await this.aiEngine.generateItem(worldView, params.name, requirement(params.prompt));
                if (result.error) throw new Error(result.error);
                await this.saveSingleContent(cfg, params.name, result.content);
                break;
            }
        }
    }

    private async generateBatch(cfg: EntityTypeConfig, params: GenerateParams, genNotice: Notice): Promise<void> {
        const n = Math.min(Math.max(params.count || 3, 1), 20);
        let worldView = this.worldContent || '';
        let settingLib = this.settingLibContent || '';

        // 同人项目：批量与单个走同一套约束注入，避免两条入口生成标准不一致
        const fanficBlock = await readFanficPromptBlockWithNotice(this.app, this.selectedProject);
        const requirement = (extra?: string): string => mergeFanficRequirement(fanficBlock, extra);

        // 人物批量：分批调用，每次最多2个，避免一次性生成太多导致截断/压缩
        if (cfg.engineMethod === 'generateCharacters') {
            let allContent = '';
            let generated = 0;
            let failedBatches = 0;
            while (generated < n) {
                const batchSize = Math.min(2, n - generated);
                genNotice.setMessage(`⏳ 正在生成角色 (${generated + 1}-${generated + batchSize}/${n})...`);
                const result = await this.aiEngine.generateCharacters(worldView, batchSize, requirement(params.prompt) || undefined, undefined, undefined, undefined, settingLib);
                if (result.error) {
                    log.warn(`[小说工坊] 第${generated + 1}批角色生成失败:`, result.error);
                    failedBatches += 1;
                    generated += batchSize;
                    continue;
                }
                allContent += (allContent ? '\n\n' : '') + result.content;
                generated += batchSize;
            }
            if (!allContent.trim()) {
                showErrorNotice(`${failedBatches} 个批次均未返回内容，详见控制台`, { title: `${cfg.label}生成失败`, timeout: 6000 });
                return;
            }
            await this.saveGeneratedContent(cfg, allContent, true);
            if (failedBatches > 0) {
                showWarningNotice(`${failedBatches} 个批次生成失败，其余结果已保存`, { timeout: 6000 });
            }
            return;
        }

        // 非人物类型（势力/地点/物品）批量：逐一调用引擎方法，确保每个都是完整的元文件
        // 使用与独立 Modal 完全一致的引擎方法，保证 frontmatter + 分节完整
        let saved = 0;
        const savedNames: string[] = [];
        // U7（技术审计）：批量单项失败（生成/保存）此前仅写日志用户不可见，收集清单供结束汇总
        const failures: string[] = [];

        const kind = ENTITY_KIND_BY_ID[cfg.id];
        if (!kind) {
            genNotice.hide();
            showErrorNotice(`不支持的实体类型：${cfg.label}`, { title: '生成失败', timeout: 6000 });
            return;
        }
        await mkdirp(this.app, ENTITY_DIR_BY_KIND[kind](this.selectedProject));

        for (let i = 0; i < n; i++) {
            genNotice.setMessage(`⏳ 正在生成${cfg.label} (${i + 1}/${n})...`);

            // 生成一个唯一的临时名称作为种子
            const seedName = `${cfg.label}${i + 1}_${Date.now()}`;
            let result;

            switch (cfg.engineMethod) {
                case 'generateFaction':
                    result = await this.aiEngine.generateFaction(worldView, seedName, requirement(params.prompt));
                    break;
                case 'generateLocation':
                    result = await this.aiEngine.generateLocation(worldView, seedName, requirement(params.prompt));
                    break;
                case 'generateItem':
                    result = await this.aiEngine.generateItem(worldView, seedName, requirement(params.prompt));
                    break;
                default:
                    throw new Error(`不支持的批量类型: ${cfg.engineMethod}`);
            }

            if (result.error) {
                log.warn(`[小说工坊] 批量第${i + 1}个${cfg.label}失败:`, result.error);
                failures.push(`第${i + 1}个（生成失败）`);
                continue;
            }

            // 从 AI 输出中提取实际名称
            const realName = this.extractName(result.content, cfg.label);

            // 统一落盘：同名不同内容另存副本，不覆盖已有实体
            const outcome = await saveEntities(this.app, this.selectedProject, kind, [
                { name: realName, content: result.content },
            ]);
            const savedAs = outcome.renamed[0]?.savedAs ?? realName;
            if (outcome.failed.length > 0) {
                log.warn(`[小说工坊] 保存${cfg.label}失败:`, outcome.failed[0].error);
                failures.push(`第${i + 1}个（${outcome.failed[0].error}）`);
            } else {
                saved++;
                savedNames.push(savedAs);
            }
        }

        genNotice.hide();
        // U7：失败项汇总反馈（截取前 5 个避免 Notice 过长，完整原因见控制台日志）
        if (failures.length > 0) {
            showWarningNotice(`批量完成：成功 ${saved}/${n} 个，失败 ${failures.length} 个（${failures.slice(0, 5).join('、')}${failures.length > 5 ? ' 等' : ''}），原因详见控制台`, { timeout: 10000 });
        } else if (saved > 0) {
            const nameList = savedNames.join('、');
            showSuccessNotice(`批量完成：${saved}/${n} 个 → ${this.selectedProject}\n${nameList}`, { timeout: 6000 });
        } else {
            showErrorNotice(`未能生成任何${cfg.label}`, { title: '批量生成失败', timeout: 6000 });
        }
    }

    // ─────── 保存单个实体 ───────
    private async saveSingleContent(cfg: EntityTypeConfig, name: string, content: string): Promise<void> {
        const kind = ENTITY_KIND_BY_ID[cfg.id];
        if (!kind) {
            showErrorNotice(`不支持的实体类型：${cfg.label}`, { title: '保存失败', timeout: 6000 });
            return;
        }
        await mkdirp(this.app, ENTITY_DIR_BY_KIND[kind](this.selectedProject));

        // 保存前完整性闭环：校验 → AI 补全一次 → 复检；不完整的不落盘
        const integrity = await ensureEntityIntegrity(kind, name, content, (req) =>
            this.aiEngine.repairEntity(kind, req.name, req.content, req.missingFields, this.worldContent || '')
        );
        if (!integrity.valid) {
            showErrorNotice(
                `「${name}」未通过完整性校验，未保存。缺少：${integrity.missingFields.slice(0, 5).join('、')}`,
                { title: '完整性校验失败', timeout: 8000 },
            );
            return;
        }

        const outcome = await saveEntities(this.app, this.selectedProject, kind, [{ name, content: integrity.content }]);
        if (outcome.failed.length > 0) {
            showErrorNotice(`「${name}」保存失败：${outcome.failed[0].error}`, { timeout: 6000 });
            return;
        }

        const savedAs = outcome.renamed[0]?.savedAs ?? name;
        const renamedHint = outcome.renamed.length > 0 ? `（同名已另存为「${savedAs}」）` : '';
        showSuccessNotice(`「${savedAs}」已保存到 ${this.selectedProject}${renamedHint}`);

        // 自动打开文件
        const file = this.app.vault.getAbstractFileByPath(`${this.selectedProject}/${cfg.folder}/${savedAs}.md`);
        if (file) {
            await this.plugin.safeOpenFile(file as TFile);
        }
    }

    // ─────── 保存批量实体（人物批量） ───────
    private async saveGeneratedContent(cfg: EntityTypeConfig, content: string, isBatch: boolean): Promise<void> {
        if (isBatch && cfg.id === 'character') {
            const kind = ENTITY_KIND_BY_ID[cfg.id];
            if (!kind) return;
            await mkdirp(this.app, ENTITY_DIR_BY_KIND[kind](this.selectedProject));

            // 人物批量：按 frontmatter 分割
            const blocks = content.split(/^(?=---\s*$)/m).filter(b => b.trim());
            if (blocks.length === 0) {
                showErrorNotice('未解析到任何角色卡（生成结果为空或不完整），未保存', { timeout: 6000 });
                return;
            }
            let saved = 0;
            let skipped = 0;
            for (const block of blocks) {
                const name = this.extractCharacterName(block);
                if (!name) {
                    log.warn('[小说工坊] 跳过无法提取姓名的角色片段');
                    skipped++;
                    continue;
                }

                // ★ 完整性验证门禁
                const trimmed = block.trim();
                const validation = validateCharacterOutput(trimmed);
                let finalBlock = trimmed;
                if (!validation.valid) {
                    log.warn(`[小说工坊] 角色「${name}」不完整，缺失: ${validation.missingFields.join(', ')}，启动修补...`);
                    const repaired = await this.repairCharacterBlock(cfg, name, validation.missingFields, 0);
                    if (repaired) finalBlock = repaired;
                    else {
                        skipped++;
                        continue;
                    }
                }

                const outcome = await saveEntities(this.app, this.selectedProject, kind, [
                    { name, content: finalBlock },
                ]);
                if (outcome.failed.length > 0) {
                    log.warn(`保存角色「${name}」失败:`, outcome.failed[0].error);
                    skipped++;
                } else {
                    saved++;
                }
            }
            const msg = `人物已保存：${saved} 个 → ${this.selectedProject}`;
            if (skipped > 0) {
                showWarningNotice(`${msg}；${skipped} 个角色不完整未输出（请重新生成）`, { timeout: 6000 });
            } else {
                showSuccessNotice(msg, { timeout: 6000 });
            }
        }
    }

    // ─────── 角色修补：针对缺失字段发起补充生成 ───────
    private async repairCharacterBlock(
        cfg: EntityTypeConfig,
        characterName: string,
        missingFields: string[],
        retryDepth: number,
    ): Promise<string | null> {
        // 最多重试 3 次；失败则放弃，不输出这个不完整的文件
        if (retryDepth >= 3) {
            log.warn(`[小说工坊] 角色「${characterName}」3次修补均失败，跳过不输出`);
            return null;
        }

        const yamlMissing = missingFields.filter(f => !f.startsWith('正文分节') && f !== 'YAML frontmatter 未闭合');
        const sectionMissing = missingFields.filter(f => f.startsWith('正文分节'));

        const repairSystem = `你是一个严格的人物卡生成器。你必须输出完整的 Markdown 格式人物卡，包含所有 YAML frontmatter 字段和所有正文分节。

【输出格式——不可违反】
---
tags: [人物]
姓名: ${characterName}
年龄:
身份:
核心动机:
核心驱动力_软肋:
习惯性小动作:
当前状态:
当前情绪:
性格标签:
金手指/特殊能力:
功法/技能树:
所属势力:
人物背景:
外貌特征:
当前目标:
---

# ${characterName}

## 确定性设定（已揭露，不可违背）
- 外貌：
- 核心性格：
- 关键背景：

## 不确定性（未解之谜 / 角色弧光）
- 内心矛盾：
- 隐藏秘密：
- 未来可能的成长方向：

## 与其他角色的互信息
- [[角色名]] : 关系描述

## 自信息事件储备（低概率但合理的惊喜行为）
- 可能做出的出人意料举动：
- 在极端压力下的可能反应：

## 功法/技能树
- 修为：
- 武技：
- 法术：

## 变更记录
- [初章] ${new Date().toISOString().slice(0, 10)} | 人物初设`;

        const repairPrompt = `请生成一个完整的人物卡。之前缺失的内容：

${
    yamlMissing.length > 0
        ? `缺失的 YAML 字段：${yamlMissing.join('、')}。必须全部填写，不得留空。`
        : '所有 YAML 字段已存在。'
}
${
    sectionMissing.length > 0
        ? `缺失的正文分节：${sectionMissing.join('、')}。必须全部输出。`
        : '所有正文分节已存在。'
}

直接输出完整的人物卡 Markdown，不要省略任何字段或分节。`;

        const result = await this.aiEngine.callAI(
            repairSystem,
            repairPrompt,
            this.plugin.settings.proModel,
            0.7,
            this.plugin.settings.maxOutput || 16384,
        );

        if (!result.error && result.content) {
            const trimmed = result.content.trim();
            const reval = validateCharacterOutput(trimmed);
            if (reval.valid) return trimmed;
            // 仍有缺失，继续重试
            return this.repairCharacterBlock(cfg, characterName, reval.missingFields, retryDepth + 1);
        }

        // AI 调用失败，继续重试
        return this.repairCharacterBlock(cfg, characterName, missingFields, retryDepth + 1);
    }

    // ──────────── 名称提取 ────────────
    private extractName(content: string, type: string): string {
        const fm = content.match(/^---\n([\s\S]*?)\n---/);
        if (fm) {
            const m = fm[1].match(/^(?:姓名|名称):\s*["']?(.+?)["']?(\n|$)/m);
            if (m) return m[1].trim();
        }
        const m2 = content.match(/^#\s+(.+)/m);
        if (m2) return m2[1].trim();
        return `${type}_${Date.now()}`;
    }

    private extractCharacterName(content: string): string {
        const nameMatch = content.match(/^姓名:\s*["']?(.+?)["']?\s*$/m);
        if (nameMatch) return nameMatch[1].trim();
        const titleMatch = content.match(/^#\s+(.+?)\s*$/m);
        if (titleMatch) return titleMatch[1].trim();
        const quotedMatch = content.match(/姓名:\s*"([^"]+)"/);
        if (quotedMatch) return quotedMatch[1].trim();
        return '';
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
