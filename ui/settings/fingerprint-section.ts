/**
 * fingerprint-section.ts — 设置页「写作指纹库」分区
 *
 * 职责：渲染模板 / 全局 / 项目三级写作指纹库列表，负责指纹的加载、新增、
 * 查看详情、启停与删除，以及模板指纹同步到项目。
 * 来源：`ui/settings-tab.ts` L1821-2165（含 L81-85 的五个指纹相关字段）。
 */
import { Notice, Setting } from 'obsidian';
import { SettingsSection } from './section-base';
import { StyleFingerprintLibrary, StyleFingerprint } from '@/engine/style-fingerprint-library';
import { FingerprintExtractor } from '@/engine/fingerprint-extractor';
import { createFingerprintEmbedding } from '@/ui/fingerprint-embedding';
import { AddFingerprintModal } from '@/ui/fingerprint-library-modal';
import { FingerprintDetailModal } from '@/ui/fingerprint-detail-modal';
import { renderFingerprintList } from '@/ui/fingerprint-utils';
import { RefillModal } from '@/ui/refill-modal';
import { OperationConfirmModal } from '@/ui/components/progress';
import { createLogger } from '@/shared/logger';
import { t } from '@/i18n';

const log = createLogger('SettingsTab');

/**
 * 指纹分区。
 */
export class FingerprintSection extends SettingsSection {
    /** 指纹库需要异步读盘，切回时可能已是旧数据 → 宿主显示统一刷新条 */
    readonly asyncLoad = true;

    private fingerprintLibrary: StyleFingerprintLibrary | null = null;
    /** 当前库实例绑定的项目：项目切换后需 setProject 重建，否则写进旧项目 */
    private currentLibraryProject: string | null = null;
    private templateFingerprints: StyleFingerprint[] = [];
    private globalFingerprints: StyleFingerprint[] = [];
    private projectFingerprints: StyleFingerprint[] = [];
    private fingerprintLoading = false;

    /**
     * 渲染。
     * @param container - 容器元素
     */
    async render(container: HTMLElement): Promise<void> {
        this.renderStatKeywords(container);

        const section = container.createEl('section');
        section.createEl('h3', { text: t('settings.fingerprint.title') });

        section.createEl('p', {
            text: t('settings.fingerprint.intro'),
            cls: 'setting-item-description'
        });

        if (this.fingerprintLoading) {
            section.createDiv({
                cls: 'nw-u-p-40px nw-u-ta-center nw-u-c-text-faint nw-u-fs-13px',
                text: t('common.loading')
            });
            return;
        }

        const activeProject = this.plugin.getActiveProject();

        if (!this.fingerprintLibrary) {
            this.fingerprintLibrary = StyleFingerprintLibrary.get(this.app, activeProject || undefined);
            await this.loadTemplateFingerprints();
            await this.loadGlobalFingerprints();
            await this.loadProjectFingerprints();
        } else if ((this.currentLibraryProject || undefined) !== (activeProject || undefined)) {
            // 库实例会固化项目路径：切换项目后必须 setProject 并重载，
            // 否则列表还是旧项目的指纹，新增/删除会写进旧项目目录（跨项目写错数据）。
            this.fingerprintLibrary.setProject(activeProject || undefined);
            this.currentLibraryProject = activeProject || null;
            await this.loadProjectFingerprints();
        } else {
            this.currentLibraryProject = activeProject || null;
        }

        const templateSection = section.createDiv({ cls: 'nw-u-marginbottom-24px' });
        this.renderFingerprintGroup(templateSection, t('settings.fingerprint.groupTemplates'), this.templateFingerprints, 'template');

        const globalSection = section.createDiv({ cls: 'nw-u-marginbottom-24px' });
        this.renderFingerprintGroup(globalSection, t('settings.fingerprint.groupGlobal'), this.globalFingerprints, 'global');

        const projectSection = section.createDiv();
        this.renderFingerprintGroup(projectSection, t('settings.fingerprint.groupProject'), this.projectFingerprints, 'project', activeProject);
    }

