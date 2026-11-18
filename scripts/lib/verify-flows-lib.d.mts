/**
 * verify-flows-lib.d.mts — verify-flows-lib.mjs 的类型声明（TS 测试静态 import 用）
 *
 * 链路状态结构与 shared/link-status-compute.ts 对齐（镜像库的输出直接参与 parity 对比）。
 *
 * **注意（i18n 跨层数据⑦）**：这个文件是 parity 的盲区——`verify-flows-parity.test.ts`
 * 比的是**运行时输出**，类型声明漂移不会让测试红。改 shared 的结构时**必须手工同步这里**，
 * 否则 TS 只会报「Argument not assignable」，要在编译期而非运行期才发现。
 */

export type LinkStageStatus = 'ok' | 'broken' | 'warn' | 'unknown';

export interface LinkStage {
    /** i18n 键（linkStatus.stage.<slug>）——key 是唯一真源 */
    nameKey: string;
    status: LinkStageStatus;
    /** i18n 键（linkStatus.detail.<slug>）——key 是唯一真源 */
    detailKey: string;
    /** detailKey 的插值参数 */
    detailParams?: Record<string, string | number>;
}

export interface LinkStatus {
    /** 链路名 i18n 键（linkStatus.title.<slug>） */
    titleKey: string;
    stages: LinkStage[];
    overall: LinkStageStatus;
    /** 第一处断点的 nameKey；无断点为 null */
    breakpointKey: string | null;
    degradations?: string[];
}

export interface KnowledgeFlowInput {
    bookTotal: number;
    breakdownCompleted: number;
    vectorDone: number;
    vectorFailed: number;
    embeddingReady: boolean;
    embeddingDetail?: string;
    storeLoadedBooks: number;
    storeReady?: boolean;
    orphanCount?: number;
    degradations?: string[];
}

export interface StyleFlowInput {
    templateCount: number;
    globalCount: number;
    projectCount: number;
    enabledCount: number;
    intensityDisabledCount: number;
    embeddingReady: boolean;
    degradations?: string[];
}

export interface ConstraintFlowInput {
    sourceCount: number;
    settingExists: boolean;
    reviewStatus: 'approved' | 'pending' | 'rejected' | 'legacy' | 'none';
    bound: boolean;
    rulesHasContent: boolean;
    degradations?: string[];
}

export function summarizeLink(title: string, stages: LinkStage[], degradations?: string[]): LinkStatus;
export function computeKnowledgeFlowStatus(input: KnowledgeFlowInput): LinkStatus;
export function computeStyleFlowStatus(input: StyleFlowInput): LinkStatus;
export function computeConstraintFlowStatus(input: ConstraintFlowInput): LinkStatus;
export function mirrorSanitizeName(name: unknown): string;
