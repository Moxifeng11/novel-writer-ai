import { App, SuggestModal } from 'obsidian';
import NovelWriterPlugin, { PROVIDERS, ProviderPreset } from '../main';

interface ProviderOption {
    id: string;
    preset: ProviderPreset;
    hasKey: boolean;
}

export class ProviderSwitcherModal extends SuggestModal<ProviderOption> {
    private plugin: NovelWriterPlugin;

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.setPlaceholder('选择 AI 提供商...');
    }

    getSuggestions(query: string): ProviderOption[] {
        const options = Object.entries(PROVIDERS).map(([id, preset]) => ({
            id,
            preset,
            hasKey: !!this.plugin.settings.providerKeys[id]
        }));
        const currentId = this.plugin.getCurrentProviderId();
        options.sort((a, b) => {
            if (a.id === currentId) return -1;
            if (b.id === currentId) return 1;
            return 0;
        });
        return options.filter(o => 
            o.preset.name.toLowerCase().includes(query.toLowerCase())
        );
    }

    renderSuggestion(option: ProviderOption, el: HTMLElement): void {
        const currentId = this.plugin.getCurrentProviderId();
        const isCurrent = option.id === currentId;
        const modelsPreview = option.preset.models.slice(0, 3).join(', ');
        
        el.createEl('div', { text: option.preset.name }).style.fontWeight = isCurrent ? 'bold' : 'normal';
        el.createEl('small', { 
            text: `${isCurrent ? '✅ 当前 · ' : ''}模型: ${modelsPreview}${option.preset.models.length > 3 ? '...' : ''}${option.hasKey ? ' · 🔑' : ''} · max: ${(option.preset.maxContext/1000).toFixed(0)}K` 
        });
    }

    async onChooseSuggestion(option: ProviderOption, evt: MouseEvent | KeyboardEvent): Promise<void> {
        this.plugin.switchProviderByEndpoint(option.preset.endpoint);
        await this.plugin.saveSettings();
        this.plugin.updateStatusBarText();
    }
}
