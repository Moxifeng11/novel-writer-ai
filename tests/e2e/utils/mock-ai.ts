/**
 * mock-ai.ts — E2E 用模拟 AI 服务与临时 vault 组合
 *
 * 只被 Playwright 用例引用：启动本地 mock server、生成临时 vault、写入插件 data.json。
 * 不改产品代码，也不访问真实 API。
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestVault, PLUGIN_ID, type TestVault } from './obsidian-app';

const MOCK_SERVER_FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'mock-ai-server.mjs');

export interface MockAIRequestRecord {
    kind: string;
    stream: boolean;
    at: number;
}

export interface MockAIStats {
    total: number;
    byKind: Record<string, number>;
    delayMs: number;
    lastRequests: MockAIRequestRecord[];
}

export interface MockAIServer {
    port: number;
    /** 例如 http://127.0.0.1:12345 */
    baseUrl: string;
    /** 完整 chat completions 端点 */
    endpoint: string;
    stats: () => Promise<MockAIStats>;
    resetStats: () => Promise<void>;
    setDelay: (delayMs: number) => Promise<void>;
    stop: () => Promise<void>;
}

export interface MockEnvironment {
    server: MockAIServer;
    vault: TestVault;
    dataPath: string;
}

const FORCED_SETTINGS: Record<string, unknown> = {
    apiKey: 'mock-key',
    availableModels: ['mock-model'],
    defaultModel: 'mock-model',
    flashModel: 'mock-model',
    proModel: 'mock-model',
    coWriteModel: 'mock-model',
    coWriteModelMode: 'cloud',
    coWriteCloudProvider: 'mock',
    coWriteCloudModel: 'mock-model',
    enableAutoModelFallback: false,
    maxApiRetries: 1,
    promptCacheEnabled: false,
    defaultWordCount: 3000,
    minWordCount: 2500,
    maxWordCount: 5000,
    enableAutoReview: false,
    enableAutoCorrect: false,
    autoRevisionAfterQC: false,
    autoRecheckAfterRevision: false,
    petEnabled: false,
    firstRunComplete: true,
    autoCheckUpdates: false,
};

async function control<T>(baseUrl: string, pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {}),
        },
    });
    if (!response.ok) {
        throw new Error(`mock server 控制请求失败：${pathname} -> HTTP ${response.status}`);
    }
    return await response.json() as T;
}

/**
 * 启动 mock server；等待 stdout 打印端口后再返回。
 * @returns MockAIServer 实例
 */
export async function startMockAIServer(): Promise<MockAIServer> {
    if (!fs.existsSync(MOCK_SERVER_FIXTURE)) {
        throw new Error(`缺少 mock server fixture：${MOCK_SERVER_FIXTURE}`);
    }

    const child: ChildProcess = spawn(process.execPath, [MOCK_SERVER_FIXTURE], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' },
    });

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    const port = await new Promise<number>((resolve, reject) => {
        let stdout = '';
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`mock server 启动超时${stderr.trim() ? `\nstderr:\n${stderr.trim()}` : ''}`));
        }, 20_000);

        const cleanup = (): void => {
            clearTimeout(timer);
            child.stdout?.off('data', onData);
            child.off('exit', onExit);
            child.off('error', onError);
        };
        const onData = (chunk: Buffer | string): void => {
            stdout += String(chunk);
            const match = stdout.match(/MOCK_AI_READY\s+(\{[\s\S]*?\})\s*(?:\r?\n|$)/);
            if (!match) return;
            try {
                const parsed = JSON.parse(match[1]) as { port?: number };
                if (!parsed.port) return;
                cleanup();
                resolve(parsed.port);
            } catch (error) {
                cleanup();
                reject(new Error(`无法解析 mock server 端口：${String(error)}\n${stdout}`));
            }
        };
        const onExit = (code: number | null): void => {
            cleanup();
            reject(new Error(`mock server 提前退出（code=${String(code)}）${stderr.trim() ? `\n${stderr.trim()}` : ''}`));
        };
        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };

        child.stdout?.on('data', onData);
        child.once('exit', onExit);
        child.once('error', onError);
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    let stopped = false;

    const stop = async (): Promise<void> => {
        if (stopped) return;
        stopped = true;
        if (child.exitCode !== null) return;
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                resolve();
            }, 3_000);
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
            child.kill();
        });
    };

    return {
        port,
        baseUrl,
        endpoint: `${baseUrl}/v1/chat/completions`,
        stats: () => control<MockAIStats>(baseUrl, '/__mock/stats'),
        resetStats: async () => {
            await control<{ ok: boolean }>(baseUrl, '/__mock/reset', { method: 'POST' });
        },
        setDelay: async (delayMs: number) => {
            await control<{ ok: boolean }>(baseUrl, '/__mock/config', {
                method: 'POST',
                body: JSON.stringify({ delayMs }),
            });
        },
        stop,
    };
}

