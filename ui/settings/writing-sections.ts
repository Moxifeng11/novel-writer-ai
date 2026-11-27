/**
 * writing-sections.ts — 写作类六个分区
 *
 * 职责：协同写作模型配置、写作参数与规则版本、模板/提示词策略、外观、
 * 项目库迁移、工作台布局与面板尺寸。
 * 来源：原 settings-tab.ts L1364-L1820、L3471-L3719（按分区顺序物理搬移）。
 * 依赖：宿主提供的 app/plugin/refresh/reopen（见 section-base.ts）。
 */
import { Setting, Notice, type DropdownComponent } from 'obsidian';
import { renderAppearanceSettings } from '@/ui/appearance-settings';
import { renderWritingStatsAndPetSettings } from '@/ui/writing-stats-settings';
import { TemplateManager } from '@/ui/template-manager';
import { withWarningStyle } from '@/ui/components/button-compat';
import { getOllamaModelsWithFallback } from '@/engine/co-writer-engine';
import { ProjectMigrationService } from '@/engine/project-migration-service';
import { AntiAIDetector } from '@/engine/anti-ai-detector';
import { PromptManagerSettings } from '@/ui/prompt-manager-settings';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { OperationConfirmModal } from '@/ui/components/progress';
import { setBusinessThresholdOverrides } from '@/shared/thresholds';
import { SettingsSection } from './section-base';
import { renderLocaleSetting } from './locale-setting';
import { t } from '@/i18n';

/**
 * 协同写作设置分区。
 */
