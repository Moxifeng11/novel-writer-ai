import { App, SuggestModal } from 'obsidian';
import NovelWriterPlugin from '../main';

interface ProviderOption {
    id: string;
    name: string;
    endpoint: string;
    models: string[];
    maxContext: number;
    maxOutput: number;
    isPreset: boolean;
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
        const allProviders = this.plugin.getAllProviders();
        const options = allProviders.map(p => ({
            id: p.id,
            name: p.name,
            endpoint: p.endpoint,
            models: p.models,
            maxContext: p.maxContext,
            maxOutput: p.maxOutput,
            isPreset: p.isPreset,
            hasKey: !!this.plugin.settings.providerKeys[p.id]
        }));
        const currentId = this.plugin.getCurrentProviderId();
        options.sort((a, b) => {
            if (a.id === currentId) return -1;
            if (b.id === currentId) return 1;
            return 0;
        });
        return options.filter(o => 
            o.name.toLowerCase().includes(query.toLowerCase())
        );
    }

    renderSuggestion(option: ProviderOption, el: HTMLElement): void {
        const currentId = this.plugin.getCurrentProviderId();
        const isCurrent = option.id === currentId;
        const modelsPreview = option.models.slice(0, 3).join(', ');
        
        el.createEl('div', { text: option.name }).style.fontWeight = isCurrent ? 'bold' : 'normal';
        el.createEl('small', { 
            text: `${isCurrent ? '✅ 当前 · ' : ''}模型: ${modelsPreview}${option.models.length > 3 ? '...' : ''}${option.hasKey ? ' · 🔑' : ''} · max: ${(option.maxContext/1000).toFixed(0)}K` 
        });
    }

    async onChooseSuggestion(option: ProviderOption, evt: MouseEvent | KeyboardEvent): Promise<void> {
        this.plugin.switchProviderByEndpoint(option.endpoint);
        await this.plugin.saveSettings();
        this.plugin.updateStatusBarText();
    }
}
