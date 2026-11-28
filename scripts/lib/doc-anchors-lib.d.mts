/**
 * doc-anchors-lib.mjs 类型声明（活文档锚点校验）
 */

/** 是否属于活文档（固化参考，需随码更新） */
export function isLivingDoc(filename: string): boolean;

/** 从活文档提取仓库内代码路径锚点（跳过带 anchor-ok 豁免标记的行） */
export function extractPathAnchors(content: string): string[];

/** 从活文档提取设置字段锚点（清单行「- `field`（默认」与反查表行「`field`(行号)」两种形态） */
export function extractSettingsFieldAnchors(content: string): string[];

/** 校验锚点：返回缺失的路径与字段 */
export function verifyAnchors(
    anchors: { paths: string[]; fields: string[] },
    ctx: { fileExists: (p: string) => boolean; repoText?: string },
): { missingPaths: string[]; missingFields: string[] };
