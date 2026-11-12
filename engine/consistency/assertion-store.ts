/**
 * assertion-store.ts — 断言库的读写与增量合并
 *
 * 三条硬规则（本项目踩过的坑，务必保持）：
 *  1. **区分「文件不存在」与「读取失败」**：不存在 = 首次运行，可写空；
 *     读取失败 = 数据可能还在，**绝不能**用空数组覆盖（否则丢历史断言）。
 *  2. **写入走临时文件 + rename**：中途崩溃不会留下半截 JSON。
 *  3. **读—改—写持锁**：并发结算会丢条目（与章节摘要索引同一类问题）。
 */

import type { FileSystemPort } from '@/shared/file-system-port';
import { pjAssertionsFile, pjConsistencyDir } from '@/shared/paths';
import { withWriteLock } from '@/shared/write-lock';
import { mergeAssertions } from './assertion-extract';
import type { FactAssertion } from './assertion-model';

/** 断言库文件格式 */
export interface PersistedAssertions {
    /** 格式版本，便于后续迁移 */
    version: number;
    /** 最后更新时间（ISO） */
    updatedAt: string;
    /** 断言列表 */
    assertions: FactAssertion[];
}

/** 当前格式版本 */
export const ASSERTIONS_FORMAT_VERSION = 1;

/** 读取结果：区分「不存在」「读取成功」「读取失败」 */
export type AssertionLoadOutcome =
    | { status: 'ok'; assertions: FactAssertion[] }
    | { status: 'missing' }
    | { status: 'read-failed'; reason: string };

/**
 * 读取断言库。
 *
 * @param fs - 文件系统端口
 * @param project - 项目路径
 * @returns 读取结果（三态，调用方必须分别处理）
 */
export async function loadAssertions(
    fs: FileSystemPort,
    project: string,
): Promise<AssertionLoadOutcome> {
    const path = pjAssertionsFile(project);
    let exists = false;
    try {
        exists = await fs.exists(path);
    } catch (error) {
        return { status: 'read-failed', reason: `检查断言库失败：${describeError(error)}` };
    }
    if (!exists) return { status: 'missing' };

    let raw: string;
    try {
        raw = await fs.read(path);
    } catch (error) {
        return { status: 'read-failed', reason: `读取断言库失败：${describeError(error)}` };
    }

    try {
        const parsed = JSON.parse(raw) as Partial<PersistedAssertions>;
        const list = Array.isArray(parsed.assertions) ? parsed.assertions : [];
        return { status: 'ok', assertions: list.filter(isPersistedAssertion) };
    } catch (error) {
        // 解析失败也要当作「读取失败」：内容可能仍可人工挽救，不能覆盖
        return { status: 'read-failed', reason: `断言库 JSON 解析失败：${describeError(error)}` };
    }
}

/**
 * 写入断言库（临时文件 + rename，持锁）。
 *
 * @param fs - 文件系统端口
 * @param project - 项目路径
 * @param assertions - 断言列表
 * @param now - 时间戳（测试可注入）
 */
export async function saveAssertions(
    fs: FileSystemPort,
    project: string,
    assertions: readonly FactAssertion[],
    now: () => Date = () => new Date(),
): Promise<void> {
    const path = pjAssertionsFile(project);
    await withWriteLock(path, async () => {
        // silent-ok: 目录已存在是正常情况（mkdir 会抛 EEXIST）；真正的创建/写权限问题会在下面的 write 抛错
        await fs.mkdir(pjConsistencyDir(project)).catch(() => undefined);
        const payload: PersistedAssertions = {
            version: ASSERTIONS_FORMAT_VERSION,
            updatedAt: now().toISOString(),
            assertions: [...assertions],
        };
        const content = JSON.stringify(payload, null, 2);
        const tmpPath = `${path}.tmp`;
        await fs.write(tmpPath, content);
        await fs.rename(tmpPath, path);
    });
}

/** 增量合并结果 */
export interface MergeAssertionsResult {
    /** 合并后的总数 */
    total: number;
    /** 本次新增条数 */
    added: number;
    /** 是否成功落盘；false 时**没有**覆盖既有数据 */
    saved: boolean;
    /** 失败原因（saved=false 时给出） */
    reason?: string;
}

/**
 * 增量合并新断言并落盘。
 *
 * 读取失败时**拒绝写入**，把原因返回给调用方（而不是静默覆盖历史）。
 *
 * @param fs - 文件系统端口
 * @param project - 项目路径
 * @param incoming - 本次抽到的断言
 * @returns 合并结果
 */
export async function mergeAndSaveAssertions(
    fs: FileSystemPort,
    project: string,
    incoming: readonly FactAssertion[],
): Promise<MergeAssertionsResult> {
    const loaded = await loadAssertions(fs, project);
    if (loaded.status === 'read-failed') {
        return { total: incoming.length, added: 0, saved: false, reason: loaded.reason };
    }
    const existing = loaded.status === 'ok' ? loaded.assertions : [];
    const merged = mergeAssertions(existing, incoming);
    await saveAssertions(fs, project, merged);
    return { total: merged.length, added: merged.length - existing.length, saved: true };
}

/**
 * 运行时校验：从 JSON 里读出来的条目必须是合法断言（防止旧格式/手改损坏）。
 *
 * @param value - 未知值
 * @returns 是否为合法断言
 */
export function isPersistedAssertion(value: unknown): value is FactAssertion {
    if (!value || typeof value !== 'object') return false;
    const a = value as Partial<FactAssertion>;
    const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
    // 主语/谓语/值/章节/引文都必须非空：空引文等于没有证据，不能进断言库
    return nonEmpty(a.id)
        && nonEmpty(a.kind)
        && nonEmpty(a.subject)
        && nonEmpty(a.predicate)
        && nonEmpty(a.value)
        && nonEmpty(a.chapterKey)
        && nonEmpty(a.quote)
        && nonEmpty(a.source);
}

/**
 * 把未知异常转成可读原因。
 *
 * @param error - 异常
 * @returns 可读文本
 */
function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
