import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { mkdirp } from '../utils/helpers';
import { pjFanficDir, pjFanficPendingDir } from '../shared/paths';
import { listFanficSettingCandidates } from '../shared/fanfic-binding';
import {
    attachFanficPathToProject,
    buildFanficSettingsContent,
    createFanficDraftFromTemplate,
    ensureFanficTemplate,
    fanficSettingsFileName,
    isFanficSettingsContentValidEnough,
    saveFanficSettingFile,
} from './full-writer/fanfic-settings-utils';
import { CanonResearchService } from '../services/canon-research-service';
import {
    CanonSource,
    CanonSourceTier,
    CANON_TIER_LABEL,
    computeCanonSourceHash,
    formatCanonSourcesForPrompt,
    selectAuthoritativeSources,
    validateCanonSources,
} from '../shared/canon-source';
import { applyFanficReviewMeta, auditFanficSettings } from '../shared/fanfic-audit';
import { FanficReviewModal } from './fanfic-review-modal';

/**
 * AddFanficSettingModal 类。
 */
export class AddFanficSettingModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private generateButton: HTMLButtonElement | null = null;
    private originalButtonText = '';
    /** 有值时直接保存到该项目的同人设定库；无值时回退当前项目 */
    private project?: string;
    private sourceService: CanonResearchService;
    private sources: CanonSource[] = [];
    private sourceListEl: HTMLElement | null = null;
    private sourceStatusEl: HTMLElement | null = null;

    constructor(app: App, plugin: NovelWriterPlugin, project?: string) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.project = project || plugin.getActiveProject() || undefined;
        this.sourceService = new CanonResearchService(app, plugin);
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal-form');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.addClass('nw-entity-scope');
        contentEl.addClass('nw-form-stack');
        contentEl.empty();
        contentEl.createEl('h2', { text: '📚 添加同人设定', attr: { style: 'margin:0; font-size:18px;' } });

        if (!this.project) {
            contentEl.createEl('p', {
                text: '⚠️ 未检测到当前项目。请先从项目卡片或工作台进入，生成后的草稿才能进入人工审核并绑定。',
                cls: 'setting-item-description',
            });
        }

        const nameInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '作品名称（如：遮天、斗破苍穹）',
            cls: 'nw-input novel-writer-input',
        });
        const typeInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '作品类型（如：玄幻、仙侠、奇幻、科幻、都市）',
            value: '玄幻',
            cls: 'nw-input novel-writer-input',
        });
        const authorInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '作者（用于检索官方资料）',
            cls: 'nw-input novel-writer-input',
        });

        this.renderCanonSources(contentEl, nameInput, typeInput, authorInput);

        this.generateButton = contentEl.createEl('button', {
            text: '生成同人设定草稿',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        this.generateButton.onclick = async () => {
            const workName = nameInput.value.trim();
            const workType = typeInput.value.trim();
            const author = authorInput.value.trim();
            if (!workName) {
                new Notice('❌ 请输入作品名称', 5000);
                return;
            }
            await this.generateFanficSetting(workName, workType, author);
        };

        if (this.project) {
            void ensureFanficTemplate(this.app, this.project).catch((error) => {
                console.warn('[AddFanficSetting] 恢复同人设定模板失败:', error);
            });
            this.renderPendingSection(contentEl);
            this.renderTemplateSection(contentEl, nameInput);
            this.renderBindExistingSection(contentEl);
        }
    }

    private renderCanonSources(
        contentEl: HTMLElement,
        nameInput: HTMLInputElement,
        typeInput: HTMLInputElement,
        authorInput: HTMLInputElement,
    ): void {
        const section = contentEl.createDiv({ cls: 'nw-card' });
        section.addClass('nw-form-stack');
        section.createEl('h3', { text: '📚 原作资料来源（必须为官方/原著）' });
        section.createEl('p', {
            text: '同人设定只参考原著/官方资料，不参考同人、改编、外传等衍生作品。没有来源的字段会写成“待核实”，不会让 AI 凭记忆编造。',
            cls: 'nw-text-12-muted',
        });

        const form = section;
        const urlInput = form.createEl('input', {
            type: 'text',
            placeholder: '官方资料 URL（作者/出版方/官方 Wiki）',
            cls: 'nw-input',
        });
        const titleInput = form.createEl('input', {
            type: 'text',
            placeholder: '来源标题（可选）',
            cls: 'nw-input',
        });
        const tierSelect = form.createEl('select', { cls: 'nw-select' });
        tierSelect.createEl('option', { value: 'auto', text: '来源类型：自动识别' });
        tierSelect.createEl('option', { value: 'official', text: '来源类型：官方原著（作者/出版方/授权文本）' });
        tierSelect.createEl('option', { value: 'official-wiki', text: '来源类型：官方 Wiki' });
        tierSelect.createEl('option', { value: 'reference', text: '来源类型：参考资料（不能单独作为事实依据）' });
        const excerptInput = form.createEl('textarea', {
            cls: 'nw-textarea nw-u-minh-48px',
            attr: { rows: '3', placeholder: '可选：粘贴官方原文短摘录（不填则尝试抓取页面）' },
        });

        const row = form.createDiv({ cls: 'nw-flex-gap10-wrap' });
        const addBtn = row.createEl('button', { text: '➕ 添加官方来源', cls: 'nw-btn nw-btn-secondary' });
        addBtn.onclick = async () => {
            const url = urlInput.value.trim();
            if (!url) {
                new Notice('请输入官方资料 URL', 4000);
                return;
            }
            addBtn.disabled = true;
            try {
                const source = await this.sourceService.addManualSource(
                    url,
                    titleInput.value.trim(),
                    excerptInput.value.trim(),
                );
                const chosenTier = tierSelect.value as CanonSourceTier | 'auto';
                if (chosenTier !== 'auto') source.tier = chosenTier;
                if (this.sources.some(item => item.url === source.url)) {
                    new Notice('该来源已存在', 3000);
                    return;
                }
                this.sources.push({ ...source, id: `S${this.sources.length + 1}` });
                urlInput.value = '';
                titleInput.value = '';
                excerptInput.value = '';
                this.renderSourceList();
            } catch (error) {
                new Notice(`添加来源失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            } finally {
                addBtn.disabled = false;
            }
        };

        const searchBtn = row.createEl('button', { text: '🌐 联网检索官方资料', cls: 'nw-btn nw-btn-secondary' });
        searchBtn.onclick = async () => {
            const workName = nameInput.value.trim();
            if (!workName) {
                new Notice('请先填写作品名称', 4000);
                return;
            }
            if (!this.project) {
                new Notice('请先打开一个项目，检索结果需要缓存到项目同人设定库', 5000);
                return;
            }
            searchBtn.disabled = true;
            searchBtn.textContent = '⏳ 检索中...';
            try {
                const result = await this.sourceService.research(workName, {
                    project: this.project,
                    author: authorInput.value.trim(),
                    workType: typeInput.value.trim(),
                });
                this.sources = this.mergeSources(this.sources, result.sources);
                this.renderSourceList();
                for (const warning of result.warnings) new Notice(warning, 6000);
                if (result.sources.length === 0) {
                    new Notice('没有检索到可用官方来源；请手动添加官方 URL 或原文摘录', 7000);
                }
            } catch (error) {
                new Notice(`检索失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            } finally {
                searchBtn.disabled = false;
                searchBtn.textContent = '🌐 联网检索官方资料';
            }
        };

        this.sourceStatusEl = form.createDiv({ cls: 'nw-text-12-muted' });
        this.sourceListEl = form.createDiv({ cls: 'nw-card' });
        this.renderSourceList();
    }

    private mergeSources(existing: CanonSource[], incoming: CanonSource[]): CanonSource[] {
        const byUrl = new Map(existing.map(source => [source.url, source]));
        for (const source of incoming) {
            if (!byUrl.has(source.url)) byUrl.set(source.url, source);
        }
        return [...byUrl.values()].map((source, index) => ({ ...source, id: `S${index + 1}` }));
    }

    private renderSourceList(): void {
        if (!this.sourceListEl || !this.sourceStatusEl) return;
        this.sourceListEl.empty();
        const authoritative = selectAuthoritativeSources(this.sources);
        const validation = validateCanonSources(this.sources);
        this.sourceStatusEl.setText(
            `已导入 ${this.sources.length} 条来源，其中官方可用 ${authoritative.length} 条。` +
            (validation.errors.length > 0 ? ` ${validation.errors.join('；')}` : '')
        );
        if (this.sources.length === 0) {
            this.sourceListEl.createEl('p', { text: '尚未导入来源。' });
            return;
        }
        for (const source of this.sources) {
            const row = this.sourceListEl.createDiv({ cls: 'nw-flex-row-sm' });
            row.addClass('nw-u-marginbottom-6px');
            const tier = CANON_TIER_LABEL[source.tier] || source.tier;
            row.createSpan({
                text: `[${source.id}] ${source.title} · ${tier}`,
                cls: source.tier === 'derivative' ? 'nw-text-error' : 'nw-text-12-muted',
            });
            const remove = row.createEl('button', { text: '移除', cls: 'nw-btn nw-btn-secondary' });
            remove.onclick = () => {
                this.sources = this.sources.filter(item => item.id !== source.id)
                    .map((item, index) => ({ ...item, id: `S${index + 1}` }));
                this.renderSourceList();
            };
        }
    }

    /** 模板区：模板丢失时可从元文件/内置骨架恢复，并直接复制成待审核草稿。 */
    private renderTemplateSection(contentEl: HTMLElement, nameInput: HTMLInputElement): void {
        const section = contentEl.createDiv({ cls: 'nw-card' });
        section.addClass('nw-form-stack');
        section.createEl('h3', { text: '📄 同人设定模板' });
        section.createEl('p', {
            text: '项目内会保留一份模板；模板丢失时用「从模板新建」自动恢复，不需要重新配置。',
            cls: 'nw-text-12-muted',
        });
        const row = section.createDiv({ cls: 'nw-flex-gap10-wrap' });
        const createBtn = row.createEl('button', {
            text: '📄 从模板新建空白设定',
            cls: 'nw-btn nw-btn-secondary',
        });
        createBtn.onclick = async () => {
            if (!this.project) return;
            const workName = nameInput.value.trim() || '新同人设定';
            try {
                const path = await createFanficDraftFromTemplate(this.app, this.project, workName);
                new Notice(`✅ 已从模板创建待审核草稿：${path}`, 6000);
                new FanficReviewModal(this.app, this.plugin, this.project, path).open();
                this.close();
            } catch (error) {
                new Notice(`创建模板草稿失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            }
        };
        const restoreBtn = row.createEl('button', {
            text: '♻️ 恢复项目模板',
            cls: 'nw-btn nw-btn-secondary',
        });
        restoreBtn.onclick = async () => {
            if (!this.project) return;
            try {
                const path = await ensureFanficTemplate(this.app, this.project);
                new Notice(`✅ 已确保模板存在：${path}`, 5000);
            } catch (error) {
                new Notice(`恢复模板失败：${error instanceof Error ? error.message : String(error)}`, 8000);
            }
        };
    }

    /** 待审核草稿单独列出；未通过审核前不进入可绑定候选。 */
    private renderPendingSection(contentEl: HTMLElement): void {
        if (!this.project) return;
        const dir = pjFanficPendingDir(this.project);
        const files = this.app.vault.getFiles()
            .filter(file => file.path.startsWith(`${dir}/`) && file.extension === 'md');
        if (files.length === 0) return;

        contentEl.createEl('h3', { text: `📝 待审核草稿（${files.length}）` });
        const hint = contentEl.createEl('p', { text: '生成后的设定必须先通过人工审核，才能绑定到项目。' });
        hint.classList.add('setting-item-description');
        for (const file of files) {
            const row = contentEl.createDiv({ cls: 'nw-flex-row-sm' });
            row.createSpan({ text: file.basename, cls: 'nw-text-13-normal-flex' });
            const review = row.createEl('button', { text: '审核', cls: 'nw-btn nw-btn-primary' });
            review.onclick = () => {
                new FanficReviewModal(this.app, this.plugin, this.project!, file.path, (approvedPath) => {
                    new Notice(`已通过审核：${approvedPath}`, 5000);
                }).open();
                this.close();
            };
        }
    }

    /** 「使用已有设定文件」：只列可绑定文件；工作目录（_待审核/_资料/_审核）已由候选筛选排除。 */
    private renderBindExistingSection(contentEl: HTMLElement): void {
        const project = this.project;
        if (!project) return;
        const candidates = listFanficSettingCandidates(
            this.app.vault.getMarkdownFiles().map(file => file.path),
            [pjFanficDir(project), '元文件/05-同人设定库'],
        );
        if (candidates.length === 0) return;

        contentEl.createEl('h3', { text: '🔗 使用已有设定文件' });
        const hint = contentEl.createEl('p', { text: '只允许绑定已通过人工审核的设定文件。', cls: 'nw-text-12-muted' });

        let selectedPath = '';
        const picker = contentEl.createDiv({ cls: 'nw-card' });
        picker.addClass('nw-form-stack');
        const trigger = picker.createEl('button', {
            text: '选择设定文件',
            cls: 'nw-input nw-u-w-100',
            attr: { type: 'button', 'aria-expanded': 'false' },
        });
        let listEl: HTMLElement | null = null;
        const closeList = () => {
            listEl?.remove();
            listEl = null;
            trigger.setText(selectedPath ? `${selectedPath.split('/').pop()?.replace(/\.md$/i, '') || '已选择'}` : '选择设定文件');
            trigger.setAttribute('aria-expanded', 'false');
        };
        trigger.onclick = () => {
            if (listEl) {
                closeList();
                return;
            }
            listEl = picker.createDiv({ cls: 'nw-card' });
            trigger.setAttribute('aria-expanded', 'true');
            for (const candidate of candidates) {
                const item = listEl.createEl('button', {
                    text: candidate.name,
                    cls: 'nw-btn nw-btn-secondary nw-u-w-100 nw-u-marginbottom-6px',
                });
                item.type = 'button';
                item.onclick = () => {
                    selectedPath = candidate.path;
                    closeList();
                };
            }
        };

        const bindButton = contentEl.createEl('button', { text: '绑定所选文件', cls: 'nw-btn novel-writer-secondary-button' });
        bindButton.onclick = async () => {
            if (!selectedPath) {
                new Notice('请先选择设定文件', 4000);
                return;
            }
            const file = this.app.vault.getAbstractFileByPath(selectedPath);
            if (!(file instanceof TFile)) {
                new Notice('❌ 文件不存在，可能已被移动或删除', 6000);
                return;
            }
            let content = '';
            try {
                content = await this.app.vault.read(file);
            } catch {
                new Notice('❌ 读取设定文件失败', 6000);
                return;
            }
            if (!content.trim()) {
                new Notice('❌ 设定文件为空，无法绑定', 6000);
                return;
            }
            try {
                await attachFanficPathToProject(this.app, project, selectedPath);
            } catch (error) {
                new Notice(error instanceof Error ? error.message : String(error), 8000);
                return;
            }
            const check = isFanficSettingsContentValidEnough(content);
            if (check.valid) {
                new Notice(`✅ 已绑定「${file.basename}」到项目「${project}」`, 6000);
            } else {
                new Notice(`⚠️ 已绑定「${file.basename}」，但缺少：${check.missingFields.slice(0, 5).join('、')}。建议补全后重新审核。`, 10000);
            }
            this.close();
        };
    }

    private async generateFanficSetting(workName: string, workType: string, author: string): Promise<void> {
        if (!this.project) {
            new Notice('请先打开一个项目；生成草稿必须进入项目待审核目录', 6000);
            return;
        }
        if (!this.plugin.hasAiCredentials) {
            new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000);
            return;
        }
        const sourceCheck = validateCanonSources(this.sources);
        if (!sourceCheck.valid) {
            new Notice(`❌ ${sourceCheck.errors.join('；')}。请先导入官方来源，不能凭模型记忆生成。`, 10000);
            return;
        }

        if (this.generateButton) {
            this.originalButtonText = this.generateButton.textContent || '';
            this.generateButton.disabled = true;
            this.generateButton.textContent = '⏳ 生成草稿中...';
        }
        const genNotice = new Notice(`⏳ 正在依据官方来源生成《${workName}》草稿...`, 0);

        try {
            const skeleton = buildFanficSettingsContent({
                workName,
                workType: workType || '（待补充）',
                author: author || '未知',
                worldviewType: '（待核实：未找到可靠原作来源）',
                powerSystem: '（待核实：未找到可靠原作来源）',
                coreRules: '（待核实：未找到可靠原作来源）',
                mustFollow: '（待核实：未找到可靠原作来源）',
                adaptScope: '（待核实：未找到可靠原作来源）',
                redlines: '（待核实：未找到可靠原作来源）',
            });

            const systemPrompt = `你是一个严谨的同人设定整理助手。你只能使用下面提供的官方原著资料，不能使用模型记忆，不能引用同人、改编、外传等衍生作品。

【硬性规则】
1. 严格保留下面骨架的 YAML frontmatter 键名、二级标题、加粗字段名和两张表格的列名。
2. 每个填写的内容后必须标注来源编号，例如 [S1]。
3. 资料中没有依据的字段写「待核实（未找到可靠原作来源）」，禁止猜测或编造。
4. 原作剧情时间线只写有来源的事件；故事背景时间线没有同人内容时保留占位。
5. 三条创作规则必须是单行完整句子，且不得超出原作资料能支持的范围。
6. 只输出完整文件内容，不要解释或代码块围栏。

【官方来源】
${formatCanonSourcesForPrompt(selectAuthoritativeSources(this.sources))}`;

            const userContent = `请为《${workName}》生成同人设定草稿。\n\n【文件骨架】\n${skeleton}`;
            const result = await this.aiEngine.callAI(systemPrompt, userContent, undefined, 0.4, 8192);
            if (result.error) {
                new Notice(`❌ ${result.error}`, 12000);
                return;
            }
            if (!result.content.trim()) {
                new Notice('❌ 模型没有返回内容，未保存', 8000);
                return;
            }

            const pendingContent = applyFanficReviewMeta(result.content, {
                '审核状态': 'pending',
                '来源数量': String(selectAuthoritativeSources(this.sources).length),
                '来源哈希': computeCanonSourceHash(this.sources),
                '生成时间': new Date().toISOString(),
            });
            const audit = auditFanficSettings(pendingContent, this.sources, { requireApproved: false });

            const targetDir = pjFanficPendingDir(this.project);
            await mkdirp(this.app, targetDir);
            const filePath = `${targetDir}/${fanficSettingsFileName(workName)}`;
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing) {
                const overwrite = window.confirm(`「${filePath}」已存在，覆盖待审核草稿？`);
                if (!overwrite) return;
            }
            await saveFanficSettingFile(this.app, filePath, pendingContent);
            genNotice.hide();

            if (audit.overall === 'fail') {
                new Notice(
                    `⚠️ 草稿已保存，但规则审核发现阻断问题：${audit.issues.filter(i => i.severity === 'error').slice(0, 3).map(i => i.message).join('；')}`,
                    12000,
                );
            } else {
                new Notice('✅ 草稿已保存到「_待审核」，请在审核页逐项核对后通过', 8000);
            }

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) await this.plugin.safeOpenFile(file);
            new FanficReviewModal(this.app, this.plugin, this.project, filePath).open();
            this.close();
        } finally {
            genNotice.hide();
            if (this.generateButton) {
                this.generateButton.disabled = false;
                this.generateButton.textContent = this.originalButtonText;
            }
        }
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}