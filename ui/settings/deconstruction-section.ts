/**
 * deconstruction-section.ts — 设置页「拆解引擎」分区
 *
 * 职责：渲染拆解引擎的质量级别、拆解维度、向量增强、LLM 增强与性能配置，
 * 并把改动持久化到 plugin.settings.deconstructionEngine。
 * 来源：`ui/settings-tab.ts` L2348-2653。
 */
import { Setting, Notice } from 'obsidian';
import {
    DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS,
    ALL_BREAKDOWN_DIMENSIONS,
    dimensionLabel,
} from '@/shared/deconstruction-settings';
import type { DeconstructionEngineSettings } from '@/shared/deconstruction-settings';
import { OperationConfirmModal } from '@/ui/components/progress';
import { SettingsSection } from './section-base';
import { t } from '@/i18n';

/**
 * DeconstructionSection 类。
 */
export class DeconstructionSection extends SettingsSection {
    /** 异步读盘分区：切回时可能已是旧数据 → 宿主显示统一刷新条 */
    readonly asyncLoad = true;

    private getDeconstructionEngineSettings(): DeconstructionEngineSettings {
        const userDe = this.plugin.settings.deconstructionEngine;
        if (!userDe) {
            this.plugin.settings.deconstructionEngine = { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };
            return this.plugin.settings.deconstructionEngine;
        }
        const merged: DeconstructionEngineSettings = {
            ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS,
            ...userDe,
            enabledDimensions: Array.isArray(userDe.enabledDimensions) && userDe.enabledDimensions.length > 0
                ? [...userDe.enabledDimensions]
                : [...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS.enabledDimensions],
        };
        this.plugin.settings.deconstructionEngine = merged;
        return merged;
    }

    private async ensureDeconstructionEngineSettingsPersists(update: (s: DeconstructionEngineSettings) => void): Promise<void> {
        const s = this.getDeconstructionEngineSettings();
        update(s);
        this.plugin.settings.deconstructionEngine = s;
        await this.plugin.saveSettings();
    }

