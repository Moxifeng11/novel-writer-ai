/**
 * fanfic-knowledge-draft.ts — 「知识库素材 → 同人设定草稿 → 联网验证」的纯逻辑
 *
 * 需求（2026-11-11 用户）：同人设定可以先由**知识库里已拆解的内容**生成，
 * 再用**联网搜索**验证，通过后补进同人设定库。
 *
 * 与既有流程的分工：
 * - `add-fanfic-setting-modal` 原有生成只吃「联网检索到的 sources」；
 *   本模块补上「知识库拆解产物」这一路素材。
 * - 设定骨架（`buildFanficSettingsContent`）、审核（`auditFanficSettings`）、
 *   待审核落盘（`_待审核/`）全部复用，不另起一套。
 *
 * 这里只做纯转换：素材围栏、prompt 组装、验证报告解析、meta 写入。
 * 检索、LLM 调用、联网搜索由调用方（UI）编排。
 */
import { wrapUntrustedContent } from '@/shared/untrusted-content';
import { applyFanficReviewMeta } from '@/shared/fanfic-audit';

/** 一条知识库素材（由调用方从 RAG 命中映射而来） */
export interface KnowledgeMaterial {
    /** 素材来源书名（拆解过的那本书） */
    bookName: string;
    /** 拆解维度（character / style / foreshadow …） */
    dimension: string;
    /** 正文片段 */
    sample: string;
    /** 相关度（0–1），用于排序与展示 */
    score?: number;
}

/** 联网验证的结论分类 */
export interface VerificationReport {
    /** 有来源支持的字段/陈述 */
    supported: string[];
    /** 来源未提及、无法确认的 */
    unverified: string[];
    /** 与来源矛盾的（必须改） */
    contradicted: string[];
    /** 模型原始输出（留档排查） */
    raw: string;
}

/** 验证整体结论 */
export type VerificationVerdict = 'pass' | 'partial' | 'fail' | 'unknown';

/**
 * 把知识库素材格式化成 prompt 素材块。
 *
 * 每条带「书名·维度」标注并围栏——拆解报告本身是二手提炼，仍属外部内容，
 * 进 prompt 前必须围栏（与 S3-2 对原著摘录的处理一致）。
 *
 * @param materials - 素材列表
 * @param maxChars - 字符预算
 * @returns prompt 素材文本；无素材返回空串
 */
export function formatKnowledgeMaterialsForPrompt(materials: KnowledgeMaterial[], maxChars = 12000): string {
    if (materials.length === 0) return '';
    const sorted = [...materials].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const lines: string[] = [];
    let used = 0;
    for (const material of sorted) {
        const text = material.sample.trim();
        if (!text) continue;
        const budget = Math.max(0, Math.min(text.length, maxChars - used));
        if (budget <= 0) break;
        const excerpt = text.slice(0, budget);
        lines.push(`〔${material.bookName}·${material.dimension}〕\n${wrapUntrustedContent(excerpt, '知识库拆解素材')}`);
        used += excerpt.length;
    }
    return lines.join('\n\n');
}

/**
 * 组装「用知识库素材生成同人设定草稿」的 prompt。
 *
 * 关键约束：素材是**拆解报告**（二手提炼），不是原著原文，因此要求模型
 * 只能据此整理、不得扩写推断；无依据处仍写「待核实」。
 *
 * @param workName - 原作名
 * @param skeleton - 设定文件骨架
 * @param materials - 知识库素材
 * @returns system / user 两段 prompt
 */
export function buildKnowledgeDraftPrompt(
    workName: string,
    skeleton: string,
    materials: KnowledgeMaterial[],
): { system: string; user: string } {
    const materialBlock = formatKnowledgeMaterialsForPrompt(materials);
    const system = `你是一位严谨的同人设定整理助手。你只能使用下面提供的**知识库拆解素材**来整理设定。

【素材性质】
这些素材来自对参考书的自动拆解（维度化提炼），属于**二手材料**，不是原著原文。因此：
1. 只能整理素材里明确出现的信息，不得补全、推断或扩写。
2. 素材没提到的字段，写「待核实（知识库素材未覆盖）」。
3. 不得引用同人、改编、外传等衍生作品作为依据。

【硬性规则】
1. 严格保留骨架的 YAML frontmatter 键名、二级标题、加粗字段名和两张表格的列名。
2. 每处填写的内容后标注素材来源，例如 〔书名·维度〕。
3. 只输出完整文件内容，不要解释或代码块围栏。

【知识库拆解素材】
${materialBlock || '（知识库没有可用素材）'}`;

    const user = `请为《${workName}》整理同人设定草稿。\n\n【文件骨架】\n${skeleton}`;
    return { system, user };
}

