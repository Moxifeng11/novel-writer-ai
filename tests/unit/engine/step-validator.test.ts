import { describe, it, expect } from 'vitest';
import { validateStepResult, isTemplateSkeleton } from '../../../engine/step-validator';

// 一个字段齐全、可达到 complete 的信息规划内容（5 项必填 + 3 场景加分）
// 注：场景用数字编号以命中正则 /场景\s*\d/
const VALID_INFO_PLAN = `核心冲突：主角与反派的生死对决即将在祠堂展开
情感温度：从平静到狂怒的剧烈过渡
冲突强度：从中等逐步升级到极限高压
熵预算与自信息：控制信息密度避免过早揭示真相
伏笔操作：埋下三处关键伏笔等待后续章节揭示
场景1：祠堂祭拜
场景2：后山追凶
场景3：灯下独坐`;

// 字段齐全的大纲摘要（3 必填 + 场景/地点/人物加分）
// 注：场景用数字编号以命中正则 /场景\s*\d/
const VALID_OUTLINE = `## 全书定位
这是一部以复仇与救赎为主线的东方玄幻小说，讲述少年剑客在乱世中寻找身世的故事。

## 关键场景
场景1：林家祠堂的血夜
场景2：后山追凶的雨夜
场景3：灯下独坐的顿悟
地点：京城、山门、密室

## 结尾钩子
主角终于看见亡妹的画像，真相浮出水面。

人物：林惊鸿、苏白、神秘老者`;

// 一段达到字数门槛的正文（>=2100 字，含对话与句末标点）
function makeValidBody(minLen = 2200): string {
    const paragraph = '他立于祠堂之前，长剑出鞘，剑光如水。林惊鸿望向远山，心中默念亡妹之名，久久不语。';
    let body = '# 第1章 祠堂血夜\n\n';
    body += '"你来了。"老者声音低沉。\n\n';
    while (body.length < minLen) {
        body += paragraph + '\n\n';
    }
    return body;
}

describe('validateStepResult — 未知步骤回退逻辑', () => {
    it('空内容返回 empty 级别与 0 分', () => {
        const r = validateStepResult('unknownStep', '');
        expect(r.level).toBe('empty');
        expect(r.score).toBe(0);
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('无内容');
    });

    it('内容过短（1-100 字）返回 skeleton', () => {
        const r = validateStepResult('unknownStep', '只有几十个字的短内容不足以通过校验');
        expect(r.level).toBe('skeleton');
        expect(r.valid).toBe(false);
    });

    it('中等内容（101-500 字）返回 partial', () => {
        const content = 'a'.repeat(200);
        const r = validateStepResult('unknownStep', content);
        expect(r.level).toBe('partial');
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('内容不足');
    });

    it('长内容（>500 字）未知步骤通过校验', () => {
        const content = 'a'.repeat(600);
        const r = validateStepResult('unknownStep', content);
        expect(r.level).toBe('complete');
        expect(r.valid).toBe(true);
        expect(r.score).toBe(80);
    });
});

describe('validateStepResult — infoPlan 信息规划', () => {
    it('空内容返回 empty', () => {
        const r = validateStepResult('infoPlan', '');
        expect(r.level).toBe('empty');
        expect(r.valid).toBe(false);
    });

    it('字段齐全的内容达到 complete', () => {
        const r = validateStepResult('infoPlan', VALID_INFO_PLAN);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
        expect(r.score).toBeGreaterThanOrEqual(85);
        expect(r.missing).toEqual([]);
    });

    it('缺字段时返回 missing 列表', () => {
        const r = validateStepResult('infoPlan', '核心冲突：一段足够长的核心冲突描述文本');
        expect(r.valid).toBe(false);
        expect(r.missing.length).toBeGreaterThan(0);
    });
});

