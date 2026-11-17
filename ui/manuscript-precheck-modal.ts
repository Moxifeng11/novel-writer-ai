/**
 * manuscript-precheck-modal.ts — 文面体检问题列表（定位 + 一键跳转）
 *
 * 数据来自纯规则引擎 shared/manuscript-precheck（本地跑，不调 AI）。
 * 导出弹窗与命令面板共用本弹窗：列表按章分组，点任意一条跳到正文对应行列。
 */

import { App, Editor, Modal, Setting, TFile } from 'obsidian';
import { getChaptersForProject, sortChaptersByNumber, type ChapterListEntry } from './project-utils';
import {
    checkManuscript,
    formatPrecheckSummary,
    type PrecheckChapterResult,
    type PrecheckIssue,
    type PrecheckReport,
    type PrecheckSeverity,
} from '@/shared/manuscript-precheck';
import { showErrorNotice } from './components/notice-helpers';
import { createLogger } from '@/shared/logger';

const log = createLogger('manuscript-precheck');

/** 列表最多渲染多少条（超出的只提示数量，避免一次塞几千行 DOM） */
const MAX_RENDERED_ISSUES = 300;

/** 严重度 → 中文标签 */
const SEVERITY_LABEL: Record<PrecheckSeverity, string> = {
    error: '必改',
    warning: '待确认',
    info: '风格',
};

/**
 * 章节条目的展示名。
 *
 * @param entry - 章节条目
 * @returns 形如「第1章 风起」
 */
export function chapterEntryLabel(entry: ChapterListEntry): string {
    return entry.title ? entry.chapter + ' ' + entry.title : entry.chapter;
}

/**
 * 文面体检弹窗。
 */
export class ManuscriptPrecheckModal extends Modal {
    private report: PrecheckReport | null = null;
    private summaryEl!: HTMLElement;
    private listEl!: HTMLElement;
    private onlyErrors = false;

    constructor(
        app: App,
        private readonly project: string,
    ) {
        super(app);
    }

    /** 弹窗打开：建摘要条、过滤开关、列表容器与底部按钮，然后立即扫描一次 */
    onOpen(): void {
        this.modalEl.addClass('nw-scope', 'nw-modal');
        this.titleEl.setText('🔎 文面体检');
        this.contentEl.empty();
        if (!this.project) {
            this.contentEl.createEl('p', { text: '⚠️ 请先打开一个项目。' });
            return;
        }
        this.summaryEl = this.contentEl.createDiv({ cls: 'nw-precheck-summary', text: '正在扫描…' });
        new Setting(this.contentEl)
            .setName('只看必改项')
            .setDesc('隐藏「待确认」和「风格」级提示')
            .addToggle((toggle) => toggle.setValue(false).onChange((value) => {
                this.onlyErrors = value;
                this.renderList();
            }));
        this.listEl = this.contentEl.createDiv({ cls: 'nw-precheck-list' });
        const footer = this.contentEl.createDiv({ cls: 'nw-modal-footer' });
        footer.createEl('button', { text: '重新扫描', cls: 'nw-btn nw-btn-secondary' })
            .addEventListener('click', () => { void this.scan(); });
        footer.createEl('button', { text: '关闭', cls: 'nw-btn' })
            .addEventListener('click', () => this.close());
        void this.scan();
    }

    /** 弹窗关闭：清空内容，避免下次打开残留旧列表 */
    onClose(): void {
        this.contentEl.empty();
    }

    /** 读取各章正文并跑规则 */
    private async scan(): Promise<void> {
        this.summaryEl.setText('正在扫描…');
        this.listEl.empty();
        try {
            const entries = sortChaptersByNumber(getChaptersForProject(this.app, this.project));
            const chapters: { name: string; path: string; text: string }[] = [];
            for (const entry of entries) {
                const file = entry.file;
                if (!(file instanceof TFile)) continue;
                try {
                    const text = await this.app.vault.cachedRead(file);
                    chapters.push({ name: chapterEntryLabel(entry), path: file.path, text });
                } catch (error) {
                    log.warn('[manuscript-precheck] 读取章节失败:', file.path, error);
                }
            }
            this.report = checkManuscript(chapters);
            this.renderList();
        } catch (error) {
            log.error('[manuscript-precheck] 扫描失败:', error);
            showErrorNotice('文面体检失败：' + (error instanceof Error ? error.message : String(error)), { title: '文面体检' });
            this.summaryEl.setText('扫描失败，可重试。');
        }
    }

