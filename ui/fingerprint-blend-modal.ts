/**
 * fingerprint-blend-modal.ts — 写作指纹 V2 多指纹融合预览 Modal（Task 7）
 *
 * 设计要点：
 *   - 指纹多选器（最多 3 个）
 *   - 每个指纹带权重滑动条（0-1）
 *   - 实时 12 维雷达图预览（融合结果）
 *   - 融合结果文字描述
 *   - 强度调节滑动条 + 三档预设
 *   - 保存融合结果为新指纹按钮
 *
 * 调用关系：
 *   - migrateV1ToV2(v1, scope) 将 V1 指纹转换为 V2Fingerprint
 *   - library.blendFingerprintsPreview(sources) 同步预览融合结果
 *   - library.saveBlendedFingerprint(blended, scope) 保存为新指纹
 *
 * @see FingerprintBlenderV2.blend
 * @see StyleFingerprintLibrary.blendFingerprintsPreview / saveBlendedFingerprint
 * @see migrateV1ToV2 (fingerprint-migrator.ts)
 */

import { App, Modal, Notice } from 'obsidian';
import {
    StyleFingerprintLibrary,
    StyleFingerprint,
} from '../engine/style-fingerprint-library';
import { migrateV1ToV2 } from '../engine/style/fingerprint-migrator';
import {
    BlendSource,
    BlendOptions,
    BlendResult,
    BlendedFingerprint,
} from '../engine/style/fingerprint-blender-v2';
import {
    V2Fingerprint,
    StyleDimensionKeyV2,
    STYLE_DIMENSIONS_V2,
    STYLE_DIMENSION_LABELS_V2,
} from '../engine/style/style-dimensions-v2';
import {
    StyleIntensityConfig,
    INTENSITY_PRESETS,
    INTENSITY_PRESET_LABELS,
    IntensityPreset,
} from '../engine/style/style-intensity-engine';
import { radarChart } from './svg-charts';
import { getDimensionScore } from './fingerprint-utils';
import { createLogger } from '../shared/logger';


const log = createLogger('FingerprintBlendModal');
type FingerprintScope = 'template' | 'global' | 'project';

/**
 * FingerprintBlendModalOptions 类型定义。
 */
export interface FingerprintBlendModalOptions {
    /** 当前作用域下所有可选指纹 */
    fingerprints: StyleFingerprint[];
    /** 指纹库实例 */
    library: StyleFingerprintLibrary;
    /** 当前作用域（保存时使用） */
    scope: FingerprintScope;
    /** 项目路径（保存时使用） */
    project?: string;
    /** 保存成功回调 */
    onSaved?: (fp: StyleFingerprint) => void;
}

interface SelectedSource {
    fingerprint: StyleFingerprint;
    weight: number;
}

/**
 * FingerprintBlendModal 类。
 */
export class FingerprintBlendModal extends Modal {
    private options: FingerprintBlendModalOptions;
    /** 已选指纹（1-3 个） */
    private selected: SelectedSource[] = [];
    /** 融合结果名称 */
    private blendName = '';
    /** 强度配置 */
    private intensityConfig: StyleIntensityConfig = { globalIntensity: 1.0 };

    constructor(app: App, options: FingerprintBlendModalOptions) {
        super(app);
        this.options = options;
        // 默认选中第一个
        if (options.fingerprints.length > 0) {
            this.selected.push({
                fingerprint: options.fingerprints[0],
                weight: 1.0,
            });
        }
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
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.style.maxHeight = '85vh';

        contentEl.createEl('h3', {
            text: '🎨 多指纹融合预览',
            attr: { style: 'margin-top:0;margin-bottom:8px;' }
        });
        contentEl.createEl('div', {
            text: `作用域：${this.scopeLabel()} · 最多选择 3 个指纹加权融合`,
            attr: { style: 'color:var(--text-muted);font-size:12px;margin-bottom:16px;' }
        });

        this.renderSourceSelector(contentEl);
        this.renderRadarPreview(contentEl);
        this.renderBlendDescription(contentEl);
        this.renderIntensityConfig(contentEl);
        this.renderActions(contentEl);
    }

