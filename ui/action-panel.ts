import { Notice } from 'obsidian';
import NovelWriterPlugin from '../main';

export class ActionPanel {
    private plugin: NovelWriterPlugin;
    constructor(plugin: NovelWriterPlugin) { this.plugin = plugin; }

    render(container: HTMLElement) {
        const actions = [
            { label: '✍️ 协同写作', cmd: 'novel-writer-co-writing' },
            { label: '👤 生成角色', cmd: 'novel-writer-character' },
            { label: '📍 生成地点', cmd: 'novel-writer-location' },
            { label: '📋 全书规划', cmd: 'novel-writer-plan-book' },
        ];
        
        const panel = container.createEl('div', { cls: 'novel-writer-fw-actions' });
        panel.createEl('div', { text: '⚙️ 快捷操作', cls: 'novel-writer-fw-panel-title' });
        
        actions.forEach(a => {
            const btn = panel.createEl('button', {
                text: a.label,
                attr: { style: 'display: block; width: 100%; margin-bottom: 4px; padding: 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); cursor: pointer; font-size: 0.85em; text-align: left;' }
            });
            btn.onclick = async () => {
                new Notice(`⏳ 正在尝试触发: ${a.label}`, 2000);
                try {
                    const success = await this.plugin.executeCommand(a.cmd);
                    if (!success) throw new Error("命令未就绪");
                } catch (e) {
                    new Notice(`⚠️ ${a.label} 触发受阻，请确保插件命令已注册`);
                }
            };
        });
    }
}
