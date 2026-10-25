/**
 * api-response-utils.test.ts — API 响应工具函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
    isAPIResponse,
    extractResponseContent,
    extractResponseText,
    stripCodeFence,
    stripThinkingBlock,
    stripModelMeta,
    sanitizeStoryText,
    isPlanningOutput,
    extractJsonObject,
    extractJsonArray,
} from '../../../shared/api-response-utils';
import type { APIResponse } from '../../../engine/ai-engine';

describe('APIResponseUtils', () => {
    describe('isAPIResponse', () => {
        it('有 content 字段的对象返回 true', () => {
            expect(isAPIResponse({ content: 'hello' })).toBe(true);
        });

        it('字符串返回 false', () => {
            expect(isAPIResponse('hello')).toBe(false);
        });

        it('null 返回 false', () => {
            expect(isAPIResponse(null)).toBe(false);
        });

        it('undefined 返回 false', () => {
            expect(isAPIResponse(undefined)).toBe(false);
        });

        it('数字返回 false', () => {
            expect(isAPIResponse(42)).toBe(false);
        });

        it('无 content 字段的对象返回 false', () => {
            expect(isAPIResponse({ text: 'hello' })).toBe(false);
        });

        it('content 为空字符串也返回 true', () => {
            expect(isAPIResponse({ content: '' })).toBe(true);
        });
    });

    describe('extractResponseContent', () => {
        it('字符串直接返回', () => {
            expect(extractResponseContent('hello')).toBe('hello');
        });

        it('APIResponse 返回 content', () => {
            const resp = { content: 'world' } as APIResponse;
            expect(extractResponseContent(resp)).toBe('world');
        });

        it('null 返回默认空字符串', () => {
            expect(extractResponseContent(null)).toBe('');
        });

        it('undefined 返回默认空字符串', () => {
            expect(extractResponseContent(undefined)).toBe('');
        });

        it('null 返回自定义 fallback', () => {
            expect(extractResponseContent(null, 'fallback')).toBe('fallback');
        });

        it('APIResponse content 为空字符串返回空串（非 fallback）', () => {
            const resp = { content: '' } as APIResponse;
            expect(extractResponseContent(resp, 'fallback')).toBe('');
        });
    });

    describe('extractResponseText', () => {
        it('对结果执行 trim', () => {
            expect(extractResponseText('  hello  ')).toBe('hello');
        });

        it('APIResponse 也 trim', () => {
            const resp = { content: '  world  ' } as APIResponse;
            expect(extractResponseText(resp)).toBe('world');
        });

        it('null 返回空字符串', () => {
            expect(extractResponseText(null)).toBe('');
        });

        it('null 返回自定义 fallback', () => {
            expect(extractResponseText(null, 'default')).toBe('default');
        });

        it('纯空白内容 trim 后为空', () => {
            expect(extractResponseText('   ')).toBe('');
        });
    });

    describe('stripCodeFence', () => {
        it('剥离 markdown 代码围栏', () => {
            expect(stripCodeFence('```markdown\n---\n名称: 甲\n---\n```')).toBe('---\n名称: 甲\n---');
        });

        it('剥离无语言标记的围栏', () => {
            expect(stripCodeFence('```\n---\n名称: 甲\n---\n```')).toBe('---\n名称: 甲\n---');
        });

        it('无围栏时仅 trim，不改动内容', () => {
            expect(stripCodeFence('  ---\n名称: 甲\n---  ')).toBe('---\n名称: 甲\n---');
        });

        it('围栏只出现在结尾时不误删正文', () => {
            expect(stripCodeFence('正文 ``` 片段')).toBe('正文 ``` 片段');
        });
    });

    describe('stripThinkingBlock', () => {
        it('剥离已闭合的思考段，保留正文', () => {
            expect(stripThinkingBlock('<think>\n好，我需要续写。\n</think>\n\n他握剑而立。')).toBe('他握剑而立。');
        });

        it('未闭合的思考段视为无正文', () => {
            expect(stripThinkingBlock('<think>\n好，我需要续写')).toBe('');
        });

        it('没有思考标签时原样返回', () => {
            expect(stripThinkingBlock('他握剑而立。')).toBe('他握剑而立。');
        });

        it('extractResponseText 同样剥离思考段', () => {
            const resp = { content: '<think>思考</think>正文' } as APIResponse;
            expect(extractResponseText(resp)).toBe('正文');
        });
    });

    describe('stripModelMeta', () => {
        it('剥离「好的，我将按照您的要求续写」导语', () => {
            const raw = '好的，我将按照您的要求续写《九脉逆行》第一章的后续部分。\n\n沈砚站在栈桥边。';
            expect(stripModelMeta(raw)).toBe('沈砚站在栈桥边。');
        });

        it('连续剥离导语后的章节标题与元信息段', () => {
            const raw = [
                '好的，我将根据您的要求继续撰写。以下是这一章的详细内容：',
                '### 章节标题：九脉逆行（二）',
                '【本章写作总计】\n2000字+',
                '沈砚站在栈桥边。',
            ].join('\n\n');
            expect(stripModelMeta(raw)).toBe('沈砚站在栈桥边。');
        });

        it('剥离结尾的赏析评论段', () => {
            const raw = '沈砚站在栈桥边。\n\n这段描写通过细节生动展现了霍清澜的紧张，也暗示了后续冲突。';
            expect(stripModelMeta(raw)).toBe('沈砚站在栈桥边。');
        });

        it('正文以「当然」开头但不含元叙述时保留', () => {
            const raw = '当然，沈砚不会退。\n\n他握紧了剑。';
            expect(stripModelMeta(raw)).toBe(raw);
        });

        it('单段文本不做处理', () => {
            expect(stripModelMeta('好的，我将按照您的要求续写。')).toBe('好的，我将按照您的要求续写。');
        });

        it('sanitizeStoryText 同时剥离思考段与首尾元叙述', () => {
            const raw = '<think>思考</think>好的，我将按照您的要求续写。\n\n沈砚站在栈桥边。\n\n这段描写展现了紧张氛围。';
            expect(sanitizeStoryText(raw)).toBe('沈砚站在栈桥边。');
        });

        it('剥离首部的任意 Markdown 标题段', () => {
            const raw = '### 分析与规划\n\n**设定分析：**\n- 背景\n\n沈砚站在栈桥边。';
            expect(stripModelMeta(raw)).toBe('沈砚站在栈桥边。');
        });

        it('剥离首部的独立标签段', () => {
            const raw = '**场景：碎砂渡口**\n\n霍清澜握紧了手。';
            expect(stripModelMeta(raw)).toBe('霍清澜握紧了手。');
        });
    });

    describe('extractJsonObject', () => {
        it('thinking 前缀 + 尾部解释时能取出 JSON 对象', () => {
            const raw = '<think>\n好，我需要输出 JSON。\n</think>\n{"sceneObjectivesMet": 60}\n\n以上是评估结果。';
            expect(JSON.parse(extractJsonObject(stripThinkingBlock(raw))!)).toEqual({ sceneObjectivesMet: 60 });
        });

        it('无 think 标签但有尾部多余文本时仍能解析', () => {
            const raw = '{"overallCompletion": 42}\n注意：这是估算值。';
            expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ overallCompletion: 42 });
        });

        it('```json 围栏优先使用', () => {
            const raw = '说明文字\n```json\n{"a": 1}\n```';
            expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ a: 1 });
        });

        it('字符串内含花括号不会截断', () => {
            const raw = '{"advice": "写到「{冲突}」时收束"}';
            expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ advice: '写到「{冲突}」时收束' });
        });

        it('没有 JSON 对象时返回 null', () => {
            expect(extractJsonObject('完全没有 JSON')).toBeNull();
            expect(extractJsonObject('')).toBeNull();
        });
    });

    describe('extractJsonArray', () => {
        it('thinking 前缀 + 尾部解释时能取出 JSON 数组', () => {
            const raw = '<think>\n先提取情节线。\n</think>\n[{"name":"解环求生","type":"main"}]\n\n以上为提取结果。';
            expect(JSON.parse(extractJsonArray(stripThinkingBlock(raw))!)).toEqual([
                { name: '解环求生', type: 'main' },
            ]);
        });

        it('```json 围栏优先使用', () => {
            const raw = '说明\n```json\n[{"name":"副线 A"}]\n```';
            expect(JSON.parse(extractJsonArray(raw)!)).toEqual([{ name: '副线 A' }]);
        });

        it('数组元素含嵌套对象与方括号字符串时能正确闭合', () => {
            const raw = '[{"name":"主线[上]","nodes":[{"v":1},{"v":2}]}]';
            expect(JSON.parse(extractJsonArray(raw)!)).toEqual([
                { name: '主线[上]', nodes: [{ v: 1 }, { v: 2 }] },
            ]);
        });

        it('没有 JSON 数组时返回 null', () => {
            expect(extractJsonArray('{"a": 1}')).toBeNull();
            expect(extractJsonArray('')).toBeNull();
        });
    });

    describe('isPlanningOutput', () => {
        it('分析/规划文本判定为 true', () => {
            const raw = [
                '### 分析与规划',
                '**设定分析：**',
                '- **故事背景**：悬浮世界',
                '**当前章节问题：**',
                '- 剧情推进',
                '**解决方案：**',
                '1. 补充情节',
            ].join('\n\n');
            expect(isPlanningOutput(raw)).toBe(true);
        });

        it('纯列表输出判定为 true', () => {
            const raw = ['- 场景一：对话', '- 场景二：冲突', '- 场景三：环境', '- 场景四：收束', '- 场景五：伏笔', '- 场景六：反转'].join('\n');
            expect(isPlanningOutput(raw)).toBe(true);
        });

        it('数字列表输出判定为 true', () => {
            const raw = ['1. 补充冲突', '2. 细化环境', '3. 调整对话', '4. 收束情绪', '5. 埋下伏笔', '6. 留白结尾'].join('\n');
            expect(isPlanningOutput(raw)).toBe(true);
        });

        it('泄漏 step_status 等章节元数据判定为 true', () => {
            const raw = '【A2 本章情绪曲线镀点】\n---\nstep_status: done\n沈砚抬头。';
            expect(isPlanningOutput(raw)).toBe(true);
        });

        it('泄漏 emotion_start 等场景元数据判定为 true', () => {
            const raw = '场景1：碎砂渡·悬索栈桥边\n\nemotion_start: 压抑\n沈砚握住剑柄。';
            expect(isPlanningOutput(raw)).toBe(true);
        });

        it('首行方括号标签 + 数字列表判定为 true', () => {
            const raw = '#### 背景氛围：\n1. **沈铁山的手指发白**\n2. 空气压抑';
            expect(isPlanningOutput(raw)).toBe(true);
        });

        it('整段泄漏设定库 / 世界观规则判定为 true（R1 实测输出）', () => {
            const raw = [
                '---',
                '',
                '#### **世界观底层规则**',
                '1. **物理法则**：  ',
                '   - **灵力守恒**：天地间灵力总量恒定。  ',
                '',
                '2. **时空特性**：  ',
                '   - **三界垂直分层**：凡界→灵界→仙界。  ',
                '',
                '3. **因果/命运规则**：  ',
                '   - **因果循环**：行为决定业力。',
            ].join('\n');
            expect(isPlanningOutput(raw)).toBe(true);
        });

        it('小说正文（含对话与叙述）判定为 false', () => {
            const raw = '沈铁山站在复查口，语气里带着失望：“你看看，这三个月。”\n\n霍清澜握紧了手，指节发白。她没有说话。';
            expect(isPlanningOutput(raw)).toBe(false);
        });

        it('空文本判定为 true', () => {
            expect(isPlanningOutput('')).toBe(true);
        });
    });
});
