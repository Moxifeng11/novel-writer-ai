/**
 * p2-tools.ts — P2 新增 Agent 工具（文件 patch / 章节 / 设定 / 统一打开视图）
 *
 * 与 host-tools 分开存放：新能力按领域成模块，避免单文件继续膨胀。
 * 工具只做「参数整理 + 端口调用 + 结果摘要」，业务校验在端口背后。
 */

import type { GuideAgentPort } from '@/engine/agent/agent-types';
import type { HarnessTool } from './harness-types';
import { wrapUntrustedContent } from '@/shared/untrusted-content';

/** P2 工具依赖 */
export interface P2ToolDeps {
    port: GuideAgentPort;
}

/**
 * 创建 P2 工具集。
 *
 * @param deps - 依赖
 * @returns 工具数组
 */
export function createP2Tools(deps: P2ToolDeps): HarnessTool[] {
    const { port } = deps;
    const tools: HarnessTool[] = [];

    tools.push({
        name: 'patch_file',
        kind: 'write-setting',
        description: '局部替换文件中的一段内容（不整文件覆盖）。oldText 必须在文件里唯一出现；newText 为空表示删除该段。适合改设定、改一句话，避免覆盖作者其它段落。',
        parameters: {
            path: { type: 'string', description: '库内相对路径', required: true },
            oldText: { type: 'string', description: '要替换的原文（需唯一出现）', required: true },
            newText: { type: 'string', description: '替换后的文本；空字符串=删除该段', required: true },
        },
        required: ['path', 'oldText', 'newText'],
        sideEffect: 'write',
        timeoutMs: 15_000,
        execute: async (args) => {
            if (!port.patchFile) return { ok: false, content: '当前环境不支持局部替换' };
            const path = String(args.path || '').trim();
            const result = await port.patchFile(path, String(args.oldText ?? ''), String(args.newText ?? ''));
            if (!result.changed) {
                return { ok: false, content: `未修改「${path}」：${result.error || '内容无变化'}` };
            }
            return { ok: true, content: `已局部替换「${path}」。`, data: { path } };
        },
    });

    tools.push({
        name: 'read_chapter',
        kind: 'read',
        description: '读取指定章节的正文全文（不是分页片段）。用于通读一章后再修改/续写；章节名可用 list_chapters 得到的名字。',
        parameters: {
            project: { type: 'string', description: '项目路径（省略用当前项目）' },
            chapter: { type: 'string', description: '章节名（如「第1章」）', required: true },
        },
        required: ['chapter'],
        sideEffect: 'none',
        timeoutMs: 15_000,
        execute: async (args) => {
            if (!port.readChapter) return { ok: false, content: '当前环境不支持读取章节' };
            const project = String(args.project || '').trim();
            const chapter = String(args.chapter || '').trim();
            const result = await port.readChapter(project, chapter);
            if (!result) return { ok: false, content: `找不到章节「${chapter}」` };
            return {
                ok: true,
                content: wrapUntrustedContent(`【${result.path}】\n${result.content}`),
                data: { path: result.path, length: result.content.length },
            };
        },
    });

    tools.push({
        name: 'write_chapter',
        kind: 'write-prose',
        description: '写入指定章节的正文全文（覆盖）。仅用于用户明确要求整章重写；局部修改请用 patch_file。',
        parameters: {
            project: { type: 'string', description: '项目路径（省略用当前项目）' },
            chapter: { type: 'string', description: '章节名', required: true },
            content: { type: 'string', description: '新的正文全文', required: true },
        },
        required: ['chapter', 'content'],
        sideEffect: 'dangerous',
        timeoutMs: 30_000,
        execute: async (args) => {
            if (!port.writeChapter) return { ok: false, content: '当前环境不支持写入章节' };
            const result = await port.writeChapter(
                String(args.project || '').trim(),
                String(args.chapter || '').trim(),
                String(args.content ?? ''),
            );
            if (!result.ok) return { ok: false, content: `写入失败：${result.error || '未知原因'}` };
            return { ok: true, content: `已写入「${result.path}」。`, data: { path: result.path } };
        },
    });

    tools.push({
        name: 'memory_search',
        kind: 'read',
        description: '检索设定卡（人物/地点/势力/物品/设定）。用于写正文前核对人设与设定，避免前后矛盾。',
        parameters: {
            query: { type: 'string', description: '关键词（名称或摘要片段）' },
            limit: { type: 'number', description: '最多返回条数（默认 20）' },
        },
        required: [],
        sideEffect: 'none',
        timeoutMs: 10_000,
        execute: async (args) => {
            if (!port.memorySearch) return { ok: false, content: '当前环境不支持设定检索' };
            const project = String(args.project || '').trim();
            const cards = await port.memorySearch(project, String(args.query || ''), Number(args.limit) || 20);
            if (cards.length === 0) return { ok: true, content: '没有匹配的设定卡。', data: { count: 0 } };
            const lines = cards.map(card => `- ${card.name}（${card.type}）${card.summary ? `：${card.summary}` : ''}\n  路径：${card.path}`);
            return {
                ok: true,
                content: wrapUntrustedContent(`匹配到 ${cards.length} 张设定卡：\n${lines.join('\n')}`),
                data: { count: cards.length },
            };
        },
    });

    tools.push({
        name: 'memory_patch',
        kind: 'write-setting',
        description: '局部修改设定卡内容（唯一匹配替换；newText 为空=删除该段）。改设定优先用它，不要整卡重写。',
        parameters: {
            path: { type: 'string', description: '设定卡路径（memory_search 可查）', required: true },
            oldText: { type: 'string', description: '要替换的原文（需唯一出现）', required: true },
            newText: { type: 'string', description: '替换后的文本；空字符串=删除该段', required: true },
        },
        required: ['path', 'oldText', 'newText'],
        sideEffect: 'write',
        timeoutMs: 15_000,
        execute: async (args) => {
            if (!port.memoryPatch) return { ok: false, content: '当前环境不支持设定卡修改' };
            const result = await port.memoryPatch(
                String(args.path || '').trim(),
                String(args.oldText ?? ''),
                String(args.newText ?? ''),
            );
            if (!result.changed) return { ok: false, content: `未修改：${result.error || '内容无变化'}` };
            return { ok: true, content: '设定卡已局部替换。' };
        },
    });

    tools.push({
        name: 'open_view',
        kind: 'read',
        description: '统一打开插件视图：planning（规划画布）/ memory（设定实体图）/ wizard（项目向导）/ flow（创作流程）/ full-writer（写作工作台）/ story-settings / pre-research / co-writing。',
        parameters: {
            viewId: {
                type: 'string',
                description: '视图 id',
                enum: ['planning', 'memory', 'wizard', 'flow', 'full-writer', 'story-settings', 'pre-research', 'co-writing'],
                required: true,
            },
            project: { type: 'string', description: '项目路径（省略用当前项目）' },
        },
        required: ['viewId'],
        sideEffect: 'none',
        timeoutMs: 10_000,
        execute: async (args) => {
            if (!port.openView) return { ok: false, content: '当前环境不支持打开视图' };
            const viewId = String(args.viewId || '').trim();
            const ok = await port.openView(viewId, String(args.project || '').trim());
            return ok
                ? { ok: true, content: `已打开视图「${viewId}」。` }
                : { ok: false, content: `无法打开视图「${viewId}」，可用：planning/memory/wizard/flow/full-writer/story-settings/pre-research/co-writing` };
        },
    });

    return tools;
}
