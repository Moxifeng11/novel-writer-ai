/**
 * 模板变量构建器（D 阶段从 full-writer-view.ts 外迁）。
 *
 * 职责：根据当前章节上下文（GatheredContext）、步骤结果（stepResults）与视图变量
 * （viewVars），构建用于提示词模板填充的变量字典 Record<string,string>。
 */
import { App, TFile } from 'obsidian';
import NovelWriterPlugin from '@/main';
import { GatheredContext, CharacterData, ForeshadowItem } from '@/engine/context-manager';
import { getForeshadowWarnings } from '@/engine/foreshadow-manager';
import { RulesService } from '@/services/rules-service';
import { filterForeshadowsByChapter, getInvolvedEntities } from '@/engine/chapter-context-builder';
import { scoreAndFilterEntitiesByType, ScoredEntity } from '@/engine/entity-scorer';
import { buildCharacterSoulSummary, getProtagonistSoulDetail } from '@/engine/character-soul';
import { parseInfoPlanFields, formatInfoPlanPromptBlock } from '@/shared/info-plan-fields';
import { buildEntityRelationsBlock } from '@/engine/entity-graph';
import { buildInjectionLedger } from '@/shared/injection-ledger';
import { auditContextBlocks, resolveStyleConflicts } from '@/shared/context-hygiene';
import { renderChapterDigestBlock } from '@/engine/memory/chapter-digest';
import { buildTimeContextMessage } from '@/shared/time-context';
import { extractWorldviewMeta } from '@/ui/utils/worldview-utils';
import { chapterOutlineSection, volumeSectionSlice } from '@/shared/format-constants';
import { stripFrontmatter, readMergedVolumeOutline } from '@/utils/helpers';
import { findBodyFileV4 } from '@/engine/chapter-utils';
import { deriveBodyFormat, describeBodyFormat } from '@/shared/body-format';
import { readFanficPromptBlockWithNotice } from '@/ui/fanfic-prompt-notice';
import { ObsidianFileSystem } from '@/shared/file-system-port';
import { loadLongTermMemory } from '@/engine/long-term-memory';
import { findWritingStyleFile } from '@/ui/writing-style-paths';
import { createLogger } from '@/shared/logger';
import { parseSceneBlocks } from '@/engine/scene-generation-loop';
import { formatDialogueSkeleton, formatSceneCardDigest } from '@/shared/scene-card';
import { pjPromiseLedger, pjCharacterArcTable, readProjectMeta } from '@/shared/paths';
import { parsePromiseLedger, formatOpenPromisesForPrompt } from '@/engine/promise-ledger';
import { parseCharacterArcTable, formatArcsForPrompt } from '@/engine/character-arc';
import { getCreationModeLabel, getCreationModePromptBlock, getCreationUnitLabel, parseCreationModeMeta } from '@/shared/creation-mode';
import { getStoryStructure, getStructureStageSummary } from '@/shared/story-structure';
import { buildHumanVoiceBlock } from '@/engine/prompts/human-voice';
import { formatExemplarBlock, selectExemplars } from '@/engine/prompts/style-exemplars';
import { voiceVariantMeta } from '@/engine/prompts/prompt-registry';
import {
  applyStoryContextToVars,
  buildStoryContext,
  logStoryContextSummary,
  resolveStoryContextTier,
} from '@/engine/context/story-context-service';

const log = createLogger('TemplateVarsBuilder');
import { setActiveInputBudget } from '@/shared/context-budget-policy';
import {
    CHAR_TO_TOKEN_RATIO,
    getInfoDebtMax,
    INFO_DEBT_WARN_CRITICAL,
    INFO_DEBT_WARN_HIGH,
    FORCED_REVEAL_OVER_20,
    FORCED_REVEAL_OVER_15,
    FORCED_REVEAL_OVER_10,
    FORCED_REVEAL_OVER_5,
    FORCED_REVEAL_WINDOW_FORWARD,
    FORCED_REVEAL_WINDOW_BACKWARD,
} from '@/shared/thresholds';

/** buildTemplateVars 所需依赖（由 full-writer-view 注入）。 */
/**
 * 判断 `writing_rules.style` 是否其实是「规则编号章」的副本。
 * 规则解析器会把 16 个编号章塞进 style；用来决定是否在「文笔风格」里再次注入。
 * @param style - 文风
 * @returns 是否成功
 */
/**
 * 单一镜头声明：视角人物取场景卡 POV，缺省主角。
 * 这是 v4 引导体系的核心锚点——所有正文/复盘提示词共用这一行。
 *
 * @param pov - 场景卡里的视角人物（可空）
 * @returns 形如「【本章镜头】视角人物：X——只写 X 能感知的信息」的声明
 */
