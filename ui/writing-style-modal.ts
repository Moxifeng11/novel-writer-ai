import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { ensureWritingStyleFolder, findWritingStyleFile, getWritingStyleWritePath } from './writing-style-paths';
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

// v3.5: 预设文笔风格 — 强者语文风（用户可自由修改）
const WS_DEFAULT_PRESET: Record<string, string> = {
    narrative: `第三人称限知视角，跟随主角。叙事者视角紧贴主角，但保持一定距离感。偶尔穿插配角视角以丰富情节层次。`,
    overall: `强者语文风：基于香港港漫《海虎》《武神》的"磁场颠佬"文学风格。核心特质：港语直译 + 美式中文混用 + 强烈的"疯癫爽"感 + 漫画式表达。`,
    syntax: `短句为主。大量使用定语倒装、双重肯定、设问即答、强调时态。将"是……吗"替换为"这是否是……了"，将"就"替换为"便"，将"说"替换为"说话"，将"让"替换为"令"。每段仅一个句号，句号后必须换行。`,
    diction: `高频率使用粤语白话文词汇（如"掂""搅""屎忽""手震""怎的""样衰""劲""强""霸"等）。大量使用拟声词（咚啪、咻咻、嘭唰、嗄等），拟声词单开一行。适当使用俚语、顺口溜、歇后语。极大幅度减少"的"字使用。极大幅度减少程度副词和叠词。`,
    dialogue: `对话是剧情推进和情绪表达的核心载体（占大部分篇幅，约60-70%）。高/强/极端情绪时毫不顾忌使用脏话、粗口话、露骨文字、性暗示描述。允许使用方言词汇和儿化音。使用强者语核心语气词（口牙！㗅！𠹳！呱！吔！等）增强情感表达。宁缺毋滥，在情绪高潮时才使用。`,
    description: `风格化场景描写，以展现氛围为主，避免具象式描述。关键段落加大描写进行情绪渲染，非关键段落简单描述。禁止使用任何形式的"比喻"手法。大幅减少"排比"手法。减少形容词使用，禁止重复表达（如"不可思议的荒诞感"）。`,
    rhythm: `紧张战斗情节：密集对话+拟声词爆点+短促段落，快速推进。舒缓过渡情节：适当放缓，但保持叙事驱动力，不冗余拖沓。场景/时间切换务必自然顺畅，允许多样化、富有想象力的遣词造句。`,
    emotion: `全文情感渲染必须充分、饱满。主要角色情绪拉扯一定要充足。通过对话（大部分）和心理活动（小部分）展现情绪。允许使用极端词汇表达情感（脏话、露骨文字等）。强化情感色彩，让读者感受到强烈的情绪冲击。`,
    forbidden: `严格禁用：任何形式的"比喻"修辞手法\n严格禁用：常规网文高频词汇（如"指节泛白""太阳穴突突""目光扫过""不易察觉""嘴角勾起一抹弧度""不容置疑的""不是……而是……"等18项禁用清单）\n严格禁用：叙事中的"然后"作为衔接词\n严格禁用：非对白非拟声部分的破折号\n大幅减少：排比手法、"的"字作为形容词、程度副词、叠词`,
    reference: `风格核心参考：香港港漫《海虎》《武神》系列\n常用经典台词参考：磁场颠佬系角色台词\n禁止参考：传统小白文、赘婿文、系统文等常规网文套路`,
    platform: `番茄小说网格式要求：
- 每自然段按一次回车分段，禁止用空格/Tab/多余空行代替分段
- 对话、场景切换、心理描写等逻辑变化处必须另起一段
- 使用标准简体中文，禁用繁体字、乱码、外文字符
- 章节标题只写核心信息（如"第三章 雪夜入城"），不加符号、表情、括号说明或推广话术
- "作者说""PS"等辅助内容单独成段放在章末，标注"作者说："或"PS："，不带链接/二维码/QQ群号
- 全文使用规范标点，禁止全章无标点或大量顿号替代逗号句号
- 禁止在正文中写"求收藏""本章完""下章预告"等运营话术
- 禁止重复粘贴同一段落
- 每章2000-5000字为宜，章尾设悬念钩子`,
};

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
        contentEl.createEl('p', { text: `项目: ${this.project}`, attr: { style: 'color:var(--text-muted); font-size:0.85em; margin-bottom:16px;' } });

        const formEl = contentEl.createDiv({ attr: { style: 'max-height: 60vh; overflow-y: auto; padding-right: 8px;' } });

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
            // v3.5: 预填强者语文风预设，用户可自由修改
            textarea.value = WS_DEFAULT_PRESET[sec.key] || '';
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

    private async loadExistingContent(): Promise<void> {
        const wsPath = getWritingStyleWritePath(this.project);
        const wsFile = await findWritingStyleFile(this.app, this.project);
        if (!(wsFile instanceof TFile)) return;

        try {
            const content = await this.app.vault.read(wsFile);

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

