import { App, Modal, Notice, TFile } from 'obsidian';
import { ModalDirtyGuard } from '@/ui/components/modal-dirty-guard';
import { OperationConfirmModal } from '@/ui/components/progress/operation-confirm-modal';
import { t } from '@/i18n';
import NovelWriterPlugin from '@/main';
import { AIEngine } from '@/engine/ai-engine';
import { mkdirp } from '@/utils/helpers';
import { pjFanficDir, pjFanficPendingDir } from '@/shared/paths';
import { listFanficSettingCandidates } from '@/shared/fanfic-binding';
import {
    attachFanficPathToProject,
    buildFanficSettingsContent,
    createFanficDraftFromTemplate,
    ensureFanficTemplate,
    fanficSettingsFileName,
    isFanficSettingsContentValidEnough,
    saveFanficSettingFile,
} from './full-writer/fanfic-settings-utils';
import { CanonResearchService } from '@/services/canon-research-service';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from './components/notice-helpers';
import {
    CanonSource,
    CanonSourceTier,
    CANON_TIER_LABEL,
    computeCanonSourceHash,
    formatCanonSourcesForPrompt,
    selectAuthoritativeSources,
    validateCanonSources,
} from '@/shared/canon-source';
import { applyFanficReviewMeta, auditFanficSettings } from '@/shared/fanfic-audit';
import { FanficReviewModal } from './fanfic-review-modal';
import { computeConstraintFlowStatus, renderLinkStatus } from './views/link-status';
import { filterDegradationsBySource, getDegradationNotifier } from '@/shared/degradation-notifier';
import { formatFanficRulesForPrompt, readFanficRules } from '@/shared/fanfic-rules';
import { retrieve } from '@/engine/rag/retrieval-service';
import {
    buildKnowledgeDraftPrompt,
    buildVerificationPrompt,
    parseVerificationReport,
    verdictOf,
    applyVerificationMeta,
    verificationVerdictLabel,
    type KnowledgeMaterial,
} from '@/services/fanfic-knowledge-draft';

import { createLogger } from '@/shared/logger';

const log = createLogger('AddFanficSettingModal');

/**
 * AddFanficSettingModal 类。
 */
