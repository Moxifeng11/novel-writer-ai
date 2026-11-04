/**
 * dsh 可选后端：协议 / 会话 / 启动参数（D）
 *
 * 不做真实联网调用：用假 transport 验证帧收发、事件映射、超时与关闭语义。
 * 真实 dsh 由健康检查/手工验证负责。
 */
import { describe, expect, it, vi } from 'vitest';
import { DshJsonRpcClient, DshJsonRpcError } from '../../../engine/agent/dsh/dsh-protocol';
import { DshSession, textOfContentBlocks, type DshTransport } from '../../../engine/agent/dsh/dsh-session';
import { buildDshLaunchPlan, buildSandboxPatch } from '../../../engine/agent/dsh/dsh-launch';
import { buildDshChildEnv, buildDshSpawnSpec } from '../../../engine/agent/dsh/dsh-process';

function fakeTransport() {
    const lineListeners: Array<(line: string) => void> = [];
    const stderrListeners: Array<(line: string) => void> = [];
    const exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
    const written: string[] = [];
    const transport: DshTransport = {
        write: line => { written.push(line); },
        onLine: listener => { lineListeners.push(listener); },
        onStderr: listener => { stderrListeners.push(listener); },
        onExit: listener => { exitListeners.push(listener); },
        kill: vi.fn(),
    };
    return {
        transport,
        written,
        emit: (line: string) => lineListeners.forEach(listener => listener(line)),
        emitStderr: (line: string) => stderrListeners.forEach(listener => listener(line)),
        exit: (code: number | null) => exitListeners.forEach(listener => listener(code, null)),
        lastFrame: () => JSON.parse(written[written.length - 1]),
    };
}

describe('JSON-RPC 客户端', () => {
    it('响应按 id 解析；错误响应保留 code', async () => {
        const frames: string[] = [];
        const client = new DshJsonRpcClient({ write: line => frames.push(line) });
        const ok = client.request<{ value: number }>('initialize', { a: 1 });
        client.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 42 } }));
        await expect(ok).resolves.toEqual({ value: 42 });

        const bad = client.request('boom', {});
        client.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: '没有该方法' } }));
        await expect(bad).rejects.toBeInstanceOf(DshJsonRpcError);
        await expect(bad).rejects.toMatchObject({ code: -32601 });
    });

    it('通知走回调；坏行被忽略并回报', () => {
        const notifications: string[] = [];
        const errors: string[] = [];
        const client = new DshJsonRpcClient({
            write: () => {},
            onNotification: notification => notifications.push(notification.method),
            onProtocolError: message => errors.push(message),
        });
        client.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'session.status', params: {} }));
        client.handleLine('not json');
        expect(notifications).toEqual(['session.status']);
        expect(errors).toHaveLength(1);
    });

    it('超时拒绝；dispose 拒绝所有未完成请求', async () => {
        const client = new DshJsonRpcClient({ write: () => {} });
        await expect(client.request('slow', {}, 20)).rejects.toThrow(/超时/);
        const pending = client.request('pending', {}, 0);
        client.dispose('进程退出');
        await expect(pending).rejects.toThrow('进程退出');
        expect(client.pendingCount).toBe(0);
    });
});

