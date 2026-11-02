/**
 * plot-canvas-modal.ts — 可视化情节画布（P1-1）
 *
 * 把分卷大纲的「卷 → 章 → 场景」结构渲染为「卡片 + 连线」的画布：
 * - 章节卡片按卷分组，纵向流式排列，卡片间箭头连线表示推进顺序
 * - 卷分组着色 + 关键场景（⭐）高亮
 * - 章节卡片可拖拽重排（同卷内 + 跨卷），保存后回写分卷大纲文件
 *
 * 数据来源复用 ChapterOutlineTreeModal 的分卷大纲解析逻辑（从「第N卷_分卷大纲.md」读取）。
 * 独立实现，不修改 ChapterOutlineTreeModal，零新依赖。
 */

import { App, Modal, Notice, TFile } from 'obsidian';
import type NovelWriterPlugin from '../main';
import { pjVolumeOutlineDir, pjStepDir } from '../shared/paths';
import { createLogger } from '../shared/logger';
import { writeVaultText } from '../shared/file-system-port';
import { parseVolumeOutline, type VolumeNode, type ChapterNode } from './plot-canvas-parser';

const log = createLogger('PlotCanvasModal');

/** 大纲来源文件 */
interface OutlineSource {
    path: string;
    lines: string[];
}

/** 卷分组配色（循环使用） */
const VOLUME_COLORS = [
    '--nw-accent',
    '--color-green',
    '--color-blue',
    '--color-purple',
    '--color-orange',
    '--color-pink',
];

/**
 * PlotCanvasModal 类。
 */
