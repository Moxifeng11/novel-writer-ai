/**
 * plot-canvas-parser.ts — 可视化情节画布的数据解析（纯函数，可单元测试）
 *
 * 从分卷大纲文件文本解析出「卷 → 章」结构。纯文本解析，不依赖 Obsidian App/vault，
 * 便于单元测试。plot-canvas-modal.ts 复用本模块。
 */

/** 卷节点 */
export interface VolumeNode {
    volNum: number;
    volName: string;
    chapters: ChapterNode[];
}

/** 章节点 */
export interface ChapterNode {
    chapNum: number;
    conflict: string;
    /** 该章所在源文件行号（回写定位用） */
    rowLine: number;
    /** 来源文件索引（多卷归档下标记回写目标） */
    sourceIdx: number;
    /** 关键场景数量（⭐/名场面） */
    keySceneCount: number;
}

/**
 * 解析单个分卷大纲源文件为卷列表。
 * @param lines 源文件按行拆分
 * @param sourceIdx 来源文件索引
 * @returns 结果数组
 */
export function parseVolumeOutline(lines: string[], sourceIdx: number): VolumeNode[] {
    const volumes: VolumeNode[] = [];
    let currentVol: VolumeNode | null = null;
    let inChapterTable = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // 卷标题：### 第N卷
        const volMatch = trimmed.match(/^###\s*第(\d+)卷/);
        if (volMatch) {
            if (currentVol) volumes.push(currentVol);
            currentVol = { volNum: parseInt(volMatch[1], 10), volName: '', chapters: [] };
            inChapterTable = false;
            continue;
        }
        if (!currentVol) continue;

        // 卷名：- **卷名**：xxx
        const nameMatch = trimmed.match(/[-*]\s*\*{0,2}卷名\*{0,2}\s*[:：]\s*(.+)/);
        if (nameMatch) { currentVol.volName = nameMatch[1].trim(); continue; }

        // 章节表格表头
        if (trimmed.startsWith('| 章号') || trimmed.startsWith('|章号')) { inChapterTable = true; continue; }
        // 表格分隔行
        if (inChapterTable && /^\|[-| ]+\|$/.test(trimmed)) continue;

        // 章节表格行：| 1 | xxx |
        if (inChapterTable) {
            const rowMatch = trimmed.match(/^\|\s*(\d+)\s*\|(.+)\|$/);
            if (rowMatch) {
                currentVol.chapters.push({
                    chapNum: parseInt(rowMatch[1], 10),
                    conflict: rowMatch[2].trim(),
                    rowLine: i,
                    sourceIdx,
                    keySceneCount: 0,
                });
                continue;
            }
            // 表格结束
            if (!trimmed.startsWith('|')) { inChapterTable = false; }
        }
    }
    if (currentVol) volumes.push(currentVol);

    return volumes;
}

/**
 * 统计章节总数
 *
 * @param volumes - 卷列表
 * @returns 数值结果
 */
export function countChapters(volumes: VolumeNode[]): number {
    return volumes.reduce((sum, v) => sum + v.chapters.length, 0);
}