    private scopeLabel(): string {
        const labels: Record<FingerprintScope, string> = {
            template: '📋 模板层',
            global: '🌐 全局层',
            project: '📁 项目层',
        };
        return labels[this.options.scope];
    }

    /** 指纹选择器 + 权重滑动条 */
    private renderSourceSelector(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;'
            }
        });
        section.createEl('div', {
            text: `已选指纹（${this.selected.length}/3）`,
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:10px;' }
        });

        // 已选指纹列表（带权重滑块）
        this.selected.forEach((src, idx) => {
            const row = section.createDiv({
                attr: { style: 'margin-bottom:10px;padding:8px;border:1px solid var(--background-modifier-border);border-radius:4px;background:var(--background-primary);' }
            });
            const header = row.createDiv({
                attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' }
            });
            header.createEl('span', {
                text: `${idx + 1}. ${src.fingerprint.name}`,
                attr: { style: 'font-weight:500;font-size:12px;' }
            });
            const removeBtn = header.createEl('button', {
                text: '✕',
                attr: {
                    type: 'button',
                    title: '移除',
                    style: 'padding:2px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;background:transparent;color:var(--text-error);'
                }
            });
            removeBtn.addEventListener('click', () => {
                this.selected.splice(idx, 1);
                this.render();
            });

            const sliderRow = row.createDiv({
                attr: { style: 'display:flex;align-items:center;gap:8px;' }
            });
            sliderRow.createEl('span', {
                text: '权重:',
                attr: { style: 'font-size:11px;color:var(--text-muted);min-width:36px;' }
            });
            const slider = sliderRow.createEl('input', {
                type: 'range',
                attr: {
                    min: '0',
                    max: '100',
                    step: '5',
                    value: String(Math.round(src.weight * 100)),
                    style: 'flex:1;cursor:pointer;'
                }
            });
            const valueLabel = sliderRow.createEl('span', {
                text: `${Math.round(src.weight * 100)}%`,
                attr: { style: 'min-width:40px;text-align:right;font-size:11px;color:var(--interactive-accent);font-weight:600;' }
            });
            slider.addEventListener('input', () => {
                const v = parseInt(slider.value, 10) / 100;
                this.selected[idx].weight = v;
                valueLabel.textContent = `${Math.round(v * 100)}%`;
                this.updateRadarPreview();
                this.updateBlendDescription();
            });
        });

        // 添加指纹下拉选择
        if (this.selected.length < 3) {
            const available = this.options.fingerprints.filter(
                fp => !this.selected.some(s => s.fingerprint.id === fp.id)
            );
            if (available.length > 0) {
                const addRow = section.createDiv({
                    attr: { style: 'display:flex;gap:8px;align-items:center;' }
                });
                const select = addRow.createEl('select', {
                    attr: {
                        style: 'flex:1;padding:4px 8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);'
                    }
                });
                select.createEl('option', {
                    text: '— 选择指纹 —',
                    attr: { value: '', disabled: 'true' }
                });
                available.forEach(fp => {
                    select.createEl('option', {
                        text: `${fp.name}（${fp.source}）`,
                        attr: { value: fp.id }
                    });
                });
                const addBtn = addRow.createEl('button', {
                    text: '➕ 添加',
                    attr: {
                        type: 'button',
                        style: 'padding:4px 12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);'
                    }
                });
                addBtn.addEventListener('click', () => {
                    const fpId = select.value;
                    if (!fpId) return;
                    const fp = available.find(f => f.id === fpId);
                    if (!fp) return;
                    this.selected.push({ fingerprint: fp, weight: 1.0 });
                    this.render();
                });
            }
        }
    }

    /** 12 维雷达图实时预览 */
    private renderRadarPreview(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;',
                cls: 'nw-blend-radar-preview'
            }
        });
        section.createEl('div', {
            text: '融合结果雷达图预览',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:10px;' }
        });

        const radarCard = section.createDiv({
            attr: { style: 'display:flex;justify-content:center;' }
        });

        const radarData = this.computeRadarData();
        if (radarData.length > 0) {
            radarCard.innerHTML += radarChart(radarData, { size: 320 });
        } else {
            radarCard.createDiv({
                text: '请至少选择一个指纹',
                attr: { style: 'padding:40px;color:var(--text-faint);font-size:12px;' }
            });
        }
    }

    /** 仅更新雷达图区块（不重新渲染整个 Modal） */
    private updateRadarPreview(): void {
        const previewEl = this.contentEl.querySelector('.nw-blend-radar-preview');
        if (!previewEl) {
            this.render();
            return;
        }
        const parent = previewEl.parentElement;
        if (!parent) return;
        const oldEl = previewEl as HTMLElement;

        // 旧实现往 parent 末尾追加一个隐藏占位再整段重渲染，留下空 div 并把
        // 雷达区块挪到按钮下面。改成在游离容器里渲染，再原位替换。
        const staging = document.createElement('div');
        this.renderRadarPreview(staging);
        const nextEl = staging.querySelector<HTMLElement>('.nw-blend-radar-preview');
        if (nextEl) parent.replaceChild(nextEl, oldEl);
    }

    /** 计算融合后的雷达图数据 */
    private computeRadarData(): Array<{ label: string; value: number }> {
        if (this.selected.length === 0) return [];

        // 将 V1 指纹转换为 V2 并构造 BlendSource
        const sources: BlendSource[] = this.selected.map(src => {
            const v2 = migrateV1ToV2(src.fingerprint, this.options.scope);
            return { fingerprint: v2, weight: src.weight };
        });

        // 调用 blendFingerprintsPreview 计算融合结果
        try {
            const result: BlendResult = this.options.library.blendFingerprintsPreview(sources);
            const blendedFp = result.fingerprint;
            // 从每个维度提取分值
            return STYLE_DIMENSIONS_V2.map(dim => {
                const dimData = blendedFp.features[dim.key];
                const score = getDimensionScore(dimData.status, this.extractFirstMetric(dim.key, dimData));
                return { label: dim.name, value: score };
            });
        } catch (e) {
            log.warn('[FingerprintBlendModal] 融合计算失败:', e);
            return [];
        }
    }

    /** 从维度数据中提取第一个归一化指标（0-1）用于雷达图 */
    private extractFirstMetric(key: StyleDimensionKeyV2, dimData: unknown): number | undefined {
        if (!dimData || typeof dimData !== 'object') return undefined;
        const obj = dimData as Record<string, unknown>;
        // 优先选取 0-1 范围的比例字段
        switch (key) {
            case 'rhythm':
                return typeof obj.shortSentenceRatio === 'number' ? obj.shortSentenceRatio : undefined;
            case 'wordChoice':
                return typeof obj.commonWordRatio === 'number' ? obj.commonWordRatio : undefined;
            case 'rhetoric':
                return typeof obj.metaphorDensity === 'number'
                    ? Math.min(1, (obj.metaphorDensity as number) / 10)
                    : undefined;
            case 'perspective':
                return typeof obj.personDistribution === 'object' && obj.personDistribution !== null
                    ? (obj.personDistribution as Record<string, number>).third
                    : undefined;
            case 'emotion': {
                const valence = obj.valenceRatio as Record<string, number> | undefined;
                return valence ? valence.positive : undefined;
            }
            case 'tension':
                return typeof obj.suspenseDensity === 'number'
                    ? Math.min(1, (obj.suspenseDensity as number) / 10)
                    : undefined;
            case 'infoDensity':
                return typeof obj.infoDensity === 'number'
                    ? Math.min(1, (obj.infoDensity as number) / 10)
                    : undefined;
            case 'dialogue':
                return typeof obj.dialogueRatio === 'number' ? obj.dialogueRatio : undefined;
            case 'description':
                return typeof obj.environmentDescriptionRatio === 'number'
                    ? obj.environmentDescriptionRatio
                    : undefined;
            case 'narration':
                return typeof obj.narrationSpeed === 'number'
                    ? Math.min(1, (obj.narrationSpeed as number) / 10)
                    : undefined;
            case 'languageTexture':
                return typeof obj.writtenLevel === 'number' ? obj.writtenLevel : undefined;
            case 'sentencePattern':
                return typeof obj.parallelismDensity === 'number'
                    ? Math.min(1, (obj.parallelismDensity as number) / 10)
                    : undefined;
            default:
                return undefined;
        }
    }

    /** 融合结果文字描述 */
    private renderBlendDescription(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;',
                cls: 'nw-blend-description'
            }
        });
        section.createEl('div', {
            text: '融合结果描述',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:8px;' }
        });

        const desc = this.computeBlendDescription();
        section.createEl('div', {
            text: desc,
            attr: { style: 'font-size:12px;line-height:1.6;color:var(--text-normal);' }
        });
    }

    private updateBlendDescription(): void {
        const descEl = this.contentEl.querySelector('.nw-blend-description');
        if (!descEl) {
            this.render();
            return;
        }
        const parent = descEl.parentElement;
        if (!parent) return;
        const oldEl = descEl as HTMLElement;
        const newEl = parent.createDiv({ attr: { style: 'display:none;' } });
        parent.replaceChild(newEl, oldEl);
        this.renderBlendDescription(parent as HTMLElement);
        const placeholder = parent.querySelector('.nw-blend-description[style*="display:none"]');
        if (placeholder) placeholder.remove();
    }

    private computeBlendDescription(): string {
        if (this.selected.length === 0) return '请至少选择一个指纹';
        if (this.selected.length === 1) {
            const fp = this.selected[0].fingerprint;
            return `当前仅选择 1 个指纹「${fp.name}」，未执行融合。如需融合效果，请添加更多指纹。`;
        }

        try {
            const sources: BlendSource[] = this.selected.map(src => {
                const v2 = migrateV1ToV2(src.fingerprint, this.options.scope);
                return { fingerprint: v2, weight: src.weight };
            });
            const result = this.options.library.blendFingerprintsPreview(sources);
            const blended = result.fingerprint;

            // 计算归一化权重
            const totalWeight = sources.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
            const normalizedWeights = totalWeight > 0
                ? sources.map(s => `${s.fingerprint.name}:${Math.round((s.weight / totalWeight) * 100)}%`)
                : sources.map(s => `${s.fingerprint.name}:${Math.round(100 / sources.length)}%`);

            const pendingCount = STYLE_DIMENSIONS_V2.filter(d => blended.features[d.key].status === 'pending').length;
            const completeCount = 12 - pendingCount;

            return `已融合 ${sources.length} 个指纹：${normalizedWeights.join(' + ')}。
融合指纹名：${blended.name}
数据状态：${completeCount} 维完整，${pendingCount} 维待补充。
将根据下方强度配置应用到生成 Prompt 中。`;
        } catch (e) {
            return `融合计算失败：${(e as Error).message}`;
        }
    }

    /** 强度配置 */
    private renderIntensityConfig(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;'
            }
        });
        section.createEl('div', {
            text: '风格迁移强度',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:10px;' }
        });

        // 三档预设按钮
        const presetRow = section.createDiv({
            attr: { style: 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;' }
        });
        const presets: IntensityPreset[] = ['light', 'medium', 'deep'];
        presets.forEach(preset => {
            const btn = presetRow.createEl('button', {
                text: `${INTENSITY_PRESET_LABELS[preset]}`,
                attr: {
                    type: 'button',
                    // 拖滑杆时 updatePresetButtons 靠 data-preset 找回这些按钮，
                    // 缺了它高亮就永远停在初始状态。
                    'data-preset': preset,
                    style: this.getPresetButtonStyle(this.intensityConfig.preset === preset)
                }
            });
            btn.addEventListener('click', () => {
                this.intensityConfig = {
                    globalIntensity: INTENSITY_PRESETS[preset],
                    preset,
                };
                this.render();
            });
        });

        // 全局强度滑块
        const sliderRow = section.createDiv({
            attr: { style: 'display:flex;align-items:center;gap:8px;' }
        });
        sliderRow.createEl('span', {
            text: '强度:',
            attr: { style: 'font-size:12px;color:var(--text-muted);min-width:36px;' }
        });
        const slider = sliderRow.createEl('input', {
            type: 'range',
            attr: {
                min: '0',
                max: '100',
                step: '1',
                value: String(Math.round(this.intensityConfig.globalIntensity * 100)),
                style: 'flex:1;cursor:pointer;'
            }
        });
        const valueLabel = sliderRow.createEl('span', {
            text: `${Math.round(this.intensityConfig.globalIntensity * 100)}%`,
            attr: { style: 'min-width:40px;text-align:right;font-size:12px;color:var(--interactive-accent);font-weight:600;' }
        });
        slider.addEventListener('input', () => {
            const v = parseInt(slider.value, 10) / 100;
            this.intensityConfig.globalIntensity = v;
            this.intensityConfig.preset = undefined;
            valueLabel.textContent = `${Math.round(v * 100)}%`;
            this.updatePresetButtons(section);
        });
    }

    private getPresetButtonStyle(isActive: boolean): string {
        const base = 'padding:4px 12px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;';
        if (isActive) {
            return base + 'background:var(--interactive-accent);color:var(--text-on-accent);border-color:var(--interactive-accent);';
        }
        return base + 'background:var(--background-primary);color:var(--text-normal);';
    }

    private updatePresetButtons(container: HTMLElement): void {
        const buttons = container.querySelectorAll('button[data-preset]');
        buttons.forEach(btn => {
            const preset = (btn as HTMLElement).dataset.preset as IntensityPreset;
            (btn as HTMLElement).setAttribute('style', this.getPresetButtonStyle(this.intensityConfig.preset === preset));
        });
    }

    /** 操作按钮 */
    private renderActions(container: HTMLElement): void {
        const section = container.createDiv({
            attr: {
                style: 'margin-bottom:16px;padding:12px;background:var(--background-secondary);border-radius:6px;'
            }
        });
        section.createEl('div', {
            text: '融合指纹名称',
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:6px;' }
        });
        const input = section.createEl('input', {
            type: 'text',
            attr: {
                placeholder: '请输入融合指纹名称（留空自动生成）',
                value: this.blendName,
                style: 'width:100%;padding:6px 10px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);box-sizing:border-box;'
            }
        });
        input.addEventListener('input', () => {
            this.blendName = input.value;
        });

        const btnRow = container.createDiv({
            attr: { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;' }
        });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            attr: {
                type: 'button',
                style: 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;background:var(--background-primary);'
            }
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnRow.createEl('button', {
            text: '💾 保存融合结果',
            attr: {
                type: 'button',
                style: 'padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });
        saveBtn.addEventListener('click', async () => {
            await this.handleSave();
        });
    }

    private async handleSave(): Promise<void> {
        if (this.selected.length === 0) {
            new Notice('请至少选择一个指纹');
            return;
        }

        try {
            const sources: BlendSource[] = this.selected.map(src => {
                const v2 = migrateV1ToV2(src.fingerprint, this.options.scope);
                return { fingerprint: v2, weight: src.weight };
            });

            const options: BlendOptions = {
                maxSources: 3,
                maxSamplesPerDimension: 3,
                name: this.blendName.trim() || undefined,
            };

            const result: BlendResult = this.options.library.blendFingerprints(sources, options);
            const blended: BlendedFingerprint = result.fingerprint;

            const savedFp = await this.options.library.saveBlendedFingerprint(
                blended,
                this.options.scope
            );

            if (savedFp) {
                // 同时保存强度配置
                if (this.options.project) {
                    await this.options.library.setIntensityConfig(
                        savedFp.id,
                        this.intensityConfig,
                        this.options.project
                    );
                }
                new Notice(`✅ 融合指纹「${savedFp.name}」已保存到${this.scopeLabel()}`);
                this.options.onSaved?.(savedFp);
                this.close();
            } else {
                new Notice('保存融合指纹失败');
            }
        } catch (e) {
            log.warn('[FingerprintBlendModal] 保存失败:', e);
            new Notice(`保存失败：${(e as Error).message}`);
        }
    }
}
