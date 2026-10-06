/* =========================================================
   03-tag-reader.js ― 曲情報（タグ）の読み取り
   音楽ファイルの先頭・末尾を「読むだけ」。書き換えは一切しない。
   対応：mp3/aac（ID3v2・ID3v1）、m4a（MP4 の ilst）、flac（Vorbis comment）、
         ogg/opus（Vorbis comment）、wav（LIST INFO・id3 チャンク）
   読み取るもの：曲名・アーティスト・アルバム・アルバムアーティスト・トラック番号・ディスク番号・長さ（読めた形式のみ）
   長さが読めない形式は、04-library.js で audio 要素を使って調べる。
   readTrackPicture() は埋め込まれたジャケット画像を取り出す（ID3 APIC・m4a covr・
   flac PICTURE・ogg METADATA_BLOCK_PICTURE）。使うのは 13-artwork.js。
   readTrackLyrics() は埋め込まれた歌詞を取り出す（ID3 USLT・SYLT、m4a ©lyr、flac・ogg LYRICS／UNSYNCEDLYRICS）。
   decodeTextBytes() は歌詞ファイル（lrc・txt）の文字コードを判定して読む。使うのは 15-lyrics.js。
   v2.5：曲情報だけを読むとき（画像・歌詞は不要）は、大きなタグの中の画像部分を読まない
         （mp3 の APIC、m4a の covr・trak。飛ばした所は 0 のままの入れ物で、解析は今までと同じ関数）
   ========================================================= */

/* ---------- バイト列の読み取り補助 ---------- */
function _u32be(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
function _u32le(b, o) { return b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0); }
function _u24be(b, o) { return (b[o] << 16) + (b[o + 1] << 8) + b[o + 2]; }
function _syncsafe(b, o) { return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f); }
function _ascii(b, o, n) {
  var s = '';
  for (var i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}
async function _readBytes(file, start, end) {
  start = Math.max(0, start);
  end = Math.min(file.size, end);
  if (end <= start) return new Uint8Array(0);
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}
function _concatBytes(chunks, total) {
  var out = new Uint8Array(total), p = 0;
  chunks.forEach(function (c) { out.set(c, p); p += c.length; });
  return out;
}
function _trimNullBytes(b) {
  var end = b.length;
  while (end > 0 && (b[end - 1] === 0 || b[end - 1] === 0x20)) end--;
  return b.subarray(0, end);
}

/* ---------- 文字コード ---------- */
var _decoders = {};
function _decoder(label, fatal) {
  var k = label + (fatal ? '!' : '');
  if (!(k in _decoders)) {
    try { _decoders[k] = new TextDecoder(label, fatal ? { fatal: true } : undefined); }
    catch (e) { _decoders[k] = null; }
  }
  return _decoders[k];
}
function _latin1(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
// 文字コードが決まっていない文字列（ID3 の encoding 0、ID3v1、WAV の INFO）を読む。
// 日本のファイルは Shift_JIS で書かれていることが多いので、UTF-8 → Shift_JIS → Latin-1 の順に試す。
function _decodeLegacy(bytes) {
  var ascii = true;
  for (var i = 0; i < bytes.length; i++) { if (bytes[i] >= 0x80) { ascii = false; break; } }
  if (ascii) return _latin1(bytes);
  var d = _decoder('utf-8', true);
  if (d) { try { return d.decode(bytes); } catch (e) { /* 次を試す */ } }
  d = _decoder('shift_jis', true);
  if (d) { try { return d.decode(bytes); } catch (e) { /* 次を試す */ } }
  d = _decoder('windows-1252', false);
  return d ? d.decode(bytes) : _latin1(bytes);
}
function _decodeUtf16(bytes, defaultBE) {
  var be = defaultBE, start = 0;
  if (bytes.length >= 2) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) { be = false; start = 2; }
    else if (bytes[0] === 0xFE && bytes[1] === 0xFF) { be = true; start = 2; }
  }
  var len = bytes.length - start;
  if (len % 2) len--;
  var d = _decoder(be ? 'utf-16be' : 'utf-16le', false);
  return d ? d.decode(bytes.subarray(start, start + len)) : '';
}
function _decodeUtf8(bytes) {
  var d = _decoder('utf-8', false);
  return d ? d.decode(bytes) : _latin1(bytes);
}
// 余分な NUL・BOM を取り、複数の値（NUL 区切り）は「 / 」でつなぐ
function _cleanText(s) {
  return String(s || '').replace(/﻿/g, '').split('\u0000')
    .map(function (x) { return x.trim(); }).filter(Boolean).join(' / ');
}

