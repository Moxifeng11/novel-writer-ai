import { App, Modal, Notice, TFile } from 'obsidian';
import type NovelWriterAI from '../main';
import { pjVolumeOutlineDir } from '../shared/paths';

/** 解析后的卷结构 */
interface VolumeNode {
    volName: string;
    volNum: number;
    chapterRange: string;
    coreConflict: string;
    startLine: number;
    endLine: number;
    chapters: ChapterNode[];
}

/** 解析后的章结构 */
interface ChapterNode {
    chapNum: number;
    conflict: string;
    rowLine: number;
    volIndex: number;
    /** 该章所在的源文件索引（v4.0 多卷归档下用于回写） */
    sourceIdx: number;
}

/** 大纲来源文件（v4.0 一个卷一个文件；旧版为单文件兜底） */
interface OutlineSource {
    path: string;
    lines: string[];
}

export class ChapterOutlineTreeModal extends Modal {
    private plugin: NovelWriterAI;
    /** v4.0：项目名，按卷归档读取分卷大纲；旧版单文件用 legacyPath 兜底 */
    private project: string;
    /** 旧版单文件路径（仅当传入的是 .md 单文件时使用） */
    private legacyPath: string | null = null;
    /** 所有来源文件（每卷一个；旧版单文件时只有一个），保存时按文件分组回写 */
    private sources: OutlineSource[] = [];
    private volumes: VolumeNode[] = [];
    /** 章节区间搜索：起始章号（含0=未设置） */
    private rangeFrom = 0;
    /** 章节区间搜索：结束章号（含0=未设置） */
    private rangeTo = 0;
    private expandedVolumes: Set<number> = new Set();

    /**
     * @param project 项目名（v4.0 按卷归档），或旧版单文件 `.md` 路径（向后兼容）
     */
    constructor(app: App, plugin: NovelWriterAI, project: string) {
        super(app);
        this.plugin = plugin;
        if (project.endsWith('.md')) {
            // 向后兼容：直接传入单文件路径
            this.legacyPath = project;
            this.project = project.split('/')[0] || project;
        } else {
            this.project = project;
        }
    }

    async onOpen() {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // v3.4.8: 两层 CSS 规则 — 覆盖 Obsidian .modal 父容器约束
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.style.setProperty('max-width', 'min(750px, 85vw)', 'important');
            wrapper.style.setProperty('width', 'min(750px, 85vw)', 'important');
        }
        contentEl.style.maxWidth = 'min(750px, 85vw)';
        contentEl.style.width = 'min(750px, 85vw)';
        contentEl.style.setProperty('padding', '16px 20px', 'important');

        contentEl.empty();
        contentEl.addClass('nw-outline-tree-modal');

        await this.loadOutline();

        if (this.volumes.length === 0) {
            contentEl.createEl('p', { text: '⚠️ 未找到分卷大纲，请先执行"全书规划"步骤。', attr: { style: 'color:var(--text-warning); padding:20px;' } });
            return;
        }

        this.volumes.forEach((_, i) => this.expandedVolumes.add(i));
        this.injectStyles();
        this.render();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private async loadOutline(): Promise<void> {
        try {
            this.sources = [];
            if (this.legacyPath) {
                // 向后兼容：单文件
                const file = this.app.vault.getAbstractFileByPath(this.legacyPath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    this.sources.push({ path: this.legacyPath, lines: content.split('\n') });
                }
            } else {
                // v4.0：按卷归档，逐卷文件加载（卷号升序），各文件独立行模型
                const dir = pjVolumeOutlineDir(this.project);
                const volFiles = this.app.vault.getFiles()
                    .filter(f => f.path.startsWith(`${dir}/`) && f.name.endsWith('_分卷大纲.md'))
                    .sort((a, b) => {
                        const na = parseInt(a.name.match(/第(\d+)卷/)?.[1] || '0');
                        const nb = parseInt(b.name.match(/第(\d+)卷/)?.[1] || '0');
                        return na - nb;
                    });
                for (const f of volFiles) {
                    const content = await this.app.vault.read(f);
                    this.sources.push({ path: f.path, lines: content.split('\n') });
                }
                // 旧版单文件兜底（v3.x 尚未迁移时）
                if (this.sources.length === 0) {
                    const legacy = this.app.vault.getAbstractFileByPath(`${this.project}/03-大纲与章节/分卷大纲.md`);
                    if (legacy instanceof TFile) {
                        const content = await this.app.vault.read(legacy);
                        this.sources.push({ path: legacy.path, lines: content.split('\n') });
                    }
                }
            }
            this.parseContent();
        } catch (e) {
            console.error('[OutlineTree] 读取分卷大纲失败:', e);
        }
    }

