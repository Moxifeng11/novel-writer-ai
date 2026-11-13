/**
 * project-health-modal.ts — 项目体检报告
 *
 * 显示重复正文、未结算、frontmatter 异常与正文目录孤儿文件；
 * 每条问题可跳到对应文件，不自动修改内容。
 */
import { App, Modal, Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { listProjectIds } from '@/shared/project-catalog';
import { projectDisplayName } from '@/domains/kernel/project-locator';
import { analyzeProjectHealth, type ProjectHealthIssue, type ProjectHealthReport } from '@/services/project-health-service';
import {
    createStandardFs,
    validateProjectStandard,
    type StandardIssue,
    type StandardIssueKind,
    type StandardReport,
} from '@/services/project-standard-service';
import { createErrorState } from './components/error-state';

const STANDARD_LABEL: Record<StandardIssueKind, string> = {
    'missing-dir': '缺目录',
    'missing-file': '缺文件',
    'bad-naming': '命名不符',
    'digest-missing': '缺摘要',
    'fact-store-invalid': '事实库损坏',
    'fact-store-version': '事实库版本',
    'standard-outdated': '标准落后',
    // 章节层类型（体检已覆盖，标准校验不会产出，占位保证类型完整）
    'duplicate-body': '重复正文',
    unsettled: '未结算',
    'bad-frontmatter': 'frontmatter 异常',
    'orphan-body': '孤儿文件',
};

const KIND_LABEL: Record<ProjectHealthIssue['kind'], string> = {
    'duplicate-body': '重复正文',
    unsettled: '未结算',
    'bad-frontmatter': 'frontmatter 异常',
    'orphan-body': '正文目录孤儿文件',
};

/**
 * 项目体检弹窗。
 */
export class ProjectHealthModal extends Modal {
    private readonly plugin: NovelWriterPlugin;
    private readonly project: string;
    private bodyEl: HTMLElement | null = null;
    private loading = false;

    /**
     * @param app - Obsidian 应用实例
     * @param plugin - 插件实例
     * @param project - 项目 ID；空时取当前活动项目或第一个项目
     */
    constructor(app: App, plugin: NovelWriterPlugin, project?: string) {
        super(app);
        this.plugin = plugin;
        this.project = project || plugin.getActiveProject() || listProjectIds(app)[0] || '';
    }

    /** 打开时加载报告。 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('🩺 项目体检');
        this.contentEl.empty();
        this.contentEl.addClass('nw-project-health');
        this.bodyEl = this.contentEl.createDiv();
        void this.load();
    }

    /** 关闭时清空。 */
    onClose(): void {
        this.contentEl.empty();
    }

    private async load(): Promise<void> {
        if (!this.bodyEl || this.loading) return;
        this.loading = true;
        this.bodyEl.empty();
        if (!this.project) {
            const empty = this.bodyEl.createDiv({ cls: 'nw-empty-state' });
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '📂' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '还没有可体检的项目' });
            empty.createDiv({ cls: 'nw-empty-state-description', text: '先创建或导入一个项目。' });
            this.loading = false;
            return;
        }

        const loading = this.bodyEl.createDiv({ cls: 'nw-unit-loading', text: '正在扫描项目…' });
        try {
            const [report, standard] = await Promise.all([
                analyzeProjectHealth(this.app, this.project),
                validateProjectStandard(createStandardFs(this.app), this.project).catch(() => null),
            ]);
            loading.remove();
            this.renderReport(report);
            if (standard) this.renderStandard(standard);
        } catch (error) {
            loading.remove();
            createErrorState(this.bodyEl, {
                title: '体检失败',
                detail: error instanceof Error ? error.message : String(error),
                actions: [{ label: '重试', primary: true, onClick: () => { void this.load(); } }],
            });
        } finally {
            this.loading = false;
        }
    }

    private renderReport(report: ProjectHealthReport): void {
        if (!this.bodyEl) return;
        const head = this.bodyEl.createDiv({ cls: 'nw-project-health-head' });
        head.createEl('h3', { text: `《${projectDisplayName(report.project)}》` });
        head.createSpan({ cls: 'nw-project-health-meta', text: `模式：${report.mode} · 正文 ${report.checkedBodies} 个` });
        const refresh = head.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '重新体检' });
        refresh.addEventListener('click', () => { void this.load(); });

        const summary = this.bodyEl.createDiv({ cls: 'nw-project-health-summary' });
        for (const kind of Object.keys(report.summary) as ProjectHealthIssue['kind'][]) {
            const chip = summary.createDiv({
                cls: `nw-project-health-chip${report.summary[kind] > 0 ? ' nw-is-warning' : ''}`,
            });
            chip.createSpan({ text: KIND_LABEL[kind] });
            chip.createEl('strong', { text: String(report.summary[kind]) });
        }

        if (report.issues.length === 0) {
            const empty = this.bodyEl.createDiv({ cls: 'nw-empty-state' });
            empty.createDiv({ cls: 'nw-empty-state-icon', text: '✅' });
            empty.createDiv({ cls: 'nw-empty-state-title', text: '没有发现明显问题' });
            empty.createDiv({ cls: 'nw-empty-state-description', text: '重复正文、未结算、frontmatter 与孤儿文件均未命中。' });
            return;
        }

        const list = this.bodyEl.createDiv({ cls: 'nw-project-health-list' });
        for (const issue of report.issues) this.renderIssue(list, issue);
    }

    /**
     * 渲染项目标准区块（结构层问题，与章节层体检并列）。
     *
     * @param report - 标准校验报告
     */
    private renderStandard(report: StandardReport): void {
        if (!this.bodyEl) return;
        const head = this.bodyEl.createDiv({ cls: 'nw-project-health-head' });
        head.createEl('h3', { text: '📐 项目标准' });
        head.createSpan({
            cls: 'nw-project-health-meta',
            text: `标准版本 ${report.declaredVersion ?? '未声明'} / 当前 ${report.currentVersion} · 目录 ${report.checkedDirs} 个`,
        });
        if (report.issues.length === 0) {
            const ok = this.bodyEl.createDiv({ cls: 'nw-empty-state' });
            ok.createDiv({ cls: 'nw-empty-state-icon', text: '✅' });
            ok.createDiv({ cls: 'nw-empty-state-title', text: '项目结构符合标准' });
            ok.createDiv({ cls: 'nw-empty-state-description', text: '必备目录、文件、命名与派生数据均正常。' });
            return;
        }
        const summary = this.bodyEl.createDiv({ cls: 'nw-project-health-summary' });
        for (const [kind, count] of Object.entries(report.summary)) {
            const chip = summary.createDiv({ cls: 'nw-project-health-chip nw-is-warning' });
            chip.createSpan({ text: STANDARD_LABEL[kind as StandardIssueKind] ?? kind });
            chip.createEl('strong', { text: String(count) });
        }
        const list = this.bodyEl.createDiv({ cls: 'nw-project-health-list' });
        for (const issue of report.issues) this.renderStandardIssue(list, issue);
    }

    /**
     * 渲染单条标准问题。
     *
     * @param host - 容器
     * @param issue - 问题
     */
    private renderStandardIssue(host: HTMLElement, issue: StandardIssue): void {
        const row = host.createDiv({ cls: `nw-project-health-row nw-is-${issue.severity}` });
        const main = row.createDiv({ cls: 'nw-project-health-row-main' });
        main.createSpan({ cls: 'nw-project-health-kind', text: STANDARD_LABEL[issue.kind as StandardIssueKind] ?? issue.kind });
        main.createSpan({ cls: 'nw-project-health-label', text: issue.label });
        row.createDiv({ cls: 'nw-project-health-detail', text: issue.detail });
        row.createDiv({ cls: 'nw-project-health-path', text: issue.path });
    }

    private renderIssue(host: HTMLElement, issue: ProjectHealthIssue): void {
        const row = host.createDiv({ cls: `nw-project-health-row nw-is-${issue.severity}` });
        const main = row.createDiv({ cls: 'nw-project-health-row-main' });
        main.createSpan({ cls: 'nw-project-health-kind', text: KIND_LABEL[issue.kind] });
        main.createSpan({ cls: 'nw-project-health-label', text: issue.label });
        row.createDiv({ cls: 'nw-project-health-detail', text: issue.detail });
        row.createDiv({ cls: 'nw-project-health-path', text: issue.path });
        const open = row.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '打开文件' });
        open.addEventListener('click', () => {
            const file = this.app.vault.getAbstractFileByPath(issue.path);
            if (file instanceof TFile) {
                void this.app.workspace.getLeaf(false).openFile(file);
                this.close();
            } else {
                new Notice(`文件不存在：${issue.path}`);
            }
        });
    }
}
