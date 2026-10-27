/**
 * synopsis-store.ts — 全书简介多版本存储
 *
 * 目录：04-项目总控/全书简介/{index.json, v001_悬念型.md, 草稿.md}
 * 兼容：04-项目总控/全书简介.md 始终保存“当前采用版本”，旧项目首次打开会自动导入。
 */
import { App } from 'obsidian';
import {
    pjControlDir,
    pjSynopsisAdoptedFile,
    pjSynopsisDir,
    pjSynopsisDraftFile,
    pjSynopsisIndexFile,
    pjSynopsisVersionFile,
} from '../shared/paths';
import { countChars, SynopsisStyle, SynopsisVariant, styleLabel } from '../shared/synopsis-spec';
import { createLogger } from '../shared/logger';

const log = createLogger('SynopsisStore');
const MAX_VERSIONS = 20;

export interface SynopsisVersionMeta {
    id: string;
    style: SynopsisStyle;
    title: string;
    fileName: string;
    createdAt: number;
    charCount: number;
    model?: string;
}

export interface SynopsisIndex {
    version: 1;
    activeId: string;
    items: SynopsisVersionMeta[];
}

export interface SynopsisVersion extends SynopsisVersionMeta {
    text: string;
}

export interface SynopsisSnapshot {
    index: SynopsisIndex;
    versions: SynopsisVersion[];
    draft: string;
}

export class SynopsisStore {
    constructor(private readonly app: App) {}

    async load(project: string): Promise<SynopsisSnapshot> {
        await this.importLegacy(project);
        const index = await this.readIndex(project);
        const versions: SynopsisVersion[] = [];
        for (const item of index.items) {
            const text = await this.readVersionText(project, item);
            if (text !== null) versions.push({ ...item, text });
        }
        return {
            index,
            versions,
            draft: await this.readDraft(project),
        };
    }

    async saveVariant(
        project: string,
        variant: SynopsisVariant,
        options: { model?: string; activate?: boolean } = {},
    ): Promise<SynopsisVersionMeta> {
        const index = await this.readIndex(project);
        if (index.items.length >= MAX_VERSIONS) {
            throw new Error(`全书简介最多保留 ${MAX_VERSIONS} 个版本，请先删除旧版本`);
        }
        const id = this.nextId(index);
        const fileName = `${id}_${styleLabel(variant.style)}.md`;
        const createdAt = Date.now();
        const meta: SynopsisVersionMeta = {
            id,
            style: variant.style,
            title: variant.title || `${styleLabel(variant.style)}版`,
            fileName,
            createdAt,
            charCount: variant.wordCount || countChars(variant.text),
            model: options.model,
        };
        await this.writeVersion(project, meta, variant.text);
        index.items.unshift(meta);
        if (options.activate) index.activeId = id;
        await this.writeIndex(project, index);
        if (options.activate) await this.adopt(project, id);
        return meta;
    }

    async updateVariantText(project: string, id: string, text: string, title?: string): Promise<void> {
        const index = await this.readIndex(project);
        const item = index.items.find(entry => entry.id === id);
        if (!item) throw new Error('简介版本不存在');
        item.charCount = countChars(text);
        if (title !== undefined) item.title = title;
        await this.writeVersion(project, item, text);
        await this.writeIndex(project, index);
        if (index.activeId === id) await this.writeAdopted(project, item, text);
    }

    async saveDraft(project: string, text: string): Promise<void> {
        await this.ensureDir(project);
        const content = `---
tags: [简介, 草稿]
更新时间: ${new Date().toISOString()}
字数: ${countChars(text)}
---

${text.trim()}
`;
        await this.adapter().write(pjSynopsisDraftFile(project), content);
    }

    async readDraft(project: string): Promise<string> {
        try {
            const adapter = this.adapter();
            const path = pjSynopsisDraftFile(project);
            if (!(await adapter.exists(path))) return '';
            return stripFrontmatter(await adapter.read(path));
        } catch {
            return '';
        }
    }

    async setActive(project: string, id: string): Promise<void> {
        const index = await this.readIndex(project);
        const item = index.items.find(entry => entry.id === id);
        if (!item) throw new Error('简介版本不存在');
        index.activeId = id;
        await this.writeIndex(project, index);
        await this.adopt(project, id);
    }