/* ---------- ID3v2（mp3 など） ---------- */
function _deUnsync(b) {
  var out = new Uint8Array(b.length), p = 0;
  for (var i = 0; i < b.length; i++) {
    out[p++] = b[i];
    if (b[i] === 0xFF && i + 1 < b.length && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, p);
}
function _id3Text(data) {
  if (!data.length) return '';
  var enc = data[0], body = data.subarray(1), s;
  if (enc === 1) s = _decodeUtf16(body, false);
  else if (enc === 2) s = _decodeUtf16(body, true);
  else if (enc === 3) s = _decodeUtf8(body);
  else s = _decodeLegacy(_trimNullBytes(body));
  return _cleanText(s);
}
// 「3」「03」「3/12」のような番号を数にする（読めなければ 0）
function _parseTrackNo(s) {
  var m = String(s || '').match(/^\s*(\d{1,4})/);
  var n = m ? parseInt(m[1], 10) : 0;
  return n > 0 ? n : 0;
}
/* ---------- ジャンル・発売年（v3.1） ---------- */
// ID3v1 のジャンル番号（0〜147。mp3 の TCON の「(17)」や、m4a の gnre は番号で入っていることがある）
var ID3V1_GENRES = 'Blues|Classic Rock|Country|Dance|Disco|Funk|Grunge|Hip-Hop|Jazz|Metal|New Age|Oldies|Other|Pop|R&B|Rap|Reggae|Rock|Techno|Industrial|Alternative|Ska|Death Metal|Pranks|Soundtrack|Euro-Techno|Ambient|Trip-Hop|Vocal|Jazz+Funk|Fusion|Trance|Classical|Instrumental|Acid|House|Game|Sound Clip|Gospel|Noise|AlternRock|Bass|Soul|Punk|Space|Meditative|Instrumental Pop|Instrumental Rock|Ethnic|Gothic|Darkwave|Techno-Industrial|Electronic|Pop-Folk|Eurodance|Dream|Southern Rock|Comedy|Cult|Gangsta|Top 40|Christian Rap|Pop/Funk|Jungle|Native American|Cabaret|New Wave|Psychadelic|Rave|Showtunes|Trailer|Lo-Fi|Tribal|Acid Punk|Acid Jazz|Polka|Retro|Musical|Rock & Roll|Hard Rock|Folk|Folk-Rock|National Folk|Swing|Fast Fusion|Bebob|Latin|Revival|Celtic|Bluegrass|Avantgarde|Gothic Rock|Progressive Rock|Psychedelic Rock|Symphonic Rock|Slow Rock|Big Band|Chorus|Easy Listening|Acoustic|Humour|Speech|Chanson|Opera|Chamber Music|Sonata|Symphony|Booty Bass|Primus|Porn Groove|Satire|Slow Jam|Club|Tango|Samba|Folklore|Ballad|Power Ballad|Rhythmic Soul|Freestyle|Duet|Punk Rock|Drum Solo|A capella|Euro-House|Dance Hall|Goa|Drum & Bass|Club-House|Hardcore|Terror|Indie|BritPop|Negerpunk|Polsk Punk|Beat|Christian Gangsta Rap|Heavy Metal|Black Metal|Crossover|Contemporary Christian|Christian Rock|Merengue|Salsa|Thrash Metal|Anime|JPop|Synthpop'.split('|');
// ジャンルの文字を名前にする：「(17)」「17」「(17)Rock」→ Rock、「(RX)」→ Remix、「(CR)」→ Cover。複数（v2.4 の区切り）は最初のもの
function _genreName(s) {
  s = String(s || '').split('\u0000')[0].trim();
  if (!s) return '';
  var m = s.match(/^\((\d{1,3})\)(.*)$/);
  if (m) return m[2].trim() || ID3V1_GENRES[+m[1]] || '';
  if (/^\d{1,3}$/.test(s)) return ID3V1_GENRES[+s] || '';
  if (/^\(RX\)/i.test(s)) return s.slice(4).trim() || 'Remix';
  if (/^\(CR\)/i.test(s)) return s.slice(4).trim() || 'Cover';
  return s;
}
// 日付から年（4桁）を取り出す（「2019」「2019-05-01」「2019-05-01T00:00:00Z」など）。無ければ 0
function _yearOf(s) {
  var m = String(s || '').match(/(^|\D)([12]\d{3})(\D|$)/);
  return m ? +m[2] : 0;
}
var _ID3_FIELDS = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TPE2: 'albumArtist', TP2: 'albumArtist' };
function _applyId3Frame(id, body, out) {
  if (id === 'APIC' || id === 'PIC') { if (out.wantPicture) _parseId3Picture(id, body, out); return; }
  if (id === 'USLT' || id === 'ULT') { if (out.wantLyrics && !out.lyrics) out.lyrics = _parseId3Uslt(body); return; }
  if (id === 'SYLT' || id === 'SLT') { if (out.wantLyrics && !out.syncedLyrics) out.syncedLyrics = _parseId3Sylt(body); return; }
  var f = _ID3_FIELDS[id];
  if (f) { if (!out[f]) out[f] = _id3Text(body); return; }
  if (id === 'TRCK' || id === 'TRK') { if (!out.track) out.track = _parseTrackNo(_id3Text(body)); return; }
  if (id === 'TCON' || id === 'TCO') { if (!out.genre) out.genre = _genreName(_id3Text(body)); return; }   // ジャンル（v3.1）
  // 発売年（v3.1）。v3.2：TYER・TDRC・TYE（発売日）を、TDOR・TORY（元の発売日）より優先する（アプリで書いた年が必ず出るように）
  if (id === 'TYER' || id === 'TYE' || id === 'TDRC') { if (!out.year || out._yearOrig) { var y1 = _yearOf(_id3Text(body)); if (y1) { out.year = y1; out._yearOrig = false; } } return; }
  if (id === 'TDOR' || id === 'TORY') { if (!out.year) { out.year = _yearOf(_id3Text(body)); out._yearOrig = !!out.year; } return; }
  if (id === 'TBPM' || id === 'TBP') { if (!out.bpm) out.bpm = parseFloat(_id3Text(body)) || 0; return; }   // BPM（v7.8。upbeat music）
  if (id === 'TCMP' || id === 'TCP') { if (/^\s*1/.test(_id3Text(body))) out.compilation = true; return; }   // コンピレーションの印（iTunes。v2.9）
  if (id === 'TPOS' || id === 'TPA') { if (!out.disc) out.disc = _parseTrackNo(_id3Text(body)); return; }
  if (id === 'TLEN' || id === 'TLE') {
    var ms = parseInt(_id3Text(body), 10);
    if (ms > 0 && !out.duration) out.duration = ms / 1000;
  }
}
// ID3 の画像フレーム（v2.3/2.4 は APIC、v2.2 は PIC）
function _parseId3Picture(id, b, out) {
  if (b.length < 8) return;
  var enc = b[0], p, mime;
  if (id === 'PIC') { mime = _ascii(b, 1, 3).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg'; p = 4; }
  else {
    var z = b.indexOf(0, 1);
    if (z < 0) return;
    mime = _ascii(b, 1, z - 1).toLowerCase();
    p = z + 1;
  }
  var ptype = b[p]; p++;
  // 説明文を飛ばす（UTF-16 は 00 00 で終わる）
  if (enc === 1 || enc === 2) { while (p + 1 < b.length && !(b[p] === 0 && b[p + 1] === 0)) p += 2; p += 2; }
  else { while (p < b.length && b[p] !== 0) p++; p++; }
  if (p >= b.length) return;
  _offerPicture(out, ptype, mime, b.subarray(p));
}

/* ---------- 歌詞（ID3 の USLT：時間なし、SYLT：時間付き） ---------- */
// ID3 の文字列の終わり（UTF-16 は 00 00、それ以外は 00）の位置。見つからなければ -1
function _id3StrEnd(b, p, enc) {
  if (enc === 1 || enc === 2) {
    for (var i = p; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return -1;
  }
  for (var j = p; j < b.length; j++) if (b[j] === 0) return j;
  return -1;
}
// 文字コード付きの文字列を読む（改行はそのまま残す）
function _id3Str(bytes, enc) {
  var s;
  if (enc === 1) s = _decodeUtf16(bytes, false);
  else if (enc === 2) s = _decodeUtf16(bytes, true);
  else if (enc === 3) s = _decodeUtf8(bytes);
  else s = _decodeLegacy(bytes);
  return s.replace(/\uFEFF/g, '').replace(/\u0000+$/, '');
}
function _parseId3Uslt(b) {
  if (b.length < 5) return '';
  var enc = b[0];
  var e = _id3StrEnd(b, 4, enc);   // 言語（3文字）のあとの説明文を飛ばす
  if (e < 0) return '';
  var p = e + ((enc === 1 || enc === 2) ? 2 : 1);
  return _id3Str(b.subarray(p), enc).replace(/\r\n?/g, '\n').trim();
}
// SYLT：[{ time:秒, text }]。時間の単位がミリ秒（形式 2）のものだけ使う
function _parseId3Sylt(b) {
  if (b.length < 7) return null;
  var enc = b[0], fmt = b[4];
  if (fmt !== 2) return null;
  var tl = (enc === 1 || enc === 2) ? 2 : 1;
  var e = _id3StrEnd(b, 6, enc);
  if (e < 0) return null;
  var p = e + tl, lines = [];
  while (p < b.length) {
    var end = _id3StrEnd(b, p, enc);
    if (end < 0 || end + tl + 4 > b.length) break;
    var text = _id3Str(b.subarray(p, end), enc).replace(/\r\n?/g, '\n');
    p = end + tl;
    lines.push({ time: _u32be(b, p) / 1000, text: text.replace(/^\n+/, '') });
    p += 4;
  }
  return lines.length ? lines : null;
}

// 歌詞ファイル（lrc・txt）の文字コード判定：BOM（UTF-8・UTF-16）→ UTF-8 → Shift_JIS → Latin-1
function decodeTextBytes(b) {
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return _decodeUtf8(b.subarray(3));
  if (b.length >= 2 && ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF))) return _decodeUtf16(b, false);
  return _decodeLegacy(b);
}

