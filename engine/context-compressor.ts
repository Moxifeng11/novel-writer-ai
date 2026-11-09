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
import { chapterNumber } from '@/shared/chapter-ref';
import { normalizeForeshadowStatus } from './ledger/ledger-model';

/** 内部：解析伏笔字符串中的 plannedReveal 章号与状态 */
interface ParsedForeshadow {
    line: string;
    revealChapter: number; // 0 表示无法解析
    plannedReveal: string;
    status: 'unrevealed' | 'revealed' | 'abandoned' | 'unknown';
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
    if (paragraphs.length === 0) return text;

    const scoreOf = (para: string): number => {
        let score = 0;
        for (const kw of keywords) {
            let pos = para.indexOf(kw);
            while (pos !== -1) {
                score++;
                pos = para.indexOf(kw, pos + 1);
            }
        }
        return score;
    };

    const selected = new Set<number>();
    let total = 0;
    // 预留压缩标记的长度，保证最终返回值不超过 maxChars
    const reserve = 64;
    const selectionLimit = Math.max(1, maxChars - reserve);
    // 按分数选，但输出时保持原文顺序（旧实现按分数重排，会打乱因果/时间顺序）
    const ranked = paragraphs
        .map((para, index) => ({ index, score: scoreOf(para), length: para.length }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    for (const item of ranked) {
        const cost = item.length + (selected.size > 0 ? 2 : 0);
        if (total + cost <= selectionLimit) {
            selected.add(item.index);
            total += cost;
        }
    }

    // 关键词都没命中且首段本身超限：至少保留可控的前缀并标注，绝不返回空串
    if (selected.size === 0) {
        const first = paragraphs[0];
        const head = first.slice(0, Math.max(1, maxChars - 48));
        return `${head}…〔已压缩：${paragraphs.length} 段过长，保留首段前缀〕`;
    }

    const kept = paragraphs.filter((_, index) => selected.has(index));
    const marker = selected.size < paragraphs.length
        ? `\n\n〔已压缩：保留 ${selected.size}/${paragraphs.length} 段，按原文顺序拼接〕`
        : '';
    return kept.join('\n\n') + marker;
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
            result.push({ line: trimmed, revealChapter: 0, plannedReveal: '', status: 'unknown' });
            continue;
        }
        const statusText = parts[parts.length - 1] || '';
        let status: ParsedForeshadow['status'] = statusText
            ? normalizeForeshadowStatus(statusText, 'unknown')
            : 'unrevealed';
        // 4 列原始废弃行没有状态列：整行含「废弃」即按废弃处理，避免混入未回收
        if (status === 'unknown' && trimmed.includes('废弃')) status = 'abandoned';
        if (status === 'unknown') status = 'unrevealed';
        const plannedReveal = status === 'unrevealed' ? (parts[4] || '') : '';
        const plannedNum = chapterNumber(plannedReveal);
        result.push({
            line: trimmed,
            revealChapter: plannedNum ?? 0,
            plannedReveal,
            status,
        });
    }
    return result;
}

function compressForeshadows(raw: string, currentChapter: number): string {
    if (!raw) return '';

    const parsed = parseForeshadowLines(raw);
    if (parsed.length === 0) return '';

    // 只保留未回收；已揭示/已废弃的旧行不再当作「待回收」注入
    const unrevealed = parsed.filter(f => f.status === 'unrevealed' || f.status === 'unknown');
    if (unrevealed.length === 0) return '';

    const overdue = unrevealed.filter(f => f.revealChapter > 0 && f.revealChapter < currentChapter);
    const pending = unrevealed
        .filter(f => !(f.revealChapter > 0 && f.revealChapter < currentChapter))
        .sort((a, b) => {
            const distA = a.revealChapter > 0 ? Math.abs(a.revealChapter - currentChapter) : Number.MAX_SAFE_INTEGER;
            const distB = b.revealChapter > 0 ? Math.abs(b.revealChapter - currentChapter) : Number.MAX_SAFE_INTEGER;
            return distA - distB;
        });

    const selected: ParsedForeshadow[] = [];
    const seen = new Set<string>();
    for (const item of overdue) {
        if (!seen.has(item.line)) {
            selected.push(item);
            seen.add(item.line);
        }
    }
    for (const item of pending) {
        if (!seen.has(item.line) && selected.length < 5 + overdue.length) {
            selected.push(item);
            seen.add(item.line);
        }
    }

    return selected.map(item => {
        const parts = item.line.split('|').map(s => s.trim());
        const id = parts[0] || '';
        const name = parts[1] || '';
        const importance = parts[2] || '中';
        const buryChapter = parts[3] || '?';
        const planned = item.plannedReveal || '待定';
        return `[${id}] ${name}（重要性:${importance}，埋于:${buryChapter}，计划:${planned}，状态:未回收）`;
    }).join('\n');
}

