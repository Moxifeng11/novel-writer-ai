/**
 * command-ids.ts — 命令 ID 常量（core 与 ui 共用）
 *
 * 放在 shared 层，避免 ui/command-ui-executor.ts 为了拿 id 常量反向依赖 core，
 * 进而把 core → engine → ui 的环重新连起来。
 */

export const CommandIds = {
    // ─── 项目管理类 ───
    CREATE_PROJECT: 'novel-writer-create-project',
    AGENT_GUIDE: 'novel-writer-agent-guide',
    CREATE_SHORT: 'novel-writer-create-short',
    CREATE_SCRIPT: 'novel-writer-create-script',
    SHORT_RESEARCH: 'novel-writer-short-research',
    SCRIPT_RESEARCH: 'novel-writer-script-research',
    SHORT_STORY_CORE: 'novel-writer-short-story-core',
    SHORT_OUTLINE: 'novel-writer-short-outline',
    SCRIPT_SCENE_BIBLE: 'novel-writer-script-scene-bible',
    SCRIPT_OUTLINE: 'novel-writer-script-outline',
    SCRIPT_STORYBOARD: 'novel-writer-script-storyboard',
    IMPORT_EXAMPLE: 'novel-writer-import-example',
    RENAME_PROJECT: 'novel-writer-rename-project',
    PLAN_BOOK: 'novel-writer-plan-book',
    VOLUME_INTRO: 'novel-writer-volume-intro',
    BATCH_CREATE: 'novel-writer-batch-create',
    REBUILD_CHAPTERS: 'novel-writer-rebuild',
    BACKUP_META: 'novel-writer-backup',
    PROTECT_META: 'novel-writer-protect',
    NARRATIVE_OVERVIEW: 'novel-writer-narrative-overview',

    // ─── 写作辅助类 ───
    WRITE_CHAPTER: 'novel-writer-write-chapter',
    WRITE_CHAPTER_AUTO: 'novel-writer-write-chapter-auto',
    BATCH_CHAPTERS: 'novel-writer-batch-chapters',
    BATCH_NOVELS: 'novel-writer-batch-novels',
    CONTINUE_CHAPTERS: 'novel-writer-continue-chapters',
    AUTO_WRITER: 'novel-writer-auto-writer',
    REVIEW_CHAPTER: 'novel-writer-review-chapter',
    QUALITY_DASHBOARD: 'novel-writer-quality-dashboard',
    CHAPTER_SETTLEMENT: 'novel-writer-chapter-settlement',
    EXPAND_TEXT: 'novel-writer-expand-text',
    OUTLINE_EXPAND: 'novel-writer-outline-expand',
    REWRITE_SUGGESTION: 'novel-writer-rewrite-suggestion',
    CROSS_VOLUME_STATE: 'novel-writer-cross-volume-state',

    // ─── 知识库类 ───
    WORLDVIEW: 'novel-writer-worldview',
    CHARACTER: 'novel-writer-character',
    FACTION: 'novel-writer-faction',
    LOCATION: 'novel-writer-location',
    ITEM: 'novel-writer-item',
    ENTITY_MANAGER: 'novel-writer-entity-manager',
    ENTITY_GENERATE: 'novel-writer-entity-generate',
    AI_BUILDER: 'novel-writer-ai-builder',
    ADD_FANFIC: 'novel-writer-add-fanfic',
    EXTRACT_ELEMENTS: 'novel-writer-extract-elements',
    CHARACTER_RECOGNITION: 'novel-writer-character-recognition',
    POPULATE_SETTING_LIB: 'novel-writer-populate-setting-lib',
    TAGS_ANALYSIS: 'novel-writer-tags',
    FINGERPRINT_LIBRARY: 'novel-writer-fingerprint-library',
    STYLE_DISTILLER: 'novel-writer-style-distiller',
    CONTEXT_INJECTOR: 'novel-writer-context-injector',
    OPEN_KNOWLEDGE_BASE: 'novel-writer-open-knowledge-base',

    // ─── 工具类 ───
    DIAGNOSE: 'novel-writer-diagnose',
    TOMATO_RANK: 'novel-writer-tomato-rank',
    REFRESH_INFO_DEBT: 'novel-writer-refresh-info-debt',
    SWITCH_PROVIDER: 'switch-provider',
    IDEATION: 'novel-writer-ideation',
    GOLDEN_OPENING: 'novel-writer-golden-opening',
    STEP_RESULT_VIEWER: 'novel-writer-step-result-viewer',
    BATCH_DECONSTRUCT: 'novel-writer-batch-deconstruct',
    EXPORT_MANUSCRIPT: 'novel-writer-export-manuscript',
    STORY_LINKAGE_BOARD: 'novel-writer-story-linkage',

    // ─── 视图类 ───
    FULL_WRITER: 'novel-writer-full-writer',
    CREATION_FLOW: 'novel-writer-open-flow',
    MIGRATE_ENTITY_LINKS: 'novel-writer-migrate-entity-links',
    PROJECT_SIDE_PANEL: 'novel-writer-project-side-panel',
    GENERATE_BASES: 'novel-writer-generate-bases',
    MIGRATE_NAMESPACE_TAGS: 'novel-writer-migrate-namespace-tags',
    COMPLETE_PROPERTIES: 'novel-writer-complete-properties',
    CO_WRITING: 'novel-writer-co-writing',

    // ─── 版本管理类 ───
    VERSION_HISTORY: 'novel-writer-version-history',
    SAVE_VERSION: 'novel-writer-save-version',

    // ─── 设置 ───
    OPEN_SETTINGS: 'novel-writer-open-settings',

    // ─── 内部调试命令（不暴露到 Obsidian 命令面板） ───
    CLEAR_WORLDVIEW_CACHE: 'clear-worldview-cache',
    WORLDVIEW_CACHE_STATS: 'worldview-cache-stats',
    POPULATE_SETTING_LIB_INTERNAL: 'populate-setting-lib',
} as const;

export type CommandId = typeof CommandIds[keyof typeof CommandIds];
