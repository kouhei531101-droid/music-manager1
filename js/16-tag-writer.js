/* =========================================================
   16-tag-writer.js ― 曲情報（タグ）の書き込み用の中身を作る・確かめる
   ここではファイルに触らない。元のバイト列から「タグだけを変えた新しいバイト列」を作り、
   新旧を比べて「変えたタグ以外（ジャケット画像・歌詞・トラック番号など）と音声データが同じか」を確かめる。
   実際の書き込み（控え・一時ファイル・置き換え）は 17-tag-edit.js。

   対応形式：
   ・mp3 … ID3v2。今の版（2.2 / 2.3 / 2.4）のまま該当フレームだけ差し替える。タグが無ければ v2.3 を作る。
           ID3v1（ファイル末尾）はそのまま残す。
   ・m4a（m4b・mp4）… moov > udta > meta > ilst の ©nam / ©ART / ©alb / aART。
           moov の大きさが変わり、moov が mdat より前にあるときは、直後の free 箱で吸収するか、
           stco / co64（音声データの位置の表）を同じだけずらす。分割形式（moof / mvex）は書かない。
   ・flac … VORBIS_COMMENT。大きさの差は PADDING で吸収する（足りなければ PADDING を作り直す）。
   ジャンル・発売年（v3.2、changes.genre・changes.year。year は4桁の文字）：
   ・mp3 … ジャンル TCON（v2.2 は TCO）、発売年 v2.3 は TYER・v2.4 は TDRC・v2.2 は TYE。同じ意味の枠（v2.3 の TDRC など）があれば、1つにまとめて差し替える
   ・m4a … ジャンル ©gen（番号の gnre があれば ©gen に置き換える。番号では好きな名前を書けないため）、発売年 ©day
   ・flac … GENRE、DATE（YEAR があれば DATE にまとめる）
   ジャケット画像（v2.0、changes.picture）：{ mime, bytes, width, height } で「表紙」を差し替え・追加、null で外す。
   ・mp3 … APIC（v2.2 は PIC）の表紙（type 3）を差し替え・追加（ほかの種類の画像は残す）。外すときは画像をすべて外す。
   ・m4a … covr の最初の画像を差し替え・追加（2枚目以降は残す）。外すときは covr ごと外す。
   ・flac … PICTURE ブロックの表紙（type 3）を差し替え・追加（ほかは残す）。外すときは PICTURE をすべて外す。
   読めない所・想定外の形があれば TagWriteError を投げ、何も書かない。
   ========================================================= */

var TAG_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'genre', 'year'];   // genre・year は v3.2
var TAG_FIELD_LABELS = { title: '曲名', artist: 'アーティスト', album: 'アルバム', albumArtist: 'アルバムアーティスト', genre: 'ジャンル', year: '発売年' };
// 同じ項目の枠が複数あるとき：先頭が書き込む枠、あとは同じ意味の枠（書くときに1つにまとめる）
function _itemIds(map, alias, f) {
  var w = map[f], list = [w];
  (alias[f] || []).forEach(function (x) { if (list.indexOf(x) < 0) list.push(x); });
  return list;
}
// 並びの中の、ids のどれかの枠を差し替える（最初にあった所に1つだけ置く。value が '' なら取り除く）
function _replaceItemsIds(list, ids, value, makeNew) {
  var first = -1;
  for (var i = 0; i < list.length; i++) if (ids.indexOf(list[i].id) >= 0) { first = i; break; }
  var out = list.filter(function (x) { return ids.indexOf(x.id) < 0; });
  if (value !== '') {
    var item = { id: ids[0], raw: makeNew() };
    if (first >= 0) out.splice(first, 0, item); else out.push(item);
  }
  return out;
}
var TAG_WRITE_KINDS = { mp3: 'mp3', m4a: 'mp4', m4b: 'mp4', mp4: 'mp4', flac: 'flac' };
function tagWriteKind(ext) { return TAG_WRITE_KINDS[ext] || ''; }
function _textFields(changes) { return TAG_FIELDS.filter(function (f) { return f in changes; }); }

function _tagErr(msg) { var e = new Error(msg); e.name = 'TagWriteError'; return e; }

