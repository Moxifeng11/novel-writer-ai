/**
 * context-readiness.ts — 上下文输入清单与完整性判定
 *
 * Rev 185：上下文加载步骤原先只在成功后无条件标 complete，界面也只显示一句
 * 「✅ 上下文已加载完成」。用户看不到「到底喂了什么」，也无法判断这些输入
 * 对本章是否够用。本模块把上下文数据转成可展示、可判定的清单：
 *   - 每项：条数 / 字符数 / 是否必做 / 是否已加载
 *   - 结论：必做项是否齐全（人物、大纲、世界观或设定库、非首章的前章摘要）
 *
 * 纯函数、不依赖 Obsidian，便于单测与 UI 复用。
 */
import type {
    GatheredContext,
    CharacterData,
    ForeshadowData,
    TimelineEvent,
    PreviousChapterData,
    WritingRules,
    MarkdownContent,
} from './context/context-types';
import type { CharacterSoul } from './character-soul';
import type { StoryLinkage } from './story-linkage';

export interface ContextInputItem {
    key: string;
    label: string;
    /** 条数（人物/地点/事件/伏笔等结构化数据） */
    count: number;
    /** 字符数（文档类输入） */
    chars: number;
    required: boolean;
    ok: boolean;
    /** 展示用摘要，如「28 人」「1,234 字」「未加载」 */
    detail: string;
}

