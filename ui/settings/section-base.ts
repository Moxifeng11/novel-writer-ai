/**
 * section-base.ts — 设置页各分区模块的共享基类
 *
 * 背景：`ui/settings-tab.ts` 原有 5,000+ 行、57 个方法。按 tab 分区拆成
 * 独立模块后，各分区只需访问三样东西：`app`、`plugin`、以及「重绘当前 tab」。
 * 用这个基类把三样东西做成只读访问器，分区方法体即可保持原有写法
 * （`this.plugin` / `this.app` / `this.refresh()`），不必逐处改写。
 *
 * 约定：
 * - 分区入口方法统一签名 `render(container: HTMLElement): void`（异步分区返回 Promise）。
 * - 分区之间的方法调用为零；跨分区共享状态请上提到宿主 `NovelWriterSettingTab`。
 */
import type { App } from 'obsidian';
import type NovelWriterPlugin from '@/main';

/**
 * SettingsSectionHost 类型定义。
 */
export interface SettingsSectionHost {
    app: App;
    plugin: NovelWriterPlugin;
    /** 设置项变更后重绘当前 tab（等价于拆分前的 `this.renderActiveTab()`） */
    refresh(): void;
    /** 整页重开（清空 tab 缓存并重绘，等价于拆分前的 `this.display()`） */
    reopen(): void;
}

/**
 * 设置列表分区。
 */
export abstract class SettingsSection {
    /**
     * 是否为「异步加载数据」的分区（知识库 / 指纹库 / 拆解 / 伏笔）。
     *
     * 标记为 true 时，宿主会在分区顶部加统一的「数据可能过期 · 刷新」条，
     * 点击调用 host.refresh() 清缓存重绘（= 重新拉数据）。
     */
    readonly asyncLoad: boolean = false;

    constructor(protected host: SettingsSectionHost) {}

    /**
     * 渲染当前分区到容器（两个宿主统一契约）。
     *
     * @param container - 目标容器
     * @returns 无或异步完成
     */
    abstract render(container: HTMLElement): void | Promise<void>;

    protected get app(): App {
        return this.host.app;
    }

    protected get plugin(): NovelWriterPlugin {
        return this.host.plugin;
    }

    protected refresh(): void {
        this.host.refresh();
    }

    protected reopen(): void {
        this.host.reopen();
    }
}
