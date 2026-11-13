/**
 * body-v4-vars.test.ts — V4 与 V2 注入变量对齐锁（DSH-20261114-08 子项①）
 *
 * audit §四-7：V4 此前缺 9 个注入变量——显式选 V4 时势力/地点/物品/伏笔/
 * 时间线/上下文包/关系/记忆碎片/长篇记忆整段断料。补齐后本文件锁定对齐，
 * 防未来 V4 再加字段时遗漏。
 */
import { describe, expect, it } from 'vitest';
import {
    BODY_GENERATION_SYSTEM_PROMPT_V4,
    BODY_GENERATION_USER_TEMPLATE_V4,
} from '../../../engine/prompts/body-v4-prompts';
import { BODY_GENERATION_USER_TEMPLATE_V2 } from '../../../engine/prompts/body-v2-prompts';

/** audit §四-7 列出的 V4 缺失九变量 */
const MISSING_NINE = [
    'allFactions',
    'allLocs',
    'allItems',
    'unrevealedForeshadow',
    'timelineEvents',
    'storyContextPack',
    'entityRelations',
    'triggeredMemories',
    'longTermMemory',
] as const;

/** V2/V4 都必须有的核心变量（抽查） */
const CORE_VARS = ['allChars', 'worldView', 'outlineContent', 'infoPlan', 'prevChapEnding'] as const;

describe('body-v4 注入变量对齐（DSH-20261114-08①）', () => {
    it('V4 user 模板引用全部九个此前缺失的变量', () => {
        for (const v of MISSING_NINE) {
            expect(BODY_GENERATION_USER_TEMPLATE_V4).toContain(`\${${v}}`);
        }
    });

    it('V4 核心变量与 V2 对齐（抽查）', () => {
        for (const v of CORE_VARS) {
            expect(BODY_GENERATION_USER_TEMPLATE_V4).toContain(`\${${v}}`);
            expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain(`\${${v}}`);
        }
    });

    it('V4 极简语气保留：不引入 V2 的工艺说教段', () => {
        // V4 的身份是「对话主干版」——补数据不补说教（缺这些 V2 段是设计而非断料）
        expect(BODY_GENERATION_USER_TEMPLATE_V4).not.toContain('场景落地提示');
        expect(BODY_GENERATION_USER_TEMPLATE_V4).not.toContain('叙事节奏建议');
        expect(BODY_GENERATION_USER_TEMPLATE_V4).toContain('按台词清单的编号顺序写');
    });

    it('system prompt 保留连续性硬约束（prevChapterStateSnapshot）', () => {
        expect(BODY_GENERATION_SYSTEM_PROMPT_V4).toContain('${prevChapterStateSnapshot}');
    });
});
