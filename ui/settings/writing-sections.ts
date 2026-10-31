/**
 * writing-sections.ts — 写作类六个分区
 *
 * 职责：协同写作模型配置、写作参数与规则版本、模板/提示词策略、外观、
 * 项目库迁移、工作台布局与面板尺寸。
 * 来源：原 settings-tab.ts L1364-L1820、L3471-L3719（按分区顺序物理搬移）。
 * 依赖：宿主提供的 app/plugin/refresh/reopen（见 section-base.ts）。
 */
import { Setting, Notice } from 'obsidian';
import { renderAppearanceSettings } from '../appearance-settings';
import { TemplateManager } from '../template-manager';
import { getOllamaModelsWithFallback } from '../../engine/co-writer-engine';
import { ProjectMigrationService } from '../../engine/project-migration-service';
import { AntiAIDetector } from '../../engine/anti-ai-detector';
import { PromptManagerSettings } from '../prompt-manager-settings';
import { ENGINE_NAMES } from '../../shared/engine-names';
import { OperationConfirmModal } from '../components/progress';
import { setBusinessThresholdOverrides } from '../../shared/thresholds';
import { SettingsSection } from './section-base';

export class CoWriteSection extends SettingsSection {
    render(container: HTMLElement): void {
        const section = container.createEl('section');

        section.createEl('p', {
            text: '配置协同写作使用的模型。可在本地 Ollama 和云端 API 之间自由切换。',
            cls: 'setting-item-description'
        });

        let localModelDropdown: any = null;
        let cloudProviderDropdown: any = null;
        let cloudModelDropdown: any = null;
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
            localModelDropdown.selectEl.innerHTML = '';
            localModelDropdown.addOption('', '加载中...');
            localModelDropdown.setValue('');
            const models = await getOllamaModelsWithFallback(this.plugin.settings);
            localModelDropdown.selectEl.innerHTML = '';
            localModelDropdown.addOption('', '（未设置 — 协同写作将无法使用）');
            for (const m of models) {
                localModelDropdown.addOption(m, `🖥 ${m}`);
            }
            localModelDropdown.setValue(this.plugin.settings.coWriteModel || '');
        };

