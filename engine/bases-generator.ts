/**
 * bases-generator.ts — 生成 Obsidian Bases 看板（.base）
 *
 * 把结算已经回写好的 frontmatter 直接变成原生可排序/筛选/分组的看板：
 * 章节进度、人物状态、物品归属、地点与势力。
 * 特点：
 *  - 零维护：数据源就是笔记属性，结算写一次、看板自动更新；
 *  - 零依赖：手写 YAML 字符串，纯函数可测；
 *  - 原生折叠：Bases 视图可拖到右侧栏，随窗口折叠。
 */
import { KIND_NAMESPACE_TAG } from '@/shared/tag-taxonomy';
import { FRONTMATTER_SCHEMAS } from '@/shared/frontmatter-schema';

/** 看板文件（相对项目根） */
export interface BaseFileSpec {
    /** 相对项目根的文件路径 */
    relativePath: string;
    content: string;
}

const GENERATED_MARKER = '# 由「小说工坊 AI」生成，重跑会覆盖本文件。可自由查看，改动不会被保留。';

function quotePath(path: string): string {
    return `"${String(path).replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

/**
 * YAML 字符串值转义（用于 displayName 等）
 *
 * @param value - 值
 * @returns 文本结果
 */
function q(value: string): string {
    return `"${String(value).replace(/"/g, '\\"')}"`;
}

interface ColumnSpec {
    /** note 属性名或 file.xxx */
    property: string;
    display?: string;
}

function propertiesBlock(columns: ColumnSpec[]): string {
    const lines: string[] = [];
    for (const column of columns) {
        if (!column.display) continue;
        lines.push(`  ${column.property}:`);
        lines.push(`    displayName: ${q(column.display)}`);
    }
    return lines.length > 0 ? `properties:\n${lines.join('\n')}\n` : '';
}

function orderBlock(columns: ColumnSpec[], indent = '      '): string {
    return columns.map((column) => `${indent}- ${column.property}`).join('\n');
}

/**
 * 章节进度看板：表格 + 状态分组卡片
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function buildChapterProgressBase(project: string): string {
    const tag = KIND_NAMESPACE_TAG.body!;
    const columns: ColumnSpec[] = [
        { property: 'file.name', display: '文件' },
        { property: '章', display: '章/节/集' },
        { property: '标题', display: '标题' },
        { property: 'status', display: '状态' },
        { property: 'word_count', display: '字数' },
        { property: '涉及人物', display: '涉及人物' },
        { property: '涉及地点', display: '涉及地点' },
    ];
    return `${GENERATED_MARKER}
filters:
  and:
    - 'file.hasTag("${tag}")'
    - 'file.inFolder(${quotePath(project)})'
summaries:
  words_total: 'values.sum()'
${propertiesBlock(columns)}views:
  - type: table
    name: "章节进度"
    order:
${orderBlock(columns, '      ')}
    summaries:
      word_count: words_total
  - type: cards
    name: "按状态分组"
    groupBy:
      property: status
      direction: ASC
    order:
      - file.name
      - 标题
      - word_count
`;
}

/**
 * 人物状态看板：修为/势力/位置/存活状态
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function buildCharacterBase(project: string): string {
    const tag = KIND_NAMESPACE_TAG.character!;
    const schema = FRONTMATTER_SCHEMAS.character;
    const keys = ['姓名', '身份', '修为等级', '所属势力', '当前位置', 'entity_status', '核心动机', '当前目标'];
    const columns: ColumnSpec[] = [{ property: 'file.name', display: '文件' }]
        .concat(keys.map((key) => ({
            property: key,
            display: schema.find((spec) => spec.key === key)?.label || key,
        })));
    return `${GENERATED_MARKER}
filters:
  and:
    - 'file.hasTag("${tag}")'
    - 'file.inFolder(${quotePath(project)})'
${propertiesBlock(columns)}views:
  - type: table
    name: "人物状态"
    order:
${orderBlock(columns, '      ')}
  - type: cards
    name: "按身份分组"
    groupBy:
      property: 身份
      direction: ASC
    order:
      - 姓名
      - 修为等级
      - 所属势力
      - 当前位置
`;
}

/**
 * 物品归属看板：所有权与当前状态一眼可见
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function buildItemBase(project: string): string {
    const tag = KIND_NAMESPACE_TAG.item!;
    const columns: ColumnSpec[] = [
        { property: 'file.name', display: '文件' },
        { property: '名称', display: '名称' },
        { property: '品阶/等级', display: '品阶/等级' },
        { property: '所属/归属', display: '所属/归属' },
        { property: '当前状态', display: '当前状态' },
        { property: 'effect', display: '效果' },
    ];
    return `${GENERATED_MARKER}
filters:
  and:
    - 'file.hasTag("${tag}")'
    - 'file.inFolder(${quotePath(project)})'
${propertiesBlock(columns)}views:
  - type: table
    name: "物品归属"
    order:
${orderBlock(columns, '      ')}
  - type: cards
    name: "按持有者分组"
    groupBy:
      property: 所属/归属
      direction: ASC
    order:
      - 名称
      - 品阶/等级
      - 当前状态
`;
}

/**
 * 地点与势力看板：两个视图
 *
 * @param project - 项目（路径或对象）
 * @returns 文本结果
 */