function buildLensDeclaration(pov: string | undefined): string {
    const person = (pov || '').trim() || '主角';
    return `【本章镜头】视角人物：${person}——只写 ${person} 能看到、听到、感知到的信息；镜头不切换。`;
}

function looksLikeWritingRules(style: string): boolean {
    const text = String(style || '').trim();
    if (text.length < 400) return false;
    const rulesSignals = ['写作规则', '角色活着', '写作自检', '写作前默念', '唯一禁止事项', '格式参考'];
    const hits = rulesSignals.filter((signal) => text.includes(signal)).length;
    return hits >= 2;
}

/**
 * TemplateVarsDeps 类型定义。
 */
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

/**
 * buildEntityVars 函数。
 * @param deps - 依赖
 * @param vars - 变量表
 * @param d - 参与比较的值
 */
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
    // 连续性三字段（DSH-20261114-02，audit §四-2）：此前 only 上一章快照与
    // association 尾巴覆盖，用户手工更新人物卡对 ${allChars} 无影响。
    if (c.伤势)
      parts.push(`伤势：${c.伤势}`);
    if (c["持有物品"])
      parts.push(`持有：${c["持有物品"]}`);
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
    if (c["已知信息"])
      parts.push(`已知：${c["已知信息"]}`);
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
  // 四类实体各自独立预算：人物 12 个名额，避免被势力/地点/物品挤掉
  const filtered = scoreAndFilterEntitiesByType(allEntities, contextText);
  const characterResults = filtered.filter((e) => e.type === "character");
  // 主角必须始终在人物列表里：上下文为空时关键词打分可能把它漏掉。
  // DSH-20261114-05：死者例外——主角死亡后仍强制注入会造成「活死人」
  //（scoreAndFilterEntities 已把 dead 剔除，这里不再捞回来）。
  const protagonistEntity = allEntities.find(
    (e) =>
      e.type === "character" &&
      /主角|主人公/.test(e.fields["角色定位"] || "") &&
      String(e.fields["entity_status"] || "").trim().toLowerCase() !== "dead",
  );
  if (protagonistEntity && !characterResults.some((e) => e.name === protagonistEntity.name)) {
    characterResults.unshift({
      text: protagonistEntity.formatText,
      score: 0,
      name: protagonistEntity.name,
      type: "character",
    });
  }
  vars["allChars"] = characterResults.map((e) => e.text).join("\n");
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
/**
 * buildContextVars 函数。
 * @param deps - 依赖
 * @param vars - 变量表
 * @param d - 参与比较的值
 */
