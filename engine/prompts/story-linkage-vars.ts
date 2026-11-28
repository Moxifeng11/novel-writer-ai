/**
 * story-linkage-vars.ts — 关联索引变量的终态装配（Rev 186 接入活路径）。
 *
 * 历史：该特性原本只落在死路径 ai-prompt-builder（「有 linkage 则注入
 * 【关联索引】并替代平铺伏笔/时间线」），活模板从未有 ${storyLinkage}
 * 占位符——数据流到 buildStoryContext 即断。2026-11-28 接入四个正文
 * 用户模板（V2/V3/V4/pipeline），装配语义由本文件承载。
 */
import type { StoryLinkage } from '@/engine/story-linkage';

/**
 * 关联索引变量的终态装配。
 *
 * 语义沿用原 ai-prompt-builder（2026-11-28 随死代码清理删除）的实现：
 * - 有 linkage（promptText ≤1800 字）→ 注入【关联索引】，并把平铺的
 *   伏笔/时间线两段替换为短注记——索引已按章去重并与设定库/全书规划交叉，
 *   重复平铺只浪费预算；注记保留标题下的指令语境（如「本章时间不得倒流」），
 *   并告知模型去索引中找本章条目。
 * - 无 linkage → storyLinkage 置空（模板占位符静默消失），平铺清单原样保留。
 * - forcedRevealHint 不受影响（本章必须揭示的伏笔永远显式列出）。
 *
 * @param vars - 模板变量表（就地修改）
 * @param linkage - context.data.story_linkage（可能为 null）
 * @returns 无（就地写 vars）
 * @example
 * finalizeStoryLinkageVars(vars, context.data.story_linkage);
 */
export function finalizeStoryLinkageVars(
    vars: Record<string, string>,
    linkage: Pick<StoryLinkage, 'promptText'> | null | undefined,
): void {
    const text = String(linkage?.promptText || '').trim();
    if (!text) {
        vars['storyLinkage'] = '';
        return;
    }
    vars['storyLinkage'] = `【关联索引（本章时间线/伏笔与设定库、规划的交叉关联；下方平铺清单已并入此处）】\n${text.slice(0, 1800)}`;
    vars['timelineEvents'] = '（本章时间线已并入上方【关联索引】）';
    vars['unrevealedForeshadow'] = '（伏笔已并入上方【关联索引】，按其中本章相关条目处理）';
}
