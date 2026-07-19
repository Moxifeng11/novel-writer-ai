/**
 * volume-conflict-detector.ts — 卷冲突检测器
 *
 * 用途：在重新生成大纲或调整分卷结构时，检测数据层已有卷与新大纲配置之间的冲突。
 */

// ============================================================
// 数据模型
// ============================================================

/** 单卷文件信息 */
export interface VolumeFileInfo {
    /** 卷序号（如 1, 2, 3） */
    volumeNumber: number;
    /** 卷名称（如 "第1卷"） */
    volumeName: string;
    /** 该卷下的章节数量 */
    chapterCount: number;
    /** 该卷下检测到的文件路径列表 */
    filePaths: string[];
}

/** 扫描结果 */
export interface VolumeScanResult {
    /** 实际卷数量 */
    volumeCount: number;
    /** 每卷章节数数组（按卷号升序） */
    chaptersPerVolume: number[];
    /** 各卷详细文件信息（按卷号升序） */
    volumeFiles: VolumeFileInfo[];
}

/** 冲突类型 */
export type VolumeConflictType =
    | 'more_volumes'
    | 'fewer_volumes'
    | 'same_count_different_chapters'
    | 'none';

/** 卷冲突详情（spec 第3.4节） */
export interface VolumeConflictInfo {
    /** 冲突类型 */
    conflictType: VolumeConflictType;
    /** 数据层现有卷扫描结果 */
    existingVolumes: VolumeScanResult;
    /** 新大纲配置卷数 */
    newConfigVolumes: number;
    /** 新大纲每卷章节数配置 */
    newConfigChaptersPerVolume: number[];
    /** 冲突详细分析 */
    details: {
        /** 新增卷序号列表（新大纲有但数据层没有） */
        addedVolumes?: number[];
        /** 删除卷序号列表（数据层有但新大纲没有） */
        removedVolumes?: number[];
        /** 章节重叠/共有的卷序号列表 */
        overlappingVolumes?: number[];
        /** 章节数不匹配的卷列表 */
        chapterMismatches?: Array<{
            volumeNumber: number;
            existing: number;
            planned: number;
        }>;
    };
    /** 人类可读的冲突描述 */
    message: string;
}

/** 用户选择的冲突处理策略 */
export type VolumeConflictResolution =
    | 'smart_merge'
    | 'full_override'
    | 'manual_adjust';

// ============================================================
// 扫描函数
// ============================================================

/**
 * 扫描项目路径下的卷目录，统计实际卷数量和每卷章节数。
 *
 * @param projectPath 项目根路径（扫描其下 `volumes/` 子目录）
 * @param filePaths 可选：文件路径列表。若提供则基于该列表统计；
 *                  若不提供，则假设目录不存在，返回空结果。
 */
export function scanExistingVolumes(
    projectPath: string,
    filePaths?: string[]
): VolumeScanResult {
    const volumesDir = `${projectPath}/volumes`;

    if (!filePaths || filePaths.length === 0) {
        return {
            volumeCount: 0,
            chaptersPerVolume: [],
            volumeFiles: [],
        };
    }

    const volumeMap = new Map<number, VolumeFileInfo>();

    for (const filePath of filePaths) {
        // 匹配 volumes/第N卷/ 路径下的文件
        const volumeMatch = filePath.match(
            new RegExp(`^${escapeRegex(volumesDir)}/(第\\d+卷)/`)
        );
        if (!volumeMatch) continue;

        const volumeName = volumeMatch[1];
        const volumeNumber = parseInt(volumeName.match(/\d+/)?.[0] || '0', 10);
        if (volumeNumber <= 0) continue;

        if (!volumeMap.has(volumeNumber)) {
            volumeMap.set(volumeNumber, {
                volumeNumber,
                volumeName,
                chapterCount: 0,
                filePaths: [],
            });
        }

        const volInfo = volumeMap.get(volumeNumber)!;
        volInfo.filePaths.push(filePath);

        // 识别章节文件：第M章_正文.md、第M章 正文.md、第M章.md 等格式
        const chapterMatch = filePath.match(/第(\d+)章[^/]*\.md$/);
        if (chapterMatch) {
            volInfo.chapterCount = Math.max(
                volInfo.chapterCount,
                parseInt(chapterMatch[1], 10)
            );
        }
    }

    // 按卷号升序排序
    const sortedVolumes = Array.from(volumeMap.values()).sort(
        (a, b) => a.volumeNumber - b.volumeNumber
    );

    return {
        volumeCount: sortedVolumes.length,
        chaptersPerVolume: sortedVolumes.map(v => v.chapterCount),
        volumeFiles: sortedVolumes,
    };
}

