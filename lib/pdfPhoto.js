// Finds the guest's profile photo inside a LinkedIn profile saved from the browser
// (Print → Save as PDF). Those PDFs embed the page's images as JPEGs; the profile photo is the
// largest square picture on page 1. Small images are skipped on purpose: the top bar shows the
// logged-in viewer's own avatar (a different person), and company logos are small too.
// LinkedIn's own "More → Save to PDF" résumé has no photo, so this returns null for it.

const MIN_SIDE = 200;

function objects(src) {
  const map = new Map();
  const re = /(\d+) 0 obj\b/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf("endobj", start);
    if (end < 0) break;
    map.set(Number(m[1]), { start, end });
    re.lastIndex = end;
  }
  return map;
}

const num = (s, key) => Number(s.match(new RegExp(`/${key}\\s+(\\d+)`))?.[1]);

export function extractProfilePhoto(buf) {
  try {
    const src = buf.toString("latin1");
    const objs = objects(src);
    const body = (n) => {
      const o = objs.get(n);
      return o ? src.slice(o.start, o.end) : "";
    };
    const dictOf = (n) => {
      const b = body(n);
      const i = b.indexOf("stream");
      return i >= 0 ? b.slice(0, i) : b;
    };

    // Root page tree → first page.
    let pagesId = null;
    for (const [n] of objs) {
      const d = dictOf(n);
      if (/\/Type\s*\/Pages\b/.test(d) && !/\/Parent\s/.test(d)) { pagesId = n; break; }
    }
    let node = pagesId;
    for (let depth = 0; node != null && depth < 10; depth++) {
      const d = dictOf(node);
      if (/\/Type\s*\/Page\b/.test(d)) break;
      const kid = d.match(/\/Kids\s*\[\s*(\d+)\s+0\s+R/);
      node = kid ? Number(kid[1]) : null;
    }
    if (node == null) return null;

    // Page 1's XObjects (resources may be inline or a reference).
    let res = dictOf(node);
    const resRef = res.match(/\/Resources\s+(\d+)\s+0\s+R/);
    if (resRef) res = dictOf(Number(resRef[1]));
    let xo = res.match(/\/XObject\s*<<([^>]*)>>/)?.[1];
    const xoRef = res.match(/\/XObject\s+(\d+)\s+0\s+R/);
    if (!xo && xoRef) xo = dictOf(Number(xoRef[1]));
    if (!xo) return null;
    const ids = [...xo.matchAll(/(\d+)\s+0\s+R/g)].map((x) => Number(x[1]));

    let best = null;
    for (const id of ids) {
      const d = dictOf(id);
      if (!/\/Subtype\s*\/Image/.test(d) || !/\/DCTDecode/.test(d)) continue;
      const w = num(d, "Width"), h = num(d, "Height");
      if (!(w >= MIN_SIDE && h >= MIN_SIDE) || w / h < 0.8 || w / h > 1.25) continue;
      if (best && w * h <= best.w * best.h) continue;
      const b = body(id);
      const s = b.indexOf("stream");
      let start = s + 6;
      if (src[objs.get(id).start + start] === "\r") start++;
      if (src[objs.get(id).start + start] === "\n") start++;
      const stop = b.lastIndexOf("endstream");
      const abs = objs.get(id).start;
      let jpeg = buf.subarray(abs + start, abs + stop);
      const soi = jpeg.indexOf(Buffer.from([0xff, 0xd8]));
      const eoi = jpeg.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (soi < 0 || eoi < 0) continue;
      jpeg = jpeg.subarray(soi, eoi + 2);
      best = { w, h, jpeg };
    }
    if (!best) return null;
    return { dataUrl: `data:image/jpeg;base64,${Buffer.from(best.jpeg).toString("base64")}`, width: best.w, height: best.h };
  } catch {
    return null;
  }
}
