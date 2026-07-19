import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { mkdirp } from '../utils/helpers';

export class AddFanficSettingModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private generateButton: HTMLButtonElement | null = null;
    private originalButtonText: string = '';

    constructor(app: App, plugin: NovelWriterPlugin) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.empty();
        contentEl.createEl('h2', { text: '📚 添加同人设定' });

        const nameInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '作品名称（如：遮天、斗破苍穹）',
            cls: 'nw-input novel-writer-input'
        });
        const typeInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '作品类型（如：玄幻、仙侠、奇幻、科幻、都市）',
            value: '玄幻',
            cls: 'nw-input novel-writer-input'
        });
        const authorInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: '作者（留空则让 AI 尝试识别）',
            cls: 'nw-input novel-writer-input'
        });

        this.generateButton = contentEl.createEl('button', { text: '生成同人设定', cls: 'nw-btn nw-btn-primary novel-writer-primary-button' });
        this.generateButton.onclick = async () => {
            const workName = nameInput.value.trim();
            const workType = typeInput.value.trim();
            const author = authorInput.value.trim();

            if (!workName) {
                new Notice('❌ 请输入作品名称', 5000);
                return;
            }

            await this.generateFanficSetting(workName, workType, author);
        };
    }

    private async generateFanficSetting(workName: string, workType: string, author: string): Promise<void> {
        if (!this.plugin.settings.apiKey) {
            new Notice('❌ 请先配置API密钥', 5000);
            return;
        }

        if (this.generateButton) {
            this.originalButtonText = this.generateButton.textContent || '';
            this.generateButton.disabled = true;
            this.generateButton.textContent = '⏳ 生成中...';
        }
        const genNotice = new Notice(`⏳ 正在生成《${workName}》的世界观设定...`, 0);

        try {
            const systemPrompt = `你是一个资深的小说设定整理专家。请根据作品名称，生成一份详细的世界观设定文件。

【输出格式要求】
必须严格按照以下 Markdown 格式输出，包含完整的 YAML frontmatter：

---
作品名称: ${workName}
作品类型: ${workType}
作者: ${author || "未知"}
原作平台: 
世界观版本: 
---

# ${workName}世界观

## 核心设定

（请列出该作品的核心世界观规则、力量体系、关键概念）

## 主要人物

（请列出主要人物及其简介，包括主角、重要配角、反派）

## 势力组织

（请列出重要的势力、组织、宗门、家族等）

## 地理地点

（请列出重要的地理位置、城市、秘境、战场等）

## 特殊物品/功法

（请列出重要的物品、武器、功法、技能等）

## 时间线

（请列出关键的时间节点和剧情发展）

## 创作规则（同人专用）

（请列出同人创作时需要遵循的规则）

【注意事项】
1. 内容必须准确，基于公开的原作信息
2. 如果某些信息不确定，可以标注"待补充"
3. 保持设定的完整性和一致性
4. 语言简洁明了，便于同人作者参考`;

            const userContent = `请为《${workName}》生成详细的世界观设定文件。${author ? `作者是${author}。` : ""}`;

            const result = await this.aiEngine.callAI(systemPrompt, userContent, undefined, 0.7, 8192);

            if (result.error) {
                new Notice(`❌ ${result.error}`, 12000);
                return;
            }

            const fanficDir = '元文件/05-同人设定库';
            await mkdirp(this.app, fanficDir);

            const safeName = workName.replace(/[\\/:*?"<>|]/g, "_").trim();
            const filePath = `${fanficDir}/${safeName}设定.md`;

            const existingSetting = this.app.vault.getAbstractFileByPath(filePath);
            if (existingSetting) {
                const overwrite = window.confirm(`「${safeName}设定.md」已存在，覆盖？`);
                if (!overwrite) return;
                await this.app.vault.delete(existingSetting);
            }

            await this.app.vault.create(filePath, result.content);
            new Notice(`✅ 《${workName}》设定已保存到 ${fanficDir}`, 6000);

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.plugin.safeOpenFile(file);
            }

            this.close();
        } finally {
            genNotice.hide();
            if (this.generateButton) {
                this.generateButton.disabled = false;
                this.generateButton.textContent = this.originalButtonText;
            }
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
