'use strict';
// CSV reading for the two export oracles. Not an oracle itself.

// The rows of a CSV text; a quoted field may hold commas, newlines and doubled
// quotes. Each row is a list of fields; blank lines are dropped.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') { quoted = true; wasQuoted = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '' || wasQuoted) rows.push(row);
      row = []; field = ''; wasQuoted = false;
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

module.exports = { parseCsv };
