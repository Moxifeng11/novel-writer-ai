import { App, TFile } from 'obsidian';
import { splitTableCells } from '@/shared/chapter-table';
import { listEntityFiles } from '@/shared/entity-reader';
import { RE_VOLUME_HEADER, RE_CHAPTER_RANGE } from '@/shared/format-constants';
import { readMergedVolumeOutline } from '@/utils/helpers';
import { pjForeshadowDB, pjTimelineBoard, pjControlDir, pjVolumeOutlineDir } from '@/shared/paths';
import type { Notifier } from '@/shared/types';
import { NOOP_NOTIFIER } from '@/shared/types';
import { FileSystemPort, VaultMetaPort, ObsidianFileSystem, ObsidianVaultMeta } from '@/shared/file-system-port';
import { createLogger } from '@/shared/logger';
import { withWriteLock } from '@/shared/write-lock';


const log = createLogger('CrossVolumeIntegration');
// ============================================================
// 类型定义
// ============================================================

/** 人物快照条目 */
export interface CharacterSnapshot {
    姓名: string;
    当前状态: string;
    当前情绪: string;
    性格标签: string;
    核心动机: string;
    所属势力: string;
}

/** 势力快照条目 */
export interface FactionSnapshot {
    名称: string;
    地位或排名: string;
}

/** 伏笔快照条目 */
export interface ForeshadowSnapshot {
    name: string;
    importance: string;
    buryChapter: string;
    plannedReveal: string;
}

/** 时间线快照条目 */
export interface TimelineSnapshot {
    time: string;
    chapter: string;
    event: string;
}

/** 跨卷状态快照 */
export interface CrossVolumeSnapshot {
    characters: CharacterSnapshot[];
    factions: FactionSnapshot[];
    foreshadows: ForeshadowSnapshot[];
    timeline: TimelineSnapshot[];
}

// ============================================================
// CrossVolumeIntegrator
// ============================================================

/**
 * 跨卷状态集成器
 *
 * 提供跨卷写作所需的上下文快照功能：
 * - generateSnapshot：扫描项目当前状态生成 Markdown 快照
 * - getSnapshotContext：读取已生成的快照摘要
 * - isNewVolumeFirstChapter：判断章节是否为卷首章
 */
export class CrossVolumeIntegrator {
    private app: App;
    private notifier: Notifier;
    private fs: FileSystemPort | null = null;
    private vaultMeta: VaultMetaPort | null = null;

    constructor(app: App, notifier?: Notifier) {
        this.notifier = notifier || NOOP_NOTIFIER;
        this.app = app;
    }

    /** 获取 FileSystemPort 实例（懒加载） */
    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    /** 获取 VaultMetaPort 实例（懒加载） */
    private getVaultMeta(): VaultMetaPort {
        if (!this.vaultMeta) {
            this.vaultMeta = new ObsidianVaultMeta(this.app);
        }
        return this.vaultMeta;
    }

    // ============================================================
    // generateSnapshot
    // ============================================================

    /**
     * 扫描项目文件系统，生成当前卷的状态快照 Markdown
     *
     * @param project  项目根路径，如 "苍穹之痕"
     * @param volumeName 卷名称，如 "第2卷"
     * @param outputDir  快照输出目录，如 "04-项目总控"
     * @returns 生成的快照 Markdown 字符串
     */
    async generateSnapshot(project: string, volumeName: string, outputDir: string): Promise<string> {
        const [characters, factions, foreshadows, timeline] = await Promise.all([
            this.scanCharacters(project),
            this.scanFactions(project),
            this.scanForeshadows(project),
            this.scanTimeline(project),
        ]);

        const snapshot = this.buildSnapshotMarkdown(volumeName, characters, factions, foreshadows, timeline);

        // 写入快照文件
        const snapshotPath = `${outputDir}/${volumeName}_状态快照.md`;
        await this.writeFile(snapshotPath, snapshot);

        return snapshot;
    }

