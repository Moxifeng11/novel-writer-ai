import { App, Modal, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../main';
import { AIEngine } from '../engine/ai-engine';
import { mkdirp } from '../utils/helpers';
import { pjFanficDir } from '../shared/paths';
import { validateFanficSettings } from '../shared/template-validator';
import { listFanficSettingCandidates } from '../shared/fanfic-binding';
import { attachFanficPathToProject, buildFanficSettingsContent, isFanficSettingsContentValidEnough, saveFanficSettingFile } from './full-writer/fanfic-settings-utils';

export class AddFanficSettingModal extends Modal {
    private plugin: NovelWriterPlugin;
    private aiEngine: AIEngine;
    private generateButton: HTMLButtonElement | null = null;
    private originalButtonText: string = '';
    /** 有值时直接保存到该项目的同人设定库并回写 .project 元信息 */
    private project?: string;

    constructor(app: App, plugin: NovelWriterPlugin, project?: string) {
        super(app);
        this.plugin = plugin;
        this.aiEngine = plugin.aiEngine;
        this.project = project;
    }

    onOpen(): void {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // ═══ v3.4.8: 两层CSS规则 — 见 docs/CSS变量注入与两层规则_全插件避坑指南.md ═══
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal-form');
            wrapper.style.setProperty('margin', 'auto', 'important');
        }
        contentEl.style.width = '100%';
        contentEl.style.setProperty('overflow-y', 'auto', 'important');
        contentEl.addClass('nw-entity-scope');
        contentEl.addClass('nw-form-stack');
        contentEl.empty();
        contentEl.createEl('h2', { text: '📚 添加同人设定', attr: { style: 'margin:0; font-size:18px;' } });

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

        // 已有现成设定文件时不必重新生成，也不必手改 .project（与向导同一候选口径）
        if (this.project) this.renderBindExistingSection(contentEl);
    }

    /**
     * 「使用已有设定文件」：只在本项目/全局同人设定库下筛选候选，
     * 绑定走唯一写入口 attachFanficPathToProject。
     * 允许绑定字段不完整的文件（用户随后补全），但必须提示缺失字段。
     */
    private renderBindExistingSection(contentEl: HTMLElement): void {
        const project = this.project;
        if (!project) return;
        const candidates = listFanficSettingCandidates(
            this.app.vault.getMarkdownFiles().map(file => file.path),
            [pjFanficDir(project), '元文件/05-同人设定库'],
        );
        if (candidates.length === 0) return;

        contentEl.createEl('h3', { text: '🔗 使用已有设定文件' });
        const hint = contentEl.createEl('p', { text: '已手写或从别处拷入设定文件时，直接绑定到当前项目，无需重新生成。' });
        hint.style.fontSize = '0.85em';
        hint.style.opacity = '0.8';

        const select = contentEl.createEl('select', { cls: 'nw-input novel-writer-input dropdown' });
        for (const candidate of candidates) {
            select.createEl('option', { value: candidate.path, text: candidate.name });
        }

        const bindButton = contentEl.createEl('button', { text: '绑定所选文件', cls: 'nw-btn novel-writer-secondary-button' });
        bindButton.onclick = async () => {
            const path = select.value;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) {
                new Notice('❌ 文件不存在，可能已被移动或删除', 6000);
                return;
            }
            let content = '';
            try {
                content = await this.app.vault.read(file);
            } catch {
                new Notice('❌ 读取设定文件失败', 6000);
                return;
            }
            if (!content.trim()) {
                new Notice('❌ 设定文件为空，无法绑定', 6000);
                return;
            }

            await attachFanficPathToProject(this.app, project, path);
            const check = isFanficSettingsContentValidEnough(content);
            if (check.valid) {
                new Notice(`✅ 已绑定「${file.basename}」到项目「${project}」`, 6000);
            } else {
                new Notice(`⚠️ 已绑定「${file.basename}」，但缺少：${check.missingFields.slice(0, 5).join('、')}。建议补全后保存。`, 10000);
            }
            this.close();
        };
    }

    private async generateFanficSetting(workName: string, workType: string, author: string): Promise<void> {
        if (!this.plugin.hasAiCredentials) {
            new Notice('❌ 请先配置 API 密钥或本地模型端点', 5000);
            return;
        }

        if (this.generateButton) {
            this.originalButtonText = this.generateButton.textContent || '';
            this.generateButton.disabled = true;
            this.generateButton.textContent = '⏳ 生成中...';
        }
        const genNotice = new Notice(`⏳ 正在生成《${workName}》的世界观设定...`, 0);

        try {
            // 用与向导保存完全相同的骨架（单一结构来源），避免「提示词一套、校验器另一套」
            const skeleton = buildFanficSettingsContent({
                workName,
                workType: workType || '（待补充）',
                author: author || '未知',
                worldviewType: '（待补充）',
                powerSystem: '（待补充）',
                coreRules: '（待补充）',
                mustFollow: '（待补充）',
                adaptScope: '（待补充）',
                redlines: '（待补充）',
            });

            const systemPrompt = `你是一个资深的小说设定整理专家。请根据作品名称，生成一份可直接用于同人创作的原作设定文件。

【输出要求】
1. 严格保留下面骨架的 YAML frontmatter 键名、二级标题、加粗字段名和两张表格的列名，不得增删或改名。
2. 把所有「（待补充）」替换为准确的原作信息；不确定的内容写「待补充」，不要编造。
3. 「原作剧情时间线」与「故事背景时间线」两张表格各至少写 2 行真实数据（不要只留占位行）。
4. 三条创作规则必须写成单行完整句子，分别说明：必须遵守什么、允许改编到什么范围、绝对禁止触碰什么。
5. 只输出完整文件内容，不要输出解释或代码块围栏。

【文件骨架】
${skeleton}`;

            const userContent = `请为《${workName}》生成详细的世界观设定文件。${author ? `作者是${author}。` : ""}`;

            const result = await this.aiEngine.callAI(systemPrompt, userContent, undefined, 0.7, 8192);

            if (result.error) {
                new Notice(`❌ ${result.error}`, 12000);
                return;
            }

            // 完整性校验：不完整先补全一次，仍不完整则拒绝落盘
            let content = result.content;
            const firstCheck = validateFanficSettings(content);
            if (!firstCheck.valid) {
                const repairPrompt = `下面这份同人设定缺少以下字段：${firstCheck.missingFields.join('、')}。
请在不改变已有内容的前提下补全缺失字段，保持原有 Markdown 结构与 YAML frontmatter，只输出完整文件内容，不要输出解释。

${content}`;
                const repaired = await this.aiEngine.callAI(systemPrompt, repairPrompt, undefined, 0.4, 8192);
                if (!repaired.error && repaired.content.trim()) content = repaired.content;
            }
            const finalCheck = validateFanficSettings(content);
            if (!finalCheck.valid) {
                new Notice(`❌ 同人设定内容不完整，缺少：${finalCheck.missingFields.slice(0, 5).join('、')}。未保存，请重试。`, 12000);
                return;
            }

            const targetDir = this.project ? pjFanficDir(this.project) : '元文件/05-同人设定库';
            await mkdirp(this.app, targetDir);

            const safeName = workName.replace(/[\\/:*?"<>|]/g, "_").trim();
            const filePath = `${targetDir}/${safeName}设定.md`;

            const existingSetting = this.app.vault.getAbstractFileByPath(filePath);
            if (existingSetting) {
                const overwrite = window.confirm(`「${safeName}设定.md」已存在，覆盖？`);
                if (!overwrite) return;
            }

            // 覆盖走 modify，不 delete + create：中间态失败会既丢旧设定、又让 .project 指向空路径
            await saveFanficSettingFile(this.app, filePath, content);

            if (this.project) {
                await attachFanficPathToProject(this.app, this.project, filePath);
                new Notice(`✅ 《${workName}》设定已保存并绑定到项目「${this.project}」`, 6000);
            } else {
                new Notice(`✅ 《${workName}》设定已保存到 ${targetDir}`, 6000);
            }

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
