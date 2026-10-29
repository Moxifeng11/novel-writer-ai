import { describe, expect, it } from 'vitest';
import { createZip, crc32 } from '../../../engine/export/zip-writer';
import { buildEpub, EPUB_MIMETYPE } from '../../../engine/export/epub-builder';
import { buildDocx } from '../../../engine/export/docx-builder';
import type { ManuscriptChapter } from '../../../engine/export/manuscript-compiler';

const FIXED_DATE = new Date('2026-10-27T08:00:00Z');

function chapter(overrides: Partial<ManuscriptChapter> = {}): ManuscriptChapter {
    return {
        volume: '第1卷',
        chapter: '第1章',
        chapterNum: 1,
        title: '开局',
        content: [
            '---',
            'status: written',
            'word_count: 12',
            '---',
            '',
            '# 第1章',
            '',
            '第一段正文。',
            '第二段正文，包含 & < > 特殊字符。',
        ].join('\n'),
        path: '长篇小说/测试/第1章.md',
        ...overrides,
    };
}

/** 最小 ZIP 读取器：只处理 store 模式，用于验证生成物结构 */
function readZip(data: Uint8Array): Map<string, Uint8Array> {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let eocd = -1;
    for (let index = data.length - 22; index >= 0; index--) {
        if (view.getUint32(index, true) === 0x06054b50) {
            eocd = index;
            break;
        }
    }
    if (eocd < 0) throw new Error('EOCD not found');
    const count = view.getUint16(eocd + 10, true);
    let pointer = view.getUint32(eocd + 16, true);
    const entries = new Map<string, Uint8Array>();

    for (let index = 0; index < count; index++) {
        if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('bad central header');
        const nameLength = view.getUint16(pointer + 28, true);
        const extraLength = view.getUint16(pointer + 30, true);
        const commentLength = view.getUint16(pointer + 32, true);
        const localOffset = view.getUint32(pointer + 42, true);
        const name = new TextDecoder().decode(data.subarray(pointer + 46, pointer + 46 + nameLength));

        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad local header');
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const size = view.getUint32(localOffset + 18, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        entries.set(name, data.subarray(start, start + size));

        pointer += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

function text(entries: Map<string, Uint8Array>, path: string): string {
    const data = entries.get(path);
    if (!data) throw new Error(`missing entry ${path}`);
    return new TextDecoder().decode(data);
}

describe('zip-writer', () => {
    it('CRC32 标准向量', () => {
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    });

    it('按写入顺序打包，内容可原样读回', () => {
        const zip = createZip([
            { path: 'a.txt', data: 'hello' },
            { path: 'dir/中文.txt', data: new Uint8Array([1, 2, 3]) },
        ], { date: FIXED_DATE });

        const entries = readZip(zip);
        expect([...entries.keys()]).toEqual(['a.txt', 'dir/中文.txt']);
        expect(new TextDecoder().decode(entries.get('a.txt'))).toBe('hello');
        expect([...entries.get('dir/中文.txt')!]).toEqual([1, 2, 3]);
    });
});

describe('buildEpub', () => {
    const chapters = [
        chapter(),
        chapter({
            chapter: '第2章',
            chapterNum: 2,
            title: '反击',
            content: '# 第2章\n\n第二章正文。',
        }),
        chapter({
            volume: '第2卷',
            chapter: '第3章',
            chapterNum: 3,
            title: '',
            content: '',
        }),
    ];

    it('生成合规的 OCF 结构：mimetype 首个且为 store', () => {
        const built = buildEpub(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', author: '作者甲', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        const entries = readZip(built.data);
        const names = [...entries.keys()];

        expect(names[0]).toBe('mimetype');
        expect(text(entries, 'mimetype')).toBe(EPUB_MIMETYPE);
        expect(names).toContain('META-INF/container.xml');
        expect(names).toContain('OEBPS/content.opf');
        expect(names).toContain('OEBPS/nav.xhtml');
        expect(names).toContain('OEBPS/toc.ncx');
        expect(names).toContain('OEBPS/text/chapter-0001.xhtml');
        expect(names).toContain('OEBPS/text/chapter-0003.xhtml');
        expect(built.chapterCount).toBe(3);
        expect(built.volumeCount).toBe(2);
    });

    it('章节页包含卷/章标题、正文与 XML 转义，不泄漏 frontmatter', () => {
        const built = buildEpub(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        const entries = readZip(built.data);
        const first = text(entries, 'OEBPS/text/chapter-0001.xhtml');

        expect(first).toContain('<h1 class="volume">第1卷</h1>');
        expect(first).toContain('<h2>第1章 开局</h2>');
        expect(first).toContain('第一段正文。');
        expect(first).toContain('&amp; &lt; &gt;');
        expect(first).not.toContain('status: written');
        expect(first).not.toContain('# 第1章');

        const third = text(entries, 'OEBPS/text/chapter-0003.xhtml');
        expect(third).toContain('<h1 class="volume">第2卷</h1>');
    });

    it('OPF/NCX 带书名、作者、章节 itemref 与固定修改时间', () => {
        const built = buildEpub(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', author: '作者甲', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        const entries = readZip(built.data);
        const opf = text(entries, 'OEBPS/content.opf');
        expect(opf).toContain('<dc:title>测试书</dc:title>');
        expect(opf).toContain('<dc:creator>作者甲</dc:creator>');
        expect(opf).toContain('<itemref idref="chapter-1"/>');
        expect(opf).toContain('<itemref idref="chapter-3"/>');
        expect(opf).toContain('<meta property="dcterms:modified">2026-10-27T08:00:00Z</meta>');

        const ncx = text(entries, 'OEBPS/toc.ncx');
        expect(ncx).toContain('<text>第1章 开局</text>');
        expect(ncx).toContain('src="text/chapter-0002.xhtml"');
    });

    it('短篇按「节」显示标题', () => {
        const built = buildEpub([chapter({ chapter: '第1节' })], {
            includeVolumeHeadings: false,
            includeChapterTitles: true,
            unitLabel: '节',
            metadata: { title: '短篇', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        const entries = readZip(built.data);
        expect(text(entries, 'OEBPS/text/chapter-0001.xhtml')).toContain('<h2>第1节 开局</h2>');
    });
});

describe('buildDocx', () => {
    const chapters = [
        chapter(),
        chapter({ chapter: '第2章', chapterNum: 2, title: '', content: '# 第2章\n\n第二章正文。' }),
    ];

    it('生成最小 OOXML 结构', () => {
        const built = buildDocx(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', author: '作者甲', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        const entries = readZip(built.data);
        expect([...entries.keys()]).toEqual([
            '[Content_Types].xml',
            '_rels/.rels',
            'word/document.xml',
            'word/styles.xml',
            'word/_rels/document.xml.rels',
            'docProps/core.xml',
            'docProps/app.xml',
        ]);
        expect(text(entries, '[Content_Types].xml')).toContain('wordprocessingml.document.main+xml');
    });

    it('document.xml 带标题层级、正文缩进样式、分页与 XML 转义', () => {
        const built = buildDocx(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        const entries = readZip(built.data);
        const document = text(entries, 'word/document.xml');

        expect(document).toContain('w:pStyle w:val="Title"');
        expect(document).toContain('w:pStyle w:val="Heading1"');
        expect(document).toContain('w:pStyle w:val="Heading2"');
        expect(document).toContain('w:pStyle w:val="BodyText"');
        expect(document).toContain('<w:t xml:space="preserve">第一段正文。</w:t>');
        expect(document).toContain('&amp; &lt; &gt;');
        expect(document).toContain('<w:br w:type="page"/>');
        expect(document).toContain('<w:sectPr>');
        expect(document).not.toContain('status: written');
        expect(built.chapterCount).toBe(2);
    });

    it('core.xml 写入作者与固定时间', () => {
        const built = buildDocx(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', author: '作者甲', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        const core = text(readZip(built.data), 'docProps/core.xml');
        expect(core).toContain('<dc:title>测试书</dc:title>');
        expect(core).toContain('<dc:creator>作者甲</dc:creator>');
        expect(core).toContain('2026-10-27T08:00:00Z');
    });

    it('未填作者时不写 dc:creator', () => {
        const built = buildDocx(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', date: FIXED_DATE },
            zipDate: FIXED_DATE,
        });
        expect(text(readZip(built.data), 'docProps/core.xml')).not.toContain('dc:creator');
    });
});
