/**
 * entity-overview-modal.ts — 实体概览 Modal（v3.4.2 从 full-writer-view.ts 提取）
 *
 * 左侧实体树 + 右侧卡片详情。
 */

import { App, Modal, TFile, MarkdownRenderer } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { ExistingEntityManagerModal } from '../existing-entity-manager';
import { ENTITY_CATEGORIES } from '../../shared/entity-registry';
import { SUBDIR_CHARS, SUBDIR_LOCS, SUBDIR_FACTIONS, SUBDIR_ITEMS } from '../../shared/paths';
import { UnifiedEntityManagerModal } from '../unified-entity-manager-modal';

export class EntityOverviewModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    private _handlers: Array<{el: HTMLElement; enter: () => void; leave: () => void}> = [];

    constructor(app: App, plugin: NovelWriterPlugin, project: string) {
        super(app);
        this.plugin = plugin;
        this.project = project;
    }

    async onOpen(): Promise<void> {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';

        // v3.4.5: 使用 CSS 变量，父容器 + contentEl 双覆盖
        const modalWrapper = contentEl.parentElement as HTMLElement | null;
        if (modalWrapper) {
            modalWrapper.style.setProperty('max-width', 'var(--nw-modal-max-w)', 'important');
            modalWrapper.style.setProperty('width', 'var(--nw-modal-max-w)', 'important');
        }
        contentEl.style.maxWidth = 'var(--nw-modal-max-w)';
        contentEl.style.maxHeight = 'var(--nw-modal-max-h)';
        contentEl.style.width = 'var(--nw-modal-max-w)';

        // 标题
        const header = contentEl.createDiv({ attr: { style: 'padding:10px 40px 10px 16px; border-bottom:1px solid var(--background-modifier-border); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;' } });
        const titleWrap = header.createDiv({ attr: { style: 'display:flex; align-items:center; gap:10px;' } });
        titleWrap.createSpan({ text: `👥 实体概览 — ${this.project}`, attr: { style: 'font-weight:600; font-size:16px;' } });

        const unifiedMgrBtn = header.createEl('button', { text: '📚 统一管理', attr: { style: 'font-size:0.8em; padding:5px 12px; cursor:pointer; border-radius:4px; border:1px solid var(--text-accent); background:var(--text-accent); color:white;' } });
        unifiedMgrBtn.onclick = () => {
            this.close();
            new UnifiedEntityManagerModal(this.app, this.plugin, this.project).open();
        };

        // v3.5.3：管理实体快捷入口（4 类）
        const manageBar = header.createDiv({ attr: { style: 'display:flex; gap:6px; flex-wrap:wrap; justify-content:center; margin:0 auto;' } });
        const mkMgrBtn = (label: string, folder: string, displayLabel: string) => {
            const b = manageBar.createEl('button', { text: label });
            b.style.cssText = 'font-size:0.78em; padding:4px 10px; cursor:pointer; border-radius:4px; border:1px solid var(--background-modifier-border); background:var(--background-secondary);';
            b.onclick = () => {
                new ExistingEntityManagerModal(this.app, this.plugin, this.project, folder, displayLabel).open();
            };
        };
        mkMgrBtn('📂 管理人物', SUBDIR_CHARS, '👤 人物');
        mkMgrBtn('📂 管理地点', SUBDIR_LOCS, '📍 地点');
        mkMgrBtn('📂 管理势力', SUBDIR_FACTIONS, '🏰 势力');
        mkMgrBtn('📂 管理物品', SUBDIR_ITEMS, '⚔️ 物品功法');

        // 左右分栏
        const body = contentEl.createDiv({ attr: { style: 'display:flex; flex:1; overflow:hidden; min-height:0;' } });

        // 左侧：实体树
        const sidebar = body.createDiv({ attr: { style: `width: var(--nw-entity-tree-w); min-width: var(--nw-entity-tree-w); border-right: 1px solid var(--background-modifier-border); overflow-y: auto; padding: var(--nw-card-pad); background: var(--background-primary-alt);` } });
        
        // 右侧：卡片内容
        const detail = body.createDiv({ attr: { style: 'flex:1; overflow-y:auto; padding:16px;' } });
        detail.createEl('p', { text: '← 选择左侧实体查看详情', attr: { style: 'color:var(--text-muted); margin-top:40px; text-align:center;' } });

        // 扫描实体
        const entityGroups: { label: string; icon: string; dir: string; files: TFile[] }[] = [];
        // v4.0：实体落盘于 01-世界架构/{人物,地点,势力,物品功法}，registry.dir 仅为叶子名
        const subdirByLeaf: Record<string, string> = {
            '人物': SUBDIR_CHARS,
            '地点': SUBDIR_LOCS,
            '势力': SUBDIR_FACTIONS,
            '物品功法': SUBDIR_ITEMS,
        };
        for (const { label, icon, dir } of ENTITY_CATEGORIES) {
            const dirPath = `${this.project}/${subdirByLeaf[dir] ?? dir}`;
            const files = this.app.vault.getFiles().filter(f =>
                f.path.startsWith(dirPath + '/') &&
                f.name.endsWith('.md') &&
                !f.name.includes('模板')
            );
            entityGroups.push({ label, icon, dir, files });
        }

        for (const group of entityGroups) {
            const groupHeader = sidebar.createDiv({ attr: { style: 'padding:6px 4px; margin-top:4px; font-weight:700; color:var(--text-accent); font-size:0.9em; cursor:pointer;' } });
            groupHeader.createSpan({ text: `${group.icon} ${group.label} (${group.files.length})` });

            for (const file of group.files) {
                const name = file.name.replace('.md', '');
                const item = sidebar.createDiv({ attr: { style: 'padding:4px 4px 4px 18px; cursor:pointer; border-radius:4px; font-size:0.85em;' } });
                item.setText(`  ${name}`);
                item.addEventListener('click', async () => {
                    sidebar.querySelectorAll('.nw-entity-tree-active').forEach(el => el.classList.remove('nw-entity-tree-active'));
                    item.addClass('nw-entity-tree-active');
                    item.style.background = 'var(--text-accent)';
                    item.style.color = 'white';
                    await this.renderEntityCard(detail, file, group.label);
                });
                const enterHandler = () => {
                    if (!item.hasClass('nw-entity-tree-active')) item.style.background = 'var(--background-modifier-hover)';
                };
                const leaveHandler = () => {
                    if (!item.hasClass('nw-entity-tree-active')) item.style.background = '';
                };
                item.addEventListener('mouseenter', enterHandler);
                item.addEventListener('mouseleave', leaveHandler);
                this._handlers.push({ el: item, enter: enterHandler, leave: leaveHandler });
            }
        }

        if (entityGroups.every(g => g.files.length === 0)) {
            sidebar.createEl('p', { text: '暂无实体文件', attr: { style: 'color:var(--text-muted); padding:12px; font-size:0.85em;' } });
        }
    }

    private async renderEntityCard(container: HTMLElement, file: TFile, typeLabel: string): Promise<void> {
        container.empty();
        const content = await this.app.vault.read(file);

        // Frontmatter 块
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const fm = fmMatch ? fmMatch[1] : '';
        const body = fmMatch ? content.substring(fmMatch[0].length).trim() : content;

        // 标题
        const header = container.createDiv({ attr: { style: 'margin-bottom:12px; border-bottom:1px solid var(--background-modifier-border); padding-bottom:8px;' } });
        header.createEl('h3', { text: `${file.name.replace('.md', '')}`, attr: { style: 'margin:0 0 4px 0;' } });
        header.createSpan({ text: `${typeLabel} · ${file.path}`, attr: { style: 'color:var(--text-muted); font-size:0.75em;' } });

        // Frontmatter 折叠区
        if (fm.trim()) {
            const fmSection = container.createEl('details');
            fmSection.createEl('summary', { text: '📋 YAML Frontmatter', attr: { style: 'cursor:pointer; color:var(--text-muted); font-size:0.85em; margin-bottom:8px;' } });
            const fmLines = fm.split('\n').filter(l => l.trim());
            const fmGrid = fmSection.createDiv({ attr: { style: 'display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:0.82em; margin-bottom:12px;' } });
            for (const line of fmLines) {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                    fmGrid.createSpan({ text: line.substring(0, colonIdx), attr: { style: 'color:var(--text-accent); font-weight:600; white-space:nowrap;' } });
                    fmGrid.createSpan({ text: line.substring(colonIdx + 1).trim() || '—', attr: { style: 'color:var(--text-normal);' } });
                }
            }
        }

        // 正文
        if (body) {
            const bodyDiv = container.createDiv({ attr: { style: 'margin-top:8px;' } });
            await MarkdownRenderer.render(this.app, body, bodyDiv, file.path, this.plugin);
        }
    }

    onClose(): void {
        if (this._handlers) {
            for (const h of this._handlers) {
                h.el.removeEventListener('mouseenter', h.enter);
                h.el.removeEventListener('mouseleave', h.leave);
            }
            this._handlers = [];
        }
        this.contentEl.empty();
    }
}