export function buildPlaceFactionBase(project: string): string {
    const locationTag = KIND_NAMESPACE_TAG.location!;
    const factionTag = KIND_NAMESPACE_TAG.faction!;
    const locationColumns: ColumnSpec[] = [
        { property: 'file.name', display: '文件' },
        { property: '名称', display: '名称' },
        { property: '类型', display: '类型' },
        { property: '重要程度', display: '重要程度' },
        { property: '所在世界/区域', display: '所在区域' },
        { property: '主要居民/势力', display: '主要居民/势力' },
    ];
    const factionColumns: ColumnSpec[] = [
        { property: 'file.name', display: '文件' },
        { property: '名称', display: '名称' },
        { property: '类型', display: '类型' },
        { property: '领袖', display: '领袖' },
        { property: '地位/排名', display: '地位/排名' },
    ];
    return `${GENERATED_MARKER}
filters:
  and:
    - 'file.inFolder(${quotePath(project)})'
properties:
${[...locationColumns, ...factionColumns]
        .filter((column) => column.display && column.property !== 'file.name')
        .map((column) => `  ${column.property}:\n    displayName: ${q(column.display!)}`)
        .join('\n')}
views:
  - type: table
    name: "地点"
    filters: 'file.hasTag("${locationTag}")'
    order:
${orderBlock(locationColumns, '      ')}
  - type: table
    name: "势力"
    filters: 'file.hasTag("${factionTag}")'
    order:
${orderBlock(factionColumns, '      ')}
`;
}

/** 项目看板全集 */
export const BASE_DIR = '.看板';

/**
 * 构建项目基础列表。
 * @param project - 项目（路径或对象）
 * @returns 结果数组
 */
export function buildProjectBases(project: string): BaseFileSpec[] {
    return [
        { relativePath: `${BASE_DIR}/章节进度.base`, content: buildChapterProgressBase(project) },
        { relativePath: `${BASE_DIR}/人物状态.base`, content: buildCharacterBase(project) },
        { relativePath: `${BASE_DIR}/物品归属.base`, content: buildItemBase(project) },
        { relativePath: `${BASE_DIR}/地点与势力.base`, content: buildPlaceFactionBase(project) },
    ];
}

/**
 * 看板 → 项目内绝对路径
 *
 * @param project - 项目（路径或对象）
 * @param relativePath - 相对路径
 * @returns 文本结果
 */
export function baseFilePath(project: string, relativePath: string): string {
    return `${project}/${relativePath}`;
}