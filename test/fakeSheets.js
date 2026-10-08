// In-memory stand-in for the slice of googleapis' Sheets v4 client that the API uses.
// Mimics real behaviour that matters: values come back as strings, trailing empty cells
// are dropped, empty rows in the middle come back as [].

function colToIdx(letters) {
  return letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

function parseRange(range) {
  const m = /^(.+?)!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(range);
  if (!m) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
  const [, tab, c1, r1, c2, r2] = m;
  return {
    tab,
    c1: colToIdx(c1), r1: r1 ? Number(r1) : 1,
    c2: c2 ? colToIdx(c2) : colToIdx(c1), r2: r2 ? Number(r2) : null,
  };
}

function createFakeSheets({ tabs = [], failWrites = false } = {}) {
  const grids = new Map(tabs.map((t) => [t, []])); // tab -> array of rows (index 0 = row 1)
  const calls = [];

  const grid = (tab) => {
    if (!grids.has(tab)) throw Object.assign(new Error(`Unable to parse range: ${tab}`), { code: 400 });
    return grids.get(tab);
  };

  function read(range) {
    const r = parseRange(range);
    const g = grid(r.tab);
    const last = r.r2 || g.length;
    const rows = [];
    for (let row = r.r1; row <= last; row++) {
      const src = g[row - 1] || [];
      const cells = [];
      for (let c = r.c1; c <= r.c2; c++) cells.push(src[c] === undefined || src[c] === '' ? '' : String(src[c]));
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      rows.push(cells);
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    return rows;
  }

  function write(range, values) {
    if (failWrites) throw Object.assign(new Error('The caller does not have permission'), { code: 403 });
    const r = parseRange(range);
    const g = grid(r.tab);
    values.forEach((vals, i) => {
      const row = r.r1 - 1 + i;
      while (g.length <= row) g.push([]);
      vals.forEach((v, j) => { g[row][r.c1 + j] = v; });
    });
    return r;
  }

  const client = {
    __grids: grids,
    __calls: calls,
    spreadsheets: {
      get: async () => ({ data: { sheets: [...grids.keys()].map((title) => ({ properties: { title } })) } }),
      batchUpdate: async ({ requestBody }) => {
        calls.push('spreadsheets.batchUpdate');
        requestBody.requests.forEach((q) => { if (q.addSheet) grids.set(q.addSheet.properties.title, []); });
        return { data: {} };
      },
      values: {
        get: async ({ range }) => { calls.push(`get ${range}`); const values = read(range); return { data: { range, values: values.length ? values : undefined } }; },
        batchGet: async ({ ranges }) => ({
          data: { valueRanges: ranges.map((range) => { const values = read(range); return { range, values: values.length ? values : undefined }; }) },
        }),
        update: async ({ range, requestBody }) => { calls.push(`update ${range}`); write(range, requestBody.values); return { data: {} }; },
        batchUpdate: async ({ requestBody }) => {
          calls.push('values.batchUpdate');
          requestBody.data.forEach((d) => write(d.range, d.values));
          return { data: {} };
        },
        append: async ({ range, requestBody }) => {
          calls.push(`append ${range}`);
          if (failWrites) throw Object.assign(new Error('The caller does not have permission'), { code: 403 });
          const r = parseRange(range);
          const g = grid(r.tab);
          let last = g.length;
          while (last > 0 && (!g[last - 1] || g[last - 1].every((c) => c === undefined || c === ''))) last--;
          const startRow = last + 1;
          requestBody.values.forEach((vals, i) => {
            g[startRow - 1 + i] = [...vals];
          });
          const endRow = startRow + requestBody.values.length - 1;
          return { data: { updates: { updatedRange: `${r.tab}!A${startRow}:${String.fromCharCode(65 + requestBody.values[0].length - 1)}${endRow}` } } };
        },
      },
    },
  };
  return client;
}

module.exports = { createFakeSheets };
