import { App, Modal } from 'obsidian';
import { BUILTIN_CHANGELOG, ChangelogEntry } from '../shared/changelog-data';

interface ChangelogModalOptions {
    highlightVersion?: string;
    showWelcomeMessage?: boolean;
    onClose?: () => void;
}

export class ChangelogModal extends Modal {
    private options: ChangelogModalOptions;
    private expandedVersions: Set<string> = new Set();

    constructor(app: App, options: ChangelogModalOptions = {}) {
        super(app);
        this.options = options;
        if (options.highlightVersion) {
            this.expandedVersions.add(options.highlightVersion);
        }
    }

    onOpen() {
        this.modalEl.addClass('nw-scope');
        this.render();
    }

    onClose() {
        this.contentEl.empty();
        this.options.onClose?.();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.style.maxHeight = '85vh';

        contentEl.createEl('h3', {
            text: '📜 更新日志',
            attr: { style: 'margin-top:0;margin-bottom:8px;' }
        });

        if (this.options.showWelcomeMessage) {
            const welcomeBox = contentEl.createDiv({
                attr: {
                    style: 'padding:16px;background:var(--background-modifier-success);border-radius:8px;margin-bottom:16px;border:1px solid var(--background-modifier-success-hover);'
                }
            });
            welcomeBox.createEl('div', {
                text: '🎉 欢迎使用小说工坊 AI！',
                attr: { style: 'font-weight:600;font-size:16px;margin-bottom:6px;' }
            });
            welcomeBox.createEl('div', {
                text: '全流程 AI 长篇小说创作系统 — 协同写作工作台 + 多模型智能引擎 + 数据安全架构',
                attr: { style: 'font-size:13px;color:var(--text-muted);line-height:1.6;' }
            });
        }

        this.renderChangelogList(contentEl);

        const footer = contentEl.createDiv({
            attr: { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--background-modifier-border);' }
        });

        footer.createEl('span', {
            text: `共 ${BUILTIN_CHANGELOG.length} 个版本记录`,
            attr: { style: 'font-size:12px;color:var(--text-muted);' }
        });

        const closeBtn = footer.createEl('button', {
            text: '关闭',
            attr: {
                type: 'button',
                style: 'padding:6px 18px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:6px;font-size:13px;font-weight:500;'
            }
        });
        closeBtn.addEventListener('click', () => this.close());
    }

    private renderChangelogList(container: HTMLElement): void {
        const list = container.createDiv({
            attr: { style: 'display:flex;flex-direction:column;gap:12px;' }
        });

        BUILTIN_CHANGELOG.forEach((entry) => {
            this.renderVersionEntry(list, entry);
        });
    }

    private renderVersionEntry(container: HTMLElement, entry: ChangelogEntry): void {
        const isExpanded = this.expandedVersions.has(entry.version);
        const isHighlight = this.options.highlightVersion === entry.version;

        const entryEl = container.createDiv({
            attr: {
                style: `border:1px solid ${isHighlight ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};border-radius:8px;overflow:hidden;background:var(--background-primary);`
            }
        });

        const header = entryEl.createDiv({
            attr: {
                style: 'padding:12px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:var(--background-secondary);'
            }
        });

        const left = header.createDiv({
            attr: { style: 'display:flex;align-items:center;gap:10px;' }
        });

        left.createEl('span', {
            text: `v${entry.version}`,
            attr: { style: 'font-weight:600;font-size:15px;color:var(--text-normal);' }
        });

        left.createEl('span', {
            text: entry.date,
            attr: { style: 'font-size:12px;color:var(--text-muted);' }
        });

        if (isHighlight) {
            left.createEl('span', {
                text: '最新',
                attr: { style: 'padding:2px 8px;background:var(--interactive-accent);color:var(--text-on-accent);border-radius:10px;font-size:11px;font-weight:500;' }
            });
        }

        const title = header.createEl('span', {
            text: entry.title,
            attr: { style: 'font-size:13px;color:var(--text-muted);flex:1;text-align:right;margin-right:12px;' }
        });

        const arrow = header.createEl('span', {
            text: isExpanded ? '▼' : '▶',
            attr: { style: 'font-size:10px;color:var(--text-muted);' }
        });

        header.addEventListener('click', () => {
            if (isExpanded) {
                this.expandedVersions.delete(entry.version);
            } else {
                this.expandedVersions.add(entry.version);
            }
            this.render();
        });

        if (isExpanded) {
            const body = entryEl.createDiv({
                attr: { style: 'padding:12px 16px;border-top:1px solid var(--background-modifier-border);' }
            });

            entry.sections.forEach((section) => {
                this.renderSection(body, section);
            });
        }
    }

    private renderSection(container: HTMLElement, section: ChangelogEntry['sections'][0]): void {
        const sectionEl = container.createDiv({
            attr: { style: 'margin-bottom:12px;&:last-child{margin-bottom:0;}' }
        });

        sectionEl.createEl('div', {
            text: section.label,
            attr: { style: 'font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-normal);' }
        });

        const list = sectionEl.createEl('ul', {
            attr: { style: 'margin:0;padding-left:20px;' }
        });

        section.items.forEach((item) => {
            const li = list.createEl('li');
            li.style.cssText = 'font-size:13px;line-height:1.7;color:var(--text-muted);margin-bottom:2px;';
            li.textContent = item;
        });
    }
}
