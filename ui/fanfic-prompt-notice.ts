import { App, Notice } from 'obsidian';
import { formatFanficRulesForPrompt, formatFanficRulesLoadWarning, readFanficRules } from '../shared/fanfic-rules';

/**
 * 实体生成入口统一读取同人约束块：设定未绑定 / 文件不存在 / 读取失败 / 内容全空时弹一次提示。
 *
 * 这些入口此前直接 `formatFanficRulesForPrompt(await readFanficRules(...))`：
 * 返回空串与「同人项目本应有约束」在界面上无法区分，生成的人物/势力/地点会脱离原作体系，
 * 还会成为后续 OOC 与设定矛盾检测的错误基准。
 */
export async function readFanficPromptBlockWithNotice(app: App, project: string): Promise<string> {
    const rules = await readFanficRules(app, project);
    const warning = formatFanficRulesLoadWarning(rules);
    if (warning) new Notice(warning, 8000);
    return formatFanficRulesForPrompt(rules);
}
