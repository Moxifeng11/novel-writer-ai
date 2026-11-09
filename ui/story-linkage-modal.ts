/**
 * story-linkage-modal.ts — 关联索引看板
 *
 * Rev 186：时间线/伏笔此前只被平铺注入 prompt，与世界观的设定条目、全书规划
 * 没有任何交叉，也没有可见输出。本看板按章展示：
 *   - 到期 / 逾期 / 3 章内即将到期的伏笔，以及每条伏笔命中的设定与规划定位
 *   - 本章时间线事件（含前史）与关联设定
 *   - 全书规划中本章的定位
 *   - 重复/不可解析数据的提示（只提示，不改原文件）
 *
 * 并提供「回写关联索引」，把结果写入 伏笔库.md / 时间线看板.md 的标记块。
 */
import { App, Modal, Notice } from 'obsidian';
import { onNodeDoc, resolveNodeWindow } from '@/shared/dom-window';
import NovelWriterPlugin from '@/main';
import type { StoryLinkage } from '@/engine/story-linkage';
import type { LinkageForeshadow, LinkageTimelineEvent } from '@/engine/story-linkage';
import { getChaptersForProject, sortChaptersByNumber, type ChapterListEntry } from './project-utils';
import { isImeComposing } from '@/shared/keyboard';

const EMPTY_FORESHADOW_TEXT = '无';
const EMPTY_TIMELINE_TEXT = '本章暂无时间线事件';

/**
 * 故事联动弹窗。
 */
