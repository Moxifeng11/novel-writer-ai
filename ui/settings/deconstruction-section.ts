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
    DIMENSION_LABELS,
} from '../../main';
import type { DeconstructionEngineSettings } from '../../main';
import { OperationConfirmModal } from '../components/progress';
import { SettingsSection } from './section-base';

export class DeconstructionSection extends SettingsSection {
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

    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: '🧬 拆解引擎' });
        section.createEl('p', {
            text: '配置小说拆解引擎的行为，包括增强级别、拆解维度、向量与 LLM 增强等。设置将在下一次拆解任务时生效。',
            cls: 'setting-item-description'
        });

        const cfg = this.getDeconstructionEngineSettings();

        const qualityCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        qualityCard.createEl('h4', { text: '🎯 增强级别', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

        new Setting(qualityCard)
            .setName('默认质量级别')
            .setDesc('快速=仅基础分析；标准=完整维度；深度=含向量+LLM 增强（耗时最长）')
            .addDropdown(dropdown => {
                dropdown.addOption('fast', '⚡ 快速');
                dropdown.addOption('standard', '✅ 标准');
                dropdown.addOption('deep', '🔬 深度');
                dropdown.setValue(cfg.defaultQualityLevel);
                dropdown.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.defaultQualityLevel = value as DeconstructionEngineSettings['defaultQualityLevel'];
                    });
                });
            });

        new Setting(qualityCard)
            .setName('低质量自动升级')
            .setDesc('检测到拆解质量较低时，自动升级到更高级别重跑')
            .addToggle(toggle => {
                toggle.setValue(cfg.enableAutoUpgrade);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.enableAutoUpgrade = value;
                    });
                });
            });

        const dimCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        dimCard.createEl('h4', { text: '🧩 拆解维度', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });
        dimCard.createEl('div', {
            text: '选择默认启用的拆解维度（调用方未显式指定维度时使用）',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2 nw-u-marginbottom-10px-2'
        });

        const dimList = dimCard.createDiv({ cls: 'nw-u-d-grid-2 nw-u-gtc-repeat-auto-fill-minma-5 nw-u-gap-6px-2' });
        const dimSet = new Set(cfg.enabledDimensions);
        const DIMENSION_DESC: Record<string, string> = {
            style: '分析文笔风格与语言特色',
            rhythm: '分析叙事节奏与张弛变化',
            technique: '提取写作技巧与手法',
            structure: '拆解情节结构与章节组织',
            character: '提取人物设定与性格弧线',
            foreshadow: '梳理伏笔铺设与回收',
            commercial: '分析商业卖点与爽点',
            readability: '分析可读性与流畅度',
        };
        ALL_BREAKDOWN_DIMENSIONS.forEach(dim => {
            const item = new Setting(dimList)
                .setName(DIMENSION_LABELS[dim])
                .setDesc(DIMENSION_DESC[dim] || '')
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
            item.settingEl.style.borderBottom = 'none';
            item.settingEl.style.padding = '6px 0';
        });

        new Setting(dimCard)
            .setName('包含商业价值分析')
            .setDesc('即使未在维度列表中勾选 commercial，也自动追加商业维度')
            .addToggle(toggle => {
                toggle.setValue(cfg.includeCommercial);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.includeCommercial = value;
                    });
                });
            });

        new Setting(dimCard)
            .setName('包含可读性分析')
            .setDesc('即使未在维度列表中勾选 readability，也自动追加可读性维度')
            .addToggle(toggle => {
                toggle.setValue(cfg.includeReadability);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.includeReadability = value;
                    });
                });
            });

        const vectorCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        vectorCard.createEl('h4', { text: '🧠 向量增强', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

        new Setting(vectorCard)
            .setName('启用向量增强')
            .setDesc('使用向量相似度匹配辅助定位相关内容，提升拆解质量')
            .addToggle(toggle => {
                toggle.setValue(cfg.vectorEnabled);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorEnabled = value;
                    });
                });
            });

        new Setting(vectorCard)
            .setName('向量模型名称')
            .setDesc('用于向量嵌入的模型名称（实际提供商端点请在「写作知识库」标签页配置）')
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
            .setName('向量缓存大小')
            .setDesc(`向量缓存条目上限（当前: ${cfg.vectorCacheSize}）`)
            .addSlider(slider => {
                slider.setLimits(100, 50000, 100);
                slider.setValue(cfg.vectorCacheSize);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorCacheSize = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = `向量缓存条目上限（当前: ${value}）`;
                });
            });

        new Setting(vectorCard)
            .setName('批处理大小')
            .setDesc(`单次向量请求的文本条数（当前: ${cfg.vectorBatchSize}）`)
            .addSlider(slider => {
                slider.setLimits(1, 256, 1);
                slider.setValue(cfg.vectorBatchSize);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.vectorBatchSize = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = `单次向量请求的文本条数（当前: ${value}）`;
                });
            });

        const llmCard = section.createDiv({
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        llmCard.createEl('h4', {
            text: '🤖 LLM 增强 · 实验性',
            cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2'
        });
        llmCard.createEl('div', {
            text: '⚠️ 实验性功能：调用大模型对拆解结果做二次提炼，会增加 API 调用成本',
            cls: 'nw-u-fs-12px-2 nw-u-c-text-warning nw-u-marginbottom-10px-2'
        });

        new Setting(llmCard)
            .setName('启用 LLM 增强')
            .setDesc('使用大模型对拆解结果做二次提炼与归因')
            .addToggle(toggle => {
                toggle.setValue(cfg.llmEnabled);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.llmEnabled = value;
                    });
                });
            });

        new Setting(llmCard)
            .setName('LLM 模型名称')
            .setDesc('用于增强的 LLM 模型名称（使用当前 API 提供商）')
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
            cls: 'nw-u-p-12px-16px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-marginbottom-16px-2 nw-u-bg-background-secondary-2'
        });
        perfCard.createEl('h4', { text: '⚙️ 性能', cls: 'nw-u-m-0-0-12px-0-2 nw-u-fs-14px-2' });

        new Setting(perfCard)
            .setName('最大并发拆解数')
            .setDesc(`同时执行的拆解任务数（当前: ${cfg.maxConcurrency}）`)
            .addSlider(slider => {
                slider.setLimits(1, 8, 1);
                slider.setValue(cfg.maxConcurrency);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.maxConcurrency = value;
                    });
                    const descEl = slider.sliderEl.closest('.setting-item')?.querySelector('.setting-item-description');
                    if (descEl) descEl.textContent = `同时执行的拆解任务数（当前: ${value}）`;
                });
            });

        new Setting(perfCard)
            .setName('采样模式（仅分析前 N 字）')
            .setDesc('默认关闭：全本智能分段拆解，逐段覆盖全部剧情。开启后仅分析开头“文本采样上限”字数，用于快速预览。')
            .addToggle(toggle => {
                toggle.setValue(cfg.sampleMode === true);
                toggle.onChange(async (value) => {
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.sampleMode = value;
                    });
                });
            });

        new Setting(perfCard)
            .setName('文本采样上限')
            .setDesc(`仅采样模式生效：采样模式下参与拆解的最大字数（当前: ${cfg.textSampleLimit.toLocaleString()}）。全本模式下此项不生效。`)
            .addText(text => {
                text.setValue(String(cfg.textSampleLimit));
                text.setPlaceholder('100000');
                text.inputEl.type = 'number';
                text.onChange(async (value) => {
                    const n = parseInt(value, 10);
                    if (!Number.isFinite(n) || n <= 0) {
                        new Notice('⚠️ 文本采样上限必须为正整数');
                        text.setValue(String(cfg.textSampleLimit));
                        return;
                    }
                    await this.ensureDeconstructionEngineSettingsPersists(s => {
                        s.textSampleLimit = n;
                    });
                });
            });

        const resetRow = section.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-margintop-12px-2' });
        const resetBtn = resetRow.createEl('button', {
            text: '↩️ 恢复默认',
            attr: { type: 'button', title: '将拆解引擎所有配置恢复为默认值', style: 'padding:6px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:13px;background:var(--background-primary);' }
        });
        resetBtn.addEventListener('click', async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '恢复默认配置',
                description: '确定要将拆解引擎所有配置恢复为默认值吗？',
                warning: '所有自定义配置将丢失',
                confirmText: '确认恢复',
                cancelText: '取消',
            });
            if (!confirmed) return;
            this.plugin.settings.deconstructionEngine = { ...DEFAULT_DECONSTRUCTION_ENGINE_SETTINGS };
            await this.plugin.saveSettings();
            this.refresh();
            new Notice('✅ 已恢复默认配置');
        });
    }
}
