/**
 * step-runner-callbacks.ts — StepRunner 回调接口定义
 *
 * 目的：将 engine/step-runner.ts 中的 UI 渲染逻辑与 Notice 调用分离
 * 让 engine 层保持"纯逻辑、无 DOM、无 Obsidian UI 依赖"
 *
 * 使用方式：
 *   1. UI 层（如 StepRenderController）实现此接口
 *   2. 将实现实例传给 StepRunner 构造函数
 *   3. StepRunner 内部通过回调通知 UI 层，而非直接操作 DOM
 *
 * v4.1.1: 从 step-runner.ts 外迁 DOM/Notice 逻辑
 */

/** DEAI 消痕改写弹窗参数 */
export interface DeaiModalParams {
    bodyText: string;
    stepResults: Record<string, string>;
    chapDir: string;
    chapterName: string;
    volume: string;
    stepCompleted: Set<string>;
    onAccept: (finalText: string) => Promise<void>;
    onReject: () => void;
}

/** 自动迭代精修弹窗参数 */
export interface RefineModalParams {
    bodyText: string;
    contextPrompt: string;
    chapNum: string;
    stepResults: Record<string, string>;
    chapDir?: string;
    chapterName?: string;
    volume?: string;
    stepCompleted?: Set<string>;
    onAccept: (finalBody: string) => Promise<void>;
    onReject: () => void;
}

/** 逐轮选择弹窗参数 */
export interface RoundSelectModalParams {
    result: {
        finalBody: string;
        rounds: number;
        diffs: string[];
        roundBodies: string[];
    };
    stepResults: Record<string, string>;
    chapDir?: string;
    chapterName?: string;
    volume?: string;
    stepCompleted?: Set<string>;
    onSelect: (roundBody: string, label: string) => Promise<void>;
    onCancel: () => void;
}

/** StepRunner 回调接口 — UI 层实现 */
export interface StepRunnerCallbacks {
    // ── 通知类 ──────────────────────────────────────────────
    /** 显示通知（默认5秒） */
    showNotice(message: string, duration?: number): void;
    /** 显示成功通知 */
    showSuccess(message: string, duration?: number): void;
    /** 显示错误通知 */
    showError(message: string, duration?: number): void;
    /** 显示警告通知 */
    showWarning(message: string, duration?: number): void;

    // ── 进度类 ──────────────────────────────────────────────
    /** 显示进度（持续显示，可更新） */
    showProgress(message: string): void;
    /** 隐藏进度通知 */
    hideProgress(): void;

    // ── 弹窗类 ──────────────────────────────────────────────
    /** 显示 DEAI 消痕改写两阶段弹窗 */
    showDeaiTwoPhaseModal(params: DeaiModalParams): void;
    /** 显示自动迭代精修两阶段弹窗 */
    showRefineTwoPhaseModal(params: RefineModalParams): void;
    /** 显示逐轮版本选择弹窗 */
    showRoundSelectModal(params: RoundSelectModalParams): void;

    // ── 样式注入 ─────────────────────────────────────────────
    /** 注入 DEAI 弹窗样式（幂等） */
    injectDeaiModalStyles(): void;
    /** 注入精修弹窗样式（幂等） */
    injectRefineModalStyles(): void;
    /** 注入版本选择弹窗样式（幂等） */
    injectRoundSelectStyles(): void;
}

/** 默认空实现 — 用于测试或不关心某些回调的场景 */
export const NOOP_CALLBACKS: StepRunnerCallbacks = {
    showNotice: () => {},
    showSuccess: () => {},
    showError: () => {},
    showWarning: () => {},
    showProgress: () => {},
    hideProgress: () => {},
    showDeaiTwoPhaseModal: () => {},
    showRefineTwoPhaseModal: () => {},
    showRoundSelectModal: () => {},
    injectDeaiModalStyles: () => {},
    injectRefineModalStyles: () => {},
    injectRoundSelectStyles: () => {},
};
