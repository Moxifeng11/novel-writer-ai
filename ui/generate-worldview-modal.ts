import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { ContextManager } from '../engine/context-manager';
import { mkdirp, showSuccess, showError, showProgress, hideProgress } from '../utils/helpers';
import { validateWorldviewOutput } from '../shared/template-validator';
import { pjWorldview, pjSettingLib, SUBDIR_WORLD_ARCH } from '../shared/paths';
import { createLogger } from '../shared/logger';


const log = createLogger('GenerateWorldviewModal');
export class GenerateWorldviewModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private contextManager: ContextManager;
    private timeoutTimer: number | null = null;

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
        contentEl.createEl('h2', { text: '🌍 生成世界观' });

        const projectSelect = contentEl.createEl('select', { cls: 'nw-select novel-writer-select' });

        const populateProjects = async () => {
            const projects = await this.contextManager.detectProjects();
            if (projects.length === 0) {
                contentEl.createEl('p', { text: '❌ 未找到项目，请先创建新项目' });
                return;
            }

            projects.forEach(project => {
                projectSelect.createEl('option', { value: project, text: project });
            });

            // 世界名称输入框
            contentEl.createEl('label', { text: '世界名称：', cls: 'novel-writer-label' });
            const worldNameInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: '输入世界名称',
                cls: 'nw-input novel-writer-input',
                value: projectSelect.value
            });

            // 当项目选择器改变时，自动更新世界名称
            projectSelect.onchange = () => {
                worldNameInput.value = projectSelect.value;
            };

            const genreTags = ['玄幻', '仙侠', '都市', '科幻', '悬疑', '历史', '言情', '奇幻', '武侠', '末世'];
            const tagContainer = contentEl.createEl('div', { cls: 'novel-writer-tag-container' });
            tagContainer.createEl('p', { text: '快捷标签（点击选择）：' });

            const genreInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: '输入题材（或点击上方标签）',
                cls: 'nw-input novel-writer-input'
            });

            genreTags.forEach(genre => {
                const tag = tagContainer.createEl('button', { text: genre, cls: 'novel-writer-tag-button' });
                tag.onclick = () => {
                    genreInput.value = genre;
                    genreInput.focus();
                };
            });

            const themeInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: '主题（可选）',
                cls: 'nw-input novel-writer-input'
            });

            // 自定义提示词文本框
            contentEl.createEl('label', { text: '自定义提示词（可选）：', cls: 'novel-writer-label' });
            const customPromptInput = contentEl.createEl('textarea', {
                placeholder: '在此输入额外的创作要求，如：\n- 主角性格特点\n- 特殊剧情要求\n- 风格偏好\n- 避免的元素...',
                cls: 'nw-textarea novel-writer-textarea',
                attr: { rows: '5' }
            });

            const generateButton = contentEl.createEl('button', { text: '生成世界观', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
            generateButton.onclick = async () => {
                const project = projectSelect.value;
                const worldName = worldNameInput.value.trim() || project;
                const genre = genreInput.value.trim();
                const theme = themeInput.value.trim();
                const customPrompt = customPromptInput.value.trim();

                if (!genre) {
                    new Notice('❌ 请输入或选择题材', 3000);
                    return;
                }

                await this.generateWorldview(project, worldName, genre, theme, customPrompt);
            };
        };

        populateProjects();
    }

    private async generateWorldview(project: string, worldName: string, genre: string, theme: string, customPrompt: string): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            new Notice('❌ 请先配置API密钥', 5000);
            return;
        }

        const genNotice = new Notice('⏳ Phase 1: 正在规划世界观骨架...', 0);

        let completed = false;
        this.timeoutTimer = window.setTimeout(() => {
            if (!completed) {
                new Notice('⏰ 世界观生成时间较长，请耐心等待...', 5000);
            }
        }, 30000);

        try {
            const result = await this.aiEngine.generateWorldview(
                worldName, project, genre, theme, customPrompt,
                (phase: string, current: number, total: number) => {
                    if (phase === 'skeleton') {
                        genNotice.setMessage('⏳ Phase 1: 正在规划世界观骨架...');
                    } else if (phase === 'module') {
                        genNotice.setMessage(`⏳ Phase 2: 正在生成第${current}/${total}模块...`);
                    }
                }
            );
            completed = true;

            if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
            genNotice.hide();

            if (result.error) {
                showError(`世界观生成失败: ${result.error}`);
                return;
            }

            await mkdirp(this.app, `${project}/${SUBDIR_WORLD_ARCH}`);

            // 固定文件名，确保 gatherWorldView() 始终能读取
            const worldviewPath = pjWorldview(project);

            // v1.3.3: 生成后验证输出质量
            const validation = validateWorldviewOutput(result.content);
            if (!validation.valid) {
                new Notice(`⚠️ 世界观生成不完整，缺失: ${validation.missingFields.slice(0,5).join(', ')}。可在文件中手动补充。`, 8000);
            }

            // 解析AI生成的项目名称，回退为项目文件夹名
            let generatedProjectName = project;
            const nameMatch = result.content.match(/【项目名称】(.+?)【\/项目名称】/);
            if (nameMatch) {
                generatedProjectName = nameMatch[1].trim()
                    .replace(/[\\/:*?"<>|]/g, '')  // v1.3.3: 清理非法文件名字符
                    .slice(0, 50);                    // v1.3.3: 限制最大长度
                // 从content中移除项目名称标签，保持正文干净
                result.content = result.content.replace(/【项目名称】.+?【\/项目名称】\n?/, '');
            }

            const worldviewContent = `---
tags: [世界观]
世界名称: ${worldName}
项目名称: ${generatedProjectName}
---

# ${worldName}总览

${result.content}`;

            try {
                const existingWorldview = this.app.vault.getAbstractFileByPath(worldviewPath);
                if (existingWorldview) {
                    await this.app.vault.delete(existingWorldview);
                }
                await this.app.vault.create(worldviewPath, worldviewContent);
                showSuccess('世界观已生成');
            } catch (e) {
                showError('世界观写入失败');
                return;
            }

            // 自动重命名项目文件夹为AI生成的小说名称
            if (generatedProjectName !== project) {
                try {
                    const projectFolder = this.app.vault.getAbstractFileByPath(project);
                    if (projectFolder) {
                        const newPath = generatedProjectName;
                        // 检查目标名称是否已被占用
                        if (!this.app.vault.getAbstractFileByPath(newPath)) {
                            // renameFile 会自动更新所有子文件路径和内部链接
                            await this.app.fileManager.renameFile(projectFolder, newPath);
                            showSuccess(`项目已重命名为「${generatedProjectName}」`);
                            // 更新后续使用的 project 变量
                            project = generatedProjectName;
                        } else {
                            new Notice(`⚠️ 文件夹「${generatedProjectName}」已存在，项目名保留为「${project}」`, 5000);
                        }
                    }
                } catch (renameErr) {
                    log.warn('项目文件夹重命名失败：', renameErr);
                    new Notice(`⚠️ 自动重命名失败，项目名保留为「${project}」`, 4000);
                }
            }

            const worldviewFile = this.app.vault.getAbstractFileByPath(worldviewPath);
            if (worldviewFile instanceof TFile) {
                await this.plugin.safeOpenFile(worldviewFile);
            }

            // v1.5.2: 世界观生成后自动填充设定库，避免空白设定库+详细世界观的冲突
            const slPath = pjSettingLib(project);
            const slFile = this.app.vault.getAbstractFileByPath(slPath);
            if (slFile instanceof TFile) {
                try {
                    const slContent = await this.app.vault.read(slFile);
                    const isSlEmpty = !slContent.replace(/<!--[\s\S]*?-->/g, '').replace(/\n/g, '').trim();
                    if (isSlEmpty) {
                        new Notice('⏳ 正在自动填充设定库...', 5000);
                        const slResult = await this.aiEngine.callAI(
                            `你是一位资深网络小说设定师。请根据世界观总览填充设定库，输出完整 Markdown，跳过所有HTML注释占位符，直接填充实际内容。`,
                            `=== 世界观总览 ===\n${worldviewContent.slice(0, 5000)}\n\n=== 设定库模板 ===\n${slContent}`,
                            this.plugin.settings.flashModel, 0.5, this.plugin.settings.maxOutput
                        );
                        if (slResult?.content) {
                            await this.app.vault.modify(slFile, slResult.content);
                            new Notice('✅ 设定库已自动填充');
                        }
                    }
                } catch (e) { log.warn('[小说工坊] 自动填充设定库失败:', e); }
            }

            this.close();
        } catch (error: any) {
            completed = true;
            if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
            genNotice.hide();
            showError(`世界观生成异常: ${error.message || '未知错误'}`);
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    }
}
