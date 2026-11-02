/**
 * shared/writing-rules-mode-addons.ts
 * 写作规则 v4 的模式附录（长篇连载 / 短篇单元 / 剧本分镜）。
 *
 * 设计：主文档（`writing-rules.ts` 的 WRITING_RULES）只承载与模式无关的引导；
 * 模式差异放在这里，由 `RulesService.getWritingRules()` 按「项目创作模式」拼在
 * 主文档之后——对注入点来说仍然只有 `${writingRules}` 一个变量、一份文本。
 */

import type { CreationMode } from './creation-mode';

/** 长篇连载附录：跨章承接、钩子与长线伏笔的引导。 */
export const LONG_MODE_ADDON = `
---

## 模式附录：长篇连载

- **跨章承接**：这一章的第一拍，从上一章结尾的那口气里长出来；不要另起炉灶，也不要回头复述。
- **章末钩子**：合章前给镜头留一个没被回答的东西——一个动作、一句话、一个没接完的眼神；让读者想立刻点开下一章。
- **长线与短线**：这一章推进了哪条长线（人/关系/谜团）？让它往前挪一步就好，不必在本章说完。
- **连载节奏**：允许一章只完成一件事；把「想写的很多」变成「下一章还能写的更多」。
`;

/** 短篇单元附录：单章完整感与快节奏的引导。 */
export const SHORT_MODE_ADDON = `
---

## 模式附录：短篇单元

- **单元完整感**：当前单元就是一个小世界——开场即入戏，结束时有落点；不必为"下一章"留扣子。
- **快节奏入场**：第一段就让镜头进入具体动作或具体冲突，不从背景介绍开始。
- **单点爆点**：每个单元聚焦一个情绪爆点或转折点，把它写透，其余做背景。
- **收束**：结尾落在情绪落点上（一句动作/一句话），让本单元自己成立。
`;

/** 剧本分镜附录：场景标题、动作行与台词的引导。 */
export const SCRIPT_MODE_ADDON = `
---

## 模式附录：剧本分镜

- **场景标题**：每个场景以「场号. 内/外 地点 - 时间」开头；一场戏只发生在一个时空。
- **动作行**：只写镜头拍得到的动作与声音，用现在时短句；不写心理描写与小说式抒情。
- **台词**：台词独立成行，人物名在前；每句台词都在"做事"——提出要求、隐瞒、试探、反击。
- **分镜节奏**：一场戏一个目标；目标达成或被打破就切下一场，不要在标题之间用叙述过渡。
`;

/**
 * 按创作模式取模式附录；未知模式回退为长篇（与项目层兜底一致）。
 *
 * @param mode - 创作模式
 * @returns 模式附录文本（含前导分隔线）
 */
export function getWritingRulesModeAddon(mode: CreationMode | string | undefined): string {
    switch (mode) {
        case 'short':
            return SHORT_MODE_ADDON;
        case 'script':
            return SCRIPT_MODE_ADDON;
        case 'long':
        default:
            return LONG_MODE_ADDON;
    }
}

/**
 * 组合最终注入文本：主文档 + 模式附录。
 * 保持「单一变量、单一文本」：所有注入点拿到的都是这一份。
 *
 * @param baseRules - 主文档（通常来自 vault 元文件）
 * @param mode - 创作模式
 * @returns 组合后的完整规则文本
 */
export function composeWritingRules(baseRules: string, mode: CreationMode | string | undefined): string {
    const base = String(baseRules || '').trimEnd();
    return `${base}\n${getWritingRulesModeAddon(mode)}`;
}
