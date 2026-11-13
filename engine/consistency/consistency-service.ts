/**
 * consistency-service.ts — 把审核链路接到项目数据上（S2 收口 / S4 的前置）
 *
 * 分层原则：本文件只依赖**注入的数据访问**（ConsistencyAuditDeps），
 * 不直接摸 Obsidian / 插件实例，因此：
 *  - 可以在单测里用假依赖跑完整链路；
 *  - 真正的接线（读 vault、调 AI）放在 `wiring/consistency-audit-wiring.ts`。
 *
 * 流程：
 *   1. 读章节摘要 / 人物档案 / 台账事件 / 已确认事实 → 抽断言
 *   2. 与既有断言库合并落盘（读失败则拒绝覆盖，返回原因）
 *   3. 规则层 + 可选 LLM 复核 → 矛盾报告
 *   4. 用章节正文补 offset → 落盘报告
 */

import type { FileSystemPort } from '@/shared/file-system-port';
import { pjConsistencyDir, pjContradictionsFile } from '@/shared/paths';
import { withWriteLock } from '@/shared/write-lock';
import type { ChapterDigest } from '@/engine/memory/chapter-digest';
import {
    loadAssertions,
    mergeAndSaveAssertions,
    writeTextAtomic,
} from './assertion-store';
import { extractAssertions } from './assertion-extract';
import type { FactAssertion } from './assertion-model';
import { runAudit, type AuditReport, type ChapterBody } from './audit-pipeline';
import type { LlmCaller } from './pairing-llm';

/** 人物档案（最小形状） */
export interface CharacterProfileInput {
    name: string;
    frontmatter: Record<string, unknown>;
}

/** 台账事件（最小形状） */
export interface LedgerEventInput {
    name: string;
    time?: string;
    location?: string;
    chapterKey?: string;
    chapterNum?: number | null;
    raw?: string;
}

/** 已确认事实（命名基准） */
export interface ConfirmedFactInput {
    name: string;
    category: string;
}

/** 审核所需的数据访问能力（由接线层实现） */
export interface ConsistencyAuditDeps {
    /** 列出项目内全部章节摘要 */
    listDigests(): Promise<ChapterDigest[]>;
    /** 列出人物档案 */
    listCharacters(): Promise<CharacterProfileInput[]>;
    /** 列出结构化台账事件 */
    listLedgerEvents(): Promise<LedgerEventInput[]>;
    /** 列出已人工确认的事实 */
    listConfirmedFacts(): Promise<ConfirmedFactInput[]>;
    /** 读章节正文（用于把引文定位成偏移；失败返回空串即可） */
    loadChapterBody(chapterKey: string): Promise<string>;
    /** 按正文目录枚举全部章节正文（无摘要项目也能做正文级检查） */
    listBodies?(): Promise<Array<{ chapterKey: string; body: string }>>;
    /** 收集「数据源缺失」类告警（不允许静默当作没数据） */
    warn?(message: string): void;
    /** 文件系统端口（断言库/报告落盘） */
    fs: FileSystemPort;
    /** 可选的 LLM 复核器 */
    callLLM?: LlmCaller;
}

/** 审核选项 */
export interface ConsistencyAuditOptions {
    /** 启用 LLM 复核（需要 deps.callLLM） */
    useLlm?: boolean;
    /** 最大复核对数 */
    maxPairs?: number;
    /** 最低置信度 */
    minConfidence?: number;
    /** 已废弃伏笔（由接线层从台账取；缺省不查） */
    abandonedPlots?: ReadonlyArray<{ name: string; quote: string; chapterKey: string }>;
}

/** 审核执行结果 */
export interface ConsistencyAuditResult {
    /** 报告 */
    report: AuditReport;
    /** 断言库总量 */
    assertionTotal: number;
    /** 本次新增断言数 */
    assertionAdded: number;
    /** 断言库是否成功落盘（false 表示读失败被拒，历史未被覆盖） */
    assertionsSaved: boolean;
    /** 断言库落盘失败原因 */
    assertionsError?: string;
    /** 报告是否成功落盘 */
    reportSaved: boolean;
    /** 报告落盘失败原因 */
    reportError?: string;
}

/**
 * 跑一次项目级一致性审核。
 *
 * @param project - 项目路径
 * @param deps - 数据访问依赖
 * @param options - 选项
 * @param now - 时间戳（测试可注入）
 * @returns 审核结果
 */