/**
 * 组装「用联网来源验证草稿」的 prompt。
 *
 * 验证目标是找出草稿里**没有来源支撑**或**与来源矛盾**的条目，
 * 而不是重写草稿——重写会让验证结论与草稿脱节。
 *
 * @param draftContent - 草稿正文
 * @param canonPromptText - 已格式化的官方/二手来源块
 * @returns system / user 两段 prompt
 */
export function buildVerificationPrompt(
    draftContent: string,
    canonPromptText: string,
): { system: string; user: string } {
    const system = `你是同人设定审核员。请用下面提供的联网检索来源，核对草稿里的每条设定。

【判定口径】
- supported：来源中有明确依据（引用来源编号）
- unverified：来源未提及，无法确认
- contradicted：与来源明确矛盾（必须指出矛盾点）

【硬性规则】
1. 只依据下面列出的来源判断，不得使用模型记忆。
2. 每条结论一行，格式：\`分类 | 设定条目 | 依据或说明\`
3. 分类只能是 supported / unverified / contradicted。
4. 最后单独一行输出：\`结论：pass\`（全部 supported）、\`结论：partial\`（有 unverified 但无 contradicted）、\`结论：fail\`（存在 contradicted）。
5. 不要输出草稿全文，不要改写草稿。

【联网检索来源】
${canonPromptText || '（没有检索到可用来源）'}`;

    const user = `请核对以下同人设定草稿：\n\n${draftContent}`;
    return { system, user };
}

/**
 * 解析验证报告。
 *
 * 宽容解析：格式不规范的行走 `unverified`，避免「解析失败 = 全部通过」的危险默认。
 *
 * @param text - 模型输出
 * @returns 分类后的验证结论
 */
export function parseVerificationReport(text: string): VerificationReport {
    const report: VerificationReport = { supported: [], unverified: [], contradicted: [], raw: String(text || '') };
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('结论')) continue;
        const match = line.match(/^(supported|unverified|contradicted)\s*[|｜]\s*(.+)$/i);
        if (!match) continue;
        const category = match[1].toLowerCase();
        const body = match[2].trim();
        if (!body) continue;
        if (category === 'supported') report.supported.push(body);
        else if (category === 'contradicted') report.contradicted.push(body);
        else report.unverified.push(body);
    }
    return report;
}

/**
 * 从验证报告推出整体结论。
 *
 * @param report - 验证报告
 * @returns pass / partial / fail / unknown（没有任何条目时 unknown）
 */
export function verdictOf(report: VerificationReport): VerificationVerdict {
    if (report.contradicted.length > 0) return 'fail';
    if (report.supported.length === 0 && report.unverified.length === 0) return 'unknown';
    if (report.unverified.length > 0) return 'partial';
    return 'pass';
}

/**
 * 把验证结果写入草稿的审核 meta。
 *
 * 写进 frontmatter 而不是正文，避免污染可绑定文件的内容；
 * 人工审核页可据此看到「哪些条目存疑」。
 *
 * @param content - 草稿正文
 * @param report - 验证报告
 * @param sourceCount - 参与验证的来源数量
 * @returns 带验证 meta 的内容
 */
export function applyVerificationMeta(content: string, report: VerificationReport, sourceCount: number): string {
    const verdict = verdictOf(report);
    const summary = verdict === 'pass'
        ? '全部条目均有来源支持'
        : verdict === 'fail'
            ? `存在 ${report.contradicted.length} 条与来源矛盾的设定，必须修正`
            : verdict === 'partial'
                ? `${report.unverified.length} 条来源未提及，需人工确认`
                : '验证未产出有效结论，需人工核对';
    return applyFanficReviewMeta(content, {
        '知识库生成': 'true',
        '联网验证结论': verdict,
        '联网验证摘要': summary,
        '联网验证来源数': String(sourceCount),
        '联网验证时间': new Date().toISOString(),
    });
}

/**
 * 验证结论的中文标签（UI 展示用）。
 *
 * @param verdict - 结论
 * @returns 中文标签
 */
export function verificationVerdictLabel(verdict: VerificationVerdict): string {
    switch (verdict) {
        case 'pass': return '✅ 通过（全部有来源支持）';
        case 'partial': return '⚠️ 部分存疑（需人工确认）';
        case 'fail': return '❌ 存在矛盾（必须修正）';
        default: return '❔ 验证无结论（需人工核对）';
    }
}
