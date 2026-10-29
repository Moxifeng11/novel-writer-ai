/**
 * mode-unit-outline.ts — 从分节/分集大纲里取出某个单元的段落
 *
 * 短篇/剧本的作者写大纲时格式并不统一（`### 第3节`、`## 第3集：标题`、
 * `第3节 标题` 都有）。这里用宽松的行首匹配切段，只负责「找到这一节并
 * 截到下一节之前」，不做 Markdown 结构解析。
 */
import type { CreationMode } from './creation-mode';
import { modeUnitLabel } from './mode-content';

interface UnitMarker {
    index: number;
    number: number;
    hasHash: boolean;
    level: number;
}

/**
 * 取出第 number 个单元的大纲段落（含标题行）。
 * 找不到编号时返回空串，调用方自行回退到整篇大纲。
 */
export function extractUnitOutlineSection(doc: string, mode: CreationMode, number: number): string {
    if (!doc || !Number.isFinite(number) || number <= 0) return '';
    const label = modeUnitLabel(mode);
    const lines = String(doc).replace(/\r\n/g, '\n').split('\n');
    const headingPattern = new RegExp(
        `^\\s{0,3}(#{1,6}\\s*)?第\\s*(\\d{1,4})\\s*${label}(?:[\\s：:.、\\-]|$)`,
    );

    const markers: UnitMarker[] = [];
    for (let i = 0; i < lines.length; i++) {
        const matched = lines[i].match(headingPattern);
        if (!matched) continue;
        const hasHash = !!matched[1];
        markers.push({
            index: i,
            number: parseInt(matched[2], 10),
            hasHash,
            level: hasHash ? (matched[1].match(/#/g) || []).length : 0,
        });
    }

    const targetIndex = markers.findIndex(marker => marker.number === number);
    if (targetIndex < 0) return '';
    const target = markers[targetIndex];

    let end = lines.length;
    for (let i = targetIndex + 1; i < markers.length; i++) {
        const next = markers[i];
        if (next.number === number) continue;
        // 无标题层级的普通行只作为兜底边界（整篇都是 `第N节` 平铺写法）
        if (!target.hasHash) {
            end = next.index;
            break;
        }
        // 有标题层级时，同级或更高级标题才结束本节，子标题（### 场次）保留
        if (next.hasHash && next.level <= target.level) {
            end = next.index;
            break;
        }
    }

    return lines.slice(target.index, end).join('\n').trim();
}

/** 大纲里出现过的单元编号（升序），用于「骨架数与大纲对不上」时提示 */
export function listOutlineUnitNumbers(doc: string, mode: CreationMode): number[] {
    if (!doc) return [];
    const label = modeUnitLabel(mode);
    const pattern = new RegExp(`^\\s{0,3}(?:#{1,6}\\s*)?第\\s*(\\d{1,4})\\s*${label}(?:[\\s：:.、\\-]|$)`, 'gm');
    const numbers = new Set<number>();
    for (const matched of String(doc).replace(/\r\n/g, '\n').matchAll(pattern)) {
        numbers.add(parseInt(matched[1], 10));
    }
    return [...numbers].sort((a, b) => a - b);
}
