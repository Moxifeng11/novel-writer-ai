/**
 * fanfic-review-modal.ts — 同人设定人工审核与补全
 *
 * 硬门禁：
 * - 未通过审核的设定不能绑定项目；
 * - 审核页必须逐字段展示来源与问题，勾选全部检查项后才能通过；
 * - AI 只能辅助补全，且只能引用已选官方来源。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { CanonResearchService } from '../services/canon-research-service';
import { CanonSource, CANON_TIER_LABEL, computeCanonSourceHash } from '../shared/canon-source';
import {
    applyFanficReviewMeta,
    auditFanficSettings,
    buildFanficApprovalMeta,
    buildFanficCompletionPrompt,
    buildFanficAuditPrompt,
    FanficAuditResult,
} from '../shared/fanfic-audit';
import { extractFanficWorkName, saveFanficSettingFile, attachFanficPathToProject } from './full-writer/fanfic-settings-utils';
import { pjFanficApprovedFile, pjFanficAuditDir } from '../shared/paths';
import { createLogger } from '../shared/logger';

const log = createLogger('FanficReviewModal');

const REQUIRED_CHECKS = [
    '已核对所选来源为原著/官方资料',
    '未采用同人、改编、外传等衍生内容',
    '人物、力量体系、关键事件顺序与原作无冲突',
    '所有「待核实」字段已确认保留或补全',
];

/**
 * FanficReviewModal 类。
 */
export class FanficReviewModal extends Modal {
    private sources: CanonSource[] = [];
    private sourceService: CanonResearchService;
    private content = '';
    private audit: FanficAuditResult | null = null;
    private workName = '';
    private checks = REQUIRED_CHECKS.map(() => false);
    private reviewer = '';
    private busy = false;
    private completionPreview = '';
    private aiAuditText = '';

    constructor(
        app: App,
        private readonly plugin: NovelWriterPlugin,
        private readonly project: string,
        private readonly filePath: string,
        private readonly onApproved?: (approvedPath: string) => void,
    ) {
        super(app);
        this.sourceService = new CanonResearchService(app, plugin);
    }

    /**
     * onOpen 方法。
     */
    async onOpen(): Promise<void> {
        this.modalEl.addClass('nw-scope', 'nw-modal-lg');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-form-stack');
        await this.load();
    }

