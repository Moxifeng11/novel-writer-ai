/**
 * 模板变量构建器（D 阶段从 full-writer-view.ts 外迁）。
 *
 * 职责：根据当前章节上下文（GatheredContext）、步骤结果（stepResults）与视图变量
 * （viewVars），构建用于提示词模板填充的变量字典 Record<string,string>。
 */
import { App, TFile } from 'obsidian';
import NovelWriterPlugin from '../../main';
import { GatheredContext, CharacterData } from '../../engine/context-manager';
import { getForeshadowWarnings } from '../../services/foreshadow-manager';
import { RulesService } from '../../services/rules-service';
import { filterForeshadowsByChapter, getInvolvedEntities } from '../../engine/chapter-context-builder';
import { scoreAndFilterEntities, ScoredEntity } from '../../engine/entity-scorer';
import { buildCharacterSoulSummary, getProtagonistSoulDetail } from '../../engine/character-soul';
import { extractWorldviewMeta } from '../utils/worldview-utils';
import { chapterOutlineSection } from '../../shared/format-constants';
import { stripFrontmatter, readMergedVolumeOutline } from '../../utils/helpers';
import { findBodyFileV4 } from '../../engine/chapter-utils';
import { findWritingStyleFile } from '../writing-style-paths';
import { createLogger } from '../../shared/logger';

const log = createLogger('TemplateVarsBuilder');
import {
    CHAR_TO_TOKEN_RATIO,
    INFO_DEBT_MAX,
    INFO_DEBT_WARN_CRITICAL,
    INFO_DEBT_WARN_HIGH,
    FORCED_REVEAL_OVER_20,
    FORCED_REVEAL_OVER_15,
    FORCED_REVEAL_OVER_10,
    FORCED_REVEAL_OVER_5,
    FORCED_REVEAL_WINDOW_FORWARD,
    FORCED_REVEAL_WINDOW_BACKWARD,
} from '../../shared/thresholds';

/** buildTemplateVars 所需依赖（由 full-writer-view 注入）。 */
export interface TemplateVarsDeps {
    app: App;
    plugin: NovelWriterPlugin;
    project: string;
    chapterName: string;
    chapterNum: number;
    volume: string;
    chapDir: string;
    context: GatheredContext | null;
    viewVars: Record<string, string>;
    stepResults: Record<string, string>;
}

/** 上下文数据快捷别名（GatheredContext.data 结构松散，按需取字段）。 */
type ContextData = GatheredContext['data'];

