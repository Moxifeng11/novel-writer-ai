/**
 * foreshadow-section.ts — 设置页「伏笔管理」分区
 *
 * 职责：渲染最大未揭示伏笔数量与伏笔类型配置列表，支持类型启停、编辑、
 * 删除、新增，以及配置的导入 / 导出 / 重置为默认。
 * 来源：`ui/settings-tab.ts` L3204-3469。
 */
import { Setting, Notice, Modal } from 'obsidian';
import { ForeshadowConfigManager, ForeshadowTypeConfig } from '../../engine/foreshadow-config-manager';
import { OperationConfirmModal } from '../components/progress';
import { SettingsSection } from './section-base';

/**
 * 伏笔分区。
 */
export class ForeshadowSection extends SettingsSection {
    /**
     * 渲染。
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: '🔮 伏笔管理' });

        new Setting(section)
            .setName('最大未揭示伏笔')
            .setDesc('允许的最大未揭示伏笔数量')
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.maxUnrevealedForeshadow))
                .onChange(async (value) => {
                    this.plugin.settings.maxUnrevealedForeshadow = parseInt(value) || 20;
                    await this.plugin.saveSettings();
                }));

        section.createEl('h4', { text: '📝 伏笔类型配置' });
        const descP = section.createEl('p', { cls: 'setting-item-description' });
        descP.setText('自定义伏笔类型及其关键词，系统会根据配置自动识别和分类伏笔。');

        const configManager = this.getForeshadowConfigManager();
        const types = configManager.getAllTypes();

        const typeList = section.createDiv({ cls: 'nw-foreshadow-type-list' });
        types.forEach(type => {
            const typeRow = typeList.createDiv({ cls: 'nw-foreshadow-type-row' });
            
            const colorDot = typeRow.createDiv({ 
                cls: 'nw-foreshadow-color-dot',
                attr: { style: `background-color: ${type.color || '#999'}` }
            });
            
            const infoDiv = typeRow.createDiv({ cls: 'nw-foreshadow-type-info' });
            infoDiv.createEl('span', { cls: 'nw-foreshadow-type-name', text: type.name });
            infoDiv.createEl('span', { cls: 'nw-foreshadow-type-desc', text: type.description });
            
            const keywordsBadge = infoDiv.createEl('span', { cls: 'nw-foreshadow-keywords-count' });
            keywordsBadge.setText(`${type.keywords.length} 关键词`);
            
            const actionsDiv = typeRow.createDiv({ cls: 'nw-foreshadow-type-actions' });
            
            const toggleBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-toggle-btn',
                text: type.enabled ? '✅' : '❌',
                attr: { title: type.enabled ? '点击禁用' : '点击启用' }
            });
            toggleBtn.onclick = async () => {
                configManager.toggleType(type.id, !type.enabled);
                this.saveForeshadowConfig(configManager);
                this.refresh();
            };
            
            const editBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-action-btn',
                text: '编辑'
            });
            editBtn.onclick = () => {
                this.showForeshadowTypeModal(type);
            };
            
            const deleteBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-action-btn nw-foreshadow-delete-btn',
                text: '删除'
            });
            deleteBtn.onclick = async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除伏笔类型',
                    description: `确定删除伏笔类型 "${type.name}" 吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
                });
                if (confirmed) {
                    configManager.deleteType(type.id);
                    this.saveForeshadowConfig(configManager);
                    this.refresh();
                }
            };
        });

        const addBtn = section.createEl('button', {
            cls: 'nw-foreshadow-add-btn',
            text: '+ 添加新伏笔类型'
        });
        addBtn.onclick = () => {
            this.showForeshadowTypeModal();
        };

        const importExportDiv = section.createDiv({ cls: 'nw-foreshadow-import-export' });
        
        const exportBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn',
            text: '📥 导出配置'
        });
        exportBtn.onclick = () => {
            const json = configManager.exportConfig();
            navigator.clipboard.writeText(json).then(() => {
                new Notice('配置已复制到剪贴板');
            });
        };
        
        const importBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn',
            text: '📤 导入配置'
        });
        importBtn.onclick = async () => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('导入伏笔配置');
            
            const textarea = modal.contentEl.createEl('textarea', {
                attr: { 
                    placeholder: '粘贴导出的 JSON 配置...',
                    style: 'width: 100%; height: 200px; margin: 10px 0;'
                }
            });
            
            const importBtn = modal.contentEl.createEl('button', {
                cls: 'mod-cta',
                text: '导入'
            });
            importBtn.onclick = async () => {
                const result = configManager.importConfig(textarea.value);
                if (result.success) {
                    this.saveForeshadowConfig(configManager);
                    new Notice('配置导入成功');
                    modal.close();
                    this.refresh();
                } else {
                    new Notice('导入失败: ' + result.errors.join(', '));
                }
            };
            
            modal.open();
        };
        
        const resetBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn nw-foreshadow-reset-btn',
            text: '🔄 重置为默认'
        });
        resetBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: '重置伏笔类型',
                description: '确定重置所有伏笔类型配置为默认值吗？',
                warning: '所有自定义伏笔类型配置将丢失',
                confirmText: '确认重置',
                cancelText: '取消',
            });
            if (confirmed) {
                configManager.resetToDefault();
                this.saveForeshadowConfig(configManager);
                new Notice('已重置为默认配置');
                this.refresh();
            }
        };
    }

    private getForeshadowConfigManager(): ForeshadowConfigManager {
        if (!this.plugin._foreshadowConfigManager) {
            const savedConfig = this.plugin.settings.foreshadowConfig;
            this.plugin._foreshadowConfigManager = new ForeshadowConfigManager(savedConfig);
        }
        return this.plugin._foreshadowConfigManager;
    }

    private saveForeshadowConfig(configManager: ForeshadowConfigManager): void {
        this.plugin.settings.foreshadowConfig = configManager.getConfig();
        this.plugin.saveSettings();
    }

    private showForeshadowTypeModal(existingType?: ForeshadowTypeConfig): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(existingType ? `编辑伏笔类型: ${existingType.name}` : '添加新伏笔类型');
        
        const form = modal.contentEl.createDiv({ cls: 'nw-foreshadow-type-form' });
        
        let nameValue = existingType?.name || '';
        let descValue = existingType?.description || '';
        let priorityValue = String(existingType?.priority || 50);
        let colorValue = existingType?.color || '#4CAF50';
        let keywordsValue = existingType?.keywords.join(', ') || '';

        new Setting(form)
            .setName('类型名称')
            .setDesc('伏笔类型的显示名称')
            .addText(text => text
                .setPlaceholder('如：物品')
                .setValue(nameValue)
                .onChange(value => { nameValue = value; }));
        
        new Setting(form)
            .setName('类型描述')
            .setDesc('描述该类型的含义和用途')
            .addText(text => text
                .setPlaceholder('如：武器、道具、丹药等实体物品')
                .setValue(descValue)
                .onChange(value => { descValue = value; }));
        
        new Setting(form)
            .setName('优先级')
            .setDesc('数值越大优先级越高，匹配时优先选择高优先级类型')
            .addText(text => text
                .setPlaceholder('100')
                .setValue(priorityValue)
                .onChange(value => { priorityValue = value; }));
        
        new Setting(form)
            .setName('显示颜色')
            .setDesc('用于在界面中标识该类型的颜色')
            .addText(text => text
                .setPlaceholder('#4CAF50')
                .setValue(colorValue)
                .onChange(value => { colorValue = value; }));
        
        new Setting(form)
            .setName('关键词（逗号分隔）')
            .setDesc('用于匹配伏笔的关键词，支持部分匹配')
            .addTextArea(textarea => textarea
                .setPlaceholder('剑,刀,枪,玉佩')
                .setValue(keywordsValue)
                .onChange(value => { keywordsValue = value; }));
        
        const saveBtn = modal.contentEl.createEl('button', {
            cls: 'mod-cta',
            text: '保存'
        });
        saveBtn.onclick = async () => {
            const name = nameValue.trim();
            const desc = descValue.trim();
            const priority = parseInt(priorityValue) || 50;
            const color = colorValue.trim();
            const keywords = keywordsValue.split(/[,，]/).map(k => k.trim()).filter(k => k);
            
            if (!name) {
                new Notice('请输入类型名称');
                return;
            }
            
            const configManager = this.getForeshadowConfigManager();
            
            if (existingType) {
                configManager.updateType(existingType.id, {
                    name,
                    description: desc,
                    priority,
                    color,
                    keywords
                });
                new Notice('类型更新成功');
            } else {
                configManager.addType({
                    name,
                    description: desc,
                    priority,
                    enabled: true,
                    color,
                    keywords
                });
                new Notice('类型添加成功');
            }
            
            this.saveForeshadowConfig(configManager);
            modal.close();
            this.refresh();
        };
        
        modal.open();
    }
}