export async function runProjectConsistencyAudit(
    project: string,
    deps: ConsistencyAuditDeps,
    options: ConsistencyAuditOptions = {},
    now: () => Date = () => new Date(),
): Promise<ConsistencyAuditResult> {
    const [digests, characters, events, confirmed] = await Promise.all([
        deps.listDigests(),
        deps.listCharacters(),
        deps.listLedgerEvents(),
        deps.listConfirmedFacts(),
    ]);

    // 1) 抽断言
    const incoming: FactAssertion[] = [];
    for (const digest of digests) {
        incoming.push(...extractAssertions({
            chapterKey: digest.chapterKey,
            chapterNum: digest.chapterNum,
            digest,
            events: events.filter(e => (e.chapterKey ?? '') === digest.chapterKey),
        }));
    }
    for (const character of characters) {
        incoming.push(...extractAssertions({
            chapterKey: '',
            chapterNum: null,
            character,
        }));
    }
    if (confirmed.length > 0) {
        incoming.push(...extractAssertions({
            chapterKey: '',
            chapterNum: null,
            confirmedFacts: confirmed,
        }));
    }

    // 2) 合并落盘（读失败则保留历史并报告）
    const mergeResult = await mergeAndSaveAssertions(deps.fs, project, incoming);

    // 3) 用「落盘后的全量断言」做配对（不只用本次新增，否则跨批次矛盾抓不到）
    const loaded = await loadAssertions(deps.fs, project);
    const allAssertions = loaded.status === 'ok' ? loaded.assertions : incoming;

    // 4) 取章节正文用于定位与正文级检查
    //
    // 修（2026-11-13 真实原著验证）：旧实现只在 digest 列表上迭代取正文，
    // 于是一个**没有章节摘要**的项目（例如刚导入的原著）会得到 0 条正文——
    // 连不依赖摘要的「视角混乱」也跑不了，且报告显示 0 矛盾，用户会误以为没问题。
    // 现在：优先用 deps.listBodies()（按正文目录枚举），退化为按 digest 逐个读。
    const bodies: ChapterBody[] = [];
    if (deps.listBodies) {
        const listed = await deps.listBodies().catch(() => [] as ChapterBody[]);
        for (const item of listed) {
            if (item && item.chapterKey && item.body) bodies.push(item);
        }
    }
    if (bodies.length === 0) {
        for (const digest of digests) {
            const body = await deps.loadChapterBody(digest.chapterKey).catch(() => '');
            if (body) bodies.push({ chapterKey: digest.chapterKey, body });
        }
    }
    // 无摘要时显式告警：否则「0 矛盾」会被误解成「没问题」
    if (digests.length === 0) {
        deps.warn?.('未找到章节摘要（04-项目总控/剧情记忆），本次未做事实比对，仅做正文级检查（视角等）。');
    }

    // 5) 跑审核
    // 原始事实文本：供扩展规则扫「违规句/化名等未成断言」的场景
    const factTexts = digests.flatMap(d => (d.facts ?? []).map(fact => ({
        chapterKey: d.chapterKey,
        chapterNum: d.chapterNum,
        text: fact,
        quote: fact,
    })));

    const report = await runAudit({
        assertions: allAssertions,
        chapters: bodies,
        factTexts,
        abandonedPlots: options.abandonedPlots,
        llm: options.useLlm && deps.callLLM
            ? {
                caller: deps.callLLM,
                maxPairs: options.maxPairs,
                minConfidence: options.minConfidence,
            }
            : undefined,
    }, now);

    // 6) 落盘报告
    const reportOutcome = await saveReport(deps.fs, project, report);

    return {
        report,
        assertionTotal: mergeResult.total,
        assertionAdded: mergeResult.added,
        assertionsSaved: mergeResult.saved,
        assertionsError: mergeResult.reason,
        reportSaved: reportOutcome.saved,
        reportError: reportOutcome.reason,
    };
}

/**
 * 落盘审核报告（临时文件 + rename，持锁）。
 *
 * @param fs - 文件系统端口
 * @param project - 项目路径
 * @param report - 报告
 * @returns 落盘结果
 */
export async function saveReport(
    fs: FileSystemPort,
    project: string,
    report: AuditReport,
): Promise<{ saved: boolean; reason?: string }> {
    const path = pjContradictionsFile(project);
    try {
        await withWriteLock(path, async () => {
            // silent-ok: 目录已存在是正常情况；真的建不出来会在 write 抛错时暴露
            await fs.mkdir(pjConsistencyDir(project)).catch(() => undefined);
            // 目标已存在时必须覆盖（直接 rename 会抛 Destination file already exists）
            await writeTextAtomic(fs, path, JSON.stringify(report, null, 2));
        });
        return { saved: true };
    } catch (error) {
        return { saved: false, reason: error instanceof Error ? error.message : String(error) };
    }
}