// ---------- 时间线压缩 ----------

function compressTimeline(raw: string): string {
    if (!raw) return '';

    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length <= 15) return raw;

    // 生产输入是「按章号降序」（最新在前），旧实现 slice(-15) 保留的是最旧 15 条。
    // 这里按解析出的章号重新降序；无章号行按原顺序附在末尾，避免丢事件。
    const withChapter = lines
        .map((line, index) => {
            const parts = line.split('|').map(s => s.trim());
            // 生产格式：时间|章节|事件|影响；兼容 7 列：时间在 index 2、章节在 5；
            // 也兼容测试/旧数据的「第N章：事件」纯文本行。
            const chapter = chapterNumber(parts[1]) ?? chapterNumber(parts[5]) ?? chapterNumber(line);
            return { line, index, chapter };
        })
        .sort((a, b) => {
            if (a.chapter === null && b.chapter === null) return a.index - b.index;
            if (a.chapter === null) return 1;
            if (b.chapter === null) return -1;
            return b.chapter - a.chapter;
        });
    return withChapter.slice(0, 15).map(item => item.line).join('\n');
}

// ---------- 硬截断兜底 ----------

function cutHalfAtBoundary(text: string, minKeep = 80): string {
    if (!text) return text;
    const target = Math.max(minKeep, Math.floor(text.length / 2));
    let cut = text.slice(0, Math.min(target, text.length));
    const newline = cut.lastIndexOf('\n');
    if (newline > target * 0.5) cut = cut.slice(0, newline);
    return `${cut}\n〔已压缩：${text.length}→${cut.length} 字〕`;
}

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

    // 旧实现先砍世界观，且直接 slice 会把段落/行切半。
    // 新顺序：时间线 → 伏笔 → 设定库 → 世界观（世界观是最后兜底），每次只砍一段并在边界处收口。
    let guard = 0;
    while (totalChars > maxAllowed && guard++ < 60) {
        if (tl.length > 120) {
            tl = cutHalfAtBoundary(tl);
        } else if (fs.length > 120) {
            fs = cutHalfAtBoundary(fs);
        } else if (sl.length > 160) {
            sl = cutHalfAtBoundary(sl);
        } else if (wv.length > 200) {
            wv = cutHalfAtBoundary(wv);
        } else {
            // 所有字段都已很小仍超限：按比例收口，仍保留可读前缀与标记
            const factor = maxAllowed / Math.max(totalChars, 1);
            wv = wv ? `${wv.slice(0, Math.max(0, Math.floor(wv.length * factor)))}\n〔已压缩〕` : wv;
            sl = sl ? `${sl.slice(0, Math.max(0, Math.floor(sl.length * factor)))}\n〔已压缩〕` : sl;
            fs = fs ? `${fs.slice(0, Math.max(0, Math.floor(fs.length * factor)))}\n〔已压缩〕` : fs;
            tl = tl ? `${tl.slice(0, Math.max(0, Math.floor(tl.length * factor)))}\n〔已压缩〕` : tl;
            truncationApplied = true;
            break;
        }
        truncationApplied = true;
        totalChars = wv.length + sl.length + fs.length + tl.length;
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
