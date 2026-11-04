/**
 * template-manager.ts — 模板管理 UI 组件
 *
 * 职责：在设置界面中管理 AI prompt 模板
 * - 显示所有可自定义的模板类型
 * - 支持查看/编辑/导出/导入/重置模板
 */

import { App, Modal, Notice, TFile, Menu } from 'obsidian';
import { PJ_PROMPT_TEMPLATE_DIR } from '@/shared/paths';
import { getStepTemplate } from '@/engine/prompt-templates';
import { createLogger } from '@/shared/logger';
import { exportTextFile } from '@/shared/export-file';
import { OperationConfirmModal } from './components/progress';


const log = createLogger('TemplateManager');
export type { TemplateCategory } from '@/shared/prompt-template-catalog';
export { ALL_TEMPLATE_DEFS } from '@/shared/prompt-template-catalog';
import { ALL_TEMPLATE_DEFS, type TemplateCategory, type TemplateCatalogEntry } from '@/shared/prompt-template-catalog';

/**
 * 获取模板分类的中文名（UI 筛选器复用）。
 *
 * @param category - 模板分类
 * @returns 中文名
 */
export function templateCategoryLabel(category: TemplateCategory): string {
    const labels: Record<TemplateCategory, string> = {
        step: '步骤模板',
        worldview: '世界观模板',
        entity: '实体模板',
        deai: 'DEAI模板',
    };
    return labels[category];
}

/** 模板信息 */
export interface TemplateInfo extends TemplateCatalogEntry {
    hasSystem: boolean;
    hasUser: boolean;
}


/**
 * 获取模板的默认内容
 *
 * @param key - 键
 * @param type - 类型
 * @returns 文本结果
 */
export function getDefaultTemplateContent(key: string, type: 'system' | 'user'): string {
    const template = getStepTemplate(key);
    if (template) {
        return type === 'system' ? template.systemPrompt : template.userPrompt;
    }
    return '';
}

/** 模板管理器类 */
export class TemplateManager {
    private app: App;
    private filter: TemplateCategory | 'all' = 'all';

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 设置筛选器
     *
     * @param filter - 过滤条件
     */
    setFilter(filter: TemplateCategory | 'all'): void {
        this.filter = filter;
    }

    /**
     * 获取所有模板信息
     *
     * @returns 结果数组
     */
    async getAllTemplates(): Promise<TemplateInfo[]> {
        const templates: TemplateInfo[] = [];

        for (const def of ALL_TEMPLATE_DEFS) {
            if (this.filter !== 'all' && def.category !== this.filter) {
                continue;
            }

            const systemFile = this.app.vault.getAbstractFileByPath(def.systemPath);
            const userFile = this.app.vault.getAbstractFileByPath(def.userPath);

            templates.push({
                ...def,
                hasSystem: systemFile instanceof TFile,
                hasUser: userFile instanceof TFile,
            });
        }

        return templates;
    }

    /**
     * 渲染模板列表到容器
     *
     * @param container - 容器元素
     */
    async renderTemplateList(container: HTMLElement): Promise<void> {
        container.empty();

        // 标题
        container.createEl('h3', { text: '📝 AI Prompt 模板管理' });
        container.createEl('p', {
            text: '管理 AI 生成各步骤使用的提示词模板。自定义模板优先于内置默认模板。',
            cls: 'setting-item-description'
        });

        // 筛选按钮
        const filterRow = container.createDiv({ attr: { style: 'display:flex;gap:6px;margin:12px 0;flex-wrap:wrap;' } });
        const categories: Array<{ key: TemplateCategory | 'all'; label: string }> = [
            { key: 'all', label: '全部' },
            { key: 'step', label: '步骤模板' },
            { key: 'worldview', label: '世界观模板' },
            { key: 'entity', label: '实体模板' },
            { key: 'deai', label: 'DEAI模板' },
        ];

        for (const cat of categories) {
            const btn = filterRow.createEl('button', {
                text: cat.label,
                attr: { type: 'button' }
            });
            btn.style.cssText = `padding:4px 12px;cursor:pointer;border:1px solid ${this.filter === cat.key ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};background:${this.filter === cat.key ? 'var(--interactive-accent)' : 'transparent'};color:${this.filter === cat.key ? 'var(--text-on-accent)' : 'var(--text-normal)'};border-radius:4px;font-size:12px;`;
            btn.onclick = () => {
                this.filter = cat.key;
                this.renderTemplateList(container);
            };
        }

        // 批量操作按钮
        const actionRow = container.createDiv({ attr: { style: 'display:flex;gap:8px;margin:12px 0;' } });
        const exportAllBtn = actionRow.createEl('button', { text: '📤 导出全部', attr: { type: 'button', title: '导出全部模板为文件' } });
        exportAllBtn.style.cssText = 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-normal);border-radius:4px;font-size:12px;';
        exportAllBtn.onclick = () => this.exportAllTemplates();