    /** 解析所有来源文件为树结构（rowLine 相对各自源文件，sourceIdx 标记来源） */
    private parseContent(): void {
        this.volumes = [];

        for (let srcIdx = 0; srcIdx < this.sources.length; srcIdx++) {
            const lines = this.sources[srcIdx].lines;
            let currentVol: VolumeNode | null = null;
            let inChapterTable = false;

            for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // 检测卷标题: ### 第N卷
            const volMatch = trimmed.match(/^###\s*第(\d+)卷/);
            if (volMatch) {
                // v3.4.8 fix: 先 push 旧卷到数组，再创建新卷
                if (currentVol) {
                    currentVol.endLine = i - 1;
                    this.volumes.push(currentVol);
                }
                currentVol = {
                    volNum: parseInt(volMatch[1]),
                    volName: '',
                    chapterRange: '',
                    coreConflict: '',
                    startLine: i,
                    endLine: lines.length - 1,
                    chapters: [],
                };
                inChapterTable = false;
                continue;
            }

            if (!currentVol) continue;

            // 解析卷名: - **卷名**：xxx
            const nameMatch = trimmed.match(/[-*]\s*\*{0,2}卷名\*{0,2}\s*[:：]\s*(.+)/);
            if (nameMatch) { currentVol.volName = nameMatch[1].trim(); continue; }

            // 解析章节范围
            const rangeMatch = trimmed.match(/[-*]\s*\*{0,2}章节范围\*{0,2}\s*[:：]\s*(.+)/);
            if (rangeMatch) { currentVol.chapterRange = rangeMatch[1].trim(); continue; }

            // 解析卷核心冲突
            const conflictMatch = trimmed.match(/[-*]\s*\*{0,2}核心冲突\*{0,2}\s*[:：]\s*(.+)/);
            if (conflictMatch) { currentVol.coreConflict = conflictMatch[1].trim(); continue; }

            // 检测章节分配表头
            if (trimmed.startsWith('| 章号') || trimmed.startsWith('|章号')) {
                inChapterTable = true;
                continue;
            }

            // 表格分隔行
            if (inChapterTable && /^\|[-| ]+\|$/.test(trimmed)) continue;

            // 解析章节表格行: | 1 | xxx |
            if (inChapterTable) {
                const rowMatch = trimmed.match(/^\|\s*(\d+)\s*\|(.+)\|$/);
                if (rowMatch) {
                    currentVol.chapters.push({
                        chapNum: parseInt(rowMatch[1]),
                        conflict: rowMatch[2].trim(),
                        rowLine: i,
                        volIndex: this.volumes.length,
                        sourceIdx: srcIdx,
                    });
                    continue;
                }
            }

            if (inChapterTable && !trimmed.startsWith('|')) {
                inChapterTable = false;
            }
            }

            // 最后一个卷
            if (currentVol) {
                currentVol.endLine = lines.length - 1;
                this.volumes.push(currentVol);
            }
        }

        console.warn('[OutlineTree] 解析完成: 共', this.volumes.length, '卷, 总章节', this.volumes.reduce((s, v) => s + v.chapters.length, 0));
    }

