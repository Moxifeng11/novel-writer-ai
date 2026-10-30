import { describe, expect, it } from 'vitest';
import {
    formatInfoPlanPromptBlock,
    parseInfoPlanFields,
} from '../../../shared/info-plan-fields';

const SAMPLE = [
    '---',
    'tags: [信息规划]',
    '章: ""',
    '---',
    '',
    '# 第12章 信息规划',
    '',
    '## 章名',
    '断刃城的早晨',
    '',
    '## 开头承接',
    '- 上一章末句：他把刀插回了鞘里。',
    '- 本章首句承接方式（延续的人物/动作/对话）：延续「武昭」与「刀」的动作线，从清晨擦刀切入。',
    '',
    '## 章末钩子',
    '- 钩子类型（悬念/信息释放/承接下章）：悬念',
    '- 钩子内容：城门守卫认出了他腰间的刀，低声说出一个三百年前该死掉的名字。',
    '',
    '## 伏笔操作',
    '- 需回收的旧伏笔：黑色石头、沈安旧名',
    '- 需埋下的新伏笔：守卫的徽记',
    '',
].join('\n');

describe('info-plan-fields — 章纲数据字段解析', () => {
    it('解析开头承接/章末钩子/伏笔操作三组字段', () => {
        const fields = parseInfoPlanFields(SAMPLE);
        expect(fields.prevTail).toBe('他把刀插回了鞘里。');
        expect(fields.carryElement).toContain('武昭');
        expect(fields.hookType).toBe('悬念');
        expect(fields.hookContent).toContain('三百年前该死掉的名字');
        expect(fields.foreshadowRecycle).toEqual(['黑色石头', '沈安旧名']);
        expect(fields.foreshadowPlant).toEqual(['守卫的徽记']);
    });

    it('旧版信息规划（无新小节）返回空字段，不报错', () => {
        const fields = parseInfoPlanFields('# 第1章 信息规划\n\n## 核心冲突\n\n- 主角 vs 系统：\n');
        expect(fields.prevTail).toBe('');
        expect(fields.hookContent).toBe('');
        expect(fields.foreshadowRecycle).toEqual([]);
        expect(fields.foreshadowPlant).toEqual([]);
    });

    it('空内容返回空字段', () => {
        const fields = parseInfoPlanFields('');
        expect(fields.hookType).toBe('');
        expect(fields.foreshadowRecycle).toEqual([]);
    });

    it('伏笔列表容忍顿号/逗号/分号分隔', () => {
        const content = SAMPLE.replace('- 需回收的旧伏笔：黑色石头、沈安旧名', '- 需回收的旧伏笔：黑色石头，沈安旧名；倒S纹路');
        const fields = parseInfoPlanFields(content);
        expect(fields.foreshadowRecycle).toEqual(['黑色石头', '沈安旧名', '倒S纹路']);
    });
});

describe('info-plan-fields — 提示词块格式化', () => {
    it('全字段输出硬要求块', () => {
        const block = formatInfoPlanPromptBlock(parseInfoPlanFields(SAMPLE));
        expect(block).toContain('【章纲硬要求');
        expect(block).toContain('上一章末句：「他把刀插回了鞘里。」');
        expect(block).toContain('章末钩子（悬念）');
        expect(block).toContain('必须推进或揭示以下旧伏笔：黑色石头、沈安旧名');
        expect(block).toContain('必须埋下以下新伏笔：守卫的徽记');
    });

    it('全空字段返回空串（调用方跳过注入）', () => {
        const block = formatInfoPlanPromptBlock(parseInfoPlanFields(''));
        expect(block).toBe('');
    });

    it('只有钩子时输出钩子行', () => {
        const block = formatInfoPlanPromptBlock(parseInfoPlanFields('## 章末钩子\n- 钩子内容：门外有人等他。\n'));
        expect(block).toContain('章末钩子');
        expect(block).toContain('门外有人等他');
        expect(block).not.toContain('开头承接');
    });
});

describe('parseInfoPlanFields — 存量信息规划的兼容解析（真实项目回放发现）', () => {
    // 真实项目 九霄逆脉行 的信息规划用的是加粗小节 + markdown 表格，
    // 只认 `## 标题` 会让章纲硬要求整段解析为空、约束静默失效。
    const LEGACY = [
        '**伏笔操作（本章埋设）**：',
        '| 伏笔 | 埋设方式 | 后续激活点预估 |',
        '|---|---|---|',
        '| 锁脉环裂纹 | 场景3扣环时暗示结构缺陷 | 第3-5章 |',
        '| “三个月” | 场景4裴无极突然出声 | 第2章 |',
        '',
        '**关系推进**：',
        '- **沈砚→沈铁山**：从隐忍到受辱。',
    ].join('\n');

    it('加粗小节标题也能取到正文（不再返回空）', () => {
        const fields = parseInfoPlanFields(LEGACY);
        expect(fields.foreshadowPlant).toEqual(['锁脉环裂纹', '“三个月”']);
    });

    it('表格第一列作为埋设伏笔；表头与分隔行被跳过', () => {
        const fields = parseInfoPlanFields(LEGACY);
        expect(fields.foreshadowPlant).not.toContain('伏笔');
        expect(fields.foreshadowRecycle).toEqual([]);
    });

    it('加粗小节在下一个加粗小节处结束（不把关系推进算进伏笔）', () => {
        const fields = parseInfoPlanFields(LEGACY);
        expect(fields.foreshadowPlant.some((name) => name.includes('沈砚'))).toBe(false);
    });

    it('列表写法仍然优先于表格兜底', () => {
        const mixed = [
            '## 伏笔操作',
            '- 需埋下的新伏笔：守卫的徽记、断刃',
            '| 表格 | 不该 | 生效 |',
            '|---|---|---|',
            '| 表格名 | x | y |',
        ].join('\n');
        expect(parseInfoPlanFields(mixed).foreshadowPlant).toEqual(['守卫的徽记', '断刃']);
    });

    it('加粗标题能生成章纲硬要求块（存量项目恢复约束）', () => {
        const block = formatInfoPlanPromptBlock(parseInfoPlanFields(LEGACY));
        expect(block).not.toBe('');
        expect(block).toContain('锁脉环裂纹');
    });
});