    // ============================================================
    // getSnapshotContext
    // ============================================================

    /**
     * 读取已有快照并返回前 2000 字符作为上下文摘要
     * 若无快照则先调用 generateSnapshot
     *
     * @param project  项目根路径
     * @param volumeName 卷名称
     * @returns 快照前 2000 字符
     */
    async getSnapshotContext(project: string, volumeName: string): Promise<string> {
        const outputDir = pjControlDir(project);
        const snapshotPath = `${outputDir}/${volumeName}_状态快照.md`;

        const existing = this.getVaultMeta().getAbstractFileByPath(snapshotPath);
        if (existing instanceof TFile) {
            const content = await this.getFS().read(snapshotPath);
            return content.slice(0, 2000);
        }

        // 不存在则生成
        const snapshot = await this.generateSnapshot(project, volumeName, outputDir);
        return snapshot.slice(0, 2000);
    }

    /**
     * 扫描项目当前状态，返回结构化快照数据（不写入文件）
     *
     * @param project 项目根路径
     * @returns 跨卷状态快照
     */
    async getSnapshotData(project: string): Promise<CrossVolumeSnapshot> {
        const [characters, factions, foreshadows, timeline] = await Promise.all([
            this.scanCharacters(project),
            this.scanFactions(project),
            this.scanForeshadows(project),
            this.scanTimeline(project),
        ]);

        return { characters, factions, foreshadows, timeline };
    }

    // ============================================================
    // isNewVolumeFirstChapter
    // ============================================================

