import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ensureWritingStyleFolder, findWritingStyleFile, getWritingStyleWritePath } from './writing-style-paths';
import {
    loadStylePresets,
    parseStylePreset,
    saveStylePreset,
    STYLE_PRESET_DIR,
    type StylePresetDraft,
    type WritingStylePreset,
} from './writing-style-presets';
import { createLogger } from '../shared/logger';


const log = createLogger('WritingStyleModal');
const WS_SECTIONS = [
    { key: 'narrative', label: '一、叙事视角', hint: '第一人称/第三人称/多视角？是否限知？', rows: 2 },
    { key: 'overall', label: '二、文笔特征 — 总体风格', hint: '简洁/华丽/幽默/冷峻/热血？', rows: 2 },
    { key: 'syntax', label: '二、文笔特征 — 句式特征', hint: '短句为主/长句铺陈？修辞习惯？', rows: 2 },
    { key: 'diction', label: '二、文笔特征 — 用语习惯', hint: '口语化/文雅？现代/古风？特定用词偏好？', rows: 2 },
    { key: 'dialogue', label: '三、对话风格', hint: '对话占比、角色说话风格差异、口头禅模式', rows: 3 },
    { key: 'description', label: '四、描写风格', hint: '描写占比上限、侧重环境/动作/心理', rows: 3 },
    { key: 'rhythm', label: '五、叙事节奏', hint: '紧张情节段落节奏、舒缓情节段落节奏', rows: 2 },
    { key: 'emotion', label: '六、情感表达方式', hint: '直接描写心理 vs 通过动作/对话暗示', rows: 2 },
    { key: 'forbidden', label: '七、禁用/慎用', hint: '禁用词汇、禁用标点、禁用的修辞手法', rows: 3 },
    { key: 'reference', label: '八、参考作品', hint: '风格参考的作者/小说', rows: 2 },
    { key: 'platform', label: '九、番茄小说格式要求', hint: '每段开头缩进、对话独立成段、标题格式等', rows: 2 },
];