        const importBtn = actionRow.createEl('button', { text: '📥 导入', attr: { type: 'button', title: '从文件导入模板' } });
        importBtn.style.cssText = 'padding:6px 14px;cursor:pointer;border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-normal);border-radius:4px;font-size:12px;';
        importBtn.onclick = () => this.showImportModal(container);

        const resetAllBtn = actionRow.createEl('button', { text: '🔄 重置全部', attr: { type: 'button', title: '重置全部模板为默认' } });
        resetAllBtn.style.cssText = 'padding:6px 14px;cursor:pointer;border:1px solid var(--text-error);background:transparent;color:var(--text-error);border-radius:4px;font-size:12px;';
        resetAllBtn.onclick = () => this.resetAllTemplates(container);

        // 模板列表
        const templates = await this.getAllTemplates();

        if (templates.length === 0) {
            container.createEl('p', { text: '没有符合条件的模板', attr: { style: 'color:var(--text-muted);font-size:13px;padding:20px 0;text-align:center;' } });
            return;
        }

        // 按分类分组显示
        const grouped = templates.reduce((acc, t) => {
            if (!acc[t.categoryName]) acc[t.categoryName] = [];
            acc[t.categoryName].push(t);
            return acc;
        }, {} as Record<string, TemplateInfo[]>);

