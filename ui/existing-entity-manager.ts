import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { showSuccess, showError, showWarning } from '@/utils/helpers';
import { createLogger } from '@/shared/logger';
import { OperationConfirmModal } from './components/progress';
import { isImeComposing } from '@/shared/keyboard';


const log = createLogger('ExistingEntityManager');
interface ExistingEntity {
    path: string;
    fileName: string;
    yamlName: string;
    content: string;
    isUnnamed: boolean;
}

/**
 * 已生成实体管理面板（v3.5.3）
 *
 * 扫描 ${project}/{folderName}/*.md，提供：
 *   - 改名（联动 文件名 / YAML名称 / H1 标题 三者）
 *   - 编辑全文
 *   - 删除文件
 *   - 智能猜名（用于"未命名_N"批量修复）
 *
 * 职责边界：本弹窗只做**单类别**（一个 `folderName` 目录）的文件操作，
 * 由 4 个单类别生成弹窗、unified 总览 / 生成弹窗按类别跳转复用；
 * 跨类别总览、完整性审计、批量补全在 `unified-entity-manager-modal`。
 * 两者是「总览页 → 详情页」关系，不是重复实现，不要合并。
 */
export class ExistingEntityManagerModal extends Modal {
    private plugin: NovelWriterPlugin;
    private project: string;
    private folderName: string;
    private displayLabel: string;