    /**
     * 判断 currentChapterNum 是否为某个分卷的起始章节
     * （第一卷第一章不算新卷起始）
     *
     * @param project           项目根路径
     * @param currentChapterNum 当前章号
     * @returns 是否为新卷首章
     */
    async isNewVolumeFirstChapter(project: string, currentChapterNum: number): Promise<boolean> {
        // v4.0：合并读取全部分卷大纲文件，遍历各卷起始章
        const content = await readMergedVolumeOutline(this.app, project);
        if (!content) return false;

        const lines = content.split('\n');

        // 存储卷头的章节起始号
        const volumeStartChapters: number[] = [];
        let currentVolumeIndex = -1;

        for (const line of lines) {
            const volumeMatch = line.match(RE_VOLUME_HEADER);
            if (volumeMatch) {
                currentVolumeIndex++;
                continue;
            }

            if (currentVolumeIndex >= 0) {
                const rangeMatch = line.match(RE_CHAPTER_RANGE);
                if (rangeMatch) {
                    const startChapter = parseInt(rangeMatch[1], 10);
                    volumeStartChapters.push(startChapter);
                    continue;
                }
            }
        }

        // 检查当前章号是否为某个卷的起始章（跳过第一卷第一章，即 index 0, chapter 1）
        for (let i = 0; i < volumeStartChapters.length; i++) {
            const startChap = volumeStartChapters[i];
            if (startChap === currentChapterNum) {
                // 跳过第一卷第一章
                if (i === 0 && startChap === 1) continue;
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // 私有扫描方法
    // ============================================================

    /**
     * 扫描人物目录，提取 frontmatter 关键字段
     */
    private async scanCharacters(project: string): Promise<CharacterSnapshot[]> {
        const result: CharacterSnapshot[] = [];
        const files = listEntityFiles(this.app, project, 'characters');

        for (const file of files) {
            try {
                const content = await this.getFS().read(file.path);
                const fm = this.parseYamlFrontmatter(content);

                result.push({
                    姓名: fm['姓名'] || '',
                    当前状态: fm['当前状态'] || '',
                    当前情绪: fm['当前情绪'] || '',
                    性格标签: fm['性格标签'] || '',
                    核心动机: fm['核心动机'] || '',
                    所属势力: fm['所属势力'] || '',
                });
            } catch (e) {
                log.warn(`[CrossVolumeIntegrator] 无法读取人物文件: ${file.path}`, e);
            }
        }

        return result;
    }

    /**
     * 扫描势力目录，提取名称与地位/排名
     */
    private async scanFactions(project: string): Promise<FactionSnapshot[]> {
        const result: FactionSnapshot[] = [];
        const files = listEntityFiles(this.app, project, 'factions');

        for (const file of files) {
            try {
                const content = await this.getFS().read(file.path);
                const fm = this.parseYamlFrontmatter(content);

                result.push({
                    名称: fm['名称'] || '',
                    地位或排名: fm['地位/排名'] || fm['地位'] || '',
                });
            } catch (e) {
                log.warn(`[CrossVolumeIntegrator] 无法读取势力文件: ${file.path}`, e);
            }
        }

        return result;
    }

    /**
     * 从伏笔库.md 提取"未回收伏笔"表格行
     * 逻辑：读取从 "## 未回收伏笔" 到 "## 已回收伏笔"（或文件末尾）之间的表格行
     */
    private async scanForeshadows(project: string): Promise<ForeshadowSnapshot[]> {
        const result: ForeshadowSnapshot[] = [];
        const fp = pjForeshadowDB(project);
        const file = this.getVaultMeta().getAbstractFileByPath(fp);

        if (!(file instanceof TFile)) return result;

        try {
            const content = await this.getFS().read(fp);
            const lines = content.split('\n');

            let inUnrevealedSection = false;

            for (const line of lines) {
                // 检测段落切换
                if (line.trim().startsWith('## ') && line.includes('未回收')) {
                    inUnrevealedSection = true;
                    continue;
                }
                if (line.trim().startsWith('## ') && (line.includes('已回收') || line.includes('废弃'))) {
                    inUnrevealedSection = false;
                    continue;
                }

                if (!inUnrevealedSection) continue;

                // 匹配表格行：| ... | ... | ... |
                if (!line.match(/^\|.*\|/)) continue;

                const cols = splitTableCells(line);
                if (cols.length === 0) continue;

                // 跳过表头和分隔行
                if (cols[0] === '#' || cols[0].includes('---') || cols[0] === '伏笔') continue;

                result.push({
                    name: cols[1] || '',
                    importance: cols[2] || '',
                    buryChapter: cols[3] || '',
                    plannedReveal: cols[4] || '',
                });
            }
        } catch (e) {
            log.warn(`[CrossVolumeIntegrator] 无法解析伏笔库: ${fp}`, e);
        }

        return result;
    }

    /**
     * 从时间线看板.md 提取"主线纪元（故事进行中）"表格行
     */
    private async scanTimeline(project: string): Promise<TimelineSnapshot[]> {
        const result: TimelineSnapshot[] = [];
        const fp = pjTimelineBoard(project);
        const file = this.getVaultMeta().getAbstractFileByPath(fp);

        if (!(file instanceof TFile)) return result;

        try {
            const content = await this.getFS().read(fp);
            const lines = content.split('\n');

            let inMainTimeline = false;

            for (const line of lines) {
                // 检测段落：### 主线纪元（故事进行中）
                if (line.trim().startsWith('### ') && line.includes('主线纪元')) {
                    inMainTimeline = true;
                    continue;
                }

                // 遇到下一个 section 标题则退出
                if (inMainTimeline && line.trim().startsWith('#')) {
                    break;
                }

                if (!inMainTimeline) continue;

                // 匹配表格行
                if (!line.match(/^\|.*\|/)) continue;

                const cols = splitTableCells(line);
                if (cols.length === 0) continue;

                // 跳过表头（时间 / 对应章节 / 事件 / 影响）和分隔行
                if (
                    cols[0] === '时间'
                    || cols[0].includes('---')
                    || cols[0] === ''
                    || cols.every(c => c === '')
                ) continue;

                result.push({
                    time: cols[0] || '',
                    chapter: cols[1] || '',
                    event: cols[2] || '',
                });
            }
        } catch (e) {
            log.warn(`[CrossVolumeIntegrator] 无法解析时间线看板: ${fp}`, e);
        }

        return result;
    }

    // ============================================================
    // 私有工具方法
    // ============================================================

    /**
     * 从 Markdown 内容中解析 YAML frontmatter
     */
    private parseYamlFrontmatter(content: string): Record<string, string> {
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return {};

        const result: Record<string, string> = {};
        const lines = match[1].split('\n');

        for (const line of lines) {
            const kv = line.match(/^([^:]+):\s*(.*)$/);
            if (kv) {
                const key = kv[1].trim();
                let value = kv[2].trim();
                // 去除引号
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * 将数据渲染为快照 Markdown 字符串
     */
    private buildSnapshotMarkdown(
        volumeName: string,
        characters: CharacterSnapshot[],
        factions: FactionSnapshot[],
        foreshadows: ForeshadowSnapshot[],
        timeline: TimelineSnapshot[],
    ): string {
        const now = new Date().toLocaleString();

        let md = `---
tags: [状态快照, nw/设定/状态快照]
卷: ${volumeName}
生成时间: ${now}
---

# ${volumeName} 状态快照

## 人物状态
`;

        // 人物表格
        if (characters.length > 0) {
            md += '| 姓名 | 当前状态 | 当前情绪 | 性格标签 | 核心动机 | 所属势力 |\n';
            md += '|------|---------|---------|---------|---------|---------|\n';
            for (const ch of characters) {
                md += `| ${ch.姓名} | ${ch.当前状态} | ${ch.当前情绪} | ${ch.性格标签} | ${ch.核心动机} | ${ch.所属势力} |\n`;
            }
        } else {
            md += '_暂无人物数据_\n';
        }

        // 势力表格
        md += '\n## 势力状态\n';
        if (factions.length > 0) {
            md += '| 名称 | 地位/排名 |\n';
            md += '|------|----------|\n';
            for (const f of factions) {
                md += `| ${f.名称} | ${f.地位或排名} |\n`;
            }
        } else {
            md += '_暂无势力数据_\n';
        }

        // 伏笔表格
        md += '\n## 未回收伏笔\n';
        if (foreshadows.length > 0) {
            md += '| 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 |\n';
            md += '|---------|---------|---------|---------|\n';
            for (const fb of foreshadows) {
                md += `| ${fb.name} | ${fb.importance} | ${fb.buryChapter} | ${fb.plannedReveal} |\n`;
            }
        } else {
            md += '_暂无未回收伏笔_\n';
        }

        // 时间线表格
        md += '\n## 近期时间线\n';
        if (timeline.length > 0) {
            md += '| 时间 | 章节 | 事件 |\n';
            md += '|------|------|------|\n';
            for (const tl of timeline) {
                md += `| ${tl.time} | ${tl.chapter} | ${tl.event} |\n`;
            }
        } else {
            md += '_暂无时间线数据_\n';
        }

        return md;
    }

    /**
     * 写入文件到 Vault（先尝试 vault API，失败则回退 adapter）
     */
    private async writeFile(filePath: string, content: string): Promise<void> {
        // 确保父目录存在
        const dirParts = filePath.split('/');
        dirParts.pop();
        const dirPath = dirParts.join('/');

        if (dirPath && !this.getVaultMeta().getAbstractFileByPath(dirPath)) {
            try {
                await this.getFS().mkdir(dirPath);
            } catch (e) {
                log.warn('[CrossVolume] 快照目录失败:', e);
                this.notifier.showNotice('CrossVolume：数据读取异常，部分功能可能受限');
            }
        }

        // D3-16：不再「先删后写」——删除与写入之间失败会永久丢旧快照；
        // write 本身是覆盖语义，失败时旧文件仍在。同时与状态弹窗共用路径锁。
        await withWriteLock(filePath, async () => {
            await this.getFS().write(filePath, content);
        });
    }
}