    /** 区间搜索是否匹配某章 */
    private isInRange(chapNum: number): boolean {
        const from = this.rangeFrom;
        const to = this.rangeTo;

        // 只有起始章 → 单章定位
        if (from > 0 && to === 0) return chapNum === from;
        // 起始 + 结束 → 区间
        if (from > 0 && to > 0) return chapNum >= from && chapNum <= to;
        // 只有结束章 → 查看到此章
        if (from === 0 && to > 0) return chapNum <= to;
        // 都没设置 → 不过滤
        return true;
    }

    /** 是否有任何区间过滤 */
    private hasRangeFilter(): boolean {
        return this.rangeFrom > 0 || this.rangeTo > 0;
    }

    /** 渲染主结构 */
    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        // ── 标题栏 + 章号区间搜索 + 全文切换 ──
        const header = contentEl.createDiv({ attr: { style: 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:0 4px 12px 4px; border-bottom:1px solid var(--background-modifier-border); margin-bottom:12px;' } });
        header.createEl('h3', { text: '📖 分卷大纲 · 章节冲突预览', attr: { style: 'margin:0; font-size:1.1em; white-space:nowrap;' } });

        // 章号区间搜索 + 全文按钮
        const actionsWrap = header.createDiv({ attr: { style: 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;' } });
        const searchWrap = actionsWrap.createDiv({ attr: { style: 'display:flex; gap:6px; align-items:center; font-size:0.85em;' } });
        searchWrap.createSpan({ text: '【', attr: { style: 'color:var(--text-muted);' } });
        const fromInput = searchWrap.createEl('input', {
            attr: { placeholder: '起始章', style: 'width:60px; padding:3px 6px; border-radius:4px; border:1px solid var(--background-modifier-border); font-size:0.85em; text-align:center;', type: 'number', min: '1' }
        });
        fromInput.value = this.rangeFrom > 0 ? String(this.rangeFrom) : '';
        searchWrap.createSpan({ text: '章 ——【', attr: { style: 'color:var(--text-muted);' } });
        const toInput = searchWrap.createEl('input', {
            attr: { placeholder: '结束章', style: 'width:60px; padding:3px 6px; border-radius:4px; border:1px solid var(--background-modifier-border); font-size:0.85em; text-align:center;', type: 'number', min: '1' }
        });
        toInput.value = this.rangeTo > 0 ? String(this.rangeTo) : '';
        searchWrap.createSpan({ text: '章 】', attr: { style: 'color:var(--text-muted);' } });

        // 定位按钮
        const goBtn = searchWrap.createEl('button', {
            text: '🔍', attr: { style: 'padding:3px 8px; background:var(--text-accent); color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.85em;', title: '定位到章节区间' }
        });
        goBtn.addEventListener('click', () => {
            this.rangeFrom = parseInt(fromInput.value) || 0;
            this.rangeTo = parseInt(toInput.value) || 0;
            if (this.rangeFrom > 0 || this.rangeTo > 0) {
                // 展开包含目标章节的所有卷
                this.expandedVolumes.clear();
                for (let vi = 0; vi < this.volumes.length; vi++) {
                    if (this.volumes[vi].chapters.some(c => this.isInRange(c.chapNum))) {
                        this.expandedVolumes.add(vi);
                    }
                }
            }
            this.render();
        });

        // 清除按钮
        const clearBtn = searchWrap.createEl('button', {
            text: '✕', attr: { style: 'padding:3px 6px; border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; font-size:0.85em; background:var(--background-secondary);', title: '清除过滤' }
        });
        clearBtn.addEventListener('click', () => {
            this.rangeFrom = 0;
            this.rangeTo = 0;
            this.volumes.forEach((_, i) => this.expandedVolumes.add(i));
            this.render();
        });

        // 回车触发
        [fromInput, toInput].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBtn.click(); }));

        // v4.1.0: 查看全文切换 — 统一替代旧版内联纯文本预览
        const textBtn = actionsWrap.createEl('button', {
            text: '📄 全文', attr: { style: 'padding:3px 10px; border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; font-size:0.85em; background:var(--background-secondary);', title: '查看合并后的分卷大纲全文' }
        });
        let textEl: HTMLElement | null = null;
        textBtn.addEventListener('click', () => {
            if (textEl) { textEl.remove(); textEl = null; textBtn.textContent = '📄 全文'; return; }
            const raw = this.sources.map(s => s.lines.join('\n')).join('\n\n---\n');
            const bodyContent = raw.replace(/^---[\s\S]*?---\n*/gm, '').trim();
            textEl = contentEl.createDiv({
                attr: { style: 'margin: 0 4px 12px; padding: 10px; border: 1px solid var(--background-modifier-border); border-radius: 6px; max-height: 30vh; overflow-y: auto; font-size: 0.82em; line-height: 1.5; white-space: pre-wrap; word-break: break-word; background: var(--background-primary);' }
            });
            textEl.setText(bodyContent.slice(0, 20000));
            textBtn.textContent = '📄 收起';
        });

        // ── 树容器 ──
        const treeContainer = contentEl.createDiv({
            attr: { style: 'max-height: 50vh; overflow-y: auto; padding:0 4px; margin-bottom:12px;' }
        });

        // ── 渲染卷 ──
        let totalVisible = 0;
        for (let vi = 0; vi < this.volumes.length; vi++) {
            const vol = this.volumes[vi];
            const isExpanded = this.expandedVolumes.has(vi);

            // 区间过滤：检查该卷是否有匹配章节
            if (this.hasRangeFilter()) {
                const hasMatch = vol.chapters.some(c => this.isInRange(c.chapNum));
                if (!hasMatch) {
                    // 显示但折叠
                    if (!isExpanded) {
                        // 渲染折叠标题
                        const volHeader = treeContainer.createDiv({
                            attr: { style: 'display:flex; align-items:center; padding:6px 8px; margin:2px 0; border-radius:6px; cursor:pointer; background:var(--background-secondary); opacity:0.5;' }
                        });
                        volHeader.addEventListener('click', () => {
                            this.expandedVolumes.add(vi);
                            this.render();
                        });
                        volHeader.createSpan({ text: '▶', attr: { style: 'margin-right:8px; font-size:0.8em; min-width:16px;' } });
                        volHeader.createSpan({ text: `第${vol.volNum}卷 ${vol.volName || '(未命名)'} — ${vol.chapters.length}章 (无匹配)`, attr: { style: 'font-size:0.85em; color:var(--text-faint);' } });
                    }
                    continue;
                }
            }

            // 卷标题行
            const volHeader = treeContainer.createDiv({
                attr: { style: 'display:flex; align-items:center; padding:8px 10px; margin:6px 0 2px 0; border-radius:8px; cursor:pointer; background:var(--background-secondary);' }
            });
            volHeader.addEventListener('click', () => {
                if (this.expandedVolumes.has(vi)) this.expandedVolumes.delete(vi);
                else this.expandedVolumes.add(vi);
                this.render();
            });

            volHeader.createSpan({ text: isExpanded ? '▼' : '▶', attr: { style: 'margin-right:8px; font-size:0.8em; min-width:16px;' } });
            volHeader.createSpan({ text: `第${vol.volNum}卷`, attr: { style: 'font-weight:700; color:var(--text-accent); margin-right:8px;' } });
            volHeader.createSpan({ text: vol.volName || '(未命名)', attr: { style: 'color:var(--text-normal); font-weight:600; margin-right:12px;' } });
            volHeader.createSpan({ text: `${vol.chapters.length}章`, attr: { style: 'font-size:0.78em; color:var(--text-faint);' } });

            if (!isExpanded) continue;

            // ── 卷概览面板（v3.4.8） ──
            const hasOverview = vol.coreConflict || vol.chapterRange;
            if (hasOverview) {
                const overviewBox = treeContainer.createDiv({
                    attr: { style: 'margin:2px 4px 8px 28px; padding:8px 10px; border-radius:6px; background:rgba(var(--color-accent-rgb, 100,140,255), 0.06); border-left:3px solid var(--text-accent); font-size:0.82em; line-height:1.5;' }
                });
                if (vol.chapterRange) {
                    overviewBox.createSpan({ text: '📐 ', attr: { style: 'font-size:0.9em;' } });
                    overviewBox.createSpan({ text: vol.chapterRange, attr: { style: 'color:var(--text-faint);' } });
                }
                if (vol.coreConflict) {
                    if (vol.chapterRange) overviewBox.createEl('br');
                    overviewBox.createSpan({ text: '🎯 ', attr: { style: 'font-size:0.9em;' } });
                    overviewBox.createSpan({ text: vol.coreConflict, attr: { style: 'color:var(--text-muted);' } });
                }
                // 章节数统计
                if (this.hasRangeFilter()) {
                    const matchedInVol = vol.chapters.filter(c => this.isInRange(c.chapNum)).length;
                    overviewBox.createEl('br');
                    overviewBox.createSpan({ text: `🔍 匹配 ${matchedInVol}/${vol.chapters.length} 章`, attr: { style: 'color:var(--text-accent); font-size:0.85em;' } });
                }
            }

            // ── 章节列表 ──
            for (let ci = 0; ci < vol.chapters.length; ci++) {
                const chap = vol.chapters[ci];
                if (this.hasRangeFilter() && !this.isInRange(chap.chapNum)) continue;

                totalVisible++;
                const isTarget = (this.rangeFrom > 0 && chap.chapNum === this.rangeFrom) ||
                    (this.rangeTo > 0 && chap.chapNum === this.rangeTo);

                const conflictPreview = chap.conflict.length > 70 ? chap.conflict.substring(0, 70) + '...' : chap.conflict;

                const chapRow = treeContainer.createDiv({
                    attr: { style: `display:flex; align-items:flex-start; padding:4px 8px 4px 36px; margin:1px 0; border-radius:4px; font-size:0.84em; ${isTarget ? 'background:rgba(245,158,11,0.18); border-left:3px solid #f59e0b;' : ''}` }
                });

                // 章号
                chapRow.createSpan({
                    text: `第${chap.chapNum}章`,
                    attr: { style: 'font-weight:600; white-space:nowrap; margin-right:8px; min-width:48px; color:var(--text-accent);' }
                });

                // 冲突文本（可编辑）
                const conflictSpan = chapRow.createSpan({
                    text: conflictPreview,
                    attr: {
                        style: 'flex:1; cursor:pointer; padding:2px 4px; border-radius:3px; border:1px solid transparent;',
                        title: chap.conflict
                    }
                });
                conflictSpan.addEventListener('click', () => this.startEdit(chapRow, conflictSpan, chap));

                // 编辑按钮
                const editBtn = chapRow.createSpan({
                    text: '✏️',
                    attr: { style: 'cursor:pointer; opacity:0.5; font-size:0.8em; margin-left:6px;' }
                });
                editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.startEdit(chapRow, conflictSpan, chap); });
            }
        }

        // 筛选结果
        if (this.hasRangeFilter() && totalVisible === 0) {
            treeContainer.createEl('p', { text: '未找到匹配的章节区间。', attr: { style: 'padding:20px; color:var(--text-muted); text-align:center;' } });
        } else if (this.hasRangeFilter()) {
            treeContainer.createDiv({
                text: `匹配 ${totalVisible} 个章节`,
                attr: { style: 'padding:4px 8px; font-size:0.8em; color:var(--text-faint); text-align:right;' }
            });
        }

        // ── 底部按钮 ──
        const footer = contentEl.createDiv({ attr: { style: 'display:flex; justify-content:flex-end; gap:8px; padding-top:12px; border-top:1px solid var(--background-modifier-border);' } });

        const cancelBtn = footer.createEl('button', {
            text: '✕ 关闭', attr: { style: 'padding:6px 16px; border-radius:6px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);' }
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = footer.createEl('button', {
            text: '💾 保存所有修改', attr: { style: 'padding:6px 16px; background:var(--text-accent); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:600;' }
        });
        saveBtn.addEventListener('click', () => this.saveAll());
    }

    /** 开始内联编辑 */
    private startEdit(container: HTMLElement, displaySpan: HTMLElement, chap: ChapterNode): void {
        container.querySelectorAll('.nw-inline-editor').forEach(el => el.remove());
        displaySpan.style.display = 'none';

        const editorWrap = container.createDiv({ cls: 'nw-inline-editor', attr: { style: 'flex:1; display:flex; gap:4px;' } });
        const input = editorWrap.createEl('input', {
            attr: { style: 'flex:1; padding:2px 6px; border-radius:3px; border:1px solid var(--text-accent); font-size:0.85em; background:var(--background-primary);' },
            value: chap.conflict
        });
        input.focus();

        const confirmBtn = editorWrap.createEl('button', {
            text: '✓', attr: { style: 'padding:2px 6px; background:var(--text-success); color:white; border:none; border-radius:3px; cursor:pointer; font-size:0.8em;' }
        });
        confirmBtn.addEventListener('click', () => {
            const newVal = input.value.trim();
            if (newVal) {
                chap.conflict = newVal;
                displaySpan.textContent = newVal.length > 70 ? newVal.substring(0, 70) + '...' : newVal;
                new Notice('✅ 冲突已修改（点击"保存所有修改"写入文件）', 2000);
            }
            this.finishEdit(container, displaySpan);
        });

        const cancelEditBtn = editorWrap.createEl('button', {
            text: '✕', attr: { style: 'padding:2px 6px; background:var(--background-modifier-border); border:none; border-radius:3px; cursor:pointer; font-size:0.8em;' }
        });
        cancelEditBtn.addEventListener('click', () => this.finishEdit(container, displaySpan));

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') confirmBtn.click();
            else if (e.key === 'Escape') cancelEditBtn.click();
        });
    }

