import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine, WorldElements } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { writeVolumeOutlines } from '../utils/helpers';
import { pjWorldview, pjForeshadowDB, SUBDIR_CHARS, SUBDIR_LOCS, SUBDIR_FACTIONS, SUBDIR_ITEMS, SUBDIR_WORLDVIEW_FILE } from '../shared/paths';
import { ChapterOutlineTreeModal } from './chapter-outline-tree-modal';
import { createLogger } from '../shared/logger';
import { OperationConfirmModal } from './components/progress';


const log = createLogger('PlanBookModal');

/** 单个实体 frontmatter 摘要注入大纲上下文时的长度上限，防止超长字段拖垮 prompt（不裁剪实体数量） */
const MAX_ENTITY_SUMMARY_LENGTH = 400;

export class PlanBookModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.contextManager = plugin.ctxManager;
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
        contentEl.createEl('h2', { text: '📋 AI全书规划' });

        this.injectStyles();

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });
        
        const populateProjects = async () => {
            let projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                projects = this.fallbackDetectProjects();
            }
            if (projects.length === 0) {
                const errorEl = contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                const retryBtn = contentEl.createEl('button', { text: '🔄 重试', cls: 'nw-btn', attr: { title: '重新加载项目列表' } });
                retryBtn.onclick = () => {
                    errorEl.remove();
                    retryBtn.remove();
                    populateProjects();
                };
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });

            // 基本参数区域
            const paramsSection = contentEl.createDiv({ cls: 'novel-writer-plan-section' });
            paramsSection.createEl('h4', { text: '📊 基本参数', cls: 'novel-writer-section-title' });

            const totalCharsRow = paramsSection.createDiv({ cls: 'novel-writer-input-row' });
            totalCharsRow.createEl('label', { text: '全书总字数：', cls: 'novel-writer-input-label' });
            const totalCharsInput = totalCharsRow.createEl('input', {
                type: 'text',
                placeholder: '如：100万',
                cls: 'nw-input novel-writer-input',
                value: '100万'
            });

            const volCountRow = paramsSection.createDiv({ cls: 'novel-writer-input-row' });
            volCountRow.createEl('label', { text: '分卷数：', cls: 'novel-writer-input-label' });
            const volCountInput = volCountRow.createEl('input', {
                type: 'text',
                placeholder: '如：3',
                cls: 'nw-input novel-writer-input',
                value: '3'
            });

            const chapWordsRow = paramsSection.createDiv({ cls: 'novel-writer-input-row' });
            chapWordsRow.createEl('label', { text: '每章字数：', cls: 'novel-writer-input-label' });
            const chapWordsInput = chapWordsRow.createEl('input', {
                type: 'text',
                placeholder: '如：2500',
                cls: 'nw-input novel-writer-input',
                value: '2500'
            });

            // 上下文预览区域
            const contextSection = contentEl.createDiv({ cls: 'novel-writer-plan-section' });
            contextSection.createEl('h4', { text: '📖 将发送给AI的上下文', cls: 'novel-writer-section-title' });
            const contextPreview = contextSection.createDiv({ cls: 'novel-writer-context-preview' });
            contextPreview.createEl('p', { text: '⏳ 正在加载上下文...', cls: 'novel-writer-muted' });

            // 自定义提示词区域
            const promptSection = contentEl.createDiv({ cls: 'novel-writer-plan-section' });
            promptSection.createEl('h4', { text: '✍️ 自定义提示词（可选）', cls: 'novel-writer-section-title' });
            const customPromptInput = promptSection.createEl('textarea', {
                cls: 'nw-textarea novel-writer-textarea',
                attr: { rows: '5', placeholder: '在此输入额外的创作要求，如：\n- 主角性格特点\n- 特殊剧情要求\n- 风格偏好\n- 避免的元素...' }
            });

            // 预设提示词（点击即插入）
            const presetSection = promptSection.createDiv({ cls: 'novel-writer-preset-section' });
            presetSection.createEl('span', { text: '💡 预设质量提示词（点击插入）：', cls: 'novel-writer-muted', attr: { style: 'font-size:12px; margin-right:8px;' } });

            const presets = [
                { label: '结构优化', prompt: '每卷必须有明确的三幕结构：铺垫（30%）→ 冲突升级（50%）→ 高潮与收尾（20%）。每卷结尾设置钩子，驱动读者翻页。' },
                { label: '节奏控制', prompt: '章节节奏遵循张弛交替：动作章→喘息章→悬念章循环。每3章一个小高潮，每卷末一个反转。避免连续3章以上同一情绪基调。' },
                { label: '人物弧线', prompt: '主角每卷至少完成一个阶段性成长。配角不能沦为工具人，每个配角必须有独立动机和至少1个高光时刻。反派智商在线，行动有逻辑。' },
                { label: '冲突层级', prompt: '每卷冲突层层递进：个人冲突→团队冲突→势力冲突→世界观冲突。不要一卷内把所有冲突全部引爆，保留层层揭秘的空间。' },
                { label: '伏笔密度', prompt: '每卷埋设3-5个伏笔，其中至少2个在本卷内回收。重要伏笔跨卷布局。伏笔必须与主线和人物弧线产生因果关联，不能是无意义的谜语。' },
                { label: '爽点分布', prompt: '每章至少1个爽点（打脸/突破/获得/反转）。重要爽点间隔不超过2章。爽点类型交替：实力突破→打脸反派→获得宝物→身份揭晓→收服同伴。' },
                { label: '章末钩子', prompt: '每章结尾必须设置钩子：悬念式（他推开门，看到的是...）、反转式（脑海中响起的声音，竟是自己的）、危机式（一道剑光已到眼前）。禁止平淡收尾。' },
                { label: '信息控制', prompt: '世界观信息采用"冰山式"逐步释放。每章新设定不超过2个。揭露大设定前必须铺垫至少3章。禁止信息倾泻式的大段设定解说。' },
            ];

            const presetContainer = promptSection.createDiv({ attr: { style: 'display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;' } });
            for (const p of presets) {
                const chip = presetContainer.createEl('button', {
                    text: p.label,
                    attr: { title: p.prompt, style: 'padding:3px 10px; font-size:11px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:12px; cursor:pointer; color:var(--text-muted);' }
                });
                chip.addEventListener('click', () => {
                    const current = customPromptInput.value.trim();
                    const sep = current ? '\n' : '';
                    customPromptInput.value = current + sep + p.prompt;
                    customPromptInput.focus();
                });
                chip.addEventListener('mouseenter', () => {
                    chip.style.background = 'var(--text-accent)';
                    chip.style.color = 'white';
                    chip.style.borderColor = 'var(--text-accent)';
                });
                chip.addEventListener('mouseleave', () => {
                    chip.style.background = 'var(--background-secondary)';
                    chip.style.color = 'var(--text-muted)';
                    chip.style.borderColor = 'var(--background-modifier-border)';
                });
            }

            // 异步加载上下文预览
            const selectedProject = projectSelect.value;
            this.loadContextPreview(selectedProject, contextPreview);

            projectSelect.onchange = () => {
                this.loadContextPreview(projectSelect.value, contextPreview);
            };

            const planButton = contentEl.createEl('button', { text: '🚀 生成全书规划', cls: 'nw-btn nw-btn-primary novel-writer-primary-button', attr: { title: '生成全书规划（分卷大纲 + 章节分配）' } });
            planButton.onclick = async () => {
                const project = projectSelect.value;
                const totalChars = totalCharsInput.value;
                const volCount = parseInt(volCountInput.value) || 3;
                const chapWords = parseInt(chapWordsInput.value) || 2500;
                const customPrompt = customPromptInput.value.trim();

                await this.generatePlan(project, totalChars, volCount, chapWords, customPrompt);
            };
        };

        populateProjects();
    }

    private async generatePlan(project: string, totalChars: string, volumes: number, wordsPerChapter: number, customPrompt?: string): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            new Notice('❌ 请先配置API密钥', 5000);
            return;
        }

        let worldView = '';
        try {
            const wf = this.app.vault.getAbstractFileByPath(pjWorldview(project));
            if (wf instanceof TFile) worldView = await this.app.vault.read(wf);
        } catch (e) { log.warn('[小说工坊] 操作失败:', e); }

        let genreInfo: { genre: string; theme: string } | null = null;

        if (!worldView) {
            const confirmGenerate = await OperationConfirmModal.confirm(this.app, {
                title: '生成世界观',
                description: '未找到世界观总览，是否先生成世界观？',
                confirmText: '确认生成',
                cancelText: '取消',
            });
            if (confirmGenerate) {
                genreInfo = await this.promptForGenre();
                if (!genreInfo) return;

                const genNotice = new Notice('⏳ 正在生成世界观...', 0);
                // generateWorldview 需要5个参数：世界名称、项目名称、题材、主题、自定义提示词
                const worldviewResult = await this.aiEngine.generateWorldview(project, project, genreInfo?.genre || '', genreInfo?.theme || '', customPrompt || '');
                genNotice.hide();

                if (worldviewResult.error) {
                    new Notice(`❌ 世界观生成失败: ${worldviewResult.error}`, 8000);
                    return;
                }

                const worldviewPath = pjWorldview(project);
                const worldviewContent = `---
tags: [世界观]
---

# 世界观总览

${worldviewResult.content}`;

                try {
                    const existingWorldview = this.app.vault.getAbstractFileByPath(worldviewPath);
                    if (existingWorldview) {
                        await this.app.vault.delete(existingWorldview);
                    }
                    await this.app.vault.create(worldviewPath, worldviewContent);
                    worldView = worldviewResult.content;
                    new Notice('✅ 世界观已生成', 3000);
                } catch (e) {
                    new Notice('❌ 世界观写入失败', 5000);
                    return;
                }
            } else {
                return;
            }
        }

        const genNotice = new Notice(`⏳ Phase 1: 正在规划全局结构...`, 0);

        // 收集项目已有元素传入AI，让大纲规划基于已有世界观
        const existingWorldElements: WorldElements = {
            characters: await this.readContextFile(project, SUBDIR_CHARS),
            locations: await this.readContextFile(project, SUBDIR_LOCS),
            factions: await this.readContextFile(project, SUBDIR_FACTIONS),
            items: await this.readContextFile(project, SUBDIR_ITEMS),
            foreshadows: await this.readContextFile(project, pjForeshadowDB(project)),
            timelineEvents: await this.readContextFile(project, '02-时间线与伏笔/时间线看板'),
        };

        try {
            const result = await this.aiEngine.generateOutline(worldView, {
                totalWords: String(this.parseTotalWords(totalChars)),
                volumes: volumes,
                wordsPerChapter: wordsPerChapter,
                theme: genreInfo?.theme || '',
                genre: genreInfo?.genre || ''
            }, existingWorldElements, customPrompt, (phase: string, current: number, total: number) => {
                if (phase === 'skeleton' || phase === 'blueprint') {
                    genNotice.setMessage(`⏳ Phase 1: 正在规划全局结构...`);
                } else if (phase === 'volume') {
                    genNotice.setMessage(`⏳ Phase 2: 正在生成第${current}/${total}卷大纲...`);
                } else if (phase === 'validation') {
                    genNotice.setMessage(`⏳ Phase 3: 正在验证跨卷连贯性...`);
                } else if (phase === 'repair') {
                    genNotice.setMessage(`⏳ Phase 4: 正在修复第${current}/${total}轮...`);
                }
            });

            genNotice.hide();

            if (result.error) {
                new Notice(`❌ 全书规划生成失败: ${result.error}`, 12000);
                return;
            }

            // v4.0：按卷拆分写入 分卷大纲/第N卷_分卷大纲.md（全书总览归入第1卷头部）
            const volCount = await writeVolumeOutlines(this.app, project, result.content || '');

            // 检查是否有验证警告或降级生成（本次生成未完全达标，但内容已保留）
            const content = result.content || '';
            const hasWarnings = content.includes('验证警告') || content.includes('降级生成提示');
            if (hasWarnings) {
                new Notice(`⚠️ 大纲已生成（共 ${volCount} 卷），但存在待完善/降级内容，请检查大纲`, 8000);
            } else {
                new Notice(`✅ 全书规划已生成（共 ${volCount} 卷分卷大纲）`, 3000);
            }

            // v4.2: 统一使用 ChapterOutlineTreeModal 展示完整的章节冲突预览
            // 替换旧版 renderOutlineTree（只能解析 #### 第X章 格式，不兼容 v4.0 表格格式）
            this.close();
            new ChapterOutlineTreeModal(this.app, this.plugin, project).open();
        } catch (error: any) {
            genNotice.hide();
            const errorMsg = error.message || '生成失败';
            new Notice(`❌ 全书规划生成失败: ${errorMsg}`, 12000);
            log.error('[小说工坊] 大纲生成异常:', error);
        }
    }

    private async loadContextPreview(project: string, container: HTMLElement): Promise<void> {
        container.empty();

        const files: { name: string; path: string; status: string }[] = [
            { name: '世界观总览', path: `${project}/${SUBDIR_WORLDVIEW_FILE}`, status: '未找到' },
            { name: '人物档案', path: `${project}/${SUBDIR_CHARS}`, status: '未找到' },
            { name: '势力档案', path: `${project}/${SUBDIR_FACTIONS}`, status: '未找到' },
            { name: '地点档案', path: `${project}/${SUBDIR_LOCS}`, status: '未找到' },
            { name: '物品功法', path: `${project}/${SUBDIR_ITEMS}`, status: '未找到' },
        ];

        for (const file of files) {
            const abstractFile = this.app.vault.getAbstractFileByPath(file.path);
            if (abstractFile) {
                if (abstractFile instanceof TFile) {
                    file.status = '✅ 已找到';
                } else {
                    // 是文件夹
                    const filesInFolder = this.app.vault.getFiles().filter(f => f.path.startsWith(file.path));
                    file.status = `✅ ${filesInFolder.length} 个文件`;
                }
            }
        }

        const list = container.createEl('ul', { cls: 'novel-writer-context-list' });
        for (const file of files) {
            const li = list.createEl('li');
            li.createSpan({ text: file.name, cls: 'novel-writer-context-name' });
            li.createSpan({ text: ' — ', cls: 'novel-writer-context-sep' });
            const statusSpan = li.createSpan({ text: file.status, cls: 'novel-writer-context-status' });
            if (file.status.includes('✅')) {
                statusSpan.addClass('novel-writer-status-ok');
            } else {
                statusSpan.addClass('novel-writer-status-missing');
            }
        }

        // 提示信息
        const tip = container.createEl('p', { cls: 'novel-writer-context-tip' });
        tip.createEl('strong', { text: '提示：' });
        tip.createSpan({ text: 'AI将基于世界观总览生成全书规划。如果缺少世界观，会提示您先生成。' });
    }

    private async promptForGenre(): Promise<{ genre: string; theme: string } | null> {
        return new Promise((resolve) => {
            const modal = new (class extends Modal {
                constructor(app: App) {
                    super(app);
                }

                onOpen(): void {
    this.modalEl.addClass('nw-scope');
                    const { contentEl } = this;
                    contentEl.empty();
                    contentEl.createEl('h3', { text: '请选择题材与主题' });

                    contentEl.createEl('p', { text: '题材：', cls: 'novel-writer-muted' });
                    const genres = ['玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情', '奇幻', '武侠', '末世'];
                    const customInput = contentEl.createEl('input', {
                        type: 'text',
                        placeholder: '或输入自定义题材',
                        cls: 'nw-input novel-writer-input'
                    });

                    const tagContainer = contentEl.createDiv();
                    genres.forEach(genre => {
                        const tag = tagContainer.createEl('button', { text: genre, cls: 'novel-writer-tag' });
                        tag.onclick = () => {
                            customInput.value = genre;
                        };
                    });

                    contentEl.createEl('p', { text: '主题：', cls: 'novel-writer-muted' });
                    const themeInput = contentEl.createEl('input', {
                        type: 'text',
                        placeholder: '如：强者归来、逆天改命、扮猪吃虎',
                        cls: 'nw-input novel-writer-input'
                    });

                    const confirmBtn = contentEl.createEl('button', { text: '确认', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
                    confirmBtn.onclick = () => {
                        const genreValue = customInput.value.trim();
                        const themeValue = themeInput.value.trim();
                        this.close();
                        resolve(genreValue ? { genre: genreValue, theme: themeValue } : null);
                    };

                    const handleEnter = (e: KeyboardEvent) => {
                        if (e.key === 'Enter') {
                            const genreValue = customInput.value.trim();
                            const themeValue = themeInput.value.trim();
                            this.close();
                            resolve(genreValue ? { genre: genreValue, theme: themeValue } : null);
                        }
                    };
                    customInput.addEventListener('keydown', handleEnter);
                    themeInput.addEventListener('keydown', handleEnter);
                }

                onClose(): void {
                    const { contentEl } = this;
                    contentEl.empty();
                }
            })(this.app);

            modal.open();
        });
    }

    /**
     * 读取指定目录下所有 .md 文件的 frontmatter 摘要，拼接为上下文文本
     * 排除文件名含"模板"的文件
     */
    private async readContextFile(project: string, subPath: string): Promise<string> {
        const folderPath = `${project}/${subPath}`;
        const isCharacter = subPath.includes('人物');
        const truncate = (s: string): string => s.length > MAX_ENTITY_SUMMARY_LENGTH ? s.slice(0, MAX_ENTITY_SUMMARY_LENGTH) + '…' : s;

        interface CharacterEntry { prefix: string; fields: string[]; }
        const characters: CharacterEntry[] = [];
        const otherLines: string[] = [];

        for (const file of this.app.vault.getFiles()) {
            if (file.path.startsWith(folderPath) &&
                file.name.endsWith('.md') &&
                !file.name.includes('模板')) {
                try {
                    const content = await this.app.vault.read(file);
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (!fmMatch) continue;

                    const fmLines = fmMatch[1].split('\n');
                    const fields: string[] = [];
                    let identity = '';
                    for (const line of fmLines) {
                        const m = line.match(/^([^:]+):\s*(.+)$/);
                        if (m) {
                            const key = m[1].trim();
                            let value = m[2].trim();
                            if (value.startsWith('"') && value.endsWith('"')) {
                                value = value.slice(1, -1);
                            }
                            if (key === '身份') {
                                identity = value;
                            }
                            if (key !== 'tags') {
                                fields.push(`${key}：${value}`);
                            }
                        }
                    }
                    if (fields.length > 0) {
                        if (isCharacter) {
                            let prefix = '【配角】';
                            if (identity.includes('主角')) {
                                prefix = '【主角】';
                            } else if (/反|敌|魔|黑/.test(identity)) {
                                prefix = '【反派】';
                            }
                            characters.push({ prefix, fields });
                        } else {
                            otherLines.push(`- ${truncate(fields.join(' | '))}`);
                        }
                    }
                } catch (e) {
                    log.warn('Failed to read context file:', file.path, e);
                }
            }
        }

        if (isCharacter) {
            // 排序：【主角】最前，【反派】中间，【配角】最后
            const order: Record<string, number> = { '【主角】': 0, '【反派】': 1, '【配角】': 2 };
            characters.sort((a, b) => order[a.prefix] - order[b.prefix]);
            for (const c of characters) {
                otherLines.push(`${c.prefix} - ${truncate(c.fields.join(' | '))}`);
            }
        }

        return otherLines.join('\n');
    }

    private parseTotalWords(raw: string): number {
        const cleaned = raw.replace(/[,，\s]/g, '');
        if (cleaned.includes('万')) {
            const n = parseFloat(cleaned);
            return isNaN(n) ? 1000000 : Math.round(n * 10000);
        }
        if (cleaned.includes('亿')) {
            const n = parseFloat(cleaned);
            return isNaN(n) ? 10000000 : Math.round(n * 100000000);
        }
        const n = parseInt(cleaned);
        return isNaN(n) || n === 0 ? 1000000 : n;
    }

    private injectStyles(): void {
        const styleId = 'novel-writer-plan-book-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
.novel-writer-plan-section {
    margin: 16px 0;
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 8px;
}

.novel-writer-section-title {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}

.novel-writer-input-row {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
    gap: 10px;
}

.novel-writer-input-label {
    min-width: 100px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
}

.novel-writer-input {
    flex: 1;
    padding: 8px 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-primary);
}

.novel-writer-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
}

.novel-writer-textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-primary);
    font-family: var(--font-text);
    resize: vertical;
    box-sizing: border-box;
}