        for (const [categoryName, items] of Object.entries(grouped)) {
            const section = container.createEl('div', { attr: { style: 'margin:16px 0;' } });
            section.createEl('h4', { text: categoryName, attr: { style: 'margin-bottom:8px;color:var(--text-muted);font-size:12px;text-transform:uppercase;' } });

            for (const template of items) {
                this.renderTemplateItem(section, template);
            }
        }
    }

    /** 渲染单个模板项 */
    private renderTemplateItem(container: HTMLElement, template: TemplateInfo): void {
        const item = container.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;margin:4px 0;background:var(--background-modifier-hover);border-radius:6px;' } });

        // 左侧：名称和状态
        const left = item.createDiv({ attr: { style: 'display:flex;align-items:center;gap:10px;flex-shrink:1;min-width:0;' } });
        left.createEl('span', { text: template.name, attr: { style: 'font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' } });

        // 状态标签
        const statusDiv = left.createDiv({ attr: { style: 'display:flex;gap:4px;' } });
        if (template.hasSystem) {
            const tag = statusDiv.createEl('span', { text: 'System ✓', attr: { style: 'padding:2px 6px;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:3px;font-size:10px;' } });
        } else {
            const tag = statusDiv.createEl('span', { text: 'System', attr: { style: 'padding:2px 6px;background:var(--background-modifier-border);color:var(--text-muted);border-radius:3px;font-size:10px;' } });
        }
        if (template.hasUser) {
            const tag = statusDiv.createEl('span', { text: 'User ✓', attr: { style: 'padding:2px 6px;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:3px;font-size:10px;' } });
        } else {
            const tag = statusDiv.createEl('span', { text: 'User', attr: { style: 'padding:2px 6px;background:var(--background-modifier-border);color:var(--text-muted);border-radius:3px;font-size:10px;' } });
        }

        // 右侧：操作按钮
        const right = item.createDiv({ attr: { style: 'display:flex;gap:6px;flex-shrink:0;' } });
        const editBtn = right.createEl('button', { text: '✏️', attr: { type: 'button', title: '编辑' } });
        editBtn.style.cssText = 'padding:4px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);background:transparent;border-radius:4px;font-size:12px;';
        editBtn.onclick = () => this.showEditModal(template);

        const exportBtn = right.createEl('button', { text: '📤', attr: { type: 'button', title: '导出' } });
        exportBtn.style.cssText = 'padding:4px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);background:transparent;border-radius:4px;font-size:12px;';
        exportBtn.onclick = () => this.exportTemplate(template);

        if (template.hasSystem || template.hasUser) {
            const resetBtn = right.createEl('button', { text: '🔄', attr: { type: 'button', title: '重置' } });
            resetBtn.style.cssText = 'padding:4px 8px;cursor:pointer;border:1px solid var(--text-error);background:transparent;color:var(--text-error);border-radius:4px;font-size:12px;';
            resetBtn.onclick = () => this.resetTemplate(template);
        }
    }

    /**
     * 显示编辑弹窗
     *
     * @param template - 模板
     */
    showEditModal(template: TemplateInfo): void {
        new TemplateEditModal(this.app, template).open();
    }

    /**
     * 导出单个模板
     *
     * @param template - 模板
     */
    async exportTemplate(template: TemplateInfo): Promise<void> {
        try {
            const content: string[] = [`# ${template.name} 模板\n`, `Key: ${template.key}\n`, `分类: ${template.categoryName}\n`];

            if (template.hasSystem) {
                const file = this.app.vault.getAbstractFileByPath(template.systemPath);
                if (file instanceof TFile) {
                    const content_str = await this.app.vault.read(file);
                    content.push('\n## System Prompt\n', content_str);
                }
            }

            if (template.hasUser) {
                const file = this.app.vault.getAbstractFileByPath(template.userPath);
                if (file instanceof TFile) {
                    const content_str = await this.app.vault.read(file);
                    content.push('\n## User Prompt\n', content_str);
                }
            }

            await exportTextFile(this.app, `${template.key}-template.md`, content.join(''), {
                mime: 'text/markdown',
                successMessage: `✅ 已导出 ${template.name} 模板`,
            });
        } catch (e) {
            log.error('[TemplateManager] 导出模板失败:', e);
            new Notice(`❌ 导出失败: ${(e as Error).message}`);
        }
    }

    /** 导出全部模板 */
    async exportAllTemplates(): Promise<void> {
        try {
            const templates = await this.getAllTemplates();
            const content: string[] = [`# AI Prompt 模板导出\n`, `导出时间: ${new Date().toLocaleString()}\n`, `共 ${templates.filter(t => t.hasSystem || t.hasUser).length} 个自定义模板\n`];

            for (const template of templates) {
                if (template.hasSystem || template.hasUser) {
                    content.push(`\n---\n\n## ${template.name} (${template.key})\n`);
                    content.push(`分类: ${template.categoryName}\n`);
                    content.push(`自定义状态: System=${template.hasSystem ? '✓' : '✗'} User=${template.hasUser ? '✓' : '✗'}\n`);

                    if (template.hasSystem) {
                        const file = this.app.vault.getAbstractFileByPath(template.systemPath);
                        if (file instanceof TFile) {
                            content.push('\n### System Prompt\n');
                            content.push(await this.app.vault.read(file));
                        }
                    }

                    if (template.hasUser) {
                        const file = this.app.vault.getAbstractFileByPath(template.userPath);
                        if (file instanceof TFile) {
                            content.push('\n### User Prompt\n');
                            content.push(await this.app.vault.read(file));
                        }
                    }
                }
            }

            await exportTextFile(this.app, `novel-writer-templates-${Date.now()}.md`, content.join(''), {
                mime: 'text/markdown',
                successMessage: `✅ 已导出 ${templates.filter(t => t.hasSystem || t.hasUser).length} 个模板`,
            });
        } catch (e) {
            log.error('[TemplateManager] 导出全部模板失败:', e);
            new Notice(`❌ 导出失败: ${(e as Error).message}`);
        }
    }

    /**
     * 显示导入弹窗
     *
     * @param container - 容器元素
     */
    showImportModal(container: HTMLElement): void {
        new TemplateImportModal(this.app, () => {
            // 导入成功后刷新列表
            this.renderTemplateList(container);
        }).open();
    }

    /**
     * 重置单个模板
     *
     * @param template - 模板
     */
    async resetTemplate(template: TemplateInfo): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '删除自定义模板',
            description: `确定要删除 ${template.name} 的自定义模板吗？\n这将从元文件中删除自定义模板文件。`,
            confirmText: '确认删除',
            cancelText: '取消',
        });
        if (!confirmed) return;

        try {
            let count = 0;
            if (template.hasSystem) {
                const file = this.app.vault.getAbstractFileByPath(template.systemPath);
                if (file instanceof TFile) {
                    await this.app.vault.delete(file);
                    count++;
                }
            }
            if (template.hasUser) {
                const file = this.app.vault.getAbstractFileByPath(template.userPath);
                if (file instanceof TFile) {
                    await this.app.vault.delete(file);
                    count++;
                }
            }

            new Notice(`✅ 已删除 ${template.name} 的 ${count} 个自定义模板`);
        } catch (e) {
            log.error('[TemplateManager] 重置模板失败:', e);
            new Notice(`❌ 重置失败: ${(e as Error).message}`);
        }
    }

    /**
     * 重置全部模板
     *
     * @param container - 容器元素
     */
    async resetAllTemplates(container: HTMLElement): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '删除所有自定义模板',
            description: '确定要删除所有自定义模板吗？\n这将从元文件中删除所有自定义模板文件。',
            warning: '此操作不可撤销',
            confirmText: '确认删除',
            cancelText: '取消',
        });
        if (!confirmed) return;

        try {
            const templates = await this.getAllTemplates();
            let count = 0;

            for (const template of templates) {
                if (template.hasSystem) {
                    const file = this.app.vault.getAbstractFileByPath(template.systemPath);
                    if (file instanceof TFile) {
                        await this.app.vault.delete(file);
                        count++;
                    }
                }
                if (template.hasUser) {
                    const file = this.app.vault.getAbstractFileByPath(template.userPath);
                    if (file instanceof TFile) {
                        await this.app.vault.delete(file);
                        count++;
                    }
                }
            }

            new Notice(`✅ 已删除 ${count} 个自定义模板`);
            this.renderTemplateList(container);
        } catch (e) {
            log.error('[TemplateManager] 重置全部模板失败:', e);
            new Notice(`❌ 重置失败: ${(e as Error).message}`);
        }
    }
}