    private async load(): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(this.filePath);
        if (!(file instanceof TFile)) {
            this.renderFatal('同人设定文件不存在，可能已被移动或删除');
            return;
        }
        this.content = await this.app.vault.read(file);
        this.workName = extractFanficWorkName(this.content, this.project);
        const cached = await this.sourceService.loadCache(this.project, this.workName);
        this.sources = cached?.sources || [];
        this.audit = auditFanficSettings(this.content, this.sources, { requireApproved: false });
        this.render();
    }

    private renderFatal(message: string): void {
        this.contentEl.empty();
        this.contentEl.createEl('h2', { text: '同人设定审核' });
        this.contentEl.createEl('p', { text: message });
        this.contentEl.createEl('button', { text: '关闭', cls: 'nw-btn' }).onclick = () => this.close();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '🔍 同人设定人工审核' });
        contentEl.createEl('p', {
            text: `项目：${this.project} · 文件：${this.filePath}`,
            cls: 'setting-item-description',
        });

        if (!this.audit) return;
        this.renderStats(this.audit);
        this.renderIssues(this.audit);
        this.renderSources();
        this.renderChecklist();
        this.renderCompletion();
        this.renderActions();
    }

    private renderStats(audit: FanficAuditResult): void {
        const stats = contentDiv(this.contentEl, 'nw-flex-gap10-wrap');
        const items = [
            `审核状态：${audit.stats.reviewStatus}`,
            `来源：${audit.stats.authoritativeSourceCount}/${audit.stats.sourceCount} 官方`,
            `引用覆盖：${audit.stats.citationCoveragePct}%`,
            `待核实：${audit.stats.unresolvedCount}`,
            `时间线：${audit.stats.timelineRows} 行`,
        ];
        for (const item of items) stats.createSpan({ text: item, cls: 'nw-badge' });
    }

    private renderIssues(audit: FanficAuditResult): void {
        const section = contentDiv(this.contentEl, 'nw-card');
        section.createEl('h3', { text: '审核问题' });
        if (audit.issues.length === 0) {
            section.createEl('p', { text: '✅ 规则审核未发现阻断问题' });
            return;
        }
        const list = section.createEl('ul');
        for (const issue of audit.issues) {
            const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
            const line = issue.line ? `（第 ${issue.line} 行）` : '';
            const field = issue.field ? `[${issue.field}] ` : '';
            list.createEl('li', {
                text: `${icon} ${field}${issue.message}${line}${issue.suggestion ? ` —— ${issue.suggestion}` : ''}`,
            });
        }
        const aiBtn = section.createEl('button', {
            text: '🤖 AI 复核（只报告，不自动改）',
            cls: 'nw-btn nw-btn-secondary',
        });
        aiBtn.onclick = () => void this.runAiAudit(aiBtn);
        if (this.aiAuditText) {
            const pre = section.createEl('pre');
            pre.setText(this.aiAuditText);
        }
    }

    private async runAiAudit(button: HTMLButtonElement): Promise<void> {
        if (this.busy) return;
        if (!this.plugin.hasAiCredentials) {
            new Notice('请先配置 API 密钥或本地模型端点', 5000);
            return;
        }
        this.busy = true;
        button.disabled = true;
        button.textContent = '⏳ AI 复核中...';
        try {
            const prompt = buildFanficAuditPrompt(this.content, this.sources);
            const result = await this.plugin.aiEngine.callAI(prompt.system, prompt.user, undefined, 0.2, 4096);
            if (result.error) {
                new Notice(`AI 复核失败：${result.error}`, 8000);
                return;
            }
            this.aiAuditText = result.content || '（模型没有返回内容）';
            this.render();
        } finally {
            this.busy = false;
            this.updateApproveState();
        }
    }

    private renderSources(): void {
        const section = contentDiv(this.contentEl, 'nw-card');
        section.createEl('h3', { text: `官方资料来源（${this.sources.length}）` });
        if (this.sources.length === 0) {
            section.createEl('p', {
                text: '⚠️ 没有来源缓存。请先在「同人设定库 → 资料检索」导入官方来源，再生成/审核。',
            });
            return;
        }
        const list = section.createEl('ul');
        for (const source of this.sources) {
            const tier = CANON_TIER_LABEL[source.tier] || source.tier;
            list.createEl('li', {
                text: `[${source.id}] ${source.title} · ${tier} · ${source.url}`,
            });
        }
        section.createEl('p', {
            text: `来源哈希：${computeCanonSourceHash(this.sources)}`,
            cls: 'setting-item-description',
        });
    }

    private renderChecklist(): void {
        const section = contentDiv(this.contentEl, 'nw-card');
        section.createEl('h3', { text: '人工审核检查项（必须全部勾选）' });
        REQUIRED_CHECKS.forEach((label, index) => {
            const row = section.createEl('label', { cls: 'nw-flex-row-sm' });
            const input = row.createEl('input', { type: 'checkbox' });
            input.checked = this.checks[index];
            input.onchange = () => {
                this.checks[index] = input.checked;
                this.updateApproveState();
            };
            row.createSpan({ text: label });
        });

        const reviewerRow = contentDiv(section, 'nw-flex-row-sm');
        reviewerRow.createSpan({ text: '审核人：' });
        const input = reviewerRow.createEl('input', {
            type: 'text',
            cls: 'nw-input',
            attr: { placeholder: '姓名或笔名（可留空）' },
        });
        input.value = this.reviewer;
        input.oninput = () => { this.reviewer = input.value; };
    }

    private renderCompletion(): void {
        const section = contentDiv(this.contentEl, 'nw-card');
        section.createEl('h3', { text: '补全缺失字段' });
        section.createEl('p', {
            text: '补全只使用已选官方来源；没有依据的字段会保留“待核实”。补全后仍需重新人工审核。',
            cls: 'setting-item-description',
        });
        const button = section.createEl('button', {
            text: '🤖 AI 补全（仅官方来源）',
            cls: 'nw-btn nw-btn-secondary',
        });
        button.onclick = () => void this.runCompletion(button);
        if (this.completionPreview) {
            const preview = section.createEl('textarea', { cls: 'nw-textarea nw-u-minh-150px' });
            preview.value = this.completionPreview;
            preview.rows = 12;
            preview.oninput = () => { this.completionPreview = preview.value; };
            const save = section.createEl('button', {
                text: '💾 保存补全草稿（回到待审核）',
                cls: 'nw-btn nw-btn-primary',
            });
            save.onclick = () => void this.saveCompletion();
        }
    }

    private renderActions(): void {
        const actions = contentDiv(this.contentEl, 'nw-modal-footer');
        const cancel = actions.createEl('button', { text: '取消', cls: 'nw-btn' });
        cancel.onclick = () => this.close();

        const edit = actions.createEl('button', { text: '✏️ 打开文件编辑', cls: 'nw-btn nw-btn-secondary' });
        edit.onclick = async () => {
            const file = this.app.vault.getAbstractFileByPath(this.filePath);
            if (file instanceof TFile) {
                await this.plugin.safeOpenFile(file);
                new Notice('修改保存后请重新打开审核页', 5000);
            }
        };

        const reject = actions.createEl('button', { text: '退回修改', cls: 'nw-btn nw-btn-secondary' });
        reject.onclick = () => void this.reject();

        const approve = actions.createEl('button', {
            text: '✅ 通过并绑定项目',
            cls: 'nw-btn nw-btn-primary',
        });
        approve.dataset.role = 'fanfic-approve';
        approve.onclick = () => void this.approve();
        this.updateApproveState();
    }

    private updateApproveState(): void {
        const button = this.contentEl.querySelector<HTMLButtonElement>('[data-role="fanfic-approve"]');
        if (!button) return;
        const allChecked = this.checks.every(Boolean);
        const hasBlocking = (this.audit?.issues || []).some(issue => issue.severity === 'error');
        button.disabled = this.busy || !allChecked || hasBlocking;
        button.title = hasBlocking
            ? '存在阻断问题，请先补全/移除衍生来源'
            : !allChecked
                ? '请先勾选全部人工审核检查项'
                : '';
    }

    private async runCompletion(button: HTMLButtonElement): Promise<void> {
        if (this.busy || !this.audit) return;
        if (!this.plugin.hasAiCredentials) {
            new Notice('请先配置 API 密钥或本地模型端点', 5000);
            return;
        }
        const missing = this.audit.issues
            .filter(issue => issue.code === 'missing-field' || issue.code === 'timeline-empty')
            .map(issue => issue.field || issue.message);
        if (missing.length === 0) {
            new Notice('没有需要补全的缺失字段', 4000);
            return;
        }
        this.busy = true;
        button.disabled = true;
        button.textContent = '⏳ 补全中...';
        try {
            const prompt = buildFanficCompletionPrompt(this.content, missing, this.sources);
            const result = await this.plugin.aiEngine.callAI(
                prompt.system,
                prompt.user,
                undefined,
                0.3,
                8192,
            );
            if (result.error) {
                new Notice(`补全失败：${result.error}`, 8000);
                return;
            }
            this.completionPreview = result.content;
            this.render();
        } finally {
            this.busy = false;
            this.updateApproveState();
        }
    }

    private async saveCompletion(): Promise<void> {
        if (!this.completionPreview.trim()) return;
        const updated = applyFanficReviewMeta(this.completionPreview, {
            '审核状态': 'pending',
            '来源数量': String(this.sources.length),
            '来源哈希': computeCanonSourceHash(this.sources),
        });
        try {
            await saveFanficSettingFile(this.app, this.filePath, updated);
            this.content = updated;
            this.audit = auditFanficSettings(this.content, this.sources, { requireApproved: false });
            new Notice('已保存补全草稿；请重新审核', 5000);
            this.render();
        } catch (error) {
            new Notice(`保存失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        }
    }

    private async reject(): Promise<void> {
        const updated = applyFanficReviewMeta(this.content, { '审核状态': 'rejected' });
        try {
            await saveFanficSettingFile(this.app, this.filePath, updated);
            new Notice('已退回；文件保留在待审核目录', 5000);
            this.close();
        } catch (error) {
            new Notice(`退回失败：${error instanceof Error ? error.message : String(error)}`, 8000);
        }
    }

    private async approve(): Promise<void> {
        if (this.busy || !this.checks.every(Boolean)) return;
        if (!this.audit || this.audit.issues.some(issue => issue.severity === 'error')) {
            new Notice('存在阻断问题，不能通过审核', 6000);
            return;
        }
        this.busy = true;
        this.updateApproveState();
        try {
            const meta = buildFanficApprovalMeta({
                reviewer: this.reviewer,
                sources: this.sources,
            });
            const approvedContent = applyFanficReviewMeta(this.content, meta);
            const approvedPath = pjFanficApprovedFile(this.project, this.workName);
            await saveFanficSettingFile(this.app, approvedPath, approvedContent);
            await this.writeAuditRecord(approvedPath, meta);
            await attachFanficPathToProject(this.app, this.project, approvedPath);

            const pending = this.app.vault.getAbstractFileByPath(this.filePath);
            if (pending instanceof TFile && pending.path !== approvedPath) {
                await this.app.vault.delete(pending);
            }
            new Notice(`✅ 已通过审核并绑定：${approvedPath}`, 6000);
            this.onApproved?.(approvedPath);
            this.close();
        } catch (error) {
            log.error('[FanficReviewModal] 审核通过失败:', error);
            new Notice(`审核通过失败：${error instanceof Error ? error.message : String(error)}`, 9000);
        } finally {
            this.busy = false;
        }
    }

    private async writeAuditRecord(approvedPath: string, meta: Record<string, string>): Promise<void> {
        const dir = pjFanficAuditDir(this.project);
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        const lines = [
            `# 同人设定审核记录：${this.workName}`,
            '',
            `- 审核状态：${meta['审核状态']}`,
            `- 审核人：${meta['审核人']}`,
            `- 审核时间：${meta['审核时间']}`,
            `- 来源数量：${meta['来源数量']}`,
            `- 来源哈希：${meta['来源哈希']}`,
            `- 通过文件：${approvedPath}`,
            '',
            '## 检查项',
            ...REQUIRED_CHECKS.map(label => `- [x] ${label}`),
            '',
            '## 来源',
            ...this.sources.map(source => `- [${source.id}] ${source.title} (${CANON_TIER_LABEL[source.tier]}) ${source.url}`),
        ];
        await adapter.write(`${dir}/${this.workName}_审核记录.md`, lines.join('\n'));
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}

function contentDiv(parent: HTMLElement, cls: string): HTMLElement {
    return parent.createDiv({ cls });
}