/* ---------- バイト列の小道具 ---------- */
var _utf8enc = new TextEncoder();
function _cat(parts) {
  var total = 0, i;
  for (i = 0; i < parts.length; i++) total += parts[i].length;
  var out = new Uint8Array(total), p = 0;
  for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
  return out;
}
function _be32(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function _le32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
function _ss32(n) { return new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]); }
function _asciiBytes(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
function _bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
async function sha256Hex(bytes) {
  var d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  var s = '';
  for (var i = 0; i < d.length; i++) s += (d[i] < 16 ? '0' : '') + d[i].toString(16);
  return s;
}

/* =========================================================
   mp3（ID3v2）
   ========================================================= */
var _ID3_WRITE_IDS = {
  2: { title: 'TT2', artist: 'TP1', album: 'TAL', albumArtist: 'TP2', genre: 'TCO', year: 'TYE' },
  3: { title: 'TIT2', artist: 'TPE1', album: 'TALB', albumArtist: 'TPE2', genre: 'TCON', year: 'TYER' },
  4: { title: 'TIT2', artist: 'TPE1', album: 'TALB', albumArtist: 'TPE2', genre: 'TCON', year: 'TDRC' }
};
var _ID3_ALIAS_IDS = { 2: {}, 3: { year: ['TDRC'] }, 4: { year: ['TYER'] } };   // 同じ意味の枠（v3.2）
function _id3Ids(ver, f) { return _itemIds(_ID3_WRITE_IDS[ver], _ID3_ALIAS_IDS[ver], f); }
// ID3v2 タグを厳密に読む。タグが無ければ null。読めない所があれば例外
function id3ParseStrict(b) {
  if (b.length < 10 || _ascii(b, 0, 3) !== 'ID3') return null;
  var ver = b[3], flags = b[5];
  if (ver < 2 || ver > 4) throw _tagErr('この ID3 タグの版（2.' + ver + '）には対応していません');
  if ((b[6] | b[7] | b[8] | b[9]) & 0x80) throw _tagErr('ID3 タグの大きさの書き方が正しくありません');
  var size = _syncsafe(b, 6);
  var total = 10 + size + ((ver === 4 && (flags & 0x10)) ? 10 : 0);
  if (total > b.length) throw _tagErr('ID3 タグがファイルの大きさを超えています');
  if (ver === 2 && (flags & 0x40)) throw _tagErr('圧縮された ID3v2.2 タグには対応していません');
  var data = b.subarray(10, 10 + size);
  if ((flags & 0x80) && ver < 4) data = _deUnsync(data);   // タグ全体の非同期化を戻す（書き直すときは付けない）
  var pos = 0;
  if ((flags & 0x40) && ver >= 3) {                         // 拡張ヘッダー（書き直すときは付けない）
    if (data.length < 4) throw _tagErr('ID3 タグの拡張ヘッダーが正しくありません');
    pos = ver === 3 ? 4 + _u32be(data, 0) : _syncsafe(data, 0);
    if (pos > data.length) throw _tagErr('ID3 タグの拡張ヘッダーが正しくありません');
  }
  var idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10, frames = [];
  while (pos < data.length) {
    if (data[pos] === 0) {                                  // 余白：最後まで 0 のはず
      for (var i = pos; i < data.length; i++) if (data[i] !== 0) throw _tagErr('ID3 タグの余白に読めないデータがあります');
      break;
    }
    if (pos + hdrLen > data.length) throw _tagErr('ID3 タグの終わりが正しくありません');
    var id = _ascii(data, pos, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) throw _tagErr('ID3 タグの中に読めない部分があります');
    var fsize = ver === 2 ? _u24be(data, pos + 3) : (ver === 4 ? _syncsafe(data, pos + 4) : _u32be(data, pos + 4));
    var end = pos + hdrLen + fsize;
    if (end > data.length) throw _tagErr('ID3 タグのフレームの大きさが正しくありません');
    frames.push({ id: id, raw: data.slice(pos, end) });
    pos = end;
  }
  return { ver: ver, rev: b[4], flags: flags, size: size, total: total, frames: frames };
}
function _utf16leBom(s) {
  var out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xFF; out[1] = 0xFE;
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; }
  return out;
}
// 文字のフレーム。v2.4 は UTF-8、v2.2 / v2.3 は英数字だけなら Latin-1、それ以外は UTF-16（BOM 付き）
function _id3TextFrame(ver, id, text) {
  var body;
  if (ver === 4) body = _cat([new Uint8Array([3]), _utf8enc.encode(text)]);
  else if (/^[\x20-\x7e]*$/.test(text)) body = _cat([new Uint8Array([0]), _asciiBytes(text)]);
  else body = _cat([new Uint8Array([1]), _utf16leBom(text)]);
  var n = body.length, hdr;
  if (ver === 2) hdr = _cat([_asciiBytes(id), new Uint8Array([(n >> 16) & 255, (n >> 8) & 255, n & 255])]);
  else hdr = _cat([_asciiBytes(id), ver === 3 ? _be32(n) : _ss32(n), new Uint8Array([0, 0])]);
  return _cat([hdr, body]);
}
// フレームの頭（v2.2：名前3文字＋大きさ3バイト、v2.3：名前＋大きさ＋フラグ、v2.4：大きさは syncsafe）
function _id3FrameHeader(ver, id, n) {
  if (ver === 2) return _cat([_asciiBytes(id), new Uint8Array([(n >> 16) & 255, (n >> 8) & 255, n & 255])]);
  return _cat([_asciiBytes(id), ver === 3 ? _be32(n) : _ss32(n), new Uint8Array([0, 0])]);
}
// フレームの中身（フラグの付いたもの：圧縮・暗号化は読まずに null）
function _id3FrameBody(ver, raw) {
  var hdr = ver === 2 ? 6 : 10, body = raw.subarray(hdr);
  if (ver === 3) { var f3 = raw[9]; if (f3 & 0xC0) return null; if (f3 & 0x20) body = body.subarray(1); }
  if (ver === 4) {
    var f4 = raw[9];
    if (f4 & 0x0C) return null;
    if (f4 & 0x40) body = body.subarray(1);
    if (f4 & 0x01) body = body.subarray(4);
    if (f4 & 0x02) body = _deUnsync(body);
  }
  return body;
}
// 画像フレームの種類（ptype）と画像の中身。読めなければ null
function _id3PicInfo(ver, fr) {
  var b = _id3FrameBody(ver, fr.raw);
  if (!b || b.length < 6) return null;
  var enc = b[0], p;
  if (ver === 2) p = 4;
  else { var z = b.indexOf(0, 1); if (z < 0) return null; p = z + 1; }
  var ptype = b[p]; p++;
  if (enc === 1 || enc === 2) { while (p + 1 < b.length && !(b[p] === 0 && b[p + 1] === 0)) p += 2; p += 2; }
  else { while (p < b.length && b[p] !== 0) p++; p++; }
  return { ptype: ptype, bytes: b.subarray(Math.min(p, b.length)) };
}
// 表紙（type 3）の画像フレームを作る
function _id3PictureFrame(ver, pic) {
  var body;
  if (ver === 2) body = _cat([new Uint8Array([0]), _asciiBytes(pic.mime === 'image/png' ? 'PNG' : 'JPG'), new Uint8Array([3, 0]), pic.bytes]);
  else body = _cat([new Uint8Array([0]), _asciiBytes(pic.mime), new Uint8Array([0, 3, 0]), pic.bytes]);
  return _cat([_id3FrameHeader(ver, ver === 2 ? 'PIC' : 'APIC', body.length), body]);
}
// 画像の変更で「差し替え・取り除く対象」のフレームか（設定：表紙だけ、外す：画像すべて）
function _id3PicAffected(ver, fr, changes) {
  if (!('picture' in changes) || fr.id !== (ver === 2 ? 'PIC' : 'APIC')) return false;
  if (changes.picture === null) return true;
  var info = _id3PicInfo(ver, fr);
  return !!info && info.ptype === 3;
}