        const refreshCloudModelDropdown = () => {
            if (!cloudModelDropdown) return;
            cloudModelDropdown.selectEl.innerHTML = '';
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

export class WritingSection extends SettingsSection {
    render(container: HTMLElement): void {
        const section = container.createEl('section');

        new Setting(section)
            .setName('默认字数')
            .setDesc('每章默认字数')
            .addText(text => text
                .setPlaceholder('3000')
                .setValue(String(this.plugin.settings.defaultWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.defaultWordCount = parseInt(value) || 3000;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('最小字数')
            .setDesc('每章最小字数')
            .addText(text => text
                .setPlaceholder('2500')
                .setValue(String(this.plugin.settings.minWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.minWordCount = parseInt(value) || 2500;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('最大字数')
            .setDesc('每章最大字数')
            .addText(text => text
                .setPlaceholder('5000')
                .setValue(String(this.plugin.settings.maxWordCount))
                .onChange(async (value) => {
                    this.plugin.settings.maxWordCount = parseInt(value) || 5000;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('自然段模式')
            .setDesc('正文写入时，把相邻的“一句一段”合并成 2–6 句的自然段，并合并对话与说话人的动作。只影响一键生成/续写/批量/场景，不影响手工编辑和协同写作逐段插入。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.naturalParagraphMode !== false)
                .onChange(async (value) => {
                    this.plugin.settings.naturalParagraphMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('故事上下文档位')
            .setDesc('自动：协同按本地/云端模式，一键按默认模型推断。本地档位使用压缩文本与更少条目，云端档位使用完整文本与更多条目。')
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
            .setDesc('API断联/超时/503时，自动尝试同端点下其他可用模型（写作类任务会注入文风接续保护）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAutoModelFallback !== false)
                .onChange(async (value) => {
                    this.plugin.settings.enableAutoModelFallback = value;
                    await this.plugin.saveSettings();
                }));

        // P0-4: 精修迭代轮数参数化（原硬编码 3，spec p0-api-efficiency-optimization AC-4.3）
        new Setting(section)
            .setName('精修迭代轮数')
            .setDesc('「迭代精修」的最大审查-修复轮数（0-5，0=跳过精修，默认 3）。首轮审查通过时自动短路，不额外消耗调用。')
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.refineRounds ?? 3))
                .onChange(async (value) => {
                    const n = Math.max(0, Math.min(5, parseInt(value) || 0));
                    this.plugin.settings.refineRounds = n;
                    await this.plugin.saveSettings();
                }));

        // v4.23: 版本治理（写作规则多版本 + 人味模式 + 实验分组 + 规则去重）
        new Setting(section)
            .setName('写作规则版本')
            .setDesc('多版本并存，同一时刻只生效一个。空的「auto」按「项目 → vault → 内置」优先级；版本号相同但内容不同会在这里提示漂移。')
            .addDropdown(async (dropdown) => {
                dropdown.addOption('', 'auto（项目 → vault → 内置）');
                try {
                    const { listRulesVersions } = await import('../../services/rules-registry');
                    const listing = await listRulesVersions(this.plugin.app, {
                        activeVersion: this.plugin.settings.activeRulesVersion,
                        project: this.plugin.getActiveProject() || undefined,
                    });
                    for (const doc of listing.docs) {
                        dropdown.addOption(doc.id, `${doc.id}（${doc.source}${doc.path ? ` ${doc.path}` : ''}）`);
                    }
                } catch (e) {
                    console.warn('[设置] 读取规则版本失败:', e);
                }
                dropdown.setValue(this.plugin.settings.activeRulesVersion || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.activeRulesVersion = value;
                    await this.plugin.saveSettings();
                    const { RulesService } = await import('../../services/rules-service');
                    RulesService.getInstance(this.plugin.app).invalidateCache();
                });
            });

        new Setting(section)
            .setName('正文模板变体')
            .setDesc('auto：有灵魂层走 V2。V3 节拍先行（台词清单前置、不注入禁用清单）；V4 对话主干（按台词编号写成连续对话）。V1/V2 可做对照。')
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
            .setName('可数硬指标（实验 C9）')
            .setDesc('在正文 system 末尾追加四项可数要求：≥6 个时间锚点、≥8 处口语标记、对话三成以上、段落仍 2–6 句。实测配 V4 对话主干可把对话占比推到 24%、锚点从 0 到 2；配 V3 会把节奏压塌。默认关闭。')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.countableHumanHints === true)
                .onChange(async (value) => {
                    this.plugin.settings.countableHumanHints = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('质量控制后自动定向修订')
            .setDesc('质量控制步骤完成后自动跑一次「按报告定向修订」：只改报告列出的问题（最多 8 条），锁定人物与情节，修订稿通过长度/人物/对话占比校验才落盘，采纳前自动存章节版本并做量化复检。每次消耗 1 次正文调用。默认开。')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.autoRevisionAfterQC !== false)
                .onChange(async (value) => {
                    this.plugin.settings.autoRevisionAfterQC = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('上下文体检（重复段自动清空）')
            .setDesc('发 prompt 前比较各注入段：内容重复 ≥85% 的保留权威版本、清空另一份（如「文笔风格」里的规则副本、世界观与设定库重复段）；步骤结果引用了别的章节号时在注入账本里告警（不自动改）。默认开。')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.contextHygieneAutoFix !== false)
                .onChange(async (value) => {
                    this.plugin.settings.contextHygieneAutoFix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('人味约束模式')
            .setDesc('样文优先（默认）：3 段真人样文 + 6 条弱约束；旧配额：23 条数值配额（对照用）。此项在正文/消痕/精修链路都生效。')
            .addDropdown((dropdown) => dropdown
                .addOption('exemplar', '样文优先（默认）')
                .addOption('quota', '旧版数值配额（对照）')
                .setValue(this.plugin.settings.humanVoiceMode === 'quota' ? 'quota' : 'exemplar')
                .onChange(async (value) => {
                    this.plugin.settings.humanVoiceMode = value === 'quota' ? 'quota' : 'exemplar';
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('规则去重（文笔风格里不再重复注入规则）')
            .setDesc('开启后，「文笔风格」段不再包含写作规则的编号章副本，避免规则权重翻倍并绕过版本管理。关掉可恢复旧行为。')
            .addToggle((toggle) => toggle
                .setValue(this.plugin.settings.dedupeRulesInStyle !== false)
                .onChange(async (value) => {
                    this.plugin.settings.dedupeRulesInStyle = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(section)
            .setName('实验分组标签')
            .setDesc('写进注入账本与步骤结果 frontmatter，便于把「哪一组实验产生的正文」与实际模板/规则版本对上。留空则不记录。')
            .addText((text) => text
                .setPlaceholder('例如 G2-新规则+样文')
                .setValue(this.plugin.settings.experimentGroup || '')
                .onChange(async (value) => {
                    this.plugin.settings.experimentGroup = value.trim().slice(0, 60);
                    await this.plugin.saveSettings();
                }));

        // v4.22: 单步输入 token 上限（0=按模型真实窗口自动分配）
        new Setting(section)
            .setName('单步输入上限（token）')
            .setDesc('0 = 按当前模型的真实上下文窗口自动分配（推荐）。实测旧闸门回退到 32768 窗口，正文只拿到 24K token，与 1M 窗口差 40 倍，导致世界观/人物/上一章结尾被大量丢弃。仅在想控制成本时填一个上限（最大 200000）。')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(this.plugin.settings.contextTokenCap ?? 0))
                .onChange(async (value) => {
                    const n = Math.max(0, Math.min(200_000, parseInt(value) || 0));
                    this.plugin.settings.contextTokenCap = n;
                    await this.plugin.saveSettings();
                }));

        // R2: 反AI 检测词表扩充（默认空 → 检测结果与内置词表一致，无行为变化）
        new Setting(section)
            .setName('AI 味词表扩充')
            .setDesc('每行一个词。这些词会同时加入「AI 味检测」的 L1 词频命中、写作避用词黑名单，以及拆解引擎的连接词密度统计。留空则只用内置词表。')
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

        // R1: 业务阈值设置项化（默认值与 shared/thresholds.ts 内置常量一致，不改变默认行为）
        new Setting(section)
            .setName('步骤最低字数比例')
            .setDesc('步骤输出低于「目标字数 × 此比例」即判定字数不足（0-1，默认 0.70）。')
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
            .setName('超长提示词分片比例')
            .setDesc('提示词超出上下文安全线时，保留头部的比例（0-1，默认 0.67；越小保留的中段资料越少）。')
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

        new Setting(section)
            .setName('上下文范围')
            .setDesc('紧凑模式仅注入本章涉及实体（节省上下文），完整模式遍历全部实体（质量优先）')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.contextScope === 'full')
                .onChange(async (value) => {
                    this.plugin.settings.contextScope = value ? 'full' : 'compact';
                    await this.plugin.saveSettings();
                }));
    }
}

export class TemplateSection extends SettingsSection {
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

export class AppearanceSection extends SettingsSection {
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        renderAppearanceSettings(section, this.plugin, {
            compact: false,
            rerender: () => this.refresh(),
        });
    }
}

export class ProjectLibrarySection extends SettingsSection {
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

export class LayoutSection extends SettingsSection {
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
