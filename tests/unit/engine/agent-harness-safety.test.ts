/**
 * agent-harness-safety.test.ts — Agent 工作台的数据安全与协议健壮性
 *
 * 锁定这轮修的六类缺陷：
 * 1. 项目名 `..`/`.` 会删掉整库/整个 Vault（`newProjectPath` 只剥斜杠）；
 * 2. `run_command` 可以把任意 ID 透传给 Obsidian（如 app:delete-file）；
 * 3. `resolveProject` 对未知的显式项目原样透传 → 越界读写；
 * 4. 短篇/剧本缺前期调研仍「创建成功」；
 * 5. 协议解析取全文第一个 `{`，前言里的花括号会吞掉真正的工具调用；
 * 6. 结构优先级写反：记忆覆盖随机设定，落盘自相矛盾的设定。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { newProjectPath } from '../../../domains/kernel/project-locator';
import { createHostTools } from '../../../engine/agent/harness/host-tools';
import { parseAssistantTurn } from '../../../engine/agent/harness/agent-loop';
import { validateRevision } from '../../../engine/harness/long-novel-tasks';
import { validateFields } from '../../../engine/harness/structured-output';
import type { AgentContext, GuideAgentPort } from '../../../engine/agent/agent-types';
import type { HarnessMemoryState } from '../../../engine/agent/harness/harness-types';

const CTX: AgentContext = {
    projects: ['长篇小说/旧书'],
    activeProject: '长篇小说/旧书',
};

function makePort(overrides: Partial<GuideAgentPort> = {}) {
    const calls: string[] = [];
    const port: GuideAgentPort & { calls: string[] } = {
        calls,
        createProject: async (params) => {
            calls.push(`create_long:${params.projectName}:${params.storySettings.structureId}`);
            return { created: true, projectId: `长篇小说/${params.projectName}`, fileCount: 1 };
        },
        createShortProject: async (params) => {
            calls.push(`create_short:${params.projectName}`);
            return { created: true, projectId: `短篇小说/${params.projectName}`, fileCount: 1 };
        },
        createScriptProject: async (params) => {
            calls.push(`create_script:${params.projectName}`);
            return { created: true, projectId: `剧本/${params.projectName}`, fileCount: 1 };
        },
        openWizard: async (project) => { calls.push(`open_wizard:${project}`); return true; },
        openStorySettings: (project) => { calls.push(`open_story:${project}`); return true; },
        openFullWriter: (project) => { calls.push(`open_full:${project ?? ''}`); return true; },
        openPreResearch: (mode) => { calls.push(`open_pre:${mode}`); return true; },
        runCommand: (id) => { calls.push(`run:${id}`); return true; },
        confirmDangerousAction: async () => { calls.push('approve'); return true; },
        ...overrides,
    };
    return port;
}

function makeTools(port: GuideAgentPort, memory: HarnessMemoryState = { slots: {} }) {
    const tools = createHostTools({ port, ctx: CTX, memory, plan: { steps: [] } });
    const find = (name: string) => {
        const tool = tools.find(t => t.name === name);
        if (!tool) throw new Error(`missing tool ${name}`);
        return tool;
    };
    return { tools, find, memory };
}

describe('newProjectPath — 项目名按不可信输入处理', () => {
    it.each(['..', '.', '...', '  ', ''])('拒绝非法项目名「%s」', (name) => {
        expect(() => newProjectPath(name, 'long')).toThrow(/非法项目名/);
    });

    it('正常名称保留，斜杠被去掉', () => {
        expect(newProjectPath('新界风云', 'long')).toBe('长篇小说/新界风云');
        expect(newProjectPath('a/b\\c', 'short')).toBe('短篇小说/abc');
    });
});

describe('parseAssistantTurn — 协议解析', () => {
    it('代码围栏内的协议优先于正文里的花括号', () => {
        const raw = '我需要 {确认一下} 再回答。\n```json\n{"reply":"好的","tool":{"name":"update_memory","arguments":{"slots":{"a":1}}}}\n```';
        const parsed = parseAssistantTurn(raw);
        expect(parsed.reply).toBe('好的');
        expect(parsed.tool?.name).toBe('update_memory');
        expect(parsed.tool?.args).toEqual({ slots: { a: 1 } });
    });

    it('前言里的普通对象不会被当成协议', () => {
        const raw = '先说明 {这不是协议}，然后：{"reply":"正式回复"}';
        expect(parseAssistantTurn(raw).reply).toBe('正式回复');
    });

    it('arguments 是 JSON 字符串时会被解析成对象（OpenAI 兼容端点常见）', () => {
        const raw = JSON.stringify({
            reply: '',
            tool: { name: 'update_memory', arguments: '{"slots":{"genres":["玄幻"]}}' },
        });
        const parsed = parseAssistantTurn(raw);
        expect(parsed.tool?.args).toEqual({ slots: { genres: ['玄幻'] } });
    });

    it('非协议 JSON（没有 reply/tool/chips）按纯文本处理', () => {
        const raw = '{"foo":"bar"}';
        expect(parseAssistantTurn(raw).reply).toBe(raw);
    });
});

describe('host tools — 项目作用域与命令白名单', () => {
    it('未知的显式项目不会透传成路径（open_story_settings）', async () => {
        const port = makePort();
        const { find } = makeTools(port);

        const result = await find('open_story_settings').execute({ project: '../..' }, { memory: { slots: {} } } as never);

        expect(result.ok).toBe(false);
        expect(port.calls.some(c => c.startsWith('open_story'))).toBe(false);
    });

    it('已存在的项目可以正常打开', async () => {
        const port = makePort();
        const { find } = makeTools(port);

        const result = await find('open_story_settings').execute({ project: '旧书' }, { memory: { slots: {} } } as never);

        expect(result.ok).toBe(true);
        expect(port.calls).toContain('open_story:长篇小说/旧书');
    });

    it('run_command 拒绝非本插件命令', async () => {
        const port = makePort();
        const { find } = makeTools(port);

        const result = await find('run_command').execute({ commandId: 'app:delete-file' }, { memory: { slots: {} } } as never);

        expect(result.ok).toBe(false);
        expect(result.content).toContain('只能执行本插件命令');
        expect(port.calls.some(c => c.startsWith('run:'))).toBe(false);
    });

    it('run_command 允许本插件命令', async () => {
        const port = makePort();
        const { find } = makeTools(port);

        const result = await find('run_command').execute({ commandId: 'novel-writer-batch-novels' }, { memory: { slots: {} } } as never);

        expect(result.ok).toBe(true);
        expect(port.calls).toContain('run:novel-writer-batch-novels');
    });

    it('open_full_writer 把项目传给端口（旧实现丢弃参数）', async () => {
        const port = makePort();
        const { find } = makeTools(port);

        const result = await find('open_full_writer').execute({ project: '旧书' }, { memory: { slots: {} } } as never);

        expect(result.ok).toBe(true);
        expect(port.calls).toContain('open_full:长篇小说/旧书');
    });
});

describe('host tools — 创建项目的前期调研完整性', () => {
    it('短篇缺前期调研时不创建，并指出缺哪些字段', async () => {
        const port = makePort();
        const { find } = makeTools(port);

        const result = await find('create_short_project').execute(
            { projectName: '短篇甲', primaryCategory: '婚姻家庭' },
            { memory: { slots: {} } } as never,
        );

        expect(result.ok).toBe(false);
        expect(result.content).toContain('还缺');
        expect(port.calls.some(c => c.startsWith('create_short'))).toBe(false);
    });

    it('短篇字段齐全时正常创建', async () => {
        const port = makePort();
        const { find } = makeTools(port);

        const result = await find('create_short_project').execute(
            {
                projectName: '短篇乙',
                primaryCategory: '婚姻家庭',
                premise: '一句话', coreConflict: '冲突', emotionalPromise: '情绪',
                reversals: '反转', endingPayoff: '兑现', characterCore: '欲望',
            },
            { memory: { slots: {} } } as never,
        );

        expect(result.ok).toBe(true);
        expect(port.calls).toContain('create_short:短篇乙');
    });

    it('结构优先级：随机设定覆盖记忆中的旧结构', async () => {
        const port = makePort();
        const memory: HarnessMemoryState = {
            slots: {
                projectName: '新书',
                genre: '玄幻',
                structureId: 'qichengzhuanhe',
                randomSettings: { structureId: 'three_act', tone: '热血', goldenFinger: '系统' },
            },
        };
        const { find } = makeTools(port, memory);

        const result = await find('create_long_project').execute({}, { memory } as never);

        expect(result.ok).toBe(true);
        const created = (port as unknown as { calls: string[] }).calls.find(c => c.startsWith('create_long'));
        // randomSettings.structureId 生效（若写反会用记忆里的 qichengzhuanhe）
        expect(created).toBe('create_long:新书:three_act');
    });
});

describe('structured-output — 数组字段', () => {
    it('array 类型接受数组、拒绝非数组', () => {
        const fields = [{ key: 'dimensions', type: 'array' as const, required: true, description: '' }];
        expect(validateFields({ dimensions: [{ a: 1 }] }, fields)).toEqual([]);
        expect(validateFields({ dimensions: { a: 1 } }, fields)).toEqual(['dimensions 应为数组']);
    });

    it('定向修订：dimensions 为数组时通过校验（旧声明 object 时恒失败）', () => {
        const issues = validateRevision({
            dimensions: [{ dimension: 'style', changed: true, note: '加强了比喻' }],
            body: '修订后的正文'.repeat(40),
        } as never);
        expect(issues.join('')).not.toContain('应为对象');
        expect(issues.join('')).not.toContain('必须是数组');
    });
});

describe('host tools — 高成本命令需用户确认（吸收 dsh user-approval）', () => {
    it('用户拒绝时命令不执行', async () => {
        const port = makePort({ confirmDangerousAction: async () => false });
        const { find } = makeTools(port);

        const result = await find('run_command').execute(
            { commandId: 'novel-writer-batch-novels' },
            { memory: { slots: {} } } as never,
        );

        expect(result.ok).toBe(false);
        expect(result.content).toContain('用户拒绝');
        expect(port.calls.some(c => c.startsWith('run:'))).toBe(false);
    });

    it('用户允许后才执行，并把命令与原因展示给确认框', async () => {
        const seen: Array<{ title: string; detail: string }> = [];
        const port = makePort({
            confirmDangerousAction: async (request) => { seen.push(request); return true; },
        });
        const { find } = makeTools(port);

        const result = await find('run_command').execute(
            { commandId: 'novel-writer-batch-chapters', reason: '补齐第 3-5 章' },
            { memory: { slots: {} } } as never,
        );

        expect(result.ok).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0].detail).toContain('novel-writer-batch-chapters');
        expect(seen[0].detail).toContain('补齐第 3-5 章');
        expect(port.calls).toContain('run:novel-writer-batch-chapters');
    });

    it('只读类命令不弹确认', async () => {
        let asked = 0;
        const port = makePort({ confirmDangerousAction: async () => { asked++; return true; } });
        const { find } = makeTools(port);

        const result = await find('run_command').execute(
            { commandId: 'novel-writer-open-knowledge-base' },
            { memory: { slots: {} } } as never,
        );

        expect(result.ok).toBe(true);
        expect(asked).toBe(0);
    });

    it('没有确认端口时危险命令直接拒绝', async () => {
        const port = makePort();
        delete (port as unknown as Record<string, unknown>).confirmDangerousAction;
        const { find } = makeTools(port);

        const result = await find('run_command').execute(
            { commandId: 'novel-writer-export-manuscript' },
            { memory: { slots: {} } } as never,
        );

        expect(result.ok).toBe(false);
        expect(port.calls.some(c => c.startsWith('run:'))).toBe(false);
    });
});
