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
import { getOllamaModelsWithFallback } from '@/engine/co-writer-engine';
import { ProjectMigrationService } from '@/engine/project-migration-service';
import { AntiAIDetector } from '@/engine/anti-ai-detector';
import { PromptManagerSettings } from '@/ui/prompt-manager-settings';
import { ENGINE_NAMES } from '@/shared/engine-names';
import { OperationConfirmModal } from '@/ui/components/progress';
import { setBusinessThresholdOverrides } from '@/shared/thresholds';
import { SettingsSection } from './section-base';

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
            text: '配置协同写作使用的模型。可在本地 Ollama 和云端 API 之间自由切换。',
            cls: 'setting-item-description'
        });

        let localModelDropdown: DropdownComponent | null = null;
        let cloudProviderDropdown: DropdownComponent | null = null;
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
            localModelDropdown.addOption('', '加载中...');
            localModelDropdown.setValue('');
            const models = await getOllamaModelsWithFallback(this.plugin.settings);
            localModelDropdown.selectEl.empty();
            localModelDropdown.addOption('', '（未设置 — 协同写作将无法使用）');
            for (const m of models) {
                localModelDropdown.addOption(m, `🖥 ${m}`);
            }
            localModelDropdown.setValue(this.plugin.settings.coWriteModel || '');
        };

        const refreshCloudModelDropdown = () => {
            if (!cloudModelDropdown) return;
            cloudModelDropdown.selectEl.empty();
            cloudModelDropdown.addOption('', '（使用默认模型）');
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
            .setName('模型模式')
            .setDesc('选择协同写作使用本地模型还是云端模型')
            .addDropdown(dropdown => {
                dropdown.addOption('local', '🖥 本地模型（Ollama）');
                dropdown.addOption('cloud', '☁️ 云端模型');
                dropdown.setValue(this.plugin.settings.coWriteModelMode || 'local');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteModelMode = value as 'local' | 'cloud';
                    await this.plugin.saveSettings();
                    updateVisibility();
                });
            });

        localModelSetting = new Setting(section)
            .setName('本地模型')
            .setDesc('选择协同写作使用的 Ollama 本地模型')
            .addDropdown(dropdown => {
                localModelDropdown = dropdown;
                dropdown.addOption('', '加载中...');
                dropdown.setValue(this.plugin.settings.coWriteModel || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.coWriteModel = value;
                    await this.plugin.saveSettings();
                });
            })
            .addButton(btn => {
                btn
                    .setButtonText('刷新')
                    .setTooltip('重新加载 Ollama 模型列表')
                    .onClick(() => {
                        loadLocalModels();
                    });
            });
        loadLocalModels();

        cloudProviderSetting = new Setting(section)
            .setName('云端供应商')
            .setDesc('选择云端模型的供应商')
            .addDropdown(dropdown => {
                cloudProviderDropdown = dropdown;
                dropdown.addOption('', '（未选择）');
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
            .setName('云端模型')
            .setDesc('选择协同写作使用的云端模型（留空则使用默认模型）')
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
            .setDesc('模型的创造性参数（0-2，默认 0.7）')
            .addSlider(slider => {
                slider.setLimits(0, 2, 0.05);
                slider.setValue(this.plugin.settings.coWriteTemperature ?? 0.7);
                slider.setDynamicTooltip();
                slider.onChange(async (value) => {
                    this.plugin.settings.coWriteTemperature = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('最大输出 Token')
            .setDesc('单次生成的最大 token 数（默认 600）')
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
            .setName('本地上下文窗口 num_ctx')
            .setDesc('0=按模型探测窗口自动；显存不足时可下调（如 16384/32768）')
            .addText(text => {
                text.setPlaceholder('0（自动）');
                text.setValue(String(this.plugin.settings.coWriteNumCtx ?? 0));
                text.onChange(async (value) => {
                    const num = parseInt(value, 10);
                    this.plugin.settings.coWriteNumCtx = Number.isFinite(num) && num > 0 ? num : 0;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('本地候选批量化')
            .setDesc('本地模型一次调用生成多个方向的候选，减少串行等待；解析失败自动回退逐方向生成')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.coWriteCandidateBatching !== false)
                .onChange(async (value) => {
                    this.plugin.settings.coWriteCandidateBatching = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('自动剧情评估')
            .setDesc('输入正文时自动评估剧情完成度（建议开启以获得实时反馈，关闭可节省 AI 调用）')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.autoPlotEvaluation ?? true);
                toggle.onChange(async (value) => {
                    this.plugin.settings.autoPlotEvaluation = value;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(section)
            .setName('自动联想（幽灵建议）')
            .setDesc('输入停顿后自动生成后续联想，按 Tab 接受（每 4 秒最多一次；关闭可节省 AI 调用，手动联想仍可用）')
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
            text: '控制每章字数、正文形态、上下文分配与质量闸门；规则版本与实验分组已移到「写作规则」页统一管理。',
            cls: 'setting-item-description',
        });

        const group = (title: string, desc: string): void => {
            section.createEl('h4', { text: title, cls: 'nw-u-margintop-24px' });
            section.createEl('p', { text: desc, cls: 'setting-item-description' });
        };

        group('篇幅与字数', '每章的目标字数与上下限；质量控制与字数校验都使用这三个值。');
        let wordRangeHint: HTMLElement | null = null;
        const validateWordRange = (): void => {
            if (!wordRangeHint) return;
            const min = Number(this.plugin.settings.minWordCount) || 0;
            const def = Number(this.plugin.settings.defaultWordCount) || 0;
            const max = Number(this.plugin.settings.maxWordCount) || 0;
            const problems: string[] = [];
            if (min > def) problems.push('最小字数大于默认字数');
            if (def > max) problems.push('默认字数大于最大字数');
            if (min > max) problems.push('最小字数大于最大字数');
            wordRangeHint.setText(problems.length > 0 ? `⚠️ ${problems.join('；')}` : '');
        };
        new Setting(section)
            .setName('默认字数')
            .setDesc('每章目标字数（默认 3000）。')
            .addText(text => text
                .setPlaceholder('3000')
                .setValue(String(this.plugin.settings.defaultWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.defaultWordCount = parseInt(value) || 3000;
                    await this.plugin.saveSettings();
                    validateWordRange();
                }));

        new Setting(section)
            .setName('最小字数')
            .setDesc('低于该值触发字数不足判定。')
            .addText(text => text
                .setPlaceholder('2500')
                .setValue(String(this.plugin.settings.minWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.minWordCount = parseInt(value) || 2500;
                    await this.plugin.saveSettings();
                    validateWordRange();
                }));

        new Setting(section)
            .setName('最大字数')
            .setDesc('高于该值触发超长提示。')
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

        group('正文形态', '决定生成时如何断段、使用哪套正文模板，以及注入哪些人味约束。');
        new Setting(section)
            .setName('自然段模式')
            .setDesc('把“一句一段”合并为 2–6 句自然段，并合并对话与说话人的动作；只影响自动生成，不影响手工编辑与协同逐段插入。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.naturalParagraphMode !== false)
                .onChange(async (value) => {
                    this.plugin.settings.naturalParagraphMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('正文模板变体')
            .setDesc('auto：有灵魂层走 V2；V3 节拍先行，V4 对话主干；V1/V2 可做对照。')
            .addDropdown((dropdown) => dropdown
                .addOption('auto', 'auto（有灵魂层 → V2）')
                .addOption('v1', 'V1 流水线正文')
                .addOption('v2', 'V2 小说家模式')
                .addOption('v3', 'V3 节拍先行')
                .addOption('v4', 'V4 对话主干')
                .setValue((this.plugin.settings.activeBodyTemplate || 'auto') as string)
                .onChange(async (value) => {
                    this.plugin.settings.activeBodyTemplate = (value || 'auto') as 'auto' | 'v1' | 'v2' | 'v3' | 'v4';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('人味约束模式')
            .setDesc('样文优先：3 段真人样文 + 6 条弱约束；旧配额用于对照。正文/消痕/精修链路都生效。')
            .addDropdown((dropdown) => dropdown
                .addOption('exemplar', '样文优先（默认）')
                .addOption('quota', '旧版数值配额（对照）')
                .setValue(this.plugin.settings.humanVoiceMode === 'quota' ? 'quota' : 'exemplar')
                .onChange(async (value) => {
                    this.plugin.settings.humanVoiceMode = value === 'quota' ? 'quota' : 'exemplar';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('可数硬指标（实验）')
            .setDesc('在正文 system 末尾追加可数的人味要求：时间锚点、口语标记、对话占比、段落长度。默认关闭。')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.countableHumanHints === true)
                .onChange(async (value) => {
                    this.plugin.settings.countableHumanHints = value;
                    await this.plugin.saveSettings();
                }));

        group('上下文与模型', '影响每次生成能看到多少资料，以及模型断联时的回退行为。');
        new Setting(section)
            .setName('故事上下文档位')
            .setDesc('自动按本地/云端模型选择资料量；本地更省上下文，云端使用完整文本与更多条目。')
            .addDropdown(dropdown => dropdown
                .addOption('auto', '自动')
                .addOption('local', '本地 Ollama / 小窗口')
                .addOption('cloud', '云端 API / 大窗口')
                .setValue(this.plugin.settings.storyContextTier || 'auto')
                .onChange(async (value) => {
                    this.plugin.settings.storyContextTier = value as 'auto' | 'local' | 'cloud';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('断联自动切换模型')
            .setDesc('API 断联/超时/503 时，自动尝试同端点下其他可用模型；写作任务会注入文风接续保护。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAutoModelFallback !== false)
                .onChange(async (value) => {
                    this.plugin.settings.enableAutoModelFallback = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('单步输入上限（token）')
            .setDesc('0 = 按模型真实上下文窗口自动分配（推荐）；仅在需要控制成本时填写上限（最大 200000）。')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(this.plugin.settings.contextTokenCap ?? 0))
                .onChange(async (value) => {
                    const n = Math.max(0, Math.min(200_000, parseInt(value) || 0));
                    this.plugin.settings.contextTokenCap = n;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('上下文超限处理')
            .setDesc('extractive：先定向补检再按句抽取压缩，仍超则明确报错；off：超预算直接报错。两种情况都不会静默腰斩正文。')
            .addDropdown(dropdown => dropdown
                .addOption('extractive', '抽取压缩（推荐）')
                .addOption('off', '不压缩，直接报错')
                .setValue(this.plugin.settings.contextCompressionMode ?? 'extractive')
                .onChange(async (value) => {
                    this.plugin.settings.contextCompressionMode = value === 'off' ? 'off' : 'extractive';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('上下文范围')
            .setDesc('紧凑模式只注入本章涉及实体（节省上下文）；完整模式遍历全部实体（质量优先）。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.contextScope === 'full')
                .onChange(async (value) => {
                    this.plugin.settings.contextScope = value ? 'full' : 'compact';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('超长提示词分片比例')
            .setDesc('提示词超出上下文安全线时保留头部的比例（0–1，默认 0.67）。')
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

        group('质量闸门与修订', '生成后的检查与自动修复；关闭后只保留基础质控。');
        new Setting(section)
            .setName('精修迭代轮数')
            .setDesc('「迭代精修」最多审查-修复几轮（0–5，默认 3）；首轮通过会提前结束，不额外消耗调用。')
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.refineRounds ?? 3))
                .onChange(async (value) => {
                    const n = Math.max(0, Math.min(5, parseInt(value) || 0));
                    this.plugin.settings.refineRounds = n;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('质量控制后自动定向修订')
            .setDesc('质量控制后按报告定向修订（最多 8 条），修订稿通过长度/人物/对话校验才落盘；每次多 1 次正文调用。默认开。')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.autoRevisionAfterQC !== false)
                .onChange(async (value) => {
                    this.plugin.settings.autoRevisionAfterQC = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('上下文体检')
            .setDesc('发 prompt 前清理重复注入段；步骤结果引用别的章节号时在注入账本告警。默认开。')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.contextHygieneAutoFix !== false)
                .onChange(async (value) => {
                    this.plugin.settings.contextHygieneAutoFix = value;
                    await this.plugin.saveSettings();
                }));

        group('阈值与词表', '一般保持默认；用于微调字数判定与 AI 味检测。');
        new Setting(section)
            .setName('步骤最低字数比例')
            .setDesc('步骤输出低于「目标字数 × 此比例」即判定字数不足（0–1，默认 0.70）。')
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
            .setName('AI 味词表扩充')
            .setDesc('每行一个词；会加入 AI 味检测、写作避用词黑名单与拆解引擎的连接词统计。留空只用内置词表。')
            .addTextArea(area => {
                area.setPlaceholder('例如：\n话说\n说白了\n不妨\n')
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
        section.createEl('hr', { cls: 'nw-u-m-20px-0 nw-u-b-none nw-u-bt-1px-solid-background-m-2' });
        section.createEl('h3', { text: '💬 提示词策略', cls: 'nw-u-margintop-16px-2' });
        if (this.plugin.promptManager) {
            const manager = new PromptManagerSettings(this.app, this.plugin, section);
            manager.render();
        } else {
            section.createDiv({ text: '提示词管理器未初始化', cls: 'nw-text-error' });
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
        section.createEl('h3', { text: '🗂 项目库迁移' });
        section.createEl('p', {
            text: '将根目录旧项目迁移到 长篇小说/、短篇小说/、剧本/ 三个独立模式库。默认 dry-run，只有点击迁移才会移动目录。',
            cls: 'setting-item-description',
        });

        const actions = section.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-8px-2 nw-u-marginbottom-8px-2' });
        const planBtn = actions.createEl('button', {
            text: '📋 生成迁移计划',
            cls: 'nw-btn nw-btn-secondary',
            attr: { type: 'button' },
        });
        const migrateBtn = actions.createEl('button', {
            text: '🚚 执行迁移（含备份清单）',
            cls: 'nw-btn nw-btn-primary',
            attr: { type: 'button' },
        });
        const resultEl = section.createDiv({ cls: 'nw-u-fs-12px-2 nw-u-c-text-muted-2' });

        const renderPlan = (planText: string): void => {
            resultEl.empty();
            resultEl.createEl('pre', { text: planText, cls: 'nw-u-fs-12px-2' });
        };

        planBtn.onclick = async () => {
            if (planBtn.disabled) return;
            planBtn.disabled = true;
            planBtn.setText('⏳ 扫描中…');
            try {
                const service = new ProjectMigrationService(this.app);
                const plan = await service.plan();
                if (plan.candidates.length === 0 && plan.conflicts.length === 0) {
                    renderPlan('没有需要迁移的 legacy 项目。');
                } else {
                    const lines: string[] = [];
                    if (plan.candidates.length > 0) {
                        lines.push('待迁移：');
                        for (const item of plan.candidates) {
                            lines.push(`- [${item.mode}] ${item.projectId} → ${item.targetPath}`);
                        }
                    }
                    if (plan.conflicts.length > 0) {
                        lines.push('冲突：');
                        for (const item of plan.conflicts) lines.push(`- ${item.projectId}：${item.reason}`);
                    }
                    if (plan.skipped.length > 0) {
                        lines.push('跳过：');
                        for (const item of plan.skipped) lines.push(`- ${item.projectId}：${item.reason}`);
                    }
                    renderPlan(lines.join('\n'));
                }
            } catch (e) {
                renderPlan(`生成迁移计划失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
                planBtn.disabled = false;
                planBtn.setText('📋 生成迁移计划');
            }
        };

        migrateBtn.onclick = async () => {
            if (migrateBtn.disabled) return;
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '迁移项目库',
                description: '将把根目录 legacy 项目移动到对应模式库；迁移前会写入备份清单。',
                confirmText: '开始迁移',
                cancelText: '取消',
            });
            if (!confirmed) return;
            migrateBtn.disabled = true;
            migrateBtn.setText('⏳ 迁移中…');
            try {
                const service = new ProjectMigrationService(this.app);
                const result = await service.migrateWithNotice({ backup: true });
                const lines = [
                    `已迁移 ${result.moved.length} 个项目`,
                    ...result.moved.map(item => `- ${item.projectId} → ${item.targetPath}`),
                ];
                if (result.failed.length > 0) {
                    lines.push('', '失败：');
                    for (const item of result.failed) lines.push(`- ${item.projectId}：${item.error}`);
                }
                if (result.warnings.length > 0) lines.push('', ...result.warnings);
                renderPlan(lines.join('\n'));
                if (result.moved.length > 0) {
                    const undo = resultEl.createEl('button', {
                        text: '↩️ 撤销本次迁移',
                        cls: 'nw-btn nw-btn-secondary',
                        attr: { type: 'button' },
                    });
                    undo.onclick = async () => {
                        if (undo.disabled) return;
                        const ok = await OperationConfirmModal.confirm(this.app, {
                            title: '撤销本次迁移',
                            description: `将把本次迁移的 ${result.moved.length} 个项目移回原路径。`,
                            warning: '迁移后在新路径里做过的编辑会随目录一起移回；原路径若已被占用会跳过该项。',
                            confirmText: '撤销迁移',
                            cancelText: '保留现状',
                        });
                        if (!ok) return;
                        undo.disabled = true;
                        undo.setText('⏳ 撤销中…');
                        const rollback = await service.rollbackWithNotice(result.moved);
                        const rollbackLines = [
                            `已撤销 ${rollback.restored.length} 个项目`,
                            ...rollback.restored.map(item => `- ${item.targetPath} → ${item.projectId}`),
                        ];
                        if (rollback.failed.length > 0) {
                            rollbackLines.push('', '未能撤销：');
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
                renderPlan(`迁移失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
                migrateBtn.disabled = false;
                migrateBtn.setText('🚚 执行迁移（含备份清单）');
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
        section.createEl('h3', { text: '🧩 工作台布局' });
        section.createEl('p', {
            text: '控制浮窗工作台是否在 Obsidian 启动后恢复上次布局。面板位置由浮窗系统自动记录。',
            cls: 'setting-item-description'
        });

        const panelLayout = this.plugin.settings.panelLayout || { panels: [], autoRestore: true, lastWorkspaceOpen: false };
        this.plugin.settings.panelLayout = panelLayout;

        new Setting(section)
            .setName('启动时恢复上次工作台')
            .setDesc('开启后，如果上次关闭 Obsidian 时工作台处于打开状态，插件加载后会自动恢复。')
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
            .setName('清除已保存浮窗位置')
            .setDesc('当前已保存 ' + savedCount + ' 个面板位置。')
            .addButton(btn => btn
                .setButtonText('清除布局记忆')
                .setWarning()
                .onClick(async () => {
                    if (!this.plugin.settings.panelLayout) {
                        this.plugin.settings.panelLayout = { panels: [], autoRestore: true, lastWorkspaceOpen: false };
                    }
                    this.plugin.settings.panelLayout.panels = [];
                    this.plugin.settings.panelLayout.lastWorkspaceOpen = false;
                    await this.plugin.saveSettings();
                    this.refresh();
                    new Notice('✅ 已清除浮窗布局记忆');
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
        section.createEl('h4', { text: '📐 面板尺寸' });
        section.createEl('p', {
            text: '可直接在界面上拖拽分隔条调整，也可在此精确输入。双击分隔条恢复默认。',
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
            label: string;
            desc: string;
            min: number;
            max: number;
            fallback: number;
        }> = [
            { key: 'fwStepNav', label: '写作工作台 · 左栏', desc: '步骤导航宽度', min: 100, max: 400, fallback: 140 },
            { key: 'fwRightPanel', label: '写作工作台 · 右栏', desc: '上下文/预览栏宽度', min: 160, max: 560, fallback: 220 },
        ];

        for (const row of rows) {
            new Setting(section)
                .setName(row.label)
                .setDesc(`${row.desc}（${row.min}–${row.max}px，默认 ${row.fallback}px）`)
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
                    .setTooltip('恢复默认宽度')
                    .onClick(async () => {
                        await persist(() => { delete sizes()[row.key]; });
                        this.refresh();
                    }));
        }

        new Setting(section)
            .setName('恢复全部面板尺寸')
            .setDesc('把所有面板宽高恢复为默认值（不影响浮窗位置记录）')
            .addButton(btn => btn
                .setButtonText('全部恢复默认')
                .setWarning()
                .onClick(async () => {
                    await persist(() => {
                        this.plugin.settings.panelSizes = {};
                        delete this.plugin.settings.agentWorkbenchLeftWidth;
                        delete this.plugin.settings.agentWorkbenchRightWidth;
                        delete this.plugin.settings.coWriteEditorWidthRatio;
                    });
                    this.refresh();
                    new Notice('✅ 已恢复全部面板尺寸');
                }));
    }
}
