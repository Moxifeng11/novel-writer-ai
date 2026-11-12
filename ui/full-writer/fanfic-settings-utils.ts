import { App, TFile } from 'obsidian';
import { isFanficValueFilled, validateFanficSettings } from '@/shared/template-validator';
import { parseFanficReviewStatus } from '@/shared/fanfic-rules';
import { applyFanficReviewMeta } from '@/shared/fanfic-audit';
import { ensureTemplateScaffold } from '@/shared/template-scaffold';
import { pjFanficDir, pjProjectMeta, readProjectMeta, writeProjectMeta } from '@/shared/paths';

/**
 * FanficSettingsValues 类型定义。
 */
export interface FanficSettingsValues {
  workName: string;
  workType: string;
  author: string;
  worldviewType: string;
  powerSystem: string;
  coreRules: string;
  mustFollow: string;
  adaptScope: string;
  redlines: string;
}

/**
 * buildFanficSettingsContent 函数。
 * @param values - 值列表
 * @returns 文本结果
 */
export function buildFanficSettingsContent(values: FanficSettingsValues): string {
  return `---
作品名称: ${values.workName.trim()}
作品类型: ${values.workType.trim()}
作者: ${values.author.trim()}
世界观类型: ${values.worldviewType.trim()}
力量体系: ${values.powerSystem.trim()}
核心规则: ${values.coreRules.trim()}
---

# ${values.workName.trim()} 同人设定

## 原作核心设定
- **世界观类型**：${values.worldviewType.trim()}
- **力量体系**：${values.powerSystem.trim()}
- **核心规则**：${values.coreRules.trim()}

## 主要人物
- **人物名**：（待补充）
  - **原作定位**：（待补充）
  - **在同人中的变化**：（待补充）

## 势力组织
- **势力名**：（待补充）
  - **原作定位**：（待补充）
  - **在同人中的变化**：（待补充）

## 创作规则
- **必须遵守的原作规则**：${values.mustFollow.trim()}
- **允许改编的范围**：${values.adaptScope.trim()}
- **禁止触及的红线**：${values.redlines.trim()}

## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---------|---------|---------|---------|----------------|
| 待补充 | 待补充 | 待补充 | 待补充 | 待补充 |

## 故事背景时间线（你的同人）
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|------------|---------|------------|---------|
| 待补充 | 待补充 | 待补充 | 待补充 |
`;
}

/**
 * 同一套文件名规则：创建项目、生成设定、绑定/补全都用它，避免 .project 指向不存在的路径。
 *
 * @param workName - 作品名
 * @returns 文本结果
 */
export function fanficSettingsFileName(workName: string): string {
  return `${sanitizeFilePart(workName)}设定.md`;
}

const FANFIC_TEMPLATE_NAME = '同人设定模板.md';
const FANFIC_TEMPLATE_SOURCE = `元文件/05-同人设定库/${FANFIC_TEMPLATE_NAME}`;

/**
 * 项目内模板路径；模板丢失时可从元文件/内置骨架恢复。
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function projectFanficTemplatePath(project: string): string {
  return `${pjFanficDir(project)}/${FANFIC_TEMPLATE_NAME}`;
}

/**
 * 确保项目内有一份可复用的同人设定模板。
 * 优先复制元文件模板；元文件模板也丢失时，用内置骨架重建，避免“模板丢了就再也建不了”。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export async function ensureFanficTemplate(app: App, project: string): Promise<string> {
  const target = projectFanficTemplatePath(project);
  const existing = app.vault.getAbstractFileByPath(target);
  if (existing instanceof TFile) return target;

  const dir = pjFanficDir(project);
  if (!app.vault.getAbstractFileByPath(dir)) {
    await app.vault.createFolder(dir);
  }

  let content = '';
  const source = app.vault.getAbstractFileByPath(FANFIC_TEMPLATE_SOURCE);
  if (!(source instanceof TFile)) {
    try {
      await ensureTemplateScaffold(app);
    } catch {
      // 忽略：下面用内置骨架兜底
    }
  }
  const restored = app.vault.getAbstractFileByPath(FANFIC_TEMPLATE_SOURCE);
  if (restored instanceof TFile) {
    content = await app.vault.read(restored);
  }
  if (!content.trim()) {
    content = buildFanficSettingsContent({
      workName: '（待填写作品名）',
      workType: '（待填写类型）',
      author: '（待填写作者）',
      worldviewType: '（待核实：未找到可靠原作来源）',
      powerSystem: '（待核实：未找到可靠原作来源）',
      coreRules: '（待核实：未找到可靠原作来源）',
      mustFollow: '（待核实：未找到可靠原作来源）',
      adaptScope: '（待核实：未找到可靠原作来源）',
      redlines: '（待核实：未找到可靠原作来源）',
    });
  }
  const targetFile = app.vault.getAbstractFileByPath(target);
  if (targetFile instanceof TFile) await app.vault.modify(targetFile, content);
  else await app.vault.create(target, content);
  return target;
}

/**
 * 从项目模板复制一份待审核草稿；模板丢失会自动恢复。
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param workName - 作品名
 * @returns 文本结果
 */
export async function createFanficDraftFromTemplate(
  app: App,
  project: string,
  workName: string,
): Promise<string> {
  const templatePath = await ensureFanficTemplate(app, project);
  const templateFile = app.vault.getAbstractFileByPath(templatePath);
  if (!(templateFile instanceof TFile)) throw new Error('同人设定模板不存在');
  const template = await app.vault.read(templateFile);
  const pending = applyFanficReviewMeta(template, {
    '审核状态': 'pending',
    '生成时间': new Date().toISOString(),
    '来源数量': '0',
  });
  const dir = `${pjFanficDir(project)}/_待审核`;
  if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
  const path = `${dir}/${fanficSettingsFileName(workName || '新同人设定')}`;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) await app.vault.modify(existing, pending);
  else await app.vault.create(path, pending);
  return path;
}