.novel-writer-textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
}

.novel-writer-context-preview {
    padding: 10px;
    background: var(--background-primary);
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
}

.novel-writer-context-list {
    list-style: none;
    padding: 0;
    margin: 0;
}

.novel-writer-context-list li {
    padding: 6px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--background-modifier-border-hover);
}

.novel-writer-context-list li:last-child {
    border-bottom: none;
}

.novel-writer-context-name {
    font-weight: 500;
    color: var(--text-primary);
}

.novel-writer-context-sep {
    color: var(--text-muted);
}

.novel-writer-context-status {
    font-size: 12px;
}

.novel-writer-status-ok {
    color: var(--text-success);
}

.novel-writer-status-missing {
    color: var(--text-muted);
}

.novel-writer-context-tip {
    margin: 10px 0 0 0;
    padding: 8px;
    background: var(--background-secondary-alt);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-muted);
}

.novel-writer-muted {
    color: var(--text-muted);
    font-size: 13px;
}

.novel-writer-preset-section {
    margin-top: 8px;
}
`;
        document.head.appendChild(style);
    }

    private fallbackDetectProjects(): string[] {
        const projectDirs = new Set<string>();
        for (const file of this.app.vault.getFiles()) {
            const parts = file.path.split('/');
            if (parts.length < 2) continue;
            const rootDir = parts[0];
            if (rootDir.startsWith('.') || rootDir === '元文件') continue;
            if (parts.length === 2 && parts[1] === '.project') {
                projectDirs.add(rootDir);
            }
            if (parts[1] === '01-世界架构') {
                projectDirs.add(rootDir);
            }
        }
        return Array.from(projectDirs).sort();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