export async function buildContextVars(deps: TemplateVarsDeps, vars: Record<string, string>, d: ContextData): Promise<void> {
  const compressed = d.compressed;
  if (compressed) {
    // 压缩器可能因输入异常返回空串；空结果绝不能覆盖完整原文
    vars["worldView"] = compressed.worldView.trim() ? compressed.worldView : (d.world_view?.raw || "");
    const slCompressed = compressed.settingLib.trim() ? compressed.settingLib : (d.setting_lib?.raw || "");
    const isSlEmpty = !slCompressed.trim() || slCompressed.includes("<!--") && !slCompressed.replace(/<!--[\s\S]*?-->/g, "").trim();
    const meta = extractWorldviewMeta(compressed.worldView.trim() ? compressed.worldView : (d.world_view?.raw || ""));
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
  const dedupeStyle = deps.plugin.settings.dedupeRulesInStyle !== false;
  if (wr) {
    const style = typeof wr.style === "string" ? wr.style : "";
    // v4.23：规则已在 system 的 ${writingRules} 注入一次；旧实现又把解析出的规则编号章
    // 塞进「文笔风格」再注入 user，导致规则权重翻倍（约 7k vs 人味 1.2k）。
    // 默认去重（dedupeRulesInStyle=true），需要旧行为可在设置里关掉。
    vars["writingStyle"] = dedupeStyle && looksLikeWritingRules(style) ? "" : (style || "");
  }
  // v4.24 修正：正文模板实际用的是 ${writingStyleContent}（文笔风格.md 原文），
  // 旧实现只对没人用的 writingStyle 去重，导致「规则重复注入」在正文链路依然存在。
  const styleContent = d.writing_style?.raw || "";
  vars["writingStyleContent"] = dedupeStyle && looksLikeWritingRules(styleContent) ? "" : styleContent;
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
    const compressedForeshadow = compressed?.foreshadows?.trim() ? compressed.foreshadows : "";
    vars["unrevealedForeshadow"] = compressedForeshadow || filteredUnrevealed.map(
      (f) => `[${f.id}] ${f.name}（重要性:${f.importance || "中"}，埋于:${f.buryChapter || "?"}，计划:${f.plannedReveal || "待定"}）`
    ).join("\n");
    if (filtered.summary) {
      vars["unrevealedForeshadow"] += "\n" + filtered.summary;
    }

    const scoreForeshadow = (f: ForeshadowItem): number => {
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

    const isInRevealWindow = (f: ForeshadowItem): boolean => {
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
    else if (count > getInfoDebtMax()) maxReveal = FORCED_REVEAL_OVER_15;
    else if (count > INFO_DEBT_WARN_CRITICAL) maxReveal = FORCED_REVEAL_OVER_10;
    else if (count > INFO_DEBT_WARN_HIGH) maxReveal = FORCED_REVEAL_OVER_5;

    const revealCount = Math.min(maxReveal, sortedUnrevealed.length);
    const toShow = sortedUnrevealed.slice(0, revealCount);

    if (count > 20) {
      vars["forcedRevealHint"] = revealCount > 0 ? `⚠️ 信息债严重（${count}个未揭示），本章优先揭示以下临近伏笔：
${toShow.map((f) => `- ${f.name}（${f.importance || "中"}，计划:${f.plannedReveal || "?"}）`).join("\n")}` : `⚠️ 信息债严重（${count}个未揭示），但当前无临近揭示窗口内的伏笔，请检查伏笔计划`;
      vars["revealInstruction"] = revealCount > 0 ? `信息债严重：本章优先揭示 ${toShow.map((f) => f.name).join("、")}，控制新伏笔数量` : `信息债严重：但当前无临近揭示窗口内的伏笔，建议检查伏笔计划是否合理`;
    } else if (count > getInfoDebtMax()) {
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
  const compressedTimeline = compressed?.timeline?.trim() ? compressed.timeline : "";
  vars["timelineEvents"] = compressedTimeline || tl.map((t) => `- ${t.time} | ${t.chapter} | ${t.event} | ${t.impact}`).join("\n");
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
    vars["prevChapterStateSnapshot"] = prev.stateSnapshot || "";
  } else {
    // 第一章没有上一章：显式说明，避免模型把空串当成「上一章结尾缺失」而自行编造
    vars["prevChapEnding"] = "（本章为开篇，无上一章结尾）";
    vars["prevChapterStateSnapshot"] = "";
  }
  const outline = d.outline;
  vars["outlineContent"] = outline?.raw || "";
  vars["chapPlan"] = "";
  try {
    const viContent = await readMergedVolumeOutline(deps.app, deps.project);
    if (viContent) {
      // v4.25：先切出当前卷段落再按章号匹配，避免同号章（残留旧卷/重编号）取到别卷规划
      const volSlice = volumeSectionSlice(viContent, deps.volume);
      const chapMatch = volSlice.match(chapterOutlineSection(deps.chapterNum));
      vars["chapPlan"] = chapMatch?.[0]?.trim() || "";
    }
  } catch (e) {
    log.warn("[小说工坊] 操作失败:", e);
  }
  vars["chapPosition"] = `第${deps.chapterNum}章（${deps.volume}）`;
}

/**
 * 一键生成的故事上下文总线适配：
 * - 用同一张图重新选取世界观/设定/实体/时间线/伏笔；
 * - 覆盖既有模板变量，但保留原有变量名与格式；
 * - 额外注入 storyContextPack（关联摘要）与遥测。
 * @param deps - 依赖
 * @param vars - 变量表
 * @param d - 参与比较的值
 */
export async function applyStoryContextBus(
  deps: TemplateVarsDeps,
  vars: Record<string, string>,
  d: ContextData,
): Promise<void> {
  if (!deps.context) return;
  try {
    const tier = resolveStoryContextTier(deps.plugin.settings, 'one-click');
    const settings = deps.plugin.settings;
    // v4.22：总线预算必须按真实模型窗口算。旧实现用 settings.maxContext（实测 32768），
    // 而模型实际 1M，于是包预算只有 12953 token，故事上下文一超预算就被当 P2 整段丢弃。
    let maxInputTokens: number;
    try {
        const limits = deps.plugin.resolveModelLimits(settings.defaultModel || '', settings.apiEndpoint);
        maxInputTokens = Math.max(2048, Math.min(
            limits.maxContext - limits.maxOutput - 1024,
            200_000,
        ));
    } catch {
        maxInputTokens = Math.max(2048, (settings.maxContext || 0) - (settings.maxOutput || 0) - 1024);
    }
    // 同步给上下文配额（上一章结尾/长篇记忆/场景卡/实体速览/知识注入都读它）
    setActiveInputBudget(maxInputTokens);
    const result = buildStoryContext({
      context: deps.context,
      chapterName: deps.chapterName,
      chapterNum: deps.chapterNum,
      volume: deps.volume,
      mode: 'one-click',
      tier,
      maxInputTokens,
      modelId: settings.defaultModel,
      sceneExpansionText: deps.stepResults['sceneExpand'] || deps.viewVars['sceneExpansion'] || d.scene_expansion?.raw || '',
      emotionPlanText: deps.stepResults['emotionPlan'] || deps.viewVars['emotionPlan'] || d.emotion_plan?.raw || '',
      storyLinkage: d.story_linkage || null,
      precedingText: d.previous_chapter?.ending || '',
      queryText: [
        d.outline?.raw || '',
        deps.stepResults['infoPlan'] || '',
        deps.stepResults['plotDistill'] || '',
      ].filter(Boolean).join('\n').slice(0, 6000),
    });
    applyStoryContextToVars(vars, result.bundle, { ...vars });
    logStoryContextSummary(result, `one-click ${deps.chapterName}`);
  } catch (e) {
    log.warn('[TemplateVarsBuilder] 故事上下文总线失败，保留旧变量:', e);
  }
}

/**
 * 上下文体检参与段（key + 中文标签）。
 * 只把这些「长文本、可能互相重复」的段送检；短段与结构化摘要不参与，避免误报。
 */
const HYGIENE_BLOCKS: Array<[string, string]> = [
  ['writingRules', '写作规则'],
  ['writingStyle', '文笔风格(解析)'],
  ['writingStyleContent', '文笔风格'],
  ['humanVoice', '人味约束'],
  ['worldView', '世界观'],
  ['settingLib', '设定库'],
  ['prevChapEnding', '上一章结尾'],
  ['prevChaptersSummary', '前情提要'],
  ['sceneExpansion', '场景展开'],
  ['sceneCardDigest', '场景卡'],
  ['infoPlan', '信息规划'],
  ['outlineContent', '大纲摘要'],
  ['distilledContent', '情节蒸馏'],
  ['emotionPlan', '情绪规划'],
  ['longTermMemory', '长篇记忆'],
  ['storyContextPack', '故事上下文包'],
];

/**
 * 上下文缺失时必须补空串的模板变量。
 * 这些键只在 `deps.context` 存在时由 buildEntityVars / buildContextVars 写入；
 * 漏掉任意一个，fillTemplate 就不会替换，`${allChars}` 这类占位符会原样发给模型。
 * 导出供静态契约测试锁定（见 full-writer-view-contracts.test.ts）。
 */
export const TEMPLATE_VAR_FALLBACK_KEYS = [
  "worldView",
  "settingLib",
  "writingStyleContent",
  "prevChaptersSummary",
  "prevChapEnding",
  "prevChapterStateSnapshot",
  "unrevealedForeshadow",
  "timelineEvents",
  "sceneCardDigest",
  "lensDeclaration",
  "sceneStyleSnippet",
  "suggestedRhythm",
  "openPromises",
  "characterArcs",
  "qualityIssues",
  "creationMode",
  "creationModeLabel",
  "creationUnitLabel",
  "shortCategory",
  "scriptGenre",
  "modeTargetWords",
  "modeTargetUnits",
  "creationModePrompt",
  "storyContextPack",
  "allChars",
  "allFactions",
  "allLocs",
  "allItems",
  "worldType",
  "worldEra",
  "forbiddenElements",
  "powerSystem",
  "characterCores",
  "timeline",
  "protagonistName",
  "chapterHook",
  "entityRelations",
  "_injectionLedger",
] as const;

/**
 * buildTemplateVars 函数。
 * @param deps - 依赖
 * @returns 映射结果
 */
export async function buildTemplateVars(deps: TemplateVarsDeps): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};
  // v4.18：模式硬约束只追加到 system prompt；长篇 block 为空，行为不变。
  try {
    const rawMeta = await readProjectMeta(deps.app, deps.project);
    const modeMeta = parseCreationModeMeta(rawMeta || '');
    vars["creationMode"] = modeMeta.mode;
    vars["creationModeLabel"] = getCreationModeLabel(modeMeta.mode);
    vars["creationUnitLabel"] = getCreationUnitLabel(modeMeta.mode);
    vars["shortCategory"] = modeMeta.shortCategory;
    vars["scriptGenre"] = modeMeta.scriptGenre;
    vars["modeTargetWords"] = String(modeMeta.targetWords);
    vars["modeTargetUnits"] = String(modeMeta.targetUnits);
    // DSH-20261114-07（audit §四-5 勘误）：结构阶段/硬规则**已经**进正文 prompt——
    // creationModePrompt = getCreationModePromptBlock → buildLongStoryPromptBlock
    // 自带「结构阶段 + 硬约束」段，template-utils 把它追加到每个步骤 system prompt。
    // 下面三个 narrativeStructure* 变量定位是 **UI 展示**（状态栏/标题栏），
    // 不是 prompt 注入口——不要因为它们没被模板引用而误判结构约束断链。
    // 链路有测试锁定：tests/unit/shared/story-structure-prompt.test.ts
    vars["creationModePrompt"] = getCreationModePromptBlock(modeMeta.mode, modeMeta);
    const narrative = modeMeta.storySettings ? getStoryStructure(modeMeta.storySettings.structureId) : getStoryStructure('qichengzhuanhe');
    vars["narrativeStructure"] = narrative.id;
    vars["narrativeStructureName"] = narrative.name;
    vars["narrativeStructureStages"] = getStructureStageSummary(narrative.id);
  } catch (e) {
    log.warn('[TemplateVarsBuilder] 读取创作模式失败，按长篇处理:', e);
    vars["creationMode"] = 'long';
    vars["creationModePrompt"] = '';
    vars["narrativeStructure"] = '';
    vars["narrativeStructureName"] = '未设置';
    vars["narrativeStructureStages"] = '';
  }
  // v4.23：规则按版本载入——项目内规则优先、设置里可切换生效版本（旧的硬读 vault 路径已废弃）
  const rulesService = RulesService.getInstance(deps.plugin.app);
  // 显式传 project，避免单例的 project 状态被其他调用串改；setProject 仅保留兼容。
  rulesService.setActiveVersion(deps.plugin.settings.activeRulesVersion);
  const writingRules = await rulesService.getWritingRules(deps.project);
  vars["writingRules"] = writingRules;
  const rulesConfig = await rulesService.getRulesConfig(deps.project);
  vars["_rulesMeta"] = JSON.stringify({
    id: rulesConfig.id || '',
    version: rulesConfig.version || '',
    hash: rulesConfig.hash || '',
    path: rulesConfig.path || '',
    warnings: rulesConfig.warnings || [],
  });
  // 同人约束：非同人项目返回空串；设定失效（未绑定/不存在/读取失败/全空）时提示一次
  vars["fanficRules"] = await readFanficPromptBlockWithNotice(deps.app, deps.project);
  // 长篇记忆：前序卷摘要 + 已确认事实；无数据时为空串，模板不留痕迹
  const beforeVolume = parseInt(deps.volume?.match(/第(\d+)卷/)?.[1] || '0', 10) || undefined;
  vars["longTermMemory"] = await loadLongTermMemory(
    new ObsidianFileSystem(deps.app),
    deps.project,
    { beforeVolume },
  );
  // 剧情记忆：最近 3 章摘要并入长期记忆（数据来自结算后生成的剧情记忆文件）
  const digestBlock = renderChapterDigestBlock(deps.context?.data.chapter_digests ?? []);
  if (digestBlock) {
    vars["longTermMemory"] = [vars["longTermMemory"], `【剧情记忆】\n${digestBlock}`].filter(Boolean).join("\n\n");
  }
  // 整章正文模板允许输出标题行；格式契约仍由项目写作规则推导，避免 prompt 内外两套说法
  vars["bodyFormat"] = describeBodyFormat({ ...deriveBodyFormat(writingRules), allowTitle: true });
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
  // 模板占位符兜底：上下文缺失时填空串，避免 ${worldView} 这类字面量漏进 prompt
  for (const key of TEMPLATE_VAR_FALLBACK_KEYS) {
    if (vars[key] === undefined)
      vars[key] = "";
  }
  // 主角名缺失时用「主角」兜底（模板大量使用 ${protagonistName}）
  if (!vars["protagonistName"])
    vars["protagonistName"] = "主角";
  if (!vars["prevChapEnding"])
    vars["prevChapEnding"] = "（本章无上一章结尾信息：不要自行编造上一章结尾）";
  if (deps.stepResults["infoPlan"]) {
    vars["infoPlan"] = deps.stepResults["infoPlan"];
    // v4.20 章纲数据字段：开头承接/章末钩子/伏笔操作 解析成硬要求块，
    // 随 ${infoPlan} 一路进入正文与结算提示词（数据级反 AI，见 shared/info-plan-fields）。
    const planFields = parseInfoPlanFields(deps.stepResults["infoPlan"]);
    const planBlock = formatInfoPlanPromptBlock(planFields);
    if (planBlock) vars["infoPlan"] = `${vars["infoPlan"]}\n\n${planBlock}`;
    // v4.25：章末钩子从「裸字段」升级为可注入块——V3/V4 模板直接引用；
    // 钩子缺失时保持空串（模板里 ${chapterHook} 行由 fillTemplate 后仍会留下空行，无碍）
    vars["chapterHook"] = planFields.hookContent
      ? `【章末钩子（最后 1–2 段必须落在这个钩子上，不要写总结升华）】类型：${planFields.hookType || "未标注"}；内容：${planFields.hookContent}`
      : "";
  } else {
    vars["infoPlan"] = "（未执行信息规划：仅按分卷大纲推进，不得自行新增情节节点、反转或信息释放）";
    vars["chapterHook"] = "";
  }
  // v4.20 实体状态速览：出场角色的境界/位置/所有权/近况（结算回写 + 图谱反查，零 AI）。
  // 数据缺失时为空串，正文模板里的 ${entityRelations} 占位自然消失。
  try {
    const charNames = ((deps.context?.data as { character_state?: Array<Record<string, unknown>> })?.character_state || [])
      .map((c) => String(c?.name ?? c?.["姓名"] ?? c?.fileName ?? "").trim())
      .filter(Boolean);
    vars["entityRelations"] = (await buildEntityRelationsBlock(deps.app, deps.project, charNames, { maxChars: 8 })).trim();
  } catch (e) {
    log.warn("实体状态速览生成失败:", e);
    vars["entityRelations"] = "";
  }
  if (deps.stepResults["plotDistill"]) {
    vars["distilledContent"] = deps.stepResults["plotDistill"];
  } else {
    // 空串会让模型误以为「没有情节设计」，显式标记缺失比静默注入更安全
    vars["distilledContent"] = "（未执行「情节蒸馏」：请仅依据信息规划与大纲推进，不要自行增加情节节点）";
  }
  if (deps.stepResults["outline"]) {
    vars["outlineContent"] = deps.stepResults["outline"];
  } else if (vars["chapPlan"]) {
    vars["outlineContent"] = `（未生成章节大纲：以下为分卷规划节选，请勿补写未规划场景）\n${vars["chapPlan"]}`;
  } else {
    vars["outlineContent"] = "（未生成章节大纲，也无分卷规划：请严格按信息规划推进，不要新开场景）";
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
  const qualityReport = deps.stepResults["qualityControl"] || "";
  vars["qualityIssues"] = qualityReport
    ? qualityReport.split('\n').filter(line => /^\s*[❌⚠️]/.test(line)).slice(0, 20).join('\n').slice(0, 2500)
    : "";
  vars["foreshadows"] = vars["unrevealedForeshadow"] || "";
  try {
    const ledgerFile = deps.app.vault.getAbstractFileByPath(pjPromiseLedger(deps.project));
    if (ledgerFile instanceof TFile) {
      const raw = await deps.app.vault.read(ledgerFile);
      vars["openPromises"] = formatOpenPromisesForPrompt(parsePromiseLedger(raw), deps.chapterNum);
    } else {
      vars["openPromises"] = "";
    }
  } catch (e) {
    log.warn('[小说工坊] 读取承诺账本失败，跳过:', e);
    vars["openPromises"] = "";
  }
  try {
    const arcFile = deps.app.vault.getAbstractFileByPath(pjCharacterArcTable(deps.project));
    if (arcFile instanceof TFile) {
      const raw = await deps.app.vault.read(arcFile);
      const relevantNames = new Set<string>();
      for (const line of (vars["allChars"] || "").split("\n")) {
        const name = line.match(/^-\s*([^：:]+)/)?.[1]?.trim();
        if (name) relevantNames.add(name);
      }
      vars["characterArcs"] = formatArcsForPrompt(parseCharacterArcTable(raw), relevantNames);
    } else {
      vars["characterArcs"] = "";
    }
  } catch (e) {
    log.warn('[小说工坊] 读取角色弧线表失败，跳过:', e);
    vars["characterArcs"] = "";
  }
  vars["prevReview"] = vars["prevReview"] || "";
  vars["userIntervention"] = deps.viewVars["userIntervention"] || "";
  await buildSceneStyleHint(deps, vars);
  // 用户可能在「角色灵魂」步骤里手动修改过内容。该文件是下游情绪/正文的直接输入，
  // 必须优先于 context 里的旧快照；否则编辑保存后重新生成仍按旧灵魂写。
  const savedSoul = (deps.stepResults["characterSoul"] || "").trim();
  if (deps.context?.data?.character_cores && deps.context.data.character_cores.length > 0) {
    const souls = deps.context.data.character_cores;
    // 只注入本章相关角色：全量注入会稀释 prompt，并在超预算时把关键约束挤掉
    const relevantNames = new Set<string>();
    for (const line of (vars["allChars"] || "").split("\n")) {
      const nameMatch = line.match(/^-\s*([^：:]+)/);
      if (nameMatch) relevantNames.add(nameMatch[1].trim());
    }
    const summary = buildCharacterSoulSummary(souls, vars["protagonistName"] || "主角", { relevantNames });
    vars["characterCores"] = savedSoul || summary.allSouls;
    if (summary.protagonist) {
      vars["protagonistSoulDetail"] = getProtagonistSoulDetail(summary.protagonist);
      log.info("[V2] 主角灵魂层已注入:", summary.protagonist.name, "9字段完整:", summary.protagonist.hasSoul);
    } else {
      // 手工编辑的角色灵魂步骤结果优先于空的主角详情，避免 V2 丢失编辑
      vars["protagonistSoulDetail"] = savedSoul;
    }
    // V2 只认真实 soul：仅有「（灵魂层未配置）」文本不算；手动保存的灵魂文件视为已就绪
    vars["characterSoulReady"] = savedSoul || (summary.hasSoulData && Boolean(summary.protagonist?.hasSoul)) ? "1" : "";
    log.info("[V2] 角色灵魂层注入完毕:", souls.length, "人, hasSoulData:", summary.hasSoulData, "saved:", Boolean(savedSoul));
  } else if (savedSoul) {
    vars["characterCores"] = savedSoul;
    // 没有 context 灵魂时，用步骤结果作为 V2 主角详情兜底
    vars["protagonistSoulDetail"] = savedSoul;
    vars["characterSoulReady"] = "1";
    log.info("[V2] 使用步骤结果中的角色灵魂层（context 无 character_cores）");
  } else {
    vars["characterCores"] = "";
    vars["protagonistSoulDetail"] = "";
    vars["characterSoulReady"] = "";
  }
  vars["emotionPlan"] = deps.stepResults["emotionPlan"] || deps.viewVars["emotionPlan"] || "（未执行情绪规划：按大纲的情绪基调推进，每个场景必须有情绪变化）";
  vars["sceneExpansion"] = deps.stepResults["sceneExpand"] || deps.viewVars["sceneExpansion"] || "（未执行 Scene 展开：按大纲场景顺序推进，场景之间不要无过渡跳转）";
  try {
    const cards = parseSceneBlocks(deps.stepResults["sceneExpand"] || '');
    vars["sceneCardDigest"] = formatSceneCardDigest(cards);
    // v4.26：单一镜头声明——视角人物取第一张场景卡的 POV，缺省主角
    vars["lensDeclaration"] = buildLensDeclaration(cards[0]?.pov);
    // v4.23：对话骨架（Scene 展开的 dialogue_beats）——对话密度来自数据，不靠提示词数比例
    // v4.25：骨架为空时给兜底文案，避免 V3/V4 的【台词清单】只剩空标题（模型会当成可以不写对话）
    vars["dialogueSkeleton"] = formatDialogueSkeleton(cards)
      || "（本章没有台词骨架：请按场景卡与信息规划自然生成对话，信息由角色说出来，不要用叙述转述；每场至少 4 个来回）";
  } catch (e) {
    log.warn('[小说工坊] 场景卡解析失败，跳过镜头/骨架摘要:', e);
    vars["sceneCardDigest"] = '';
    vars["lensDeclaration"] = buildLensDeclaration(undefined);
    vars["dialogueSkeleton"] = "（本章没有台词骨架：请按场景卡与信息规划自然生成对话，信息由角色说出来，不要用叙述转述；每场至少 4 个来回）";
  }
  // v4.23：主链路此前硬编码 quota 版，设置里的 humanVoiceMode 完全不生效。
  // 现在按设置组装：exemplar（样文 + 6 条弱约束）为默认，quota 为对照版本。
  const voiceMode = deps.plugin.settings.humanVoiceMode === 'quota' ? 'quota' : 'exemplar';
  vars["humanVoice"] = buildHumanVoiceBlock({
    mode: voiceMode,
    exemplarBlock: voiceMode === 'exemplar' ? formatExemplarBlock(selectExemplars({ limit: 3 })) : '',
  });
  vars["_voiceMeta"] = JSON.stringify(voiceVariantMeta(voiceMode));
  // 正文模板变体：auto 交给灵魂层判断；v1/v2/v3/v4 为实验与设置的强制指定
  const bodyVariant = String(deps.plugin.settings.activeBodyTemplate || 'auto').toLowerCase();
  vars["_bodyVariant"] = bodyVariant === 'auto' ? '' : bodyVariant;
  // 可数硬指标（实验 C9）：默认关闭，开启后在正文 system 末尾追加
  vars["_countableHints"] = deps.plugin.settings.countableHumanHints ? '1' : '';
  // 实验分组标签：便于把「哪一组实验产生的正文」与账本/步骤结果对上
  vars["_experimentGroup"] = String(deps.plugin.settings.experimentGroup || '');
  vars["triggeredMemories"] = deps.context?.data?.triggered_memories_prompt || "";
  // v4.25：时间上下文（此前只有 Agent harness 注入）。正文/规划现在同样知道「今天是哪天」，
  // 避免期限/季节/年龄推算与真实时间线漂移。
  vars["timeContext"] = buildTimeContextMessage();
  if (deps.context) {
    await applyStoryContextBus(deps, vars, deps.context.data);
  }
  // v4.24 上下文体检：重复段自动清空（保留权威版本）+ 规则/文笔风格格式冲突 + 串章告警。
  // 放在账本之前，保证账本统计的是「真正发出去的段」。
  try {
    const autoFix = deps.plugin.settings.contextHygieneAutoFix !== false;
    const styleConflict = resolveStyleConflicts(vars["writingStyleContent"] || "", vars["writingRules"] || "");
    let conflictIssue: { type: string; severity: string; blocks: string[]; message: string } | null = null;
    if (styleConflict.conflicts.length > 0) {
      const fixed = autoFix && !styleConflict.tooMuchTrimmed && !styleConflict.rulesLackAnchor;
      if (fixed) vars["writingStyleContent"] = styleConflict.cleaned;
      const detail = styleConflict.rulesLackAnchor
        ? '（生效规则没有「每段开头空两格」格式锚点，本次未改风格文本）'
        : styleConflict.tooMuchTrimmed
          ? '（冲突行占比过高，仅告警）'
          : fixed
            ? '（已剔除冲突行）'
            : '（体检自动修复已关闭，仅告警）';
      conflictIssue = {
        type: 'conflict',
        severity: styleConflict.rulesLackAnchor ? 'medium' : 'high',
        blocks: ['writingStyleContent', 'writingRules'],
        message: `「文笔风格」要求「${styleConflict.conflicts.join('、')}」，与自然段规则冲突${detail}`,
      };
    }
    const hygieneBlocks = HYGIENE_BLOCKS
      .map(([key, label]) => ({ key, label, text: vars[key] || '' }))
      .filter((block) => block.text.length > 0);
    const hygiene = auditContextBlocks(hygieneBlocks, { chapterNum: deps.chapterNum });
    if (conflictIssue) hygiene.issues.push(conflictIssue as never);
    if (autoFix) {
      for (const key of hygiene.dropKeys) vars[key] = "";
    }
    vars["_contextHygiene"] = hygiene.issues.length > 0
      ? JSON.stringify({ issues: hygiene.issues, dropped: autoFix ? hygiene.dropKeys : [] })
      : "";
  } catch (e) {
    log.warn("[小说工坊] 上下文体检失败（不影响生成）:", e);
    vars["_contextHygiene"] = "";
  }
  // v4.20 注入溯源账本：对全部模板段统计字符/token/影响面，供步骤日志与成本评估。
  // 纯遥测变量（模板无 ${_injectionLedger} 占位，不会进 prompt）。
  try {
    vars["_injectionLedger"] = JSON.stringify(buildInjectionLedger(vars));
  } catch (e) {
    log.warn("[小说工坊] 注入溯源账本生成失败:", e);
    vars["_injectionLedger"] = "";
  }
  // v4.26：管理界面对步骤模板的自定义覆盖（PromptManager customTemplates）。
  // 只取「用户改过的」默认模板：getTemplateById 命中 custom 才覆盖，避免默认值二份漂移。
  try {
    const pm = deps.plugin.promptManager;
    const overrides: Record<string, { system: string; user: string }> = {};
    const stepToTemplate: Record<string, string> = {
      infoPlan: 'info-plan',
      plotDistill: 'plot-distill',
      outline: 'outline-generation',
      emotionPlan: 'emotion-plan',
      sceneExpand: 'scene-expand',
      bodyGeneration: 'body-generation-v2',
    };
    for (const [stepKey, tplId] of Object.entries(stepToTemplate)) {
      const tpl = pm?.getTemplateById(tplId);
      if (!tpl || !pm) continue;
      const isCustom = pm.getTemplateById(tplId) && (pm as unknown as { config?: { customTemplates?: Array<{ id: string }> } }).config?.customTemplates?.some(t => t.id === tplId);
      if (!isCustom) continue;
      const rendered = pm.renderPrompt(tplId, vars);
      if (rendered && rendered.systemPrompt.trim() && rendered.userPrompt.trim()) {
        overrides[stepKey] = { system: rendered.systemPrompt, user: rendered.userPrompt };
      }
    }
    if (Object.keys(overrides).length > 0) {
      vars['_stepOverrides'] = JSON.stringify(overrides);
    }
  } catch (e) {
    log.warn('[小说工坊] 组装步骤模板覆盖失败，忽略自定义模板:', e);
  }
  return vars;
}
/**
 * buildSceneStyleHint 函数。
 * @param deps - 依赖
 * @param vars - 变量表
 */
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
      dialogue: "对话推进 — 铺垫→发展→转折→收尾"
    };
    vars["suggestedRhythm"] = rhythmMap[sceneType] || rhythmMap.dialogue;
    vars["_sceneType"] = vars["_sceneType"] || sceneType;
  } catch (e) {
    log.warn('[小说工坊] 场景风格提取失败:', e);
  }
}