    /**
     * 统计词表（追加）：只影响风格与 AI 味统计口径，不改变正文判定。
     *
     * 与风格指纹同处一个分区；2026-11-16 从设置页宿主注入改为分区内聚，
     * 否则设置弹窗走装配表渲染时看不到这一块。
     *
     * @param container - 容器元素
     */
    private renderStatKeywords(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'nw-settings-section' });
        new Setting(section)
            .setName(t('settings.fingerprint.statKeywordsHeading'))
            .setDesc(t('settings.fingerprint.statKeywordsDesc'))
            .setHeading();
        new Setting(section)
            .setName(t('settings.fingerprint.aiHighFreqName'))
            .setDesc(t('settings.fingerprint.aiHighFreqDesc'))
            .addTextArea(text => text
                .setPlaceholder(t('settings.fingerprint.aiHighFreqPlaceholder'))
                .setValue((this.plugin.settings.extraAiHighFreqWords ?? []).join(', '))
                .onChange(async value => {
                    this.plugin.settings.extraAiHighFreqWords = value
                        .split(/[,，\s]+/).map(word => word.trim()).filter(Boolean);
                    await this.plugin.saveSettings();
                }));
        const styleFields: Array<{ key: 'positiveEmotion' | 'negativeEmotion' | 'highIntensity'; nameKey: string; hintKey: string }> = [
            { key: 'positiveEmotion', nameKey: 'settings.fingerprint.positiveEmotionName', hintKey: 'settings.fingerprint.positiveEmotionPlaceholder' },
            { key: 'negativeEmotion', nameKey: 'settings.fingerprint.negativeEmotionName', hintKey: 'settings.fingerprint.negativeEmotionPlaceholder' },
            { key: 'highIntensity', nameKey: 'settings.fingerprint.highIntensityName', hintKey: 'settings.fingerprint.highIntensityPlaceholder' },
        ];
        for (const field of styleFields) {
            new Setting(section)
                .setName(t(field.nameKey))
                .addTextArea(text => text
                    .setPlaceholder(t(field.hintKey))
                    .setValue(((this.plugin.settings.styleKeywordOverrides ?? {})[field.key] ?? []).join(', '))
                    .onChange(async value => {
                        const next = { ...(this.plugin.settings.styleKeywordOverrides ?? {}) };
                        next[field.key] = value.split(/[,，\s]+/).map(word => word.trim()).filter(Boolean);
                        this.plugin.settings.styleKeywordOverrides = next;
                        await this.plugin.saveSettings();
                    }));
        }
    }

    private renderFingerprintGroup(
        container: HTMLElement,
        title: string,
        fingerprints: StyleFingerprint[],
        scope: 'template' | 'global' | 'project',
        activeProject?: string | null
    ): void {
        const headerRow = container.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-jc-space-between nw-u-marginbottom-10px' });
        
        const groupLabel = scope === 'project' && activeProject
            ? t('settings.fingerprint.groupTitleWithProject', { title, count: fingerprints.length, project: activeProject })
            : t('settings.fingerprint.groupTitle', { title, count: fingerprints.length });
        headerRow.createSpan({ text: groupLabel, cls: 'nw-u-fwt-600 nw-u-fs-13px' });

        const isProjectWithoutProject = scope === 'project' && !activeProject;
        const headerRight = scope === 'project' && activeProject
            ? headerRow.createDiv({ cls: 'nw-u-d-flex nw-u-ai-center nw-u-gap-10px' })
            : headerRow;

        const addBtn = headerRight.createEl('button', {
            text: scope === 'template'
                ? t('settings.fingerprint.addTemplateBtn')
                : scope === 'global' ? t('settings.fingerprint.addGlobalBtn') : t('settings.fingerprint.addProjectBtn'),
            attr: {
                type: 'button',
                style: isProjectWithoutProject
                    ? 'padding:6px 14px;cursor:not-allowed;background:var(--background-modifier-border);color:var(--text-faint);border:none;border-radius:4px;font-size:12px;'
                    : 'padding:6px 14px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:4px;font-size:12px;'
            }
        });

        if (!isProjectWithoutProject) {
            addBtn.addEventListener('click', () => {
                if (scope === 'template') {
                    this.showAddTemplateFingerprintModal();
                } else if (scope === 'global') {
                    this.showAddGlobalFingerprintModal();
                } else {
                    this.showAddProjectFingerprintModal();
                }
            });
        }

        if (scope === 'project' && activeProject) {
            const syncBtn = headerRight.createEl('button', {
                text: t('settings.fingerprint.syncBtn'),
                attr: {
                    type: 'button',
                    title: t('settings.fingerprint.syncTitleAttr'),
                    style: 'padding:2px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;background:transparent;'
                }
            });
            syncBtn.addEventListener('click', async () => {
                if (!this.fingerprintLibrary) return;
                try {
                    const result = await this.fingerprintLibrary.syncFromTemplate(activeProject);
                    await this.loadProjectFingerprints();
                    this.refresh();
                    new Notice(t('settings.fingerprint.syncDoneNotice', {
                        added: result.added.length,
                        updated: result.updated.length,
                    }));
                } catch (e) {
                    log.warn('[SettingsTab] 同步失败:', e);
                    new Notice(t('settings.fingerprint.syncFailedNotice'));
                }
            });
        }

        if (isProjectWithoutProject) {
            container.createDiv({
                cls: 'nw-u-p-20px nw-u-ta-center nw-u-c-text-muted nw-u-fs-13px nw-u-bg-background-secondary nw-u-brd-6px',
                text: t('settings.fingerprint.noProjectHint')
            });
            return;
        }

        const listContainer = container.createDiv();
        renderFingerprintList(listContainer, fingerprints, {
            showDelete: true,
            onToggle: async (fp) => {
                if (!this.fingerprintLibrary) return;
                // 模板层不参与注入，列表已隐藏其开关；这里只处理 global / project
                if (fp.scope === 'template') return;
                fp.enabled = !fp.enabled;
                if (scope === 'global') {
                    await this.fingerprintLibrary.updateGlobal(fp);
                    await this.loadGlobalFingerprints();
                } else {
                    await this.fingerprintLibrary.updateProject(fp);
                    await this.loadProjectFingerprints();
                }
                this.refresh();
            },
            onDetail: (fp) => {
                if (scope === 'template') {
                    this.showTemplateFingerprintDetail(fp);
                } else if (scope === 'global') {
                    this.showGlobalFingerprintDetail(fp);
                } else {
                    this.showProjectFingerprintDetail(fp);
                }
            },
            onDelete: async (fp) => {
                if (!this.fingerprintLibrary) return;
                const scopeLabel = scope === 'template'
                    ? t('settings.fingerprint.scopeTemplate')
                    : scope === 'global' ? t('settings.fingerprint.scopeGlobal') : t('settings.fingerprint.scopeProject');
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: t('settings.fingerprint.deleteConfirmTitle'),
                    description: t('settings.fingerprint.deleteConfirmDesc', { scope: scopeLabel, name: fp.name }),
                    warning: t('settings.fingerprint.deleteConfirmWarning'),
                    confirmText: t('settings.fingerprint.deleteConfirmOk'),
                    cancelText: t('common.cancel'),
                });
                if (!confirmed) return;
                if (scope === 'template') {
                    await this.fingerprintLibrary.deleteTemplate(fp.id);
                    await this.loadTemplateFingerprints();
                } else if (scope === 'global') {
                    await this.fingerprintLibrary.deleteGlobal(fp.id);
                    await this.loadGlobalFingerprints();
                } else {
                    await this.fingerprintLibrary.deleteProject(fp.id);
                    await this.loadProjectFingerprints();
                }
                this.refresh();
                new Notice(t('settings.fingerprint.deletedNotice', { name: fp.name }));
            },
        });
    }

    private async loadTemplateFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        try {
            this.templateFingerprints = await this.fingerprintLibrary.loadTemplate();
        } catch (e) {
            log.warn('[SettingsTab] 加载模板指纹库失败:', e);
        }
    }

    private showTemplateFingerprintDetail(fp: StyleFingerprint): void {
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            canEdit: true,
            onToggle: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                fingerprint.enabled = !fingerprint.enabled;
                await this.fingerprintLibrary.updateTemplate(fingerprint);
                await this.loadTemplateFingerprints();
                this.refresh();
            },
            onReextract: (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                new RefillModal(this.app, {
                    type: 'fingerprint',
                    fingerprint,
                    fingerprintLibrary: this.fingerprintLibrary,
                    aiEngine: this.plugin.aiEngine,
                    embeddingSettings: this.plugin.settings,
                }).open();
            },
            onDelete: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.deleteTemplate(fingerprint.id);
                await this.loadTemplateFingerprints();
                this.refresh();
                new Notice(t('settings.fingerprint.deletedNotice', { name: fingerprint.name }));
            },
        }).open();
    }

    private showAddTemplateFingerprintModal(): void {
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app, 'global', this.plugin.settings,
        );
        const extractor = new FingerprintExtractor(this.plugin.aiEngine, provider, vectorStore);

        new AddFingerprintModal(this.app, {
            scope: 'template',
            extractor,
            onCompleted: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.addTemplate(fingerprint);
                await this.loadTemplateFingerprints();
                this.refresh();
            }
        }).open();
    }

    private async loadGlobalFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        this.fingerprintLoading = true;
        try {
            this.globalFingerprints = await this.fingerprintLibrary.loadGlobal();
        } catch (e) {
            log.warn('[SettingsTab] 加载全局指纹库失败:', e);
        } finally {
            this.fingerprintLoading = false;
        }
    }

    private async loadProjectFingerprints(): Promise<void> {
        if (!this.fingerprintLibrary) return;
        try {
            this.projectFingerprints = await this.fingerprintLibrary.loadProject();
        } catch (e) {
            log.warn('[SettingsTab] 加载项目指纹库失败:', e);
        }
    }

    private showGlobalFingerprintDetail(fp: StyleFingerprint): void {
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            canEdit: true,
            onToggle: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                fingerprint.enabled = !fingerprint.enabled;
                await this.fingerprintLibrary.updateGlobal(fingerprint);
                await this.loadGlobalFingerprints();
                this.refresh();
            },
            onReextract: (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                new RefillModal(this.app, {
                    type: 'fingerprint',
                    fingerprint,
                    fingerprintLibrary: this.fingerprintLibrary,
                    aiEngine: this.plugin.aiEngine,
                    embeddingSettings: this.plugin.settings,
                }).open();
            },
            onDelete: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.deleteGlobal(fingerprint.id);
                await this.loadGlobalFingerprints();
                this.refresh();
                new Notice(t('settings.fingerprint.deletedNotice', { name: fingerprint.name }));
            },
        }).open();
    }

    private showAddGlobalFingerprintModal(): void {
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app, 'global', this.plugin.settings,
        );
        const extractor = new FingerprintExtractor(this.plugin.aiEngine, provider, vectorStore);

        new AddFingerprintModal(this.app, {
            scope: 'global',
            extractor,
            onCompleted: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.addGlobal(fingerprint);
                await this.loadGlobalFingerprints();
                this.refresh();
            }
        }).open();
    }

    private showAddProjectFingerprintModal(): void {
        const activeProject = this.plugin.getActiveProject();
        if (!activeProject) {
            new Notice(t('settings.fingerprint.noActiveProjectNotice'));
            return;
        }
        const { provider, vectorStore } = createFingerprintEmbedding(
            this.app, 'project', this.plugin.settings, activeProject,
        );
        const extractor = new FingerprintExtractor(this.plugin.aiEngine, provider, vectorStore);

        new AddFingerprintModal(this.app, {
            scope: 'project',
            extractor,
            onCompleted: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.addProject(fingerprint);
                await this.loadProjectFingerprints();
                this.refresh();
            }
        }).open();
    }

    private showProjectFingerprintDetail(fp: StyleFingerprint): void {
        new FingerprintDetailModal(this.app, {
            fingerprint: fp,
            canEdit: true,
            onToggle: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                fingerprint.enabled = !fingerprint.enabled;
                await this.fingerprintLibrary.updateProject(fingerprint);
                await this.loadProjectFingerprints();
                this.refresh();
            },
            onReextract: (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                new RefillModal(this.app, {
                    type: 'fingerprint',
                    fingerprint,
                    fingerprintLibrary: this.fingerprintLibrary,
                    aiEngine: this.plugin.aiEngine,
                    embeddingSettings: this.plugin.settings,
                }).open();
            },
            onDelete: async (fingerprint) => {
                if (!this.fingerprintLibrary) return;
                await this.fingerprintLibrary.deleteProject(fingerprint.id);
                await this.loadProjectFingerprints();
                this.refresh();
                new Notice(t('settings.fingerprint.deletedNotice', { name: fingerprint.name }));
            },
        }).open();
    }
}
