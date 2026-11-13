/**
 * project-standard-lib.mjs 的类型声明。
 */

export interface RequiredDir { path: string; purpose: string; autoCreate: boolean; }
export interface RequiredFile { path: string; purpose: string; optional: boolean; }
export interface NamingRule { scope: string; pattern: string; description: string; }
export interface ProjectStandard {
    version: number;
    requiredDirs: RequiredDir[];
    requiredFiles: RequiredFile[];
    naming: NamingRule[];
    chapterStatuses: string[];
}
export interface StandardIssue {
    kind: string;
    severity: 'warning' | 'error';
    path: string;
    label: string;
    detail: string;
}
export interface StandardReport {
    project: string;
    declaredVersion?: number;
    currentVersion: number;
    checkedDirs: number;
    checkedBodies: number;
    issues: StandardIssue[];
    summary: Record<string, number>;
}
export interface DirListing { files: string[]; folders: string[]; }
export interface StandardFs {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    list(path: string): Promise<DirListing>;
}

export const PROJECT_STANDARD_VERSION: number;
export const PROJECT_STANDARD: ProjectStandard;
export const FACT_STORE_REL_PATH: string;
export const PROJECT_META_REL_PATH: string;
export function requiredDirPaths(): string[];
export function namingRuleFor(scope: string): NamingRule | null;
export function isStandardOutdated(version: number | undefined): boolean;
export function chapterNumOfFile(file: string): number;
export function validateProjectStandard(
    fs: StandardFs,
    project: string,
    standard?: ProjectStandard,
): Promise<StandardReport>;
