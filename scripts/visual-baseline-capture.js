/**
 * visual-baseline-capture.js — 视觉基线采集（2026-11-16）
 *
 * 用法（在 Obsidian 里执行）：
 *   $js = Get-Content -Raw scripts/visual-baseline-capture.js
 *   obsidian eval code="$js"
 *
 * 作用：把当前打开的视图拍成「结构 + 几何 + 计算样式」快照，写到 vault 根
 * .visual-baseline/<module>.json，只回显路径，便于再用 check-visual-diff.mjs 比对。
 *
 * 为什么不存类名：类名正是视觉重构要改的东西；用「标签+序号路径」定位元素，
 * 才能判断改类名之后元素的外观/位置有没有变。
 *
 * 采集前请把目标视图调到固定宽度（快照会记录 viewport 宽度用于提示）。
 */
(async function () {
  'use strict';

  /** 目标：模块名 → 视图类型 + 可选根选择器 */
  var TARGETS = {
    'kb-books': { viewType: 'novel-writer-knowledge-base', rootSelector: null, label: '知识库 · 书架' },
    'cw-editor': { viewType: 'novel-writer-co-writing', rootSelector: '.nw-cowrite-root', label: '协同写作' },
    'plan-canvas': { viewType: 'novel-writer-planning-canvas', rootSelector: '.nw-planning-canvas', label: '规划画布' }
  };
  var moduleName = (typeof window !== 'undefined' && window.__NW_VISUAL_TARGET__) || 'kb-books';
  var target = TARGETS[moduleName] || TARGETS['kb-books'];

  var leaf = app.workspace.getLeavesOfType(target.viewType)[0];
  if (!leaf) {
    return JSON.stringify({ error: '视图未打开: ' + target.viewType + '（先打开目标视图再采集）' });
  }
  var root = target.rootSelector
    ? leaf.view.containerEl.querySelector(target.rootSelector)
    : leaf.view.containerEl;
  if (!root) {
    return JSON.stringify({ error: '根选择器未命中: ' + target.rootSelector });
  }

  /** 计算路径：标签名 + 同级同标签序号 */
  function pathOf(el) {
    var parts = [];
    var cur = el;
    while (cur && cur !== root) {
      var parent = cur.parentElement;
      if (!parent) break;
      var sameTag = [];
      for (var i = 0; i < parent.children.length; i++) {
        if (parent.children[i].tagName === cur.tagName) sameTag.push(parent.children[i]);
      }
      parts.unshift(cur.tagName.toLowerCase() + '[' + sameTag.indexOf(cur) + ']');
      cur = parent;
    }
    return parts.join('>');
  }

  /** 计算样式子集（只取会影响观感/布局的项） */
  function styleOf(el) {
    var s = getComputedStyle(el);
    return {
      d: s.display,
      pos: s.position,
      fd: s.flexDirection,
      fw: s.flexWrap,
      jc: s.justifyContent,
      ai: s.alignItems,
      gtc: s.gridTemplateColumns,
      gap: s.gap,
      pt: s.paddingTop, pr: s.paddingRight, pb: s.paddingBottom, pl: s.paddingLeft,
      mt: s.marginTop, mr: s.marginRight, mb: s.marginBottom, ml: s.marginLeft,
      fs: s.fontSize, fwt: s.fontWeight, lh: s.lineHeight, ff: String(s.fontFamily).slice(0, 40),
      c: s.color,
      bg: s.backgroundColor,
      bt: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
      bl: s.borderLeftWidth,
      br: s.borderRadius,
      op: s.opacity,
      ov: s.overflow,
      ws: s.whiteSpace,
      ta: s.textAlign,
      tt: s.textTransform,
      td: s.textDecorationLine,
      vis: s.visibility
    };
  }

  /** 四舍五入到 1px，避免亚像素抖动造成假阳性 */
  function round(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  // 样式字典：大量节点样式完全相同（继承/同组件），存索引可把快照体积压到 1/5
  var styleDict = [];
  var styleIndex = new Map();
  function internStyles(el) {
    var style = styleOf(el);
    var key = JSON.stringify(style);
    if (styleIndex.has(key)) return styleIndex.get(key);
    styleDict.push(style);
    styleIndex.set(key, styleDict.length - 1);
    return styleDict.length - 1;
  }

  var nodes = [];
  var all = root.querySelectorAll('*');
  // 上限保护：超大视图也要能在一次 eval 内完成
  var limit = Math.min(all.length, 1500);
  for (var i = 0; i < limit; i++) {
    var el = all[i];
    var rect = el.getBoundingClientRect();
    // 零尺寸节点不影响观感，跳过以控制快照体积（规范 §3.3 已注明）
    if (round(rect.width) === 0 && round(rect.height) === 0) continue;
    nodes.push({
      path: pathOf(el),
      tag: el.tagName.toLowerCase(),
      rect: { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) },
      textLen: (el.textContent || '').trim().length,
      s: internStyles(el)
    });
  }

  var snapshot = {
    module: moduleName,
    label: target.label,
    viewType: target.viewType,
    capturedAt: new Date().toISOString(),
    viewport: { width: round(window.innerWidth), height: round(window.innerHeight) },
    leafWidth: round(leaf.view.containerEl.getBoundingClientRect().width),
    nodeCount: nodes.length,
    styles: styleDict,
    nodes: nodes
  };

  var outPath = '.visual-baseline/' + moduleName + '.json';
  try {
    if (!(await app.vault.adapter.exists('.visual-baseline'))) {
      await app.vault.adapter.mkdir('.visual-baseline');
    }
    await app.vault.adapter.write(outPath, JSON.stringify(snapshot));
    return JSON.stringify({
      ok: true,
      path: outPath,
      nodes: snapshot.nodeCount,
      leafWidth: snapshot.leafWidth,
      hint: '把该文件用 check-visual-diff.mjs 比对，或移入 docs/quality/visual-baseline/'
    });
  } catch (e) {
    return JSON.stringify({ error: '写入失败: ' + String(e && e.message ? e.message : e) });
  }
})();
