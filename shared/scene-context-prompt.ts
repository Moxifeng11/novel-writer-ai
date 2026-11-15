/**
 * scene-context-prompt.ts — 把场景上下文会话渲染成提示词段落（纯函数）
 *
 * 供正文/质控/分析步使用：只渲染**已加载**的条目，并显式标注覆盖缺口与预算未加载项，
 * 让模型知道「还缺什么」，而不是假装信息完整。
 */

import type { ContextSession, CoverageReport } from './context-session-model';
import { renderSessionSummary } from './context-session-model';
import type { SceneAnchor } from './scene-anchor-model';

/** 渲染选项 */
export interface SceneContextPromptOptions {
    /** 场景锚点（可空） */
    scene?: SceneAnchor;
    /** 覆盖报告（可空） */
    coverage?: CoverageReport;
    /** 是否包含会话摘要（默认包含） */
    includeSummary?: boolean;
}

/** 类别中文名 */
const KIND_LABELS: Record<string, string> = {
    entity: '要素',
    relation: '关系',
    foreshadow: '伏笔',
    timeline: '时间线',
    setting: '设定',
    worldview: '世界观',
    assertion: '一致性断言',
    scene: '场景',
    chapter: '章节',
    rag: '知识库',
};

/**
 * 渲染场景上下文段。
 *
 * @param session - 上下文会话
 * @param options - 渲染选项
 * @returns 提示词段落；无内容返回空串
 */
export function renderSceneContextSection(
    session: ContextSession,
    options: SceneContextPromptOptions = {},
): string {
    const items = Object.values(session.loaded);
    const sceneHeader = options.scene
        ? `【当前场景】场景${options.scene.index}「${options.scene.title}」`
        : '';

    if (items.length === 0 && !options.coverage && !sceneHeader) return '';

    const lines: string[] = [];
    if (sceneHeader) lines.push(sceneHeader);

    if (items.length > 0) {
        lines.push('【本场已加载上下文（按 ID 精确匹配）】');
        const grouped = new Map<string, typeof items>();
        for (const item of items) {
            const list = grouped.get(item.kind) ?? [];
            list.push(item);
            grouped.set(item.kind, list);
        }
        for (const [kind, list] of grouped) {
            lines.push(`- ${KIND_LABELS[kind] ?? kind}（${list.length}）：`);
            for (const item of list) {
                const firstLine = String(item.text ?? '').split('\n').find(line => line.trim()) ?? '';
                lines.push(`  · ${item.id} ${item.title}${firstLine ? `：${firstLine.slice(0, 80)}` : ''}`);
            }
        }
    }

    const coverage = options.coverage;
    if (coverage && coverage.missing.length > 0) {
        lines.push(`【覆盖缺口】必需 ${coverage.required} 条，已加载 ${coverage.loaded} 条，缺：${coverage.missing.slice(0, 20).join('、')}${coverage.missing.length > 20 ? ' 等' : ''}`);
        lines.push('（缺项请用 request_context 按 ID 精确补充，不要凭记忆编造。）');
    }

    if (session.unloaded.length > 0) {
        lines.push(`【预算未加载】${session.unloaded.slice(0, 20).join('、')}${session.unloaded.length > 20 ? ' 等' : ''}（需要时请缩小场景范围或分批生成。）`);
    }

    if (options.includeSummary !== false) {
        lines.push(`【会话状态】${renderSessionSummary(session).replace(/\n/g, '；')}`);
    }

    return lines.join('\n');
}

/**
 * 估算渲染后段落的 token。
 *
 * @param text - 渲染结果
 * @returns 估算 token
 */
export function sceneContextTokens(text: string): number {
    return Math.ceil(String(text ?? '').length / 2);
}