// 並びの中の、そのフレーム（型）を差し替える。value が '' なら取り除く
function _replaceItems(list, type, value, makeNew) {
  var first = -1;
  for (var i = 0; i < list.length; i++) if (list[i].id === type) { first = i; break; }
  var out = list.filter(function (x) { return x.id !== type; });
  if (value !== '') {
    var item = { id: type, raw: makeNew() };
    if (first >= 0) out.splice(first, 0, item); else out.push(item);
  }
  return out;
}
function buildMp3Tagged(orig, changes) {
  var tag = id3ParseStrict(orig);
  var ver = tag ? tag.ver : 3;
  var ids = _ID3_WRITE_IDS[ver];
  var frames = tag ? tag.frames.slice() : [];
  TAG_FIELDS.forEach(function (f) {
    if (!(f in changes)) return;
    frames = _replaceItemsIds(frames, _id3Ids(ver, f), changes[f], function () { return _id3TextFrame(ver, ids[f], changes[f]); });
  });
  if ('picture' in changes) {   // ジャケット画像
    var first = -1;
    frames.forEach(function (fr, i) { if (first < 0 && _id3PicAffected(ver, fr, changes)) first = i; });
    frames = frames.filter(function (fr) { return !_id3PicAffected(ver, fr, changes); });
    if (changes.picture) {
      var nf = { id: ver === 2 ? 'PIC' : 'APIC', raw: _id3PictureFrame(ver, changes.picture) };
      if (first >= 0) frames.splice(first, 0, nf); else frames.push(nf);
    }
  }
  var body = _cat(frames.map(function (fr) { return fr.raw; }));
  var oldSize = tag ? tag.size : 0;
  var newSize = body.length <= oldSize ? oldSize : body.length + 2048;   // 入るなら今の大きさのまま（余白で調整）
  if (newSize > 0x0FFFFFFF) throw _tagErr('タグが大きすぎます');
  // 非同期化・拡張ヘッダー・フッターの印は外す（中身は付けずに書くため）。v2.2 は印なし
  var flags = tag ? (ver === 2 ? 0 : (tag.flags & 0x20)) : 0;
  var header = _cat([_asciiBytes('ID3'), new Uint8Array([ver, tag ? tag.rev : 0, flags]), _ss32(newSize)]);
  return _cat([header, body, new Uint8Array(newSize - body.length), orig.subarray(tag ? tag.total : 0)]);
}
// 確かめる：タグの版が同じ・変えていないフレームがそのまま・変えたフレームが1つ（空なら0）・音声部分
function _verifyMp3(oldB, newB, changes) {
  var o = id3ParseStrict(oldB), n = id3ParseStrict(newB);
  if (!n) throw _tagErr('書き込んだタグが読めません');
  if (o && n.ver !== o.ver) throw _tagErr('タグの版が変わってしまいました');
  var tf = _textFields(changes);
  var edited = [];
  tf.forEach(function (f) { edited = edited.concat(_id3Ids(n.ver, f)); });
  var keepO = (o ? o.frames : []).filter(function (fr) { return edited.indexOf(fr.id) < 0 && !_id3PicAffected(o.ver, fr, changes); });
  var keepN = n.frames.filter(function (fr) { return edited.indexOf(fr.id) < 0 && !_id3PicAffected(n.ver, fr, changes); });
  if (keepO.length !== keepN.length) throw _tagErr('変えていないタグの数が変わってしまいました');
  for (var i = 0; i < keepO.length; i++) {
    if (keepO[i].id !== keepN[i].id || !_bytesEqual(keepO[i].raw, keepN[i].raw)) throw _tagErr('変えていないタグ（' + keepO[i].id + '）が変わってしまいました');
  }
  tf.forEach(function (f) {
    var fids = _id3Ids(n.ver, f);
    var cnt = n.frames.filter(function (fr) { return fids.indexOf(fr.id) >= 0; }).length;
    if (cnt !== (changes[f] === '' ? 0 : 1)) throw _tagErr(TAG_FIELD_LABELS[f] + 'のタグが正しく書けていません');
  });
  if ('picture' in changes) {
    var pics = n.frames.filter(function (fr) { return _id3PicAffected(n.ver, fr, changes); });
    if (changes.picture === null ? pics.length !== 0 : (pics.length !== 1 || !_bytesEqual(_id3PicInfo(n.ver, pics[0]).bytes, changes.picture.bytes))) {
      throw _tagErr('ジャケット画像が正しく書けていません');
    }
  }
  return { oldParts: [oldB.subarray(o ? o.total : 0)], newParts: [newB.subarray(n.total)] };
}

