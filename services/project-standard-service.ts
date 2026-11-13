/**
 * project-standard-service.ts — 项目标准校验（TS 门面）
 *
 * 与 `services/project-health-service.ts` 的分工：
 *  - 体检（health）= 章节内容层：重复正文、未结算、坏 frontmatter、孤立正文
 *  - 标准（standard）= **项目结构层**：缺目录、缺文件、命名不符、摘要缺失、事实库损坏、标准过期
 *
 * 实现落在 `scripts/lib/project-standard-lib.mjs`（门禁脚本与 TS 共用同一份逻辑）。
 * 本文件只提供 TS 类型与再导出，避免出现第二套校验实现。
 */

import type { ProjectHealthIssueKind } from './project-health-service';
import type { StandardReport as LibStandardReport } from '@/scripts/lib/project-standard-lib.mjs';

export {
    validateProjectStandard,
    chapterNumOfFile,
    FACT_STORE_REL_PATH,
    PROJECT_META_REL_PATH,
} from '@/scripts/lib/project-standard-lib.mjs';

export type {
    StandardFs,
    DirListing,
    StandardIssue,
    StandardReport,
} from '@/scripts/lib/project-standard-lib.mjs';
import type { StandardFs } from '@/scripts/lib/project-standard-lib.mjs';

/** 标准校验的问题类型（在体检类型基础上扩展的项目结构层问题） */
export type StandardIssueKind =
    | ProjectHealthIssueKind
    | 'missing-dir'
    | 'missing-file'
    | 'bad-naming'
    | 'digest-missing'
    | 'fact-store-invalid'
    | 'fact-store-version'
    | 'standard-outdated';


/**
 * 从 Obsidian App 构造标准校验所需的文件端口。
 *
 * 用 vault.adapter 而非 vault 索引：结构校验要检查**目录是否存在**，
 * 而 vault 索引只覆盖文件。
 *
 * @param app - Obsidian 应用
 * @returns 文件端口
 */
export function createStandardFs(app: import('obsidian').App): StandardFs {
    const adapter = app.vault.adapter;
    return {
        exists: async (path: string) => {
            try {
                return await adapter.exists(path);
            } catch { // silent-ok: 读取异常按「不存在」处理，缺失目录会被 missing-dir 报告
                return false;
            }
        },
        read: async (path: string) => adapter.read(path),
        list: async (path: string) => {
            const listing = await adapter.list(path);
            return { files: listing.files ?? [], folders: listing.folders ?? [] };
        },
    };
}
