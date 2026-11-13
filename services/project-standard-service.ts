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

export type { StandardFs, DirListing } from '@/scripts/lib/project-standard-lib.mjs';

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

/** 单条标准问题 */
export interface StandardIssue {
    /** 问题类型 */
    kind: StandardIssueKind;
    /** 严重度 */
    severity: 'warning' | 'error';
    /** 相关路径 */
    path: string;
    /** 简短标签 */
    label: string;
    /** 详细说明（含"怎么修"） */
    detail: string;
}

/** 标准校验报告（与 lib 形状一致，类型更严格） */
export interface StandardReport extends Omit<LibStandardReport, 'issues' | 'summary'> {
    /** 问题列表 */
    issues: StandardIssue[];
    /** 按类型汇总 */
    summary: Record<string, number>;
}