describe('validateStepResult — outline 大纲摘要', () => {
    it('完整大纲达到 complete', () => {
        const r = validateStepResult('outline', VALID_OUTLINE);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
        expect(r.missing).toEqual([]);
    });

    it('只有空标题时非 complete', () => {
        const r = validateStepResult('outline', '## 全书定位\n## 关键场景\n## 结尾钩子');
        expect(r.valid).toBe(false);
    });

    it('粗体标签后紧跟带冒号的正文导语，不得把导语误当标题', () => {
        // 真实落盘格式：**全书定位**： 下一行是「本章是全书……功能：」
        // 旧实现会把正文导语升成 ## 标题，导致全书定位节内容为空而误判 partial。
        const content = `**全书定位**：
本章是全书**开篇第一章**，承担以下叙事功能：
1. 启动主线旅程，主角从铁匠之子变成逆脉贱籍，全书旅程从这里起步。
2. 建立世界规则，测脉定生死，读者与主角同步认知世界的不公。

**关键场景（4个）** ：
| # | 场景 | 一句话概述 | 叙事功能 |
|---|---|---|---|
| 1 | 碎砂渡 | 父子贿赂录事被拒 | 建立家庭窘境 |
| 2 | 测脉碑前 | 测出九脉逆行 | 核心触发事件 |
| 3 | 砂峡道 | 被押解启程 | 抛出核心悬念 |

**结尾钩子**：
- 钩子类型：悬念式
- 钩子内容：押解役说「三个月」，锁脉环裂纹被裴无极看见，读者带着三个问题进入下一章。`;
        const r = validateStepResult('outline', content);
        expect(r.missing).toEqual([]);
        expect(r.level).toBe('complete');
    });
});