    /** 渲染汇总与分组列表 */
    private renderList(): void {
        if (!this.report) return;
        this.listEl.empty();
        const summary = formatPrecheckSummary(this.report, 5);
        this.summaryEl.setText(summary ?? '✅ 未发现问题。');
        if (this.report.total === 0) return;
        const visible = this.report.chapters
            .map(chapter => this.filterChapter(chapter))
            .filter(chapter => chapter.issues.length > 0);
        if (visible.length === 0) {
            this.listEl.createDiv({ cls: 'nw-precheck-empty', text: '当前筛选下没有问题。' });
            return;
        }
        let rendered = 0;
        for (const chapter of visible) {
            if (rendered >= MAX_RENDERED_ISSUES) break;
            const group = this.listEl.createDiv({ cls: 'nw-precheck-group' });
            group.createDiv({
                cls: 'nw-precheck-group-title',
                text: chapter.name + '（' + String(chapter.issues.length) + '）',
            });
            for (const issue of chapter.issues) {
                if (rendered >= MAX_RENDERED_ISSUES) break;
                this.renderIssue(group, chapter, issue);
                rendered += 1;
            }
        }
        if (this.report.total > MAX_RENDERED_ISSUES) {
            this.listEl.createDiv({
                cls: 'nw-precheck-truncated',
                text: '问题较多，仅显示前 ' + String(MAX_RENDERED_ISSUES) + ' 条；建议先修完再扫描。',
            });
        }
    }

    /** 按筛选条件裁剪一章的问题 */
    private filterChapter(chapter: PrecheckChapterResult): PrecheckChapterResult {
        if (!this.onlyErrors) return chapter;
        return { ...chapter, issues: chapter.issues.filter(issue => issue.severity === 'error') };
    }

    /** 渲染单条问题（点击跳转） */
    private renderIssue(parent: HTMLElement, chapter: PrecheckChapterResult, issue: PrecheckIssue): void {
        const row = parent.createDiv({ cls: 'nw-precheck-issue' });
        row.createEl('span', {
            cls: 'nw-precheck-badge nw-precheck-badge--' + issue.severity,
            text: SEVERITY_LABEL[issue.severity],
        });
        const main = row.createDiv({ cls: 'nw-precheck-main' });
        main.createDiv({ cls: 'nw-precheck-message', text: issue.message });
        main.createDiv({ cls: 'nw-precheck-snippet', text: '…' + issue.snippet + '…' });
        const meta = row.createDiv({
            cls: 'nw-precheck-meta',
            text: '第' + String(issue.line) + '行 · 列' + String(issue.column) + ' · 跳到正文',
        });
        row.addEventListener('click', () => { void this.jumpTo(chapter.path, issue); });
        meta.addEventListener('click', () => { void this.jumpTo(chapter.path, issue); });
    }

    /** 打开章节并把光标移到问题位置 */
    private async jumpTo(path: string | undefined, issue: PrecheckIssue): Promise<void> {
        if (!path) return;
        try {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                showErrorNotice('未找到章节文件：' + path, { title: '文面体检' });
                return;
            }
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
            const editor = (leaf.view as unknown as { editor?: Editor }).editor;
            if (!editor) return;
            const pos = { line: issue.line - 1, ch: Math.max(0, issue.column - 1) };
            editor.setCursor(pos);
            editor.scrollIntoView({ from: pos, to: pos }, true);
            this.close();
        } catch (error) {
            log.warn('[manuscript-precheck] 跳转失败:', error);
            showErrorNotice('跳转失败：' + (error instanceof Error ? error.message : String(error)), { title: '文面体检' });
        }
    }
}