    async deleteVersion(project: string, id: string): Promise<void> {
        const index = await this.readIndex(project);
        const item = index.items.find(entry => entry.id === id);
        if (!item) return;
        const adapter = this.adapter();
        const path = pjSynopsisVersionFile(project, item.id);
        if (await adapter.exists(path)) await adapter.remove(path);
        index.items = index.items.filter(entry => entry.id !== id);
        if (index.activeId === id) {
            index.activeId = index.items[0]?.id || '';
            if (index.activeId) await this.adopt(project, index.activeId);
        }
        await this.writeIndex(project, index);
    }

    async adopt(project: string, id: string): Promise<void> {
        const index = await this.readIndex(project);
        const item = index.items.find(entry => entry.id === id);
        if (!item) throw new Error('简介版本不存在');
        const text = await this.readVersionText(project, item);
        if (text === null) throw new Error('简介版本文件不存在');
        await this.writeAdopted(project, item, text);
    }

    private async importLegacy(project: string): Promise<void> {
        const adapter = this.adapter();
        const index = await this.readIndex(project);
        if (index.items.length > 0) return;
        const legacyPath = pjSynopsisAdoptedFile(project);
        if (!(await adapter.exists(legacyPath))) return;
        const text = stripFrontmatter(await adapter.read(legacyPath)).trim();
        if (!text) return;
        const id = 'v001';
        const meta: SynopsisVersionMeta = {
            id,
            style: 'hook',
            title: '旧版全书简介',
            fileName: `${id}_悬念型.md`,
            createdAt: Date.now(),
            charCount: countChars(text),
        };
        await this.writeVersion(project, meta, text);
        index.items = [meta];
        index.activeId = id;
        await this.writeIndex(project, index);
        log.info('[SynopsisStore] 已把旧版全书简介导入多版本目录');
    }

    private async readIndex(project: string): Promise<SynopsisIndex> {
        try {
            const adapter = this.adapter();
            const path = pjSynopsisIndexFile(project);
            if (!(await adapter.exists(path))) return { version: 1, activeId: '', items: [] };
            const parsed = JSON.parse(await adapter.read(path)) as SynopsisIndex;
            if (!Array.isArray(parsed.items)) return { version: 1, activeId: '', items: [] };
            return { version: 1, activeId: parsed.activeId || '', items: parsed.items };
        } catch (error) {
            log.warn('[SynopsisStore] 读取索引失败，按空索引处理:', error);
            return { version: 1, activeId: '', items: [] };
        }
    }

    private async writeIndex(project: string, index: SynopsisIndex): Promise<void> {
        await this.ensureDir(project);
        await this.adapter().write(pjSynopsisIndexFile(project), JSON.stringify(index, null, 2));
    }

    private async writeVersion(project: string, meta: SynopsisVersionMeta, text: string): Promise<void> {
        await this.ensureDir(project);
        const content = `---
tags: [简介, 全书]
版本: ${meta.id}
风格: ${styleLabel(meta.style)}
生成时间: ${new Date(meta.createdAt).toISOString()}
字数: ${meta.charCount}
${meta.model ? `模型: ${meta.model}\n` : ''}---

# 全书简介 · ${styleLabel(meta.style)}

${text.trim()}
`;
        await this.adapter().write(pjSynopsisVersionFile(project, meta.id), content);
    }

    private async readVersionText(project: string, meta: SynopsisVersionMeta): Promise<string | null> {
        try {
            const path = pjSynopsisVersionFile(project, meta.id);
            const adapter = this.adapter();
            if (!(await adapter.exists(path))) return null;
            return stripFrontmatter(await adapter.read(path));
        } catch {
            return null;
        }
    }

    private async writeAdopted(project: string, meta: SynopsisVersionMeta, text: string): Promise<void> {
        const content = `---
tags: [简介, 全书]
采用版本: ${meta.id}
风格: ${styleLabel(meta.style)}
更新时间: ${new Date().toISOString()}
字数: ${meta.charCount}
---

# 全书简介

${text.trim()}
`;
        await this.adapter().write(pjSynopsisAdoptedFile(project), content);
    }

    private nextId(index: SynopsisIndex): string {
        const max = index.items.reduce((value, item) => {
            const num = parseInt(item.id.replace(/^v/i, ''), 10);
            return Number.isFinite(num) ? Math.max(value, num) : value;
        }, 0);
        return `v${String(max + 1).padStart(3, '0')}`;
    }

    private async ensureDir(project: string): Promise<void> {
        const adapter = this.adapter();
        const control = pjControlDir(project);
        if (!(await adapter.exists(control))) await adapter.mkdir(control);
        const dir = pjSynopsisDir(project);
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    }

    private adapter() {
        return this.app.vault.adapter;
    }
}

function stripFrontmatter(content: string): string {
    return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}