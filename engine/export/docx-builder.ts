/**
 * docx-builder.ts — 生成 Word .docx 稿件（OOXML，最小但合规）
 *
 * 投稿平台与编辑大多要 Word：标题层级、正文首行缩进、每章分页都由
 * styles.xml 里的样式控制，作者拿到后仍可继续排版。
 * 与 EPUB 共用 ManuscriptChapter 与统计口径。
 */
import {
    formatChapterLabel,
    normalizeChapterBody,
    summarizeManuscriptChapters,
    type ManuscriptChapter,
} from './manuscript-compiler';
import { createZip, type ZipEntry } from './zip-writer';
import type { BookBuildOptions, BuiltBook } from './epub-builder';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="240" w:after="360"/>
    </w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="360" w:after="240"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="240" w:after="120"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:name w:val="Body Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:ind w:firstLineChars="200" w:firstLine="480"/>
    </w:pPr>
  </w:style>
</w:styles>
`;

function escapeXml(text: string): string {
    return String(text ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function isoW3cdtf(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function paragraphXml(text: string, styleId?: string): string {
    const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : '';
    const runs = text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line, index) => `${index > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
        .join('');
    return `<w:p>${pPr}<w:r>${runs}</w:r></w:p>`;
}

function pageBreakXml(): string {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function bodyLines(body: string): string[] {
    return body
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/^#{1,6}\s+/, '').trim())
        .filter(line => line.length > 0);
}

function buildDocumentXml(chapters: ManuscriptChapter[], options: BookBuildOptions): string {
    const parts: string[] = [];
    const title = options.metadata.title || '未命名稿件';
    parts.push(paragraphXml(title, 'Title'));

    let currentVolume: string | null = null;
    chapters.forEach((chapter, index) => {
        if (index > 0) parts.push(pageBreakXml());
        if (options.includeVolumeHeadings && chapter.volume && chapter.volume !== currentVolume) {
            parts.push(paragraphXml(chapter.volume, 'Heading1'));
        }
        if (chapter.volume) currentVolume = chapter.volume;
        if (options.includeChapterTitles) {
            parts.push(paragraphXml(formatChapterLabel(chapter, { unitLabel: options.unitLabel }), 'Heading2'));
        }
        for (const line of bodyLines(normalizeChapterBody(chapter.content))) {
            parts.push(paragraphXml(line, 'BodyText'));
        }
    });

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${parts.map(part => `    ${part}`).join('\n')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
`;
}

function buildCoreXml(metadata: BookBuildOptions['metadata'], iso: string): string {
    const creator = metadata.author?.trim()
        ? `<dc:creator>${escapeXml(metadata.author.trim())}</dc:creator>`
        : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(metadata.title || '未命名稿件')}</dc:title>
  ${creator}
  <dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>
</cp:coreProperties>
`;
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Novel Writer AI</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>1.0</AppVersion>
</Properties>
`;

/** 生成 .docx 二进制与统计信息 */
export function buildDocx(chapters: ManuscriptChapter[], options: BookBuildOptions): BuiltBook {
    const stats = summarizeManuscriptChapters(chapters);
    const date = options.metadata.date ?? new Date();
    const iso = isoW3cdtf(date);

    const entries: ZipEntry[] = [
        { path: '[Content_Types].xml', data: CONTENT_TYPES },
        { path: '_rels/.rels', data: ROOT_RELS },
        { path: 'word/document.xml', data: buildDocumentXml(stats.sorted, options) },
        { path: 'word/styles.xml', data: STYLES_XML },
        { path: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
        { path: 'docProps/core.xml', data: buildCoreXml(options.metadata, iso) },
        { path: 'docProps/app.xml', data: APP_XML },
    ];

    return {
        data: createZip(entries, { date: options.zipDate ?? date }),
        chapterCount: stats.chapterCount,
        volumeCount: stats.volumeCount,
        wordCount: stats.wordCount,
        emptyChapters: stats.emptyChapters,
    };
}
