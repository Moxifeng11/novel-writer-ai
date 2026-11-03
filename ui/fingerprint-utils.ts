import { StyleFingerprint } from '@/engine/style-fingerprint-library';
import {
    StyleDimensionKeyV2,
    StyleDimensionMetaV2,
    STYLE_DIMENSIONS_V2,
    DimensionStatus,
} from '@/engine/style/style-dimensions-v2';

/**
 * 格式化词语数量。
 * @param count - 数量
 * @returns 文本结果
 */
export function formatWordCount(count: number): string {
    if (count >= 10000) {
        const wan = count / 10000;
        return wan % 1 === 0 ? `${wan}万字` : `${wan.toFixed(1)}万字`;
    }
    return `${count}字`;
}

/**
 * 格式化日期时间。
 * @param timestamp - 时间戳
 * @returns 文本结果
 */
export function formatDateTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString('zh-CN');
}

/**
 * 指纹列表选项列表结构定义。
 */
export interface FingerprintListOptions {
    showDelete?: boolean;
    onToggle?: (fp: StyleFingerprint) => void;
    onDetail?: (fp: StyleFingerprint) => void;
    onDelete?: (fp: StyleFingerprint) => void;
}

/**
 * 模板层是「来源库」而非注入层：创建项目/「从模板同步到项目」时才复制进项目，
 * 注入链（`StyleFingerprintLibrary#getEnabledFingerprints`）与强度配置
 * （`PromptBuilder#getFingerprintPromptParts`）都只处理 project / global。
 *
 * 因此 template 指纹的「启用/禁用」「强度调节」没有任何消费方，三个入口
 * （指纹库视图、设置页、mini 设置）都必须隐藏这两个控件，否则用户会以为设置生效。
 * @param scope - 作用域
 * @returns 是否成功
 */
export function isSourceOnlyFingerprintScope(scope: StyleFingerprint['scope']): boolean {
    return scope === 'template';
}

/**
 * 渲染指纹列表。
 * @param container - 容器元素
 * @param fingerprints - 指纹集合
 * @param options - 配置项
 */
export function renderFingerprintList(
    container: HTMLElement,
    fingerprints: StyleFingerprint[],
    options: FingerprintListOptions = {}
): void {
    const { showDelete = false, onToggle, onDetail, onDelete } = options;

    if (fingerprints.length === 0) {
        container.createDiv({
            attr: { style: 'padding:24px;text-align:center;color:var(--text-faint);font-size:13px;' },
            text: '暂无指纹'
        });
        return;
    }

    const listEl = container.createDiv({
        attr: { style: 'display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;' }
    });

    fingerprints.forEach(fp => {
        const item = listEl.createDiv({
            attr: {
                style: `padding:12px;border:1px solid var(--background-modifier-border);border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:12px;${fp.enabled ? '' : 'opacity:0.6;'}`
            }
        });

        const info = item.createDiv({ attr: { style: 'flex:1;min-width:0;' } });
        const nameRow = info.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;' } });
        nameRow.createEl('span', {
            text: `🔍 ${fp.name}`,
            attr: { style: 'font-weight:600;font-size:14px;' }
        });
        nameRow.createEl('span', {
            text: fp.source,
            attr: { style: 'font-size:12px;color:var(--text-muted);' }
        });

        const metaRow = info.createDiv({ attr: { style: 'display:flex;gap:12px;font-size:11px;color:var(--text-faint);' } });
        metaRow.createEl('span', { text: formatWordCount(fp.stats.wordCount) });
        metaRow.createEl('span', { text: formatDateTime(fp.extractedAt) });

        const actions = item.createDiv({ attr: { style: 'display:flex;gap:6px;flex-shrink:0;align-items:center;' } });

        if (isSourceOnlyFingerprintScope(fp.scope)) {
            // 模板层不参与注入：给提示而不是给一个无效开关
            actions.createEl('span', {
                text: '来源库 · 复制到项目后生效',
                attr: {
                    title: '模板层指纹只在创建项目/从模板同步时复制进项目，本身的启用状态不影响正文',
                    style: 'font-size:11px;color:var(--text-faint);'
                }
            });
        } else {
            const toggleWrap = actions.createDiv({ attr: { style: 'display:flex;align-items:center;gap:6px;' } });
            const toggleInput = toggleWrap.createEl('input', {
                attr: { type: 'checkbox', style: 'cursor:pointer;' }
            });
            toggleInput.checked = fp.enabled;
            toggleInput.addEventListener('change', () => {
                onToggle?.(fp);
            });
        }

        const detailBtn = actions.createEl('button', {
            text: '详情',
            attr: { type: 'button', style: 'padding:4px 10px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;' }
        });
        detailBtn.addEventListener('click', () => onDetail?.(fp));

        if (showDelete) {
            const delBtn = actions.createEl('button', {
                text: '🗑',
                attr: {
                    type: 'button',
                    title: '删除',
                    style: 'padding:4px 8px;cursor:pointer;border:1px solid var(--background-modifier-border);border-radius:4px;font-size:11px;color:var(--text-error);'
                }
            });
            delBtn.addEventListener('click', () => onDelete?.(fp));
        }
    });
}

/**
 * 特征维度列表常量。
 */
export const FEATURE_DIMENSIONS: Array<{ key: keyof StyleFingerprint['features']; label: string }> = [
    { key: 'sentenceRhythm', label: '句式节奏' },
    { key: 'wordPreference', label: '用词偏好' },
    { key: 'narrativeStyle', label: '叙事特点' },
    { key: 'rhetoric', label: '修辞手法' },
    { key: 'dialogueStyle', label: '对话风格' },
    { key: 'paragraphStructure', label: '段落结构' },
    { key: 'overallTone', label: '整体文风' },
];

// ============================================================
// V2 12 维扩展（Task 7）
// ============================================================

/**
 * V2 12 维常量（直接复用引擎层定义，避免重复维护）
 */
export const FEATURE_DIMENSIONS_V2: readonly StyleDimensionMetaV2[] = STYLE_DIMENSIONS_V2;

/**
 * 维度数据状态中文标签
 */
export const DIMENSION_STATUS_LABELS: Record<DimensionStatus, string> = {
    complete: '完整',
    pending: '待补充',
    partial: '部分',
};

/**
 * 维度数据状态对应分数（用于雷达图可视化，0-100）
 * - complete: 80（数据完整）
 * - partial: 60（部分数据）
 * - pending: 40（待补充，仍可展示但提示数据不足）
 */
export const DIMENSION_STATUS_SCORES: Record<DimensionStatus, number> = {
    complete: 80,
    partial: 60,
    pending: 40,
};

/**
 * 根据维度数据状态计算雷达图分值
 * - 优先使用真实统计指标（如归一化的比例值 × 100）
 * - 缺乏指标时回退到状态分值
 * @param status - 状态
 * @param normalizedMetric - 规范化指标
 * @returns 数值结果
 */
export function getDimensionScore(
    status: DimensionStatus,
    normalizedMetric?: number
): number {
    if (typeof normalizedMetric === 'number' && !Number.isNaN(normalizedMetric)) {
        return Math.max(20, Math.min(100, Math.round(normalizedMetric * 100)));
    }
    return DIMENSION_STATUS_SCORES[status];
}

/**
 * V2 维度键列表（用于遍历）
 */
export const V2_DIMENSION_KEYS: readonly StyleDimensionKeyV2[] = STYLE_DIMENSIONS_V2.map(d => d.key);