/**
 * isFanficApproved 函数。
 * @param content - 内容
 * @returns 是否成功
 */
export function isFanficApproved(content: string): boolean {
  const status = parseFanficReviewStatus(content);
  return status === 'approved' || status === 'legacy';
}

/**
 * extractFanficWorkName 函数。
 * @param content - 内容
 * @param fallbackProject - 回退项目
 * @returns 文本结果
 */
export function extractFanficWorkName(content: string, fallbackProject: string): string {
  const fm = content.match(/^作品名称:\s*(.+)$/m)?.[1]?.trim();
  const heading = content.match(/^#\s*(.+?)\s*同人设定\s*$/m)?.[1]?.trim();
  return sanitizeFilePart(fm || heading || fallbackProject);
}

/**
 * getFanficSettingsPath 函数。
 * @param project - 项目（路径或对象）
 * @param content - 内容
 * @param fallbackProject - 回退项目
 * @returns 文本结果
 */
export function getFanficSettingsPath(project: string, content: string, fallbackProject: string): string {
  return `${pjFanficDir(project)}/${fanficSettingsFileName(extractFanficWorkName(content, fallbackProject))}`;
}

/**
 * isFanficSettingsContentValidEnough 函数。
 * @param content - 内容
 */
export function isFanficSettingsContentValidEnough(content: string) {
  // 向导口径：表单只收集 9 个字段，时间线由用户后续在设定文件里补；
  // 但占位「（待补充）」不是内容，否则绑定/保存都会误报「✅ 已…」。
  const base = validateFanficSettings(content, { requireTimelineData: false });
  const required = ['作品名称', '作品类型', '作者', '世界观类型', '力量体系', '核心规则', '必须遵守的原作规则', '允许改编的范围', '禁止触及的红线'];
  const missing = new Set(base.missingFields);
  const lines = content.split(/\r?\n/);
  for (const key of required) {
    const fmLine = lines.find(line => line.startsWith(`${key}:`));
    const bodyLine = lines.find(line => line.includes(`**${key}**`));
    const fm = fmLine?.replace(`${key}:`, '').trim();
    const body = bodyLine?.replace(new RegExp(`.*\\*\\*${key}\\*\\*[：:]`), '').trim();
    if ((fm !== undefined && !isFanficValueFilled(fm)) || (body !== undefined && !isFanficValueFilled(body))) missing.add(key);
  }
  return { valid: missing.size === 0, missingFields: Array.from(missing) };
}

/**
 * 把同人设定文件路径回写到项目 `.project` 的「## 同人设定路径」段。
 * 向导内保存同人设定时调用，保证重新进入向导后能按同一路径恢复。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param filePath - 文件路径
 */
export async function attachFanficPathToProject(app: App, project: string, filePath: string): Promise<void> {
  const target = app.vault.getAbstractFileByPath(filePath);
  if (!(target instanceof TFile)) {
    throw new Error(`同人设定文件不存在：${filePath}`);
  }
  const content = await app.vault.read(target);
  if (!isFanficApproved(content)) {
    throw new Error('同人设定尚未通过人工审核，不能绑定到项目');
  }
  const dotPath = pjProjectMeta(project);
  const section = `## 同人设定路径\n${filePath}`;
  // `.project` 是点文件，getAbstractFileByPath 恒为 null（见 shared/paths.ts v31），
  // 原实现因此永远走 vault.create：对已有项目要么抛「文件已存在」，
  // 要么把整份 .project（类型/故事结构/同人路径）覆盖成最小模板。
  const raw = await readProjectMeta(app, project);
  if (raw !== null) {
    const next = /^##\s*同人设定路径\s*$/m.test(raw)
      ? raw.replace(/^##\s*同人设定路径\s*\r?\n[^\n]*/m, section)
      : `${raw.trimEnd()}\n\n${section}\n`;
    if (next !== raw) {
      const ok = await writeProjectMeta(app, project, next);
      if (!ok) throw new Error(`写入 .project 失败，同人设定路径未保存：${dotPath}`);
    }
    return;
  }
  const created = await writeProjectMeta(app, project, `# ${project}\n\n## 类型\nfanfic\n\n${section}\n`);
  if (!created) throw new Error(`创建 .project 失败，同人设定路径未保存：${dotPath}`);
}

/**
 * 覆盖保存同人设定文件。
 * 必须对已存在文件走 modify：delete + create 的中间态一旦失败（权限/磁盘/路径竞态），
 * 旧设定已删除、新文件未创建，而 `.project` 仍指向该路径 → 同人约束静默全部失效。
 * @param app - Obsidian 应用实例
 * @param filePath - 文件路径
 * @param content - 内容
 */
export async function saveFanficSettingFile(app: App, filePath: string, content: string): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return;
  }
  await app.vault.create(filePath, content);
}

/**
 * missingFanficValueLabels 函数。
 * @param values - 值列表
 * @returns 结果数组
 */
export function missingFanficValueLabels(values: FanficSettingsValues): string[] {
  const entries: Array<[keyof FanficSettingsValues, string]> = [
    ['workName', '作品名称'],
    ['workType', '作品类型'],
    ['author', '作者'],
    ['worldviewType', '世界观类型'],
    ['powerSystem', '力量体系'],
    ['coreRules', '核心规则'],
    ['mustFollow', '必须遵守的原作规则'],
    ['adaptScope', '允许改编的范围'],
    ['redlines', '禁止触及的红线'],
  ];
  return entries.filter(([key]) => !values[key].trim()).map(([, label]) => label);
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '').trim() || '同人设定';
}
