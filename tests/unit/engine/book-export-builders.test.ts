import { describe, expect, it } from 'vitest';
import { createZip, crc32 } from '../../../engine/export/zip-writer';
import { buildEpub, coverMediaTypeForExt, EPUB_MIMETYPE, type BookBuildOptions } from '../../../engine/export/epub-builder';
import { buildDocx } from '../../../engine/export/docx-builder';
import type { ManuscriptChapter } from '../../../engine/export/manuscript-compiler';

const FIXED_DATE = new Date('2026-10-27T08:00:00Z');
/** 1×1 PNG 的文件头（不需要可解码，只验证字节原样进入 ZIP） */
const COVER_PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
]);

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


describe('buildEpub — metadata 三字段（DSH-20261113-23）', () => {
    it('description/subject/identifier 写进 content.opf（dc:description/dc:subject）', () => {
        const built = buildEpub(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: {
                title: '测试书',
                author: '作者甲',
                date: FIXED_DATE,
                description: '投稿简介：末法时代的守灯人。',
                subject: ['都市', '悬疑'],
                identifier: 'urn:isbn:1234567890',
            },
            zipDate: FIXED_DATE,
        });
        const entries = readZip(built.data);
        const opf = text(entries, 'OEBPS/content.opf');
        expect(opf).toContain('<dc:description>投稿简介：末法时代的守灯人。</dc:description>');
        expect(opf).toContain('<dc:subject>都市</dc:subject>');
        expect(opf).toContain('<dc:subject>悬疑</dc:subject>');
        expect(opf).toContain('<dc:identifier id="bookid">urn:isbn:1234567890</dc:identifier>');
    });

    it('description 为空白时不渲染 dc:description（不写空节点）', () => {
        const built = buildEpub(chapters, {
            includeVolumeHeadings: true,
            includeChapterTitles: true,
            unitLabel: '章',
            metadata: { title: '测试书', author: '作者甲', date: FIXED_DATE, description: '   ' },
            zipDate: FIXED_DATE,
        });
        const opf2 = text(readZip(built.data), 'OEBPS/content.opf');
        expect(opf2).not.toContain('<dc:description>');
    });
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

describe('buildEpub — 封面图', () => {
    const chapters = [chapter(), chapter({ chapter: '第2章', chapterNum: 2, title: '', content: '# 第2章\n\n第二章正文。' })];
    const baseOptions: BookBuildOptions = {
        includeVolumeHeadings: true,
        includeChapterTitles: true,
        unitLabel: '章',
        metadata: { title: '测试书', author: '作者甲', date: FIXED_DATE },
        zipDate: FIXED_DATE,
    };

    it('无封面：不产生 cover 相关条目，spine 从第一章开始', () => {
        const built = buildEpub(chapters, baseOptions);
        const entries = readZip(built.data);
        expect([...entries.keys()].some(name => name.includes('cover'))).toBe(false);
        const opf = text(entries, 'OEBPS/content.opf');
        expect(opf).not.toContain('properties="cover-image"');
        expect(opf).not.toContain('<meta name="cover"');
        const nav = text(entries, 'OEBPS/nav.xhtml');
        expect(nav.indexOf('chapter-0001.xhtml')).toBeLessThan(nav.indexOf('chapter-0002.xhtml'));
        expect(nav).not.toContain('封面');
    });

    it('带封面：图片字节原样入包，OPF 声明 cover-image，封面页在 spine 首位', () => {
        const built = buildEpub(chapters, {
            ...baseOptions,
            metadata: { ...baseOptions.metadata, cover: { data: COVER_PNG, mediaType: 'image/png', fileExt: 'png' } },
        });
        const entries = readZip(built.data);
        const names = [...entries.keys()];
        expect(names).toContain('OEBPS/images/cover.png');
        expect(names).toContain('OEBPS/cover.xhtml');
        expect([...entries.get('OEBPS/images/cover.png')!]).toEqual([...COVER_PNG]);

        const opf = text(entries, 'OEBPS/content.opf');
        expect(opf).toContain('<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>');
        expect(opf).toContain('<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>');
        expect(opf).toContain('<meta name="cover" content="cover-image"/>');
        // spine 顺序：封面页在最前
        expect(opf.indexOf('idref="cover-page"')).toBeGreaterThan(-1);
        expect(opf.indexOf('idref="cover-page"')).toBeLessThan(opf.indexOf('idref="chapter-1"'));

        const coverPage = text(entries, 'OEBPS/cover.xhtml');
        expect(coverPage).toContain('<img src="images/cover.png" alt="cover"/>');

        // nav/ncx 首项为封面
        const nav = text(entries, 'OEBPS/nav.xhtml');
        expect(nav.indexOf('>封面</a>')).toBeLessThan(nav.indexOf('chapter-0001.xhtml'));
        const ncx = text(entries, 'OEBPS/toc.ncx');
        expect(ncx.indexOf('<text>封面</text>')).toBeLessThan(ncx.indexOf('<text>第1章'));
    });

    it('封面不影响章节统计', () => {
        const built = buildEpub(chapters, {
            ...baseOptions,
            metadata: { ...baseOptions.metadata, cover: { data: COVER_PNG, mediaType: 'image/png', fileExt: 'png' } },
        });
        expect(built.chapterCount).toBe(2);
        expect(built.wordCount).toBeGreaterThan(0);
    });

    it('空封面数据按无封面处理', () => {
        const built = buildEpub(chapters, {
            ...baseOptions,
            metadata: { ...baseOptions.metadata, cover: { data: new Uint8Array(0), mediaType: 'image/png', fileExt: 'png' } },
        });
        const entries = readZip(built.data);
        expect([...entries.keys()].some(name => name.includes('cover'))).toBe(false);
    });

    it('扩展名 → media type 映射', () => {
        expect(coverMediaTypeForExt('png')).toBe('image/png');
        expect(coverMediaTypeForExt('jpg')).toBe('image/jpeg');
        expect(coverMediaTypeForExt('jpeg')).toBe('image/jpeg');
        expect(coverMediaTypeForExt('webp')).toBe('image/webp');
        expect(coverMediaTypeForExt('gif')).toBe('image/gif');
        expect(coverMediaTypeForExt('PNG')).toBe('image/png');
        expect(coverMediaTypeForExt('bmp')).toBeNull();
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
