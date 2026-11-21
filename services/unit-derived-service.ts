/**
 * unit-derived-service.ts — 短篇/剧本派生视图生成（M8/M9）
 *
 * 方向：**单元文件是唯一真源**（每节/每集一个文件），
 * 分节大纲 / 分集大纲由单元文件解析后重新生成（派生视图，请勿手改）。
 */

import { App, TFile, TFolder } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { modeBodyDir, modeDocPath } from '@/shared/mode-content';
import type { CreationMode } from '@/shared/creation-mode';
import {
    parseScriptEpisodeBody,
    parseShortUnitBody,
    renderScriptOutline,
    renderShortUnitOutline,
    type ScriptEpisodeCard,
    type ScriptSceneCard,
    type ShortUnitCard,
} from '@/shared/unit-card-model';

const log = createLogger('UnitDerived');

/** 生成结果 */
export interface UnitDerivedResult {
    dryRun: boolean;
    /** 模式 */
    mode: CreationMode;
    /** 参与生成的单元数 */
    units: number;
    /** 解析出的场数（仅剧本） */
    scenes: number;
    /** 写入的派生文件 */
    derivedPath: string;
    /** 备份文件 */
    backups: string[];
    /** 失败项 */
    failures: Array<{ path: string; reason: string }>;
    /** 摘要 */
    summary: string;
}

/**
 * 单元派生视图服务。
 */
export class UnitDerivedService {
    /**
     * @param app - Obsidian 应用
     */
    constructor(private readonly app: App) {}

    /**
     * 由单元文件生成派生大纲。
     *
     * @param project - 项目路径
     * @param mode - 创作模式（short/script）
     * @param dryRun - 是否只预览
     * @returns 结果
     */
    async generate(project: string, mode: 'short' | 'script', dryRun = true): Promise<UnitDerivedResult> {
        const derivedPath = modeDocPath(project, mode, 'outline');
        const files = this.listUnits(project, mode);
        const failures: UnitDerivedResult['failures'] = [];
        let content = '';
        let scenes = 0;

        if (mode === 'short') {
            const cards: ShortUnitCard[] = [];
            for (const file of files) {
                try {
                    const text = await this.readText(file.path);
                    cards.push(parseShortUnitBody(text, this.unitIndex(file.name)));
                } catch (error) {
                    failures.push({ path: file.path, reason: String(error) });
                }
            }
            cards.sort((a, b) => a.index - b.index);
            content = cards.length > 0 ? renderShortUnitOutline(cards) : '';
        } else {
            const episodes: ScriptEpisodeCard[] = [];
            const sceneCards: ScriptSceneCard[] = [];
            for (const file of files) {
                try {
                    const text = await this.readText(file.path);
                    const parsed = parseScriptEpisodeBody(text, this.unitIndex(file.name));
                    episodes.push(parsed.episode);
                    sceneCards.push(...parsed.scenes);
                } catch (error) {
                    failures.push({ path: file.path, reason: String(error) });
                }
            }
            episodes.sort((a, b) => a.index - b.index);
            scenes = sceneCards.length;
            content = episodes.length > 0 ? renderScriptOutline(episodes, sceneCards) : '';
        }

        const summary = `单元 ${files.length} 个${mode === 'script' ? `，场 ${scenes} 场` : ''}${content ? '' : '（没有可解析的单元文件）'}`;
        if (dryRun || !content) {
            return { dryRun: true, mode: mode as CreationMode, units: files.length, scenes, derivedPath, backups: [], failures, summary };
        }

        const backups: string[] = [];
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const existing = await this.readText(derivedPath);
        if (existing) {
            const backup = `${project}/_versions/migration/${stamp}/${derivedPath.split('/').pop() ?? 'outline.md'}`;
            try {
                await this.writeFile(backup, existing);
                backups.push(backup);
            } catch (error) {
                failures.push({ path: backup, reason: String(error) });
            }
        }
        try {
            await this.writeFile(derivedPath, content);
        } catch (error) {
            failures.push({ path: derivedPath, reason: String(error) });
        }
        log.info(`派生视图生成完成：${mode}，单元 ${files.length}，备份 ${backups.length}`);
        return { dryRun: false, mode: mode as CreationMode, units: files.length, scenes, derivedPath, backups, failures, summary };
    }

    /** 列出单元文件（按文件名排序） */
    private listUnits(project: string, mode: 'short' | 'script'): TFile[] {
        const dir = modeBodyDir(project, mode);
        const folder = this.app.vault.getAbstractFileByPath(dir);
        if (!(folder instanceof TFolder)) return [];
        return folder.children
            .filter((child): child is TFile => child instanceof TFile && child.extension === 'md')
            .sort((a, b) => a.basename.localeCompare(b.basename, 'zh-Hans-CN'));
    }

    /** 从文件名取单元序号（第NN节/第NN集） */
    private unitIndex(name: string): number {
        const match = name.match(/第\s*(\d+)\s*[节集]/);
        return match ? Number(match[1]) : 0;
    }

    /** 读文本 */
    private async readText(path: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return '';
        try {
            return await this.app.vault.read(file);
        } catch { // silent-ok: 读失败按空处理
            return '';
        }
    }

    /** 写文件（自动建目录） */
    private async writeFile(path: string, content: string): Promise<void> {
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) await this.app.vault.modify(existing, content);
        else await this.app.vault.create(path, content);
    }
}
