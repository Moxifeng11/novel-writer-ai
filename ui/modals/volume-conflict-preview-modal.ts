/**
 * volume-conflict-preview-modal.ts — 卷冲突预览 Modal
 *
 * 用途：在重新生成大纲或调整分卷结构前，向用户展示数据层与目标配置的冲突分析，
 *       并让用户选择处理策略（智能合并 / 完全覆盖 / 手动调整）。
 */

import { App, Modal } from 'obsidian';
import {
    VolumeConflictInfo,
    VolumeConflictResolution,
} from '../../shared/volume-conflict-detector';

/** Modal 关闭后的结果 */
export interface VolumeConflictModalResult {
    /** 用户选择的处理策略 */
    resolution: VolumeConflictResolution;
    /** 冲突信息快照 */
    conflictInfo: VolumeConflictInfo;
    /** 仅当 resolution === 'manual_adjust' 时提供：导出的冲突报告文本 */
    reportText?: string;
}

/**
 * 卷冲突预览 Modal
 *
 * 使用方式：
 * ```ts
 * const modal = new VolumeConflictPreviewModal(app, conflictInfo);
 * const result = await modal.openAndAwait();
 * ```
 */
export class VolumeConflictPreviewModal extends Modal {
    private conflictInfo: VolumeConflictInfo;
    private resolvePromise?: (result: VolumeConflictModalResult) => void;
    private rejectPromise?: (reason?: unknown) => void;

    constructor(app: App, conflictInfo: VolumeConflictInfo) {
        super(app);
        this.conflictInfo = conflictInfo;
    }

    /**
     * 打开 Modal 并等待用户做出选择。
     * @returns Promise<VolumeConflictModalResult>
     */
    openAndAwait(): Promise<VolumeConflictModalResult> {
        return new Promise((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;
            this.open();
        });
    }

    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();

        // ── 标题 ──
        contentEl.createEl('h2', { text: '⚠️ 卷结构冲突预览' });

        // ── 当前状态 ──
        const existing = this.conflictInfo.existingVolumes;
        contentEl.createEl('h3', {
            text: '📂 当前状态（数据层）',
            attr: { style: 'margin-bottom:6px;' },
        });
        const existingDesc = contentEl.createEl('p', {
            text: `已有 ${existing.volumeCount} 卷，共 ${existing.chaptersPerVolume.reduce((a, b) => a + b, 0)} 章。`,
            attr: { style: 'margin-top:0; color:var(--text-muted);' },
        });
        if (existing.volumeFiles.length > 0) {
            const existingList = contentEl.createEl('ul', {
                attr: { style: 'margin:4px 0 12px 16px; padding:0; color:var(--text-muted); font-size:13px;' },
            });
            for (const vol of existing.volumeFiles) {
                existingList.createEl('li', {
                    text: `${vol.volumeName}：${vol.chapterCount} 章`,
                });
            }
        }

        // ── 新大纲配置 ──
        contentEl.createEl('h3', {
            text: '📋 新大纲配置',
            attr: { style: 'margin-bottom:6px;' },
        });
        const newTotal = this.conflictInfo.newConfigChaptersPerVolume.reduce(
            (a, b) => a + b,
            0
        );
        contentEl.createEl('p', {
            text: `将生成 ${this.conflictInfo.newConfigVolumes} 卷，共 ${newTotal} 章。`,
            attr: { style: 'margin-top:0; color:var(--text-muted);' },
        });
        if (this.conflictInfo.newConfigChaptersPerVolume.length > 0) {
            const newList = contentEl.createEl('ul', {
                attr: { style: 'margin:4px 0 12px 16px; padding:0; color:var(--text-muted); font-size:13px;' },
            });
            this.conflictInfo.newConfigChaptersPerVolume.forEach((chapCount, idx) => {
                newList.createEl('li', {
                    text: `第${idx + 1}卷：${chapCount} 章`,
                });
            });
        }

        // ── 冲突分析 ──
        contentEl.createEl('h3', {
            text: '🔍 冲突分析',
            attr: { style: 'margin-bottom:6px;' },
        });
        const analysisBox = contentEl.createDiv({
            attr: {
                style: 'background:var(--background-modifier-form-field); border-radius:6px; padding:10px 12px; margin-bottom:16px; font-size:13px; line-height:1.6;',
            },
        });
        analysisBox.createEl('p', {
            text: this.conflictInfo.message,
            attr: { style: 'margin:0 0 8px 0;' },
        });

        const d = this.conflictInfo.details;
        if (d.addedVolumes && d.addedVolumes.length > 0) {
            analysisBox.createEl('div', {
                text: `➕ 新增卷：第 ${d.addedVolumes.join('、')} 卷`,
                attr: { style: 'color:var(--text-success); margin-bottom:4px;' },
            });
        }
        if (d.removedVolumes && d.removedVolumes.length > 0) {
            analysisBox.createEl('div', {
                text: `➖ 删除卷：第 ${d.removedVolumes.join('、')} 卷`,
                attr: { style: 'color:var(--text-error); margin-bottom:4px;' },
            });
        }
        if (d.overlappingVolumes && d.overlappingVolumes.length > 0) {
            analysisBox.createEl('div', {
                text: `🔄 章节重叠卷：第 ${d.overlappingVolumes.join('、')} 卷`,
                attr: { style: 'color:var(--text-accent); margin-bottom:4px;' },
            });
        }
        if (d.chapterMismatches && d.chapterMismatches.length > 0) {
            const mmDiv = analysisBox.createEl('div', {
                attr: { style: 'color:var(--text-warning); margin-bottom:4px;' },
            });
            mmDiv.createEl('span', { text: '⚠️ 章节数不一致：' });
            const mmList = mmDiv.createEl('span');
            mmList.setText(
                d.chapterMismatches
                    .map(m => `第${m.volumeNumber}卷（${m.existing}→${m.planned}）`)
                    .join('、')
            );
        }

