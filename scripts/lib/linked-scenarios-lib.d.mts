/**
 * linked-scenarios-lib.mjs 的类型声明（供 TS 测试 import）。
 */

/** 锚点数据文件（相对仓库根） */
export const ANCHOR_FILE: string;

/** 单个锚点 */
export interface LinkedScenarioAnchor {
    file: string;
    text?: string;
    why?: string;
}

/** 锚点数据文件结构 */
export interface LinkedScenarioAnchorData {
    schemaVersion: number;
    doc: string;
    floor: number;
    chains: Record<string, LinkedScenarioAnchor[]>;
}

/** 校验锚点数据结构 */
export function validateAnchorData(data: unknown): string[];

/** 统计锚点总数 */
export function countAnchors(data: LinkedScenarioAnchorData | null | undefined): number;

/** 锚点下限棘轮判定 */
export function evaluateAnchorFloor(input: {
    total: number;
    floor: number;
}): { ok: boolean; tighten?: boolean; reason?: string };

/** 校验锚点与文档、源码的一致性 */
export function evaluateAnchors(input: {
    data: LinkedScenarioAnchorData;
    readFile: (rel: string) => string | null;
}): { problems: string[]; checked: number; chains: number; files: number };
