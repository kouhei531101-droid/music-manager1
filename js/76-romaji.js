/* =========================================================
   64-romaji.js ― ローマ字での検索（v8.7.11）
   ・かな（カタカナ・ひらがな）をローマ字（ヘボン式）にする romajiOf(text)
   ・ローマ字の書き方の揺れをそろえる romajiCanon(s)：入力した言葉と、名前をローマ字にしたものの両方にかけて比べる
       大文字小文字・空白・記号（- ' . など）は無視／shi=si・chi=ti・tsu=tu・fu=hu・ji=zi・sha=sya・cha=tya・ja=zya=jya／
       di・ji=zi（ぢ）・du・dzu=zu（づ）／wo=o・wi=ui・we=ue（ウィ）／ん＝n・nn・n'、b・p・m の前の m（champon）＝n／
       促音（っ）の子音の重ね（kk・tt・cch・tch）は1つに（gattsu=gatsu）／長音（ー）や母音の重ね（aa・ii・uu・ee・oo・ou）は1つに（raamen=ramen=ra-men）
     そろえ方は「同じ形に寄せて比べる」なので、どちらの書き方で入れても同じ所が見つかる（そのぶん少し広めに見つかることがある）
   ・漢字はローマ字にできない（読みが分からない）ので、ローマ字では見つからない。その所は「#」にして、前後の文字がつながって見つからないようにする
     （ソートキーにかなで読みを入れておけば、そのローマ字で見つかる。14-albums.js の検索がソートキーも見る）
   ・romajiSearchKey(text)：romajiCanon(romajiOf(text)) を文字ごとに1回だけ計算して覚えておく（数千枚でも検索のたびに変換しない）
   ・isRomajiQuery(w)：ローマ字として比べる言葉か（半角の英字を含み、英数字と - ' . だけ）
   ・kanaFold(s)：ひらがなをカタカナにそろえる（「まぐま」で「マグマ」も見つかるように）
   ・ほかのファイルには頼らない（スマホ版にそのまま写せる）
   ========================================================= */

var ROMAJI_TABLE = (function () {
  var t = {
    'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
    'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko', 'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
    'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so', 'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
    'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to', 'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
    'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
    'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho', 'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
    'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
    'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo', 'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
    'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro', 'ワ': 'wa', 'ヰ': 'i', 'ヱ': 'e', 'ヲ': 'wo', 'ン': 'n',
    'ヴ': 'vu', 'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o', 'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo', 'ヮ': 'wa', 'ヵ': 'ka', 'ヶ': 'ke'
  };
  // 拗音（キャ など）：子音＋ャュョ
  var yo = { 'キ': 'ky', 'ギ': 'gy', 'シ': 'sh', 'ジ': 'j', 'チ': 'ch', 'ヂ': 'j', 'ニ': 'ny', 'ヒ': 'hy', 'ビ': 'by', 'ピ': 'py', 'ミ': 'my', 'リ': 'ry' };
  Object.keys(yo).forEach(function (k) { t[k + 'ャ'] = yo[k] + 'a'; t[k + 'ュ'] = yo[k] + 'u'; t[k + 'ョ'] = yo[k] + 'o'; });
  // 外来語の組み合わせ（ファ・ティ・ウィ・ヴァ・シェ など）
  Object.assign(t, {
    'ファ': 'fa', 'フィ': 'fi', 'フェ': 'fe', 'フォ': 'fo', 'フュ': 'fyu', 'ティ': 'ti', 'トゥ': 'tu', 'ディ': 'di', 'ドゥ': 'du', 'デュ': 'dyu', 'テュ': 'tyu',
    'ウィ': 'wi', 'ウェ': 'we', 'ウォ': 'wo', 'ヴァ': 'va', 'ヴィ': 'vi', 'ヴェ': 've', 'ヴォ': 'vo', 'ヴュ': 'vyu',
    'シェ': 'she', 'ジェ': 'je', 'チェ': 'che', 'ツァ': 'tsa', 'ツィ': 'tsi', 'ツェ': 'tse', 'ツォ': 'tso', 'イェ': 'ye',
    'クァ': 'kwa', 'クィ': 'kwi', 'クェ': 'kwe', 'クォ': 'kwo', 'グァ': 'gwa', 'スィ': 'si', 'ズィ': 'zi'
  });
  return t;
})();