export class AddFanficSettingModal extends Modal {
    /** 未保存修改守卫（审计 A-5 / C#3）：作品名/来源摘录等输入在 Esc 时此前直接丢弃 */
    private dirtyGuard = new ModalDirtyGuard();
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
    /** 约束流链路状态容器（阶段 A4） */
    private linkStatusEl: HTMLElement | null = null;

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
        }
        contentEl.addClass('nw-entity-scope');
        contentEl.addClass('nw-form-stack');
        contentEl.empty();
        contentEl.createEl('h2', { text: t("addFanfic.common.k1"), attr: { style: 'margin:0; font-size:18px;' } });

        // 阶段 A4：约束流链路状态（考据 → 设定 → 审核 → 绑定 → 注入）。
        // 先占位，异步探测后填入——用户一进来就能看到「这条链路现在断在哪」。
        this.linkStatusEl = contentEl.createDiv({ cls: 'nw-u-marginbottom-12px' });
        void this.refreshLinkStatus();

        if (!this.project) {
            contentEl.createEl('p', {
                text: t("addFanfic.common.k2"),
                cls: 'setting-item-description',
            });
        }

        const nameInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: t("addFanfic.common.k3"),
            cls: 'nw-input novel-writer-input',
        });
        const typeInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: t("addFanfic.common.k4"),
            value: '玄幻',
            cls: 'nw-input novel-writer-input',
        });
        const authorInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: t("addFanfic.common.k5"),
            cls: 'nw-input novel-writer-input',
        });

        this.renderCanonSources(contentEl, nameInput, typeInput, authorInput);

        this.generateButton = contentEl.createEl('button', {
            text: t("addFanfic.common.k6"),
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
        });
        this.generateButton.onclick = async () => {
            const workName = nameInput.value.trim();
            const workType = typeInput.value.trim();
            const author = authorInput.value.trim();
            if (!workName) {
                new Notice(t("addFanfic.flow.needWorkName"), 5000);
                return;
            }
            await this.generateFanficSetting(workName, workType, author);
        };

        // v4.83.1 新流程：知识库拆解素材 → 生成草稿 → 联网验证 → 写入 _待审核
        const knowledgeButton = contentEl.createEl('button', {
            text: t("addFanfic.common.k7"),
            cls: 'nw-btn nw-btn-secondary',
            attr: {
                title: t("addFanfic.flow.knowledgeButtonHint"),
            },
        });
        knowledgeButton.onclick = async () => {
            const workName = nameInput.value.trim();
            const workType = typeInput.value.trim();
            const author = authorInput.value.trim();
            if (!workName) {
                new Notice(t("addFanfic.flow.needWorkName"), 5000);
                return;
            }
            await this.generateFromKnowledgeAndVerify(workName, workType, author);
        };

        if (this.project) {
            void ensureFanficTemplate(this.app, this.project).catch((error) => {
                log.warn('恢复同人设定模板失败:', error);
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
        section.createEl('h3', { text: t("addFanfic.ui.k1") });
        section.createEl('p', {
            text: t("addFanfic.ui.k2"),
            cls: 'nw-text-12-muted',
        });

        const form = section;
        const urlInput = form.createEl('input', {
            type: 'text',
            placeholder: t("addFanfic.ui.k3"),
            cls: 'nw-input',
        });
        const titleInput = form.createEl('input', {
            type: 'text',
            placeholder: t("addFanfic.ui.k4"),
            cls: 'nw-input',
        });
        const tierSelect = form.createEl('select', { cls: 'nw-select' });
        tierSelect.createEl('option', { value: 'auto', text: t("addFanfic.ui.k5") });
        tierSelect.createEl('option', { value: 'official', text: t("addFanfic.ui.k6") });
        tierSelect.createEl('option', { value: 'official-wiki', text: t("addFanfic.ui.k7") });
        tierSelect.createEl('option', { value: 'reference', text: t("addFanfic.ui.k8") });
        const excerptInput = form.createEl('textarea', {
            cls: 'nw-textarea nw-u-minh-48px',
            attr: { rows: '3', placeholder: t("addFanfic.ui.k9") },
        });
        excerptInput.addEventListener('input', () => this.dirtyGuard.markDirty());

        const row = form.createDiv({ cls: 'nw-flex-gap10-wrap' });
        const addBtn = row.createEl('button', { text: t("addFanfic.ui.k10"), cls: 'nw-btn nw-btn-secondary' });
        addBtn.onclick = async () => {
            const url = urlInput.value.trim();
            if (!url) {
                new Notice(t("addFanfic.flow.needUrl"), 4000);
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
                    new Notice(t("addFanfic.flow.sourceExists"), 3000);
                    return;
                }
                this.sources.push({ ...source, id: `S${this.sources.length + 1}` });
                urlInput.value = '';
                titleInput.value = '';
                excerptInput.value = '';
                this.renderSourceList();
            } catch (error) {
                showErrorNotice(error instanceof Error ? error.message : String(error), { title: t("addFanfic.ui.k11"), timeout: 8000 });
            } finally {
                addBtn.disabled = false;
            }
        };

        const searchBtn = row.createEl('button', { text: t("addFanfic.ui.k12"), cls: 'nw-btn nw-btn-secondary' });
        searchBtn.onclick = async () => {
            const workName = nameInput.value.trim();
            if (!workName) {
                new Notice(t("addFanfic.flow.needWorkNameForSearch"), 4000);
                return;
            }
            if (!this.project) {
                new Notice(t("addFanfic.flow.needProjectForResearch"), 5000);
                return;
            }
            searchBtn.disabled = true;
            searchBtn.textContent = t("addFanfic.flow.searching");
            try {
                const result = await this.sourceService.research(workName, {
                    project: this.project,
                    author: authorInput.value.trim(),
                    workType: typeInput.value.trim(),
                });
                this.sources = this.mergeSources(this.sources, result.sources);
                this.renderSourceList();
                for (const warning of result.warnings) showWarningNotice(warning, { timeout: 6000 });
                if (result.sources.length === 0) {
                    showWarningNotice(t("addFanfic.ui.k13"), { timeout: 7000 });
                }
            } catch (error) {
                showErrorNotice(error instanceof Error ? error.message : String(error), { title: t("addFanfic.ui.k14"), timeout: 8000 });
            } finally {
                searchBtn.disabled = false;
                searchBtn.textContent = t("addFanfic.ui.k12");
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
        // 来源数变化会影响约束流「考据」环节，顺手刷新链路状态
        void this.refreshLinkStatus();
        if (!this.sourceListEl || !this.sourceStatusEl) return;
        this.sourceListEl.empty();
        const authoritative = selectAuthoritativeSources(this.sources);
        const validation = validateCanonSources(this.sources);
        this.sourceStatusEl.setText(
            t("addFanfic.flow.sourceSummary", {
                total: this.sources.length,
                official: authoritative.length,
            }) +
            (validation.errors.length > 0 ? ` ${validation.errors.join('；')}` : '')
        );
        if (this.sources.length === 0) {
            this.sourceListEl.createEl('p', { text: t("addFanfic.ui.k15") });
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
            const remove = row.createEl('button', { text: t("addFanfic.ui.k16"), cls: 'nw-btn nw-btn-secondary' });
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
        section.createEl('h3', { text: t("addFanfic.ui.k17") });
        section.createEl('p', {
            text: t("addFanfic.ui.k18"),
            cls: 'nw-text-12-muted',
        });
        const row = section.createDiv({ cls: 'nw-flex-gap10-wrap' });
        const createBtn = row.createEl('button', {
            text: t("addFanfic.ui.k19"),
            cls: 'nw-btn nw-btn-secondary',
        });
        createBtn.onclick = async () => {
            if (!this.project) return;
            const workName = nameInput.value.trim() || '新同人设定';
            try {
                const path = await createFanficDraftFromTemplate(this.app, this.project, workName);
                showSuccessNotice(t("addFanfic.flow.templateDraftCreated", { path }), { timeout: 6000 });
                new FanficReviewModal(this.app, this.plugin, this.project, path).open();
                // 草稿已生成并交给审核弹窗，本次编辑已产出结果，不再问「丢弃修改」
                this.dirtyGuard.markClean();
                this.close();
            } catch (error) {
                showErrorNotice(error instanceof Error ? error.message : String(error), { title: t("addFanfic.ui.k20"), timeout: 8000 });
            }
        };
        const restoreBtn = row.createEl('button', {
            text: t("addFanfic.ui.k21"),
            cls: 'nw-btn nw-btn-secondary',
        });
        restoreBtn.onclick = async () => {
            if (!this.project) return;
            try {
                const path = await ensureFanficTemplate(this.app, this.project);
                showSuccessNotice(t("addFanfic.flow.templateEnsured", { path }), { timeout: 5000 });
            } catch (error) {
                showErrorNotice(error instanceof Error ? error.message : String(error), { title: t("addFanfic.ui.k22"), timeout: 8000 });
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

        contentEl.createEl('h3', { text: t("addFanfic.flow.pendingTitle", { count: files.length }) });
        const hint = contentEl.createEl('p', { text: t("addFanfic.ui.k23") });
        hint.classList.add('setting-item-description');
        for (const file of files) {
            const row = contentEl.createDiv({ cls: 'nw-flex-row-sm' });
            row.createSpan({ text: file.basename, cls: 'nw-text-13-normal-flex' });
            const review = row.createEl('button', { text: t("addFanfic.ui.k24"), cls: 'nw-btn nw-btn-primary' });
            review.onclick = () => {
                new FanficReviewModal(this.app, this.plugin, this.project!, file.path, (approvedPath) => {
                    showSuccessNotice(t("addFanfic.flow.approvedTo", { path: approvedPath }), { timeout: 5000 });
                }).open();
                // 转入审核弹窗是用户主动动作：关闭本弹窗不再二次询问
                this.dirtyGuard.markClean();
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

        contentEl.createEl('h3', { text: t("addFanfic.ui.k25") });
        const hint = contentEl.createEl('p', { text: t("addFanfic.ui.k26"), cls: 'nw-text-12-muted' });

        let selectedPath = '';
        const picker = contentEl.createDiv({ cls: 'nw-card' });
        picker.addClass('nw-form-stack');
        const trigger = picker.createEl('button', {
            text: t("addFanfic.ui.k27"),
            cls: 'nw-input nw-u-w-100',
            attr: { type: 'button', 'aria-expanded': 'false' },
        });
        let listEl: HTMLElement | null = null;
        const closeList = () => {
            listEl?.remove();
            listEl = null;
            const selectedName = selectedPath
                ? selectedPath.split('/').pop()?.replace(/\.md$/i, '') || t("addFanfic.flow.selected")
                : t("addFanfic.ui.k27");
            trigger.setText(selectedName);
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

        const bindButton = contentEl.createEl('button', { text: t("addFanfic.ui.k28"), cls: 'nw-btn novel-writer-secondary-button' });
        bindButton.onclick = async () => {
            if (!selectedPath) {
                new Notice(t("addFanfic.flow.needSettingFile"), 4000);
                return;
            }
            const file = this.app.vault.getAbstractFileByPath(selectedPath);
            if (!(file instanceof TFile)) {
                showErrorNotice(t("addFanfic.ui.k29"), { timeout: 6000 });
                return;
            }
            let content = '';
            try {
                content = await this.app.vault.read(file);
            } catch {
                showErrorNotice(t("addFanfic.ui.k30"), { timeout: 6000 });
                return;
            }
            if (!content.trim()) {
                new Notice(t("addFanfic.flow.emptySettingFile"), 6000);
                return;
            }
            try {
                await attachFanficPathToProject(this.app, project, selectedPath);
            } catch (error) {
                showErrorNotice(error instanceof Error ? error.message : String(error), { title: t("addFanfic.ui.k31"), timeout: 8000 });
                return;
            }
            const check = isFanficSettingsContentValidEnough(content);
            if (check.valid) {
                showSuccessNotice(t("addFanfic.flow.boundToProject", { file: file.basename, project }), { timeout: 6000 });
            } else {
                showWarningNotice(t("addFanfic.flow.boundMissing", {
                    file: file.basename,
                    fields: check.missingFields.slice(0, 5).join('、'),
                }), { timeout: 10000 });
            }
            // 绑定已生效（用户主动完成动作），关闭不再二次询问
            this.dirtyGuard.markClean();
            this.close();
        };
    }

    /**
     * 刷新约束流链路状态（阶段 A4）。
     *
     * 探测失败一律按「未就绪」处理：链路状态区块本身不能因为探测异常而消失，
     * 否则用户看到的是一片空白，比显示「断」更糟。
     */
    private async refreshLinkStatus(): Promise<void> {
        if (!this.linkStatusEl) return;

        let settingExists = false;
        let reviewStatus: 'approved' | 'pending' | 'rejected' | 'legacy' | 'none' = 'none';
        let bound = false;
        let rulesHasContent = false;

        if (this.project) {
            try {
                const rules = await readFanficRules(this.app, this.project);
                bound = Boolean(rules.path);
                if (rules.path) {
                    // missing-file 说明 meta 里记着路径但文件没了，属于「设定不存在」
                    settingExists = rules.loadError !== 'missing-file';
                    reviewStatus = rules.reviewStatus ?? 'none';
                    rulesHasContent = formatFanficRulesForPrompt(rules).length > 0;
                }
            } catch (e) {
                log.warn('[AddFanficSettingModal] 链路状态探测失败:', e);
            }
        }

        // 清空放在 await 之后：onOpen 与 renderSourceList 都会触发刷新，
        // 两次调用会在 await 处交错，若在开头清空就会各追加一条横幅。
        this.linkStatusEl.empty();
        renderLinkStatus(this.linkStatusEl, computeConstraintFlowStatus({
            sourceCount: this.sources.length,
            settingExists,
            reviewStatus,
            bound,
            rulesHasContent,
            // 阶段 B1：约束流相关降级（考据抓取失败、注入回退等）
            degradations: filterDegradationsBySource(
                getDegradationNotifier().getEvents(),
                ['llm', 'injection'],
            ).map(event => event.reason),
        }));
    }

    /**
     * 从知识库拆解素材生成草稿，再用联网检索来源验证（v4.83.1）。
     *
     * 流程：检索知识库 → 生成草稿 → 联网检索来源 → 逐条核对 → 写入 _待审核。
     * 验证结论只写进 meta，**不自动通过审核**——人工审核仍是唯一放行口。
     *
     * @param workName - 原作名
     * @param workType - 作品类型
     * @param author - 作者
     */
    private async generateFromKnowledgeAndVerify(workName: string, workType: string, author: string): Promise<void> {
        if (!this.project) {
            new Notice(t("addFanfic.flow.needProject"), 6000);
            return;
        }
        if (!this.plugin.hasAiCredentials) {
            new Notice(t("addFanfic.flow.needCredentials"), 5000);
            return;
        }
        const store = this.plugin.knowledgeVectorStore;
        if (!store) {
            new Notice(t("addFanfic.flow.kbNotReady"), 8000);
            return;
        }

        const notice = new Notice(t("addFanfic.flow.retrievingMaterials"), 0);
        try {
            // 1) 检索知识库：用原作名做查询，覆盖全部已拆解书（不限定参考书范围）
            const retrieval = await retrieve(store, {
                queryText: `${workName} ${workType} ${author} 世界观 力量体系 人物 设定`.trim(),
                topN: 12,
                maxChars: 9000,
            });
            const materials: KnowledgeMaterial[] = retrieval.hits.map(hit => ({
                bookName: hit.bookName,
                dimension: hit.dimension,
                sample: hit.sample,
                score: hit.score,
            }));
            if (materials.length === 0) {
                notice.hide();
                showWarningNotice(
                    t("addFanfic.flow.noMaterials")
                    + (retrieval.error ? t("addFanfic.flow.retrievalErrorSuffix", { error: retrieval.error }) : ''),
                    { timeout: 10000 },
                );
                return;
            }

            // 2) 用素材生成草稿
            notice.setMessage(t("addFanfic.flow.materialsReady", { count: materials.length }));
            const skeleton = buildFanficSettingsContent({
                workName,
                workType: workType || '（待补充）',
                author: author || '未知',
                worldviewType: '（待核实：知识库素材未覆盖）',
                powerSystem: '（待核实：知识库素材未覆盖）',
                coreRules: '（待核实：知识库素材未覆盖）',
                mustFollow: '（待核实：知识库素材未覆盖）',
                adaptScope: '（待核实：知识库素材未覆盖）',
                redlines: '（待核实：知识库素材未覆盖）',
            });
            const draftPrompt = buildKnowledgeDraftPrompt(workName, skeleton, materials);
            const draftResult = await this.aiEngine.callAI(draftPrompt.system, draftPrompt.user, undefined, 0.3, 8192);
            if (draftResult.error) {
                notice.hide();
                showErrorNotice(draftResult.error, { title: t("addFanfic.common.k8"), timeout: 12000 });
                return;
            }
            if (!draftResult.content.trim()) {
                notice.hide();
                showErrorNotice(t("addFanfic.common.k9"), { timeout: 8000 });
                return;
            }

            // 3) 联网检索来源用于验证（失败不阻断：只跳过验证环节）
            notice.setMessage(t("addFanfic.flow.verifyingSources"));
            let sources = this.sources;
            let sourceError = '';
            try {
                const researched = await this.sourceService.research(workName, {
                    project: this.project,
                    author,
                    workType,
                });
                if (researched.sources.length > 0) {
                    sources = this.mergeSources(this.sources, researched.sources);
                    this.sources = sources;
                    this.renderSourceList();
                }
            } catch (error) {
                sourceError = error instanceof Error ? error.message : String(error);
            }

            // 4) 逐条核对
            notice.setMessage(t("addFanfic.flow.crossChecking"));
            const canonBlock = formatCanonSourcesForPrompt(sources);
            const verifyPrompt = buildVerificationPrompt(draftResult.content, canonBlock);
            const verifyResult = await this.aiEngine.callAI(verifyPrompt.system, verifyPrompt.user, undefined, 0.1, 4096);
            const report = parseVerificationReport(verifyResult.error ? '' : verifyResult.content);
            const verdict = verdictOf(report);

            // 5) 写 meta 并落盘到 _待审核
            const withMeta = applyVerificationMeta(draftResult.content, report, sources.length);
            const pendingContent = applyFanficReviewMeta(withMeta, {
                '审核状态': 'pending',
                '来源数量': String(selectAuthoritativeSources(sources).length),
                '来源哈希': computeCanonSourceHash(sources),
                '生成时间': new Date().toISOString(),
            });
            const targetDir = pjFanficPendingDir(this.project);
            await mkdirp(this.app, targetDir);
            const filePath = `${targetDir}/${fanficSettingsFileName(workName)}`;
            const existing = this.app.vault.getAbstractFileByPath(filePath);
            if (existing) {
                const overwrite = await OperationConfirmModal.confirm(this.app, {
                    title: t('common.confirmTitle'),
                    description: t("addFanfic.flow.overwriteConfirm", { path: filePath }),
                    cancelText: t('common.cancel'),
                });
                if (!overwrite) {
                    notice.hide();
                    return;
                }
            }
            await saveFanficSettingFile(this.app, filePath, pendingContent);
            notice.hide();

            const lines = [
                verificationVerdictLabel(verdict),
                t("addFanfic.flow.reportMaterials", { count: materials.length }),
                t("addFanfic.flow.reportSources", { count: sources.length }),
            ];
            if (report.contradicted.length > 0) {
                lines.push(t("addFanfic.flow.reportContradicted", { items: report.contradicted.slice(0, 3).join('；') }));
            }
            if (report.unverified.length > 0) {
                lines.push(t("addFanfic.flow.reportUnverified", { items: report.unverified.slice(0, 3).join('；') }));
            }
            if (sourceError) lines.push(t("addFanfic.flow.reportSourceFailed", { error: sourceError }));
            lines.push(t("addFanfic.flow.reportSavedPending"));

            if (verdict === 'fail') {
                showWarningNotice(lines.join('\n'), { timeout: 15000 });
            } else {
                showSuccessNotice(lines.join('\n'), { timeout: 12000 });
            }
        } catch (error) {
            notice.hide();
            showErrorNotice(error instanceof Error ? error.message : String(error), {
                title: t("addFanfic.common.k10"),
                timeout: 12000,
            });
        }
    }

    /**
     * 依据联网检索到的官方来源生成同人设定草稿（原有流程，v4.83.1 前既有）。
     *
     * @param workName - 原作名
     * @param workType - 作品类型
     * @param author - 作者
     */
    private async generateFanficSetting(workName: string, workType: string, author: string): Promise<void> {
        if (!this.project) {
            new Notice(t("addFanfic.flow.needProject"), 6000);
            return;
        }
        if (!this.plugin.hasAiCredentials) {
            new Notice(t("addFanfic.flow.needCredentials"), 5000);
            return;
        }
        const sourceCheck = validateCanonSources(this.sources);
        if (!sourceCheck.valid) {
            new Notice(t("addFanfic.flow.needCanonSources", { errors: sourceCheck.errors.join('；') }), 10000);
            return;
        }

        if (this.generateButton) {
            this.originalButtonText = this.generateButton.textContent || '';
            this.generateButton.disabled = true;
            this.generateButton.textContent = t("addFanfic.flow.generatingDraft");
        }
        const genNotice = new Notice(t("addFanfic.flow.generatingFromCanon", { work: workName }), 0);

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
                showErrorNotice(result.error, { title: t("addFanfic.common.k11"), timeout: 12000 });
                return;
            }
            if (!result.content.trim()) {
                showErrorNotice(t("addFanfic.common.k12"), { timeout: 8000 });
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
                const overwrite = await OperationConfirmModal.confirm(this.app, {
                    title: t('common.confirmTitle'),
                    description: t("addFanfic.flow.overwriteConfirm", { path: filePath }),
                    cancelText: t('common.cancel'),
                });
                if (!overwrite) return;
            }
            await saveFanficSettingFile(this.app, filePath, pendingContent);
            genNotice.hide();

            if (audit.overall === 'fail') {
                showWarningNotice(
                    t("addFanfic.flow.auditBlocked", {
                        issues: audit.issues.filter(i => i.severity === 'error').slice(0, 3).map(i => i.message).join('；'),
                    }),
                    { timeout: 12000 },
                );
            } else {
                showSuccessNotice(t("addFanfic.common.k13"), { timeout: 8000 });
            }

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) await this.plugin.safeOpenFile(file);
            new FanficReviewModal(this.app, this.plugin, this.project, filePath).open();
            // 设定已生成并落盘，交给审核弹窗；关闭主弹窗不再问「丢弃修改」
            this.dirtyGuard.markClean();
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