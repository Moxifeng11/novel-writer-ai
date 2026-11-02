import { Notice } from 'obsidian';
import NovelWriterPlugin from '../main';
import { PlanBookModal } from './plan-book-modal';
import { CreateProjectModal } from './create-project-modal';
import { PreResearchModal } from './pre-research-modal';

/**
 * SidebarComponent 类。
 */
export class SidebarComponent {
    private plugin: NovelWriterPlugin;
    constructor(plugin: NovelWriterPlugin) { this.plugin = plugin; }

    /**
     * 渲染。
     * @param panel - 面板元素
     */
    render(panel: HTMLElement) {
        panel.empty();
        panel.createEl('div', { text: '⚙️ 核心操作', cls: 'novel-workspace-section-title' });
        
        const actions = [
            { label: '✍️ 协同写作', action: () => this.plugin.executeCommand('novel-writer-co-writing') },
            { label: '📋 全书规划', action: () => new PlanBookModal(this.plugin.app, this.plugin).open() },
            { label: '📖 新建长篇项目', action: () => new CreateProjectModal(this.plugin.app, this.plugin).open() },
            { label: '📄 新建短篇项目', action: () => new PreResearchModal(this.plugin.app, this.plugin, 'short').open() },
            { label: '🎬 新建剧本项目', action: () => new PreResearchModal(this.plugin.app, this.plugin, 'script').open() },
        ];
        
        actions.forEach(a => {
            const btn = panel.createEl('button', { text: a.label, attr: { style: 'display: block; width: 100%; margin: 4px 0; padding: 6px; font-size: 12px; cursor: pointer;' } });
            btn.onclick = a.action;
        });
    }
}