export class StoryLinkageModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project = '';
    private chapters: ChapterListEntry[] = [];
    private chapterName = '';
    private linkage: StoryLinkage | null = null;
    private headerEl: HTMLElement | null = null;
    private summaryEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private pickerEl: HTMLElement | null = null;
    private triggerEl: HTMLButtonElement | null = null;
    private panelEl: HTMLElement | null = null;
    private outsideClickHandler: ((ev: MouseEvent) => void) | null = null;
    /** 外部点击监听的解绑器（绑在 modal 所属窗口，popout 安全） */
    private outsideClickDisposer: (() => void) | null = null;
    /** 扫描序号：切章时丢弃过期结果，避免慢请求覆盖新章节 */
    private scanSeq = 0;
    private writeBackArmed = false;
    private writeBackTimer: number | null = null;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    /**
     * onOpen 方法。
     */
    async onOpen(): Promise<void> {
        const root = this.contentEl;
        root.empty();
        // Rev 187：宽度必须落在 .modal 上。设在 contentEl 时 Obsidian 的 .modal 仍是
        // 560px，内容横向溢出、出现横向滚动条，章节下拉在窄窗口下会被裁到面板外。
        this.modalEl.addClass('novel-writer-linkage-modal');

        this.project = this.plugin.getActiveProject() ?? '';
        if (!this.project) {
            root.createEl('p', { text: '请先打开一个小说项目，再使用关联索引看板。', cls: 'novel-writer-linkage-empty' });
            return;
        }

        this.chapters = sortChaptersByNumber(getChaptersForProject(this.app, this.project));
        if (this.chapters.length === 0) {
            root.createEl('p', { text: `「${this.project}」还没有章节，请先创建章节骨架。`, cls: 'novel-writer-linkage-empty' });
            return;
        }

        const workbench = this.plugin.getWorkbenchContext();
        const preferred = workbench && workbench.project === this.project
            && this.chapters.some(ch => ch.chapter === workbench.chapterName)
            ? workbench.chapterName
            : '';
        this.chapterName = preferred || this.chapters[this.chapters.length - 1].chapter;

        this.renderShell();
        await this.scan();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        if (this.writeBackTimer !== null) resolveNodeWindow(this.modalEl).clearTimeout(this.writeBackTimer);
        this.closeChapterPanel();
        this.contentEl.empty();
    }

    private renderShell(): void {
        const root = this.contentEl;

        const header = root.createDiv({ cls: 'novel-writer-linkage-header' });
        this.headerEl = header;
        const titleRow = header.createDiv({ cls: 'novel-writer-linkage-title-row' });
        titleRow.createEl('h3', { text: `🔗 关联索引 · ${this.project}` });

        // Rev 187：原生 <select> 在 400 章长列表 / 部分主题与缩放环境下点击选项不生效，
        // 改为 DOM 自绘下拉（搜索 + 点击行切换），不依赖原生弹窗。
        this.pickerEl = titleRow.createDiv({ cls: 'novel-writer-linkage-picker' });
        this.triggerEl = this.pickerEl.createEl('button', {
            cls: 'novel-writer-linkage-chapter',
            text: this.chapterLabel(this.currentChapter()),
        });
        this.triggerEl.onclick = () => this.toggleChapterPanel();
        this.triggerEl.setAttr('aria-haspopup', 'listbox');

        this.summaryEl = header.createDiv({ cls: 'novel-writer-linkage-summary' });
        this.bodyEl = root.createDiv({ cls: 'novel-writer-linkage-body' });

        const footer = root.createDiv({ cls: 'novel-writer-linkage-footer' });
        const rescanBtn = footer.createEl('button', { text: '🔄 重新扫描' });
        rescanBtn.onclick = async () => { await this.scan(); };

        const writeBtn = footer.createEl('button', { text: '✍️ 回写关联索引', cls: 'mod-cta' });
        writeBtn.onclick = async () => {
            if (!this.writeBackArmed) {
                this.writeBackArmed = true;
                writeBtn.setText('确认回写？');
                this.writeBackTimer = resolveNodeWindow(this.modalEl).setTimeout(() => {
                    this.writeBackArmed = false;
                    writeBtn.setText('✍️ 回写关联索引');
                }, 3000);
                return;
            }
            if (this.writeBackTimer !== null) resolveNodeWindow(this.modalEl).clearTimeout(this.writeBackTimer);
            this.writeBackArmed = false;
            writeBtn.setText('回写中…');
            try {
                const result = await this.plugin.ctxManager.writeStoryLinkageIndex(this.project);
                if (result.foreshadow || result.timeline) {
                    new Notice('✅ 已写入 04-项目总控/故事台账/关联索引.md', 4000);
                } else {
                    new Notice('⚠️ 关联索引写入失败：请检查项目目录与写入权限', 5000);
                }
            } catch (e) {
                new Notice(`❌ 回写失败：${(e as Error).message}`, 6000);
            }
            writeBtn.setText('✍️ 回写关联索引');
        };

        const closeBtn = footer.createEl('button', { text: '关闭' });
        closeBtn.onclick = () => this.close();
    }

    /** 当前选中章节条目（找不到时返回 null，下拉按钮回退显示章名） */
    private currentChapter(): ChapterListEntry | null {
        return this.chapters.find(c => c.chapter === this.chapterName) ?? null;
    }

    private chapterLabel(entry: ChapterListEntry | null): string {
        if (!entry) return this.chapterName || '选择章节';
        const isDone = entry.hasBody && (entry.status === 'written' || entry.status === 'settled');
        const title = entry.title ? ` · ${entry.title}` : '';
        return `${entry.chapter}${title} ${isDone ? '✅' : '📝'}`;
    }

    private toggleChapterPanel(): void {
        if (this.panelEl) {
            this.closeChapterPanel();
            return;
        }
        this.openChapterPanel();
    }

    private openChapterPanel(): void {
        if (!this.headerEl) return;

        // Rev 190：面板改为在 header 内（summary 之后）流内展开，不用 absolute 浮层。
        // 旧实现 340×354 的浮层会盖住正文 322px 高，用户看到的「重叠」就是它。
        const panel = this.headerEl.createDiv({ cls: 'novel-writer-linkage-chapter-panel' });
        const search = panel.createEl('input', {
            cls: 'novel-writer-linkage-chapter-search',
            attr: { type: 'search', placeholder: '搜索章号或标题…' },
        });
        const list = panel.createDiv({ cls: 'novel-writer-linkage-chapter-list', attr: { role: 'listbox' } });
        const empty = panel.createEl('p', { text: '未匹配到章节', cls: 'novel-writer-linkage-chapter-empty' });
        empty.hidden = true;

        const rows: Array<{ entry: ChapterListEntry; el: HTMLElement }> = [];
        for (const entry of this.chapters) {
            const item = list.createEl('div', {
                cls: 'novel-writer-linkage-chapter-item',
                text: this.chapterLabel(entry),
                attr: { role: 'option' },
            });
            if (entry.chapter === this.chapterName) item.addClass('is-current');
            item.onclick = () => { void this.selectChapter(entry); };
            rows.push({ entry, el: item });
        }

        const applyFilter = () => {
            const kw = search.value.trim().toLowerCase();
            let visible = 0;
            for (const row of rows) {
                const match = !kw || `${row.entry.chapter} ${row.entry.title}`.toLowerCase().includes(kw);
                row.el.hidden = !match;
                if (match) visible++;
            }
            empty.hidden = visible > 0;
        };
        search.oninput = applyFilter;
        search.onkeydown = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                this.closeChapterPanel();
                return;
            }
            if (ev.key === 'Enter') {
                // IME 组字中回车是确认候选，不能误切章节
                if (isImeComposing(ev)) return;
                const first = rows.find(r => !r.el.hidden);
                if (first) {
                    ev.preventDefault();
                    void this.selectChapter(first.entry);
                }
            }
        };

        this.panelEl = panel;
        this.outsideClickHandler = (ev: MouseEvent) => {
            const target = ev.target as Node;
            // 面板已移出 pickerEl，点击列表/搜索框不能被当成「外部点击」
            if (this.pickerEl?.contains(target) || this.panelEl?.contains(target)) return;
            this.closeChapterPanel();
        };
        this.outsideClickDisposer = onNodeDoc(this.modalEl, 'mousedown', this.outsideClickHandler);
        search.focus();
    }

    private closeChapterPanel(): void {
        this.outsideClickDisposer?.();
        this.outsideClickDisposer = null;
        this.outsideClickHandler = null;
        if (this.panelEl) {
            this.panelEl.remove();
            this.panelEl = null;
        }
    }

    private async selectChapter(entry: ChapterListEntry): Promise<void> {
        this.closeChapterPanel();
        // Rev 188：即使用户点的是当前已选中的章，也要重新扫描——
        // 早前在此提前 return 会让「点一下没反应」，用户需要手动点「重新扫描」。
        this.chapterName = entry.chapter;
        if (this.triggerEl) this.triggerEl.setText(this.chapterLabel(entry));
        await this.scan();
    }

    private async scan(): Promise<void> {
        if (!this.bodyEl) return;
        const seq = ++this.scanSeq;
        this.bodyEl.empty();
        this.bodyEl.createEl('p', { text: '扫描中…', cls: 'novel-writer-linkage-empty' });

        let linkage: StoryLinkage | null = null;
        try {
            linkage = await this.plugin.ctxManager.buildStoryLinkage(this.project, this.chapterName);
        } catch {
            linkage = null;
        }
        // 切章后旧请求可能晚到，丢弃过期结果，避免看板回退到上一章内容
        if (seq !== this.scanSeq) return;

        this.linkage = linkage;
        this.renderSummary();
        this.renderBody();
    }

    private renderSummary(): void {
        if (!this.summaryEl) return;
        this.summaryEl.empty();
        if (!this.linkage) {
            this.summaryEl.createSpan({ text: '关联数据不可用（伏笔库 / 时间线看板缺失）', cls: 'novel-writer-linkage-warn-text' });
            return;
        }
        const chips = [
            `到期 ${this.linkage.due.length}`,
            `逾期 ${this.linkage.overdue.length}`,
            `即将 ${this.linkage.upcoming.length}`,
            `时间线 ${this.linkage.timeline.length}`,
            `设定 ${this.linkage.settingHits.length}`,
            `提示 ${this.linkage.warnings.length}`,
        ];
        for (const text of chips) {
            this.summaryEl.createSpan({ text, cls: 'novel-writer-linkage-chip' });
        }
    }

    private renderBody(): void {
        if (!this.bodyEl) return;
        this.bodyEl.empty();
        const linkage = this.linkage;
        if (!linkage) {
            this.bodyEl.createEl('p', { text: '未建立关联索引：请确认项目已有 02-时间线与伏笔/伏笔库.md 或 时间线看板.md。', cls: 'novel-writer-linkage-empty' });
            return;
        }

        this.renderForeshadowSection('⏰ 本章到期伏笔', linkage.due);
        this.renderForeshadowSection('⚠️ 逾期未回收', linkage.overdue);
        this.renderForeshadowSection('📅 3 章内即将到期', linkage.upcoming);
        this.renderTimelineSection(linkage.timeline);
        this.renderPlanningSection(linkage.planningRefs);
        this.renderWarnings(linkage.warnings);

        const allEmpty = linkage.due.length + linkage.overdue.length + linkage.upcoming.length
            + linkage.timeline.length + linkage.settingHits.length + linkage.planningRefs.length === 0;
        if (allEmpty) {
            this.bodyEl.createEl('p', { text: '本章暂无到期/逾期伏笔，也无时间线事件。', cls: 'novel-writer-linkage-empty' });
        }
    }

    private renderForeshadowSection(title: string, items: LinkageForeshadow[]): void {
        if (!this.bodyEl) return;
        const section = this.bodyEl.createDiv({ cls: 'novel-writer-linkage-section' });
        section.createEl('h4', { text: `${title}（${items.length}）` });
        if (items.length === 0) {
            section.createEl('p', { text: EMPTY_FORESHADOW_TEXT, cls: 'novel-writer-linkage-empty' });
            return;
        }

        const table = section.createEl('table', { cls: 'novel-writer-linkage-table novel-writer-linkage-table--foreshadow' });
        const head = table.createEl('tr');
        for (const label of ['伏笔', '重要度', '埋设章', '计划回收', '关联设定', '规划定位']) {
            head.createEl('th', { text: label });
        }
        for (const item of items) {
            const row = table.createEl('tr');
            row.createEl('td', { text: item.name });
            row.createEl('td', { text: item.importance || '—' });
            row.createEl('td', { text: item.buryChapter || '—' });
            row.createEl('td', { text: item.plannedRaw || '待定' });
            row.createEl('td', { text: item.settingRefs.join('、') || '—' });
            row.createEl('td', { text: item.planningRef || '—' });
        }
    }

    private renderTimelineSection(items: LinkageTimelineEvent[]): void {
        if (!this.bodyEl) return;
        const section = this.bodyEl.createDiv({ cls: 'novel-writer-linkage-section' });
        section.createEl('h4', { text: `🕰️ 本章时间线（${items.length}）` });
        if (items.length === 0) {
            section.createEl('p', { text: EMPTY_TIMELINE_TEXT, cls: 'novel-writer-linkage-empty' });
            return;
        }
        const table = section.createEl('table', { cls: 'novel-writer-linkage-table novel-writer-linkage-table--timeline' });
        const head = table.createEl('tr');
        for (const label of ['时间', '章节', '事件', '涉及实体', '关联设定']) {
            head.createEl('th', { text: label });
        }
        for (const event of items) {
            const row = table.createEl('tr');
            row.createEl('td', { text: event.time || '—' });
            row.createEl('td', { text: event.chapter || '—' });
            row.createEl('td', { text: event.eventName });
            row.createEl('td', { text: event.involved.join('、') || '—' });
            row.createEl('td', { text: event.settingRefs.join('、') || '—' });
        }
    }

    private renderPlanningSection(refs: string[]): void {
        if (!this.bodyEl) return;
        const section = this.bodyEl.createDiv({ cls: 'novel-writer-linkage-section' });
        section.createEl('h4', { text: `📋 全书规划定位（${refs.length}）` });
        if (refs.length === 0) {
            section.createEl('p', { text: '分卷大纲未命中本章段落', cls: 'novel-writer-linkage-empty' });
            return;
        }
        const list = section.createEl('ul', { cls: 'novel-writer-linkage-list' });
        for (const ref of refs) list.createEl('li', { text: ref });
    }

    private renderWarnings(warnings: string[]): void {
        if (!this.bodyEl) return;
        const section = this.bodyEl.createDiv({ cls: 'novel-writer-linkage-section' });
        section.createEl('h4', { text: `🧹 数据质量提示（${warnings.length}）` });
        if (warnings.length === 0) {
            section.createEl('p', { text: '无', cls: 'novel-writer-linkage-empty' });
            return;
        }
        const list = section.createEl('ul', { cls: 'novel-writer-linkage-list' });
        for (const warning of warnings) list.createEl('li', { text: warning });
    }
}
