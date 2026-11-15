/**
 * context-tools.ts — 迭代上下文相关 Agent 工具
 *
 * request_context：模型发现信息不足时，按类别 + ID/过滤条件精确补充上下文。
 * 只做精确检索（不模糊），结果记入会话批次。
 */

import type { HarnessTool } from './harness-types';
import { parseContextRequest, renderSessionSummary, type ContextSession } from '@/shared/context-session-model';
import type { ContextSessionService } from '@/services/context-session-service';

/**
 * 创建上下文工具集。
 *
 * @param getService - 取装配服务
 * @param getProject - 取当前项目
 * @param getSession - 取当前会话（可为空）
 * @returns 工具数组
 */
export function createContextTools(
    getService: () => ContextSessionService | null,
    getProject: () => string,
    getSession: () => ContextSession | null,
): HarnessTool[] {
    return [
        {
            name: 'request_context',
            kind: 'read',
            description: '补充上下文：按类别 + ID（或过滤条件）精确取事实，用于发现信息不足时补充，避免凭记忆编造。只做精确匹配，不做模糊搜索。',
            parameters: {
                kind: {
                    type: 'string',
                    description: '类别',
                    enum: ['entity', 'relation', 'foreshadow', 'timeline', 'setting', 'worldview', 'assertion', 'scene', 'chapter', 'rag'],
                    required: true,
                },
                ids: { type: 'array', items: 'string', description: '精确 ID 列表（如 CHR-0001、REL-0003）' },
                filter: { type: 'object', description: '过滤条件（如 {status:"planted"}）' },
                reason: { type: 'string', description: '为什么需要（写入批次账本）' },
            },
            required: ['kind'],
            sideEffect: 'none',
            timeoutMs: 20_000,
            execute: async (args) => {
                const parsed = parseContextRequest(args);
                if (!parsed.request) return { ok: false, content: `参数错误：${parsed.error}` };
                const service = getService();
                const project = getProject();
                if (!service) return { ok: false, content: '当前环境不支持上下文补充' };
                if (!project) return { ok: false, content: '请先打开一个项目' };
                const request = parsed.request;
                const ids = request.ids ?? [];
                if (ids.length === 0) {
                    return { ok: false, content: '当前仅支持按 ids 精确补充；filter 形式待接入索引过滤。' };
                }
                const session = getSession() ?? service.create({});
                const next = await service.loadBatch(project, session, { kind: request.kind, ids }, 'model-request');
                const added = Object.keys(next.loaded).length - Object.keys(session.loaded).length;
                const body = ids
                    .map(id => next.loaded[`${request.kind}:${id}`])
                    .filter(Boolean)
                    .map(item => `【${item!.title}】\n${item!.text}`)
                    .join('\n\n');
                return {
                    ok: true,
                    content: added > 0
                        ? `已补充 ${added} 条（${request.reason}）：\n${body}`
                        : `未新增内容（可能已在上下文中）：${ids.join('、')}`,
                    data: { added, session: renderSessionSummary(next) },
                };
            },
        },
    ];
}