// 画像の種類を中身の先頭バイトから判定する（タグに書かれた種類は間違っていることがある）
function _sniffImageMime(b) {
  if (b.length < 12) return '';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (_ascii(b, 0, 4) === 'GIF8') return 'image/gif';
  if (_ascii(b, 0, 4) === 'RIFF' && _ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp';
  return '';
}
// 見つけた画像を候補にする。表紙（picture type 3）があればそれを優先
function _offerPicture(out, type, mime, bytes) {
  if (!out.wantPicture || !bytes || bytes.length < 16) return;
  var m = _sniffImageMime(bytes);
  if (!m) return;   // 画像として読めないものは使わない
  if (out.picture && (out.picture.type === 3 || type !== 3)) return;
  out.picture = { type: type, mime: m, bytes: bytes.slice() };   // slice でコピー（元の大きな読み込みを手放せるように）
}
// FLAC の PICTURE ブロック（ogg の METADATA_BLOCK_PICTURE も同じ形を base64 にしたもの）
function _parseFlacPicture(b, out) {
  if (b.length < 32) return;
  var type = _u32be(b, 0), ml = _u32be(b, 4), p = 8 + ml;
  if (p + 4 > b.length) return;
  var mime = _ascii(b, 8, ml);
  var dl = _u32be(b, p); p += 4 + dl + 16;   // 説明文と、幅・高さ・色数
  if (p + 4 > b.length) return;
  var len = _u32be(b, p); p += 4;
  if (p + len > b.length) return;
  _offerPicture(out, type, mime, b.subarray(p, p + len));
}
function _base64ToBytes(ascii) {
  try {
    var bin = atob(ascii.replace(/[^A-Za-z0-9+\/=]/g, ''));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) { return null; }
}

// buf の先頭が ID3v2 ならタグを読み、タグ全体の長さを返す（ID3 でなければ 0）
function _parseId3v2(buf, out) {
  if (buf.length < 10 || _ascii(buf, 0, 3) !== 'ID3') return 0;
  var ver = buf[3], flags = buf[5];
  var tagSize = _syncsafe(buf, 6);
  var total = 10 + tagSize + ((ver === 4 && (flags & 0x10)) ? 10 : 0);
  if (ver < 2 || ver > 4) return total;
  var data = buf.subarray(10, Math.min(buf.length, 10 + tagSize));
  if ((flags & 0x80) && ver < 4) data = _deUnsync(data);     // タグ全体の非同期化
  var pos = 0;
  if ((flags & 0x40) && ver >= 3 && data.length >= 4) {      // 拡張ヘッダーを飛ばす
    pos = (ver === 3) ? 4 + _u32be(data, 0) : _syncsafe(data, 0);
  }
  var idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
  while (pos + hdrLen <= data.length) {
    if (data[pos] === 0) break;                                // 余白（パディング）
    var id = _ascii(data, pos, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    var size = ver === 2 ? _u24be(data, pos + 3) : (ver === 4 ? _syncsafe(data, pos + 4) : _u32be(data, pos + 4));
    var fmt = ver === 2 ? 0 : data[pos + 9];
    var start = pos + hdrLen, end = start + size;
    if (size <= 0 || end > data.length) break;
    var body = data.subarray(start, end), skip = false;
    if (ver === 3) {
      if (fmt & 0xC0) skip = true;                             // 圧縮・暗号化は読まない
      if (fmt & 0x20) body = body.subarray(1);                 // グループ識別子
    } else if (ver === 4) {
      if (fmt & 0x0C) skip = true;                             // 圧縮・暗号化は読まない
      if (fmt & 0x40) body = body.subarray(1);
      if (fmt & 0x01) body = body.subarray(4);                 // データ長の表示
      if (fmt & 0x02) body = _deUnsync(body);
    }
    if (!skip) _applyId3Frame(id, body, out);
    pos = end;
  }
  return total;
}
function _parseId3v1(tail, out) {
  if (tail.length < 128 || _ascii(tail, 0, 3) !== 'TAG') return;
  function field(a, b) { return _cleanText(_decodeLegacy(_trimNullBytes(tail.subarray(a, b)))); }
  if (!out.title) out.title = field(3, 33);
  if (!out.artist) out.artist = field(33, 63);
  if (!out.album) out.album = field(63, 93);
}
var TAG_SPARSE_MIN = 128 * 1024;   // これより大きいタグは、曲情報だけのとき画像部分を飛ばして読む（v2.5）
var TAG_SPARSE_CHUNK = 64 * 1024;
var TAG_HEAD_CHUNK = 128 * 1024;   // 先頭をまとめて読む大きさ（v2.7：小さなタグ・最初のフレームは、この1回で読み終わる）
async function _readMp3(file, out) {
  // 先頭をまとめて1回で読む（v2.6 までは 見出し10バイト→タグ→末尾→最初のフレーム と4回に分けて読んでいた）
  var first = await _readBytes(file, 0, TAG_HEAD_CHUNK);
  var audioStart = 0;
  if (first.length >= 10 && _ascii(first, 0, 3) === 'ID3') {
    var size = 10 + _syncsafe(first, 6);
    var ver = first[3], flags = first[5];
    var buf = size <= first.length ? first.subarray(0, size)
      : (!out.wantPicture && !out.wantLyrics && size > TAG_SPARSE_MIN && (ver === 3 || ver === 4) && !(ver === 3 && (flags & 0x80)))
        ? await _readId3Sparse(file, Math.min(size, 16 * 1024 * 1024), ver, flags)
        : await _readBytes(file, 0, Math.min(size, 16 * 1024 * 1024));
    audioStart = _parseId3v2(buf, out);
  }
  if (out.wantPicture || out.wantLyrics) return;   // 画像・歌詞を探すときは、ここから先（ID3v1・長さ）は不要
  // 末尾の ID3v1 は、必要なときだけ読む（曲名などが足りないとき・長さを大きさから計算するとき）
  var tail = null;
  async function getTail() {
    if (tail === null) tail = file.size > 128 ? await _readBytes(file, file.size - 128, file.size) : new Uint8Array(0);
    return tail;
  }
  if (!out.title || !out.artist || !out.album) { var tl = await getTail(); if (tl.length) _parseId3v1(tl, out); }
  // 長さ：最初のフレームの Xing/Info/VBRI ヘッダー、なければ固定ビットレートとして計算
  if (extOf(file.name) === 'mp3') {
    var d = await _mp3Duration(file, audioStart, async function () { var tl2 = await getTail(); return _ascii(tl2, 0, 3) === 'TAG'; }, first);
    if (d > 0) out.duration = d;   // TLEN より実際のフレームから計算した値を優先する
  }
}
// ID3v2.3/2.4 のタグを、フレームの見出しをたどりながら読む。画像フレーム（APIC）の中身だけは読まずに 0 のまま（v2.5）
//   タグ全体の非同期化（v2.3 の flags 0x80）は位置がずれるので使わない（呼び出し側で全体を読む）
async function _readId3Sparse(file, size, ver, flags) {
  var buf = new Uint8Array(size);
  var lo = 0, hi = Math.min(size, TAG_SPARSE_CHUNK);
  buf.set(await _readBytes(file, 0, hi), 0);
  async function need(a, b) {   // [a, b) がまだ読めていなければ、a から読み足す
    b = Math.min(size, b);
    if (a >= lo && b <= hi) return;
    var e = Math.min(size, Math.max(b, a + TAG_SPARSE_CHUNK));
    buf.set(await _readBytes(file, a, e), a);
    lo = a; hi = e;
  }
  var pos = 10;
  if (flags & 0x40) {   // 拡張ヘッダー
    await need(10, 14);
    pos += ver === 3 ? 4 + _u32be(buf, 10) : _syncsafe(buf, 10);
  }
  while (pos + 10 <= size) {
    await need(pos, pos + 10);
    if (buf[pos] === 0) break;
    var id = _ascii(buf, pos, 4);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    var fsz = ver === 4 ? _syncsafe(buf, pos + 4) : _u32be(buf, pos + 4);
    var end = pos + 10 + fsz;
    if (fsz <= 0 || end > size) break;
    if (id !== 'APIC') await need(pos + 10, end);   // 画像以外の中身は読む
    pos = end;
  }
  return buf;
}
var _MP3_BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
var _MP3_BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
var _MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
// getHasV1：末尾に ID3v1 があるか（固定ビットレートで計算するときだけ調べる）。first：先頭をまとめて読んだもの
async function _mp3Duration(file, audioStart, getHasV1, first) {
  var end = Math.min(file.size, audioStart + 65536);
  var buf = (first && end <= first.length) ? first.subarray(audioStart, end) : await _readBytes(file, audioStart, audioStart + 65536);
  for (var i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] !== 0xFF || (buf[i + 1] & 0xE0) !== 0xE0) continue;
    var ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3;
    var bri = buf[i + 2] >> 4, sri = (buf[i + 2] >> 2) & 3, mono = (buf[i + 3] >> 6) === 3;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) continue;   // Layer III 以外・不正な値は飛ばす
    var rate = _MP3_SR[ver][sri];
    var kbps = (ver === 3 ? _MP3_BR1 : _MP3_BR2)[bri];
    var spf = ver === 3 ? 1152 : 576;
    var side = ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    var x = i + 4 + side;
    var tag = _ascii(buf, x, 4);
    if ((tag === 'Xing' || tag === 'Info') && x + 12 <= buf.length) {
      if (_u32be(buf, x + 4) & 1) { var frames = _u32be(buf, x + 8); if (frames > 0) return frames * spf / rate; }
    }
    if (_ascii(buf, i + 36, 4) === 'VBRI' && i + 54 <= buf.length) {
      var vf = _u32be(buf, i + 50);
      if (vf > 0) return vf * spf / rate;
    }
    var bytes = file.size - (audioStart + i) - ((await getHasV1()) ? 128 : 0);
    return bytes > 0 ? bytes * 8 / (kbps * 1000) : 0;
  }
  return 0;
}