export class CoWriteSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');

        section.createEl('p', {
            text: t('settings.writing.cowriteLead'),
            cls: 'setting-item-description'
        });

        let localModelDropdown: DropdownComponent | null = null;
        let cloudModelDropdown: DropdownComponent | null = null;
        let localModelSetting: Setting | null = null;
        let cloudProviderSetting: Setting | null = null;
        let cloudModelSetting: Setting | null = null;

        const updateVisibility = () => {
            const mode = this.plugin.settings.coWriteModelMode || 'local';
            if (localModelSetting) {
                localModelSetting.settingEl.style.display = mode === 'local' ? '' : 'none';
            }
            if (cloudProviderSetting) {
                cloudProviderSetting.settingEl.style.display = mode === 'cloud' ? '' : 'none';
            }
            if (cloudModelSetting) {
                cloudModelSetting.settingEl.style.display = mode === 'cloud' ? '' : 'none';
            }
        };

        const loadLocalModels = async () => {
            if (!localModelDropdown) return;
            localModelDropdown.selectEl.empty();
            localModelDropdown.addOption('', t('settings.writing.cowriteLoading'));
            localModelDropdown.setValue('');
            const models = await getOllamaModelsWithFallback(this.plugin.settings);
            localModelDropdown.selectEl.empty();
            localModelDropdown.addOption('', t('settings.writing.cowriteUnsetModel'));
            for (const m of models) {
                localModelDropdown.addOption(m, `🖥 ${m}`);
            }
            localModelDropdown.setValue(this.plugin.settings.coWriteModel || '');
        };

        const refreshCloudModelDropdown = () => {
            if (!cloudModelDropdown) return;
            cloudModelDropdown.selectEl.empty();
            cloudModelDropdown.addOption('', t('settings.writing.cowriteUseDefaultModel'));
            const providerId = this.plugin.settings.coWriteCloudProvider || '';
            if (providerId) {
                const custom = this.plugin.settings.customProviders?.find(p => p.id === providerId);
                if (custom?.models) {
                    for (const m of custom.models) {
                        cloudModelDropdown.addOption(m, m);
                    }
                }
            }
            cloudModelDropdown.setValue(this.plugin.settings.coWriteCloudModel || '');
        };

        new Setting(section)
            .setName(t('settings.writing.cowriteModeName'))
            .setDesc(t('settings.writing.cowriteModeDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('local', t('settings.writing.cowriteModeLocal'));
                dropdown.addOption('cloud', t('settings.writing.cowriteModeCloud'));
                dropdown.setValue(this.plugin.settings.coWriteModelMode || 'local');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteModelMode = value as 'local' | 'cloud';
                    await this.plugin.saveSettings();
                    updateVisibility();
                });
            });

        localModelSetting = new Setting(section)
            .setName(t('settings.writing.cowriteLocalName'))
            .setDesc(t('settings.writing.cowriteLocalDesc'))
            .addDropdown(dropdown => {
                localModelDropdown = dropdown;
                dropdown.addOption('', t('settings.writing.cowriteLoading'));
                dropdown.setValue(this.plugin.settings.coWriteModel || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteModel = value;
                    await this.plugin.saveSettings();
                });
            })
            .addButton(btn => {
                btn
                    .setButtonText(t('common.refresh'))
                    .setTooltip(t('settings.writing.cowriteRefreshTooltip'))
                    .onClick(() => {
                        void loadLocalModels();
                    });
            });
        void loadLocalModels();

        cloudProviderSetting = new Setting(section)
            .setName(t('settings.writing.cowriteProviderName'))
            .setDesc(t('settings.writing.cowriteProviderDesc'))
            .addDropdown(dropdown => {
                dropdown.addOption('', t('settings.writing.cowriteProviderNone'));
                const allProviders = this.plugin.getAllProviders();
                for (const p of allProviders) {
                    if (p.id !== 'ollama') {
                        dropdown.addOption(p.id, p.name);
                    }
                }
                dropdown.setValue(this.plugin.settings.coWriteCloudProvider || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteCloudProvider = value;
                    await this.plugin.saveSettings();
                    refreshCloudModelDropdown();
                });
            });

        cloudModelSetting = new Setting(section)
            .setName(t('settings.writing.cowriteCloudModelName'))
            .setDesc(t('settings.writing.cowriteCloudModelDesc'))
            .addDropdown(dropdown => {
                cloudModelDropdown = dropdown;
                refreshCloudModelDropdown();
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteCloudModel = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('Temperature')
            .setDesc(t('settings.writing.cowriteTemperatureDesc'))
            .addSlider(slider => {
                slider.setLimits(0, 2, 0.05);
                slider.setValue(this.plugin.settings.coWriteTemperature ?? 0.7);
                slider.onChange(async (value) => {
                    this.plugin.settings.coWriteTemperature = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName(t('settings.writing.cowriteMaxTokensName'))
            .setDesc(t('settings.writing.cowriteMaxTokensDesc'))
            .addText(text => {
                text.setValue(String(this.plugin.settings.coWriteMaxTokens ?? 600));
                text.onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.coWriteMaxTokens = num;
                        await this.plugin.saveSettings();
                    }
                });
            });

        new Setting(section)
            .setName(t('settings.writing.cowriteNumCtxName'))
            .setDesc(t('settings.writing.cowriteNumCtxDesc'))
            .addText(text => {
                text.setPlaceholder(t('settings.writing.cowriteNumCtxPlaceholder'));
                text.setValue(String(this.plugin.settings.coWriteNumCtx ?? 0));
                text.onChange(async (value) => {
                    const num = parseInt(value, 10);
                    this.plugin.settings.coWriteNumCtx = Number.isFinite(num) && num > 0 ? num : 0;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName(t('settings.writing.cowriteBatchingName'))
            .setDesc(t('settings.writing.cowriteBatchingDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.coWriteCandidateBatching !== false)
                .onChange(async (value) => {
                    this.plugin.settings.coWriteCandidateBatching = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.cowriteAutoPlotName'))
            .setDesc(t('settings.writing.cowriteAutoPlotDesc'))
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.autoPlotEvaluation ?? true);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoPlotEvaluation = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName(t('settings.writing.cowriteGhostName'))
            .setDesc(t('settings.writing.cowriteGhostDesc'))
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.autoGhostAssociation ?? true);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoGhostAssociation = value;
                    await this.plugin.saveSettings();
                });
            });

        updateVisibility();
    }
}

/**
 * 写作设置分区。
 */
export class WritingSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('p', {
            text: t('settings.writing.writingLead'),
            cls: 'setting-item-description',
        });

        const group = (title: string, desc: string): void => {
            section.createEl('h4', { text: title, cls: 'nw-u-margintop-24px' });
            section.createEl('p', { text: desc, cls: 'setting-item-description' });
        };

        group(t('settings.writing.groupWordTitle'), t('settings.writing.groupWordDesc'));
        let wordRangeHint: HTMLElement | null = null;
        const validateWordRange = (): void => {
            if (!wordRangeHint) return;
            const min = Number(this.plugin.settings.minWordCount) || 0;
            const def = Number(this.plugin.settings.defaultWordCount) || 0;
            const max = Number(this.plugin.settings.maxWordCount) || 0;
            const problems: string[] = [];
            if (min > def) problems.push(t('settings.writing.warnMinGtDefault'));
            if (def > max) problems.push(t('settings.writing.warnDefaultGtMax'));
            if (min > max) problems.push(t('settings.writing.warnMinGtMax'));
            wordRangeHint.setText(problems.length > 0 ? `⚠️ ${problems.join('；')}` : '');
        };
        new Setting(section)
            .setName(t('settings.writing.defaultWordsName'))
            .setDesc(t('settings.writing.defaultWordsDesc'))
            .addText(text => text
                .setPlaceholder('3000')
                .setValue(String(this.plugin.settings.defaultWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.defaultWordCount = parseInt(value) || 3000;
                    await this.plugin.saveSettings();
                    validateWordRange();
                }));

        new Setting(section)
            .setName(t('settings.writing.minWordsName'))
            .setDesc(t('settings.writing.minWordsDesc'))
            .addText(text => text
                .setPlaceholder('2500')
                .setValue(String(this.plugin.settings.minWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.minWordCount = parseInt(value) || 2500;
                    await this.plugin.saveSettings();
                    validateWordRange();
                }));

        new Setting(section)
            .setName(t('settings.writing.maxWordsName'))
            .setDesc(t('settings.writing.maxWordsDesc'))
            .addText(text => text
                .setPlaceholder('5000')
                .setValue(String(this.plugin.settings.maxWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.maxWordCount = parseInt(value) || 5000;
                    await this.plugin.saveSettings();
                    validateWordRange();
                }));

        wordRangeHint = section.createDiv({ cls: 'nw-warning-text nw-u-fs-12px' });
        validateWordRange();

        group(t('settings.writing.groupFormTitle'), t('settings.writing.groupFormDesc'));
        new Setting(section)
            .setName(t('settings.writing.paragraphName'))
            .setDesc(t('settings.writing.paragraphDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.naturalParagraphMode !== false)
                .onChange(async (value) => {
                    this.plugin.settings.naturalParagraphMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.bodyConfirmName'))
            .setDesc(t('settings.writing.bodyConfirmDesc'))
            .addDropdown((dropdown) => dropdown
                .addOption('off', t('settings.writing.bodyConfirmOff'))
                .addOption('overwrite', t('settings.writing.bodyConfirmOverwrite'))
                .addOption('always', t('settings.writing.bodyConfirmAlways'))
                .setValue(this.plugin.settings.bodyConfirmMode || 'overwrite')
                .onChange(async (value) => {
                    this.plugin.settings.bodyConfirmMode = (value || 'overwrite') as 'off' | 'overwrite' | 'always';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.bodyTemplateName'))
            .setDesc(t('settings.writing.bodyTemplateDesc'))
            .addDropdown((dropdown) => dropdown
                .addOption('auto', t('settings.writing.bodyTemplateAuto'))
                .addOption('v1', t('settings.writing.bodyTemplateV1'))
                .addOption('v2', t('settings.writing.bodyTemplateV2'))
                .addOption('v3', t('settings.writing.bodyTemplateV3'))
                .addOption('v4', t('settings.writing.bodyTemplateV4'))
                .setValue((this.plugin.settings.activeBodyTemplate || 'auto'))
                .onChange(async (value) => {
                    this.plugin.settings.activeBodyTemplate = (value || 'auto') as 'auto' | 'v1' | 'v2' | 'v3' | 'v4';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.humanVoiceName'))
            .setDesc(t('settings.writing.humanVoiceDesc'))
            .addDropdown((dropdown) => dropdown
                .addOption('exemplar', t('settings.writing.humanVoiceExemplar'))
                .addOption('quota', t('settings.writing.humanVoiceQuota'))
                .setValue(this.plugin.settings.humanVoiceMode === 'quota' ? 'quota' : 'exemplar')
                .onChange(async (value) => {
                    this.plugin.settings.humanVoiceMode = value === 'quota' ? 'quota' : 'exemplar';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.countableName'))
            .setDesc(t('settings.writing.countableDesc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.countableHumanHints === true)
                .onChange(async (value) => {
                    this.plugin.settings.countableHumanHints = value;
                    await this.plugin.saveSettings();
                }));

        group(t('settings.writing.groupContextTitle'), t('settings.writing.groupContextDesc'));
        new Setting(section)
            .setName(t('settings.writing.storyTierName'))
            .setDesc(t('settings.writing.storyTierDesc'))
            .addDropdown(dropdown => dropdown
                .addOption('auto', t('settings.writing.optionAuto'))
                .addOption('local', t('settings.writing.storyTierLocal'))
                .addOption('cloud', t('settings.writing.storyTierCloud'))
                .setValue(this.plugin.settings.storyContextTier || 'auto')
                .onChange(async (value) => {
                    this.plugin.settings.storyContextTier = value as 'auto' | 'local' | 'cloud';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.fallbackName'))
            .setDesc(t('settings.writing.fallbackDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAutoModelFallback !== false)
                .onChange(async (value) => {
                    this.plugin.settings.enableAutoModelFallback = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.tokenCapName'))
            .setDesc(t('settings.writing.tokenCapDesc'))
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(this.plugin.settings.contextTokenCap ?? 0))
                .onChange(async (value) => {
                    const n = Math.max(0, Math.min(200_000, parseInt(value) || 0));
                    this.plugin.settings.contextTokenCap = n;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.compressionName'))
            .setDesc(t('settings.writing.compressionDesc'))
            .addDropdown(dropdown => dropdown
                .addOption('extractive', t('settings.writing.compressionExtractive'))
                .addOption('off', t('settings.writing.compressionOff'))
                .setValue(this.plugin.settings.contextCompressionMode ?? 'extractive')
                .onChange(async (value) => {
                    this.plugin.settings.contextCompressionMode = value === 'off' ? 'off' : 'extractive';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.contextScopeName'))
            .setDesc(t('settings.writing.contextScopeDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.contextScope === 'full')
                .onChange(async (value) => {
                    this.plugin.settings.contextScope = value ? 'full' : 'compact';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.splitRatioName'))
            .setDesc(t('settings.writing.splitRatioDesc'))
            .addText(text => text
                .setPlaceholder('0.67')
                .setValue(String(this.plugin.settings.promptSplitRatio ?? 0.67))
                .onChange(async (value) => {
                    const ratio = Number.parseFloat(value);
                    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return;
                    this.plugin.settings.promptSplitRatio = ratio;
                    setBusinessThresholdOverrides({ promptSplitRatio: ratio });
                    await this.plugin.saveSettings();
                }));

        group(t('settings.writing.groupGateTitle'), t('settings.writing.groupGateDesc'));
        new Setting(section)
            .setName(t('settings.writing.refineRoundsName'))
            .setDesc(t('settings.writing.refineRoundsDesc'))
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.refineRounds ?? 3))
                .onChange(async (value) => {
                    const n = Math.max(0, Math.min(5, parseInt(value) || 0));
                    this.plugin.settings.refineRounds = n;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.autoRevisionName'))
            .setDesc(t('settings.writing.autoRevisionDesc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.autoRevisionAfterQC !== false)
                .onChange(async (value) => {
                    this.plugin.settings.autoRevisionAfterQC = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(section)
            .setName(t('settings.writing.scenePreciseName'))
            .setDesc(t('settings.writing.scenePreciseDesc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.bodySceneContextStrict === true)
                .onChange(async (value) => {
                    this.plugin.settings.bodySceneContextStrict = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(section)
            .setName(t('settings.writing.sceneLoopName'))
            .setDesc(t('settings.writing.sceneLoopDesc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.sceneLoopBodyGeneration === true)
                .onChange(async (value) => {
                    this.plugin.settings.sceneLoopBodyGeneration = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(section)
            .setName(t('settings.writing.settlementName'))
            .setDesc(t('settings.writing.settlementDesc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.settlementStrictWrites === true)
                .onChange(async (value) => {
                    this.plugin.settings.settlementStrictWrites = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(section)
            .setName(t('settings.writing.structuredName'))
            .setDesc(t('settings.writing.structuredDesc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.coWriteStructuredConstraints === true)
                .onChange(async (value) => {
                    this.plugin.settings.coWriteStructuredConstraints = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.hygieneName'))
            .setDesc(t('settings.writing.hygieneDesc'))
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.contextHygieneAutoFix !== false)
                .onChange(async (value) => {
                    this.plugin.settings.contextHygieneAutoFix = value;
                    await this.plugin.saveSettings();
                }));

        group(t('settings.writing.groupThresholdTitle'), t('settings.writing.groupThresholdDesc'));
        new Setting(section)
            .setName(t('settings.writing.wordMinRatioName'))
            .setDesc(t('settings.writing.wordMinRatioDesc'))
            .addText(text => text
                .setPlaceholder('0.70')
                .setValue(String(this.plugin.settings.wordMinRatio ?? 0.7))
                .onChange(async (value) => {
                    const ratio = Number.parseFloat(value);
                    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return;
                    this.plugin.settings.wordMinRatio = ratio;
                    setBusinessThresholdOverrides({ wordMinRatio: ratio });
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName(t('settings.writing.antiAiName'))
            .setDesc(t('settings.writing.antiAiDesc'))
            .addTextArea(area => {
                area.setPlaceholder(t('settings.writing.antiAiPlaceholder'))
                    .setValue((this.plugin.settings.antiAiExtraWords ?? []).join('\n'))
                    .onChange(async (value) => {
                        const words = value.split('\n').map(w => w.trim()).filter(w => w.length > 0);
                        this.plugin.settings.antiAiExtraWords = words;
                        AntiAIDetector.setExtraHighFreqWords(words);
                        await this.plugin.saveSettings();
                    });
                area.inputEl.rows = 4;
            });
    }
}

/**
 * 模板设置分区。
 */
export class TemplateSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    async render(container: HTMLElement): Promise<void> {
        const section = container.createEl('section');
        const templateManager = this.plugin.engineRegistry.get<TemplateManager>(ENGINE_NAMES.TEMPLATE_MANAGER);
        await templateManager.renderTemplateList(section);

        // 提示词策略配置子分区
        section.createEl('hr', { cls: 'nw-u-m-20px-0 nw-u-b-none nw-u-bt-1px-solid-background-m' });
        section.createEl('h3', { text: t('settings.writing.promptStrategyTitle'), cls: 'nw-u-margintop-16px' });
        if (this.plugin.promptManager) {
            const manager = new PromptManagerSettings(this.app, this.plugin, section);
            manager.render();
        } else {
            section.createDiv({ text: t('settings.writing.promptManagerMissing'), cls: 'nw-text-error' });
        }
    }
}

/**
 * 外观设置分区。
 */
export class AppearanceSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        // 界面语言放最前：它是「整个页面长什么样」的开关，先于具体外观项
        renderLocaleSetting(section, this.plugin, () => this.reopen());
        renderAppearanceSettings(section, this.plugin, {
            compact: false,
            rerender: () => this.refresh(),
        });
        renderWritingStatsAndPetSettings(section, this.plugin, () => this.refresh());
    }
}

/**
 * 项目库设置分区。
 */
export class ProjectLibrarySection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: t('settings.writing.projectLibTitle') });
        section.createEl('p', {
            text: t('settings.writing.projectLibLead'),
            cls: 'setting-item-description',
        });

        const actions = section.createDiv({ cls: 'nw-u-d-flex nw-u-gap-8px nw-u-marginbottom-8px' });
        const planBtn = actions.createEl('button', {
            text: t('settings.writing.planButton'),
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        const migrateBtn = actions.createEl('button', {
            text: t('settings.writing.migrateButton'),
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        const resultEl = section.createDiv({ cls: 'nw-u-fs-12px nw-u-c-text-muted' });

        const renderPlan = (planText: string): void => {
            resultEl.empty();
            resultEl.createEl('pre', { text: planText, cls: 'nw-u-fs-12px' });
        };

        planBtn.onclick = async () => {
            if (planBtn.disabled) return;
            planBtn.disabled = true;
            planBtn.setText(t('settings.writing.scanning'));
            try {
                const service = new ProjectMigrationService(this.app);
                const plan = await service.plan();
                if (plan.candidates.length === 0 && plan.conflicts.length === 0) {
                    renderPlan(t('settings.writing.noLegacy'));
                } else {
                    const lines: string[] = [];
                    if (plan.candidates.length > 0) {
                        lines.push(t('settings.writing.planToMigrate'));
                        for (const item of plan.candidates) {
                            lines.push(`- [${item.mode}] ${item.projectId} → ${item.targetPath}`);
                        }
                    }
                    if (plan.conflicts.length > 0) {
                        lines.push(t('settings.writing.planConflict'));
                        for (const item of plan.conflicts) lines.push(`- ${item.projectId}：${item.reason}`);
                    }
                    if (plan.skipped.length > 0) {
                        lines.push(t('settings.writing.planSkip'));
                        for (const item of plan.skipped) lines.push(`- ${item.projectId}：${item.reason}`);
                    }
                    renderPlan(lines.join('\n'));
                }
            } catch (e) {
                renderPlan(t('settings.writing.planFailed', { error: e instanceof Error ? e.message : String(e) }));
            } finally {
                planBtn.disabled = false;
                planBtn.setText(t('settings.writing.planButton'));
            }
        };

        migrateBtn.onclick = async () => {
            if (migrateBtn.disabled) return;
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('settings.writing.confirmMigrateTitle'),
                description: t('settings.writing.confirmMigrateDesc'),
                confirmText: t('settings.writing.confirmMigrateConfirm'),
                cancelText: t('common.cancel'),
            });
            if (!confirmed) return;
            migrateBtn.disabled = true;
            migrateBtn.setText(t('settings.writing.migrating'));
            try {
                const service = new ProjectMigrationService(this.app);
                const result = await service.migrateWithNotice({ backup: true });
                const lines = [
                    t('settings.writing.migratedCount', { count: result.moved.length }),
                    ...result.moved.map(item => `- ${item.projectId} → ${item.targetPath}`),
                ];
                if (result.failed.length > 0) {
                    lines.push('', t('settings.writing.failedLabel'));
                    for (const item of result.failed) lines.push(`- ${item.projectId}：${item.error}`);
                }
                if (result.warnings.length > 0) lines.push('', ...result.warnings);
                renderPlan(lines.join('\n'));
                if (result.moved.length > 0) {
                    const undo = resultEl.createEl('button', {
                        text: t('settings.writing.undoButton'),
                        cls: 'nw-btn nw-btn-secondary',
                        attr: { type: 'button' },
                    });
                    undo.onclick = async () => {
                        if (undo.disabled) return;
                        const ok = await OperationConfirmModal.confirm(this.app, {
                            title: t('settings.writing.undoConfirmTitle'),
                            description: t('settings.writing.undoConfirmDesc', { count: result.moved.length }),
                            warning: t('settings.writing.undoConfirmWarning'),
                            confirmText: t('settings.writing.undoConfirmConfirm'),
                            cancelText: t('settings.writing.undoConfirmKeep'),
                        });
                        if (!ok) return;
                        undo.disabled = true;
                        undo.setText(t('settings.writing.undoing'));
                        const rollback = await service.rollbackWithNotice(result.moved);
                        const rollbackLines = [
                            t('settings.writing.undoneCount', { count: rollback.restored.length }),
                            ...rollback.restored.map(item => `- ${item.targetPath} → ${item.projectId}`),
                        ];
                        if (rollback.failed.length > 0) {
                            rollbackLines.push('', t('settings.writing.undoFailedLabel'));
                            for (const item of rollback.failed) rollbackLines.push(`- ${item.projectId}：${item.error}`);
                        }
                        renderPlan(rollbackLines.join('\n'));
                        this.plugin.ctxManager.invalidateContextCache();
                        this.plugin.updateStatusBarText();
                    };
                }
                this.plugin.ctxManager.invalidateContextCache();
                this.plugin.updateStatusBarText();
            } catch (e) {
                renderPlan(t('settings.writing.migrateFailed', { error: e instanceof Error ? e.message : String(e) }));
            } finally {
                migrateBtn.disabled = false;
                migrateBtn.setText(t('settings.writing.migrateButton'));
            }
        };
    }
}

/**
 * 布局设置分区。
 */
export class LayoutSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: t('settings.writing.layoutTitle') });
        section.createEl('p', {
            text: t('settings.writing.layoutLead'),
            cls: 'setting-item-description'
        });

        const panelLayout = this.plugin.settings.panelLayout || { panels: [], autoRestore: true, lastWorkspaceOpen: false };
        this.plugin.settings.panelLayout = panelLayout;

        new Setting(section)
            .setName(t('settings.writing.autoRestoreName'))
            .setDesc(t('settings.writing.autoRestoreDesc'))
            .addToggle(toggle => toggle
                .setValue(panelLayout.autoRestore !== false)
                .onChange(async (value) => {
                    if (!this.plugin.settings.panelLayout) {
                        this.plugin.settings.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
                    }
                    this.plugin.settings.panelLayout.autoRestore = value;
                    await this.plugin.saveSettings();
                }));

        const savedCount = Array.isArray(panelLayout.panels) ? panelLayout.panels.length : 0;
        new Setting(section)
            .setName(t('settings.writing.clearSavedName'))
            .setDesc(t('settings.writing.clearSavedDesc', { count: savedCount }))
            .addButton(btn => withWarningStyle(btn
                .setButtonText(t('settings.writing.clearSavedButton')))
                .onClick(async () => {
                    if (!this.plugin.settings.panelLayout) {
                        this.plugin.settings.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
                    }
                    this.plugin.settings.panelLayout.panels = [];
                    this.plugin.settings.panelLayout.lastWorkspaceOpen = false;
                    await this.plugin.saveSettings();
                    this.refresh();
                    new Notice(t('settings.writing.clearedNotice'));
                }));

        this.renderPanelSizeRows(section);
    }

    /**
     * 面板尺寸（2026-10-29 第 4 轮）。
     *
     * 工作台左右栏可以直接拖，但拖出来的值没有数字入口查看/精确设定；
     * 完整写作工作台的三栏此前写死在 grid 变量里，只能改代码。
     * 这里给每一项一个数字输入 + 恢复默认，并在文案里说明也可拖拽。
     */
    private renderPanelSizeRows(section: HTMLElement): void {
        section.createEl('h4', { text: t('settings.writing.panelSizeTitle') });
        section.createEl('p', {
            text: t('settings.writing.panelSizeLead'),
            cls: 'setting-item-description',
        });

        const sizes = () => {
            if (!this.plugin.settings.panelSizes) this.plugin.settings.panelSizes = {};
            return this.plugin.settings.panelSizes;
        };

        const persist = async (apply: () => void) => {
            apply();
            await this.plugin.saveSettings();
            // 尺寸通过 CSS 变量生效，重注入即可，不必重建整个设置页
            this.plugin.injectLayoutVariables();
            this.plugin.injectThemeVariables();
        };

        const rows: Array<{
            key: 'fwStepNav' | 'fwRightPanel';
            labelKey: string;
            descKey: string;
            min: number;
            max: number;
            fallback: number;
        }> = [
            { key: 'fwStepNav', labelKey: 'settings.writing.rowStepNavLabel', descKey: 'settings.writing.rowStepNavDesc', min: 100, max: 400, fallback: 140 },
            { key: 'fwRightPanel', labelKey: 'settings.writing.rowRightPanelLabel', descKey: 'settings.writing.rowRightPanelDesc', min: 160, max: 560, fallback: 220 },
        ];

        for (const row of rows) {
            new Setting(section)
                .setName(t(row.labelKey))
                .setDesc(t('settings.writing.sizeRowDesc', { desc: t(row.descKey), min: row.min, max: row.max, fallback: row.fallback }))
                .addText(text => {
                    text.inputEl.type = 'number';
                    text.inputEl.min = String(row.min);
                    text.inputEl.max = String(row.max);
                    text
                        .setPlaceholder(String(row.fallback))
                        .setValue(String(sizes()[row.key] ?? row.fallback))
                        .onChange(async (value) => {
                            const parsed = parseInt(value, 10);
                            if (!Number.isFinite(parsed)) return;
                            const clamped = Math.max(row.min, Math.min(row.max, parsed));
                            await persist(() => { sizes()[row.key] = clamped; });
                        });
                })
                .addExtraButton(btn => btn
                    .setIcon('rotate-ccw')
                    .setTooltip(t('settings.writing.resetTooltip'))
                    .onClick(async () => {
                        await persist(() => { delete sizes()[row.key]; });
                        this.refresh();
                    }));
        }

        new Setting(section)
            .setName(t('settings.writing.restoreAllName'))
            .setDesc(t('settings.writing.restoreAllDesc'))
            .addButton(btn => withWarningStyle(btn
                .setButtonText(t('settings.writing.restoreAllButton')))
                .onClick(async () => {
                    await persist(() => {
                        this.plugin.settings.panelSizes = {};
                        delete this.plugin.settings.agentWorkbenchLeftWidth;
                        delete this.plugin.settings.agentWorkbenchRightWidth;
                        delete this.plugin.settings.coWriteEditorWidthRatio;
                    });
                    this.refresh();
                    new Notice(t('settings.writing.restoredAllNotice'));
                }));
    }
}