    private finishEdit(container: HTMLElement, displaySpan: HTMLElement): void {
        container.querySelectorAll('.nw-inline-editor').forEach(el => el.remove());
        displaySpan.style.display = '';
    }

    /** 保存所有修改到分卷大纲文件 */
    private async saveAll(): Promise<void> {
        try {
            // 按来源文件分组收集编辑，逐文件回写（v4.0 多卷归档）
            const editsBySource = new Map<number, { lineIdx: number; newLine: string }[]>();
            let totalEdits = 0;

            for (const vol of this.volumes) {
                for (const chap of vol.chapters) {
                    const src = this.sources[chap.sourceIdx];
                    if (!src) continue;
                    const oldLine = src.lines[chap.rowLine];
                    const newLine = oldLine.replace(/^\|\s*\d+\s*\|.+\|$/, `| ${chap.chapNum} | ${chap.conflict} |`);
                    if (newLine !== oldLine) {
                        if (!editsBySource.has(chap.sourceIdx)) editsBySource.set(chap.sourceIdx, []);
                        editsBySource.get(chap.sourceIdx)!.push({ lineIdx: chap.rowLine, newLine });
                        totalEdits++;
                    }
                }
            }

            for (const [srcIdx, edits] of editsBySource) {
                const src = this.sources[srcIdx];
                edits.sort((a, b) => b.lineIdx - a.lineIdx);
                for (const edit of edits) {
                    src.lines[edit.lineIdx] = edit.newLine;
                }
                await this.app.vault.adapter.write(src.path, src.lines.join('\n'));
            }

            new Notice(`✅ 已保存 ${totalEdits} 处修改到分卷大纲`, 3000);
        } catch (e) {
            console.error('[OutlineTree] 保存失败:', e);
            new Notice('❌ 保存失败: ' + (e as Error).message, 5000);
        }
    }

    private injectStyles(): void {
        const styleId = 'nw-outline-tree-styles';
        if (document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .nw-outline-tree-modal input:focus {
                outline: none;
                box-shadow: 0 0 0 2px var(--text-accent);
            }
            .nw-outline-tree-modal input[type="number"]::-webkit-inner-spin-button,
            .nw-outline-tree-modal input[type="number"]::-webkit-outer-spin-button {
                opacity: 0.5;
            }
        `;
        document.head.appendChild(style);
    }
}
