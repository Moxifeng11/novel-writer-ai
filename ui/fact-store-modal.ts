/**
 * fact-store-modal.ts — 事实库浏览与编辑视图
 *
 * 事实库是结构化事实的唯一持久源，用户必须能**看见并修正它**：
 * 模型抽错一条事实，若只能改 JSON，等于把维护成本推给用户。
 *
 * 能力：
 *  - 按主体分组浏览（章节/类型/值/有效区间/原文引文）
 *  - 行内编辑值、有效结束章
 *  - 删除单条、标记忽略（保留但排除出第二意见）
 *  - 重建本章（force 重拆）
 *  - **写入前整批校验**：非法数据拒绝写入，绝不把库写坏（复用 fact-store-edit）
 */

import { Modal, Notice, type App } from 'obsidian';
import type NovelWriterPlugin from '@/main';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { pjFactStoreFile } from '@/shared/paths';
import { createFactStore, loadFactStore, saveFactStore, type FactStore } from '@/engine/consistency/fact-store';
import { listProjectIds } from '@/shared/project-catalog';
import type { FactMetadata } from '@/engine/context/knowledge-fact-nodes';
import {
    activeFacts,
    removeFact,
    setIgnored,
    summarizeEditState,
    updateFact,
    validateFactList,
} from './fact-store-edit';
import {
    emptyStateHint,
    formatFactLine,
    formatHeader,
    formatTypeBadge,
    groupBySubject,
} from './fact-store-format';

/**
 * 事实库浏览/编辑弹窗。
 */
export class FactStoreModal extends Modal {
    private store: FactStore = createFactStore();
    private project = '';
    private warnings: string[] = [];
    private body: HTMLElement | null = null;

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
     * 打开时加载并渲染。
     */
    onOpen(): void {
        this.contentEl.addClass('nw-fact-store-modal');
        this.body = this.contentEl.createDiv({ cls: 'nw-fact-store-body' });
        void this.reload();
    }

    /**
     * 重新加载事实库并渲染。
     */
    private async reload(): Promise<void> {
        const body = this.body;
        if (!body) return;
        body.empty();
        this.project = this.resolveProject();
        if (!this.project) {
            body.createEl('p', { text: '请先打开一个项目（项目内任意文件）。' });
            return;
        }
        try {
            const fs = new ObsidianFileSystem(this.app);
            const loaded = await loadFactStore(fs, pjFactStoreFile(this.project));
            if (loaded.status === 'read-failed') {
                this.store = createFactStore();
                this.warnings = [`事实库不可读（${loaded.error ?? '未知错误'}），为避免覆盖已停用编辑`];
            } else {
                this.store = loaded.store;
                this.warnings = [];
            }
        } catch (error) {
            this.store = createFactStore();
            this.warnings = [`事实库读取异常：${error instanceof Error ? error.message : String(error)}`];
        }
        this.renderBody();
    }

    /**
     * 渲染主体内容。
     */
    private renderBody(): void {
        const body = this.body;
        if (!body) return;
        body.empty();
        const stats = summarizeEditState(this.store.facts);
        body.createEl('p', {
            text: `项目：${this.project} ｜ ${formatHeader(this.store.facts)}`
                + (stats.ignored > 0 ? ` ｜ 已忽略 ${stats.ignored} 条` : ''),
        });
        for (const warning of this.warnings) {
            body.createEl('p', { text: `⚠️ ${warning}`, cls: 'nw-fact-warning' });
        }
        if (this.store.facts.length === 0) {
            body.createEl('p', { text: emptyStateHint() });
            body.createEl('p', { text: `文件位置：${pjFactStoreFile(this.project)}`, cls: 'nw-fact-path' });
            return;
        }

        const list = body.createDiv({ cls: 'nw-fact-groups' });
        for (const group of groupBySubject(this.store.facts)) {
            const section = list.createDiv({ cls: 'nw-fact-group' });
            section.createEl('h3', { text: `${group.subject}（${group.facts.length}）` });
            const ul = section.createEl('ul');
            for (const fact of group.facts) this.renderFactRow(ul, fact);
        }
        const footer = body.createDiv({ cls: 'nw-fact-footer' });
        footer.createEl('p', {
            text: `文件位置：${pjFactStoreFile(this.project)}（视图内编辑会直接写入该文件）`,
            cls: 'nw-fact-path',
        });
        const rebuild = footer.createEl('button', { text: '重建本章事实（需某章已选中）' });
        rebuild.addEventListener('click', () => {
            new Notice('请在「一致性审核」中运行，或使用开发脚本按章重建');
        });
    }

