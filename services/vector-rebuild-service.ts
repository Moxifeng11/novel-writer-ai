/**
 * vector-rebuild-service.ts — 批量重向量化编排
 *
 * 换 embedding 模型后，知识库与指纹的旧向量会被模型治理跳过（Rev 106/107）：
 * 原文与指纹样本仍在磁盘，只是向量不能再用。重新拆解/重新提取指纹都会调用 AI，
 * 成本高且没有必要——这里只把已有样本文本按当前 embedding 模型重算一遍。
 *
 * 编排与实例构造分离：依赖全部注入，单测不需要 Obsidian。
 */

export interface VectorRebuildBookTarget {
    bookId: string;
    bookName: string;
}

export interface VectorRebuildFingerprintTarget {
    id: string;
    name: string;
    samples: string[];
    /** 模板/全局指纹写全局目录，项目指纹写项目目录 */
    scope: 'global' | 'project';
}

export interface VectorRebuildDeps {
    listBooks: () => Promise<VectorRebuildBookTarget[]>;
    revectorizeBook: (bookId: string, bookName: string) => Promise<void>;
    listFingerprints: () => Promise<VectorRebuildFingerprintTarget[]>;
    revectorizeFingerprint: (target: VectorRebuildFingerprintTarget) => Promise<void>;
}

export interface VectorRebuildSkipOrFailure {
    name: string;
    reason: string;
}

export interface VectorRebuildSectionReport {
    total: number;
    rebuilt: number;
    skipped: VectorRebuildSkipOrFailure[];
    failed: VectorRebuildSkipOrFailure[];
}

export interface VectorRebuildReport {
    books: VectorRebuildSectionReport;
    fingerprints: VectorRebuildSectionReport;
}

export interface VectorRebuildProgress {
    phase: 'books' | 'fingerprints';
    current: number;
    total: number;
    name: string;
}

function emptySection(): VectorRebuildSectionReport {
    return { total: 0, rebuilt: 0, skipped: [], failed: [] };
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return String(error);
}

/**
 * 串行重算知识库与指纹向量。
 *
 * - 单本书 / 单个指纹失败只记录，不中断后续条目；
 * - 没有样本文本的指纹记为 skipped（重算也产生不了向量）；
 * - `listBooks` / `listFingerprints` 本身失败会向上抛出（装配问题，继续没有意义）。
 */
export async function rebuildAllVectors(
    deps: VectorRebuildDeps,
    onProgress?: (progress: VectorRebuildProgress) => void,
): Promise<VectorRebuildReport> {
    const report: VectorRebuildReport = {
        books: emptySection(),
        fingerprints: emptySection(),
    };

    const books = await deps.listBooks();
    report.books.total = books.length;
    for (let i = 0; i < books.length; i++) {
        const book = books[i];
        onProgress?.({ phase: 'books', current: i + 1, total: books.length, name: book.bookName });
        try {
            await deps.revectorizeBook(book.bookId, book.bookName);
            report.books.rebuilt++;
        } catch (e) {
            report.books.failed.push({ name: book.bookName, reason: errorMessage(e) });
        }
    }

    const fingerprints = await deps.listFingerprints();
    report.fingerprints.total = fingerprints.length;
    for (let i = 0; i < fingerprints.length; i++) {
        const fingerprint = fingerprints[i];
        onProgress?.({
            phase: 'fingerprints',
            current: i + 1,
            total: fingerprints.length,
            name: fingerprint.name,
        });
        if (fingerprint.samples.length === 0) {
            report.fingerprints.skipped.push({ name: fingerprint.name, reason: '没有可用的样本文本' });
            continue;
        }
        try {
            await deps.revectorizeFingerprint(fingerprint);
            report.fingerprints.rebuilt++;
        } catch (e) {
            report.fingerprints.failed.push({ name: fingerprint.name, reason: errorMessage(e) });
        }
    }

    return report;
}
