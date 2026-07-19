import { App, Modal, Notice } from 'obsidian';

interface WelcomeModalOptions {
    currentVersion: string;
    isNewInstall?: boolean;
    onOpenSettings?: () => void;
    onStartWriting?: () => void;
    onChangelog?: () => void;
    onDontShowAgain?: () => void;
}

export class WelcomeModal extends Modal {
    private options: WelcomeModalOptions;

    constructor(app: App, options: WelcomeModalOptions) {
        super(app);
        this.options = options;
    }

    onOpen() {
        this.modalEl.addClass('nw-scope');
        this.render();
    }

    onClose() {
        this.contentEl.empty();
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

        const hero = contentEl.createDiv({
            attr: {
                style: 'text-align:center;padding:32px 24px 24px;background:linear-gradient(135deg, var(--interactive-accent) 0%, var(--background-modifier-success) 100%);border-radius:12px;margin-bottom:20px;'
            }
        });

        hero.createEl('div', {
            text: '📖',
            attr: { style: 'font-size:48px;margin-bottom:8px;' }
        });

        hero.createEl('h2', {
            text: '小说工坊 AI',
            attr: { style: 'margin:0 0 4px 0;color:white;font-size:24px;' }
        });

        hero.createEl('div', {
            text: `v${this.options.currentVersion}`,
            attr: { style: 'color:rgba(255,255,255,0.85);font-size:14px;' }
        });

        const subtitle = contentEl.createEl('p', {
            text: this.options.isNewInstall
                ? '欢迎使用全流程 AI 长篇小说创作系统！'
                : '插件已更新到最新版本！',
            attr: { style: 'text-align:center;color:var(--text-muted);font-size:15px;margin-bottom:24px;line-height:1.6;' }
        });

        this.renderFeatureCards(contentEl);
        this.renderQuickGuide(contentEl);

        const footer = contentEl.createDiv({
            attr: { style: 'margin-top:24px;' }
        });

        const mainActions = footer.createDiv({
            attr: { style: 'display:flex;gap:10px;margin-bottom:12px;justify-content:center;flex-wrap:wrap;' }
        });

        const primaryBtn = mainActions.createEl('button', {
            text: this.options.isNewInstall ? '🚀 开始创作' : '✨ 查看更新内容',
            attr: {
                type: 'button',
                style: 'padding:10px 24px;cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);border:none;border-radius:8px;font-size:14px;font-weight:600;'
            }
        });
        primaryBtn.addEventListener('click', () => {
            this.close();
            if (this.options.isNewInstall) {
                this.options.onStartWriting?.();
            } else {
                this.options.onChangelog?.();
            }
        });

        const secondaryBtn = mainActions.createEl('button', {
            text: '⚙️ 打开设置',
            attr: {
                type: 'button',
                style: 'padding:10px 20px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-primary);color:var(--text-normal);border-radius:8px;font-size:14px;'
            }
        });
        secondaryBtn.addEventListener('click', () => {
            this.close();
            this.options.onOpenSettings?.();
        });

        const skipRow = footer.createDiv({
            attr: { style: 'display:flex;justify-content:space-between;align-items:center;' }
        });

        const dontShowLabel = skipRow.createEl('label', {
            attr: { style: 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-muted);' }
        });

        const checkbox = dontShowLabel.createEl('input', {
            attr: { type: 'checkbox', style: 'cursor:pointer;' }
        });

        dontShowLabel.createSpan({ text: '不再显示此提示' });

        const skipBtn = skipRow.createEl('button', {
            text: '跳过',
            attr: {
                type: 'button',
                style: 'padding:6px 16px;cursor:pointer;border:none;background:transparent;color:var(--text-muted);font-size:13px;'
            }
        });
        skipBtn.addEventListener('click', () => {
            if ((checkbox as HTMLInputElement).checked) {
                this.options.onDontShowAgain?.();
            }
            this.close();
        });
    }

    private renderFeatureCards(container: HTMLElement): void {
        const features = [
            { icon: '🤝', title: '句级协同写作', desc: 'AI 辅助逐句创作，实时风格一致性检查' },
            { icon: '🧠', title: '多模型智能引擎', desc: '大纲/正文/角色/世界观全流程 AI 生成' },
            { icon: '🛡️', title: '数据安全架构', desc: '本地优先 + 加密存储 + 版本迁移保障' },
            { icon: '🎯', title: '角色灵魂驱动', desc: '角色一致性检查 + 情绪弧规划 + 关系引擎' },
        ];

        const grid = container.createDiv({
            attr: { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;' }
        });

        features.forEach((feat) => {
            const card = grid.createDiv({
                attr: {
                    style: 'padding:14px;background:var(--background-secondary);border-radius:8px;border:1px solid var(--background-modifier-border);'
                }
            });

            card.createEl('div', {
                text: feat.icon,
                attr: { style: 'font-size:24px;margin-bottom:6px;' }
            });

            card.createEl('div', {
                text: feat.title,
                attr: { style: 'font-weight:600;font-size:13px;margin-bottom:4px;color:var(--text-normal);' }
            });

            card.createEl('div', {
                text: feat.desc,
                attr: { style: 'font-size:11px;color:var(--text-muted);line-height:1.5;' }
            });
        });
    }

    private renderQuickGuide(container: HTMLElement): void {
        const steps = this.options.isNewInstall
            ? [
                '1️⃣ 配置 API 密钥（设置 → API 配置）',
                '2️⃣ 创建项目（侧边栏图标或命令面板）',
                '3️⃣ 生成世界观、角色、大纲',
                '4️⃣ 开始章节写作，AI 全程辅助',
            ]
            : [
                '📜 查看更新日志了解新功能',
                '⚙️ 根据需要调整相关设置',
                '💡 有问题？随时打开设置查看帮助',
            ];

        const guideBox = container.createDiv({
            attr: {
                style: 'padding:16px;background:var(--background-secondary);border-radius:8px;border:1px solid var(--background-modifier-border);'
            }
        });

        guideBox.createEl('div', {
            text: this.options.isNewInstall ? '📋 快速开始' : '📌 升级后建议',
            attr: { style: 'font-weight:600;font-size:14px;margin-bottom:10px;color:var(--text-normal);' }
        });

        const list = guideBox.createEl('ul', {
            attr: { style: 'margin:0;padding-left:4px;list-style:none;' }
        });

        steps.forEach((step) => {
            const li = list.createEl('li');
            li.style.cssText = 'font-size:13px;line-height:2;color:var(--text-muted);';
            li.textContent = step;
        });
    }
}