/* ---------- Vorbis comment（flac / ogg / opus） ---------- */
function _parseVorbisComment(b, pos, out) {
  if (pos + 4 > b.length) return;
  var vlen = _u32le(b, pos); pos += 4 + vlen;
  if (pos + 4 > b.length) return;
  var n = _u32le(b, pos); pos += 4;
  for (var i = 0; i < n && pos + 4 <= b.length; i++) {
    var len = _u32le(b, pos); pos += 4;
    if (pos + len > b.length) break;
    var key0 = _ascii(b, pos, Math.min(len, 32)).toUpperCase();
    if (key0.indexOf('METADATA_BLOCK_PICTURE=') === 0 || key0.indexOf('COVERART=') === 0) {
      // ジャケット画像（base64）。画像を探すときだけ読む
      if (out.wantPicture) {
        var isBlock = key0.charAt(0) === 'M';
        var raw = _base64ToBytes(_ascii(b, pos + (isBlock ? 23 : 9), len - (isBlock ? 23 : 9)));
        if (raw) { if (isBlock) _parseFlacPicture(raw, out); else _offerPicture(out, 3, '', raw); }
      }
    } else if (len < 256 * 1024) {   // ほかの大きい項目は読まない
      var s = _decodeUtf8(b.subarray(pos, pos + len));
      var eq = s.indexOf('=');
      if (eq > 0) {
        var key = s.slice(0, eq).toUpperCase(), val = _cleanText(s.slice(eq + 1));
        if (key === 'TITLE' && !out.title) out.title = val;
        else if (key === 'ARTIST' && !out.artist) out.artist = val;
        else if (key === 'ALBUM' && !out.album) out.album = val;
        else if ((key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') && !out.albumArtist) out.albumArtist = val;
        else if ((key === 'BPM' || key === 'TEMPO') && !out.bpm) out.bpm = parseFloat(val) || 0;   // BPM（v7.8）
        else if (key === 'COMPILATION' && /^\s*1/.test(val)) out.compilation = true;   // コンピレーションの印（v2.9）
        else if (key === 'GENRE' && !out.genre) out.genre = _genreName(val);            // ジャンル（v3.1）
        else if ((key === 'DATE' || key === 'YEAR') && (!out.year || out._yearOrig)) { var y2 = _yearOf(val); if (y2) { out.year = y2; out._yearOrig = false; } }   // 発売年（v3.1）
        else if (key === 'ORIGINALDATE' && !out.year) { out.year = _yearOf(val); out._yearOrig = !!out.year; }
        else if ((key === 'TRACKNUMBER' || key === 'TRACK') && !out.track) out.track = _parseTrackNo(val);
        else if ((key === 'DISCNUMBER' || key === 'DISC') && !out.disc) out.disc = _parseTrackNo(val);
        else if ((key === 'LYRICS' || key === 'UNSYNCEDLYRICS') && out.wantLyrics && !out.lyrics) out.lyrics = s.slice(eq + 1).replace(/\r\n?/g, '\n').trim();
      }
    }
    pos += len;
  }
}

/* ---------- FLAC ---------- */
async function _readFlac(file, out) {
  var pos = 0;
  var head = await _readBytes(file, 0, 10);
  if (_ascii(head, 0, 3) === 'ID3') {       // 先頭に ID3 が付いている FLAC もある
    pos = 10 + _syncsafe(head, 6);
    _parseId3v2(await _readBytes(file, 0, Math.min(pos, 4 * 1024 * 1024)), out);
  }
  var sig = await _readBytes(file, pos, pos + 4);
  if (_ascii(sig, 0, 4) !== 'fLaC') return;
  pos += 4;
  for (var guard = 0; guard < 128 && pos + 4 <= file.size; guard++) {
    var h = await _readBytes(file, pos, pos + 4);
    var last = (h[0] & 0x80) !== 0, type = h[0] & 0x7f, len = _u24be(h, 1);
    var start = pos + 4;
    if (type === 0 && len >= 18) {           // STREAMINFO：長さ
      var si = await _readBytes(file, start, start + 18);
      var rate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
      var total = (si[13] & 0x0f) * 4294967296 + _u32be(si, 14);
      if (rate > 0 && total > 0) out.duration = total / rate;
    } else if (type === 4) {                 // VORBIS_COMMENT：曲名など
      _parseVorbisComment(await _readBytes(file, start, start + Math.min(len, ((out.wantPicture || out.wantLyrics) ? 16 : 4) * 1024 * 1024)), 0, out);
    } else if (type === 6 && out.wantPicture && len < 16 * 1024 * 1024) {   // PICTURE：ジャケット画像
      _parseFlacPicture(await _readBytes(file, start, start + len), out);
    }
    pos = start + len;
    if (last) break;
  }
}

/* ---------- OGG（Vorbis / Opus） ---------- */
// ページをつなぎ合わせて、先頭から maxPackets 個のパケットを取り出す
function _oggPackets(buf, maxPackets) {
  var packets = [], cur = [], curLen = 0, pos = 0;
  while (pos + 27 <= buf.length && packets.length < maxPackets) {
    if (_ascii(buf, pos, 4) !== 'OggS') break;
    var nseg = buf[pos + 26], segStart = pos + 27, dataPos = segStart + nseg;
    if (dataPos > buf.length) break;
    for (var s = 0; s < nseg; s++) {
      var len = buf[segStart + s];
      var chunk = buf.subarray(dataPos, Math.min(dataPos + len, buf.length));
      cur.push(chunk); curLen += chunk.length; dataPos += len;
      if (len < 255) {
        packets.push(_concatBytes(cur, curLen)); cur = []; curLen = 0;
        if (packets.length >= maxPackets) break;
      }
    }
    pos = dataPos;
  }
  if (packets.length < maxPackets && curLen) packets.push(_concatBytes(cur, curLen));   // 途中まででも使う
  return packets;
}
async function _readOgg(file, out) {
  // ジャケット画像を探すときは、画像が入る大きなコメントも読めるように多めに読む
  var buf = await _readBytes(file, 0, Math.min(file.size, ((out.wantPicture || out.wantLyrics) ? 16 : 1) * 1024 * 1024));
  var packets = _oggPackets(buf, 2);
  var rate = 0, preskip = 0;
  var p0 = packets[0], p1 = packets[1];
  if (p0) {
    if (p0[0] === 1 && _ascii(p0, 1, 6) === 'vorbis' && p0.length >= 16) rate = _u32le(p0, 12);
    else if (_ascii(p0, 0, 8) === 'OpusHead' && p0.length >= 12) { rate = 48000; preskip = p0[10] | (p0[11] << 8); }
  }
  if (p1) {
    if (p1[0] === 3 && _ascii(p1, 1, 6) === 'vorbis') _parseVorbisComment(p1, 7, out);
    else if (_ascii(p1, 0, 8) === 'OpusTags') _parseVorbisComment(p1, 8, out);
  }
  if (rate > 0) {   // 長さ：最後のページの granule position ÷ サンプリング周波数
    var tail = await _readBytes(file, Math.max(0, file.size - 65536), file.size);
    for (var i = tail.length - 27; i >= 0; i--) {
      if (tail[i] === 0x4f && tail[i + 1] === 0x67 && tail[i + 2] === 0x67 && tail[i + 3] === 0x53) {
        var hi = _u32le(tail, i + 10), lo = _u32le(tail, i + 6);
        if (hi === 0xFFFFFFFF && lo === 0xFFFFFFFF) continue;   // このページでは決まっていない
        var g = hi * 4294967296 + lo;
        if (g > preskip) { out.duration = (g - preskip) / rate; break; }
      }
    }
  }
}

/* ---------- WAV ---------- */
function _parseRiffInfo(l, out) {
  var p = 4;
  while (p + 8 <= l.length) {
    var id = _ascii(l, p, 4), size = _u32le(l, p + 4);
    var text = _cleanText(_decodeLegacy(_trimNullBytes(l.subarray(p + 8, Math.min(l.length, p + 8 + size)))));
    if (id === 'INAM' && !out.title) out.title = text;
    else if (id === 'IART' && !out.artist) out.artist = text;
    else if (id === 'IPRD' && !out.album) out.album = text;
    else if ((id === 'ITRK' || id === 'IPRT') && !out.track) out.track = _parseTrackNo(text);
    p += 8 + size + (size & 1);
  }
}
async function _readWav(file, out) {
  var h = await _readBytes(file, 0, 12);
  if (_ascii(h, 0, 4) !== 'RIFF' || _ascii(h, 8, 4) !== 'WAVE') return;
  var pos = 12, byteRate = 0, dataSize = 0;
  for (var guard = 0; guard < 200 && pos + 8 <= file.size; guard++) {
    var ch = await _readBytes(file, pos, pos + 8);
    var id = _ascii(ch, 0, 4), size = _u32le(ch, 4), start = pos + 8;
    if (id === 'fmt ') {
      var f = await _readBytes(file, start, start + 16);
      if (f.length >= 12) byteRate = _u32le(f, 8);
    } else if (id === 'data') {
      dataSize = Math.min(size, file.size - start);
    } else if (id === 'LIST' && size < 1024 * 1024) {
      var l = await _readBytes(file, start, start + size);
      if (_ascii(l, 0, 4) === 'INFO') _parseRiffInfo(l, out);
    } else if ((id === 'id3 ' || id === 'ID3 ') && size < 16 * 1024 * 1024) {
      _parseId3v2(await _readBytes(file, start, start + size), out);
    }
    pos = start + size + (size & 1);
  }
  if (byteRate > 0 && dataSize > 0) out.duration = dataSize / byteRate;
}

/* ---------- MP4 / M4A ---------- */
function _mp4Boxes(b, start, end) {
  var list = [], p = start;
  while (p + 8 <= end) {
    var size = _u32be(b, p), type = _ascii(b, p + 4, 4), hdr = 8;
    if (size === 1) { if (p + 16 > end) break; size = _u32be(b, p + 8) * 4294967296 + _u32be(b, p + 12); hdr = 16; }
    else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    list.push({ type: type, start: p + hdr, end: p + size });
    p += size;
  }
  return list;
}
function _mp4Find(b, start, end, type) {
  var l = _mp4Boxes(b, start, end);
  for (var i = 0; i < l.length; i++) if (l[i].type === type) return l[i];
  return null;
}
var _MP4_FIELDS = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', 'aART': 'albumArtist' };
async function _readMp4(file, out) {
  var pos = 0, moov = null;
  var first = await _readBytes(file, 0, TAG_HEAD_CHUNK);   // 先頭をまとめて読む（moov が先頭にあれば、これ1回で済む。v2.7）
  for (var guard = 0; guard < 500 && pos + 8 <= file.size; guard++) {   // 一番外側の箱をたどって moov を探す
    var h = pos + 16 <= first.length ? first.subarray(pos, pos + 16) : await _readBytes(file, pos, pos + 16);
    var size = _u32be(h, 0), type = _ascii(h, 4, 4), hdr = 8;
    if (size === 1) { size = _u32be(h, 8) * 4294967296 + _u32be(h, 12); hdr = 16; }
    else if (size === 0) size = file.size - pos;
    if (size < hdr) break;
    if (type === 'moov') {
      if (size > 64 * 1024 * 1024) return;
      moov = (pos + size <= first.length) ? first.subarray(pos + hdr, pos + size)
        : (!out.wantPicture && !out.wantLyrics && size > TAG_SPARSE_MIN)
          ? await _readMoovSparse(file, pos + hdr, size - hdr)
          : await _readBytes(file, pos + hdr, pos + size);
      break;
    }
    pos += size;
  }
  if (!moov) return;
  var mvhd = _mp4Find(moov, 0, moov.length, 'mvhd');
  if (mvhd) {
    var s = mvhd.start, ts, dur;
    if (moov[s] === 1) { ts = _u32be(moov, s + 20); dur = _u32be(moov, s + 24) * 4294967296 + _u32be(moov, s + 28); }
    else { ts = _u32be(moov, s + 12); dur = _u32be(moov, s + 16); }
    if (ts > 0 && dur > 0) out.duration = dur / ts;
  }
  var udta = _mp4Find(moov, 0, moov.length, 'udta');
  if (!udta) return;
  var meta = _mp4Find(moov, udta.start, udta.end, 'meta');
  if (!meta) return;
  // meta は通常「バージョン＋フラグ（4バイト）」付き。QuickTime 形式では付かないことがある
  var cs = (_ascii(moov, meta.start + 4, 4) === 'hdlr') ? meta.start : meta.start + 4;
  var ilst = _mp4Find(moov, cs, meta.end, 'ilst');
  if (!ilst) return;
  _mp4Boxes(moov, ilst.start, ilst.end).forEach(function (it) {
    if (it.type === 'covr') {   // ジャケット画像（data の種類 13=JPEG、14=PNG）
      if (!out.wantPicture) return;
      var d = _mp4Find(moov, it.start, it.end, 'data');
      if (d && d.end - d.start > 8) _offerPicture(out, 3, '', moov.subarray(d.start + 8, d.end));
      return;
    }
    if (it.type === '\u00a9lyr') {   // 歌詞
      if (!out.wantLyrics || out.lyrics) return;
      var ld = _mp4Find(moov, it.start, it.end, 'data');
      if (ld && ld.end - ld.start > 8) out.lyrics = _decodeUtf8(moov.subarray(ld.start + 8, ld.end)).replace(/\r\n?/g, '\n').trim();
      return;
    }
    if (it.type === '©gen' || it.type === '©day' || it.type === 'gnre') {   // ジャンル・発売年（v3.1）
      var gd = _mp4Find(moov, it.start, it.end, 'data');
      if (!gd || gd.end - gd.start <= 8) return;
      if (it.type === 'gnre') { var gi = (moov[gd.start + 8] << 8) | moov[gd.start + 9]; if (!out.genre && gi > 0) out.genre = ID3V1_GENRES[gi - 1] || ''; }
      else {
        var gv = _cleanText(_decodeUtf8(moov.subarray(gd.start + 8, gd.end)));
        if (it.type === '©gen' && !out.genre) out.genre = _genreName(gv);
        if (it.type === '©day' && !out.year) out.year = _yearOf(gv);
      }
      return;
    }
    if (it.type === 'tmpo') {   // BPM（2バイトの数。v7.8）
      var bd = _mp4Find(moov, it.start, it.end, 'data');
      if (bd && bd.end - bd.start >= 10 && !out.bpm) out.bpm = (moov[bd.start + 8] << 8) | moov[bd.start + 9];
      return;
    }
    if (it.type === 'cpil') {   // コンピレーションの印（1バイト。v2.9）
      var cd = _mp4Find(moov, it.start, it.end, 'data');
      if (cd && cd.end - cd.start > 8 && moov[cd.start + 8] === 1) out.compilation = true;
      return;
    }
    if (it.type === 'trkn' || it.type === 'disk') {   // トラック番号・ディスク番号（2バイトの数）
      var nd = _mp4Find(moov, it.start, it.end, 'data');
      if (nd && nd.end - nd.start >= 12) {
        var num = (moov[nd.start + 10] << 8) | moov[nd.start + 11];
        if (num > 0) { if (it.type === 'trkn' && !out.track) out.track = num; if (it.type === 'disk' && !out.disc) out.disc = num; }
      }
      return;
    }
    var f = _MP4_FIELDS[it.type];
    if (!f || out[f]) return;
    var data = _mp4Find(moov, it.start, it.end, 'data');
    if (!data || data.end - data.start < 8) return;
    var typeInd = _u32be(moov, data.start) & 0xffffff;
    var val = moov.subarray(data.start + 8, data.end);
    out[f] = _cleanText(typeInd === 2 ? _decodeUtf16(val, true) : _decodeUtf8(val));
  });
}

// moov の中身を、曲情報に必要な箱（mvhd・udta/meta/ilst の文字）だけ読む。trak（曲データの目次）と covr（画像）は読まずに 0 のまま（v2.5）
async function _readMoovSparse(file, base, len) {
  var buf = new Uint8Array(len), lo = 0, hi = 0;
  async function fill(a, b) {   // [a, b) がまだ読めていなければ、a から 64KB ほどまとめて読む
    b = Math.min(len, b);
    if (b <= a || (a >= lo && b <= hi)) return;
    var e = Math.min(len, Math.max(b, a + TAG_SPARSE_CHUNK));
    buf.set(await _readBytes(file, base + a, base + e), a);
    lo = a; hi = e;
  }
  async function walk(a, b) {
    var p = a;
    for (var guard = 0; guard < 2000 && p + 8 <= b; guard++) {
      await fill(p, p + 16);
      var sz = _u32be(buf, p), ty = _ascii(buf, p + 4, 4), h = 8;
      if (sz === 1) { sz = _u32be(buf, p + 8) * 4294967296 + _u32be(buf, p + 12); h = 16; }
      else if (sz === 0) sz = b - p;
      if (sz < h || p + sz > b) break;
      if (ty === 'udta' || ty === 'ilst') await walk(p + h, p + sz);
      else if (ty === 'meta') {
        await fill(p + h, p + h + 12);
        await walk(p + h + (_ascii(buf, p + h + 4, 4) === 'hdlr' ? 0 : 4), p + sz);
      }
      else if (ty !== 'trak' && ty !== 'covr') await fill(p + h, p + sz);
      p += sz;
    }
  }
  await walk(0, len);
  return buf;
}

/* ---------- 入口 ---------- */
// File を受け取り { title, artist, album, duration(秒) } を返す。読めなかった項目は空
async function _readAnyTags(file, out) {
  var ext = extOf(file.name);
  if (ext === 'mp3' || ext === 'aac') await _readMp3(file, out);
  else if (ext === 'm4a' || ext === 'm4b' || ext === 'mp4') await _readMp4(file, out);
  else if (ext === 'flac') await _readFlac(file, out);
  else if (ext === 'ogg' || ext === 'oga' || ext === 'opus') await _readOgg(file, out);
  else if (ext === 'wav') await _readWav(file, out);
}
// 埋め込まれたジャケット画像を取り出す。{ type, mime, bytes } を返す（無ければ null）
async function readTrackPicture(file) {
  var out = { title: '', artist: '', album: '', albumArtist: '', duration: 0, wantPicture: true, picture: null };
  try { await _readAnyTags(file, out); }
  catch (e) { console.warn('ジャケット画像の読み取りに失敗:', file.name, e); }
  return out.picture;
}
// タグの BPM（v7.8。mp3 TBPM・m4a tmpo・flac/ogg BPM）。無ければ 0
async function readTrackBpm(file) {
  var out = { title: '', artist: '', album: '', albumArtist: '', duration: 0, bpm: 0 };
  try { await _readAnyTags(file, out); } catch (e) { /* 読めない */ }
  return out.bpm > 0 && out.bpm < 400 ? Math.round(out.bpm * 10) / 10 : 0;
}
// 埋め込まれた歌詞を取り出す。{ text, synced:[{time,text}] または null, kind } を返す（無ければ null）
async function readTrackLyrics(file) {
  var out = { title: '', artist: '', album: '', albumArtist: '', duration: 0, wantLyrics: true, lyrics: '', syncedLyrics: null };
  try { await _readAnyTags(file, out); }
  catch (e) { console.warn('歌詞の読み取りに失敗:', file.name, e); }
  if (out.syncedLyrics && out.syncedLyrics.length) {
    return { text: out.syncedLyrics.map(function (l) { return l.text; }).join('\n'), synced: out.syncedLyrics, kind: 'SYLT' };
  }
  if (out.lyrics) return { text: out.lyrics, synced: null, kind: '' };
  return null;
}
async function readTrackTags(file) {
  var out = { title: '', artist: '', album: '', albumArtist: '', track: 0, disc: 0, duration: 0, compilation: false, genre: '', year: 0 };
  try { await _readAnyTags(file, out); }
  catch (e) {
    console.warn('曲情報の読み取りに失敗:', file.name, e);
  }
  if (!out.artist && out.albumArtist) out.artist = out.albumArtist;
  if (!isFinite(out.duration) || out.duration < 0) out.duration = 0;
  return out;
}
