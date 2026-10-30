const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const TaxPdf = require('../public/tax-pdf.js');
const dir = '/mnt/user-data/attachments/a6253ffa-3b45-57d6-8be8-f0b88892b81f';
const files = fs.readdirSync(dir).filter(f => f.endsWith('-list.pdf')).sort();
(async () => {
  let all = [];
  for (const f of files) {
    const data = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const doc = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      pages.push(tc.items);
    }
    const r = TaxPdf.parseStatement(pages);
    const sum = r.rows.reduce((a, t) => a + t.amount, 0).toFixed(2);
    console.log(f.slice(0, 8), 'close', r.statementClose, 'last4', r.last4, 'rows', r.rows.length, 'sum', sum);
    all = all.concat(r.rows);
  }
  fs.writeFileSync('/tmp/parsed.json', JSON.stringify(all, null, 1));
  console.log('total rows', all.length);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