        if (this.conflictInfo.conflictType === 'none') {
            analysisBox.createEl('div', {
                text: '✅ 无冲突，可直接应用新大纲。',
                attr: { style: 'color:var(--text-success);' },
            });
        }

        // ── 操作按钮 ──
        const buttonRow = contentEl.createDiv({
            attr: {
                style: 'display:flex; gap:10px; margin-top:20px; flex-wrap:wrap;',
            },
        });

        // 1. 智能合并
        const smartBtn = buttonRow.createEl('button', {
            text: '🧠 智能合并',
            cls: 'nw-btn nw-btn-primary novel-writer-primary-button',
            attr: { style: 'flex:1; min-width:120px;' },
        });
        smartBtn.onclick = () => {
            this.resolve({
                resolution: 'smart_merge',
                conflictInfo: this.conflictInfo,
            });
        };

        // 2. 完全覆盖
        const overrideBtn = buttonRow.createEl('button', {
            text: '⚡ 完全覆盖',
            cls: 'nw-btn nw-btn-danger',
            attr: { style: 'flex:1; min-width:120px; --background-modifier-error:#d73a49; color:var(--text-on-accent);' },
        });
        overrideBtn.onclick = () => {
            this.resolve({
                resolution: 'full_override',
                conflictInfo: this.conflictInfo,
            });
        };

        // 3. 手动调整
        const manualBtn = buttonRow.createEl('button', {
            text: '📝 手动调整',
            cls: 'nw-btn nw-btn-secondary',
            attr: { style: 'flex:1; min-width:120px;' },
        });
        manualBtn.onclick = () => {
            const reportText = this.generateConflictReport();
            this.resolve({
                resolution: 'manual_adjust',
                conflictInfo: this.conflictInfo,
                reportText,
            });
        };

        // ── 取消按钮 ──
        const cancelRow = contentEl.createDiv({
            attr: {
                style: 'display:flex; justify-content:center; margin-top:12px;',
            },
        });
        const cancelBtn = cancelRow.createEl('button', {
            text: '取消',
            cls: 'nw-btn nw-btn-ghost',
            attr: { style: 'font-size:13px; padding:4px 16px;' },
        });
        cancelBtn.onclick = () => {
            this.rejectPromise?.('用户取消');
            this.close();
        };
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        // 如果用户直接点击遮罩关闭且未做出选择，则 reject
        if (this.rejectPromise) {
            this.rejectPromise('Modal closed without selection');
            this.rejectPromise = undefined;
            this.resolvePromise = undefined;
        }
    }

    private resolve(result: VolumeConflictModalResult): void {
        if (this.resolvePromise) {
            this.resolvePromise(result);
            this.resolvePromise = undefined;
            this.rejectPromise = undefined;
        }
        this.close();
    }

    /** 生成可供导出的冲突报告文本 */
    private generateConflictReport(): string {
        const ci = this.conflictInfo;
        const lines: string[] = [];
        lines.push('# 卷冲突报告');
        lines.push(`> 生成时间：${new Date().toLocaleString()}`);
        lines.push('');
        lines.push('## 当前状态（数据层）');
        lines.push(`- 卷数：${ci.existingVolumes.volumeCount}`);
        lines.push(`- 总章数：${ci.existingVolumes.chaptersPerVolume.reduce((a, b) => a + b, 0)}`);
        for (const vol of ci.existingVolumes.volumeFiles) {
            lines.push(`- ${vol.volumeName}：${vol.chapterCount} 章`);
        }
        lines.push('');
        lines.push('## 新大纲配置');
        lines.push(`- 卷数：${ci.newConfigVolumes}`);
        lines.push(`- 总章数：${ci.newConfigChaptersPerVolume.reduce((a, b) => a + b, 0)}`);
        ci.newConfigChaptersPerVolume.forEach((count, idx) => {
            lines.push(`- 第${idx + 1}卷：${count} 章`);
        });
        lines.push('');
        lines.push('## 冲突分析');
        lines.push(ci.message);
        if (ci.details.addedVolumes?.length) {
            lines.push(`- 新增卷：第 ${ci.details.addedVolumes.join('、')} 卷`);
        }
        if (ci.details.removedVolumes?.length) {
            lines.push(`- 删除卷：第 ${ci.details.removedVolumes.join('、')} 卷`);
        }
        if (ci.details.overlappingVolumes?.length) {
            lines.push(`- 重叠卷：第 ${ci.details.overlappingVolumes.join('、')} 卷`);
        }
        if (ci.details.chapterMismatches?.length) {
            for (const m of ci.details.chapterMismatches) {
                lines.push(`- 第${m.volumeNumber}卷章节数不匹配：现有 ${m.existing} 章 → 规划 ${m.planned} 章`);
            }
        }
        lines.push('');
        lines.push('## 建议操作');
        lines.push('1. **智能合并**：保留已有章节正文，仅更新大纲结构；多余卷移动到 `volumes_archive/`。');
        lines.push('2. **完全覆盖**：删除旧数据，按新大纲重新生成。');
        lines.push('3. **手动调整**：基于本报告在文件系统中手动调整卷结构后再重试。');
        lines.push('');
        return lines.join('\n');
    }
}