describe('validateStepResult — bodyGeneration 正文生成', () => {
    it('字数达标且含对话与结尾标点时 complete', () => {
        const body = makeValidBody();
        const r = validateStepResult('bodyGeneration', body);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('字数不足时 valid=false', () => {
        const body = '# 第1章\n\n短正文。';
        const r = validateStepResult('bodyGeneration', body);
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('字数达标');
    });
});

describe('validateStepResult — fix / finalFix 修正步骤', () => {
    it('字数与结构齐全时 complete', () => {
        const body = makeValidBody(2200);
        const r = validateStepResult('fix', body);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('finalFix 与 fix 共用同一校验器', () => {
        const body = makeValidBody(2200);
        const rFix = validateStepResult('fix', body);
        const rFinal = validateStepResult('finalFix', body);
        expect(rFix.valid).toBe(rFinal.valid);
    });

    it('内容不足时 valid=false', () => {
        const r = validateStepResult('fix', '太短');
        expect(r.valid).toBe(false);
    });
});

describe('validateStepResult — analysisReport 审查步骤', () => {
    it('包含问题分析、总结与细节时达到 complete', () => {
        const content = `## 问题分析
场景一存在人物OOC问题，需修正。

## 总结评价
整体结构良好，建议改进方向为强化情感铺垫。

## 第1节细节描述
细节内容足够长，可以命中具体细节校验。`;
        const r = validateStepResult('analysisReport', content);
        expect(r.missing).toEqual([]);
        expect(r.level).toBe('complete');
        expect(r.valid).toBe(true);
    });

    it('缺总结评价时 missing 含"总结评价"', () => {
        const content = '## 问题分析\n发现若干问题需修正。\n\n第1节细节';
        const r = validateStepResult('analysisReport', content);
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('总结评价');
    });

    it('空内容返回 empty', () => {
        const r = validateStepResult('analysisReport', '');
        expect(r.level).toBe('empty');
        expect(r.valid).toBe(false);
    });
});

describe('isTemplateSkeleton — 模板骨架判断', () => {
    it('空内容判定为骨架', () => {
        expect(isTemplateSkeleton('')).toBe(true);
    });

    it('过短内容（<30 字）判定为骨架', () => {
        expect(isTemplateSkeleton('短内容')).toBe(true);
    });

    it('含（待 auto_writer 标记判定为骨架', () => {
        expect(isTemplateSkeleton('这是一段足够长的内容但是包含（待 auto_writer 标记')).toBe(true);
    });

    it('含（待定）标记判定为骨架', () => {
        expect(isTemplateSkeleton('这是一段足够长的内容但是包含（待定）标记')).toBe(true);
    });

    it('含未替换模板变量 ${chapNum} 判定为骨架', () => {
        const tpl = '# 角色灵魂\n\n- 角色：\n- 章节：第 ${chapNum} 章 ${chapName}\n\n## 核心欲望\n- 表层目标：\n';
        expect(isTemplateSkeleton(tpl, 'characterSoul')).toBe(true);
    });

    it('outline 步骤 <80 字判定为骨架', () => {
        expect(isTemplateSkeleton('短大纲内容', 'outline')).toBe(true);
    });

    it('正常长内容不判定为骨架', () => {
        expect(isTemplateSkeleton('a'.repeat(100))).toBe(false);
    });
});

describe('validateStepResult — 真实 AI 输出格式兼容（回归）', () => {
    // AI 实际输出用 **粗体标签**，且关键场景以表格呈现
    const REAL_OUTLINE = `**全书定位**：
本章是全书开篇第一章，承担启动主线旅程与埋设暗线的叙事功能。

**关键场景（4个）** ：

| # | 场景 | 一句话概述 | 叙事功能 |
|---|---|---|---|
| 1 | 碎砂渡·悬索栈桥边 | 父亲贿赂录事被拒 | 建立家庭窘境 |
| 2 | 测脉碑前 | 当众验出九脉逆行 | 核心触发事件 |
| 3 | 测脉碑前（续） | 父亲跪求被踹 | 情感峰值 |
| 4 | 北出口砂峡道 | 押解启程 | 抛出悬念 |

**结尾钩子**：
- 钩子类型：悬念式
- 钩子内容：押解役伸出三根手指，暗示主角只剩三个月。`;

    const REAL_PLOT_DISTILL = `**场景节奏设计**：

| 场景 | 叙事速度 | 核心功能 |
|---|---|---|
| 场景1 | 慢速 | 建立父子关系 |
| 场景2 | 中速 | 核心触发事件 |

**情节节点规划**：
1. 日常崩塌：父亲拿出全部积蓄走通录事关卡，失败。
2. 规则宣判：测脉碑上九道脉纹全数倒转，当众除籍。
3. 押解启程：两名押解役一前一后推着主角走进砂峡道。

**爽点设计**：
- 核心爽点：锁脉环扣上时发出异响，暗示逆脉之力反弹。

**冲突升级路径**：
- 初始状态：底层对底层的摩擦。
- 升级点1：制度对人，当众命名。
- 高潮点：父亲跪求被踹，主角被扣环。

**信息密度指标**：
- 新规则信息：5条
- 人物信息：4人核心展示`;

    const REAL_SCENE_EXPAND = `### scene1: 碎砂渡·悬索栈桥边
objective: 父亲想为儿子买一个能过关的测脉结果。
emotion_arc: 压抑的希冀(6.5/10) → 压抑的焦虑(4.5/10) — 录事拒收。
conflict: 金钱与职权之间的交易失败。
sensory_hook: 铁索在砂峡风里吱呀作响，砂粒钻进草鞋。
body_reaction: 拇指反复摩挲左腕空荡荡的皮肤，指甲掐出月牙印。
subtext: 说“不给了”，意思是“你别再为我低头”。
key_scene: ⭐ 名场面 — 父亲第一次在儿子面前显得无能为力。

### scene2: 碎砂渡·测脉碑前
objective: 完成测脉，维持“人”的身份。
emotion_arc: 压紧的等待(5.5/10) → 当众羞辱的愤怒(9.2/10) — 碑纹倒转。
conflict: 制度秩序与主角身体之间的冲突。
sensory_hook: 碑面冰凉，砂尘里混着铁锈味。
body_reaction: 手指在碑面抠出三道白痕，嘴里有铁锈味。
subtext: 他的沉默翻译过来是“这是错的，但没人会信”。`;

    const REAL_EMOTION_PLAN = `**总体情绪曲线**：压抑的希冀(6.5/10) | 当众除籍的羞辱与愤怒(9.2/10)

**每个场景详细情绪规划**：

### scene1: 碎砂渡·悬索栈桥边
emotion_start: 压抑的希冀(6.5/10) — 父亲带着全部积蓄去渡口找人。
emotion_end: 压抑的焦虑(4.5/10) — 录事拒收，路断了。
emotion_delta: -2.0
body_reaction: 攥布袋的手指关节发白。
relationship_change: 父子从共同隐瞒屈辱变成共同面对更大的屈辱。

### scene2: 碎砂渡·测脉碑前
emotion_start: 压紧的等待(5.5/10) — 把手按在测脉碑上。
emotion_end: 当众被剥去“人”的羞辱与愤怒(9.2/10) — 复测使当众宣读除籍。
emotion_delta: +3.7
body_reaction: 指尖在碑面留下三道白痕。
relationship_change: 与围观人群的关系彻底改变。`;

    it('粗体标签 + 表格的大纲摘要判定为 complete', () => {
        const r = validateStepResult('outline', REAL_OUTLINE);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('情节蒸馏按真实输出字段判定为 complete', () => {
        const r = validateStepResult('plotDistill', REAL_PLOT_DISTILL);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('### sceneN 格式的 Scene 展开判定为 complete', () => {
        const r = validateStepResult('sceneExpand', REAL_SCENE_EXPAND);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('小数情绪等级（6.5/10）的情绪规划判定为 complete', () => {
        const r = validateStepResult('emotionPlan', REAL_EMOTION_PLAN);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('buildCharacterSoulSummary 的紧凑格式判定为 complete', () => {
        const compact = '【★主角 沈砚】欲>让父亲不再低头 | 惧>再次被制度剥夺身份 | 创>母亲死于灵压饥荒 | 弱>不肯示弱 | 怒>有人羞辱父亲 | 底>不伤无辜';
        const r = validateStepResult('characterSoul', compact);
        expect(r.valid).toBe(true);
        expect(r.level).toBe('complete');
    });

    it('中文编号标题 + ### 子节的质量控制判定为 complete', () => {
        // 真实落盘格式：## 一、写作技法检查 紧跟 ### 1. AI痕迹与表达
        // 旧实现把 ### 当同级标题结束，25KB 报告被判 empty；编号前缀也会让关键词失配。
        const qc = `## 一、写作技法检查

### 1. AI痕迹与表达
开篇钩子：⚠️ 待改进。前300字有感官描写，但没有抛出核心冲突，建议提前半句钩子。
冲突升级：✅ 通过。四级递进清晰，从社交冲突到制度暴力再到物理暴力。
爽点到位：⚠️ 待改进。压抑型开篇缺少微小反击，建议押解路上给主角一个小动作。

### 2. 标点与格式规范
破折号：❌ 问题。全文共4处，超过3处限制，建议保留一处其余改逗号。
感叹号：❌ 问题。全文共5处，建议只保留两次关键呼喊。

## 二、连贯性审查

### 设定冲突
✅ 通过。测脉规则、锁脉环、逆脉谷空间关系均与设定库一致，未发现越界能力。

### 人物OOC
✅ 通过。沈砚的忍耐与爆发点符合灵魂层的恐惧与红线，父亲下跪触发其失控合理。

### 伏笔逻辑
✅ 通过。守炉计划、锁脉环裂纹、三个月死亡预告均按计划埋设，没有提前揭示。

## 三、质量评估

### 大纲偏离检测
对照大纲摘要逐条核查：关键场景顺序一致，结尾钩子完整，信息释放未超出计划。
两处轻微偏离：桥头对话略长、砂峡道环境描写占比偏高，但未改变剧情走向。

### 信息密度验证
信息密度处于中高区间，新概念集中在前半章，后半章以动作与对白消化，没有连续设定倾泻。

### 情感曲线检测
开篇压抑、中段羞辱、结尾恐惧与不甘叠加，整体曲线单调下行，缺少短暂回升。

## 修改建议汇总
建议：把破折号压到3处以内，删掉重复感叹号，桥头对话精简两成，押解路上补一个微小反击。`;
        const r = validateStepResult('qualityControl', qc);
        expect(r.missing).toEqual([]);
        expect(r.level).toBe('complete');
    });
});
