import re, html, sys
src = open(sys.argv[1]).read().splitlines()
out = []
def inline(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
    return t
i = 0; nav = []
while i < len(src):
    line = src[i]
    if line.startswith('# '):
        i += 1; continue
    m = re.match(r'## (.*)', line)
    if m:
        title = m.group(1); aid = 'a%d' % len(nav); nav.append((aid, title))
        out.append(f'<h2 id="{aid}">{inline(title)}</h2>'); i += 1; continue
    if line.startswith('|'):
        rows = []
        while i < len(src) and src[i].startswith('|'):
            cells = [c.strip() for c in src[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r'-+', c) for c in cells if c): rows.append(cells)
            i += 1
        h = rows[0]; body = rows[1:]
        t = ['<div class="tw"><table><thead><tr>'] + [f'<th class="{"ours" if j==1 else ""}">{inline(c)}</th>' for j, c in enumerate(h)] + ['</tr></thead><tbody>']
        for r in body:
            t.append('<tr>' + ''.join(f'<td class="{"facet" if j==0 else ("ours" if j==1 else "")}">{inline(c)}</td>' for j, c in enumerate(r)) + '</tr>')
        t.append('</tbody></table></div>'); out.append(''.join(t)); continue
    if line.strip() == 'THEIR WHY':
        out.append('<h3>Their why</h3>'); i += 1; continue
    if re.match(r'\s*(- |\d+\. )', line):
        tag = 'ol' if re.match(r'\s*\d+\.', line) else 'ul'
        items = []
        while i < len(src) and re.match(r'\s*(- |\d+\. )', src[i]):
            items.append(re.sub(r'^\s*(- |\d+\. )', '', src[i])); i += 1
        out.append(f'<{tag}>' + ''.join(f'<li>{inline(x)}</li>' for x in items) + f'</{tag}>'); continue
    if line.strip():
        out.append(f'<p class="note">{inline(line)}</p>')
    i += 1
navh = '<nav>' + ''.join(f'<a href="#{a}">{html.escape(t.split("·")[-1].strip()[:38])}</a>' for a, t in nav) + '</nav>'
page = open(sys.argv[2]).read().replace('{{NAV}}', navh).replace('{{BODY}}', '\n'.join(out))
open(sys.argv[3], 'w').write(page)