// ============================================================
// 冲突检测函数
// ============================================================

/**
 * 对比数据层卷数和新大纲配置，返回冲突分析结果。
 *
 * @param existingVolumes 数据层现有卷扫描结果
 * @param newConfigVolumes 新大纲配置的卷数量
 * @param newConfigChaptersPerVolume 新大纲每卷章节数配置（数组索引+1 为卷号）
 */
export function detectVolumeConflict(
    existingVolumes: VolumeScanResult,
    newConfigVolumes: number,
    newConfigChaptersPerVolume: number[]
): VolumeConflictInfo {
    const existingVolumeNumbers = existingVolumes.volumeFiles.map(v => v.volumeNumber);
    const newVolumeNumbers = Array.from({ length: newConfigVolumes }, (_, i) => i + 1);

    const addedVolumes = newVolumeNumbers.filter(
        n => !existingVolumeNumbers.includes(n)
    );
    const removedVolumes = existingVolumeNumbers.filter(
        n => !newVolumeNumbers.includes(n)
    );
    const overlappingVolumes = newVolumeNumbers.filter(n =>
        existingVolumeNumbers.includes(n)
    );

    const chapterMismatches: Array<{
        volumeNumber: number;
        existing: number;
        planned: number;
    }> = [];

    for (const volNum of overlappingVolumes) {
        const existingVol = existingVolumes.volumeFiles.find(
            v => v.volumeNumber === volNum
        );
        const plannedChapters = newConfigChaptersPerVolume[volNum - 1] ?? 0;
        const existingChapters = existingVol?.chapterCount ?? 0;

        if (existingChapters !== plannedChapters) {
            chapterMismatches.push({
                volumeNumber: volNum,
                existing: existingChapters,
                planned: plannedChapters,
            });
        }
    }

    let conflictType: VolumeConflictType = 'none';
    let message = '无冲突：数据层卷结构与新大纲配置完全一致。';

    if (existingVolumes.volumeCount > newConfigVolumes) {
        conflictType = 'more_volumes';
        message = `数据层有 ${existingVolumes.volumeCount} 卷，新大纲仅 ${newConfigVolumes} 卷。` +
            `将多余 ${removedVolumes.length} 卷（第 ${removedVolumes.join('、')} 卷）移入归档。`;
    } else if (existingVolumes.volumeCount < newConfigVolumes) {
        conflictType = 'fewer_volumes';
        message = `数据层有 ${existingVolumes.volumeCount} 卷，新大纲将生成 ${newConfigVolumes} 卷。` +
            `新增 ${addedVolumes.length} 卷（第 ${addedVolumes.join('、')} 卷）。`;
    } else if (chapterMismatches.length > 0) {
        conflictType = 'same_count_different_chapters';
        const mismatches = chapterMismatches
            .map(m => `第${m.volumeNumber}卷（现有${m.existing}章→规划${m.planned}章）`)
            .join('、');
        message = `卷数相同（${existingVolumes.volumeCount}卷），但章节数不一致：${mismatches}。`;
    }

    return {
        conflictType,
        existingVolumes,
        newConfigVolumes,
        newConfigChaptersPerVolume,
        details: {
            addedVolumes: addedVolumes.length > 0 ? addedVolumes : undefined,
            removedVolumes: removedVolumes.length > 0 ? removedVolumes : undefined,
            overlappingVolumes: overlappingVolumes.length > 0 ? overlappingVolumes : undefined,
            chapterMismatches: chapterMismatches.length > 0 ? chapterMismatches : undefined,
        },
        message,
    };
}

// ============================================================
// 辅助函数
// ============================================================

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
