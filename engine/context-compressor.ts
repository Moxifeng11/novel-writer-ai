/**
 * CompressedContext 类型定义。
 */
export interface CompressedContext {
    worldView: string;
    settingLib: string;
    foreshadows: string;
    timeline: string;
    truncationApplied: boolean;
}

/** 内部：解析伏笔字符串中的 plannedReveal 章号 */
interface ParsedForeshadow {
    line: string;
    revealChapter: number; // 0 表示无法解析
}

// ---------- 本地关键词提取 ----------

const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '他', '她', '它', '有', '和',
    '就', '不', '人', '都', '一', '一个', '上', '也', '很',
    '到', '说', '要', '去', '你', '会', '着', '没有', '看',
    '好', '自己', '这'
]);

function extractKeywords(text: string): string[] {
    const freq: Map<string, number> = new Map();
    const chars = text.replace(/\s+/g, '');
    const maxLen = 4;

    for (let i = 0; i < chars.length; i++) {
        for (let len = maxLen; len >= 2; len--) {
            if (i + len <= chars.length) {
                const word = chars.slice(i, i + len);
                if (/^[\u4e00-\u9fff]+$/.test(word) && !STOP_WORDS.has(word)) {
                    freq.set(word, (freq.get(word) || 0) + 1);
                }
            }
        }
    }

    return Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([w]) => w);
}

// ---------- 关键词匹配段落压缩 ----------

