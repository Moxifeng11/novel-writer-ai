/**
 * 设定库自动填充控制器（v3.4.x 设定库一键生成）
 *
 * 从 FullWriterView 外迁而来：原 populateSettingLib 方法。
 * 控制器持有 app / plugin / getProject 访问器与 refresh 回调，
 * 不回调 view 的 private 成员（避免 TS2341）。
 */
import { App, Notice } from 'obsidian';
import NovelWriterPlugin from '@/main';

/**
 * SettingLibController 类。
 */
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

    /**
     * populateSettingLib 方法。
     */
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
        const progressNotice = new Notice('⏳ 正在生成设定库...', 0);
        try {
            const content = await engine.generateSettingLibForProject(this.app, project);
            if (!content || !content.trim()) {
                progressNotice.hide();
                new Notice('设定库生成失败：AI 返回为空');
                return;
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