describe('DshSession', () => {
    it('initialize 发送 cwd/provider/model；prompt 发送 contentBlocks', async () => {
        const fake = fakeTransport();
        const session = new DshSession({ transport: fake.transport, sessionId: 's1' });
        const init = session.initialize({ cwd: '/vault', provider: 'deepseek-official', model: 'deepseek-chat', maxTokens: 800 });
        const initFrame = fake.lastFrame();
        expect(initFrame.method).toBe('initialize');
        expect(initFrame.params).toMatchObject({ cwd: '/vault', provider: 'deepseek-official', model: 'deepseek-chat', maxTokens: 800 });
        fake.emit(JSON.stringify({ jsonrpc: '2.0', id: initFrame.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } }));
        await init;

        const prompt = session.prompt('你好');
        const promptFrame = fake.lastFrame();
        expect(promptFrame.method).toBe('session/prompt');
        expect(promptFrame.params).toMatchObject({
            sessionId: 's1',
            contentBlocks: [{ type: 'text', text: '你好' }],
        });
        fake.emit(JSON.stringify({ jsonrpc: '2.0', id: promptFrame.id, result: { messageId: 'm1' } }));
        await expect(prompt).resolves.toBe('m1');
        session.close();
    });

    it('assistant/tool 事件映射到 sink，忽略其它 session', async () => {
        const fake = fakeTransport();
        const texts: string[] = [];
        const tools: Array<{ name: string; ok: boolean; text: string }> = [];
        const session = new DshSession({
            transport: fake.transport,
            sessionId: 's1',
            sink: {
                onAssistantText: text => texts.push(text),
                onToolResult: result => tools.push({ name: result.name || '', ok: result.ok, text: result.text }),
            },
        });

        fake.emit(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session.event',
            params: {
                sessionId: 'other',
                event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '不应出现' }] } } },
            },
        }));
        fake.emit(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session.event',
            params: {
                sessionId: 's1',
                event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '正文回复' }] } } },
            },
        }));
        fake.emit(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session.event',
            params: { sessionId: 's1', event: { type: 'tool/call', data: { callId: 'c1', name: 'read_file', arguments: '{}' } } },
        }));
        fake.emit(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session.event',
            params: {
                sessionId: 's1',
                event: {
                    type: 'tool/result',
                    data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: '文件内容' }] } },
                },
            },
        }));

        expect(texts).toEqual(['正文回复']);
        expect(tools).toEqual([{ name: 'read_file', ok: true, text: '文件内容' }]);
        session.close();
    });

    it('idle 状态唤醒等待；超时给出明确错误；close 杀进程', async () => {
        const fake = fakeTransport();
        const session = new DshSession({ transport: fake.transport, sessionId: 's1' });
        const idle = session.waitForIdle(1_000);
        fake.emit(JSON.stringify({ jsonrpc: '2.0', method: 'session.status', params: { sessionId: 's1', status: 'idle' } }));
        await expect(idle).resolves.toBeUndefined();

        await expect(session.waitForIdle(20)).rejects.toThrow(/空闲超时/);
        session.close();
        expect(fake.transport.kill).toHaveBeenCalledTimes(1);
        expect(session.isClosed).toBe(true);
    });

    it('rc.5 session/wait 返回也视为空闲（不依赖 state 通知）', async () => {
        const fake = fakeTransport();
        const session = new DshSession({ transport: fake.transport, sessionId: 's1' });
        const idle = session.waitForIdle(1_000);
        const frame = fake.lastFrame();
        expect(frame.method).toBe('session/wait');
        expect(frame.params).toEqual({ sessionId: 's1' });
        fake.emit(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} }));
        await expect(idle).resolves.toBeUndefined();
        session.close();
    });

    it('textOfContentBlocks 只取 text，跳过 reasoning/image', () => {
        expect(textOfContentBlocks([
            { type: 'reasoning', text: '思考' },
            { type: 'text', text: '答案' },
            { type: 'image', source: {} },
        ])).toBe('答案');
    });
});

