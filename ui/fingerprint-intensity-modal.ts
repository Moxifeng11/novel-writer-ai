/**
 * fingerprint-intensity-modal.ts — 写作指纹 V2 风格迁移强度调节 Modal（Task 7）
 *
 * 设计要点：
 *   - 全局强度滑动条 0-100% 连续可调
 *   - 三档预设：轻微（25%）/ 中等（50%）/ 深度（80%）
 *   - 高级模式开关 + 12 维度独立强度滑块
 *   - 实时预览：描述长度/示例数量/相似度阈值/prompt 强调文本
 *   - 保存按钮调用 library.setIntensityConfig(fpId, config, project)
 *
 * 调用关系：
 *   - library.getIntensityConfig(fpId) 读取当前配置
 *   - library.previewIntensity(config) 实时预览效果（同步，<1ms）
 *   - library.setIntensityConfig(fpId, config, project) 持久化
 *   - intensityEngine.getConfigFromPreset(preset) 应用预设
 *
 * @see StyleFingerprintLibrary.getIntensityConfig / setIntensityConfig / previewIntensity
 * @see StyleIntensityEngine.previewIntensity / getConfigFromPreset
 */

import { App, Modal, Notice } from 'obsidian';
import { StyleFingerprintLibrary, StyleFingerprint } from '@/engine/style-fingerprint-library';
import { createLogger } from '@/shared/logger';

const log = createLogger('FingerprintIntensityModal');
import {
    StyleIntensityConfig,
    StyleIntensityPreview,
    IntensityPreset,
    INTENSITY_PRESETS,
    INTENSITY_PRESET_LABELS,
    DEFAULT_INTENSITY_CONFIG,
} from '@/engine/style/style-intensity-engine';
import {
    StyleDimensionKeyV2,
    STYLE_DIMENSIONS_V2,
    STYLE_DIMENSION_LABELS_V2,
} from '@/engine/style/style-dimensions-v2';

/**
 * FingerprintIntensityModalOptions 类型定义。
 */
export interface FingerprintIntensityModalOptions {
    /** 目标指纹 */
    fingerprint: StyleFingerprint;
    /** 指纹库实例 */
    library: StyleFingerprintLibrary;
    /** 项目路径（用于持久化） */
    project?: string;
    /** 保存成功回调 */
    onSaved?: (config: StyleIntensityConfig) => void;
}

/**
 * FingerprintIntensityModal 类。
 */
export class FingerprintIntensityModal extends Modal {
    private options: FingerprintIntensityModalOptions;
    /** 当前编辑中的配置（未保存） */
    private currentConfig: StyleIntensityConfig;
    /** 高级模式开关 */
    private advancedMode = false;
    /**
     * 全局指纹的强度作用范围（v4.83.1）。
     *
     * `false`（默认）→ 写全局默认，所有项目生效；
     * `true` → 只写本项目覆盖，其他项目仍用全局默认。
     * 项目层指纹始终写项目文件，本开关不参与。
     */
    private useProjectOverride = false;

    constructor(app: App, options: FingerprintIntensityModalOptions) {
        super(app);
        this.options = options;
        // 读取现有配置作为初始值（两层：项目覆盖 → 全局默认 → 引擎默认）
        this.currentConfig = {
            ...DEFAULT_INTENSITY_CONFIG,
            ...options.library.getIntensityConfig(options.fingerprint.id, options.project),
        };
        // 全局指纹的作用范围：已存在项目覆盖时默认「仅本项目」，否则默认「全局」
        this.useProjectOverride = options.fingerprint.scope === 'global'
            && options.library.hasIntensityOverride(options.fingerprint.id, options.project);
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
        this.modalEl.addClass('nw-scope');
        this.modalEl.addClass('nw-modal');
        this.render();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('nw-modal-content-85');

        const fp = this.options.fingerprint;
        contentEl.createEl('h3', {
            text: `🎚 风格强度调节`,
            attr: { style: 'margin-top:0;margin-bottom:8px;' }
        });
        contentEl.createEl('div', {
            text: `目标指纹：${fp.name}`,
            attr: { style: 'color:var(--text-muted);font-size:12px;margin-bottom:16px;' }
        });

        this.renderIntensityScope(contentEl);
        this.renderGlobalIntensity(contentEl);
        this.renderPresets(contentEl);
        this.renderPreview(contentEl);
        this.renderAdvancedToggle(contentEl);
        if (this.advancedMode) {
            this.renderAdvancedDimensions(contentEl);
        }
        this.renderActions(contentEl);
    }