    /**
     * 渲染。
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: t('settings.deconstruction.title') });
        section.createEl('p', {
            text: t('settings.deconstruction.intro'),
            cls: 'setting-item-description'
        });

        const cfg = this.getDeconstructionEngineSettings();

        const qualityCard = section.createDiv({
            cls: 'nw-st-dc-card'
        });
        qualityCard.createEl('h4', { text: t('settings.deconstruction.qualityTitle'), cls: 'nw-st-dc-card-title' });

        new Setting(qualityCard)
            .setName(t('settings.deconstruction.qualityLevelName'))
            .setDesc(t('settings.deconstruction.qualityLevelDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('fast', t('settings.deconstruction.levelFast'));
                dropdown.addOption('standard', t('settings.deconstruction.levelStandard'));
                dropdown.addOption('deep', t('settings.deconstruction.levelDeep'));
                dropdown.setValue(cfg.defaultQualityLevel);
                dropdown.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.defaultQualityLevel = value as DeconstructionEngineSettings['defaultQualityLevel'];
                    });
                });
            });

        new Setting(qualityCard)
            .setName(t('settings.deconstruction.autoUpgradeName'))
            .setDesc(t('settings.deconstruction.autoUpgradeDesc'))
            .addToggle(toggle => {
                toggle.setValue(cfg.enableAutoUpgrade);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.enableAutoUpgrade = value;
                    });
                });
            });

        const dimCard = section.createDiv({
            cls: 'nw-st-dc-card'
        });
        dimCard.createEl('h4', { text: t('settings.deconstruction.dimensionTitle'), cls: 'nw-st-dc-card-title' });
        dimCard.createDiv({
            text: t('settings.deconstruction.dimensionNote'),
            cls: 'nw-st-dc-note'
        });

        const dimList = dimCard.createDiv({ cls: 'nw-st-dc-dim-grid' });
        const dimSet = new Set(cfg.enabledDimensions);
        const DIMENSION_DESC_KEYS: Record<string, string> = {
            style: 'settings.deconstruction.dimensionDescStyle',
            rhythm: 'settings.deconstruction.dimensionDescRhythm',
            technique: 'settings.deconstruction.dimensionDescTechnique',
            structure: 'settings.deconstruction.dimensionDescStructure',
            character: 'settings.deconstruction.dimensionDescCharacter',
            foreshadow: 'settings.deconstruction.dimensionDescForeshadow',
            commercial: 'settings.deconstruction.dimensionDescCommercial',
            readability: 'settings.deconstruction.dimensionDescReadability',
        };
        ALL_BREAKDOWN_DIMENSIONS.forEach(dim => {
            const descKey = DIMENSION_DESC_KEYS[dim];
            const item = new Setting(dimList)
                .setName(dimensionLabel(dim))
                .setDesc(descKey ? t(descKey) : '')
                .addToggle(toggle => {
                    toggle.setValue(dimSet.has(dim));
                    toggle.onChange(async (value) => {
                        await this.ensureDeconstructionEngineSettingsPersists(s => {
                            const set = new Set(s.enabledDimensions);
                            if (value) set.add(dim);
                            else set.delete(dim);
                            s.enabledDimensions = ALL_BREAKDOWN_DIMENSIONS.filter(d => set.has(d));
                            if (dim === 'commercial') s.includeCommercial = value;
                            if (dim === 'readability') s.includeReadability = value;
                        });
                    });
                });
            item.settingEl.addClass('nw-settings-inline-item');
        });

        new Setting(dimCard)
            .setName(t('settings.deconstruction.includeCommercialName'))
            .setDesc(t('settings.deconstruction.includeCommercialDesc'))
            .addToggle(toggle => {
                toggle.setValue(cfg.includeCommercial);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.includeCommercial = value;
                    });
                });
            });

        new Setting(dimCard)
            .setName(t('settings.deconstruction.includeReadabilityName'))
            .setDesc(t('settings.deconstruction.includeReadabilityDesc'))
            .addToggle(toggle => {
                toggle.setValue(cfg.includeReadability);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.includeReadability = value;
                    });
                });
            });

        const vectorCard = section.createDiv({
            cls: 'nw-st-dc-card'
        });
        vectorCard.createEl('h4', { text: t('settings.deconstruction.vectorTitle'), cls: 'nw-st-dc-card-title' });

        new Setting(vectorCard)
            .setName(t('settings.deconstruction.vectorEnabledName'))
            .setDesc(t('settings.deconstruction.vectorEnabledDesc'))
            .addToggle(toggle => {
                toggle.setValue(cfg.vectorEnabled);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorEnabled = value;
                    });
                });
            });

        new Setting(vectorCard)
            .setName(t('settings.deconstruction.vectorModelName'))
            .setDesc(t('settings.deconstruction.vectorModelDesc'))
            .addText(text => {
                text.setValue(cfg.vectorModel);
                text.setPlaceholder('bge-m3');
                text.onChange(async (value) => {
                    const trimmed = value.trim();
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorModel = trimmed;
                    });
                });
            });

        new Setting(vectorCard)
            .setName(t('settings.deconstruction.vectorCacheName'))
            .setDesc(t('settings.deconstruction.vectorCacheDesc', { count: cfg.vectorCacheSize }))
            .addSlider(slider => {
                slider.setLimits(100, 50000, 100);
                slider.setValue(cfg.vectorCacheSize);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorCacheSize = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = t('settings.deconstruction.vectorCacheDesc', { count: value });
                });
            });

        new Setting(vectorCard)
            .setName(t('settings.deconstruction.vectorBatchName'))
            .setDesc(t('settings.deconstruction.vectorBatchDesc', { count: cfg.vectorBatchSize }))
            .addSlider(slider => {
                slider.setLimits(1, 256, 1);
                slider.setValue(cfg.vectorBatchSize);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorBatchSize = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = t('settings.deconstruction.vectorBatchDesc', { count: value });
                });
            });

        const llmCard = section.createDiv({
            cls: 'nw-st-dc-card'
        });
        llmCard.createEl('h4', {
            text: t('settings.deconstruction.llmTitle'),
            cls: 'nw-st-dc-card-title'
        });
        llmCard.createDiv({
            text: t('settings.deconstruction.llmWarning'),
            cls: 'nw-st-dc-note nw-st-dc-note--warning'
        });

        new Setting(llmCard)
            .setName(t('settings.deconstruction.llmEnabledName'))
            .setDesc(t('settings.deconstruction.llmEnabledDesc'))
            .addToggle(toggle => {
                toggle.setValue(cfg.llmEnabled);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.llmEnabled = value;
                    });
                });
            });

        new Setting(llmCard)
            .setName(t('settings.deconstruction.llmModelName'))
            .setDesc(t('settings.deconstruction.llmModelDesc'))
            .addText(text => {
                text.setValue(cfg.llmModel);
                text.setPlaceholder('deepseek-r1:7b');
                text.onChange(async (value) => {
                    const trimmed = value.trim();
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.llmModel = trimmed;
                    });
                });
            });

        const perfCard = section.createDiv({
            cls: 'nw-st-dc-card'
        });
        perfCard.createEl('h4', { text: t('settings.deconstruction.perfTitle'), cls: 'nw-st-dc-card-title' });

        new Setting(perfCard)
            .setName(t('settings.deconstruction.maxConcurrencyName'))
            .setDesc(t('settings.deconstruction.maxConcurrencyDesc', { count: cfg.maxConcurrency }))
            .addSlider(slider => {
                slider.setLimits(1, 8, 1);
                slider.setValue(cfg.maxConcurrency);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.maxConcurrency = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = t('settings.deconstruction.maxConcurrencyDesc', { count: value });
                });
            });

        new Setting(perfCard)
            .setName(t('settings.deconstruction.sampleModeName'))
            .setDesc(t('settings.deconstruction.sampleModeDesc'))
            .addToggle(toggle => {
                toggle.setValue(cfg.sampleMode === true);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.sampleMode = value;
                    });
                });
            });

        new Setting(perfCard)
            .setName(t('settings.deconstruction.sampleLimitName'))
            .setDesc(t('settings.deconstruction.sampleLimitDesc', { count: cfg.textSampleLimit.toLocaleString() }))
            .addText(text => {
                text.setValue(String(cfg.textSampleLimit));
                text.setPlaceholder('100000');
                text.inputEl.type = 'number';
                text.onChange(async (value) => {
                    const n = parseInt(value, 10);
                    if (!Number.isFinite(n) || n <= 0) {
                        new Notice(t('settings.deconstruction.sampleLimitInvalid'));
                        text.setValue(String(cfg.textSampleLimit));
                        return;
                    }
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.textSampleLimit = n;
                    });
                });
            });

        const resetRow = section.createDiv({ cls: 'nw-st-dc-reset-row' });
        const resetBtn = resetRow.createEl('button', {
            text: t('settings.deconstruction.resetBtn'),
            cls: 'nw-st-dc-reset-btn',
            attr: { type: 'button', title: t('settings.deconstruction.resetTitleAttr') }
        });
        resetBtn.addEventListener('click', async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('settings.deconstruction.resetConfirmTitle'),
                description: t('settings.deconstruction.resetConfirmDesc'),
                warning: t('settings.deconstruction.resetConfirmWarning'),
                confirmText: t('settings.deconstruction.resetConfirmOk'),
                cancelText: t('common.cancel'),
            });
            if (!confirmed) return;
            this.plugin.settings.deconstructionEngine = { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };
            await this.plugin.saveSettings();
            this.refresh();
            new Notice(t('settings.deconstruction.resetNotice'));
        });
    }
}
