/**
 * ContextManager.parseWritingRules — 写作规则解析契约回归
 *
 * 该解析器**结构敏感**：按 `## ` 分段，依赖 WRITING_RULE_TITLES（格式参考 / 写作自检 / 写作前默念），
 * 在「格式参考」内按 `### ` 提取 mandatory 规则块，在「写作自检」内提取 `- [ ]` 清单，
 * 并把 `## 一、…` 编号章并入 style。
 *
 * 本测试锁定该契约；其中「`【…】` 结构 → 三路全空」的反向用例，是 P3 写作规范必须
 * 与规范 `.md` 统一结构（而非沿用 `【…】`）的直接证据。
 */
import { describe, it, expect } from 'vitest';
import { ContextManager } from '../../../engine/context-manager';
import { WRITING_RULES } from '../../../engine/prompts';

interface ParsedRules {
    mandatory: Array<{ title: string; description: string; points: string[] }>;
    checklist: string[];
    style: string;
}

/** parseWritingRules 不依赖 this，可直接以空对象为上下文调用 */
function parse(content: string): ParsedRules {
    const fn = (ContextManager.prototype as unknown as {
        parseWritingRules: (c: string) => ParsedRules;
    }).parseWritingRules;
    return fn.call({}, content);
}

const MD_SAMPLE = `## 写作前默念

"我是角色本人。"

---

## 一、角色活着

- 从角色的眼睛往外看

## 十五、写作自检

写之前感受一下：
- [ ] 这个念头是从角色的身体感觉冒出来的吗？
- [ ] 有没有解释性旁白

---

## 格式参考（最低要求）

### 标点
- 感叹号：偶尔用（≤3个/章）
- 不用分号。

### 段落
- 每段开头空两格（全角空格）

### 对话
- 对话必须加引号

### 字数
- 每章≥2000字
`;

describe('ContextManager.parseWritingRules — 解析契约', () => {
    it('规范结构：mandatory（### 规则块）/ checklist（- [ ]）/ style（写作前默念）三路均有结果', () => {
        const r = parse(MD_SAMPLE);

        expect(r.mandatory.map((m) => m.title)).toEqual(['标点', '段落', '对话', '字数']);
        expect(r.mandatory[0].points).toContain('不用分号。');
        expect(r.mandatory[3].points).toContain('每章≥2000字');

        expect(r.checklist).toHaveLength(2);
        expect(r.checklist[0]).toContain('身体感觉');

        expect(r.style).toContain('我是角色本人');
    });

    it('`## 一、…` 编号章并入 style，且保留标题与条目', () => {
        const r = parse(MD_SAMPLE);
        expect(r.style).toContain('一、角色活着');
        expect(r.style).toContain('从角色的眼睛往外看');
    });

    it('`【…】` 结构（旧代码副本）→ 三路全空：证明结构必须统一到规范', () => {
        const legacy = `写作引导（第三人称限知叙事）

【标点与格式】
- 段落开头空两格（全角空格）

【唯一不可违反的规则】
镜头不能跳出主角的身体。`;

        const r = parse(legacy);

        expect(r.mandatory).toEqual([]);
        expect(r.checklist).toEqual([]);
        expect(r.style).toBe('');
    });

    it('空内容 / 无锚点内容均安全返回空结果', () => {
        for (const c of ['', '   ', '# 只有一级标题\n\n正文']) {
            const r = parse(c);
            expect(r.mandatory).toEqual([]);
            expect(r.checklist).toEqual([]);
            expect(r.style).toBe('');
        }
    });
});

describe('WRITING_RULES（代码副本）— 与规范结构一致', () => {
    it('可被完整解析：mandatory 4 块 / checklist 9 条 / style 含编号章与默念', () => {
        const r = parse(WRITING_RULES);

        expect(r.mandatory.map((m) => m.title)).toEqual(['标点', '段落', '对话', '字数']);
        expect(r.mandatory[0].points).toContain('不用分号。不用裸省略号（对话内的可以）。');
        expect(r.mandatory[3].points).toContain('每章≥2000字');

        expect(r.checklist).toHaveLength(9);
        expect(r.style).toContain('一、角色活着');
        expect(r.style).toContain('我是角色本人');
    });

    it('含全部规范锚点与 16 个编号章，且不再使用 `【…】` 自定义分隔符', () => {
        expect(WRITING_RULES).toContain('## 格式参考（最低要求）');
        expect(WRITING_RULES).toContain('## 十六、写作自检');
        expect(WRITING_RULES).toContain('## 写作前默念');

        const numbered = WRITING_RULES
            .split('\n')
            .filter((l) => /^## [一二三四五六七八九十]+[、.]/.test(l.trim()));
        expect(numbered).toHaveLength(16);

        expect(WRITING_RULES).not.toContain('【');
    });
});