function compressByKeywords(text: string, keywords: string[], maxChars: number): string {
    if (!text || text.length <= maxChars) return text;

    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    if (paragraphs.length === 0) return '';

    // 对每段打分
    const scored: { text: string; score: number }[] = paragraphs.map(para => {
        let score = 0;
        for (const kw of keywords) {
            let pos = para.indexOf(kw);
            while (pos !== -1) {
                score++;
                pos = para.indexOf(kw, pos + 1);
            }
        }
        return { text: para, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // 取 top 段落直到 <= maxChars
    const selected: string[] = [];
    let total = 0;
    for (const item of scored) {
        if (total + item.text.length + (selected.length > 0 ? 2 : 0) <= maxChars) {
            selected.push(item.text);
            total += item.text.length + (selected.length > 1 ? 2 : 0);
        }
    }

    // 如果关键词匹配后为空，退回前 N 段
    if (selected.length === 0) {
        let fallback = 0;
        const fb: string[] = [];
        for (const p of paragraphs) {
            if (fallback + p.length + (fb.length > 0 ? 2 : 0) <= maxChars) {
                fb.push(p);
                fallback += p.length + (fb.length > 1 ? 2 : 0);
            } else {
                break;
            }
        }
        return fb.join('\n\n');
    }

    return selected.join('\n\n');
}

// ---------- 伏笔解析 ----------

function parseForeshadowLines(raw: string): ParsedForeshadow[] {
    if (!raw) return [];
    const result: ParsedForeshadow[] = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split('|').map(s => s.trim());
        if (parts.length < 5) {
            result.push({ line: trimmed, revealChapter: 0 });
            continue;
        }
        const plannedReveal = parts[4] || '';
        const chMatch = plannedReveal.match(/第(\d+)章/);
        result.push({
            line: `${parts[0]}|${parts[1]}|${parts[2]}|${parts[3]}|${parts[4]}|${parts[5] || ''}`,
            revealChapter: chMatch ? parseInt(chMatch[1]) : 0
        });
    }
    return result;
}

function compressForeshadows(raw: string, currentChapter: number): string {
    if (!raw) return '';

    const parsed = parseForeshadowLines(raw);
    if (parsed.length === 0) return '';

    // 分出已过 plannedReveal 但未揭示的（revealChapter > 0 && revealChapter < currentChapter）
    const overdue = parsed.filter(f => f.revealChapter > 0 && f.revealChapter < currentChapter);

    // 未过期的按计划揭示章号排序（离 currentChapter 最近的在前）
    const pending = parsed.filter(f => !(f.revealChapter > 0 && f.revealChapter < currentChapter));
    pending.sort((a, b) => {
        const distA = a.revealChapter > 0 ? Math.abs(a.revealChapter - currentChapter) : Number.MAX_SAFE_INTEGER;
        const distB = b.revealChapter > 0 ? Math.abs(b.revealChapter - currentChapter) : Number.MAX_SAFE_INTEGER;
        return distA - distB;
    });

    // 取最近 5 条 + 所有已过期的
    const selected: ParsedForeshadow[] = [];
    const seen = new Set<string>();
    for (const f of overdue) {
        if (!seen.has(f.line)) {
            selected.push(f);
            seen.add(f.line);
        }
    }
    for (const f of pending) {
        if (!seen.has(f.line) && selected.length < 5 + overdue.length) {
            selected.push(f);
            seen.add(f.line);
        }
    }

    // 输出格式化文本
    return selected.map(f => {
        const parts = f.line.split('|').map(s => s.trim());
        const id = parts[0] || '';
        const name = parts[1] || '';
        const importance = parts[2] || '中';
        const buryChapter = parts[3] || '?';
        return `[${id}] ${name}（重要性:${importance}，埋于:${buryChapter}）`;
    }).join('\n');
}

// ---------- 时间线压缩 ----------

function compressTimeline(raw: string): string {
    if (!raw) return '';

    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length <= 15) return raw;

    // 保留最近 15 条
    return lines.slice(-15).join('\n');
}

// ---------- 硬截断兜底 ----------

function applyHardTruncation(
    worldView: string,
    settingLib: string,
    foreshadows: string,
    timeline: string,
    maxAllowed: number
): { worldView: string; settingLib: string; foreshadows: string; timeline: string; truncationApplied: boolean } {
    let wv = worldView;
    let sl = settingLib;
    let fs = foreshadows;
    let tl = timeline;

    let totalChars = wv.length + sl.length + fs.length + tl.length;
    let truncationApplied = false;

    // 逐级减半
    while (totalChars > maxAllowed) {
        if (wv.length > 100) {
            wv = wv.slice(0, Math.floor(wv.length / 2));
            truncationApplied = true;
            totalChars = wv.length + sl.length + fs.length + tl.length;
            if (totalChars <= maxAllowed) break;
        }
        if (sl.length > 50) {
            sl = sl.slice(0, Math.floor(sl.length / 2));
            truncationApplied = true;
            totalChars = wv.length + sl.length + fs.length + tl.length;
            if (totalChars <= maxAllowed) break;
        }
        if (fs.length > 50) {
            fs = fs.slice(0, Math.floor(fs.length / 2));
            truncationApplied = true;
            totalChars = wv.length + sl.length + fs.length + tl.length;
            if (totalChars <= maxAllowed) break;
        }
        if (tl.length > 50) {
            tl = tl.slice(0, Math.floor(tl.length / 2));
            truncationApplied = true;
            totalChars = wv.length + sl.length + fs.length + tl.length;
            if (totalChars <= maxAllowed) break;
        }
        // 如果所有字段都 <= 50 但仍超标，硬截断每个字段
        if (totalChars > maxAllowed) {
            const factor = maxAllowed / Math.max(totalChars, 1);
            wv = wv.slice(0, Math.floor(wv.length * factor));
            sl = sl.slice(0, Math.floor(sl.length * factor));
            fs = fs.slice(0, Math.floor(fs.length * factor));
            tl = tl.slice(0, Math.floor(tl.length * factor));
            truncationApplied = true;
            break;
        }
    }

    return { worldView: wv, settingLib: sl, foreshadows: fs, timeline: tl, truncationApplied };
}

// ---------- 主入口 ----------

/**
 * compressWorldContext 函数。
 * @param worldView - 世界观
 * @param settingLib - 设定库
 * @param foreshadowLib - 伏笔库
 * @param timelineRaw - 时间线原始
 * @param outlineText - 大纲文本
 * @param currentChapter - 当前章节
 * @param maxContext - 最大上下文
  * @returns CompressedContext 实例
 */
export function compressWorldContext(
    worldView: string,
    settingLib: string,
    foreshadowLib: string,
    timelineRaw: string,
    outlineText: string,
    currentChapter: number,
    maxContext: number
): CompressedContext {
    const keywords = outlineText ? extractKeywords(outlineText) : [];

    // 上限跟随模型窗口：旧实现固定 2000/1000 字，128k 窗口下设定库仍被砍到 1000 字，
    // 是「世界观/设定库用不上」的直接原因之一。小窗口仍保持旧下限。
    const worldCap = Math.max(2000, Math.min(12000, Math.floor(maxContext * 0.12)));
    const settingCap = Math.max(1000, Math.min(6000, Math.floor(maxContext * 0.06)));

    // 1. 世界观压缩
    let wv: string;
    if (!worldView) {
        wv = '';
    } else if (worldView.length <= worldCap) {
        wv = worldView;
    } else {
        wv = compressByKeywords(worldView, keywords, worldCap);
    }

    // 2. 设定库压缩
    let sl: string;
    if (!settingLib) {
        sl = '';
    } else if (settingLib.length <= settingCap) {
        sl = settingLib;
    } else {
        sl = compressByKeywords(settingLib, keywords, settingCap);
    }

    // 3. 伏笔压缩
    let fs: string;
    if (!foreshadowLib) {
        fs = '';
    } else {
        fs = compressForeshadows(foreshadowLib, currentChapter);
    }

    // 4. 时间线压缩
    let tl: string;
    if (!timelineRaw) {
        tl = '';
    } else {
        tl = compressTimeline(timelineRaw);
    }

    // 5. 硬截断兜底
    const maxAllowed = Math.floor(maxContext * 0.6);
    const hardResult = applyHardTruncation(wv, sl, fs, tl, maxAllowed);

    // keyword 压缩（世界观/设定库）也算截断：否则用户与日志都看不到设定库被砍
    const keywordCompressed = worldView.length > worldCap || settingLib.length > settingCap;
    return {
        worldView: hardResult.worldView,
        settingLib: hardResult.settingLib,
        foreshadows: hardResult.foreshadows,
        timeline: hardResult.timeline,
        truncationApplied: hardResult.truncationApplied || keywordCompressed
    };
}
