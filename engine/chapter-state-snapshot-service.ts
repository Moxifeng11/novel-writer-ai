/**
 * chapter-state-snapshot-service.ts — 读取实体/关系/伏笔并写入每章状态快照
 */
import { App, TFile } from 'obsidian';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { entityDir } from '@/shared/entity-reader';
import {
    pjCharsDir,
    pjForeshadowDB,
    pjChapterStateSnapshot,
    pjChapterStateSnapshotDir,
    pjPromiseLedger,
} from '@/shared/paths';
import { loadRelationshipStates, type CharacterPairRelation } from './relationship-engine';
import { parseSceneBlocks, type SceneTask } from './scene-generation-loop';
import {
    buildChapterWorldStateSnapshot,
    formatChapterStateSnapshot,
    type ChapterWorldStateSnapshot,
    type CharacterWorldState,
    type RelationshipWorldState,
} from './world-state-snapshot';
import { parsePromiseLedger } from './promise-ledger';
import { createLogger } from '@/shared/logger';

const log = createLogger('ChapterStateSnapshot');

/**
 * 写入章节快照输入结构定义。
 */
export interface WriteChapterSnapshotInput {
    project: string;
    chapterNum: number;
    chapterName: string;
    bodyText?: string;
    sceneExpansion?: string;
    updatedChars?: string[];
    openPromises?: string[];
}

function asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') {
        return value.split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
    }
    return [];
}

function readInvolvedChars(app: App, project: string, chapterNum: number): string[] {
    const files = app.vault.getFiles().filter(f =>
        f.path.startsWith(`${project}/03-大纲与章节/正文/`) && f.name.includes(`第${chapterNum}章`),
    );
    for (const file of files) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm) {
            const names = asStringArray(fm['涉及人物']);
            if (names.length > 0) return names;
        }
    }
    return [];
}

function readCharacterStates(app: App, project: string): CharacterWorldState[] {
    const dir = `${entityDir(project, 'characters')}/`;
    return app.vault.getFiles()
        .filter(f => f.path.startsWith(dir) && f.extension === 'md')
        .map(file => {
            const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
            const name = String(fm['姓名'] || fm['name'] || file.basename || '').trim();
            return {
                name,
                status: String(fm['当前状态'] || fm['entity_status'] || '未知'),
                emotion: String(fm['当前情绪'] || ''),
                location: String(fm['当前位置'] || ''),
                goal: String(fm['当前目标'] || fm['核心动机'] || ''),
                knows: asStringArray(fm['已知信息'] || fm['当前认知']),
                injuries: String(fm['伤势'] || ''),
                items: String(fm['持有物品'] || ''),
            };
        })
        .filter(c => c.name);
}

function readUnresolvedForeshadowsAsync(app: App, project: string): Promise<string[]> {
    return (async () => {
        const file = app.vault.getAbstractFileByPath(pjForeshadowDB(project));
        if (!(file instanceof TFile)) return [];
        try {
            const content = await app.vault.read(file);
            const section = content.split(/^##\s*已回收伏笔/m)[0];
            const names: string[] = [];
            for (const line of section.split('\n')) {
                const m = line.match(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/);
                if (!m) continue;
                const name = m[1].trim();
                if (name && !name.includes('伏笔名称') && !name.includes('---')) names.push(name);
            }
            return Array.from(new Set(names)).slice(0, 15);
        } catch (e) {
            log.warn('[ChapterStateSnapshot] 读取伏笔库失败:', e);
            return [];
        }
    })();
}

function mapRelationships(relations: CharacterPairRelation[]): RelationshipWorldState[] {
    return relations.map(r => ({
        a: r.charA,
        b: r.charB,
        trust: r.state.trust,
        attraction: r.state.attraction,
        fear: r.state.fear,
        resentment: r.state.resentment,
        dependence: r.state.dependence,
        status: r.state.status,
    }));
}

async function readOpenPromises(app: App, project: string): Promise<string[]> {
    const file = app.vault.getAbstractFileByPath(pjPromiseLedger(project));
    if (!(file instanceof TFile)) return [];
    try {
        const items = parsePromiseLedger(await app.vault.read(file));
        return items
            .filter(i => i.status === 'open' || i.status === 'advanced')
            .map(i => `${i.name}${i.expectedChapter ? `（预期${i.expectedChapter}）` : ''}`)
            .slice(0, 10);
    } catch {
        return [];
    }
}

/**
 * writeChapterStateSnapshot 函数。
 * @param app - Obsidian 应用实例
 * @param input - 输入
  * @returns ChapterWorldStateSnapshot 或 null
 */
export async function writeChapterStateSnapshot(
    app: App,
    input: WriteChapterSnapshotInput,
): Promise<ChapterWorldStateSnapshot | null> {
    if (!input.project || !Number.isFinite(input.chapterNum) || input.chapterNum <= 0) return null;
    if (!app?.vault?.getFiles) return null;
    try {
        const scenes: SceneTask[] = input.sceneExpansion ? parseSceneBlocks(input.sceneExpansion) : [];
        const entityStates = readCharacterStates(app, input.project);
        const relationships = mapRelationships(await loadRelationshipStates(app, input.project));
        const unresolvedForeshadows = await readUnresolvedForeshadowsAsync(app, input.project);
        const openPromises = input.openPromises && input.openPromises.length > 0
            ? input.openPromises
            : await readOpenPromises(app, input.project);
        const involvedFromBody = readInvolvedChars(app, input.project, input.chapterNum);
        const updatedChars = Array.from(new Set([
            ...(input.updatedChars || []),
            ...involvedFromBody,
        ]));

        const snapshot = buildChapterWorldStateSnapshot({
            chapterNum: input.chapterNum,
            chapterName: input.chapterName,
            scenes,
            entityStates,
            relationships,
            openPromises: openPromises,
            unresolvedForeshadows,
            updatedChars,
        });

        const markdown = formatChapterStateSnapshot(snapshot);
        const fs = new ObsidianFileSystem(app);
        const dir = pjChapterStateSnapshotDir(input.project);
        if (!(await fs.exists(dir))) await fs.mkdir(dir);
        await fs.write(pjChapterStateSnapshot(input.project, input.chapterNum), markdown);
        log.info(`[ChapterStateSnapshot] 已写入第${input.chapterNum}章状态快照`);
        return snapshot;
    } catch (e) {
        log.warn('[ChapterStateSnapshot] 生成章节状态快照失败（不影响结算）:', e);
        return null;
    }
}
