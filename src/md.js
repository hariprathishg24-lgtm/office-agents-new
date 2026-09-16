// Minimal, safe Markdown → HTML for agent messages and deliverables.
//
// Agents write Markdown: headings, bullets, numbered steps, tables, bold, code. Rendering that as
// escaped plain text is why the chat read like a log file. This does the subset that actually
// turns up in the work, and nothing else.
//
// Safety: the input is model output, so everything is escaped FIRST and only our own tags are
// re-introduced afterwards. No raw HTML from the model ever reaches the DOM, and link hrefs are
// restricted to http(s) and mailto.
export const escapeHtml = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeHref = (u) => /^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : '';

function inline(t) {
  return t
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, href) => {
      const h = safeHref(href);
      return h ? `<a href="${h}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt;
    });
}

export function renderMarkdown(src) {
  const lines = escapeHtml(String(src || '')).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="md-code" data-lang="${lang}"><code>${buf.join('\n')}</code></pre>`);
      continue;
    }

    // table: a header row followed by a |---| separator
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]*-[-\s|:]*$/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table class="md-table"><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }

    // headings
    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(4, h[1].length) + 2; out.push(`<h${n} class="md-h">${inline(h[2])}</h${n}>`); i++; continue; }

    // blockquote
    if (/^\s*&gt;\s?/.test(line)) {                 // '>' is already escaped by this point
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      out.push(`<blockquote class="md-quote">${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // lists
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')));
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'} class="md-list">${items.map(x => `<li>${x}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr class="md-hr">'); i++; continue; }

    // paragraph: gather until a blank line
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,4}\s|[-*•]\s|\d+[.)]\s|&gt;|\||```)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p class="md-p">${inline(para.join(' '))}</p>`);
  }
  return out.join('');
}
