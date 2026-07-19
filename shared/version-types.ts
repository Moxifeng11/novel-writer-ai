/**
 * version-types.ts — 版本管理相关类型定义
 *
 * 用于章节、大纲、设定等内容的版本管理、对比和回滚
 */

/** 版本类型：区分版本的来源 */
export type VersionType = 'manual' | 'ai-generate' | 'polish' | 'import' | 'rollback';

/** 内容类型：区分是什么内容的版本 */
export type ContentType = 'chapter' | 'outline' | 'worldview' | 'character' | 'setting';

/** 版本元数据 */
export interface VersionMeta {
    /** 版本唯一 ID（时间戳+随机数） */
    id: string;
    /** 版本号（自动递增，从 1 开始） */
    version: number;
    /** 创建时间戳（ISO 字符串） */
    createdAt: string;
    /** 版本类型 */
    type: VersionType;
    /** 内容类型 */
    contentType: ContentType;
    /** 字数 */
    wordCount: number;
    /** 字数变化（相对于上一版本，正数增加，负数减少） */
    wordCountDelta: number;
    /** 行数 */
    lineCount: number;
    /** 版本标签（用户可自定义） */
    tags: string[];
    /** 版本备注 */
    note: string;
    /** 关联的项目名 */
    project: string;
    /** 内容标识（章节名/大纲名/设定名等） */
    contentKey: string;
    /** 源文件路径（相对 vault 根路径） */
    sourcePath: string;
    /** 版本内容的存储路径（相对 vault 根路径） */
    versionPath: string;
}

/** 版本索引文件结构 */
export interface VersionIndex {
    /** 内容类型 */
    contentType: ContentType;
    /** 项目名 */
    project: string;
    /** 内容标识 */
    contentKey: string;
    /** 源文件路径 */
    sourcePath: string;
    /** 当前最新版本号 */
    latestVersion: number;
    /** 版本列表（按版本号倒序） */
    versions: VersionMeta[];
}

/** Diff 操作类型 */
export type DiffOp = 'equal' | 'insert' | 'delete' | 'replace';

/** 行级 Diff 结果 */
export interface LineDiff {
    op: DiffOp;
    /** 旧文本行号（从 0 开始） */
    oldLine: number;
    /** 新文本行号（从 0 开始） */
    newLine: number;
    /** 行内容 */
    content: string;
}

/** 字符级 Diff 结果 */
export interface CharDiff {
    op: DiffOp;
    content: string;
}

/** Diff 统计信息 */
export interface DiffStats {
    /** 增加的行数 */
    addedLines: number;
    /** 删除的行数 */
    deletedLines: number;
    /** 修改的行数 */
    modifiedLines: number;
    /** 未变化的行数 */
    unchangedLines: number;
    /** 总行数（以新文本为准） */
    totalLines: number;
    /** 修改比例（0-1） */
    changeRatio: number;
    /** 增加的字符数 */
    addedChars: number;
    /** 删除的字符数 */
    deletedChars: number;
}

/** 回滚操作记录 */
export interface RollbackRecord {
    /** 记录 ID */
    id: string;
    /** 回滚时间 */
    rolledBackAt: string;
    /** 从哪个版本回滚 */
    fromVersion: number;
    /** 回滚到哪个版本 */
    toVersion: number;
    /** 回滚前自动保存的版本 ID */
    autoSavedVersionId: string;
    /** 内容类型 */
    contentType: ContentType;
    /** 项目名 */
    project: string;
    /** 内容标识 */
    contentKey: string;
    /** 源文件路径 */
    sourcePath: string;
}

/** 版本存储位置选项 */
export type VersionStorageLocation = 'project' | 'plugin-data';
