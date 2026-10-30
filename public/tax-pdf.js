// Reads Chase card statement PDFs (text-based) into purchase rows for the tax tracker.
// Shared by the browser (tax.html) and by tests. Payments and credits are left out;
// only the PURCHASE section counts, same as the CSV path.
(function (root) {
  const pad = n => String(n).padStart(2, "0");

  // pdf.js text items -> lines of text, top to bottom, left to right.
  function itemsToLines(items) {
    const pieces = items
      .filter(it => it.str && it.str.trim() !== "")
      .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], end: it.transform[4] + (it.width || 0) }));
    pieces.sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
    const lines = [];
    let line = null;
    for (const p of pieces) {
      if (!line || Math.abs(line.y - p.y) > 2) {
        line = { y: p.y, parts: [p], text: "" };
        lines.push(line);
      } else {
        line.parts.push(p);
      }
    }
    return lines.map(l => {
      let text = "", prevEnd = null;
      for (const p of l.parts) {
        if (prevEnd !== null && p.x - prevEnd > 1.5) text += " ";
        text += p.s;
        prevEnd = p.end;
      }
      return text.replace(/\s+$/, "");
    });
  }

  // Statement lines -> purchase rows. Years come from the statement close date.
  function parseLines(lines) {
    const close = (() => {
      for (const l of lines) {
        const m = /Statement Date:\s+(\d{2})\/(\d{2})\/(\d{2})/.exec(l);
        if (m) return { y: 2000 + Number(m[3]), m: Number(m[1]), d: Number(m[2]) };
      }
      return null;
    })();
    if (!close) throw new Error("Couldn't find the statement date in this PDF.");

    let last4 = "";
    for (const l of lines) {
      const m = /XXXX\s+XXXX\s+XXXX\s+(\d{4})/.exec(l);
      if (m) { last4 = m[1]; break; }
    }

    const TXN = /^\s*(\d{2})\/(\d{2})\s+(.+?)\s+(-?\$?[\d,]*\.\d{2})\s*$/;
    const rows = [];
    let section = null;
    for (const line of lines) {
      if (line.includes("PAYMENTS AND OTHER CREDITS")) section = "credit";
      if (/^\s*PURCHASE\s*$/.test(line)) section = "purchase";
      if (section !== "purchase") continue;
      const t = TXN.exec(line);
      if (!t) continue;
      const amount = Math.round(parseFloat(t[4].replace(/[$,]/g, "")) * 100) / 100;
      if (!(amount > 0)) continue;
      const mo = Number(t[1]), dd = Number(t[2]);
      const year = mo <= close.m ? close.y : close.y - 1;
      rows.push({
        date: `${year}-${pad(mo)}-${pad(dd)}`,
        description: t[3].replace(/\s+/g, " ").trim(),
        amount,
        card: last4 ? `Chase ••${last4}` : "Chase",
      });
    }
    return { rows, statementClose: `${close.y}-${pad(close.m)}-${pad(close.d)}`, last4 };
  }

  // pages: array of pdf.js text-item arrays, one per page.
  function parseStatement(pages) {
    const lines = [];
    for (const items of pages) lines.push(...itemsToLines(items));
    return parseLines(lines);
  }

  const api = { itemsToLines, parseLines, parseStatement };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TaxPdf = api;
})(typeof window !== "undefined" ? window : globalThis);