export async function buildEntityVars(deps: TemplateVarsDeps, vars: Record<string, string>, d: ContextData): Promise<void> {
  let contextText = "";
  const outlineForContext = d.outline?.raw || "";
  if (outlineForContext)
    contextText += outlineForContext;
  const prevChapter = d.previous_chapter;
  if (prevChapter) {
    if (prevChapter.bodySummary)
      contextText += "\n" + prevChapter.bodySummary;
    if (prevChapter.ending)
      contextText += "\n" + prevChapter.ending;
  }
  let involvedChars = /* @__PURE__ */ new Set();
  let involvedLocs = /* @__PURE__ */ new Set();
  let involvedFactions = /* @__PURE__ */ new Set();
  let involvedItems = /* @__PURE__ */ new Set();
  if (deps.plugin.settings.contextScope === "compact") {
    const volN = parseInt(deps.volume.match(/第(\d+)卷/)?.[1] || "0", 10);
    const bodyFile = findBodyFileV4(deps.app, deps.project, volN, deps.chapterNum);
    if (bodyFile instanceof TFile) {
      const involved = getInvolvedEntities(deps.app, bodyFile);
      involvedChars = new Set(involved.chars);
      involvedLocs = new Set(involved.locs);
      involvedFactions = new Set(involved.factions);
      involvedItems = new Set(involved.items);
    }
  }
  const allEntities: ScoredEntity[] = [];
  const chars = d.character_state || [];
  for (const c of chars) {
    const name = c.name || c.姓名 || c.fileName || "?";
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(c)) {
      if (["name", "姓名", "fileName", "filePath"].includes(k))
        continue;
      if (typeof v === "string" && v)
        fields[k] = v;
    }
    if (involvedChars.size > 0 && !involvedChars.has(name)) {
      const summaryParts = [];
      if (c.身份)
        summaryParts.push(`身份：${c.身份}`);
      if (c.当前状态)
        summaryParts.push(`状态：${c.当前状态}`);
      if (c.核心动机)
        summaryParts.push(`动机：${c.核心动机}`);
      allEntities.push({ name, fields, type: "character", formatText: `- ${name}：${summaryParts.join("，")}` });
      continue;
    }
    const parts = [];
    if (c.角色定位)
      parts.push(`定位：${c.角色定位}`);
    if (c.身份)
      parts.push(`身份：${c.身份}`);
    if (c.当前状态)
      parts.push(`状态：${c.当前状态}`);
    if (c.核心动机)
      parts.push(`动机：${c.核心动机}`);
    if (c["性格标签"])
      parts.push(`性格：${c["性格标签"]}`);
    if (c.当前目标)
      parts.push(`目标：${c.当前目标}`);
    if (c["金手指/特殊能力"])
      parts.push(`能力：${c["金手指/特殊能力"]}`);
    if (c.所属势力)
      parts.push(`势力：${c.所属势力}`);
    if (c.年龄)
      parts.push(`年龄：${c.年龄}`);
    if (c.人物背景)
      parts.push(`背景：${c.人物背景}`);
    if (c.外貌特征)
      parts.push(`外貌：${c.外貌特征}`);
    if (c.核心驱动力_软肋)
      parts.push(`软肋：${c.核心驱动力_软肋}`);
    if (c.习惯性小动作)
      parts.push(`习惯：${c.习惯性小动作}`);
    if (c.当前情绪)
      parts.push(`情绪：${c.当前情绪}`);
    if (c["功法/技能树"])
      parts.push(`功法：${c["功法/技能树"]}`);
    allEntities.push({ name, fields, type: "character", formatText: `- ${name}：${parts.join("，")}` });
  }
  const factions = d.factions || [];
  for (const f of factions) {
    const name = f.name || f.名称 || f.fileName || "?";
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) {
      if (["name", "名称", "fileName", "filePath"].includes(k))
        continue;
      if (typeof v === "string" && v)
        fields[k] = v;
    }
    if (involvedFactions.size > 0 && !involvedFactions.has(name)) {
      const summaryParts = [];
      if (f.类型)
        summaryParts.push(`类型：${f.类型}`);
      if (f.领袖)
        summaryParts.push(`领袖：${f.领袖}`);
      if (f["地位/排名"])
        summaryParts.push(`地位：${f["地位/排名"]}`);
      allEntities.push({ name, fields, type: "faction", formatText: `- ${name}：${summaryParts.join("，")}` });
      continue;
    }
    const parts = [];
    if (f.别称)
      parts.push(`别称：${f.别称}`);
    if (f.类型)
      parts.push(`类型：${f.类型}`);
    if (f["地位/排名"])
      parts.push(`地位：${f["地位/排名"]}`);
    if (f.领袖)
      parts.push(`领袖：${f.领袖}`);
    if (f.描述)
      parts.push(`描述：${f.描述}`);
    allEntities.push({ name, fields, type: "faction", formatText: `- ${name}：${parts.join("，")}` });
  }
  const locations = d.locations || [];
  for (const l of locations) {
    const name = l.name || l.名称 || l.fileName || "?";
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(l)) {
      if (["name", "名称", "fileName", "filePath"].includes(k))
        continue;
      if (typeof v === "string" && v)
        fields[k] = v;
    }
    if (involvedLocs.size > 0 && !involvedLocs.has(name)) {
      const summaryParts = [];
      if (l.类型)
        summaryParts.push(`类型：${l.类型}`);
      if (l["所在世界/区域"])
        summaryParts.push(`区域：${l["所在世界/区域"]}`);
      if (l.重要程度)
        summaryParts.push(`重要程度：${l.重要程度}`);
      allEntities.push({ name, fields, type: "location", formatText: `- ${name}：${summaryParts.join("，")}` });
      continue;
    }
    const parts = [];
    if (l.别称)
      parts.push(`别称：${l.别称}`);
    if (l.类型)
      parts.push(`类型：${l.类型}`);
    if (l["所在世界/区域"])
      parts.push(`区域：${l["所在世界/区域"]}`);
    if (l.重要程度)
      parts.push(`重要程度：${l.重要程度}`);
    if (l["地理特征"])
      parts.push(`地理特征：${l["地理特征"]}`);
    if (l["主要居民/势力"])
      parts.push(`居民：${l["主要居民/势力"]}`);
    if (l.描述)
      parts.push(`描述：${l.描述}`);
    allEntities.push({ name, fields, type: "location", formatText: `- ${name}：${parts.join("，")}` });
  }
  const items = d.items || [];
  for (const i of items) {
    const name = i.name || i.名称 || i.fileName || "?";
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(i)) {
      if (["name", "名称", "fileName", "filePath"].includes(k))
        continue;
      if (typeof v === "string" && v)
        fields[k] = v;
    }
    if (involvedItems.size > 0 && !involvedItems.has(name)) {
      const summaryParts = [];
      if (i.类型)
        summaryParts.push(`类型：${i.类型}`);
      if (i["品阶/等级"])
        summaryParts.push(`等级：${i["品阶/等级"]}`);
      if (i["所属/归属"])
        summaryParts.push(`归属：${i["所属/归属"]}`);
      allEntities.push({ name, fields, type: "item", formatText: `- ${name}：${summaryParts.join("，")}` });
      continue;
    }
    const parts = [];
    if (i.类型)
      parts.push(`类型：${i.类型}`);
    if (i["品阶/等级"])
      parts.push(`等级：${i["品阶/等级"]}`);
    if (i.效果)
      parts.push(`效果：${i.效果}`);
    if (i["所属/归属"])
      parts.push(`归属：${i["所属/归属"]}`);
    if (i.描述)
      parts.push(`描述：${i.描述}`);
    allEntities.push({ name, fields, type: "item", formatText: `- ${name}：${parts.join("，")}` });
  }
  const filtered = scoreAndFilterEntities(allEntities, contextText);
  vars["allChars"] = filtered.filter((e) => e.type === "character").map((e) => e.text).join("\n");
  vars["allFactions"] = filtered.filter((e) => e.type === "faction").map((e) => e.text).join("\n");
  vars["allLocs"] = filtered.filter((e) => e.type === "location").map((e) => e.text).join("\n");
  vars["allItems"] = filtered.filter((e) => e.type === "item").map((e) => e.text).join("\n");
  let contextCharCount = 0;
  contextCharCount += vars["allChars"]?.length || 0;
  contextCharCount += vars["allFactions"]?.length || 0;
  contextCharCount += vars["allLocs"]?.length || 0;
  contextCharCount += vars["allItems"]?.length || 0;
  vars["_contextTokens"] = String(Math.floor(contextCharCount / CHAR_TO_TOKEN_RATIO));
}
export async function buildContextVars(deps: TemplateVarsDeps, vars: Record<string, string>, d: ContextData): Promise<void> {
  const compressed = d.compressed;
  if (compressed) {
    vars["worldView"] = compressed.worldView;
    const slCompressed = compressed.settingLib;
    const isSlEmpty = !slCompressed.trim() || slCompressed.includes("<!--") && !slCompressed.replace(/<!--[\s\S]*?-->/g, "").trim();
    const meta = extractWorldviewMeta(compressed.worldView);
    vars["worldType"] = meta.worldType;
    vars["worldEra"] = meta.worldEra;
    vars["forbiddenElements"] = meta.forbiddenElements;
    vars["powerSystem"] = meta.powerSystem;
    if (isSlEmpty && compressed.worldView) {
      vars["settingLib"] = meta.fallbackSettingLib;
    } else {
      vars["settingLib"] = slCompressed;
    }
  } else {
    const wv = d.world_view;
    vars["worldView"] = wv?.raw || "";
    const sl = d.setting_lib;
    const slRaw = sl?.raw || "";
    const isSlEmpty = !slRaw.trim() || slRaw.includes("<!--") && !slRaw.replace(/<!--[\s\S]*?-->/g, "").trim();
    const metaRaw = extractWorldviewMeta(wv?.raw || "");
    vars["worldType"] = metaRaw.worldType;
    vars["worldEra"] = metaRaw.worldEra;
    vars["forbiddenElements"] = metaRaw.forbiddenElements;
    vars["powerSystem"] = metaRaw.powerSystem;
    if (isSlEmpty && wv?.raw) {
      vars["settingLib"] = metaRaw.fallbackSettingLib;
    } else {
      vars["settingLib"] = slRaw;
    }
  }
  const wr = d.writing_rules;
  if (wr) {
    const style = typeof wr.style === "string" ? wr.style : "";
    vars["writingStyle"] = style || "";
  }
  vars["writingStyleContent"] = d.writing_style?.raw || "";
  const fs = d.foreshadows;
  if (fs) {
    const tableStr = "| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 当前状态 |\n|---|---------|---------|---------|---------|---------|\n" + fs.unrevealed.map(
      (f) => `| ${f.id} | ${f.name} | ${f.importance} | ${f.buryChapter} | ${f.plannedReveal} | ${f.status} |`
    ).join("\n");
    const filtered = filterForeshadowsByChapter(tableStr, deps.chapterNum);
    const relevantSet = new Set(
      filtered.relevant.split("\n").map((s) => s.replace(/^- /, "").trim()).filter(Boolean)
    );
    const filteredUnrevealed = fs.unrevealed.filter((f) => relevantSet.has(f.name));
    vars["unrevealedForeshadow"] = compressed?.foreshadows || filteredUnrevealed.map(
      (f) => `[${f.id}] ${f.name}（重要性:${f.importance || "中"}，埋于:${f.buryChapter || "?"}）`
    ).join("\n");
    if (filtered.summary) {
      vars["unrevealedForeshadow"] += "\n" + filtered.summary;
    }

    const scoreForeshadow = (f: any): number => {
      let impScore = 2;
      const imp = (f.importance || "中").toString();
      if (imp.includes("高") || imp.includes("重要") || imp.includes("关键")) impScore = 3;
      else if (imp.includes("低") || imp.includes("一般")) impScore = 1;

      let urgencyScore = 1;
      const plannedStr = f.plannedReveal || "";
      const plannedMatch = plannedStr.match(/第(\d+)章/);
      if (plannedMatch) {
        const plannedChap = parseInt(plannedMatch[1], 10);
        const diff = plannedChap - deps.chapterNum;
        if (diff < 0) urgencyScore = 10;
        else if (diff <= 2) urgencyScore = 8;
        else if (diff <= 5) urgencyScore = 5;
        else if (diff <= 10) urgencyScore = 3;
        else urgencyScore = 1;
      } else if (plannedStr.includes("待定") || !plannedStr) {
        urgencyScore = 2;
      }

      let relevanceScore = 1;
      if (relevantSet.has(f.name)) relevanceScore = 3;

      return impScore * 3 + urgencyScore * 2 + relevanceScore * 2;
    };

    const isInRevealWindow = (f: any): boolean => {
      const plannedStr = f.plannedReveal || "";
      const plannedMatch = plannedStr.match(/第(\d+)章/);
      if (!plannedMatch) return false;
      const plannedChap = parseInt(plannedMatch[1], 10);
      const diff = plannedChap - deps.chapterNum;
      return diff >= -FORCED_REVEAL_WINDOW_BACKWARD && diff <= FORCED_REVEAL_WINDOW_FORWARD;
    };

    const candidates = fs.unrevealed.filter(isInRevealWindow);
    const sortedUnrevealed = [...candidates].sort((a, b) => scoreForeshadow(b) - scoreForeshadow(a));

    const count = fs.unrevealed.length;
    let maxReveal = 0;
    if (count > 20) maxReveal = FORCED_REVEAL_OVER_20;
    else if (count > INFO_DEBT_MAX) maxReveal = FORCED_REVEAL_OVER_15;
    else if (count > INFO_DEBT_WARN_CRITICAL) maxReveal = FORCED_REVEAL_OVER_10;
    else if (count > INFO_DEBT_WARN_HIGH) maxReveal = FORCED_REVEAL_OVER_5;

    const revealCount = Math.min(maxReveal, sortedUnrevealed.length);
    const toShow = sortedUnrevealed.slice(0, revealCount);

    if (count > 20) {
      vars["forcedRevealHint"] = revealCount > 0 ? `⚠️ 信息债严重（${count}个未揭示），本章优先揭示以下临近伏笔：
${toShow.map((f) => `- ${f.name}（${f.importance || "中"}，计划:${f.plannedReveal || "?"}）`).join("\n")}` : `⚠️ 信息债严重（${count}个未揭示），但当前无临近揭示窗口内的伏笔，请检查伏笔计划`;
      vars["revealInstruction"] = revealCount > 0 ? `信息债严重：本章优先揭示 ${toShow.map((f) => f.name).join("、")}，控制新伏笔数量` : `信息债严重：但当前无临近揭示窗口内的伏笔，建议检查伏笔计划是否合理`;
    } else if (count > INFO_DEBT_MAX) {
      vars["forcedRevealHint"] = revealCount > 0 ? `⚠️ 信息债过高（${count}个未揭示），本章优先揭示以下临近伏笔：
${toShow.map((f) => `- ${f.name}（${f.importance || "中"}，计划:${f.plannedReveal || "?"}）`).join("\n")}` : `⚠️ 信息债过高（${count}个未揭示），但当前无临近揭示窗口内的伏笔`;
      vars["revealInstruction"] = revealCount > 0 ? `信息债过高：本章优先揭示 ${toShow.map((f) => f.name).join("、")}，尽量少埋新伏笔` : `信息债过高：但当前无临近揭示窗口内的伏笔，建议回顾伏笔计划`;
    } else if (count > INFO_DEBT_WARN_CRITICAL) {
      vars["forcedRevealHint"] = revealCount > 0 ? `⚠️ 信息债偏高（${count}个未揭示），建议着重揭示以下伏笔：
${toShow.map((f) => `- ${f.name}（${f.importance || "中"}，计划:${f.plannedReveal || "?"}）`).join("\n")}` : `\u{1F4A1} 信息债偏高（${count}个未揭示），当前无临近揭示窗口的伏笔`;
      vars["revealInstruction"] = revealCount > 0 ? `信息债偏高：建议揭示 ${toShow.map((f) => f.name).join("、")}` : `信息债偏高：但无临近揭示窗口的伏笔，可正常推进剧情`;
    } else if (count > INFO_DEBT_WARN_HIGH) {
      vars["forcedRevealHint"] = revealCount > 0 ? `\u{1F4A1} 有${count}个未揭示伏笔，建议至少揭示1个：${toShow[0]?.name || ""}（${toShow[0]?.importance || "中"}）` : `\u{1F4A1} 有${count}个未揭示伏笔，当前无临近揭示窗口的伏笔`;
      vars["revealInstruction"] = `每章至少回收1个旧伏笔、埋下1个新伏笔`;
    } else {
      vars["forcedRevealHint"] = "当前伏笔生态健康";
      vars["revealInstruction"] = "每章至少回收1个旧伏笔、埋下1个新伏笔";
    }
    const warnings = await getForeshadowWarnings(deps.app, deps.project, deps.chapterNum);
    if (warnings.length > 0) {
      const lines = ["⚠️ 伏笔揭示预警："];
      let totalLen = lines[0].length;
      for (const w of warnings) {
        const emoji = w.level === "critical" ? "\u{1F6A8}" : "⚠️";
        const line = `- ${emoji} ${w.msg}`;
        if (totalLen + line.length + 1 <= 500) {
          lines.push(line);
          totalLen += line.length + 1;
        }
      }
      vars["foreshadowWarnings"] = lines.join("\n").slice(0, 500);
    } else {
      vars["foreshadowWarnings"] = "";
    }
    try {
      const outlineRaw = await readMergedVolumeOutline(deps.app, deps.project);
      if (outlineRaw) {
        const tableMatch = outlineRaw.match(/## 伏笔布局规划\n\n([\s\S]*?)(?=\n## |\n---|$)/);
        if (tableMatch) {
          const rows = tableMatch[1].split("\n").filter((l) => l.startsWith("|") && !l.includes("---"));
          if (rows.length >= 2) {
            const planHints = [];
            for (const row of rows) {
              const cells = row.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
              if (cells.length < 5 || cells[0] === "伏笔名")
                continue;
              const name = cells[0], plant = parseInt(cells[2]) || 0, reveal = parseInt(cells[4]) || 0;
              const hintNums = (cells[3] || "").split(/[,，/]/).map((s) => parseInt(s)).filter((n) => !isNaN(n));
              if (deps.chapterNum === plant)
                planHints.push(`[埋入]伏笔「${name}」`);
              if (hintNums.includes(deps.chapterNum))
                planHints.push(`[暗示]伏笔「${name}」(→第${reveal}章揭示)`);
              if (deps.chapterNum === reveal)
                planHints.push(`[揭示]伏笔「${name}」(埋于第${plant}章)`);
            }
            if (planHints.length > 0) {
              const existingHint = vars["forcedRevealHint"] && !vars["forcedRevealHint"].includes("伏笔生态健康") ? vars["forcedRevealHint"] : "";
              vars["forcedRevealHint"] = (existingHint ? existingHint + "\n" : "") + "\u{1F4CB} 本章计划伏笔操作：\n" + planHints.join("\n");
            }
          }
        }
      }
    } catch (e) {
      log.warn('[小说工坊] 伏笔计划解析失败:', e);
    }
  }
  const tl = d.timeline || [];
  vars["timelineEvents"] = compressed?.timeline || tl.map((t) => `- ${t.time} | ${t.chapter} | ${t.event} | ${t.impact}`).join("\n");
  const prev = d.previous_chapter;
  if (prev) {
    const parts = [];
    if (prev.bodySummary)
      parts.push(`上一章正文：${prev.bodySummary.slice(0, 3e3)}`);
    if (prev.ending)
      parts.push(`上一章结尾：${prev.ending}`);
    if (prev.outline)
      parts.push(`上一章大纲：${prev.outline}`);
    if (prev.analysisReport) {
      const suggestMatch = prev.analysisReport.match(/(?:续写建议|写作建议)[：:]\s*([^#]+)/);
      if (suggestMatch)
        parts.push(`上一章续写建议：${suggestMatch[1].trim().slice(0, 500)}`);
      const breakMatch = prev.analysisReport.match(/(?:互信息断裂|断裂检测|逻辑断裂)[：:]\s*([^#]+)/);
      if (breakMatch)
        parts.push(`上一章改进方向：${breakMatch[1].trim().slice(0, 300)}`);
    }
    if (prev.continuityReview) {
      const issues = [];
      for (const line of prev.continuityReview.split("\n")) {
        const t = line.trim();
        if (t.startsWith("❌") || t.startsWith("⚠️"))
          issues.push(t.slice(0, 200));
      }
      if (issues.length > 0) {
        vars["prevReview"] = "【上一章审查问题】\n" + issues.slice(0, 5).join("\n");
      }
    }
    if (prev.infoPlan) {
      const tempMatch = prev.infoPlan.match(/情感温度[：:]\s*(.+)/);
      const conflictMatch = prev.infoPlan.match(/冲突强度[：:]\s*(.+)/);
      const rhythmMatch = prev.infoPlan.match(/节奏节拍[：:]\s*(.+)/);
      const emotionParts = [];
      if (tempMatch)
        emotionParts.push(`上一章情感温度：${tempMatch[1].trim()}`);
      if (conflictMatch)
        emotionParts.push(`上一章冲突强度：${conflictMatch[1].trim()}`);
      if (rhythmMatch)
        emotionParts.push(`上一章节奏模式：${rhythmMatch[1].trim()}`);
      if (emotionParts.length > 0)
        vars["emotionContext"] = emotionParts.join("\n");
    }
    vars["prevChaptersSummary"] = parts.join("\n");
    if (deps.viewVars["crossVolumeSnapshot"]) {
      vars["prevChaptersSummary"] = "【跨卷状态快照——上卷结束时的人物、势力、伏笔、时间线状态】\n" + deps.viewVars["crossVolumeSnapshot"] + "\n\n" + vars["prevChaptersSummary"];
    }
    vars["prevChapEnding"] = prev.ending || "";
  }
  const outline = d.outline;
  vars["outlineContent"] = outline?.raw || "";
  vars["chapPlan"] = "";
  try {
    const viContent = await readMergedVolumeOutline(deps.app, deps.project);
    if (viContent) {
      const chapMatch = viContent.match(chapterOutlineSection(deps.chapterNum));
      vars["chapPlan"] = chapMatch?.[0]?.trim() || "";
    }
  } catch (e) {
    log.warn("[小说工坊] 操作失败:", e);
  }
  vars["chapPosition"] = `第${deps.chapterNum}章（${deps.volume}）`;
}
export async function buildTemplateVars(deps: TemplateVarsDeps): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  vars["writingRules"] = await RulesService.getInstance(deps.plugin.app).getWritingRules();
  vars["chapNum"] = String(deps.chapterNum || parseInt(deps.chapterName.match(/\d+/)?.[0] || "0", 10));
  vars["chapName"] = deps.chapterName;
  vars["project"] = deps.project;
  vars["baseWords"] = String(deps.plugin.settings.defaultWordCount || 3e3);
  if (deps.context) {
    const d = deps.context.data;
    await buildEntityVars(deps, vars, d);
    vars["protagonistName"] = "主角";
    if (vars["allChars"]) {
      const charBlocks = vars["allChars"].split(/\n(?=- )/);
      for (const block of charBlocks) {
        if (block.includes("主角") || block.includes("主人公")) {
          const nameMatch = block.match(/^-\s*([^：:]+)/);
          if (nameMatch) {
            const rawName = nameMatch[1].trim();
            if (rawName && rawName.length >= 2 && !/^(角色|人物|姓名|名称|主角|主人公)$/i.test(rawName)) {
              vars["protagonistName"] = rawName;
              break;
            }
          }
        }
      }
      if (vars["protagonistName"] === "主角") {
        const firstLine = vars["allChars"].split("\n")[0] || "";
        const nameMatch = firstLine.match(/^-\s*([^：:]+)/);
        if (nameMatch) {
          const rawName = nameMatch[1].trim();
          if (rawName && rawName.length >= 2 && !/^(角色|人物|姓名|名称|主角)$/i.test(rawName)) {
            vars["protagonistName"] = rawName;
          }
        }
      }
    }
    await buildContextVars(deps, vars, d);
  }
  if (deps.stepResults["infoPlan"]) {
    vars["infoPlan"] = deps.stepResults["infoPlan"];
  } else {
    vars["infoPlan"] = "（未设定，请按分卷大纲自由发挥本章内容）";
  }
  if (deps.stepResults["plotDistill"]) {
    vars["distilledContent"] = deps.stepResults["plotDistill"];
  }
  if (deps.stepResults["outline"]) {
    vars["outlineContent"] = deps.stepResults["outline"];
  } else {
    vars["outlineContent"] = vars["chapPlan"] || "";
  }
  if (deps.stepResults["bodyGeneration"]) {
    vars["bodyText"] = stripFrontmatter(deps.stepResults["bodyGeneration"] || "");
  }
  const entityParts = [];
  if (vars["allChars"])
    entityParts.push(`【人物】
${vars["allChars"]}`);
  if (vars["allFactions"])
    entityParts.push(`【势力】
${vars["allFactions"]}`);
  if (vars["allLocs"])
    entityParts.push(`【地点】
${vars["allLocs"]}`);
  if (vars["allItems"])
    entityParts.push(`【物品功法】
${vars["allItems"]}`);
  vars["entityContext"] = entityParts.join("\n\n");
  vars["emotionContext"] = vars["emotionContext"] || "";
  if (deps.stepResults["selfCheck"]) {
    vars["issues"] = deps.stepResults["selfCheck"];
  }
  if (deps.stepResults["continuityCheck"]) {
    const reviewIssues = [];
    const deleteCmds = [];
    for (const line of deps.stepResults["continuityCheck"].split("\n")) {
      const t = line.trim();
      if (t.startsWith("❌"))
        reviewIssues.push(t);
      if (t.startsWith("DELETE_ENTITY:"))
        deleteCmds.push(t);
    }
    if (reviewIssues.length > 0) {
      vars["issues"] = (vars["issues"] || "") + "\n【连贯性审查——必须修正】\n" + reviewIssues.join("\n");
    }
    if (deleteCmds.length > 0) {
      vars["issues"] = (vars["issues"] || "") + "\n【实体删除指令——禁止在修正后的正文中使用以下实体】\n" + deleteCmds.join("\n");
    }
  }
  if (deps.stepResults["qualityControl"]) {
    const qcIssues = [];
    for (const line of deps.stepResults["qualityControl"].split("\n")) {
      const t = line.trim();
      if (t.startsWith("❌") || t.startsWith("⚠️"))
        qcIssues.push(t);
    }
    if (qcIssues.length > 0) {
      vars["issues"] = (vars["issues"] || "") + "\n【质量控制问题】\n" + qcIssues.join("\n");
    }
  }
  if (deps.stepResults["analysisReport"]) {
    const arIssues = [];
    for (const line of deps.stepResults["analysisReport"].split("\n")) {
      const t = line.trim();
      if (t.startsWith("CRITICAL_FAIL") || t.startsWith("DENSITY_CHECK: 不合格")) {
        arIssues.push(t);
      }
    }
    if (arIssues.length > 0) {
      vars["issues"] = (vars["issues"] || "") + "\n【分析报告问题】\n" + arIssues.join("\n");
    }
  }
  vars["issues"] = vars["issues"] || "";
  vars["foreshadows"] = vars["unrevealedForeshadow"] || "";
  vars["prevReview"] = vars["prevReview"] || "";
  vars["userIntervention"] = deps.viewVars["userIntervention"] || "";
  await buildSceneStyleHint(deps, vars);
  if (deps.context?.data?.character_cores && deps.context.data.character_cores.length > 0) {
    const souls = deps.context.data.character_cores;
    const summary = buildCharacterSoulSummary(souls, vars["protagonistName"] || "主角");
    vars["characterCores"] = summary.allSouls;
    if (summary.protagonist) {
      vars["protagonistSoulDetail"] = getProtagonistSoulDetail(summary.protagonist);
      log.info("[V2] 主角灵魂层已注入:", summary.protagonist.name, "9字段完整:", summary.protagonist.hasSoul);
    } else {
      vars["protagonistSoulDetail"] = "";
    }
    vars["characterCores"] = summary.allSouls;
    log.info("[V2] 角色灵魂层注入完毕:", souls.length, "人, hasSoulData:", summary.hasSoulData);
  } else {
    vars["characterCores"] = "";
    vars["protagonistSoulDetail"] = "";
  }
  vars["emotionPlan"] = deps.stepResults["emotionPlan"] || deps.viewVars["emotionPlan"] || "";
  vars["sceneExpansion"] = deps.stepResults["sceneExpand"] || deps.viewVars["sceneExpansion"] || "";
  vars["triggeredMemories"] = "";
  return vars;
}
export async function buildSceneStyleHint(deps: TemplateVarsDeps, vars: Record<string, string>): Promise<void> {
  try {
    const wsFile = await findWritingStyleFile(deps.app, deps.project, { allowPlaceholder: true });
    if (!(wsFile instanceof TFile))
      return;
    const wsRaw = await deps.app.vault.read(wsFile);
    const infoPlan = vars["infoPlan"] || deps.stepResults["infoPlan"] || "";
    let tempLevel = 0, conflictLevel = 0;
    const tempMatch = infoPlan.match(/情感温度[：:]\s*(\d+)/);
    if (tempMatch)
      tempLevel = parseInt(tempMatch[1]) || 0;
    const conflictMatch = infoPlan.match(/冲突强度[：:]\s*(\d+)/);
    if (conflictMatch)
      conflictLevel = parseInt(conflictMatch[1]) || 0;
    let sceneType = "dialogue";
    if (tempLevel >= 7 || conflictLevel >= 4)
      sceneType = "battle";
    else if (tempLevel >= 4 || conflictLevel >= 2)
      sceneType = "emotional";
    const sectionMap: Record<string, string> = {
      battle: "战斗/冲突场景样本",
      dialogue: "日常/对话场景样本",
      emotional: "情绪/心理场景样本"
    };
    const sectionPattern = sectionMap[sceneType];
    const sectionRegex = new RegExp(
      `###\\s*${sectionPattern}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|\\n---|$)`,
      "i"
    );
    const sectionMatch = wsRaw.match(sectionRegex);
    if (sectionMatch) {
      const snippet = sectionMatch[1].replace(/<!--[\s\S]*?-->/g, "").replace(/```/g, "").trim().slice(0, 1500);
      vars["sceneStyleSnippet"] = snippet;
      vars["_sceneType"] = sceneType;
    }
    const rhythmMap: Record<string, string> = {
      battle: "急起急落 — 直接切入冲突→快速升级→高潮→戛然而止",
      emotional: "倒叙切入 — 先呈现结果/悬念→回溯原因→揭示真相→新悬念",
      dialogue: "起承转合 — 铺垫→发展→转折→收尾"
    };
    vars["suggestedRhythm"] = rhythmMap[sceneType] || rhythmMap.dialogue;
    vars["_sceneType"] = vars["_sceneType"] || sceneType;
  } catch (e) {
    log.warn('[小说工坊] 场景风格提取失败:', e);
  }
}

// ui/full-writer/outline-tree-controller.ts
