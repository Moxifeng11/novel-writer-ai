/**
 * foreshadow-section.ts — 设置页「伏笔管理」分区
 *
 * 职责：渲染最大未揭示伏笔数量与伏笔类型配置列表，支持类型启停、编辑、
 * 删除、新增，以及配置的导入 / 导出 / 重置为默认。
 * 来源：`ui/settings-tab.ts` L3204-3469。
 */
import { copyText } from '@/shared/clipboard';
import { Setting, Notice, Modal } from 'obsidian';
import { t } from '@/i18n';
import { showErrorNotice, showSuccessNotice } from '@/ui/components/notice-helpers';
import { ForeshadowConfigManager, ForeshadowTypeConfig } from '@/engine/foreshadow-config-manager';
import { OperationConfirmModal } from '@/ui/components/progress';
import { SettingsSection } from './section-base';

/**
 * 伏笔分区。
 */
export class ForeshadowSection extends SettingsSection {
    /** 异步读盘分区：切回时可能已是旧数据 → 宿主显示统一刷新条 */
    readonly asyncLoad = true;

    /**
     * 渲染。
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: t('settings.foreshadow.title') });

        new Setting(section)
            .setName(t('settings.foreshadow.maxUnrevealed'))
            .setDesc(t('settings.foreshadow.maxUnrevealedDesc'))
            .addText(text => text
                .setPlaceholder('20')
                .setValue(String(this.plugin.settings.maxUnrevealedForeshadow))
                .onChange(async (value) => {
                    this.plugin.settings.maxUnrevealedForeshadow = parseInt(value) || 20;
                    await this.plugin.saveSettings();
                }));

        section.createEl('h4', { text: t('settings.foreshadow.typeConfigTitle') });
        const descP = section.createEl('p', { cls: 'setting-item-description' });
        descP.setText(t('settings.foreshadow.typeConfigDesc'));

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
            infoDiv.createSpan({ cls: 'nw-foreshadow-type-name', text: type.name });
            infoDiv.createSpan({ cls: 'nw-foreshadow-type-desc', text: type.description });
            
            const keywordsBadge = infoDiv.createSpan({ cls: 'nw-foreshadow-keywords-count' });
            keywordsBadge.setText(t('settings.foreshadow.keywordsCount', { count: type.keywords.length }));

            const actionsDiv = typeRow.createDiv({ cls: 'nw-foreshadow-type-actions' });

            const toggleBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-toggle-btn',
                text: type.enabled ? '✅' : '❌',
                attr: { title: type.enabled ? t('settings.foreshadow.toggleDisableTitle') : t('settings.foreshadow.toggleEnableTitle') }
            });
            toggleBtn.onclick = async () => {
                configManager.toggleType(type.id, !type.enabled);
                this.saveForeshadowConfig(configManager);
                this.refresh();
            };

            const editBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-action-btn',
                text: t('settings.foreshadow.editBtn')
            });
            editBtn.onclick = () => {
                this.showForeshadowTypeModal(type);
            };

            const deleteBtn = actionsDiv.createEl('button', {
                cls: 'nw-foreshadow-action-btn nw-foreshadow-delete-btn',
                text: t('settings.foreshadow.deleteBtn')
            });
            deleteBtn.onclick = async () => {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: t('settings.foreshadow.deleteTitle'),
                    description: t('settings.foreshadow.deleteConfirm', { name: type.name }),
                    warning: t('settings.foreshadow.deleteWarning'),
                    confirmText: t('settings.foreshadow.deleteConfirmBtn'),
                    cancelText: t('common.cancel'),
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
            text: t('settings.foreshadow.addBtn')
        });
        addBtn.onclick = () => {
            this.showForeshadowTypeModal();
        };

        const importExportDiv = section.createDiv({ cls: 'nw-foreshadow-import-export' });

        const exportBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn',
            text: t('settings.foreshadow.exportBtn')
        });
        exportBtn.onclick = () => {
            const json = configManager.exportConfig();
            void copyText(json).then(() => {
                showSuccessNotice(t('settings.foreshadow.copiedNotice'));
            });
        };

        const importBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn',
            text: t('settings.foreshadow.importBtn')
        });
        importBtn.onclick = async () => {
            const modal = new Modal(this.app);
            modal.titleEl.setText(t('settings.foreshadow.importModalTitle'));

            const textarea = modal.contentEl.createEl('textarea', {
                attr: {
                    placeholder: t('settings.foreshadow.importPlaceholder'),
                    style: 'width: 100%; height: 200px; margin: 10px 0;'
                }
            });

            const importBtn = modal.contentEl.createEl('button', {
                cls: 'mod-cta',
                text: t('settings.foreshadow.importConfirmBtn')
            });
            importBtn.onclick = async () => {
                const result = configManager.importConfig(textarea.value);
                if (result.success) {
                    this.saveForeshadowConfig(configManager);
                    showSuccessNotice(t('settings.foreshadow.importSuccessNotice'));
                    modal.close();
                    this.refresh();
                } else {
                    showErrorNotice(result.errors.join(', '), { title: t('settings.foreshadow.importFailedTitle') });
                }
            };

            modal.open();
        };

        const resetBtn = importExportDiv.createEl('button', {
            cls: 'nw-foreshadow-ie-btn nw-foreshadow-reset-btn',
            text: t('settings.foreshadow.resetBtn')
        });
        resetBtn.onclick = async () => {
            const confirmed = await OperationConfirmModal.confirm(this.app, {
                title: t('settings.foreshadow.resetTitle'),
                description: t('settings.foreshadow.resetConfirm'),
                warning: t('settings.foreshadow.resetWarning'),
                confirmText: t('settings.foreshadow.resetConfirmBtn'),
                cancelText: t('common.cancel'),
            });
            if (confirmed) {
                configManager.resetToDefault();
                this.saveForeshadowConfig(configManager);
                showSuccessNotice(t('settings.foreshadow.resetNotice'));
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
        void this.plugin.saveSettings();
    }

    private showForeshadowTypeModal(existingType?: ForeshadowTypeConfig): void {
        const modal = new Modal(this.app);
        modal.titleEl.setText(existingType ? t('settings.foreshadow.editModalTitle', { name: existingType.name }) : t('settings.foreshadow.addModalTitle'));
        
        const form = modal.contentEl.createDiv({ cls: 'nw-foreshadow-type-form' });
        
        let nameValue = existingType?.name || '';
        let descValue = existingType?.description || '';
        let priorityValue = String(existingType?.priority || 50);
        let colorValue = existingType?.color || '#4CAF50';
        let keywordsValue = existingType?.keywords.join(', ') || '';

        new Setting(form)
            .setName(t('settings.foreshadow.nameName'))
            .setDesc(t('settings.foreshadow.nameDesc'))
            .addText(text => text
                .setPlaceholder(t('settings.foreshadow.namePlaceholder'))
                .setValue(nameValue)
                .onChange(value => { nameValue = value; }));

        new Setting(form)
            .setName(t('settings.foreshadow.descName'))
            .setDesc(t('settings.foreshadow.descDesc'))
            .addText(text => text
                .setPlaceholder(t('settings.foreshadow.descPlaceholder'))
                .setValue(descValue)
                .onChange(value => { descValue = value; }));

        new Setting(form)
            .setName(t('settings.foreshadow.priorityName'))
            .setDesc(t('settings.foreshadow.priorityDesc'))
            .addText(text => text
                .setPlaceholder('100')
                .setValue(priorityValue)
                .onChange(value => { priorityValue = value; }));

        new Setting(form)
            .setName(t('settings.foreshadow.colorName'))
            .setDesc(t('settings.foreshadow.colorDesc'))
            .addText(text => text
                .setPlaceholder('#4CAF50')
                .setValue(colorValue)
                .onChange(value => { colorValue = value; }));

        new Setting(form)
            .setName(t('settings.foreshadow.keywordsName'))
            .setDesc(t('settings.foreshadow.keywordsDesc'))
            .addTextArea(textarea => textarea
                .setPlaceholder(t('settings.foreshadow.keywordsPlaceholder'))
                .setValue(keywordsValue)
                .onChange(value => { keywordsValue = value; }));

        const saveBtn = modal.contentEl.createEl('button', {
            cls: 'mod-cta',
            text: t('settings.foreshadow.saveBtn')
        });
        saveBtn.onclick = async () => {
            const name = nameValue.trim();
            const desc = descValue.trim();
            const priority = parseInt(priorityValue) || 50;
            const color = colorValue.trim();
            const keywords = keywordsValue.split(/[,，]/).map(k => k.trim()).filter(k => k);

            if (!name) {
                new Notice(t('settings.foreshadow.nameRequiredNotice'));
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
                showSuccessNotice(t('settings.foreshadow.updateSuccessNotice'));
            } else {
                configManager.addType({
                    name,
                    description: desc,
                    priority,
                    enabled: true,
                    color,
                    keywords
                });
                showSuccessNotice(t('settings.foreshadow.addSuccessNotice'));
            }
            
            this.saveForeshadowConfig(configManager);
            modal.close();
            this.refresh();
        };
        
        modal.open();
    }
}