/* =========================================================
   m4a（MP4）
   ========================================================= */
var _MP4_WRITE_TYPES = { title: '©nam', artist: '©ART', album: '©alb', albumArtist: 'aART', genre: '©gen', year: '©day' };
var _MP4_ALIAS_TYPES = { genre: ['gnre'] };   // 番号のジャンル（v3.2：©gen に置き換える）
function _mp4Types(f) { return _itemIds(_MP4_WRITE_TYPES, _MP4_ALIAS_TYPES, f); }
// iTunes 形式の hdlr（meta を新しく作るとき用）
var _MP4_HDLR = new Uint8Array([0, 0, 0, 0x22, 0x68, 0x64, 0x6C, 0x72, 0, 0, 0, 0, 0, 0, 0, 0, 0x6D, 0x64, 0x69, 0x72, 0x61, 0x70, 0x70, 0x6C, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
function _mp4BoxesStrict(b, start, end, what) {
  var list = [], p = start;
  while (p < end) {
    if (p + 8 > end) throw _tagErr(what + 'の終わりが正しくありません');
    var size = _u32be(b, p), type = _ascii(b, p + 4, 4), hdr = 8;
    if (size === 1) {
      if (p + 16 > end) throw _tagErr(what + 'の箱が正しくありません');
      size = _u32be(b, p + 8) * 4294967296 + _u32be(b, p + 12); hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) throw _tagErr(what + 'の箱（' + type + '）の大きさが正しくありません');
    list.push({ type: type, start: p, hdr: hdr, end: p + size });
    p += size;
  }
  return list;
}
function _box(type, payload) { return _cat([_be32(8 + payload.length), _asciiBytes(type), payload]); }
function _mp4TextItem(type, text) {
  return _box(type, _box('data', _cat([new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), _utf8enc.encode(text)])));
}
var _MP4_CONTAINERS = ['trak', 'mdia', 'minf', 'stbl'];
// stco / co64（音声データの位置の表）を探して、fn(値, 書き戻し) を呼ぶ
function _mp4EachChunkOffset(b, start, end, fn) {
  _mp4BoxesStrict(b, start, end, 'moov の中').forEach(function (x) {
    if (_MP4_CONTAINERS.indexOf(x.type) >= 0) { _mp4EachChunkOffset(b, x.start + x.hdr, x.end, fn); return; }
    if (x.type !== 'stco' && x.type !== 'co64') return;
    var p = x.start + x.hdr;
    if (p + 8 > x.end) throw _tagErr('音声データの位置の表が正しくありません');
    var count = _u32be(b, p + 4), w = x.type === 'stco' ? 4 : 8;
    if (p + 8 + count * w > x.end) throw _tagErr('音声データの位置の表が正しくありません');
    for (var i = 0; i < count; i++) {
      var q = p + 8 + i * w;
      if (w === 4) fn(_u32be(b, q), function (v, q2) { if (v < 0 || v > 0xFFFFFFFF) throw _tagErr('音声データの位置が範囲を超えます'); b.set(_be32(v), q2); }, q);
      else fn(_u32be(b, q) * 4294967296 + _u32be(b, q + 4), function (v, q2) {
        if (v < 0 || v > Number.MAX_SAFE_INTEGER) throw _tagErr('音声データの位置が範囲を超えます');
        b.set(_be32(Math.floor(v / 4294967296)), q2); b.set(_be32(v % 4294967296), q2 + 4);
      }, q);
    }
  });
}
function _mp4Top(b) {
  var top = _mp4BoxesStrict(b, 0, b.length, 'ファイル');
  if (top.some(function (x) { return x.type === 'moof'; })) throw _tagErr('分割された形式（fragmented MP4）には書き込めません');
  var moovs = top.filter(function (x) { return x.type === 'moov'; });
  if (moovs.length !== 1) throw _tagErr('moov が見つからないか、2つ以上あります');
  var moov = moovs[0];
  if (moov.hdr !== 8) throw _tagErr('大きすぎる moov には対応していません');
  var mdats = top.filter(function (x) { return x.type === 'mdat'; });
  if (!mdats.length) throw _tagErr('音声データ（mdat）が見つかりません');
  var kids = _mp4BoxesStrict(b, moov.start + 8, moov.end, 'moov');
  if (kids.some(function (x) { return x.type === 'mvex'; })) throw _tagErr('分割された形式（fragmented MP4）には書き込めません');
  return { top: top, moov: moov, mdats: mdats, kids: kids };
}
// moov の直下の udta > meta > ilst をたどる（無いものは null）
function _mp4Meta(b, kids) {
  var r = { udta: null, udtaKids: null, meta: null, metaHeader: null, metaKids: null, ilst: null, items: [] };
  r.udta = kids.filter(function (x) { return x.type === 'udta'; })[0] || null;
  if (!r.udta) return r;
  if (r.udta.hdr !== 8) throw _tagErr('udta の形が想定外です');
  r.udtaKids = _mp4BoxesStrict(b, r.udta.start + 8, r.udta.end, 'udta');
  r.meta = r.udtaKids.filter(function (x) { return x.type === 'meta'; })[0] || null;
  if (!r.meta) return r;
  if (r.meta.hdr !== 8) throw _tagErr('meta の形が想定外です');
  var cs = _ascii(b, r.meta.start + 12, 4) === 'hdlr' ? r.meta.start + 8 : r.meta.start + 12;   // バージョン・フラグ付きかどうか
  r.metaHeader = b.subarray(r.meta.start + 8, cs);
  r.metaKids = _mp4BoxesStrict(b, cs, r.meta.end, 'meta');
  r.ilst = r.metaKids.filter(function (x) { return x.type === 'ilst'; })[0] || null;
  if (r.ilst) {
    if (r.ilst.hdr !== 8) throw _tagErr('ilst の形が想定外です');
    r.items = _mp4BoxesStrict(b, r.ilst.start + 8, r.ilst.end, 'ilst').map(function (x) { return { id: x.type, raw: b.subarray(x.start, x.end) }; });
  }
  return r;
}
function buildMp4Tagged(orig, changes) {
  var s = _mp4Top(orig), m = _mp4Meta(orig, s.kids);
  var raw = function (x) { return orig.subarray(x.start, x.end); };
  var items = m.items.slice();
  TAG_FIELDS.forEach(function (f) {
    if (!(f in changes)) return;
    var type = _MP4_WRITE_TYPES[f];
    items = _replaceItemsIds(items, _mp4Types(f), changes[f], function () { return _mp4TextItem(type, changes[f]); });
  });
  if ('picture' in changes) {   // ジャケット画像（covr の最初の画像。2枚目以降は残す）
    var ci = -1;
    items.forEach(function (x, i) { if (ci < 0 && x.id === 'covr') ci = i; });
    if (changes.picture === null) items = items.filter(function (x) { return x.id !== 'covr'; });
    else {
      var pic = changes.picture;
      var dataBox = _box('data', _cat([_be32(pic.mime === 'image/png' ? 14 : 13), new Uint8Array(4), pic.bytes]));
      var rest = [];
      if (ci >= 0) {
        var cv = items[ci].raw;
        rest = _mp4BoxesStrict(cv, 8, cv.length, 'covr').filter(function (x) { return x.type === 'data'; }).slice(1).map(function (x) { return cv.subarray(x.start, x.end); });
      }
      var nc = { id: 'covr', raw: _box('covr', _cat([dataBox].concat(rest))) };
      items = items.filter(function (x) { return x.id !== 'covr'; });
      if (ci >= 0) items.splice(Math.min(ci, items.length), 0, nc); else items.push(nc);
    }
  }
  var newIlst = _box('ilst', _cat(items.map(function (x) { return x.raw; })));
  var metaChildren;
  if (m.metaKids) {
    metaChildren = m.metaKids.map(function (x) { return x === m.ilst ? newIlst : raw(x); });
    if (!m.ilst) metaChildren.push(newIlst);
  } else metaChildren = [_MP4_HDLR, newIlst];
  var newMeta = _box('meta', _cat([m.metaHeader || new Uint8Array(4)].concat(metaChildren)));
  var udtaChildren = m.udtaKids ? m.udtaKids.map(function (x) { return x === m.meta ? newMeta : raw(x); }) : [];
  if (!m.meta) udtaChildren.push(newMeta);
  var newUdta = _box('udta', _cat(udtaChildren));
  var moovChildren = s.kids.map(function (x) { return x === m.udta ? newUdta : raw(x); });
  if (!m.udta) moovChildren.push(newUdta);
  var newMoov = _box('moov', _cat(moovChildren));
  var oldMoovLen = s.moov.end - s.moov.start, delta = newMoov.length - oldMoovLen;
  var afterMoov = s.moov.end, pad = [];
  var dataAfterMoov = s.mdats.some(function (x) { return x.start > s.moov.start; });
  if (delta !== 0 && dataAfterMoov) {
    var next = s.top[s.top.indexOf(s.moov) + 1];
    if (next && (next.type === 'free' || next.type === 'skip') && next.hdr === 8 && (next.end - next.start) - delta >= 8) {
      // 直後の free 箱の大きさで吸収する（音声データの位置は変わらない）
      pad = [_box(next.type, new Uint8Array((next.end - next.start) - delta - 8))];
      afterMoov = next.end;
    } else {
      // 音声データの位置の表を同じだけずらす（moov より後ろを指しているものだけ）
      var limit = s.moov.end;
      _mp4EachChunkOffset(newMoov, 8, newMoov.length, function (v, put, q) { if (v >= limit) put(v + delta, q); });
    }
  }
  return _cat([orig.subarray(0, s.moov.start), newMoov].concat(pad).concat([orig.subarray(afterMoov)]));
}
function _mp4ChunkOffsets(b, moov) {
  var list = [];
  _mp4EachChunkOffset(b, moov.start + 8, moov.end, function (v) { list.push(v); });
  return list;
}
function _verifyMp4(oldB, newB, changes) {
  var so = _mp4Top(oldB), sn = _mp4Top(newB);
  var mo = _mp4Meta(oldB, so.kids), mn = _mp4Meta(newB, sn.kids);
  var tf = _textFields(changes);
  var edited = [];
  tf.forEach(function (f) { edited = edited.concat(_mp4Types(f)); });
  if ('picture' in changes) edited.push('covr');
  var keepO = mo.items.filter(function (x) { return edited.indexOf(x.id) < 0; });
  var keepN = mn.items.filter(function (x) { return edited.indexOf(x.id) < 0; });
  if (keepO.length !== keepN.length) throw _tagErr('変えていないタグの数が変わってしまいました');
  for (var i = 0; i < keepO.length; i++) {
    if (keepO[i].id !== keepN[i].id || !_bytesEqual(keepO[i].raw, keepN[i].raw)) throw _tagErr('変えていないタグ（' + keepO[i].id + '）が変わってしまいました');
  }
  tf.forEach(function (f) {
    var mt = _mp4Types(f);
    var cnt = mn.items.filter(function (x) { return mt.indexOf(x.id) >= 0; }).length;
    if (cnt !== (changes[f] === '' ? 0 : 1)) throw _tagErr(TAG_FIELD_LABELS[f] + 'のタグが正しく書けていません');
  });
  if ('picture' in changes) {
    var covrs = mn.items.filter(function (x) { return x.id === 'covr'; });
    if (changes.picture === null) { if (covrs.length) throw _tagErr('ジャケット画像が外れていません'); }
    else {
      if (covrs.length !== 1) throw _tagErr('ジャケット画像が正しく書けていません');
      var cr = covrs[0].raw, d0 = _mp4BoxesStrict(cr, 8, cr.length, 'covr').filter(function (x) { return x.type === 'data'; })[0];
      if (!d0 || !_bytesEqual(cr.subarray(d0.start + 16, d0.end), changes.picture.bytes)) throw _tagErr('ジャケット画像が正しく書けていません');
    }
  }
  // moov の中の udta 以外（trak など）の箱の種類と数が同じ
  var ko = so.kids.filter(function (x) { return x.type !== 'udta'; }).map(function (x) { return x.type; }).join(',');
  var kn = sn.kids.filter(function (x) { return x.type !== 'udta'; }).map(function (x) { return x.type; }).join(',');
  if (ko !== kn) throw _tagErr('moov の中身が変わってしまいました');
  // 音声データの位置の表：数が同じで、どの位置も同じ音声データを指している
  var co = _mp4ChunkOffsets(oldB, so.moov), cn = _mp4ChunkOffsets(newB, sn.moov);
  if (co.length !== cn.length) throw _tagErr('音声データの位置の表が変わってしまいました');
  for (var j = 0; j < co.length; j++) {
    var a = oldB.subarray(co[j], Math.min(oldB.length, co[j] + 32)), c = newB.subarray(cn[j], Math.min(newB.length, cn[j] + 32));
    if (!a.length || !_bytesEqual(a, c)) throw _tagErr('音声データの位置がずれてしまいました');
  }
  if (so.mdats.length !== sn.mdats.length) throw _tagErr('音声データ（mdat）の数が変わってしまいました');
  return {
    oldParts: so.mdats.map(function (x) { return oldB.subarray(x.start + x.hdr, x.end); }),
    newParts: sn.mdats.map(function (x) { return newB.subarray(x.start + x.hdr, x.end); })
  };
}

/* =========================================================
   flac（VORBIS_COMMENT）
   ========================================================= */
var _VC_KEYS = { title: ['TITLE'], artist: ['ARTIST'], album: ['ALBUM'], albumArtist: ['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST'], genre: ['GENRE'], year: ['DATE', 'YEAR'] };
var _VC_WRITE_KEY = { title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', albumArtist: 'ALBUMARTIST', genre: 'GENRE', year: 'DATE' };
function _flacParseStrict(b) {
  var p = 0;
  if (_ascii(b, 0, 3) === 'ID3') p = 10 + _syncsafe(b, 6) + ((b[3] === 4 && (b[5] & 0x10)) ? 10 : 0);   // 先頭の ID3 はそのまま残す
  if (_ascii(b, p, 4) !== 'fLaC') throw _tagErr('FLAC の目印が見つかりません');
  var q = p + 4, blocks = [], last = false;
  for (var g = 0; g < 1024 && !last; g++) {
    if (q + 4 > b.length) throw _tagErr('FLAC の情報ブロックが途中で切れています');
    last = (b[q] & 0x80) !== 0;
    var type = b[q] & 0x7f, len = _u24be(b, q + 1);
    if (type === 127) throw _tagErr('FLAC の情報ブロックが正しくありません');
    if (q + 4 + len > b.length) throw _tagErr('FLAC の情報ブロックの大きさが正しくありません');
    blocks.push({ type: type, data: b.subarray(q + 4, q + 4 + len) });
    q += 4 + len;
  }
  if (!last) throw _tagErr('FLAC の情報ブロックが多すぎます');
  if (!blocks.length || blocks[0].type !== 0) throw _tagErr('FLAC の STREAMINFO が先頭にありません');
  if (blocks.filter(function (x) { return x.type === 4; }).length > 1) throw _tagErr('VORBIS_COMMENT が2つ以上あります');
  return { prefixEnd: p, blocks: blocks, audioStart: q };
}
function _vcParseStrict(d) {
  if (d.length < 8) throw _tagErr('VORBIS_COMMENT が正しくありません');
  var vlen = _u32le(d, 0);
  if (8 + vlen > d.length) throw _tagErr('VORBIS_COMMENT が正しくありません');
  var n = _u32le(d, 4 + vlen), p = 8 + vlen, comments = [];
  for (var i = 0; i < n; i++) {
    if (p + 4 > d.length) throw _tagErr('VORBIS_COMMENT が途中で切れています');
    var len = _u32le(d, p);
    if (p + 4 + len > d.length) throw _tagErr('VORBIS_COMMENT が途中で切れています');
    comments.push(d.subarray(p + 4, p + 4 + len));
    p += 4 + len;
  }
  return { vendor: d.subarray(4, 4 + vlen), comments: comments, tail: d.subarray(p) };
}
function _vcKey(c) {
  var n = Math.min(c.length, 64);
  for (var i = 0; i < n; i++) if (c[i] === 0x3D) return _ascii(c, 0, i).toUpperCase();
  return '';
}
function _vcFieldOf(c) {
  var k = _vcKey(c);
  for (var f in _VC_KEYS) if (_VC_KEYS[f].indexOf(k) >= 0) return f;
  return '';
}
function _flacPicType(x) { return x.type === 6 && x.data.length >= 4 ? _u32be(x.data, 0) : -1; }
function _flacPicAffected(x, changes) {
  if (!('picture' in changes) || x.type !== 6) return false;
  return changes.picture === null ? true : _flacPicType(x) === 3;
}
function _flacPictureBlock(pic) {
  var mime = _asciiBytes(pic.mime);
  return _cat([_be32(3), _be32(mime.length), mime, _be32(0), _be32(pic.width || 0), _be32(pic.height || 0), _be32(24), _be32(0), _be32(pic.bytes.length), pic.bytes]);
}
function _flacPicBytes(x) {
  var d = x.data, ml = _u32be(d, 4), p = 8 + ml, dl = _u32be(d, p); p += 4 + dl + 16;
  var len = _u32be(d, p); p += 4;
  return d.subarray(p, p + len);
}
function buildFlacTagged(orig, changes) {
  var fl = _flacParseStrict(orig);
  var blocks = fl.blocks.map(function (x) { return { type: x.type, data: x.data }; });
  var tf = _textFields(changes);
  if (tf.length) {   // 曲名など：VORBIS_COMMENT
    var vcIdx = -1;
    for (var i = 0; i < blocks.length; i++) if (blocks[i].type === 4) vcIdx = i;
    var vc = vcIdx >= 0 ? _vcParseStrict(blocks[vcIdx].data) : { vendor: _utf8enc.encode('Music Manager'), comments: [], tail: new Uint8Array(0) };
    var comments = vc.comments.map(function (c) { return { id: _vcFieldOf(c), raw: c }; });
    tf.forEach(function (f) {
      comments = _replaceItems(comments, f, changes[f], function () { return _utf8enc.encode(_VC_WRITE_KEY[f] + '=' + changes[f]); });
    });
    var parts = [_le32(vc.vendor.length), vc.vendor, _le32(comments.length)];
    comments.forEach(function (c) { parts.push(_le32(c.raw.length), c.raw); });
    parts.push(vc.tail);
    var newVc = _cat(parts);
    if (newVc.length > 0xFFFFFF) throw _tagErr('タグが大きすぎます');
    if (vcIdx >= 0) blocks[vcIdx] = { type: 4, data: newVc };
    else blocks.splice(1, 0, { type: 4, data: newVc });
  }
  if ('picture' in changes) {   // ジャケット画像：PICTURE ブロック
    var first = -1;
    blocks.forEach(function (x, k) { if (first < 0 && _flacPicAffected(x, changes)) first = k; });
    blocks = blocks.filter(function (x) { return !_flacPicAffected(x, changes); });
    if (changes.picture) {
      var pb = _flacPictureBlock(changes.picture);
      if (pb.length > 0xFFFFFF) throw _tagErr('画像が大きすぎます');
      var at = first >= 0 ? first : -1;
      if (at < 0) { for (var v = 0; v < blocks.length; v++) if (blocks[v].type === 4) at = v + 1; }
      if (at < 0) at = 1;
      blocks.splice(Math.min(at, blocks.length), 0, { type: 6, data: pb });
    }
  }
  // 大きさの差は PADDING で吸収（音声データの位置を変えない）。足りなければ PADDING を作り直す
  var sum = function (list) { return list.reduce(function (t, x) { return t + 4 + x.data.length; }, 0); };
  var delta = sum(blocks) - sum(fl.blocks);
  if (delta !== 0) {
    var padIdx = -1;
    for (var j = 0; j < blocks.length; j++) if (blocks[j].type === 1) { padIdx = j; break; }
    if (padIdx >= 0 && blocks[padIdx].data.length - delta >= 0) blocks[padIdx] = { type: 1, data: new Uint8Array(blocks[padIdx].data.length - delta) };
    else if (padIdx >= 0) blocks[padIdx] = { type: 1, data: new Uint8Array(4096) };
    else blocks.push({ type: 1, data: new Uint8Array(4096) });
  }
  var out = [orig.subarray(0, fl.prefixEnd + 4)];
  blocks.forEach(function (x, k) {
    var len = x.data.length;
    out.push(new Uint8Array([(k === blocks.length - 1 ? 0x80 : 0) | x.type, (len >> 16) & 255, (len >> 8) & 255, len & 255]), x.data);
  });
  out.push(orig.subarray(fl.audioStart));
  return _cat(out);
}
function _verifyFlac(oldB, newB, changes) {
  var o = _flacParseStrict(oldB), n = _flacParseStrict(newB);
  if (!_bytesEqual(oldB.subarray(0, o.prefixEnd), newB.subarray(0, n.prefixEnd))) throw _tagErr('先頭の ID3 が変わってしまいました');
  var tf = _textFields(changes);
  // VORBIS_COMMENT（曲名などを変えたとき）・PADDING・変えた画像 以外のブロックはそのまま
  var keep = function (x) { return x.type !== 1 && !(x.type === 4 && tf.length) && !_flacPicAffected(x, changes); };
  var bo = o.blocks.filter(keep), bn = n.blocks.filter(keep);
  if (bo.length !== bn.length) throw _tagErr('FLAC の情報ブロックの数が変わってしまいました');
  for (var i = 0; i < bo.length; i++) {
    if (bo[i].type !== bn[i].type || !_bytesEqual(bo[i].data, bn[i].data)) throw _tagErr('FLAC の情報ブロック（種類 ' + bo[i].type + '）が変わってしまいました');
  }
  if (tf.length) {
    var vo = o.blocks.filter(function (x) { return x.type === 4; })[0], vn = n.blocks.filter(function (x) { return x.type === 4; })[0];
    if (!vn) throw _tagErr('VORBIS_COMMENT が見つかりません');
    var co = vo ? _vcParseStrict(vo.data) : { vendor: null, comments: [], tail: new Uint8Array(0) }, cn = _vcParseStrict(vn.data);
    if (co.vendor && !_bytesEqual(co.vendor, cn.vendor)) throw _tagErr('VORBIS_COMMENT の作成ソフト名が変わってしまいました');
    var ko = co.comments.filter(function (c) { return tf.indexOf(_vcFieldOf(c)) < 0; });
    var kn = cn.comments.filter(function (c) { return tf.indexOf(_vcFieldOf(c)) < 0; });
    if (ko.length !== kn.length) throw _tagErr('変えていないタグの数が変わってしまいました');
    for (var j = 0; j < ko.length; j++) if (!_bytesEqual(ko[j], kn[j])) throw _tagErr('変えていないタグ（' + _vcKey(ko[j]) + '）が変わってしまいました');
    tf.forEach(function (f) {
      var cnt = cn.comments.filter(function (c) { return _vcFieldOf(c) === f; }).length;
      if (cnt !== (changes[f] === '' ? 0 : 1)) throw _tagErr(TAG_FIELD_LABELS[f] + 'のタグが正しく書けていません');
    });
  }
  if ('picture' in changes) {
    var pics = n.blocks.filter(function (x) { return _flacPicAffected(x, changes); });
    if (changes.picture === null ? pics.length !== 0 : (pics.length !== 1 || !_bytesEqual(_flacPicBytes(pics[0]), changes.picture.bytes))) {
      throw _tagErr('ジャケット画像が正しく書けていません');
    }
  }
  return { oldParts: [oldB.subarray(o.audioStart)], newParts: [newB.subarray(n.audioStart)] };
}

/* =========================================================
   入口
   ========================================================= */
function buildTaggedFile(kind, orig, changes) {
  if (kind === 'mp3') return buildMp3Tagged(orig, changes);
  if (kind === 'mp4') return buildMp4Tagged(orig, changes);
  if (kind === 'flac') return buildFlacTagged(orig, changes);
  throw _tagErr('この形式には書き込めません');
}
// 新旧のバイト列を比べて確かめる。問題があれば TagWriteError
async function verifyTaggedFile(kind, oldB, newB, name, changes) {
  var parts = kind === 'mp3' ? _verifyMp3(oldB, newB, changes) : (kind === 'mp4' ? _verifyMp4(oldB, newB, changes) : _verifyFlac(oldB, newB, changes));
  // 音声データ部分が元と同じか（SHA-256 で比べる）
  if (parts.oldParts.length !== parts.newParts.length) throw _tagErr('音声データが元と一致しません');
  for (var i = 0; i < parts.oldParts.length; i++) {
    if (parts.oldParts[i].length !== parts.newParts[i].length || await sha256Hex(parts.oldParts[i]) !== await sha256Hex(parts.newParts[i])) {
      throw _tagErr('音声データが元と一致しません');
    }
  }
  // 曲情報の読み取りで確かめる（変えた項目は新しい値、変えていない項目・ジャケット・歌詞は同じ）
  var of = new File([oldB], name), nf = new File([newB], name);
  var ot = await readTrackTags(of), nt = await readTrackTags(nf);
  _textFields(changes).forEach(function (f) {
    // 読み取りでは発売年は数、ジャンルは「(17)」などを名前に直すので、同じ形にして比べる（v3.2）
    var want = f === 'year' ? String(_yearOf(changes[f]) || '') : f === 'genre' ? _genreName(changes[f]) : changes[f];
    if (changes[f] !== '' && String(nt[f] || '') !== want) throw _tagErr(TAG_FIELD_LABELS[f] + 'が正しく読めません（書き込みを確かめられません）');
  });
  ['title', 'artist', 'album', 'albumArtist', 'track', 'disc', 'genre', 'year'].forEach(function (f) {
    if (f in changes) return;
    if (f === 'artist' && 'albumArtist' in changes) return;   // アーティストが空の曲は、読み取りでアルバムアーティストを使うため
    if ((ot[f] || '') !== (nt[f] || '')) throw _tagErr('変えていない項目（' + (TAG_FIELD_LABELS[f] || f) + '）が変わってしまいました');
  });
  if (Math.abs((ot.duration || 0) - (nt.duration || 0)) > 0.5) throw _tagErr('曲の長さが変わってしまいました');
  var op = await readTrackPicture(of), np = await readTrackPicture(nf);
  if ('picture' in changes) {   // 画像を変えたとき：読み取りで期待どおりの画像になっているか
    if (changes.picture === null ? !!np : (!np || !_bytesEqual(np.bytes, changes.picture.bytes))) throw _tagErr('ジャケット画像が期待どおりに読めません');
  } else if (!!op !== !!np || (op && !_bytesEqual(op.bytes, np.bytes))) throw _tagErr('ジャケット画像が変わってしまいました');
  var ol = await readTrackLyrics(of), nl = await readTrackLyrics(nf);
  if (!!ol !== !!nl || (ol && ol.text !== nl.text)) throw _tagErr('歌詞が変わってしまいました');
  return true;
}