    /**
     * 强度作用范围选择（v4.83.1）。
     *
     * 只对**全局指纹**显示：全局指纹跨项目通用，其强度有两层——
     * 全局默认（所有项目生效）与项目覆盖（只在本项目生效）。
     * 项目层指纹没有这个概念，直接不渲染。
     *
     * @param container - 容器
     */
    private renderIntensityScope(container: HTMLElement): void {
        const fp = this.options.fingerprint;
        if (fp.scope !== 'global') return;

        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;'
            }
        });
        section.createEl('div', {
            text: '作用范围',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:8px;' }
        });

        const makeOption = (value: boolean, label: string, hint: string): void => {
            const row = section.createDiv({
                attr: { style: 'display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;cursor:pointer;' }
            });
            const input = row.createEl('input', {
                attr: { type: 'radio', name: 'nw-intensity-scope', style: 'margin-top:2px;cursor:pointer;' }
            });
            input.checked = this.useProjectOverride === value;
            input.addEventListener('change', () => {
                if (!input.checked) return;
                this.useProjectOverride = value;
                this.render();
            });
            const textWrap = row.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
            textWrap.createEl('div', {
                text: label,
                attr: { style: 'font-size:12px;font-weight:500;' }
            });
            textWrap.createEl('div', {
                text: hint,
                attr: { style: 'font-size:11px;color:var(--text-muted);line-height:1.4;' }
            });
        };

        makeOption(false, '全局默认（所有项目生效）', '保存后，其他项目里这个全局指纹也用这套强度。');
        makeOption(true, '仅本项目（覆盖全局默认）', '其他项目继续使用全局默认强度，本项目的调整不影响它们。');

        // 已有项目覆盖时提供「恢复跟随全局」的快捷入口
        if (this.options.project && this.options.library.hasIntensityOverride(fp.id, this.options.project)) {
            const resetBtn = section.createEl('button', {
                text: '恢复跟随全局默认',
                attr: {
                    type: 'button',
                    style: 'margin-top:4px;padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;background:transparent;color:var(--text-muted);'
                }
            });
            resetBtn.addEventListener('click', async () => {
                try {
                    await this.options.library.removeIntensityConfig(fp.id, this.options.project);
                    new Notice('已移除本项目的强度覆盖，改为跟随全局默认');
                    this.useProjectOverride = false;
                    this.currentConfig = {
                        ...DEFAULT_INTENSITY_CONFIG,
                        ...this.options.library.getIntensityConfig(fp.id, this.options.project),
                    };
                    this.render();
                } catch (e) {
                    log.warn('[FingerprintIntensityModal] 移除项目覆盖失败:', e);
                    new Notice('移除项目覆盖失败，请查看控制台');
                }
            });
        }
    }

    /** 全局强度滑动条 */
    private renderGlobalIntensity(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;'
            }
        });
        section.createEl('div', {
            text: '全局强度',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:10px;' }
        });

        const sliderRow = section.createDiv({
            attr: { style: 'display:flex;align-items:center;gap:12px;' }
        });

        const slider = sliderRow.createEl('input', {
            type: 'range',
            attr: {
                min: '0',
                max: '100',
                step: '1',
                value: String(Math.round(this.currentConfig.globalIntensity * 100)),
                style: 'flex:1;cursor:pointer;'
            }
        });

        const valueLabel = sliderRow.createEl('span', {
            text: `${Math.round(this.currentConfig.globalIntensity * 100)}%`,
            attr: {
                style: 'min-width:50px;text-align:right;font-weight:600;font-size:13px;color:var(--interactive-accent);'
            }
        });

        slider.addEventListener('input', () => {
            const v = parseInt(slider.value, 10) / 100;
            this.currentConfig.globalIntensity = v;
            // 手动调整后清除预设标记
            this.currentConfig.preset = undefined;
            valueLabel.textContent = `${Math.round(v * 100)}%`;
            this.updatePreview();
            this.updatePresetButtons();
        });
    }

    /** 三档预设按钮 */
    private renderPresets(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;'
            }
        });

        const presets: IntensityPreset[] = ['light', 'medium', 'deep'];
        presets.forEach(preset => {
            const btn = section.createEl('button', {
                text: `${INTENSITY_PRESET_LABELS[preset]}（${Math.round(INTENSITY_PRESETS[preset] * 100)}%）`,
                cls: 'nw-preset-btn nw-preset-btn-lg',
                attr: {
                    type: 'button',
                    'data-preset': preset,
                },
            });
            btn.toggleClass('nw-is-active', this.currentConfig.preset === preset);
            btn.addEventListener('click', () => {
                this.currentConfig = {
                    globalIntensity: INTENSITY_PRESETS[preset],
                    preset,
                    // 保留已有的维度独立强度
                    dimensionIntensities: this.currentConfig.dimensionIntensities,
                };
                this.render();
            });
        });

        // 关闭按钮（强度=0，完全禁用指纹影响）
        const disableBtn = section.createEl('button', {
            text: '禁用（0%）',
            cls: 'nw-preset-btn nw-preset-btn-lg nw-preset-btn-danger',
            attr: { type: 'button' },
        });
        disableBtn.toggleClass('nw-is-active', this.currentConfig.globalIntensity === 0);
        disableBtn.addEventListener('click', () => {
            this.currentConfig = {
                globalIntensity: 0,
                preset: undefined,
                dimensionIntensities: this.currentConfig.dimensionIntensities,
            };
            this.render();
        });
    }

    /** 更新预设按钮激活态（不重新渲染整个 Modal） */
    private updatePresetButtons(): void {
        this.contentEl.querySelectorAll('button[data-preset]').forEach(btn => {
            const preset = (btn as HTMLElement).dataset.preset as IntensityPreset;
            btn.toggleClass('nw-is-active', this.currentConfig.preset === preset);
        });
    }

    /** 实时预览效果参数 */
    private renderPreview(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-intensity-preview' });
        this.fillPreview(section);
    }

    /** 填充预览内容（renderPreview 与 updatePreview 共用，避免样式/结构两处漂移） */
    private fillPreview(section: HTMLElement): void {
        section.createDiv({
            cls: 'nw-intensity-preview-title',
            text: '强度效果预览',
        });

        const grid = section.createDiv({ cls: 'nw-intensity-preview-grid' });

        const preview = this.computePreview();
        const g = preview.global;

        this.appendPreviewRow(grid, '描述长度上限', `${g.descriptionLength} 字`);
        this.appendPreviewRow(grid, '示例数量上限', `${g.sampleCount} 段`);
        this.appendPreviewRow(grid, '相似度阈值', g.similarityThreshold.toFixed(2));
        this.appendPreviewRow(grid, 'Prompt 强调', g.promptEmphasis || '（无）');

        if (preview.disabled) {
            section.createDiv({
                cls: 'nw-intensity-preview-warning',
                text: '⚠ 当前强度为 0%，指纹影响已完全禁用',
            });
        }
    }

    private appendPreviewRow(container: HTMLElement, label: string, value: string): void {
        const row = container.createDiv({ cls: 'nw-intensity-preview-row' });
        row.createEl('span', { cls: 'nw-intensity-preview-label', text: `${label}:` });
        row.createEl('span', { cls: 'nw-intensity-preview-value', text: value });
    }

    /** 仅更新预览区块（避免重新渲染滑动条） */
    private updatePreview(): void {
        const previewEl = this.contentEl.querySelector('.nw-intensity-preview');
        if (!previewEl) {
            this.render();
            return;
        }
        const section = previewEl as HTMLElement;
        section.empty();
        this.fillPreview(section);
    }

    private computePreview(): StyleIntensityPreview {
        return this.options.library.previewIntensity(this.currentConfig);
    }

    /** 高级模式开关 */
    private renderAdvancedToggle(container: HTMLElement): void {
        const row = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;display:flex;align-items:center;gap:10px;'
            }
        });
        const checkbox = row.createEl('input', {
            type: 'checkbox',
            attr: { style: 'cursor:pointer;' }
        });
        checkbox.checked = this.advancedMode;
        checkbox.addEventListener('change', () => {
            this.advancedMode = checkbox.checked;
            this.render();
        });
        row.createEl('span', {
            text: '高级模式：12 维度独立强度调节',
            attr: { style: 'font-size:13px;cursor:pointer;' }
        });
    }

    /** 12 维度独立强度滑块 */
    private renderAdvancedDimensions(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;'
            }
        });
        section.createEl('div', {
            text: '12 维度独立强度',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:10px;' }
        });

        STYLE_DIMENSIONS_V2.forEach(dim => {
            const dimValue = this.currentConfig.dimensionIntensities?.[dim.key];
            const value = dimValue !== undefined ? dimValue : this.currentConfig.globalIntensity;

            const row = section.createDiv({
                attr: { style: 'margin-bottom:8px;' }
            });
            const header = row.createDiv({
                attr: { style: 'display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;' }
            });
            header.createEl('span', {
                text: `${dim.name}`,
                attr: { style: 'color:var(--text-normal);' }
            });
            const valueLabel = header.createEl('span', {
                text: `${Math.round(value * 100)}%`,
                attr: { style: 'color:var(--interactive-accent);font-weight:600;' }
            });

            const slider = row.createEl('input', {
                type: 'range',
                attr: {
                    min: '0',
                    max: '100',
                    step: '1',
                    value: String(Math.round(value * 100)),
                    'data-dim': dim.key,
                    style: 'width:100%;cursor:pointer;'
                }
            });

            slider.addEventListener('input', () => {
                const v = parseInt(slider.value, 10) / 100;
                if (!this.currentConfig.dimensionIntensities) {
                    this.currentConfig.dimensionIntensities = {};
                }
                this.currentConfig.dimensionIntensities[dim.key] = v;
                valueLabel.textContent = `${Math.round(v * 100)}%`;
            });
        });
    }

    /** 操作按钮 */
    private renderActions(container: HTMLElement): void {
        const btnRow = container.createDiv({
            attr: { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;' }
        });

        const resetBtn = btnRow.createEl('button', {
            text: '重置',
            attr: {
                type: 'button',
                style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);'
            }
        });
        resetBtn.addEventListener('click', () => {
            this.currentConfig = { ...DEFAULT_INTENSITY_CONFIG };
            this.advancedMode = false;
            this.render();
        });

        const saveBtn = btnRow.createEl('button', {
            text: '💾 保存',
            attr: {
                type: 'button',
                style: 'padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });
        saveBtn.addEventListener('click', async () => {
            // 强度配置按项目落盘（projectFingerprintIntensityFile）。
            // 没有项目时引擎会静默返回，这里必须先拦住，
            // 否则会弹「已保存」，重启后配置却不存在。
            if (!this.options.project) {
                new Notice('未打开项目：指纹强度按项目保存，请先打开一个项目');
                return;
            }
            try {
                const fp = this.options.fingerprint;
                // v4.83.1 两层语义：全局指纹默认写全局默认（跨项目生效），
                // 勾选「仅本项目」才写项目覆盖；项目层指纹始终写项目文件。
                if (fp.scope === 'global' && !this.useProjectOverride) {
                    await this.options.library.setGlobalIntensityConfig(fp.id, this.currentConfig);
                    // 之前若在本项目有覆盖，清掉它，否则项目覆盖会继续压住刚写的全局默认
                    await this.options.library.removeIntensityConfig(fp.id, this.options.project);
                    new Notice(`已保存指纹「${fp.name}」的全局默认强度（所有项目生效）`);
                } else {
                    await this.options.library.setIntensityConfig(
                        fp.id,
                        this.currentConfig,
                        this.options.project
                    );
                    new Notice(`已保存指纹「${fp.name}」的强度配置${fp.scope === 'global' ? '（仅本项目生效）' : ''}`);
                }
                this.options.onSaved?.(this.currentConfig);
                this.close();
            } catch (e) {
                log.warn('[FingerprintIntensityModal] 保存失败:', e);
                new Notice('保存强度配置失败，请查看控制台');
            }
        });

        const closeBtn = btnRow.createEl('button', {
            text: '关闭',
            attr: {
                type: 'button',
                style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);'
            }
        });
        closeBtn.addEventListener('click', () => this.close());
    }
}