    private entities: ExistingEntity[] = [];
    private deletedSet: Set<string> = new Set();
    private modifiedContent: Map<string, string> = new Map();
    private renameMap: Map<string, string> = new Map();
    private filterMode: 'all' | 'unnamed' = 'all';

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        project: string,
        folderName: string,
        displayLabel: string,
    ) {
        super(app);
        this.plugin = plugin;
        this.project = project;
        this.folderName = folderName;
        this.displayLabel = displayLabel;
    }

    /**
     * onOpen 方法。
     */
    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { modalEl } = this;
        modalEl.addClass('nw-modal-form');
        this._loadAndRender();
    }

    /**
     * onClose 方法。
     */
    onClose(): void {
        // v3.4.9 P0-3: 关闭前提示未保存的改名
        if (this.renameMap.size > 0) {
            new Notice(`⚠️ 还有 ${this.renameMap.size} 个实体改名未应用，已丢弃`);
        }
        this.contentEl.empty();
        this.entities = [];
        this.deletedSet.clear();
        this.modifiedContent.clear();
        this.renameMap.clear();
    }

    private async _scanEntities(): Promise<ExistingEntity[]> {
        const dir = `${this.project}/${this.folderName}`;
        const folder = this.app.vault.getAbstractFileByPath(dir);
        if (!folder || !(folder instanceof TFolder)) {
            log.warn(`[小说工坊] ExistingEntityManager 目录不存在：${dir}`);
            return [];
        }

        const results: ExistingEntity[] = [];
        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            try {
                const content = await this.app.vault.read(child);
                const fileName = child.basename;
                const yamlName = this._extractYamlName(content) || fileName;
                const isUnnamed = /^未命名[_\-\s]*\d/.test(fileName);
                results.push({ path: child.path, fileName, yamlName, content, isUnnamed });
            } catch (e) {
                log.error(`[小说工坊] 读取 ${child.path} 失败:`, e);
            }
        }
        results.sort((a, b) => {
            if (a.isUnnamed !== b.isUnnamed) return a.isUnnamed ? -1 : 1;
            return a.fileName.localeCompare(b.fileName, 'zh-Hans-CN');
        });
        return results;
    }

    private _extractYamlName(content: string): string {
        const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!yamlMatch) return '';
        const yaml = yamlMatch[1];
        const m = yaml.match(/^(?:名称|姓名)\s*[:：]\s*["'「」]?([^\n"'「」]+?)["'「」\s]*$/m);
        return m ? m[1].trim() : '';
    }

    private _extractH1(content: string): string {
        const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
        const m = body.match(/^#\s+(.+?)\s*$/m);
        return m ? m[1].trim() : '';
    }

    private _guessNameFromContent(content: string): string {
        const yamlName = this._extractYamlName(content);
        if (yamlName && !/^未命名/.test(yamlName)) return yamlName;
        const h1 = this._extractH1(content);
        if (h1 && !/^未命名/.test(h1)) return h1;
        const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
        const firstLine = body.split('\n').find(l => l.trim().length > 0) || '';
        const cleaned = firstLine.replace(/^[#\-\*\s>]+/, '').trim();
        if (cleaned && cleaned.length <= 30 && !/^未命名/.test(cleaned)) return cleaned;
        return '';
    }

    private async _loadAndRender(): Promise<void> {
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal-form');
        }
        contentEl.addClass('nw-entity-scope');
        contentEl.addClass('nw-form-stack');

        contentEl.empty();
        contentEl.createEl('h2', { text: `📂 管理${this.displayLabel}`, cls: 'nw-ee-heading' });

        const tip = contentEl.createEl('p', { text: '⏳ 正在扫描磁盘...' });
        tip.addClass('nw-ee-muted-sm');

        this.entities = await this._scanEntities();
        tip.remove();

        if (this.entities.length === 0) {
            const noTip = contentEl.createEl('p', {
                text: `❌ ${this.project}/${this.folderName} 中未找到任何 .md 文件`,
            });
            noTip.addClass('nw-ee-error');
            const closeBtn = contentEl.createEl('button', { text: '关闭' });
            closeBtn.onclick = () => this.close();
            return;
        }

        this._renderToolbar();
        this._renderEntityList();
        this._renderActionBar();
    }

    private _renderToolbar(): void {
        const { contentEl } = this;
        const bar = contentEl.createDiv();
        bar.addClass('nw-ee-toolbar');

        const stats = bar.createDiv();
        stats.addClass('nw-ee-muted-sm');
        const unnamedCount = this.entities.filter(e => e.isUnnamed).length;
        stats.innerHTML = `共 <b>${this.entities.length}</b> 个文件` +
            (unnamedCount > 0 ? `（含 <span style="color:var(--text-error)"><b>${unnamedCount}</b></span> 个未命名）` : '');

        const filterRow = bar.createDiv();
        filterRow.addClass('nw-ee-filter-row');
        const allBtn = filterRow.createEl('button', { text: '全部' });
        const unnamedBtn = filterRow.createEl('button', { text: `🚨 仅未命名（${unnamedCount}）` });
        const styleBtn = (b: HTMLButtonElement, active: boolean) => {
            b.addClass('nw-ee-filter-btn');
            b.toggleClass('nw-is-active', active);
        };
        styleBtn(allBtn, this.filterMode === 'all');
        styleBtn(unnamedBtn, this.filterMode === 'unnamed');
        allBtn.onclick = () => { this.filterMode = 'all'; this._loadAndRender(); };
        unnamedBtn.onclick = () => { this.filterMode = 'unnamed'; this._loadAndRender(); };
    }

    private _renderEntityList(): void {
        const { contentEl } = this;
        const list = contentEl.createDiv();
        list.addClass('nw-ee-list');

        const visible = this.filterMode === 'unnamed'
            ? this.entities.filter(e => e.isUnnamed)
            : this.entities;

        if (visible.length === 0) {
            const ok = list.createEl('p', { text: '✅ 没有"未命名"开头的文件，目录已规范' });
            ok.addClass('nw-ee-empty-ok');
            return;
        }

        visible.forEach(ent => this._renderCard(list, ent));
    }

    private _renderCard(parent: HTMLElement, ent: ExistingEntity): void {
        const isDeleted = this.deletedSet.has(ent.path);
        const isModified = this.modifiedContent.has(ent.path);
        const isRenamed = this.renameMap.has(ent.path);

        const card = parent.createDiv();
        card.addClass('nw-ee-card');
        card.toggleClass('nw-is-unnamed', ent.isUnnamed);
        card.toggleClass('nw-is-deleted', isDeleted);

        const head = card.createDiv();
        head.addClass('nw-ee-head');

        const displayName = isRenamed ? this.renameMap.get(ent.path)! : ent.fileName;
        const titleSpan = head.createEl('span', {
            text: `${ent.isUnnamed ? '🚨' : '📄'} ${displayName}`,
        });
        titleSpan.addClass('nw-ee-title');
        titleSpan.toggleClass('nw-is-deleted', isDeleted);

        if (isDeleted) {
            const b = head.createEl('span', { text: '已删除' });
            b.addClass('nw-ee-badge', 'nw-ee-badge-error');
        } else {
            if (isRenamed) {
                const b = head.createEl('span', { text: `已改名← ${ent.fileName}` });
                b.addClass('nw-ee-badge', 'nw-ee-badge-accent');
            }
            if (isModified) {
                const b = head.createEl('span', { text: '已修改' });
                b.addClass('nw-ee-badge', 'nw-ee-badge-warning');
            }
            if (ent.isUnnamed && !isRenamed) {
                const b = head.createEl('span', { text: '需要改名' });
                b.addClass('nw-ee-badge', 'nw-ee-badge-error-text');
            }
        }

        if (!isDeleted) {
            // 改名按钮（v3.5.4 修复：prompt() 在 Obsidian Electron 环境下可能不弹出，改为内联编辑）
            const renameBtn = head.createEl('button', { text: '✏️ 改名' });
            renameBtn.addClass('nw-ee-sm-btn');
            renameBtn.onclick = () => {
                // 如果已有内联编辑器，先移除
                const existing = card.querySelector('.rename-inline');
                if (existing) { existing.remove(); return; }
                renameBtn.setText('✏️ 收起');
                
                const cur = isRenamed ? this.renameMap.get(ent.path)! : ent.fileName;
                const curContent = this.modifiedContent.get(ent.path) ?? ent.content;
                const guess = ent.isUnnamed ? this._guessNameFromContent(curContent) : '';
                
                const inline = card.createDiv({ cls: 'rename-inline' });
                inline.addClass('nw-gen-modal-inline-row');
                const input = inline.createEl('input', { type: 'text', value: guess || cur });
                input.addClass('nw-gen-modal-inline-input');
                if (guess) input.placeholder = `建议：${guess}`;
                
                const confirmBtn = inline.createEl('button', { text: '✅ 确认' });
                confirmBtn.addClass('nw-gen-modal-inline-btn', 'nw-gen-modal-inline-btn-primary');
                confirmBtn.onclick = () => {
                    const nm = input.value;
                    if (!nm || !nm.trim()) { inline.remove(); renameBtn.setText('✏️ 改名'); return; }
                    const safeName = nm.trim().replace(/[<>:"/\\|?*]/g, '·').slice(0, 60);
                    if (safeName === ent.fileName) {
                        this.renameMap.delete(ent.path);
                    } else {
                        this.renameMap.set(ent.path, safeName);
                    }
                    this._loadAndRender();
                };
                
                const cancelBtn = inline.createEl('button', { text: '取消' });
                cancelBtn.addClass('nw-gen-modal-inline-btn');
                cancelBtn.onclick = () => { inline.remove(); renameBtn.setText('✏️ 改名'); };
                
                // 回车确认
                input.addEventListener('keydown', (e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === 'Enter') confirmBtn.click();
                    if (e.key === 'Escape') cancelBtn.click();
                });
                input.focus();
            };

            // 智能猜名按钮（仅对未命名文件）
            if (ent.isUnnamed) {
                const guessBtn = head.createEl('button', { text: '🔮 智能猜名' });
                guessBtn.addClass('nw-ee-sm-btn', 'nw-ee-sm-btn-accent');
                guessBtn.onclick = () => {
                    const curContent = this.modifiedContent.get(ent.path) ?? ent.content;
                    const guess = this._guessNameFromContent(curContent);
                    if (!guess) {
                        new Notice('⚠️ 无法从内容自动提取名称，请手动改名', 4000);
                        return;
                    }
                    const safeName = guess.replace(/[<>:"/\\|?*]/g, '·').slice(0, 60);
                    this.renameMap.set(ent.path, safeName);
                    new Notice(`✅ 已建议名称：${safeName}`, 3000);
                    this._loadAndRender();
                };
            }

            // 编辑按钮
            const editBtn = head.createEl('button', { text: '📝 编辑' });
            editBtn.addClass('nw-ee-sm-btn');
            editBtn.onclick = () => {
                const exist = card.querySelector('.entity-editor');
                if (exist) { exist.remove(); editBtn.setText('📝 编辑'); return; }
                editBtn.setText('📝 收起');
                const ed = card.createDiv({ cls: 'entity-editor' });
                ed.addClass('nw-gen-modal-editor');
                const ta = ed.createEl('textarea');
                ta.value = this.modifiedContent.get(ent.path) ?? ent.content;
                ta.addClass('nw-gen-modal-editor-textarea');
                const br = ed.createDiv();
                br.addClass('nw-gen-modal-editor-actions');
                const sb = br.createEl('button', { text: '💾 暂存修改' });
                sb.addClass('nw-gen-modal-editor-btn');
                sb.onclick = () => {
                    const v = ta.value;
                    if (v === ent.content) {
                        this.modifiedContent.delete(ent.path);
                    } else {
                        this.modifiedContent.set(ent.path, v);
                    }
                    this._loadAndRender();
                };
                const cb = br.createEl('button', { text: '取消' });
                cb.addClass('nw-gen-modal-editor-btn');
                cb.onclick = () => this._loadAndRender();
                const tip = ed.createEl('span', { text: '⚠️ 暂存后点底部"应用变更"才会写入磁盘' });
                tip.addClass('nw-ee-editor-tip');
            };

            // 删除按钮
            const delBtn = head.createEl('button', { text: '🗑️' });
            delBtn.addClass('nw-ee-sm-btn', 'nw-ee-sm-btn-danger');
            delBtn.onclick = () => {
                this.deletedSet.add(ent.path);
                this._loadAndRender();
            };
        } else {
            // 已删除 → 恢复按钮
            const rst = head.createEl('button', { text: '↩️ 恢复' });
            rst.addClass('nw-ee-sm-btn');
            rst.onclick = () => {
                this.deletedSet.delete(ent.path);
                this._loadAndRender();
            };
        }

        // 预览
        if (!isDeleted) {
            const pv = card.createEl('details');
            pv.addClass('nw-ee-preview');
            const sum = pv.createEl('summary', { text: '📄 预览内容' });
            sum.addClass('nw-ee-preview-summary');
            const pc = pv.createEl('pre');
            pc.addClass('nw-ee-preview-content');
            const showContent = this.modifiedContent.get(ent.path) ?? ent.content;
            pc.setText(showContent.slice(0, 500) + (showContent.length > 500 ? '\n...' : ''));
        }
    }

    private _renderActionBar(): void {
        const { contentEl } = this;
        const bar = contentEl.createDiv();
        bar.addClass('nw-ee-actionbar');

        const renamedCount = this.renameMap.size;
        const modifiedCount = this.modifiedContent.size;
        const deletedCount = this.deletedSet.size;
        const hasChanges = renamedCount + modifiedCount + deletedCount > 0;

        const summary = bar.createDiv();
        summary.addClass('nw-ee-actionbar-summary');
        if (hasChanges) {
            const parts: string[] = [];
            if (renamedCount > 0) parts.push(`改名 <b>${renamedCount}</b>`);
            if (modifiedCount > 0) parts.push(`编辑 <b>${modifiedCount}</b>`);
            if (deletedCount > 0) parts.push(`<span style="color:var(--text-error)">删除 <b>${deletedCount}</b></span>`);
            summary.innerHTML = '待应用：' + parts.join('，');
        } else {
            summary.setText('无变更');
        }

        const applyBtn = bar.createEl('button', { text: '🚀 应用变更' });
        applyBtn.addClass('nw-ee-action-btn');
        if (!hasChanges) applyBtn.disabled = true;
        else applyBtn.classList.add('mod-cta');

        const closeBtn = bar.createEl('button', { text: '关闭' });
        closeBtn.addClass('nw-ee-action-btn');
        closeBtn.onclick = async () => {
            if (hasChanges) {
                const confirmed = await OperationConfirmModal.confirm(this.app, {
                    title: '关闭管理面板',
                    description: '有未应用的变更，确定关闭吗？',
                    confirmText: '确认关闭',
                    cancelText: '取消',
                });
                if (!confirmed) return;
            }
            this.close();
        };

        applyBtn.onclick = async () => {
            applyBtn.disabled = true; closeBtn.disabled = true;
            applyBtn.setText('⏳ 正在应用...');
            const result = await this._applyChanges();
            applyBtn.setText('🚀 应用变更');
            closeBtn.disabled = false;

            const lines: string[] = [];
            if (result.renamed) lines.push(`改名 ${result.renamed}`);
            if (result.modified) lines.push(`编辑 ${result.modified}`);
            if (result.deleted) lines.push(`删除 ${result.deleted}`);
            if (result.failed > 0) lines.push(`❌ 失败 ${result.failed}`);

            if (result.failed === 0) {
                showSuccess(`✅ 应用完毕：${lines.join('，') || '无变更'}`);
            } else {
                showWarning(`⚠️ 部分失败：${lines.join('，')}（详见控制台）`);
            }

            // 清空状态并重新扫描
            this.deletedSet.clear();
            this.modifiedContent.clear();
            this.renameMap.clear();
            await this._loadAndRender();
        };
    }

    /**
     * 应用所有变更到磁盘
     * 顺序：内容编辑 → 改名 → 删除（删除最后做，避免误操作仍可恢复）
     */
    private async _applyChanges(): Promise<{ renamed: number; modified: number; deleted: number; failed: number }> {
        let renamed = 0, modified = 0, deleted = 0, failed = 0;

        // 1) 先应用内容修改
        for (const [path, newContent] of this.modifiedContent) {
            if (this.deletedSet.has(path)) continue; // 待删除的不必先改
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) { failed++; continue; }
            try {
                await this.app.vault.modify(file, newContent);
                modified++;
            } catch (e) { // silent-ok: 单条失败计数后由调用方统一汇总提示
                log.error(`[小说工坊] 修改 ${path} 失败:`, e);
                failed++;
            }
        }

        // 2) 应用改名（联动文件名 + YAML名称 + H1标题）
        for (const [path, newName] of this.renameMap) {
            if (this.deletedSet.has(path)) continue;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) { failed++; continue; }
            try {
                // 先读取（可能内容已被 step1 修改过）
                let content = await this.app.vault.read(file);
                // 联动 YAML 名称
                content = this._updateYamlName(content, newName);
                // 联动 H1 标题
                content = this._updateH1(content, newName);
                await this.app.vault.modify(file, content);
                // 改名文件本身（rename 必须用 fileManager 才会同步反链）
                const newPath = `${this.project}/${this.folderName}/${newName}.md`;
                if (newPath !== path) {
                    // 检查目标是否已存在
                    const existing = this.app.vault.getAbstractFileByPath(newPath);
                    if (existing && existing.path !== path) {
                        log.warn(`[小说工坊] 改名冲突：${newPath} 已存在，跳过`);
                        failed++;
                        continue;
                    }
                    await this.app.fileManager.renameFile(file, newPath);
                }
                renamed++;
            } catch (e) {
                log.error(`[小说工坊] 改名 ${path} → ${newName} 失败:`, e);
                failed++;
            }
        }

        // 3) 应用删除（最后做，避免误删）
        for (const path of this.deletedSet) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) { failed++; continue; }
            try {
                await this.app.vault.trash(file, true);  // 移到系统回收站
                deleted++;
            } catch (e) {
                log.error(`[小说工坊] 删除 ${path} 失败:`, e);
                failed++;
            }
        }

        return { renamed, modified, deleted, failed };
    }

    /** 更新 YAML 中的"名称"字段，找不到则在 frontmatter 末尾插入 */
    private _updateYamlName(content: string, newName: string): string {
        const yamlMatch = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
        if (!yamlMatch) {
            // 没有 frontmatter 就加一个
            return `---\n名称: ${newName}\n---\n\n${content}`;
        }
        const [, head, yamlBody, tail] = yamlMatch;
        const nameRe = /^(?:名称|姓名)\s*[:：].*$/m;
        let newYaml: string;
        if (nameRe.test(yamlBody)) {
            newYaml = yamlBody.replace(nameRe, `名称: ${newName}`);
        } else {
            newYaml = yamlBody.trimEnd() + `\n名称: ${newName}`;
        }
        return content.replace(yamlMatch[0], head + newYaml + tail);
    }

    /** 更新或插入 H1 标题 */
    private _updateH1(content: string, newName: string): string {
        // 跳过 frontmatter 部分操作
        const yamlMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
        const yamlPart = yamlMatch ? yamlMatch[0] : '';
        const body = content.slice(yamlPart.length);

        const h1Re = /^#\s+.+?\s*$/m;
        let newBody: string;
        if (h1Re.test(body)) {
            newBody = body.replace(h1Re, `# ${newName}`);
        } else {
            // 在 body 顶部插入
            newBody = `# ${newName}\n\n${body.trimStart()}`;
        }
        return yamlPart + newBody;
    }
}