/** 模板编辑弹窗 */
class TemplateEditModal extends Modal {
    private template: TemplateInfo;
    private refreshCallback?: () => void;

    constructor(app: App, template: TemplateInfo, refreshCallback?: () => void) {
        super(app);
        this.template = template;
        this.refreshCallback = refreshCallback;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        this.loadAndShowContent();
    }

    private async loadAndShowContent(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: `✏️ 编辑模板: ${this.template.name}` });

        const form = contentEl.createDiv({ attr: { style: 'margin-top:16px;' } });

        // 读取现有内容
        let systemContent = getDefaultTemplateContent(this.template.key, 'system');
        let userContent = getDefaultTemplateContent(this.template.key, 'user');

        if (this.template.hasSystem) {
            const file = this.app.vault.getAbstractFileByPath(this.template.systemPath);
            if (file instanceof TFile) {
                systemContent = await this.app.vault.read(file);
            }
        }

        if (this.template.hasUser) {
            const file = this.app.vault.getAbstractFileByPath(this.template.userPath);
            if (file instanceof TFile) {
                userContent = await this.app.vault.read(file);
            }
        }

        // System Prompt
        form.createEl('label', { text: 'System Prompt（AI 角色设定）', attr: { style: 'display:block;font-weight:500;margin:12px 0 4px;' } });
        const systemTA = form.createEl('textarea', {
            attr: { style: 'width:100%;height:200px;padding:8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;font-family:monospace;resize:vertical;background:var(--background-primary);color:var(--text-normal);' }
        }) as HTMLTextAreaElement;
        systemTA.value = systemContent;

        // User Prompt
        form.createEl('label', { text: 'User Prompt（输入内容模板）', attr: { style: 'display:block;font-weight:500;margin:12px 0 4px;' } });
        const userTA = form.createEl('textarea', {
            attr: { style: 'width:100%;height:150px;padding:8px;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:12px;font-family:monospace;resize:vertical;background:var(--background-primary);color:var(--text-normal);' }
        }) as HTMLTextAreaElement;
        userTA.value = userContent;

        // 说明
        form.createEl('p', {
            text: `模板文件将保存到:\n• System: ${this.template.systemPath}\n• User: ${this.template.userPath}`,
            attr: { style: 'font-size:11px;color:var(--text-muted);margin:8px 0;white-space:pre-wrap;' }
        });

        // 按钮
        const btnRow = contentEl.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;' } });

        const cancelBtn = btnRow.createEl('button', { text: '取消' });
        cancelBtn.style.cssText = 'padding:8px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);background:transparent;border-radius:4px;';
        cancelBtn.onclick = () => this.close();

        const deleteBtn = btnRow.createEl('button', { text: '🗑 删除' });
        deleteBtn.style.cssText = 'padding:8px 16px;cursor:pointer;border:1px solid var(--text-error);background:transparent;color:var(--text-error);border-radius:4px;';
        deleteBtn.onclick = async () => {
            await this.deleteTemplate();
        };

        const saveBtn = btnRow.createEl('button', { text: '💾 保存' });
        saveBtn.style.cssText = 'padding:8px 16px;cursor:pointer;border:none;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:4px;';
        saveBtn.onclick = async () => {
            await this.saveTemplate(systemTA.value, userTA.value);
        };
    }

    private async saveTemplate(systemContent: string, userContent: string): Promise<void> {
        try {
            if (!systemContent.trim() && !userContent.trim()) {
                new Notice('⚠️ 系统提示词与用户提示词都为空，未保存', 5000);
                return;
            }
            // 确保目录存在
            const dir = this.app.vault.getAbstractFileByPath(PJ_PROMPT_TEMPLATE_DIR);
            if (!dir) {
                await this.app.vault.createFolder(PJ_PROMPT_TEMPLATE_DIR);
            }

            // 保存 System Prompt；清空则删除覆盖文件，回退内置模板（旧实现空内容直接跳过，
            // 用户以为清空成功，实际旧覆盖仍生效）。
            const systemPath = this.template.systemPath;
            const existingSystem = this.app.vault.getAbstractFileByPath(systemPath);
            if (systemContent.trim()) {
                if (existingSystem instanceof TFile) {
                    await this.app.vault.modify(existingSystem, systemContent);
                } else {
                    await this.app.vault.create(systemPath, systemContent);
                }
            } else if (existingSystem instanceof TFile) {
                await this.app.vault.delete(existingSystem, true);
            }

            // 保存 User Prompt
            const userPath = this.template.userPath;
            const existingUser = this.app.vault.getAbstractFileByPath(userPath);
            if (userContent.trim()) {
                if (existingUser instanceof TFile) {
                    await this.app.vault.modify(existingUser, userContent);
                } else {
                    await this.app.vault.create(userPath, userContent);
                }
            } else if (existingUser instanceof TFile) {
                await this.app.vault.delete(existingUser, true);
            }

            new Notice(`✅ 已保存 ${this.template.name} 模板`);
            this.close();
            if (this.refreshCallback) {
                this.refreshCallback();
            }
        } catch (e) {
            log.error('[TemplateManager] 保存模板失败:', e);
            new Notice(`❌ 保存失败: ${(e as Error).message}`);
        }
    }

    private async deleteTemplate(): Promise<void> {
        const confirmed = await OperationConfirmModal.confirm(this.app, {
            title: '删除自定义模板',
            description: `确定要删除 ${this.template.name} 的自定义模板吗？`,
            confirmText: '确认删除',
            cancelText: '取消',
        });
        if (!confirmed) return;

        try {
            let count = 0;
            if (this.template.hasSystem) {
                const file = this.app.vault.getAbstractFileByPath(this.template.systemPath);
                if (file instanceof TFile) {
                    await this.app.vault.delete(file);
                    count++;
                }
            }
            if (this.template.hasUser) {
                const file = this.app.vault.getAbstractFileByPath(this.template.userPath);
                if (file instanceof TFile) {
                    await this.app.vault.delete(file);
                    count++;
                }
            }

            new Notice(`✅ 已删除 ${this.template.name} 的 ${count} 个自定义模板`);
            this.close();
            if (this.refreshCallback) {
                this.refreshCallback();
            }
        } catch (e) {
            log.error('[TemplateManager] 删除模板失败:', e);
            new Notice(`❌ 删除失败: ${(e as Error).message}`);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/** 模板导入弹窗 */
class TemplateImportModal extends Modal {
    private refreshCallback?: () => void;

    constructor(app: App, refreshCallback?: () => void) {
        super(app);
        this.refreshCallback = refreshCallback;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: '📥 导入模板' });

        const desc = contentEl.createEl('p', {
            text: '导入从本插件导出的模板文件（.md 格式）。\n导入将覆盖同名模板。',
            attr: { style: 'margin:12px 0;' }
        });

        // 文件选择
        const fileInput = contentEl.createEl('input', {
            attr: { type: 'file', accept: '.md,text/markdown', style: 'margin:12px 0;display:block;' }
        }) as HTMLInputElement;

        const statusDiv = contentEl.createDiv({ attr: { style: 'margin:12px 0;font-size:13px;' } });

        const btnRow = contentEl.createDiv({ attr: { style: 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end;' } });

        const cancelBtn = btnRow.createEl('button', { text: '取消' });
        cancelBtn.style.cssText = 'padding:8px 16px;cursor:pointer;border:1px solid var(--background-modifier-border);background:transparent;border-radius:4px;';
        cancelBtn.onclick = () => this.close();

        const importBtn = btnRow.createEl('button', { text: '📥 导入' });
        importBtn.style.cssText = 'padding:8px 16px;cursor:pointer;border:none;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:4px;';
        importBtn.disabled = true;
        importBtn.onclick = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            await this.importFile(file, statusDiv);
        };

        fileInput.onchange = () => {
            importBtn.disabled = !fileInput.files?.length;
        };
    }

    private async importFile(file: File, statusDiv: HTMLElement): Promise<void> {
        try {
            const content = await file.text();
            const lines = content.split('\n');
            let currentSection = '';
            let currentContent: string[] = [];
            const sections: Record<string, string> = {};

            // 解析导出的模板文件
            for (const line of lines) {
                if (line.startsWith('## ') && (line.includes('System') || line.includes('User'))) {
                    if (currentSection && currentContent.length) {
                        sections[currentSection] = currentContent.join('\n').trim();
                    }
                    currentSection = line.includes('System') ? 'system' : 'user';
                    currentContent = [];
                } else if (line.startsWith('## ') && !line.includes('System') && !line.includes('User')) {
                    // 其他章节，跳过
                    currentSection = '';
                    currentContent = [];
                } else if (currentSection) {
                    currentContent.push(line);
                }
            }
            if (currentSection && currentContent.length) {
                sections[currentSection] = currentContent.join('\n').trim();
            }

            // 确保目录存在
            const dir = this.app.vault.getAbstractFileByPath(PJ_PROMPT_TEMPLATE_DIR);
            if (!dir) {
                await this.app.vault.createFolder(PJ_PROMPT_TEMPLATE_DIR);
            }

            let count = 0;
            if (sections.system) {
                // 从文件名推断 key
                const keyMatch = file.name.match(/^(.+?)-template/);
                if (keyMatch) {
                    const key = keyMatch[1];
                    const path = `${PJ_PROMPT_TEMPLATE_DIR}/${key}-system.md`;
                    const existing = this.app.vault.getAbstractFileByPath(path);
                    if (existing instanceof TFile) {
                        await this.app.vault.modify(existing, sections.system);
                    } else {
                        await this.app.vault.create(path, sections.system);
                    }
                    count++;
                }
            }
            if (sections.user) {
                const keyMatch = file.name.match(/^(.+?)-template/);
                if (keyMatch) {
                    const key = keyMatch[1];
                    const path = `${PJ_PROMPT_TEMPLATE_DIR}/${key}-user.md`;
                    const existing = this.app.vault.getAbstractFileByPath(path);
                    if (existing instanceof TFile) {
                        await this.app.vault.modify(existing, sections.user);
                    } else {
                        await this.app.vault.create(path, sections.user);
                    }
                    count++;
                }
            }

            if (count === 0) {
                statusDiv.setText('❌ 未识别到可导入的模板片段（文件名需包含 -template）');
                new Notice('❌ 未导入任何模板：文件格式不正确', 6000);
                return;
            }
            statusDiv.setText(`✅ 已导入 ${count} 个模板文件`);
            new Notice(`✅ 已导入 ${count} 个模板`);

            setTimeout(() => {
                this.close();
                if (this.refreshCallback) {
                    this.refreshCallback();
                }
            }, 1000);
        } catch (e) {
            log.error('[TemplateManager] 导入模板失败:', e);
            statusDiv.setText(`❌ 导入失败: ${(e as Error).message}`);
            new Notice(`❌ 导入失败: ${(e as Error).message}`);
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