// ひらがな → カタカナ（ゔ も ヴ に）
function kanaFold(s) {
  return String(s || '').replace(/[ぁ-ゖゝゞ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
}

// かな → ローマ字（ヘボン式）。英数字はそのまま小文字に。かな・英数字でない文字（漢字など）は「#」
function romajiOf(text) {
  var s = kanaFold(String(text || '').normalize('NFKC')), out = '', i = 0, n = s.length, last = '', pendingTsu = false;
  var vowelOf = function (r) { var m = r.match(/[aiueo](?!.*[aiueo])/); return m ? m[0] : ''; };
  while (i < n) {
    var c = s.charAt(i), two = s.substr(i, 2), r = null, step = 1;
    if (ROMAJI_TABLE[two] !== undefined && two.length === 2) { r = ROMAJI_TABLE[two]; step = 2; }
    else if (ROMAJI_TABLE[c] !== undefined) r = ROMAJI_TABLE[c];
    if (c === 'ッ') { pendingTsu = true; i++; continue; }   // 促音：次の子音を重ねる
    if (c === 'ー' || c === '〜' || c === '～') { var v = vowelOf(last); if (v) { out += v; last = v; } i++; continue; }   // 長音：前の母音をもう1つ
    if (r !== null) {
      if (pendingTsu) out += r.indexOf('ch') === 0 ? 't' : (/^[bcdfghjkmpqrstvwxyz]/.test(r) ? r.charAt(0) : '');
      out += r; last = r;
    } else if (/[0-9a-zA-Z]/.test(c)) {
      if (pendingTsu) out += '';
      out += c.toLowerCase(); last = c.toLowerCase();
    } else if (/\s/.test(c) || /[!-\/:-@\[-`{-~・、。「」『』（）！？＆・＿]/.test(c)) {
      out += ' '; last = '';
    } else {
      out += '#'; last = '';   // 漢字など（ローマ字にできない）
    }
    pendingTsu = false;
    i += step;
  }
  return out;
}

// ローマ字の揺れをそろえる（入力した言葉にも、名前のローマ字にも同じようにかける）
function romajiCanon(s) {
  s = String(s || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9#]/g, '');
  s = s.replace(/tch/g, 'ch')                                   // matchi → machi（ッチ）
       .replace(/([bcdfghjklmpqrstvwxyz])\1+/g, '$1')            // 促音の重ね・nn を1つに
       .replace(/shi/g, 'si').replace(/sh/g, 'sy')
       .replace(/chi/g, 'ti').replace(/ch/g, 'ty').replace(/cy/g, 'ty')
       .replace(/tsu/g, 'tu').replace(/dzu/g, 'zu').replace(/du/g, 'zu')
       .replace(/fu/g, 'hu')
       .replace(/ji/g, 'zi').replace(/di/g, 'zi').replace(/jy/g, 'zy').replace(/j/g, 'zy')
       .replace(/wo/g, 'o').replace(/wi/g, 'ui').replace(/we/g, 'ue')
       .replace(/m(?=[bpm])/g, 'n')                              // champon → chanpon
       .replace(/([bcdfghjklmpqrstvwxyz])\1+/g, '$1')            // 置き換えでできた重ね（zyy など）
       .replace(/ou/g, 'o')                                      // おう（長音）
       .replace(/([aiueo])\1+/g, '$1');                          // 長音・母音の重ね
  return s;
}

// 名前（1つの文字）→ 比べるためのローマ字（1回だけ計算して覚える）
var _romajiMemo = new Map();
function romajiSearchKey(text) {
  text = String(text || '');
  var v = _romajiMemo.get(text);
  if (v === undefined) {
    // 単語ごとにそろえて「 」でつなぐ（単語の境目をまたいで見つからないように、ただし言葉が単語をまたぐときのため全体をつないだものも足す）
    var r = romajiOf(text), words = r.split(/\s+/).filter(Boolean).map(romajiCanon);
    v = words.join(' ') + ' ' + romajiCanon(r.replace(/\s+/g, ''));
    if (_romajiMemo.size > 50000) _romajiMemo.clear();   // 大きくなりすぎたら作り直す
    _romajiMemo.set(text, v);
  }
  return v;
}
// ローマ字として比べる言葉か（半角英字を含み、英数字と - ' . だけ）
function isRomajiQuery(w) { return /[a-z]/i.test(w) && /^[a-z0-9'\-.]+$/i.test(w); }
// 言葉 w が、名前のローマ字 key（romajiSearchKey の結果）に入っているか
function romajiMatch(w, key) { var c = romajiCanon(w); return !!c && key.indexOf(c) >= 0; }