function mockProvider(endpoint: string): Record<string, unknown> {
    return {
        id: 'mock',
        name: 'E2E Mock AI',
        endpoint,
        models: ['mock-model'],
        maxContext: 128000,
        maxOutput: 32768,
        sourceType: 'cloud',
        apiFormat: 'openai-chat',
        apiStyle: 'openai',
        isDefault: false,
        isHidden: false,
    };
}

/**
 * 在临时 vault 的插件目录写入 data.json（存在时合并），把设置指向 mock server。
 * @param vault - 临时 vault
 * @param endpoint - chat completions 完整 URL
 * @param overrides - 额外/覆盖设置
 * @returns data.json 绝对路径
 */
export function writeMockPluginData(
    vault: TestVault,
    endpoint: string,
    overrides: Record<string, unknown> = {},
): string {
    const pluginDir = path.join(vault.path, '.obsidian', 'plugins', PLUGIN_ID);
    fs.mkdirSync(pluginDir, { recursive: true });
    const dataPath = path.join(pluginDir, 'data.json');

    let existing: Record<string, unknown> = {};
    if (fs.existsSync(dataPath)) {
        try {
            existing = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Record<string, unknown>;
        } catch {
            existing = {};
        }
    }

    const existingProviders = Array.isArray(existing.customProviders)
        ? existing.customProviders as Array<Record<string, unknown>>
        : [];
    const providers = existingProviders.filter((provider) => provider?.id !== 'mock');
    providers.push(mockProvider(endpoint));

    const providerKeys = {
        ...(typeof existing.providerKeys === 'object' && existing.providerKeys
            ? existing.providerKeys as Record<string, unknown>
            : {}),
        mock: 'mock-key',
    };

    const merged: Record<string, unknown> = {
        ...existing,
        ...overrides,
        ...FORCED_SETTINGS,
        apiEndpoint: endpoint,
        customProviders: providers,
        providerKeys,
    };

    fs.writeFileSync(dataPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    return dataPath;
}

/**
 * 启动 mock server + 创建临时 vault + 写入指向 mock 的 data.json。
 * @param options - 额外设置
 * @returns MockEnvironment 实例
 */
export async function createMockEnvironment(options: {
    settings?: Record<string, unknown>;
} = {}): Promise<MockEnvironment> {
    const server = await startMockAIServer();
    let vault: TestVault | null = null;
    try {
        vault = createTestVault();
        // 预置 lastRunVersion，避免首启欢迎弹窗盖住命令入口（它会延迟 1s 弹出）。
        const pluginDataDir = path.join(vault.path, '.obsidian', 'plugins', 'novel-writer-ai', 'data');
        fs.mkdirSync(pluginDataDir, { recursive: true });
        fs.writeFileSync(path.join(pluginDataDir, 'cache.json'), JSON.stringify({ lastRunVersion: '4.27.0', welcomed: true }, null, 2));
        const dataPath = writeMockPluginData(vault, server.endpoint, { firstRunComplete: true, ...(options.settings || {}) });
        return { server, vault, dataPath };
    } catch (error) {
        await server.stop().catch(() => undefined);
        if (vault) {
            await delay(100);
            fs.rmSync(vault.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
        throw error;
    }
}

/** 关闭环境：停止 server；vault 由调用方按 KEEP_E2E_VAULT 决定是否删除 */
export async function disposeMockEnvironment(env: MockEnvironment | null | undefined): Promise<void> {
    await env?.server.stop().catch(() => undefined);
}
