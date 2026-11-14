/**
 * attachment-tools.ts — 附件读取工具
 *
 * read_attachment：读附件。文本类返回正文；图片/文档返回元信息（由宿主决定是否多模态）。
 */

import type { HarnessTool } from './harness-types';
import type { AttachmentService } from '@/services/attachment-service';

/**
 * 创建附件工具集。
 *
 * @param getService - 取附件服务
 * @returns 工具数组
 */
export function createAttachmentTools(getService: () => AttachmentService | null): HarnessTool[] {
    return [
        {
            name: 'read_attachment',
            kind: 'read',
            description: '读取项目附件（04-项目总控/附件/）。文本类（txt/md/csv/json）返回正文；图片/文档返回大小与类型，需要时由用户确认是否按图片理解。',
            parameters: {
                path: { type: 'string', description: '附件路径（消息里的 [附件](路径) 可复制）', required: true },
            },
            required: ['path'],
            sideEffect: 'none',
            timeoutMs: 15_000,
            execute: async (args) => {
                const service = getService();
                if (!service) return { ok: false, content: '当前环境不支持读取附件' };
                const path = String(args.path || '').trim();
                const result = await service.read(path);
                if (!result) return { ok: false, content: `找不到附件「${path}」` };
                if (result.kind === 'text' && typeof result.text === 'string') {
                    return {
                        ok: true,
                        content: `【${result.path}】（${result.size} 字节）\n${result.text}`,
                        data: { path: result.path, kind: result.kind, size: result.size },
                    };
                }
                return {
                    ok: true,
                    content: `【${result.path}】${result.kind === 'image' ? '图片' : '文档'}，${result.size} 字节。需要看内容请让用户确认按图片/文档理解。`,
                    data: { path: result.path, kind: result.kind, size: result.size },
                };
            },
        },
    ];
}