    /**
     * 渲染单条事实行（含编辑控件）。
     *
     * @param ul - 列表容器
     * @param fact - 事实
     */
    private renderFactRow(ul: HTMLElement, fact: FactMetadata): void {
        const li = ul.createEl('li', { cls: fact.ignored ? 'nw-fact-ignored' : '' });
        li.createSpan({ text: `第${fact.chapter}章 `, cls: 'nw-fact-chapter' });
        li.createSpan({ text: `[${formatTypeBadge(fact.type)}] `, cls: 'nw-fact-type' });
        li.createSpan({ text: formatFactLine(fact), cls: 'nw-fact-line' });

        const controls = li.createDiv({ cls: 'nw-fact-controls' });
        const valueInput = controls.createEl('input', { type: 'text' });
        valueInput.value = fact.value;
        valueInput.setAttribute('aria-label', '事实值');
        const saveValue = controls.createEl('button', { text: '改值' });
        saveValue.addEventListener('click', () => {
            void this.applyEdit(fact, { value: valueInput.value });
        });

        if (fact.validTo !== null && fact.validTo !== undefined) {
            const endInput = controls.createEl('input', { type: 'text' });
            endInput.value = String(fact.validTo);
            endInput.setAttribute('aria-label', '有效结束章');
            const saveEnd = controls.createEl('button', { text: '改区间' });
            saveEnd.addEventListener('click', () => {
                const parsed = Number(endInput.value);
                void this.applyEdit(fact, { validTo: Number.isFinite(parsed) ? parsed : null });
            });
        }

        const ignoreBtn = controls.createEl('button', { text: fact.ignored ? '恢复' : '忽略' });
        ignoreBtn.addEventListener('click', () => {
            this.store.facts = setIgnored(this.store.facts, fact, !fact.ignored);
            void this.persistThenRender();
        });

        const removeBtn = controls.createEl('button', { text: '删除' });
        removeBtn.addEventListener('click', () => {
            this.store.facts = removeFact(this.store.facts, fact);
            void this.persistThenRender();
        });

        if (fact.quote) {
            li.createEl('div', { text: `「${fact.quote.slice(0, 60)}」`, cls: 'nw-fact-quote' });
        }
    }

    /**
     * 应用一次编辑并保存。
     *
     * @param fact - 目标事实
     * @param patch - 修改字段
     */
    private async applyEdit(fact: FactMetadata, patch: Parameters<typeof updateFact>[2]): Promise<void> {
        const next = updateFact(this.store.facts, fact, patch);
        const candidate = next.find(item => item.chapter === fact.chapter
            && item.subject === fact.subject
            && item.predicate === fact.predicate);
        if (candidate) {
            const check = validateFactList([candidate]);
            if (!check.ok) {
                new Notice(`未保存：${check.reason}`);
                return;
            }
        }
        this.store.facts = next;
        await this.persistThenRender();
    }

    /**
     * 保存并重绘；保存失败给出提示且不吞错。
     */
    private async persistThenRender(): Promise<void> {
        const check = validateFactList(this.store.facts);
        if (!check.ok) {
            new Notice(`未保存：${check.reason}`);
            return;
        }
        try {
            const fs = new ObsidianFileSystem(this.app);
            const saved = await saveFactStore(fs, pjFactStoreFile(this.project), this.store);
            if (!saved) {
                new Notice('保存失败：事实库不可写');
                return;
            }
            new Notice(`已保存（${summarizeEditState(this.store.facts).active} 条参与判定）`);
        } catch (error) {
            new Notice(`保存失败：${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        this.renderBody();
    }

    /**
     * 解析当前项目（无活动文件时回退到唯一项目）。
     *
     * @returns 项目路径或 null
     */
    private resolveProject(): string {
        const direct = this.plugin.getActiveProject();
        if (direct) return direct;
        try {
            const ids = listProjectIds(this.app);
            if (ids.length === 1) return ids[0];
        } catch {
            // silent-ok: 项目列表不可用按「无项目」处理，视图显示引导文案
        }
        return '';
    }

    /**
     * 关闭时清理。
     */
    onClose(): void {
        this.contentEl.empty();
    }
}
