/**
 * fact-store-modal.ts — 事实库浏览视图（只读）
 *
 * 目的：事实库是结构化事实的唯一持久源，用户必须能**看见它**才谈得上信任与修正。
 * 本视图按主体分组展示事实、有效区间、原文引文与类型，并支持跳转正文。
 *
 * 修正入口：直接编辑 `<项目>/04-项目总控/一致性审核/事实库.json`（视图下方已注明路径）。
 */

import { Modal, type App } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { pjFactStoreFile } from '@/shared/paths';
import { loadFactStore } from '@/engine/consistency/fact-store';
import { listProjectIds } from '@/shared/project-catalog';
import type { FactMetadata } from '@/engine/context/knowledge-fact-nodes';
import {
    emptyStateHint,
    formatFactLine,
    formatHeader,
    formatTypeBadge,
    groupBySubject,
    isExpired,
} from './fact-store-format';

/**
 * 事实库浏览弹窗。
 */
export class FactStoreModal extends Modal {
    private facts: FactMetadata[] = [];
    private warnings: string[] = [];

    /**
     * @param app - Obsidian 应用
     * @param plugin - 插件实例
     */
    constructor(
        app: App,
        private plugin: NovelWriterPlugin,
    ) {
        super(app);
    }

    /**
     * 打开时加载事实库并渲染。
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('nw-fact-store-modal');
        contentEl.createEl('h2', { text: '📚 知识库事实库' });
        const body = contentEl.createDiv({ cls: 'nw-fact-store-body' });
        body.setText('正在加载事实库…');
        void this.render(body);
    }

    /**
     * 加载并渲染。
     *
     * @param body - 容器
     */
    private async render(body: HTMLElement): Promise<void> {
        const project = this.resolveProject();
        body.empty();
        if (!project) {
            body.createEl('p', { text: '请先打开一个项目（项目内任意文件）。' });
            return;
        }
        try {
            const fs = new ObsidianFileSystem(this.app);
            const loaded = await loadFactStore(fs, pjFactStoreFile(project));
            this.facts = loaded.status === 'ok' ? loaded.store.facts : [];
            this.warnings = loaded.status === 'read-failed'
                ? [`事实库不可读：${loaded.error ?? '未知错误'}`]
                : [];
        } catch (error) {
            this.facts = [];
            this.warnings = [`事实库读取异常：${error instanceof Error ? error.message : String(error)}`];
        }

        body.createEl('p', { text: `项目：${project} ｜ ${formatHeader(this.facts)}` });
        for (const warning of this.warnings) {
            body.createEl('p', { text: `⚠️ ${warning}`, cls: 'nw-fact-warning' });
        }
        if (this.facts.length === 0) {
            body.createEl('p', { text: emptyStateHint() });
            body.createEl('p', { text: `文件位置：${pjFactStoreFile(project)}`, cls: 'nw-fact-path' });
            return;
        }

        const list = body.createDiv({ cls: 'nw-fact-groups' });
        for (const group of groupBySubject(this.facts)) {
            const section = list.createDiv({ cls: 'nw-fact-group' });
            section.createEl('h3', { text: `${group.subject}（${group.facts.length}）` });
            const ul = section.createEl('ul');
            for (const fact of group.facts) {
                const li = ul.createEl('li');
                li.createSpan({ text: `第${fact.chapter}章 `, cls: 'nw-fact-chapter' });
                li.createSpan({ text: `[${formatTypeBadge(fact.type)}] `, cls: 'nw-fact-type' });
                li.createSpan({ text: formatFactLine(fact), cls: isExpired(fact, 0) ? 'nw-fact-expired' : '' });
                if (fact.quote) {
                    li.createEl('div', { text: `「${fact.quote.slice(0, 60)}」`, cls: 'nw-fact-quote' });
                }
            }
        }
        body.createEl('p', { text: `文件位置：${pjFactStoreFile(project)}（可直接编辑修正）`, cls: 'nw-fact-path' });
    }

    /**
     * 解析当前项目（无活动文件时回退到唯一项目）。
     *
     * @returns 项目路径或 null
     */
    private resolveProject(): string | null {
        const direct = this.plugin.getActiveProject();
        if (direct) return direct;
        try {
            const ids = listProjectIds(this.app);
            if (ids.length === 1) return ids[0];
        } catch {
            // silent-ok: 项目列表不可用按"无项目"处理，视图显示引导文案
        }
        return null;
    }

    /**
     * 关闭时清理。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
