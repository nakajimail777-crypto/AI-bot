/* Creates a downloadable PDF without sending conversation contents anywhere. */
window.DragonPdf = (() => {
  const encoder = new TextEncoder();
  const ascii = value => encoder.encode(value);

  function utf16be(value) {
    const bytes = [0xfe, 0xff];
    for (const char of value) {
      const code = char.codePointAt(0);
      if (code > 0xffff) { bytes.push(0xff, 0xfd); continue; }
      bytes.push(code >> 8, code & 0xff);
    }
    return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function lines(value, width = 38) {
    const result = [];
    for (const paragraph of String(value || '').replace(/\r/g, '').split('\n')) {
      if (!paragraph) { result.push(''); continue; }
      for (let start = 0; start < paragraph.length; start += width) result.push(paragraph.slice(start, start + width));
    }
    return result;
  }

  function contentPages(conversations) {
    const pages = [[]];
    let y = 806;
    const add = (text, size = 10, gap = 15) => {
      if (y < 58) { pages.push([]); y = 806; }
      pages.at(-1).push(`BT /F1 ${size} Tf 50 ${y} Td <${utf16be(text)}> Tj ET`);
      y -= gap;
    };
    add('スピリットドラゴンAI 会話', 18, 28);
    add(`出力日時：${new Date().toLocaleString('ja-JP')}`, 9, 22);
    for (const conversation of conversations) {
      add(conversation.title || '無題の会話', 14, 24);
      for (const entry of conversation.entries || []) {
        add(entry.role === 'user' ? 'あなた' : 'スピリットドラゴンAI', 10, 16);
        for (const line of lines(entry.content)) add(line || ' ', 10, 15);
        y -= 5;
      }
      y -= 10;
    }
    return pages;
  }

  function create(conversations) {
    const pages = contentPages(conversations);
    const objects = [];
    const add = body => { objects.push(body); return objects.length; };
    const catalog = add('');
    const pageTree = add('');
    const font = add('<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UTF16-H /DescendantFonts [4 0 R] >>');
    const descendant = add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /DW 1000 >>');
    const pageNumbers = [];
    for (const page of pages) {
      const stream = page.join('\n');
      const streamNumber = add(`<< /Length ${ascii(stream).length} >>\nstream\n${stream}\nendstream`);
      pageNumbers.push(add(`<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${streamNumber} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
    objects[pageTree - 1] = `<< /Type /Pages /Kids [${pageNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pageNumbers.length} >>`;
    const parts = [ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    const offsets = [0];
    let length = parts[0].length;
    objects.forEach((body, index) => {
      offsets[index + 1] = length;
      const bytes = ascii(`${index + 1} 0 obj\n${body}\nendobj\n`);
      parts.push(bytes); length += bytes.length;
    });
    const xref = length;
    const table = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
    for (let index = 1; index <= objects.length; index++) table.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
    parts.push(ascii(`${table.join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`));
    return new Blob(parts, { type: 'application/pdf' }).arrayBuffer();
  }

  return { create };
})();
