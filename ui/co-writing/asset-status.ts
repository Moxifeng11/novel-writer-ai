/**
 * ui/co-writing/asset-status.ts — 知识库/指纹库资产完整度统计
 *
 * 从 co-writing-view.ts 拆出的只读统计：不触碰 DOM，不持有视图状态。
 * 视图只负责把结果渲染成状态条。
 */
import type { KnowledgeBaseManager } from '@/services/knowledge-base-manager';
import type { StyleFingerprintLibrary } from '@/engine/style-fingerprint-library';

/** 单类资产的完成度 */
export interface AssetCompleteness {
    completed: number;
    total: number;
    completeness: number;
}

/** 知识库 + 指纹库的组合状态 */
export interface AssetStatus {
    knowledgeBase: AssetCompleteness;
    fingerprint: AssetCompleteness;
}

const EMPTY: AssetCompleteness = { completed: 0, total: 0, completeness: 0 };

/**
 * 统计知识库书籍拆解完成度。
 *
 * @param manager - 知识库管理器；未初始化时返回空状态
 * @returns 完成度
 */
export async function calculateKnowledgeBaseCompleteness(
    manager: KnowledgeBaseManager | null | undefined,
): Promise<AssetCompleteness> {
    if (!manager) return { ...EMPTY };
    try {
        const books = await manager.getAllBooks();
        const total = books.length;
        const completed = books.filter(book => book.breakdownStatus === 'completed').length;
        const completeness = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { completed, total, completeness };
    } catch {
        return { ...EMPTY };
    }
}

/**
 * 统计文风指纹库完成度。
 *
 * 单个指纹得分 = 特征覆盖 40 + 样本文数 30 + 原文 30；≥85 视为完成。
 *
 * @param library - 指纹库；未初始化时返回空状态
 * @returns 完成度
 */
export async function calculateFingerprintCompleteness(
    library: StyleFingerprintLibrary | null | undefined,
): Promise<AssetCompleteness> {
    if (!library) return { ...EMPTY };
    try {
        await library.loadGlobal();
        await library.loadProject();
        const allFps = [...library.listProject(), ...library.listGlobal()];
        const enabledFps = allFps.filter(fp => fp.enabled);
        const total = enabledFps.length;
        let completed = 0;

        for (const fp of enabledFps) {
            const features = fp.features;
            const featureKeys = [
                'sentenceRhythm', 'wordPreference', 'narrativeStyle', 'rhetoric',
                'dialogueStyle', 'paragraphStructure', 'overallTone',
            ] as const;
            const filledFeatures = featureKeys.filter(k => features[k] && features[k].length > 0).length;
            const hasSamples = fp.samples.length >= 15;
            const hasSource = fp.sourceText && fp.sourceText.length > 0;
            const score = Math.round((filledFeatures / 7) * 40)
                + (hasSamples ? 30 : fp.samples.length > 0 ? Math.round((fp.samples.length / 15) * 30) : 0)
                + (hasSource ? 30 : 0);
            if (score >= 85) completed++;
        }

        const completeness = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { completed, total, completeness };
    } catch {
        return { ...EMPTY };
    }
}

/**
 * 汇总两类资产状态。
 *
 * @param manager - 知识库管理器
 * @param library - 指纹库
 * @returns 组合状态
 */
export async function getAssetStatus(
    manager: KnowledgeBaseManager | null | undefined,
    library: StyleFingerprintLibrary | null | undefined,
): Promise<AssetStatus> {
    const [knowledgeBase, fingerprint] = await Promise.all([
        calculateKnowledgeBaseCompleteness(manager),
        calculateFingerprintCompleteness(library),
    ]);
    return { knowledgeBase, fingerprint };
}

/**
 * 完成度对应的图标与颜色。
 *
 * @param completeness - 0–100
 * @returns 图标与 CSS 颜色
 */
export function getCompletenessIcon(completeness: number): { icon: string; color: string } {
    if (completeness >= 100) {
        return { icon: '✓', color: 'var(--text-success, #10b981)' };
    }
    if (completeness >= 60) {
        return { icon: '⚠', color: 'var(--text-warning, #f59e0b)' };
    }
    return { icon: '✗', color: 'var(--text-error, #ef4444)' };
}

/**
 * 渲染知识库/指纹库状态条。
 *
 * @param container - 状态条容器
 * @param status - 组合状态
 * @param onKnowledgeClick - 点击知识库徽标时的回调
 */
export function renderAssetStatusBar(
    container: HTMLElement,
    status: AssetStatus,
    onKnowledgeClick: () => void,
): void {
    container.empty();

    const kbIcon = getCompletenessIcon(status.knowledgeBase.completeness);
    const fpIcon = getCompletenessIcon(status.fingerprint.completeness);

    const badge = container.createDiv({
        cls: 'nw-asset-status-badge',
        attr: {
            style: 'display:flex;align-items:center;gap:12px;padding:6px 12px;border-radius:6px;background:var(--background-secondary);cursor:pointer;transition:background 0.2s;',
        },
    });

    const kbPart = badge.createDiv({ attr: { style: 'display:flex;align-items:center;gap:4px;' } });
    kbPart.createSpan({ text: '📚', attr: { style: 'font-size:14px;' } });
    kbPart.createSpan({ text: `知识库 ${status.knowledgeBase.completed}/${status.knowledgeBase.total}`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
    kbPart.createSpan({ text: kbIcon.icon, attr: { style: `font-size:12px;color:${kbIcon.color};font-weight:600;` } });

    badge.createSpan({ text: '|', attr: { style: 'color:var(--background-modifier-border);' } });

    const fpPart = badge.createDiv({ attr: { style: 'display:flex;align-items:center;gap:4px;' } });
    fpPart.createSpan({ text: '🎨', attr: { style: 'font-size:14px;' } });
    fpPart.createSpan({ text: `指纹 ${status.fingerprint.completed}/${status.fingerprint.total}`, attr: { style: 'font-size:12px;color:var(--text-muted);' } });
    fpPart.createSpan({ text: fpIcon.icon, attr: { style: `font-size:12px;color:${fpIcon.color};font-weight:600;` } });

    badge.addEventListener('mouseenter', () => {
        badge.style.background = 'var(--background-secondary-alt)';
    });
    badge.addEventListener('mouseleave', () => {
        badge.style.background = 'var(--background-secondary)';
    });
    badge.addEventListener('click', onKnowledgeClick);
}
