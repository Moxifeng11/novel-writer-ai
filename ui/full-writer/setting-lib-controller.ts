/**
 * 设定库自动填充控制器（v3.4.x 设定库一键生成）
 *
 * 从 FullWriterView 外迁而来：原 populateSettingLib 方法。
 * 控制器持有 app / plugin / getProject 访问器与 refresh 回调，
 * 不回调 view 的 private 成员（避免 TS2341）。
 */
import { App, Notice, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { getWorldviewPath, getSettingLibPath } from '../../shared/paths';

export class SettingLibController {
    private app: App;
    private plugin: NovelWriterPlugin;
    private getProject: () => string | undefined;
    private refresh: () => Promise<void>;

    constructor(
        app: App,
        plugin: NovelWriterPlugin,
        getProject: () => string | undefined,
        refresh: () => Promise<void>,
    ) {
        this.app = app;
        this.plugin = plugin;
        this.getProject = getProject;
        this.refresh = refresh;
    }

    async populateSettingLib(): Promise<void> {
        const project = this.getProject();
        if (!project) {
            new Notice('请先选择项目');
            return;
        }
        const engine = this.plugin.aiEngine;
        if (!engine) {
            new Notice('AI 引擎未初始化');
            return;
        }
        const wvPath = getWorldviewPath(project);
        let worldviewContent = '';
        try {
            const wvFile = this.app.vault.getAbstractFileByPath(wvPath);
            if (wvFile) worldviewContent = await this.app.vault.read(wvFile as TFile);
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
        if (!worldviewContent.trim()) {
            new Notice('世界观总览为空，请先生成世界观');
            return;
        }
        const slPath = getSettingLibPath(project);
        let slContent = '';
        try {
            const slFile = this.app.vault.getAbstractFileByPath(slPath);
            if (slFile) slContent = await this.app.vault.read(slFile as TFile);
        } catch (e) { console.warn('[小说工坊] 操作失败:', e); }
        const progressNotice = new Notice('⏳ 正在生成设定库...', 0);
        const systemPrompt = `你是一位资深网络小说设定师。请根据提供的世界观总览，**完整填充**设定库文件的所有章节。

设定库共8个章节，必须**逐章详细填充**，不得跳过任何章节：

## 一、世界观底层规则
- 物理法则：详细描述这个世界的物理/魔法法则与现实的差异（至少3项具体规则）
- 力量本源：力量来自何处，运作机制是怎样的（200字以上）
- 等级/阶位体系：完整的修炼/能力等级序列（表格：等级 | 特征 | 能力表现）

## 二、核心设定（不可变更）
- 世界观基调与类型：风格+题材+受众定位
- 主角金手指：名称、来源、核心能力、限制条件
- 主角核心目标：最终要达成什么，阶段性目标
- 全书核心悬念：最大的谜题/冲突

## 三、力量体系详情
- 各等级能力表现：填满表格（等级 | 能力描述 | 代表人物 | 突破条件）
- 特殊能力/功法/技能：列出至少5项，含名称 | 类型 | 效果 | 限制
- 力量体系与世界观逻辑自洽说明

## 四、科技水平
- 科技发展程度（具体技术列举）
- 与力量体系的关系（互补/冲突/融合）

## 五、势力分布
- 填满势力表格（势力名称 | 立场 | 核心目标 | 实力评估 | 与主角关系）
- 列出至少5个势力

## 六、地理/区域
- 填满区域表格（区域名称 | 特征 | 重要性 | 危险等级）

## 七、关键历史事件（故事开始前）
- 至少3件塑造了当前世界格局的历史事件，含时间和影响

## 八、当前故事阶段
- 主角当前所在位置、目标、面临的主要矛盾

**强制规则：**
1. 保留已有非占位符内容不变
2. 所有 <!-- ... --> 注释必须替换为具体内容，并删除注释符号
3. 所有空表格必须填充
4. 每个章节至少填充200字具体内容
5. 内容必须与世界观总览高度一致，不得编造矛盾设定
6. 输出完整的设定库 Markdown 文件（含所有8个章节标题和结构）
7. 不要输出任何开场白或结束语，直接输出设定库内容`;
        const userPrompt = `请根据以下世界观总览填充设定库：

=== 世界观总览 ===
${worldviewContent}

=== 当前设定库（保留已有内容，仅填充占位符和空表格） ===
${slContent}`;
        try {
            const result = await engine.callAI(
                systemPrompt,
                userPrompt,
                this.plugin.settings.flashModel,
                0.3,
                this.plugin.settings.maxOutput
            );
            if (result.error) {
                progressNotice.hide();
                new Notice(`设定库生成失败: ${result.error}`);
                return;
            }
            if (!result || !result.content?.trim()) {
                progressNotice.hide();
                new Notice('设定库生成失败：AI 返回为空');
                return;
            }
            const slFile = this.app.vault.getAbstractFileByPath(slPath);
            if (slFile) {
                await this.app.vault.modify(slFile as TFile, result.content);
            } else {
                await this.app.vault.create(slPath, result.content);
            }
            progressNotice.hide();
            new Notice('✅ 设定库生成完成');
            await this.refresh();
        } catch (e: any) {
            progressNotice.hide();
            new Notice(`设定库生成失败: ${e.message || e}`);
        }
    }
}