export interface ContextReadiness {
    items: ContextInputItem[];
    readyCount: number;
    requiredMissing: string[];
    ready: boolean;
    summary: string;
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function markdownChars(value: unknown): number {
    const raw = (value as MarkdownContent | null | undefined)?.raw;
    return typeof raw === 'string' ? raw.length : 0;
}

function formatChars(chars: number): string {
    if (chars <= 0) return '未加载';
    return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k 字` : `${chars} 字`;
}

function countItem(
    key: string,
    label: string,
    count: number,
    required: boolean,
    detail?: string,
): ContextInputItem {
    return {
        key,
        label,
        count,
        chars: 0,
        required,
        ok: count > 0,
        detail: detail ?? (count > 0 ? `${count} 条` : '未加载'),
    };
}

function docItem(
    key: string,
    label: string,
    chars: number,
    required: boolean,
    emptyHint = '未加载',
): ContextInputItem {
    return {
        key,
        label,
        count: 0,
        chars,
        required,
        ok: chars > 0,
        detail: chars > 0 ? formatChars(chars) : emptyHint,
    };
}

/**
 * 评估上下文输入对当前章节的完整性。
 *
 * @param context gatherAll 的结果（null 表示尚未加载/加载失败）
 * @param chapterNum 当前章号（用于首章豁免「前章摘要」）
 */
export function assessContextReadiness(
    context: GatheredContext | null,
    chapterNum = 0,
): ContextReadiness {
    const data = context?.data;
    const items: ContextInputItem[] = [];

    // ── 必做输入 ──
    const characters = asArray<CharacterData>(data?.character_state);
    items.push(countItem('character_state', '人物状态', characters.length, true,
        characters.length > 0 ? `${characters.length} 人` : '未加载（本章无法保证人物一致）'));

    const outlineChars = markdownChars(data?.outline);
    items.push(docItem('outline', '章节/分卷大纲', outlineChars, true,
        '未加载（正文可能偏离分卷规划）'));

    const worldChars = markdownChars(data?.world_view);
    const settingChars = markdownChars(data?.setting_lib);
    const worldSettingOk = worldChars + settingChars > 0;
    items.push({
        key: 'world_setting',
        label: '世界观 / 设定库',
        count: 0,
        chars: worldChars + settingChars,
        required: true,
        ok: worldSettingOk,
        detail: worldSettingOk
            ? `世界观 ${formatChars(worldChars)} · 设定库 ${formatChars(settingChars)}`
            : '未加载（能力/物品/地理可能越界）',
    });

    const prev = data?.previous_chapter as PreviousChapterData | null | undefined;
    const prevChars = [prev?.ending, prev?.bodySummary, prev?.content, prev?.outline]
        .filter((v): v is string => typeof v === 'string')
        .reduce((sum, v) => sum + v.length, 0);
    const prevRequired = chapterNum > 1;
    items.push({
        key: 'previous_chapter',
        label: '前章摘要 / 上章结尾',
        count: prev ? 1 : 0,
        chars: prevChars,
        required: prevRequired,
        ok: prevChars > 0,
        detail: prevChars > 0 ? formatChars(prevChars) : (prevRequired ? '未加载（衔接可能断裂）' : '首章无需'),
    });

    // ── 可选输入（缺失只提示，不阻塞） ──
    const souls = asArray<CharacterSoul>(data?.character_cores);
    const soulCount = souls.filter((s) => s.hasSoul).length;
    items.push(countItem('character_cores', '角色灵魂层', soulCount, false,
        soulCount > 0 ? `${soulCount}/${souls.length} 人有完整灵魂` : '未提取'));

    items.push(countItem('locations', '地点', asArray(data?.locations).length, false));
    items.push(countItem('factions', '势力', asArray(data?.factions).length, false));
    items.push(countItem('items', '物品功法', asArray(data?.items).length, false));

    const foreshadows = data?.foreshadows as ForeshadowData | undefined;
    const unrevealed = foreshadows?.unrevealed?.length ?? 0;
    const revealed = foreshadows?.revealed?.length ?? 0;
    items.push(countItem('foreshadows', '伏笔库', unrevealed + revealed, false,
        unrevealed + revealed > 0 ? `${unrevealed} 未揭示 / ${revealed} 已揭示` : '未加载'));

    items.push(countItem('timeline', '时间线', asArray<TimelineEvent>(data?.timeline).length, false));

    // Rev 186：时间线/伏笔与设定库、全书规划的关联索引（可选，缺失不阻塞）
    const linkage = data?.story_linkage as StoryLinkage | null | undefined;
    const linkageActive = Boolean(linkage && (
        linkage.due.length + linkage.overdue.length + linkage.upcoming.length
        + linkage.timeline.length + linkage.settingHits.length + linkage.planningRefs.length > 0
    ));
    const linkageCount = linkage ? linkage.due.length + linkage.overdue.length + linkage.upcoming.length : 0;
    items.push({
        key: 'story_linkage',
        label: '关联索引（伏笔/时间线↔设定/规划）',
        count: linkageCount,
        chars: linkage?.promptText?.length ?? 0,
        required: false,
        ok: linkageActive,
        detail: linkageActive && linkage
            ? `到期 ${linkage.due.length} · 逾期 ${linkage.overdue.length} · 设定 ${linkage.settingHits.length} 条 · 规划 ${linkage.planningRefs.length} 段${linkage.warnings.length > 0 ? `（${linkage.warnings.length} 条数据提示）` : ''}`
            : (linkage ? '无可关联条目' : '未建立（可在关联看板生成）'),
    });

    const styleChars = markdownChars(data?.writing_style);
    items.push(docItem('writing_style', '文笔风格', styleChars, false));

    const rules = data?.writing_rules as WritingRules | null | undefined;
    const ruleCount = rules?.mandatory?.length ?? 0;
    items.push(countItem('writing_rules', '写作规则', ruleCount, false,
        ruleCount > 0 ? `${ruleCount} 条硬规则` : '未加载'));

    const emotionChars = markdownChars(data?.emotion_plan);
    items.push(docItem('emotion_plan', '情绪规划（本章）', emotionChars, false));

    const sceneChars = markdownChars(data?.scene_expansion);
    items.push(docItem('scene_expansion', 'Scene 展开（本章）', sceneChars, false));

    const memories = asArray(data?.triggered_memories);
    items.push(countItem('triggered_memories', '触发记忆', memories.length, false));

    const compressed = data?.compressed;
    items.push({
        key: 'compressed',
        label: '上下文压缩',
        count: 0,
        chars: 0,
        required: false,
        ok: Boolean(compressed),
        detail: compressed
            ? (compressed.truncationApplied ? '已压缩（有截断）' : '已压缩（无截断）')
            : '未启用',
    });

    const failed = asArray<string>(data?._failedModules);
    items.push({
        key: 'failed_modules',
        label: '加载失败模块',
        count: failed.length,
        chars: 0,
        required: false,
        ok: failed.length === 0,
        detail: failed.length === 0 ? '无' : failed.join('、'),
    });

    const requiredItems = items.filter((i) => i.required);
    const requiredMissing = requiredItems.filter((i) => !i.ok).map((i) => i.label);
    const readyCount = items.filter((i) => i.ok).length;
    const ready = requiredMissing.length === 0;

    const summary = ready
        ? `输入完整：${readyCount}/${items.length} 项已加载，必做 ${requiredItems.length}/${requiredItems.length} 项齐全`
        : `输入不完整：必做缺少 ${requiredMissing.join('、')}（已加载 ${readyCount}/${items.length} 项）`;

    return { items, readyCount, requiredMissing, ready, summary };
}