describe('启动参数', () => {
    it('默认 npx + sdk profile；DSH_HOME 与密钥只进 env', () => {
        const plan = buildDshLaunchPlan({
            home: 'C:/plugin/data/dsh',
            workspace: 'C:/vault',
            sandbox: 'read-only',
            apiKey: 'sk-test',
            commandArgs: ['-y', '@deepseek-ai/dsh@0.2.1-rc.5'],
        });
        expect(plan.command).toBe('npx');
        expect(plan.args).toEqual(['-y', '@deepseek-ai/dsh@0.2.1-rc.5', '--profile', 'sdk']);
        expect(plan.env.DSH_HOME).toBe('C:/plugin/data/dsh');
        expect(plan.env.DEEPSEEK_API_KEY).toBe('sk-test');
        // 不继承整个 process.env
        expect(Object.keys(plan.env).sort()).toEqual(['DEEPSEEK_API_KEY', 'DSH_HOME']);
    });

    it('提供 patch 时追加 --patch；sandbox patch 内容正确', () => {
        const plan = buildDshLaunchPlan({
            home: '/h', workspace: '/v', sandbox: 'read-only',
            sandboxPatchPath: '/h/sandbox.yml',
        });
        expect(plan.args).toEqual(['-y', '@deepseek-ai/dsh@0.2.1-rc.5', '--profile', 'sdk', '--patch', '/h/sandbox.yml']);
        expect(buildSandboxPatch('read-only', '/v')).toContain('mode: read-only');
        expect(buildSandboxPatch('workspace-write', '/v')).toContain('workspaceRoot: "/v"');
    });

    it('未显式传 commandArgs 时使用固定版本；非法版本回落默认值', () => {
        const fixed = buildDshLaunchPlan({ home: '/h', workspace: '/v', sandbox: 'read-only' });
        expect(fixed.args[1]).toBe('@deepseek-ai/dsh@0.2.1-rc.5');

        const custom = buildDshLaunchPlan({
            home: '/h', workspace: '/v', sandbox: 'read-only', packageVersion: '0.3.0',
        });
        expect(custom.args[1]).toBe('@deepseek-ai/dsh@0.3.0');

        const injected = buildDshLaunchPlan({
            home: '/h', workspace: '/v', sandbox: 'read-only', packageVersion: '1.0.0 && calc',
        });
        expect(injected.args[1]).toBe('@deepseek-ai/dsh@0.2.1-rc.5');
    });
});

describe('子进程启动（Windows shim）', () => {
    it('POSIX 原样 spawn', () => {
        expect(buildDshSpawnSpec('npx', ['-y', '@deepseek-ai/dsh@0.2.1-rc.5'], 'linux'))
            .toEqual({ command: 'npx', args: ['-y', '@deepseek-ai/dsh@0.2.1-rc.5'] });
    });

    it('Windows 上 npx 经 ComSpec 执行（spawn npx 会 ENOENT）', () => {
        const spec = buildDshSpawnSpec('npx', ['-y', '@deepseek-ai/dsh@0.2.1-rc.5', '--profile', 'sdk'], 'win32', 'C:\\Windows\\System32\\cmd.exe');
        expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
        expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
        expect(spec.args[3]).toBe('npx -y @deepseek-ai/dsh@0.2.1-rc.5 --profile sdk');
    });

    it('含空格的路径被引号包裹，.exe 保持直连', () => {
        const spec = buildDshSpawnSpec('npx', ['-y', '@deepseek-ai/dsh@0.2.1-rc.5', '--patch', 'C:\\a b\\sandbox.yml'], 'win32', 'cmd.exe');
        expect(spec.args[3]).toContain('"C:\\a b\\sandbox.yml"');
        expect(buildDshSpawnSpec('C:\\nodejs\\node.exe', ['x'], 'win32', 'cmd.exe'))
            .toEqual({ command: 'C:\\nodejs\\node.exe', args: ['x'] });
    });
});

describe('子进程环境', () => {
    it('Windows 补 SystemRoot/APPDATA/USERPROFILE，密钥只来自 plan', () => {
        const env = buildDshChildEnv(
            { DSH_HOME: 'C:/h', DEEPSEEK_API_KEY: 'sk-test' },
            { PATH: 'C:\\bin' },
            {
                SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\system32\\cmd.exe',
                APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
                USERPROFILE: 'C:\\Users\\u', PATHEXT: '.EXE;.CMD', PATH: 'C:\\orig',
            },
        );
        expect(env.SystemRoot).toBe('C:\\Windows');
        expect(env.APPDATA).toBe('C:\\Users\\u\\AppData\\Roaming');
        expect(env.USERPROFILE).toBe('C:\\Users\\u');
        expect(env.PATH).toBe('C:\\bin');
        expect(env.DSH_HOME).toBe('C:/h');
        expect(env.DEEPSEEK_API_KEY).toBe('sk-test');
        expect(env).not.toHaveProperty('HOME');
    });

    it('空串不覆盖已补齐的平台变量', () => {
        const env = buildDshChildEnv(
            { DSH_HOME: 'C:/h' },
            { PATH: '' },
            { PATH: 'C:\\Windows\\System32' },
        );
        expect(env.PATH).toBe('C:\\Windows\\System32');
    });
});