export class PlotCanvasModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    private sources: OutlineSource[] = [];
    private volumes: VolumeNode[] = [];
    private dragState: { volIndex: number; chapIndex: number } = { volIndex: -1, chapIndex: -1 };
    private density: 'compact' | 'normal' | 'spacious' = 'normal';

    constructor(app: App, plugin: NovelWriterPlugin, project: string) {
        super(app);
        this.plugin = plugin;
        this.project = project;
    }

    /**
     * onOpen 方法。
     */
    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-plot-canvas');
        contentEl.createEl('h2', { text: '🗺️ 情节画布' });

        await this.loadOutline();

        if (this.volumes.length === 0) {
            contentEl.createEl('p', { text: '⚠️ 未找到分卷大纲，请先执行「全书规划」步骤。', attr: { style: 'padding:20px;color:var(--text-muted);' } });
            return;
        }

        const total = this.volumes.reduce((s, v) => s + v.chapters.length, 0);
        contentEl.createEl('p', { text: `共 ${this.volumes.length} 卷 · ${total} 章 · 拖拽章节卡片可重排顺序`, cls: 'nw-plot-canvas-hint' });

        this.renderToolbar(contentEl);
        this.renderCanvas(contentEl);
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }

    // ===================== 视图配置（密度切换） + 导出 =====================

    private renderToolbar(container: HTMLElement): void {
        const bar = container.createDiv({ cls: 'nw-plot-toolbar' });
        bar.createSpan({ cls: 'nw-plot-toolbar-label', text: '密度' });
        const densities: Array<{ id: 'compact' | 'normal' | 'spacious'; label: string }> = [
            { id: 'compact', label: '紧凑' },
            { id: 'normal', label: '标准' },
            { id: 'spacious', label: '宽松' },
        ];
        for (let i = 0; i < densities.length; i++) {
            const d = densities[i];
            const btn = bar.createEl('button', {
                text: d.label,
                cls: 'nw-plot-toolbar-btn' + (this.density === d.id ? ' is-active' : ''),
            });
            btn.addEventListener('click', () => {
                if (this.density === d.id) return;
                this.density = d.id;
                this.applyDensity();
                bar.querySelectorAll('.nw-plot-toolbar-btn').forEach((el, idx) => {
                    el.toggleClass('is-active', idx === i);
                });
            });
        }
        const exportBtn = bar.createEl('button', { text: '📤 导出大纲', cls: 'nw-plot-toolbar-btn nw-plot-export-btn' });
        exportBtn.addEventListener('click', () => void this.exportMarkdown());
    }

    private applyDensity(): void {
        this.contentEl.removeClass('nw-plot-density-compact', 'nw-plot-density-normal', 'nw-plot-density-spacious');
        this.contentEl.addClass(`nw-plot-density-${this.density}`);
    }

    private async exportMarkdown(): Promise<void> {
        const lines: string[] = ['# 章节大纲', ''];
        for (const vol of this.volumes) {
            lines.push(`## 第${vol.volNum}卷${vol.volName ? ' · ' + vol.volName : ''}`);
            for (const chap of vol.chapters) {
                lines.push(`- 第${chap.chapNum}章 ${chap.conflict || ''}`.trimEnd());
            }
            lines.push('');
        }
        const md = lines.join('\n').trim();
        try {
            await navigator.clipboard.writeText(md);
            new Notice('✅ 大纲已复制到剪贴板');
        } catch {
            new Notice('❌ 复制失败，请手动复制');
        }
    }

    // ===================== 数据加载 =====================

    private async loadOutline(): Promise<void> {
        try {
            this.sources = [];
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
            this.parseContent();
            await this.loadKeySceneCounts();
        } catch (e) {
            log.error('[PlotCanvas] 读取分卷大纲失败:', e);
        }
    }

    /** 解析卷标题 + 章节表格行 */
    private parseContent(): void {
        this.volumes = [];
        for (let srcIdx = 0; srcIdx < this.sources.length; srcIdx++) {
            this.volumes.push(...parseVolumeOutline(this.sources[srcIdx].lines, srcIdx));
        }
        log.info('[PlotCanvas] 解析完成:', this.volumes.length, '卷,', this.volumes.reduce((s, v) => s + v.chapters.length, 0), '章');
    }

    /** 统计每章关键场景数量（⭐/名场面） */
    private async loadKeySceneCounts(): Promise<void> {
        for (const vol of this.volumes) {
            for (const chap of vol.chapters) {
                const scenePath = `${pjStepDir(this.project, vol.volNum, chap.chapNum)}/第${chap.chapNum}章_Scene展开.md`;
                const file = this.app.vault.getAbstractFileByPath(scenePath);
                if (!(file instanceof TFile)) continue;
                try {
                    const content = await this.app.vault.read(file);
                    chap.keySceneCount = (content.match(/key_scene\s*[：:]\s*(⭐|名场面)/g) || []).length;
                } catch { /* 忽略单章读取失败 */ }
            }
        }
    }

    // ===================== 渲染 =====================

    private renderCanvas(container: HTMLElement): void {
        for (let vi = 0; vi < this.volumes.length; vi++) {
            const vol = this.volumes[vi];
            const volSection = container.createDiv({ cls: 'nw-plot-vol' });
            const colorVar = VOLUME_COLORS[vi % VOLUME_COLORS.length];

            const volHeader = volSection.createDiv({ cls: 'nw-plot-vol-header' });
            volHeader.createSpan({ cls: 'nw-plot-vol-badge', text: `第${vol.volNum}卷` });
            volHeader.createSpan({ cls: 'nw-plot-vol-name', text: vol.volName || '未命名卷' });
            volHeader.createSpan({ cls: 'nw-plot-vol-count', text: `${vol.chapters.length} 章` });

            const flow = volSection.createDiv({ cls: 'nw-plot-flow' });
            for (let ci = 0; ci < vol.chapters.length; ci++) {
                const chap = vol.chapters[ci];
                const card = flow.createDiv({ cls: 'nw-plot-chapter', attr: { draggable: 'true' } });
                card.style.setProperty('--nw-plot-accent', `var(${colorVar}, var(--interactive-accent))`);

                const num = card.createDiv({ cls: 'nw-plot-chap-num', text: `#${chap.chapNum}` });
                const conflict = card.createDiv({ cls: 'nw-plot-chap-conflict', text: chap.conflict || '（无冲突描述）' });
                if (chap.keySceneCount > 0) {
                    card.createDiv({ cls: 'nw-plot-chap-key', text: `⭐ ${chap.keySceneCount} 个名场面` });
                }

                card.setAttr('data-vol', String(vi));
                card.setAttr('data-chap', String(ci));
                this.bindDrag(card, vi, ci);

                // 章节之间连线箭头
                if (ci < vol.chapters.length - 1) {
                    flow.createDiv({ cls: 'nw-plot-arrow', text: '→' });
                }
            }
        }
    }

    // ===================== 拖拽重排 =====================

    private bindDrag(card: HTMLElement, vi: number, ci: number): void {
        card.addEventListener('dragstart', (e) => {
            this.dragState = { volIndex: vi, chapIndex: ci };
            card.addClass('nw-plot-dragging');
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
            this.dragState = { volIndex: -1, chapIndex: -1 };
            card.removeClass('nw-plot-dragging');
            this.contentEl.querySelectorAll('.nw-plot-drag-over').forEach(el => el.removeClass('nw-plot-drag-over'));
        });
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            card.addClass('nw-plot-drag-over');
        });
        card.addEventListener('dragleave', () => card.removeClass('nw-plot-drag-over'));
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            this.handleDrop(vi, ci);
        });
    }

    private handleDrop(targetVol: number, targetChap: number): void {
        const { volIndex, chapIndex } = this.dragState;
        if (volIndex < 0 || chapIndex < 0) return;
        if (volIndex === targetVol && chapIndex === targetChap) return;

        const srcVol = this.volumes[volIndex];
        const [moved] = srcVol.chapters.splice(chapIndex, 1);
        if (!moved) return;

        // 计算目标插入索引（跨卷时原数组已减一）
        let insertIdx = targetChap;
        if (volIndex === targetVol && chapIndex < targetChap) insertIdx = targetChap - 1;

        this.volumes[targetVol].chapters.splice(insertIdx, 0, moved);
        void this.saveAll();
        this.refresh();
    }

    private refresh(): void {
        this.contentEl.empty();
        this.contentEl.addClass('nw-plot-canvas');
        this.applyDensity();
        this.contentEl.createEl('h2', { text: '🗺️ 情节画布' });
        const total = this.volumes.reduce((s, v) => s + v.chapters.length, 0);
        this.contentEl.createEl('p', { text: `共 ${this.volumes.length} 卷 · ${total} 章 · 拖拽章节卡片可重排顺序`, cls: 'nw-plot-canvas-hint' });
        this.renderToolbar(this.contentEl);
        this.renderCanvas(this.contentEl);
    }

    // ===================== 回写 =====================

    private async saveAll(): Promise<void> {
        try {
            // 重新编号所有章节
            let currentChapNum = 1;
            for (const vol of this.volumes) {
                for (const chap of vol.chapters) {
                    chap.chapNum = currentChapNum++;
                }
            }

            const editsBySource = new Map<number, { lineIdx: number; newLine: string }[]>();
            let totalEdits = 0;

            for (const vol of this.volumes) {
                for (const chap of vol.chapters) {
                    const src = this.sources[chap.sourceIdx];
                    if (!src || chap.rowLine < 0) continue;
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
                for (const edit of edits) {
                    this.sources[srcIdx].lines[edit.lineIdx] = edit.newLine;
                }
            }
            for (let i = 0; i < this.sources.length; i++) {
                await writeVaultText(this.app, this.sources[i].path, this.sources[i].lines.join('\n'));
            }

            new Notice(`✅ 已重排并保存 ${totalEdits} 处章节顺序`, 3000);
        } catch (e) {
            log.error('[PlotCanvas] 保存失败:', e);
            new Notice('❌ 保存失败: ' + (e as Error).message, 5000);
        }
    }
}

/**
 * 打开情节画布
 *
 * @param plugin - 插件实例
 * @param project - 项目（路径或对象）
 */
export function openPlotCanvas(plugin: NovelWriterPlugin, project: string): void {
    new PlotCanvasModal(plugin.app, plugin, project).open();
}
