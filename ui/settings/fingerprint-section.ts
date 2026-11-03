/**
 * fingerprint-section.ts — 设置页「写作指纹库」分区
 *
 * 职责：渲染模板 / 全局 / 项目三级写作指纹库列表，负责指纹的加载、新增、
 * 查看详情、启停与删除，以及模板指纹同步到项目。
 * 来源：`ui/settings-tab.ts` L1821-2165（含 L81-85 的五个指纹相关字段）。
 */
import { Notice } from 'obsidian';
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

const log = createLogger('SettingsTab');

/**
 * 指纹分区。
 */
export class FingerprintSection extends SettingsSection {
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
        const section = container.createEl('section');
        section.createEl('h3', { text: '🔍 写作指纹库' });

        section.createEl('p', {
            text: '管理模板、全局和项目级写作指纹库，用于保持风格一致性。',
            cls: 'setting-item-description'
        });

        if (this.fingerprintLoading) {
            section.createDiv({
                cls: 'nw-u-p-40px-2 nw-u-ta-center-2 nw-u-c-text-faint-2 nw-u-fs-13px-2',
                text: '加载中...'
            });
            return;
        }

        const activeProject = this.plugin.getActiveProject();

        if (!this.fingerprintLibrary) {
            this.fingerprintLibrary = new StyleFingerprintLibrary(this.app, activeProject || undefined);
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

        const templateSection = section.createDiv({ cls: 'nw-u-marginbottom-24px-2' });
        this.renderFingerprintGroup(templateSection, '模板指纹库', this.templateFingerprints, 'template');

        const globalSection = section.createDiv({ cls: 'nw-u-marginbottom-24px-2' });
        this.renderFingerprintGroup(globalSection, '全局指纹库', this.globalFingerprints, 'global');

        const projectSection = section.createDiv();
        this.renderFingerprintGroup(projectSection, '项目指纹库', this.projectFingerprints, 'project', activeProject);
    }

    private renderFingerprintGroup(
        container: HTMLElement,
        title: string,
        fingerprints: StyleFingerprint[],
        scope: 'template' | 'global' | 'project',
        activeProject?: string | null
    ): void {
        const headerRow = container.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-jc-space-between-2 nw-u-marginbottom-10px-2' });
        
        if (scope === 'project') {
            const titleText = activeProject ? `${title}（${fingerprints.length} 个）· ${activeProject}` : `${title}（${fingerprints.length} 个）`;
            headerRow.createEl('span', { text: titleText, cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
        } else {
            headerRow.createEl('span', { text: `${title}（${fingerprints.length} 个）`, cls: 'nw-u-fwt-600-2 nw-u-fs-13px-2' });
        }

        const isProjectWithoutProject = scope === 'project' && !activeProject;
        const headerRight = scope === 'project' && activeProject
            ? headerRow.createDiv({ cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-gap-10px-2' })
            : headerRow;

        const addBtn = headerRight.createEl('button', {
            text: scope === 'template' ? '➕ 添加模板指纹' : scope === 'global' ? '➕ 添加全局指纹' : '➕ 添加项目指纹',
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
                text: '🔄 从模板同步',
                attr: {
                    type: 'button',
                    title: '从模板指纹库同步到项目指纹库',
                    style: 'padding:2px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;background:transparent;'
                }
            });
            syncBtn.addEventListener('click', async () => {
                if (!this.fingerprintLibrary) return;
                try {
                    const result = await this.fingerprintLibrary.syncFromTemplate(activeProject);
                    await this.loadProjectFingerprints();
                    this.refresh();
                    new Notice(`✅ 同步完成：新增 ${result.added.length} 个，更新 ${result.updated.length} 个`);
                } catch (e) {
                    log.warn('[SettingsTab] 同步失败:', e);
                    new Notice('❌ 同步失败，请查看控制台');
                }
            });
        }

        if (isProjectWithoutProject) {
            container.createDiv({
                cls: 'nw-u-p-20px-2 nw-u-ta-center-2 nw-u-c-text-muted-2 nw-u-fs-13px-2 nw-u-bg-background-secondary-2 nw-u-brd-6px-2',
                text: '请先打开一个项目查看项目级指纹'
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
                const scopeLabel = scope === 'template' ? '模板' : scope === 'global' ? '全局' : '项目';
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '删除指纹',
                    description: `确定要删除${scopeLabel}指纹「${fp.name}」吗？`,
                    warning: '此操作不可恢复',
                    confirmText: '确认删除',
                    cancelText: '取消',
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
                new Notice(`已删除「${fp.name}」`);
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
                new Notice(`已删除「${fingerprint.name}」`);
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
                new Notice(`已删除「${fingerprint.name}」`);
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
            new Notice('请先打开一个项目');
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
                new Notice(`已删除「${fingerprint.name}」`);
            },
        }).open();
    }
}
