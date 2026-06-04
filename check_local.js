const fs = require('fs');
const d = JSON.parse(fs.readFileSync('mstock.json'));
let count = 0;
for(let x of d) {
  const n = (x.name || '').toUpperCase();
  const s = (x.symbol || '').toUpperCase();
  if (n.includes('NIFTY') && !n.includes('BANK') && !n.includes('FIN') && x.exch_seg === 'NFO' && x.instrumenttype === 'OPTIDX') {
    console.log(x);
    if (++count > 5) break;
  }
}