export class WritingStyleModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    private onSaved?: () => void;
    private inputs: Map<string, HTMLTextAreaElement> = new Map();

    constructor(app: App, plugin: NovelWriterPlugin, project: string, onSaved?: () => void) {
        super(app);
        this.plugin = plugin;
        this.project = project;
        this.onSaved = onSaved;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');

        contentEl.empty();
        contentEl.addClass('novel-writer-writing-style-modal');

        contentEl.createEl('h2', { text: '✍️ 文笔风格设定' });
        contentEl.createEl('p', { text: `项目: ${this.project}`, attr: { style: 'color:var(--text-muted); font-size:0.85em; margin-bottom:12px;' } });

        const presetRow = contentEl.createDiv({ attr: { style: 'display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;' } });
        presetRow.createEl('span', { text: '文笔风格预设：', attr: { style: 'font-weight:600; font-size:0.9em;' } });
        const presetSelect = presetRow.createEl('select', { attr: { style: 'flex:1; min-width:220px;' } });
        presetSelect.createEl('option', { value: '', text: '（不套用预设，手动填写）' });
        const applyPresetBtn = presetRow.createEl('button', {
            text: '应用预设',
            attr: { style: 'padding:6px 14px; background:var(--text-accent); color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.85em;' },
        });
        const newPresetBtn = presetRow.createEl('button', {
            text: '➕ 新增预设',
            attr: { style: 'padding:6px 14px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; font-size:0.85em;' },
        });
        const presetHint = contentEl.createEl('p', {
            text: '',
            attr: { style: 'color:var(--text-muted); font-size:0.78em; margin:0 0 14px 0;' },
        });

        // 新增预设面板：填名称 → AI 生成 9 节内容 → 保存为预设文件
        const newPresetPanel = contentEl.createDiv({
            attr: { style: 'display:none; gap:8px; flex-direction:column; padding:12px; margin-bottom:12px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:6px;' },
        });
        newPresetPanel.createEl('div', { text: '新建文笔风格预设', attr: { style: 'font-weight:600; font-size:0.9em;' } });
        const presetNameInput = newPresetPanel.createEl('input', {
            type: 'text',
            attr: { placeholder: '预设名称（必填，如：冷硬派刑侦）', style: 'width:100%; padding:6px 8px; border-radius:4px; border:1px solid var(--background-modifier-border);' },
        });
        const presetDescInput = newPresetPanel.createEl('input', {
            type: 'text',
            attr: { placeholder: '一句话风格描述（可选，AI 会参考）', style: 'width:100%; padding:6px 8px; border-radius:4px; border:1px solid var(--background-modifier-border);' },
        });
        const presetActionRow = newPresetPanel.createDiv({ attr: { style: 'display:flex; gap:8px; flex-wrap:wrap;' } });
        const aiGenerateBtn = presetActionRow.createEl('button', {
            text: '🪄 AI 生成内容',
            attr: { style: 'padding:6px 14px; background:var(--text-accent); color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.85em;' },
        });
        const saveAsPresetBtn = presetActionRow.createEl('button', {
            text: '💾 保存为新预设',
            attr: { style: 'padding:6px 14px; background:var(--background-primary); border:1px solid var(--text-accent); color:var(--text-accent); border-radius:4px; cursor:pointer; font-size:0.85em;' },
        });
        const presetStatus = newPresetPanel.createEl('span', {
            text: '填写名称后点击「AI 生成内容」，生成结果会填入下方表单，可继续修改。',
            attr: { style: 'color:var(--text-muted); font-size:0.78em;' },
        });

        newPresetBtn.addEventListener('click', () => {
            const visible = newPresetPanel.style.display !== 'none';
            newPresetPanel.style.display = visible ? 'none' : 'flex';
        });

        let presets: WritingStylePreset[] = [];
        void loadStylePresets(this.app).then(list => {
            presets = list;
            if (list.length === 0) {
                presetHint.setText(`未找到预设文件；可在「${STYLE_PRESET_DIR}」中新增 .md 预设。`);
                return;
            }
            for (const preset of list) {
                presetSelect.createEl('option', {
                    value: preset.id,
                    text: `${preset.name}${preset.description ? ` — ${preset.description}` : ''}`,
                });
            }
            presetHint.setText(`共 ${list.length} 套预设；应用后仍可继续手工修改。也可在「${STYLE_PRESET_DIR}」新增自定义预设。`);
        });

        applyPresetBtn.addEventListener('click', () => {
            const preset = presets.find(p => p.id === presetSelect.value);
            if (!preset) {
                new Notice('⚠️ 请先选择一个预设', 3000);
                return;
            }
            this.applyPreset(preset);
        });

        aiGenerateBtn.addEventListener('click', async () => {
            const name = presetNameInput.value.trim();
            if (!name) {
                new Notice('⚠️ 请先填写预设名称', 3000);
                presetNameInput.focus();
                return;
            }
            aiGenerateBtn.disabled = true;
            aiGenerateBtn.setText('⏳ 生成中...');
            presetStatus.setText(`AI 正在生成「${name}」的文笔设定...`);
            try {
                const generated = await this.generatePresetWithAI(name, presetDescInput.value.trim());
                if (!generated) {
                    presetStatus.setText('❌ 生成失败：请检查模型配置，或稍后重试');
                    return;
                }
                this.fillFromGenerated(generated);
                presetStatus.setText('✅ 已填入下方表单；可直接保存到项目，或点「保存为新预设」沉淀为预设');
            } catch (e) {
                presetStatus.setText(`❌ 生成失败：${e instanceof Error ? e.message : String(e)}`);
            } finally {
                aiGenerateBtn.disabled = false;
                aiGenerateBtn.setText('🪄 AI 生成内容');
            }
        });

        saveAsPresetBtn.addEventListener('click', async () => {
            const name = presetNameInput.value.trim();
            if (!name) {
                new Notice('⚠️ 请先填写预设名称', 3000);
                presetNameInput.focus();
                return;
            }
            try {
                const draft: StylePresetDraft = {
                    name,
                    description: presetDescInput.value.trim(),
                    sections: this.collectPresetSections(),
                    sample: this.inputs.get('sample')?.value || '',
                };
                const path = await saveStylePreset(this.app, draft);
                const id = path.split('/').pop()!.replace(/\.md$/, '');
                const raw = await this.app.vault.adapter.read(path);
                presets.push(parseStylePreset(id, raw));
                presetSelect.createEl('option', { value: id, text: name });
                presetHint.setText(`共 ${presets.length} 套预设；新增预设已写入「${STYLE_PRESET_DIR}」。`);
                new Notice(`✅ 预设「${name}」已保存：${path}`, 5000);
            } catch (e) {
                new Notice(`❌ ${e instanceof Error ? e.message : String(e)}`, 6000);
            }
        });

        const formEl = contentEl.createDiv({ attr: { style: 'max-height: 60vh; overflow-y: auto; padding-right: 8px;' } });

        const sampleGroup = formEl.createDiv({ attr: { style: 'margin-bottom: 14px;' } });
        sampleGroup.createEl('label', { text: '零、参考样本（可直接粘贴想模仿的原文片段）', attr: { style: 'display:block; font-weight:600; margin-bottom:4px; font-size:0.9em;' } });
        sampleGroup.createEl('span', { text: '样本是 AI 的"语音教练"；请使用你拥有合法使用权的文本。', attr: { style: 'display:block; color:var(--text-muted); font-size:0.75em; margin-bottom:4px;' } });
        const sampleArea = sampleGroup.createEl('textarea', {
            attr: {
                placeholder: '### 战斗/冲突场景样本\n（在此粘贴样本）\n\n### 日常/对话场景样本\n（在此粘贴样本）\n\n### 情绪/心理场景样本\n（在此粘贴样本）',
                style: 'width:100%; min-height:160px; resize:vertical; font-size:0.85em; border-radius:4px;',
            },
        });
        this.inputs.set('sample', sampleArea);

        for (const sec of WS_SECTIONS) {
            const group = formEl.createDiv({ attr: { style: 'margin-bottom: 14px;' } });
            group.createEl('label', { text: sec.label, attr: { style: 'display:block; font-weight:600; margin-bottom:4px; font-size:0.9em;' } });
            group.createEl('span', { text: sec.hint, attr: { style: 'display:block; color:var(--text-muted); font-size:0.75em; margin-bottom:4px;' } });

            const textarea = group.createEl('textarea', {
                attr: {
                    placeholder: sec.hint,
                    style: `width:100%; min-height:${sec.rows * 28}px; resize:vertical; font-size:0.85em; border-radius:4px;`,
                },
            });
            this.inputs.set(sec.key, textarea);
        }

        // 加载已有内容
        this.loadExistingContent();

        // 按钮行
        const btnRow = contentEl.createDiv({ attr: { style: 'display:flex; gap:8px; justify-content:flex-end; margin-top:16px; padding-top:12px; border-top:1px solid var(--background-modifier-border);' } });

        const cancelBtn = btnRow.createEl('button', {
            text: '取消',
            attr: { style: 'padding:8px 16px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer;' },
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnRow.createEl('button', {
            text: '💾 保存',
            attr: { style: 'padding:8px 20px; background:var(--text-accent); color:white; border:none; border-radius:4px; cursor:pointer; font-weight:600;' },
        });
        saveBtn.addEventListener('click', async () => {
            await this.save();
            if (this.onSaved) this.onSaved();
            this.close();
        });
    }

    private applyPreset(preset: WritingStylePreset): void {
        const mapping: Record<string, string | undefined> = {
            narrative: preset.sections['一、叙事视角'],
            overall: preset.sections['总体风格'],
            syntax: preset.sections['句式特征'],
            diction: preset.sections['用语习惯'],
            dialogue: preset.sections['三、对话风格'],
            description: preset.sections['四、描写风格'],
            rhythm: preset.sections['五、叙事节奏'],
            emotion: preset.sections['六、情感表达方式'],
            forbidden: preset.sections['七、禁用/慎用'],
            reference: preset.sections['八、参考作品'],
            platform: preset.sections['九、番茄小说格式要求'],
        };

        for (const [key, value] of Object.entries(mapping)) {
            if (!value) continue;
            const input = this.inputs.get(key);
            if (input) input.value = value;
        }

        const sample = this.inputs.get('sample');
        if (sample && preset.reference) sample.value = preset.reference;

        new Notice(`✅ 已应用预设「${preset.name}」，可继续修改后保存`, 4000);
    }

    /** 表单字段 → 预设章节标题 */
    private static readonly PRESET_SECTION_MAP: Record<string, string> = {
        narrative: '一、叙事视角',
        overall: '总体风格',
        syntax: '句式特征',
        diction: '用语习惯',
        dialogue: '三、对话风格',
        description: '四、描写风格',
        rhythm: '五、叙事节奏',
        emotion: '六、情感表达方式',
        forbidden: '七、禁用/慎用',
        reference: '八、参考作品',
        platform: '九、番茄小说格式要求',
    };

    private collectPresetSections(): Record<string, string> {
        const sections: Record<string, string> = {};
        for (const [key, heading] of Object.entries(WritingStyleModal.PRESET_SECTION_MAP)) {
            sections[heading] = this.inputs.get(key)?.value.trim() || '';
        }
        return sections;
    }

    private fillFromGenerated(generated: { sections: Record<string, string>; sample?: string }): void {
        for (const [key, heading] of Object.entries(WritingStyleModal.PRESET_SECTION_MAP)) {
            const value = generated.sections[heading];
            if (!value) continue;
            const input = this.inputs.get(key);
            if (input) input.value = value;
        }
        if (generated.sample) {
            const sample = this.inputs.get('sample');
            if (sample) sample.value = generated.sample;
        }
    }

    private parseJsonObject(raw: string): Record<string, unknown> | null {
        const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    /**
     * 用 AI 根据预设名称生成 9 节文笔设定与一段参考样本。
     * 输出约定为 JSON；解析失败时返回 null，由调用方提示重试。
     */
    private async generatePresetWithAI(
        name: string,
        description: string
    ): Promise<{ sections: Record<string, string>; sample?: string } | null> {
        const systemPrompt = `你是资深网文文笔风格设计师。请根据用户给出的风格名称，设计一套可直接执行的写作风格规范。
只输出 JSON 对象，不要输出 Markdown 代码块、不要解释。JSON 结构：
{
  "一、叙事视角": "……",
  "总体风格": "……",
  "句式特征": "……",
  "用语习惯": "……",
  "三、对话风格": "……",
  "四、描写风格": "……",
  "五、叙事节奏": "……",
  "六、情感表达方式": "……",
  "七、禁用/慎用": "……",
  "八、参考作品": "……",
  "九、番茄小说格式要求": "……",
  "sample": "一段 300-500 字的示例文本，完整体现该风格"
}
要求：
1. 每个字段都必须有具体、可执行的内容，禁止写"待补充""无"或空值。
2. 风格描述要能直接约束 AI 写作，而不是空泛形容词。
3. sample 必须是原创示例，不得抄袭现有作品原文。`;

        // 同一风格名重复生成时必须得到不同结果，因此加入随机种子并绕过 prompt 缓存
        const randomSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const userPrompt = `风格名称：${name}
${description ? `风格补充说明：${description}` : ''}
本次随机种子：${randomSeed}

请生成这套文笔风格规范。要求每次生成在句式、意象、节奏上都有可感知的差异，不要复用上一版模板化表述。`;

        const response = await this.plugin.aiEngine.callAI(
            systemPrompt,
            userPrompt,
            undefined,
            0.8,
            this.plugin.settings.maxOutput,
            { bypassCache: true }
        );
        if (response.error || !response.content) {
            log.warn('[小说工坊] AI 生成文笔预设失败:', response.error);
            return null;
        }

        const parsed = this.parseJsonObject(response.content);
        if (!parsed) {
            log.warn('[小说工坊] 文笔预设 JSON 解析失败，原始输出:', response.content.slice(0, 300));
            return null;
        }

        const sections: Record<string, string> = {};
        for (const heading of Object.values(WritingStyleModal.PRESET_SECTION_MAP)) {
            const value = parsed[heading];
            if (typeof value === 'string' && value.trim()) {
                sections[heading] = value.trim();
            }
        }

        const missing = Object.values(WritingStyleModal.PRESET_SECTION_MAP).filter(h => !sections[h]);
        if (missing.length > 0) {
            log.warn('[小说工坊] 文笔预设缺少分节:', missing.join('、'));
            return null;
        }

        return {
            sections,
            sample: typeof parsed.sample === 'string' ? parsed.sample.trim() : undefined,
        };
    }

    private async loadExistingContent(): Promise<void> {
        const wsPath = getWritingStyleWritePath(this.project);
        const wsFile = await findWritingStyleFile(this.app, this.project);
        if (!(wsFile instanceof TFile)) return;

        try {
            const content = await this.app.vault.read(wsFile);

            const sampleInput = this.inputs.get('sample');
            if (sampleInput) {
                const sample = this.extractHeadingSection(content, '## 零、参考样本');
                if (sample) sampleInput.value = sample;
            }

            // 解析各 section 的内容（## 标题后的内容直到下一个 ##）
            const sectionPatterns: [string, string][] = [
                ['narrative', '## 一、叙事视角'],
                ['overall', '## 二、文笔特征'],
                ['syntax', '## 二、文笔特征'],
                ['diction', '## 二、文笔特征'],
                ['dialogue', '## 三、对话风格'],
                ['description', '## 四、描写风格'],
                ['rhythm', '## 五、叙事节奏'],
                ['emotion', '## 六、情感表达方式'],
                ['forbidden', '## 七、禁用/慎用'],
                ['reference', '## 八、参考作品'],
                ['platform', '## 九、番茄小说格式要求'],
            ];

            for (const [key, heading] of sectionPatterns) {
                const input = this.inputs.get(key);
                if (!input) continue;

                // 找到对应标题
                const headingIdx = content.indexOf(heading);
                if (headingIdx === -1) continue;

                // 找到下一个 ## 标题或 --- 分隔线（取更靠前的作为结束）
                const afterHeading = content.indexOf('\n', headingIdx) + 1;
                let endIdx = content.indexOf('\n## ', afterHeading);
                const hrIdx = content.indexOf('\n---\n', afterHeading);
                if (hrIdx !== -1 && (endIdx === -1 || hrIdx < endIdx)) endIdx = hrIdx;
                if (endIdx === -1) endIdx = content.length;

                let sectionText = content.substring(afterHeading, endIdx).trim();

                // 特殊处理：二、文笔特征 的 4 个子模块
                if (key === 'overall') {
                    sectionText = this.extractSubSection(sectionText, '总体风格');
                } else if (key === 'syntax') {
                    sectionText = this.extractSubSection(sectionText, '句式特征');
                } else if (key === 'diction') {
                    sectionText = this.extractSubSection(sectionText, '用语习惯');
                }

                // 清理注释行
                sectionText = sectionText.replace(/<!--[\s\S]*?-->/g, '').trim();
                // v3.5: 跳过模板占位符内容（只有标签没有实际值的行），保留预设
                const hasRealContent = sectionText.split('\n').some(l => {
                    const t = l.trim();
                    return t && !t.startsWith('>') && !t.startsWith('-') && !t.startsWith('<!--');
                }) || sectionText.length > 100;
                if (sectionText && !sectionText.startsWith('>') && hasRealContent) {
                    input.value = sectionText;
                }
            }
        } catch (e) {
            log.warn('[小说工坊] 读取文笔风格失败:', e);
        }
    }

    private extractSubSection(text: string, subName: string): string {
        const marker = `### ${subName}`;
        const idx = text.indexOf(marker);
        if (idx === -1) return '';
        const after = idx + marker.length;
        const nextMarker = text.indexOf('\n### ', after);
        const end = nextMarker === -1 ? text.length : nextMarker;
        return text.substring(after, end).trim();
    }

    private extractHeadingSection(content: string, heading: string): string {
        const idx = content.indexOf(heading);
        if (idx === -1) return '';
        const after = content.indexOf('\n', idx);
        if (after === -1) return '';
        const next = content.indexOf('\n## ', after);
        return content.slice(after + 1, next === -1 ? content.length : next).trim();
    }

    private async save(): Promise<void> {
        const values: Record<string, string> = {};
        for (const sec of WS_SECTIONS) {
            values[sec.key] = this.inputs.get(sec.key)?.value.trim() || '';
        }

        // 检查是否至少填写了基本内容
        const hasBasicContent = values['narrative'] || values['overall'];
        if (!hasBasicContent) {
            new Notice('⚠️ 请至少填写叙事视角和总体风格', 4000);
            return;
        }

        const markdown = this.buildMarkdown(values);
        const wsPath = getWritingStyleWritePath(this.project);

        try {
            await ensureWritingStyleFolder(this.app, this.project);
            // v4.1: 先按候选路径定位现有文件（可能是 元文件 复制来的「文笔风格模板.md」）。
            // 若现有文件不在正式写入路径，则重命名收敛到「文笔风格.md」，避免出现双文件；找不到才新建。
            const existingFile = await findWritingStyleFile(this.app, this.project, { allowPlaceholder: true });
            if (existingFile instanceof TFile) {
                if (existingFile.path !== wsPath) {
                    const occupied = this.app.vault.getAbstractFileByPath(wsPath);
                    if (!occupied) {
                        await this.app.fileManager.renameFile(existingFile, wsPath);
                    }
                }
                const target = this.app.vault.getAbstractFileByPath(wsPath);
                if (target instanceof TFile) {
                    await this.app.vault.modify(target, markdown);
                } else {
                    await this.app.vault.modify(existingFile, markdown);
                }
            } else {
                await this.app.vault.create(wsPath, markdown);
            }
            new Notice('✅ 文笔风格已保存', 3000);
        } catch (e) {
            new Notice(`❌ 保存失败: ${(e as Error).message}`, 5000);
        }
    }

    private buildMarkdown(values: Record<string, string>): string {
        const nl = (v: string) => v || '';

        return `---
tags: [文笔风格]
source: manual
---

# 文笔风格

> 本项目的文笔风格、叙事特征、语言习惯。
> 写作时自动加载此文件到 AI System Prompt。

---

## 零、参考样本
${nl(values['sample'])}

## 一、叙事视角
${nl(values['narrative'])}

## 二、文笔特征

### 总体风格
${nl(values['overall'])}

### 句式特征
${nl(values['syntax'])}

### 用语习惯
${nl(values['diction'])}

## 三、对话风格
${nl(values['dialogue'])}

## 四、描写风格
${nl(values['description'])}

## 五、叙事节奏
${nl(values['rhythm'])}

## 六、情感表达方式
${nl(values['emotion'])}

## 七、禁用/慎用
${nl(values['forbidden'])}

## 八、参考作品
${nl(values['reference'])}

## 九、番茄小说格式要求
${nl(values['platform'])}
`;
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

