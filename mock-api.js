/* デモ用のブラウザ内バックエンド
 * 本来のアプリは Flask + MySQL で動きますが、このデモでは同じ /api/... の呼び出しを
 * ブラウザの中で処理します（サーバー・データベース不要）。
 * データは localStorage に保存され、各自のブラウザの中だけで完結します。 */
(function () {
  'use strict';
  const KEY = 'itam_demo_v1', SESSION = 'itam_demo_session';
  const KEEP = '利用可能';
  const COLORS = ['ng', 'org', 'warn', 'lime', 'ok', 'teal', 'sky', 'acc', 'vio', 'pink', 'brn', 'idle', 'sub'];
  const LEGACY = { '保管中': '利用可能', '使用中': '貸し出し中', '貸出中': '貸し出し中' };
  const MSG_MAX = 1000, DELETED_TEXT = '（削除されたメッセージ）';

  class Resp { constructor(status, json) { this.status = status; this.json = json; } }
  const R = (status, json) => new Resp(status, json);
  class Reject extends Error { constructor(msg, code = 400) { super(msg); this.msg = msg; this.code = code; } }

  /* ---------- 日付ユーティリティ ---------- */
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const ts = d => `${ymd(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const nowTs = () => ts(new Date());
  const today = () => ymd(new Date());
  const daysAgo = (n, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d; };
  const fmtDate = s => s ? String(s).slice(0, 10).replace(/-/g, '/') : '';
  const fmtDt = s => s ? String(s).slice(0, 16).replace(/-/g, '/') : '';

  const norm = s => String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '');
  const lowerKey = s => norm(s).toLowerCase();
  const nfkc = s => String(s == null ? '' : s).normalize('NFKC').trim();
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- 初期データ（すべて架空） ---------- */
  function seed() {
    const db = { seq: {}, staff: [], statuses: [], assets: [], usage: [], log: [], admins: [], sims: [], models: [],
      messages: [], groups: [], members: [], chatmsgs: [], chatread: [], rooms: [], roomread: [], pins: {} };
    const id = k => (db.seq[k] = (db.seq[k] || 0) + 1);
    db.seq = {};

    // 状態
    [['利用可能', 1, 0, 'ok', 1, 0], ['貸し出し中', 0, 1, 'vio', 2, 0], ['修理中', 0, 0, 'acc', 3, 0],
     ['要確認', 0, 0, 'warn', 4, 0], ['紛失', 0, 0, 'ng', 5, 1], ['廃棄済み', 0, 0, 'sub', 6, 0]]
      .forEach(([n, free, need, color, ord, hl]) => db.statuses.push({
        id: id('status'), status_name: n, is_free: free, needs_user: need, color, display_order: ord,
        is_active: 1, highlight: hl, sim_highlight: hl, deleted_at: null }));
    const stId = n => db.statuses.find(s => s.status_name === n).id;

    // 社員
    [['1001', '佐藤 美咲', 'sato', '2018-04-01', null], ['1002', '鈴木 健太', 'suzuki', '2016-04-01', null],
     ['1003', '高橋 優子', 'takahashi', '2019-04-01', null], ['1004', '田中 大輔', 'tanaka', '2020-04-01', null],
     ['1005', '伊藤 彩', 'ito', '2021-04-01', null], ['1006', '渡辺 翔', 'watanabe', '2021-10-01', null],
     ['1007', '山本 里奈', 'yamamoto', '2022-04-01', null], ['1008', '中村 拓也', 'nakamura', '2022-04-01', null],
     ['1009', '小林 結衣', 'kobayashi', '2023-04-01', null], ['1010', '加藤 誠', 'kato', '2023-10-01', null],
     ['1011', '吉田 恵', 'yoshida', '2024-04-01', null], ['1012', '山口 蓮', 'yamaguchi', '2019-04-01', '2025-03-31']]
      .forEach(([code, name, mail, jd, rd]) => db.staff.push({
        id: id('staff'), shain_code: code, name, email: `${mail}@example.com`, join_date: jd, retired_date: rd,
        on_leave: 0, deleted_at: null }));
    db.staff.find(s => s.shain_code === '1010').on_leave = 1;
    db.admins = [{ shain_code: '1001', deleted_at: null }, { shain_code: '1002', deleted_at: null }];
    const sid = code => db.staff.find(s => s.shain_code === code);

    // SIM
    const iccid = n => '8981100000000' + String(10000 + n).padStart(6, '0');
    for (let i = 1; i <= 8; i++) db.sims.push({
      id: id('sim'), iccid: iccid(i), ip_phone: `050-0000-${String(1000 + i)}`, memo: i === 8 ? '予備' : '',
      status_id: null, deleted_at: null });
    db.sims[6].status_id = stId('紛失');

    // 機器: [種別, メーカー, 機種名, シリアル, 状態, 利用者コード, info, メモ]
    const pc = (n, os, buy) => [['OS', os], ['ホスト名', 'PC-' + String(n).padStart(3, '0')], ['購入日', buy]];
    const ph = (os, tel, sim) => [['OS', os], ['電話番号', tel], ...(sim ? [['SIM番号', sim]] : [])];
    const A = [
      ['事務ノート', 'Dell', 'Latitude 5440', 'DL5440-0001', '貸し出し中', '1003', pc(1, 'Windows 11 Pro', '2024/04/01'), ''],
      ['事務ノート', 'Dell', 'Latitude 5440', 'DL5440-0002', '貸し出し中', '1004', pc(2, 'Windows 11 Pro', '2024/04/01'), ''],
      ['事務ノート', 'Dell', 'Latitude 5440', 'DL5440-0003', '利用可能', null, pc(3, 'Windows 11 Pro', '2024/04/01'), '予備機'],
      ['事務ノート', 'Lenovo', 'ThinkPad X1 Carbon', 'LN-X1C-0101', '貸し出し中', '1005', pc(4, 'Windows 11 Pro', '2023/10/15'), ''],
      ['事務ノート', 'Lenovo', 'ThinkPad X1 Carbon', 'LN-X1C-0102', '修理中', null, pc(5, 'Windows 11 Pro', '2023/10/15'), 'キーボード交換待ち'],
      ['現場ノート', 'Lenovo', 'ThinkPad E14', 'LN-E14-0201', '貸し出し中', '1006', pc(6, 'Windows 11 Pro', '2022/06/20'), ''],
      ['事務ノート', 'HP', 'EliteBook 840 G9', 'HP-840-0301', '貸し出し中', '1007', pc(7, 'Windows 11 Pro', '2022/09/01'), ''],
      ['事務ノート', 'HP', 'EliteBook 840 G9', 'HP-840-0302', '要確認', null, pc(8, 'Windows 11 Pro', '2022/09/01'), 'バッテリーの膨張の疑い'],
      ['事務ノート', 'Apple', 'MacBook Pro 14', 'AP-MBP-0401', '貸し出し中', '1001', pc(9, 'macOS 15', '2024/01/10'), ''],
      ['事務ノート', 'Apple', 'MacBook Air 13', 'AP-MBA-0402', '貸し出し中', '1008', pc(10, 'macOS 15', '2024/05/22'), ''],
      ['事務ノート', 'Apple', 'MacBook Air 13', 'AP-MBA-0403', '利用可能', null, pc(11, 'macOS 15', '2024/05/22'), ''],
      ['現場ノート', 'Dell', 'Latitude 7420', 'DL7420-0501', '廃棄済み', null, pc(12, 'Windows 10 Pro', '2019/04/01'), '2025年3月に廃棄'],
      ['会社ケータイ', 'Apple', 'iPhone 15', 'AP-IP15-0601', '貸し出し中', '1002', ph('iOS 18', '090-0000-0001', iccid(1)), ''],
      ['会社ケータイ', 'Apple', 'iPhone 15', 'AP-IP15-0602', '貸し出し中', '1009', ph('iOS 18', '090-0000-0002', iccid(2)), ''],
      ['会社ケータイ', 'Apple', 'iPhone 14', 'AP-IP14-0603', '貸し出し中', '1003', ph('iOS 18', '090-0000-0003', iccid(3)), ''],
      ['会社ケータイ', 'Apple', 'iPhone 14', 'AP-IP14-0604', '利用可能', null, ph('iOS 17', '090-0000-0004', iccid(4)), ''],
      ['会社ケータイ', 'Google', 'Pixel 8', 'GG-PX8-0701', '貸し出し中', '1010', ph('Android 15', '090-0000-0005', iccid(5)), ''],
      ['会社ケータイ', 'Samsung', 'Galaxy S23', 'SS-S23-0702', '紛失', null, ph('Android 14', '090-0000-0006', iccid(7)), '出張先で紛失（届出済み）'],
      ['会社ケータイ', 'Samsung', 'Galaxy A54', 'SS-A54-0703', '利用可能', null, ph('Android 14', '090-0000-0007', null), ''],
      ['タブレット', 'Apple', 'iPad Air 11', 'AP-IPA-0801', '貸し出し中', '1011', [['OS', 'iPadOS 18'], ['購入日', '2024/06/01']], ''],
      ['タブレット', 'Apple', 'iPad 10th', 'AP-IPD-0802', '利用可能', null, [['OS', 'iPadOS 17'], ['購入日', '2023/03/01']], '会議室用'],
      ['モニター', 'Dell', 'U2723QE', 'DL-U27-0901', '貸し出し中', '1005', [['サイズ', '27インチ'], ['購入日', '2023/10/15']], ''],
      ['モニター', 'LG', '27UP850', 'LG-27U-0902', '利用可能', null, [['サイズ', '27インチ'], ['購入日', '2022/06/20']], ''],
      ['デスクトップ', 'Dell', 'OptiPlex 7010', 'DL-OP-1101', '貸し出し中', '1006', [['OS', 'Windows 11 Pro'], ['購入日', '2023/04/01']], ''],
      ['固定電話', 'Panasonic', 'VB-F411', 'PN-F411-1201', '貸し出し中', '1004', [['内線番号', '101']], ''],
      ['モバイルWiFi', 'NEC', 'Aterm MR10LN', 'NEC-MR-1301', '利用可能', null, [['SIM番号', iccid(6)]], '出張用'],
      ['周辺機器', 'Logitech', 'MX Keys', 'LG-MXK-1001', '利用可能', null, [['接続', 'Bluetooth']], '']
    ];
    A.forEach((a, i) => {
      const u = a[5] ? sid(a[5]) : null;
      const created = daysAgo(400 - i * 9, 9, 30);
      const aid = id('asset');
      const row = { id: aid, device_no: 'A' + String(aid).padStart(5, '0'), device_type: a[0], manufacturer: a[1],
        model_name: a[2], serial_no: a[3], info: a[6], status_id: stId(a[4]), user_id: u ? u.id : null,
        user_name: u ? u.name : null, memo: a[7] || null, created_at: ts(created), updated_at: null,
        updated_by_name: null, deleted_at: null, deleted_by_name: null };
      db.assets.push(row);
      db.log.push({ id: id('log'), asset_id: aid, action: '機器追加', status_name: KEEP, user_name: null,
        worker_name: '佐藤 美咲', worker_code: '1001', created_at: ts(created) });
      if (u) {
        const start = daysAgo(Math.max(5, 300 - i * 11), 11, 0);
        db.usage.push({ id: id('usage'), asset_id: aid, user_name: u.name, start_date: ymd(start), end_date: null, source: 'app' });
        db.log.push({ id: id('log'), asset_id: aid, action: '状態変更', status_name: a[4], user_name: u.name,
          worker_name: '鈴木 健太', worker_code: '1002', created_at: ts(start) });
        row.updated_at = ts(start); row.updated_by_name = '鈴木 健太';
      } else if (a[4] !== KEEP) {
        const t = daysAgo(20 + i, 15, 0);
        db.log.push({ id: id('log'), asset_id: aid, action: '状態変更', status_name: a[4], user_name: null,
          worker_name: '佐藤 美咲', worker_code: '1001', created_at: ts(t) });
        row.updated_at = ts(t); row.updated_by_name = '佐藤 美咲';
      }
    });
    // 過去の使用者の履歴を少し
    [[1, '山口 蓮', 700, 420], [2, '渡辺 翔', 500, 330], [4, '加藤 誠', 380, 250]].forEach(([aid, name, a, b]) =>
      db.usage.push({ id: id('usage'), asset_id: aid, user_name: name, start_date: ymd(daysAgo(a)), end_date: ymd(daysAgo(b)), source: 'app' }));

    // 機器マスタ
    [['事務ノート', 'Dell', 'Latitude 5440'], ['事務ノート', 'Lenovo', 'ThinkPad X1 Carbon'], ['事務ノート', 'HP', 'EliteBook 840 G9'],
     ['事務ノート', 'Apple', 'MacBook Air 13'], ['会社ケータイ', 'Apple', 'iPhone 15'], ['会社ケータイ', 'Google', 'Pixel 8'],
     ['タブレット', 'Apple', 'iPad Air 11'], ['モニター', 'Dell', 'U2723QE']]
      .forEach(([t, m, n]) => db.models.push({ id: id('model'), sheet_id: '', device_type: t, manufacturer: m, model_name: n, info: [] }));

    // メッセージ（デモ用の会話）
    const mk = (f, t, body, ago) => db.messages.push({ id: id('msg'), from_id: sid(f).id, to_id: sid(t).id, body,
      created_at: ts(daysAgo(0, 9, 0 + ago)), read_at: null, deleted_at: null });
    mk('1003', '1001', 'お疲れさまです。ノートPCの充電器が見当たらないので、予備を借りられますか？', 5);
    mk('1001', '1003', '予備の充電器を用意しておきます。明日取りに来てください。', 12);
    db.messages.forEach(m => { if (m.to_id === sid('1003').id) m.read_at = nowTs(); });
    const gid = id('group');
    db.groups.push({ id: gid, name: '機器管理チーム', created_by: sid('1001').id, created_at: ts(daysAgo(30)), updated_at: null, deleted_at: null });
    ['1001', '1002', '1004'].forEach(c => db.members.push({ group_id: gid, staff_id: sid(c).id, joined_at: ts(daysAgo(30)) }));
    db.chatmsgs.push({ id: id('cmsg'), group_id: gid, from_id: sid('1001').id, body: '来週、棚卸しをします。各自の機器の状態を確認してください。', created_at: ts(daysAgo(1, 10, 0)), edited_at: null, deleted_at: null });
    return db;
  }

  /* ---------- 保存 ---------- */
  let DB = null, memoryOnly = false;
  function load() {
    try { const t = localStorage.getItem(KEY); if (t) { DB = JSON.parse(t); return; } } catch (e) { memoryOnly = true; }
    DB = seed(); save();
  }
  function save() { if (memoryOnly) return; try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { memoryOnly = true; } }
  const nid = k => { DB.seq[k] = (DB.seq[k] || 0) + 1; return DB.seq[k]; };
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch (e) { return memSession; } }
  let memSession = null;
  function setSession(v) { memSession = v; try { v ? localStorage.setItem(SESSION, JSON.stringify(v)) : localStorage.removeItem(SESSION); } catch (e) {} }

  /* ---------- 共通の部品 ---------- */
  const alive = a => a.filter(x => !x.deleted_at);
  const statuses = () => alive(DB.statuses).sort((a, b) => a.display_order - b.display_order || a.id - b.id);
  const statusById = id => DB.statuses.find(s => s.id === id && !s.deleted_at);
  const keepStatus = () => statuses().find(s => s.status_name === KEEP);
  const isRetired = s => !!(s.retired_date && s.retired_date <= today());
  const isAdminCode = c => !!c && DB.admins.some(a => a.shain_code === c && !a.deleted_at);
  function staffOut(r) {
    const retired = isRetired(r);
    return { id: String(r.id), shain_code: r.shain_code || '', name: r.name, email: r.email || '',
      join_date: fmtDate(r.join_date), retired_date: fmtDate(r.retired_date), retired,
      on_leave: !!r.on_leave && !retired, is_admin: isAdminCode(r.shain_code) };
  }
  const staffList = () => alive(DB.staff).slice().sort((a, b) => String(a.shain_code || '').localeCompare(String(b.shain_code || '')) || a.id - b.id).map(staffOut);
  function findStaff(id, activeOnly) {
    const r = alive(DB.staff).find(s => String(s.id) === String(id));
    if (!r) return null;
    const o = staffOut(r);
    return activeOnly && o.retired ? null : o;
  }
  let SESS = null;
  const me = () => ({ id: SESS.sid, name: SESS.sname, code: SESS.scode });
  const myId = () => Number(SESS.sid);
  const isAdmin = () => { const s = SESS && findStaff(SESS.sid, true); return !!(s && s.is_admin); };
  const adminOnly = () => { if (!isAdmin()) throw new Reject('この操作は管理者だけができます', 403); };
  const sameUser = (aid, an, bid, bn) => (aid && bid) ? String(aid) === String(bid) : (!!an && norm(an) === norm(bn));
  const label = d => [d.manufacturer, d.model_name].filter(Boolean).join(' ') || '(機種不明)';
  const parseDate = s => {
    s = nfkc(s); if (!s) return null;
    const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
    const d = m && new Date(+m[1], +m[2] - 1, +m[3]);
    if (!m || d.getMonth() !== +m[2] - 1) throw new Reject(`日付「${s}」が正しくありません（例: 2024-04-01）`);
    return `${m[1]}-${p2(+m[2])}-${p2(+m[3])}`;
  };
  const dry = (errors, count) => ({ ok: !errors.length, errors: errors.slice(0, 20), more: Math.max(0, errors.length - 20), count });
  const checkLimit = rows => { if (!rows.length) throw new Reject('登録するデータがありません'); if (rows.length > 1000) throw new Reject('一度に登録できるのは1000件までです'); };
  const cleanBody = d => { const b = String(d.body || '').trim(); if (!b) throw new Reject('メッセージを入力してください'); if (b.length > MSG_MAX) throw new Reject(`メッセージは${MSG_MAX}文字までです`); return b; };
  const preview = (deleted, body) => { const p = deleted ? DELETED_TEXT : String(body || '').replace(/\n/g, ' '); return p.length <= 60 ? p : p.slice(0, 60) + '…'; };

  /* ---------- 状態の変更ルール ---------- */
  function conflict(cur, cuid, cun, nw, nuid, nun, worker) {
    if (cur.is_free || nw.is_free) return null;
    if (cur.id === nw.id && sameUser(cuid, cun, nuid, nun)) return null;
    if (sameUser(cuid, cun, worker.id, worker.name)) return null;
    const who = cun ? `（利用者: ${cun}）` : '';
    return `このデバイスはすでに「${cur.status_name}」${who}のため、他の人は変更できません。先に「${KEEP}」へ戻してください。`;
  }
  function writeLog(aid, action, st, user, w) {
    DB.log.push({ id: nid('log'), asset_id: aid, action, status_name: st, user_name: user, worker_name: w.name, worker_code: w.code || null, created_at: nowTs() });
  }
  function applyChange(aid, nw, user, memo, w, action) {
    const row = alive(DB.assets).find(a => a.id === aid);
    if (!row) throw new Reject('機器が見つかりません。画面を更新してください', 404);
    const now = statusById(row.status_id) || nw;
    if (!nw.is_active && nw.id !== now.id) throw new Reject(`「${nw.status_name}」は現在使えない状態です`);
    const nuid = user ? user.id : null, nun = user ? user.name : null;
    const msg = conflict(now, row.user_id, row.user_name, nw, nuid, nun, w);
    if (msg) throw new Reject(msg, 409);
    Object.assign(row, { status_id: nw.id, user_id: nuid, user_name: nun, memo, updated_at: nowTs(), updated_by_name: w.name });
    return row;
  }
  function changeAsset(aid, nw, user, memo, w, action) {
    const row = alive(DB.assets).find(a => a.id === aid);
    if (!row) throw new Reject('機器が見つかりません。画面を更新してください', 404);
    const prev = { uid: row.user_id, un: row.user_name };
    applyChange(aid, nw, user, memo, w, action);
    if (!sameUser(prev.uid, prev.un, user ? user.id : null, user ? user.name : null)) {
      DB.usage.forEach(u => { if (u.asset_id === aid && !u.end_date) u.end_date = today(); });
      if (user) DB.usage.push({ id: nid('usage'), asset_id: aid, user_name: user.name, start_date: today(), end_date: null, source: 'app' });
    }
    writeLog(aid, action, nw.status_name, user ? user.name : null, w);
  }
  function resolveUser(d, st, current) {
    if (st.is_free) return null;
    let user = null;
    if (d.user_id) {
      const s = findStaff(d.user_id);
      if (!s) throw new Reject('選んだ利用者が社員マスタにありません');
      if (s.retired && !(current && sameUser(current.user_id, current.user_name, s.id, s.name)))
        throw new Reject(`${s.name}さんは退職済みのため、利用者に選べません`);
      user = { id: Number(s.id), name: s.name };
    }
    if (st.needs_user && !user) {
      if (current && current.status_id === st.id && current.user_name) return { id: current.user_id, name: current.user_name };
      throw new Reject(`「${st.status_name}」にするには利用者を選んでください`);
    }
    return user;
  }

  /* ---------- 機器の一覧 ---------- */
  function deviceList() {
    const rows = alive(DB.assets).slice().sort((a, b) => {
      if (!a.updated_at !== !b.updated_at) return a.updated_at ? -1 : 1;
      if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
      return a.id - b.id;
    });
    const usage = {};
    DB.usage.slice().sort((a, b) => a.asset_id - b.asset_id || String(a.start_date || '9').localeCompare(String(b.start_date || '9')) || a.id - b.id)
      .forEach(u => (usage[u.asset_id] = usage[u.asset_id] || []).push({ user: u.user_name, start: fmtDate(u.start_date), end: fmtDate(u.end_date) }));
    return rows.map((r, i) => {
      const st = statusById(r.status_id) || { status_name: '?' };
      return { n: i + 1, key: String(r.id), device_type: r.device_type, manufacturer: r.manufacturer || '', model_name: r.model_name || '',
        serial_no: r.serial_no || '', info: clone(r.info || []), usage: usage[r.id] || [], status_id: r.status_id, status_name: st.status_name,
        user_id: r.user_id ? String(r.user_id) : null, user_name: r.user_name, memo: r.memo,
        updated_at: fmtDt(r.updated_at), updated_by: r.updated_by_name, mine: sameUser(r.user_id, r.user_name, SESS && SESS.sid, SESS && SESS.sname) };
    });
  }
  const simOf = d => { const it = (d.info || []).find(x => Array.isArray(x) && x[0] === 'SIM番号'); return it ? String(it[1]) : ''; };

  /* ---------- ルーティング ---------- */
  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
  const OPEN = ['/api/login-list', '/api/login', '/api/logout', '/api/me'];

  function handle(method, path, body) {
    load2();
    SESS = getSession();
    if (!OPEN.includes(path) && !SESS) return [401, { error: 'ログインが必要です' }];
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const snap = JSON.stringify(DB);
      try {
        const out = r.fn({ p: m.groups || {}, d: body || {} });
        save();
        return out instanceof Resp ? [out.status, out.json] : [200, out];
      } catch (e) {
        DB = JSON.parse(snap);
        if (e instanceof Reject) return [e.code, { error: e.msg }];
        console.error(e);
        return [500, { error: 'デモ環境でエラーが発生しました' }];
      }
    }
    return [404, { error: 'not found' }];
  }
  function load2() { if (!DB) load(); }

  /* ----- ログイン ----- */
  on('GET', '/api/login-list', () => staffList().filter(s => !s.retired));
  on('POST', '/api/login', ({ d }) => {
    const s = findStaff(d.shain_id, true);
    if (!s) throw new Reject('選んだ社員でログインできません');
    setSession({ sid: s.id, sname: s.name, scode: s.shain_code });
    return s;
  });
  on('GET', '/api/me', () => {
    const s = SESS && findStaff(SESS.sid, true);
    if (!s) { setSession(null); return R(401, { error: '未ログイン' }); }
    return s;
  });
  on('POST', '/api/logout', () => { setSession(null); return { ok: true }; });

  /* ----- 一覧 ----- */
  on('GET', '/api/master', () => {
    const counts = {};
    alive(DB.assets).forEach(a => counts[a.status_id] = (counts[a.status_id] || 0) + 1);
    return { statuses: statuses().map(s => Object.assign({}, s, { count: counts[s.id] || 0 })), shain: staffList() };
  });
  on('GET', '/api/assets', () => deviceList());
  on('GET', '/api/device-models', () => DB.models.slice().sort((a, b) => (a.device_type + a.manufacturer + a.model_name).localeCompare(b.device_type + b.manufacturer + b.model_name))
    .map(m => ({ id: String(m.id), sheet_id: m.sheet_id || '', device_type: m.device_type, manufacturer: m.manufacturer, model_name: m.model_name, info: m.info || [] })));
  on('GET', '/api/history', () => {
    const name = id => { const d = DB.assets.find(a => a.id === id); return d ? label(d) : '(不明)'; };
    const out = DB.log.slice().sort((a, b) => a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id).slice(0, 5000)
      .map(h => ({ created_at: fmtDt(h.created_at), key: String(h.asset_id), name: name(h.asset_id), action: h.action,
        status: h.status_name || '', user: h.user_name || '—', worker: h.worker_name }));
    out.forEach(r => r.detail = `状態: ${r.status || '—'} / 利用者: ${r.user}`);
    return out;
  });

  /* ----- 機器の変更 ----- */
  on('PUT', '/api/assets', ({ d }) => {
    adminOnly();
    const smap = statuses();
    const st = /^\d+$/.test(String(d.status_id || '')) ? smap.find(s => s.id === +d.status_id) : null;
    if (!st) throw new Reject('状態を選んでください');
    const aid = parseInt(d.key, 10);
    const row = alive(DB.assets).find(a => a.id === aid);
    if (!row) throw new Reject('機器が見つかりません。画面を更新してください', 404);
    const user = resolveUser(d, st, row);
    changeAsset(aid, st, user, (d.memo || '').trim() || null, me(), '状態変更');
    return { ok: true };
  });
  const cleanInfo = raw => {
    const out = [];
    (raw || []).forEach(it => {
      if (!Array.isArray(it) || it.length < 2) return;
      const k = String(it[0] || '').trim(), v = String(it[1] || '').trim();
      if (!k || !v) return;
      if (k.length > 50 || v.length > 500) throw new Reject(`その他の情報「${k.slice(0, 20)}」が長すぎます（項目は50文字、値は500文字まで）`);
      out.push([k, v]);
    });
    if (out.length > 50) throw new Reject('その他の情報は50行までです');
    return out;
  };
  on('PATCH', '/api/assets/:aid', ({ p, d }) => {
    adminOnly();
    const aid = +p.aid, w = me();
    const dtype = (d.device_type || '').trim(), maker = (d.manufacturer || '').trim() || null, model = (d.model_name || '').trim();
    const serial = (d.serial_no || '').trim() || null, memo = (d.memo || '').trim() || null;
    if (!dtype) throw new Reject('種別を入力してください');
    if (!model) throw new Reject('機種名を入力してください');
    if (dtype.length > 50 || model.length > 100 || (maker && maker.length > 100) || (serial && serial.length > 100)) throw new Reject('入力が長すぎます');
    const row = alive(DB.assets).find(a => a.id === aid);
    if (!row) throw new Reject('機器が見つかりません。画面を更新してください', 404);
    let info = cleanInfo(d.info).filter(it => it[0] !== 'SIM番号');
    const oldInfo = row.info || [];
    const pos = oldInfo.findIndex(it => Array.isArray(it) && it[0] === 'SIM番号');
    const oldSim = pos >= 0 ? String(oldInfo[pos][1] || '') : '';
    let newSim = oldSim;
    if ('sim_iccid' in d) {
      const sin = nfkc(d.sim_iccid);
      newSim = '';
      if (sin) {
        if (lowerKey(sin) === lowerKey(oldSim)) newSim = oldSim;
        else {
          const s = alive(DB.sims).find(x => x.iccid === sin);
          if (!s) throw new Reject(`SIM番号「${sin}」は登録されているSIMにありません。先にSIM一覧で追加してください`);
          newSim = s.iccid;
          const other = alive(DB.assets).find(o => o.id !== aid && lowerKey(simOf(o)) === lowerKey(newSim));
          if (other) throw new Reject(`SIM「${newSim}」はすでに機器「${label(other)}」が使っているため、選べません`);
        }
      }
    }
    if (newSim) { const e = ['SIM番号', newSim]; if (pos >= 0 && pos <= info.length) info.splice(pos, 0, e); else info.push(e); }
    if (serial && alive(DB.assets).some(o => o.id !== aid && o.serial_no === serial)) throw new Reject(`シリアルNo.「${serial}」はすでに登録されています`);
    const st = statusById(row.status_id);
    Object.assign(row, { device_type: dtype, manufacturer: maker, model_name: model, serial_no: serial, info, memo, updated_at: nowTs(), updated_by_name: w.name });
    writeLog(aid, '情報編集', st && st.status_name, row.user_name, w);
    return { ok: true };
  });
  on('DELETE', '/api/assets/:aid', ({ p }) => {
    adminOnly();
    const row = alive(DB.assets).find(a => a.id === +p.aid);
    if (!row) throw new Reject('機器が見つかりません。画面を更新してください', 404);
    row.deleted_at = nowTs(); row.deleted_by_name = me().name;
    writeLog(row.id, '機器削除', null, null, me());
    return { ok: true };
  });
  function insertAsset(dtype, maker, model, serial, st, user, memo, w) {
    const aid = nid('asset');
    DB.assets.push({ id: aid, device_no: 'A' + String(aid).padStart(5, '0'), device_type: dtype, manufacturer: maker, model_name: model, serial_no: serial,
      info: [], status_id: st.id, user_id: user ? user.id : null, user_name: user ? user.name : null, memo, created_at: nowTs(),
      updated_at: nowTs(), updated_by_name: w.name, deleted_at: null, deleted_by_name: null });
    if (user) DB.usage.push({ id: nid('usage'), asset_id: aid, user_name: user.name, start_date: today(), end_date: null, source: 'app' });
    writeLog(aid, '機器追加', st.status_name, user ? user.name : null, w);
  }
  on('POST', '/api/assets', ({ d }) => {
    adminOnly();
    const dtype = (d.device_type || '').trim(), model = (d.model_name || '').trim(), maker = (d.manufacturer || '').trim() || null;
    const serial = (d.serial_no || '').trim() || null, memo = (d.memo || '').trim() || null;
    if (!dtype) throw new Reject('種別を入力してください');
    if (!model) throw new Reject('機種名を入力してください');
    if (dtype.length > 50 || model.length > 100) throw new Reject('入力が長すぎます');
    const st = /^\d+$/.test(String(d.status_id || '')) ? statuses().find(s => s.id === +d.status_id) : keepStatus();
    if (!st || !st.is_active) throw new Reject('選んだ状態は使えません');
    const user = resolveUser(d, st);
    if (serial && alive(DB.assets).some(a => a.serial_no === serial)) throw new Reject(`シリアルNo.「${serial}」はすでに登録されています`);
    insertAsset(dtype, maker, model, serial, st, user, memo, me());
    return R(201, { ok: true });
  });

  /* ----- 機器: CSV一括 ----- */
  function userLookup() {
    const staff = staffList().filter(s => !s.retired), byCode = {}, byNm = {};
    staff.forEach(s => { if (s.shain_code) byCode[s.shain_code] = s; (byNm[norm(s.name)] = byNm[norm(s.name)] || []).push(s); });
    return us => byCode[us] || ((byNm[norm(us)] || []).length === 1 ? byNm[norm(us)][0] : null);
  }
  on('POST', '/api/assets/bulk', ({ d }) => {
    adminOnly();
    const rows = d.rows || []; checkLimit(rows);
    const activeSt = {}; statuses().filter(s => s.is_active).forEach(s => activeSt[s.status_name] = s);
    const serials = new Set(alive(DB.assets).filter(a => a.serial_no).map(a => lowerKey(a.serial_no)));
    const find = userLookup(), errors = [], out = [];
    rows.forEach((r, k) => {
      const i = k + 2, dtype = (r.device_type || '').trim(), maker = (r.manufacturer || '').trim() || null, model = (r.model_name || '').trim();
      const serial = (r.serial_no || '').trim() || null, memo = (r.memo || '').trim() || null;
      if (!dtype) return errors.push(`${i}行目: 種別が空です`);
      if (!model) return errors.push(`${i}行目: 機種名が空です`);
      if (dtype.length > 50 || model.length > 100) return errors.push(`${i}行目: 入力が長すぎます`);
      if (serial && serials.has(lowerKey(serial))) return errors.push(`${i}行目: シリアルNo.「${serial}」はすでに登録されています（ファイル内の重複を含む）`);
      let sname = (r.status || '').trim(); sname = LEGACY[sname] || sname || KEEP;
      const st = activeSt[sname];
      if (!st) return errors.push(`${i}行目: 状態「${sname}」は使えません（${Object.keys(activeSt).join('／')}）`);
      const us = (r.user || '').trim(); let user = null;
      if (us && !st.is_free) {
        const s = find(us);
        if (!s) return errors.push(`${i}行目: 利用者「${us}」が社員マスタにありません（氏名が重複する場合は社員コード）`);
        user = { id: +s.id, name: s.name };
      }
      if (st.needs_user && !user) return errors.push(`${i}行目: 「${st.status_name}」にするには利用者が必要です`);
      if (serial) serials.add(lowerKey(serial));
      out.push([dtype, maker, model, serial, st, user, memo]);
    });
    if (d.dry_run) return dry(errors, out.length);
    if (errors.length) throw new Reject(errors.slice(0, 10).join('\n'));
    out.forEach(o => insertAsset(...o, me()));
    return R(201, { ok: true, count: out.length });
  });
  on('POST', '/api/assets/import', ({ d }) => {
    adminOnly();
    const w = me(), rows = d.rows || [];
    if (!rows.length) return R(400, { error: '登録するデータがありません' });
    if (rows.length > 1000) return R(400, { error: '一度に登録できるのは1000件までです' });
    const activeSt = {}; statuses().filter(s => s.is_active).forEach(s => activeSt[s.status_name] = s);
    const devs = deviceList(), bySerial = {};
    devs.forEach(x => { if (x.serial_no) bySerial[norm(x.serial_no)] = x; });
    const find = userLookup(), errors = [], out = [], seen = new Set();
    rows.forEach((r, k) => {
      const i = k + 2, ref = (r.device || '').trim(), dev = bySerial[norm(ref)];
      if (!dev) return errors.push(`${i}行目: 機器「${ref}」が見つかりません（登録済みの機器のシリアルNo.を書いてください）`);
      if (seen.has(dev.key)) return errors.push(`${i}行目: 機器「${ref}」がファイル内で重複しています`);
      seen.add(dev.key);
      let sname = (r.status || '').trim(); sname = LEGACY[sname] || sname || KEEP;
      const st = activeSt[sname];
      if (!st) return errors.push(`${i}行目: 状態「${sname}」は使えません（${Object.keys(activeSt).join('／')}）`);
      const us = (r.user || '').trim(); let user = null;
      if (us && !st.is_free) {
        const s = find(us);
        if (!s) return errors.push(`${i}行目: 利用者「${us}」が社員マスタにありません（氏名が重複する場合は社員コード）`);
        user = { id: +s.id, name: s.name };
      }
      if (st.needs_user && !user) return errors.push(`${i}行目: 「${st.status_name}」にするには利用者が必要です`);
      const msg = conflict(statusById(dev.status_id), dev.user_id ? +dev.user_id : null, dev.user_name, st, user && user.id, user && user.name, w);
      if (msg) return errors.push(`${i}行目: 機器「${ref}」: ${msg}`);
      out.push([dev, st, user, (r.memo || '').trim() || null]);
    });
    if (d.dry_run) { const up = out.filter(o => o[0].updated_at).length; return { ok: !errors.length, errors: errors.slice(0, 20), more: Math.max(0, errors.length - 20), new: out.length - up, update: up }; }
    if (errors.length) return R(400, { error: errors.slice(0, 10).join('\n') });
    out.forEach(([dev, st, user, memo]) => changeAsset(+dev.key, st, user, memo, w, '一括登録'));
    return { ok: true, count: out.length };
  });

  /* ----- 状態の管理 ----- */
  on('POST', '/api/statuses', ({ d }) => {
    adminOnly();
    const name = (d.status_name || '').trim(), color = COLORS.includes(d.color) ? d.color : 'idle';
    if (!name) throw new Reject('状態の名前を入力してください');
    if (name.length > 30) throw new Reject('状態の名前は30文字までです');
    if (statuses().some(s => s.status_name === name)) throw new Reject(`「${name}」はすでにあります`);
    DB.statuses.push({ id: nid('status'), status_name: name, is_free: 0, needs_user: d.needs_user ? 1 : 0, color,
      display_order: Math.max(0, ...DB.statuses.map(s => s.display_order)) + 1, is_active: 1,
      highlight: d.highlight ? 1 : 0, sim_highlight: d.sim_highlight ? 1 : 0, deleted_at: null });
    return R(201, { ok: true });
  });
  on('PUT', '/api/statuses/:sid', ({ p, d }) => {
    adminOnly();
    const s = statuses().find(x => x.id === +p.sid);
    if (!s) throw new Reject('状態が見つかりません', 404);
    const isKeep = s.status_name === KEEP;
    const name = String('status_name' in d ? d.status_name : s.status_name || '').trim();
    const color = 'color' in d ? d.color : s.color;
    const needs = 'needs_user' in d ? !!d.needs_user : !!s.needs_user;
    const active = 'is_active' in d ? !!d.is_active : !!s.is_active;
    const hl = 'highlight' in d ? !!d.highlight : !!s.highlight;
    const shl = 'sim_highlight' in d ? !!d.sim_highlight : !!s.sim_highlight;
    if (!name) throw new Reject('状態の名前を入力してください');
    if (name.length > 30) throw new Reject('状態の名前は30文字までです');
    if (!COLORS.includes(color)) throw new Reject('色が正しくありません');
    if (isKeep) {
      if (name !== KEEP) throw new Reject(`「${KEEP}」の名前は変更できません`);
      if (!active) throw new Reject(`「${KEEP}」は無効にできません`);
      if (needs) throw new Reject(`「${KEEP}」の扱いは変更できません`);
    }
    if (name !== s.status_name && statuses().some(x => x.status_name === name && x.id !== s.id)) throw new Reject(`「${name}」はすでにあります`);
    if (alive(DB.assets).some(a => a.status_id === s.id) && needs !== !!s.needs_user)
      throw new Reject('この状態を使っている機器があるため、「利用者の必須」は変更できません。先に、その機器の状態を別の状態へ変更してください');
    if (name !== s.status_name) DB.log.forEach(l => { if (l.status_name === s.status_name) l.status_name = name; });
    Object.assign(s, { status_name: name, color, needs_user: needs ? 1 : 0, is_active: active ? 1 : 0, highlight: hl ? 1 : 0, sim_highlight: shl ? 1 : 0 });
    return { ok: true };
  });
  on('DELETE', '/api/statuses/:sid', ({ p }) => {
    adminOnly();
    const s = statuses().find(x => x.id === +p.sid);
    if (!s) throw new Reject('状態が見つかりません', 404);
    if (s.status_name === KEEP) throw new Reject(`「${KEEP}」は削除できません`);
    if (alive(DB.assets).some(a => a.status_id === s.id))
      throw new Reject(`「${s.status_name}」は機器で使われているため削除できません。先に、その機器の状態を別の状態へ変更してください`);
    s.deleted_at = nowTs();
    return { ok: true };
  });

  /* ----- 社員 ----- */
  function checkStaff(d, codes, names) {
    const code = nfkc(d.shain_code) || null, name = (d.name || '').trim(), email = (d.email || '').trim() || null;
    if (!name) throw new Reject('氏名を入力してください');
    if (name.length > 50 || (code && code.length > 30) || (email && email.length > 100)) throw new Reject('入力が長すぎます');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Reject(`メールアドレス「${email}」の形式が正しくありません`);
    if (code && codes.has(code)) throw new Reject(`社員コード「${code}」はすでに使われています`);
    if (!code && names.has(lowerKey(name))) throw new Reject(`「${name}」さんはすでにいます。同姓同名の場合は、社員コードを入れてください`);
    const join = parseDate(d.join_date), ret = parseDate(d.retired_date);
    if (join && ret && ret < join) throw new Reject('退職日が入社日より前になっています');
    return { code, name, email, join, ret };
  }
  const addStaffRow = r => DB.staff.push({ id: nid('staff'), shain_code: r.code, name: r.name, email: r.email, join_date: r.join, retired_date: r.ret, on_leave: 0, deleted_at: null });
  const staffKeys = (ex) => { const l = staffList().filter(s => String(s.id) !== String(ex)); return [new Set(l.filter(s => s.shain_code).map(s => s.shain_code)), new Set(l.map(s => lowerKey(s.name)))]; };
  const activeAdmins = (ex) => alive(DB.admins).map(a => alive(DB.staff).find(s => s.shain_code === a.shain_code)).filter(s => s && !isRetired(s) && String(s.id) !== String(ex));
  on('POST', '/api/staff', ({ d }) => { adminOnly(); addStaffRow(checkStaff(d, ...staffKeys())); return R(201, { ok: true }); });
  on('PUT', '/api/staff/:id/status', ({ p, d }) => {
    adminOnly();
    const s = findStaff(p.id), st = (d.status || '').trim();
    if (!s) throw new Reject('社員が見つかりません。画面を更新してください', 404);
    if (!['active', 'retired', 'leave'].includes(st)) throw new Reject('状態を選んでください');
    const row = alive(DB.staff).find(x => String(x.id) === String(p.id));
    if (st === 'retired') {
      if (s.is_admin && !activeAdmins(p.id).length) throw new Reject('最後の管理者は退職にできません。先に、別の人を管理者に追加してください');
      row.on_leave = 0; if (!(row.retired_date && row.retired_date <= today())) row.retired_date = today();
    } else if (st === 'leave') { row.on_leave = 1; row.retired_date = null; }
    else { row.on_leave = 0; row.retired_date = null; }
    return { ok: true };
  });
  on('PUT', '/api/staff/:id', ({ p, d }) => {
    adminOnly();
    const s = findStaff(p.id);
    if (!s) throw new Reject('社員が見つかりません。画面を更新してください', 404);
    const r = checkStaff(d, ...staffKeys(p.id));
    if (s.is_admin && !r.code) throw new Reject('管理者の社員コードは空にできません');
    const row = alive(DB.staff).find(x => String(x.id) === String(p.id));
    if (s.is_admin) {
      if (r.ret && r.ret <= today() && !activeAdmins(p.id).length) throw new Reject('最後の管理者は退職にできません。先に、別の人を管理者に追加してください');
      if (r.code !== s.shain_code) {
        DB.admins.forEach(a => { if (a.shain_code === s.shain_code && !a.deleted_at) a.deleted_at = nowTs(); });
        const ex = DB.admins.find(a => a.shain_code === r.code);
        if (ex) ex.deleted_at = null; else DB.admins.push({ shain_code: r.code, deleted_at: null });
      }
    }
    const oldName = row.name;
    Object.assign(row, { shain_code: r.code, name: r.name, email: r.email, join_date: r.join, retired_date: r.ret });
    if (r.name !== oldName) {
      DB.assets.forEach(a => { if (a.user_id === row.id) a.user_name = r.name; });
      DB.log.forEach(l => { if (s.shain_code && l.worker_code === s.shain_code) l.worker_name = r.name; });
      if (!staffList().some(x => String(x.id) !== String(p.id) && lowerKey(x.name) === lowerKey(oldName))) {
        DB.usage.forEach(u => { if (u.user_name === oldName) u.user_name = r.name; });
        DB.log.forEach(l => { if (l.user_name === oldName) l.user_name = r.name; });
      }
    }
    if (String(p.id) === String(SESS.sid)) setSession(Object.assign({}, SESS, { sname: r.name, scode: r.code }));
    return { ok: true };
  });
  on('DELETE', '/api/staff/:id', ({ p }) => {
    adminOnly();
    const s = findStaff(p.id);
    if (!s) throw new Reject('社員が見つかりません。画面を更新してください', 404);
    if (String(p.id) === String(SESS.sid)) throw new Reject('ログイン中の自分自身は削除できません。ほかの管理者に削除してもらってください');
    if (s.is_admin) {
      if (!activeAdmins(p.id).length && !s.retired) throw new Reject('最後の管理者は削除できません。先に、別の人を管理者に追加してください');
      DB.admins.forEach(a => { if (a.shain_code === s.shain_code && !a.deleted_at) a.deleted_at = nowTs(); });
    }
    DB.assets.forEach(a => { if (String(a.user_id) === String(p.id)) a.user_id = null; });
    alive(DB.staff).find(x => String(x.id) === String(p.id)).deleted_at = nowTs();
    return { ok: true };
  });
  on('POST', '/api/staff/bulk', ({ d }) => {
    adminOnly();
    const rows = d.rows || []; checkLimit(rows);
    const [codes, names] = staffKeys(), errors = [], out = [];
    rows.forEach((r, k) => {
      try { const rec = checkStaff(r, codes, names); if (rec.code) codes.add(rec.code); names.add(lowerKey(rec.name)); out.push(rec); }
      catch (e) { if (e instanceof Reject) errors.push(`${k + 2}行目: ${e.msg}`); else throw e; }
    });
    if (d.dry_run) return dry(errors, out.length);
    if (errors.length) throw new Reject(errors.slice(0, 10).join('\n'));
    out.forEach(addStaffRow);
    return R(201, { ok: true, count: out.length });
  });

  /* ----- 管理者 ----- */
  on('POST', '/api/admins', ({ d }) => {
    adminOnly();
    const s = findStaff(d.staff_id);
    if (!s) throw new Reject('社員が見つかりません', 404);
    if (s.retired) throw new Reject(`${s.name}さんは退職済みのため、管理者にできません`);
    if (!s.shain_code) throw new Reject('社員コードがない人は管理者にできません。先に社員コードを登録してください');
    if (s.is_admin) throw new Reject(`${s.name}さんはすでに管理者です`);
    const ex = DB.admins.find(a => a.shain_code === s.shain_code);
    if (ex) ex.deleted_at = null; else DB.admins.push({ shain_code: s.shain_code, deleted_at: null });
    return R(201, { ok: true });
  });
  on('DELETE', '/api/admins/:id', ({ p }) => {
    adminOnly();
    const s = findStaff(p.id);
    if (!s || !s.is_admin) throw new Reject('管理者が見つかりません', 404);
    const act = activeAdmins(null).map(x => x.shain_code);
    if (act.includes(s.shain_code) && act.length <= 1) throw new Reject('最後の管理者は削除できません。先に、別の人を管理者に追加してください');
    DB.admins.forEach(a => { if (a.shain_code === s.shain_code && !a.deleted_at) a.deleted_at = nowTs(); });
    return { ok: true };
  });

  /* ----- SIM ----- */
  function checkSim(d, iccids, phones) {
    const iccid = nfkc(d.iccid), phone = nfkc(d.ip_phone) || null, memo = (d.memo || '').trim() || null;
    if (!iccid) throw new Reject('ICCIDを入力してください');
    if (iccid.length > 30 || !/^[0-9A-Za-z-]+$/.test(iccid)) throw new Reject(`ICCID「${iccid}」は、英数字とハイフンで30文字までにしてください`);
    if (phone && (phone.length > 30 || !/^[0-9-]+$/.test(phone))) throw new Reject(`IP電話番号「${phone}」は、数字とハイフンで30文字までにしてください`);
    if (memo && memo.length > 200) throw new Reject('備考は200文字までです');
    if (iccids.has(lowerKey(iccid))) throw new Reject(`ICCID「${iccid}」はすでに登録されています`);
    if (phone && phones.has(phone)) throw new Reject(`IP電話番号「${phone}」はすでに登録されています`);
    return { iccid, ip_phone: phone, memo };
  }
  const simKeys = ex => { const l = alive(DB.sims).filter(s => s.id !== ex); return [new Set(l.map(s => lowerKey(s.iccid))), new Set(l.filter(s => s.ip_phone).map(s => s.ip_phone))]; };
  function simStatus(d, curId) {
    const raw = d.status_id;
    if (raw === null || raw === undefined || raw === '') { if (curId && statusById(curId)) return curId; const k = keepStatus(); return k ? k.id : null; }
    const st = /^\d+$/.test(String(raw)) ? statuses().find(s => s.id === +raw) : null;
    if (!st) throw new Reject('状態を選んでください');
    if (st.needs_user) throw new Reject(`「${st.status_name}」はSIMには使えません（利用者が必要な状態のため）`);
    if (!st.is_active && st.id !== curId) throw new Reject(`「${st.status_name}」は現在使えない状態です`);
    return st.id;
  }
  on('GET', '/api/sims', () => {
    const by = {};
    deviceList().forEach(d => { const s = simOf(d); if (s) (by[lowerKey(s)] = by[lowerKey(s)] || []).push({ n: d.n, key: d.key, model_name: d.model_name, status_name: d.status_name, user_id: d.user_id, user_name: d.user_name }); });
    const keep = keepStatus();
    return alive(DB.sims).sort((a, b) => a.id - b.id).map(r => {
      const st = statusById(r.status_id) || keep;
      return { id: String(r.id), iccid: r.iccid, ip_phone: r.ip_phone || '', memo: r.memo || '', status_id: st ? st.id : null, status_name: st ? st.status_name : KEEP, devices: by[lowerKey(r.iccid)] || [] };
    });
  });
  on('POST', '/api/sims/bulk', ({ d }) => {
    adminOnly();
    const rows = d.rows || []; checkLimit(rows);
    const [iccids, phones] = simKeys(), errors = [], out = [];
    rows.forEach((r, k) => {
      try { const rec = checkSim(r, iccids, phones); iccids.add(lowerKey(rec.iccid)); if (rec.ip_phone) phones.add(rec.ip_phone); out.push(rec); }
      catch (e) { if (e instanceof Reject) errors.push(`${k + 2}行目: ${e.msg}`); else throw e; }
    });
    if (d.dry_run) return dry(errors, out.length);
    if (errors.length) throw new Reject(errors.slice(0, 10).join('\n'));
    const k = keepStatus();
    out.forEach(r => DB.sims.push(Object.assign({ id: nid('sim'), status_id: k ? k.id : null, deleted_at: null }, r)));
    return R(201, { ok: true, count: out.length });
  });
  on('POST', '/api/sims', ({ d }) => {
    adminOnly();
    const rec = checkSim(d, ...simKeys());
    DB.sims.push(Object.assign({ id: nid('sim'), status_id: simStatus(d), deleted_at: null }, rec));
    return R(201, { ok: true });
  });
  on('PUT', '/api/sims/:id', ({ p, d }) => {
    adminOnly();
    const row = alive(DB.sims).find(s => s.id === +p.id);
    if (!row) throw new Reject('SIMが見つかりません。画面を更新してください', 404);
    const rec = checkSim(d, ...simKeys(row.id)), sid = simStatus(d, row.status_id), old = row.iccid;
    Object.assign(row, rec, { status_id: sid });
    if (lowerKey(rec.iccid) !== lowerKey(old))
      DB.assets.forEach(a => (a.info || []).forEach(it => { if (Array.isArray(it) && it[0] === 'SIM番号' && lowerKey(it[1]) === lowerKey(old)) it[1] = rec.iccid; }));
    return { ok: true };
  });
  on('DELETE', '/api/sims/:id', ({ p }) => {
    adminOnly();
    const row = alive(DB.sims).find(s => s.id === +p.id);
    if (!row) throw new Reject('SIMが見つかりません。画面を更新してください', 404);
    row.deleted_at = nowTs();
    return { ok: true };
  });

  /* ----- メッセージ（1対1） ----- */
  on('GET', '/api/messages/threads', () => {
    const uid = myId(), aliveIds = new Set(staffList().map(s => +s.id)), by = {};
    DB.messages.filter(m => m.from_id === uid || m.to_id === uid).forEach(m => {
      const pid = m.from_id === uid ? m.to_id : m.from_id;
      if (!by[pid] || m.id > by[pid].id) by[pid] = m;
    });
    const threads = Object.keys(by).map(Number).filter(pid => aliveIds.has(pid)).map(pid => {
      const m = by[pid];
      return { partner_id: String(pid), last_id: m.id, last_body: preview(m.deleted_at, m.body), last_at: fmtDt(m.created_at), last_mine: m.from_id === uid,
        unread: DB.messages.filter(u => u.from_id === pid && u.to_id === uid && !u.read_at && !u.deleted_at).length };
    }).sort((a, b) => b.last_id - a.last_id);
    return { threads, unread: threads.reduce((s, t) => s + t.unread, 0) };
  });
  on('GET', '/api/messages/with/:pid', ({ p }) => {
    const uid = myId(), pid = +p.pid;
    if (!findStaff(pid)) throw new Reject('社員が見つかりません', 404);
    DB.messages.forEach(m => { if (m.from_id === pid && m.to_id === uid && !m.read_at) m.read_at = nowTs(); });
    let rows = DB.messages.filter(m => (m.from_id === uid && m.to_id === pid) || (m.from_id === pid && m.to_id === uid)).sort((a, b) => b.id - a.id);
    const more = rows.length > 200; rows = rows.slice(0, 200).reverse();
    return { more, messages: rows.map(r => ({ id: r.id, mine: r.from_id === uid, body: r.deleted_at ? '' : r.body, created_at: fmtDt(r.created_at), read: !!r.read_at, deleted: !!r.deleted_at })) };
  });
  on('POST', '/api/messages', ({ d }) => {
    const uid = myId();
    if (!findStaff(uid, true)) throw new Reject('このアカウントでは送信できません', 403);
    const body = cleanBody(d), to = findStaff(d.to_id);
    if (!to) throw new Reject('宛先の社員が見つかりません', 404);
    if (+to.id === uid) throw new Reject('自分にはメッセージを送れません');
    if (to.retired) throw new Reject(`${to.name}さんは退職しているため、送れません`);
    DB.messages.push({ id: nid('msg'), from_id: uid, to_id: +to.id, body, created_at: nowTs(), read_at: null, deleted_at: null });
    return R(201, { ok: true });
  });
  on('DELETE', '/api/messages/:id', ({ p }) => {
    const m = DB.messages.find(x => x.id === +p.id && x.from_id === myId() && !x.deleted_at);
    if (!m) throw new Reject('削除できるメッセージが見つかりません（自分のメッセージだけ削除できます）', 404);
    m.deleted_at = nowTs();
    return { ok: true };
  });

  /* ----- グループ ----- */
  const groupOrReject = gid => {
    const g = alive(DB.groups).find(x => x.id === gid);
    if (!g) throw new Reject('グループが見つかりません', 404);
    if (!DB.members.some(m => m.group_id === gid && m.staff_id === myId())) throw new Reject('このグループのメンバーではありません', 403);
    return g;
  };
  const markRead = (arr, keyName, key, uid, last) => {
    let r = arr.find(x => x[keyName] === key && x.staff_id === uid);
    if (!r) arr.push({ [keyName]: key, staff_id: uid, last_read_id: last }); else r.last_read_id = Math.max(r.last_read_id, last);
  };
  const lastRead = (arr, keyName, key, uid) => { const r = arr.find(x => x[keyName] === key && x.staff_id === uid); return r ? r.last_read_id : 0; };
  const cleanGroupName = d => {
    const n = String(d.name || '').replace(/\s+/g, ' ').trim();
    if (!n) throw new Reject('グループ名を入力してください');
    if (n.length > 50) throw new Reject('グループ名は50文字までです');
    return n;
  };
  on('GET', '/api/chat-groups', () => {
    const uid = myId(), staff = {}; staffList().forEach(s => staff[+s.id] = s);
    const rooms = alive(DB.groups).filter(g => DB.members.some(m => m.group_id === g.id && m.staff_id === uid)).map(g => {
      const msgs = DB.chatmsgs.filter(m => m.group_id === g.id), last = msgs.reduce((a, m) => (!a || m.id > a.id ? m : a), null);
      const lr = lastRead(DB.chatread, 'group_id', g.id, uid);
      return { room_id: String(g.id), name: g.name, member_count: DB.members.filter(m => m.group_id === g.id).length,
        last_body: last ? preview(last.deleted_at, last.body) : '', last_from: last ? (staff[last.from_id] || {}).name || '' : '',
        last_at: fmtDt(last ? last.created_at : g.created_at),
        unread: msgs.filter(m => m.from_id !== uid && !m.deleted_at && m.id > lr).length };
    }).sort((a, b) => a.last_at < b.last_at ? 1 : -1);
    return { rooms, unread: rooms.reduce((s, r) => s + r.unread, 0) };
  });
  on('POST', '/api/chat-groups', ({ d }) => {
    const uid = myId();
    if (!findStaff(uid, true)) throw new Reject('このアカウントでは作成できません', 403);
    const name = cleanGroupName(d), live = new Set(staffList().filter(s => !s.retired).map(s => +s.id)), mem = new Set();
    (d.member_ids || []).forEach(x => { if (!/^\d+$/.test(String(x))) throw new Reject('メンバーが正しくありません'); mem.add(+x); });
    mem.delete(uid);
    if (!mem.size) throw new Reject('メンバーを1人以上選んでください');
    if (![...mem].every(x => live.has(x))) throw new Reject('在籍していない社員はメンバーにできません。画面を更新してください');
    const gid = nid('group');
    DB.groups.push({ id: gid, name, created_by: uid, created_at: nowTs(), updated_at: null, deleted_at: null });
    [...mem, uid].sort((a, b) => a - b).forEach(s => DB.members.push({ group_id: gid, staff_id: s, joined_at: nowTs() }));
    return R(201, { ok: true, room_id: String(gid) });
  });
  on('PUT', '/api/chat-groups/:gid', ({ p, d }) => {
    const g = groupOrReject(+p.gid); g.name = cleanGroupName(d); g.updated_at = nowTs();
    return { ok: true };
  });
  on('GET', '/api/chat-groups/:gid', ({ p }) => {
    const gid = +p.gid, g = groupOrReject(gid), uid = myId(), staff = {}; staffList().forEach(s => staff[+s.id] = s);
    let rows = DB.chatmsgs.filter(m => m.group_id === gid).sort((a, b) => b.id - a.id);
    if (rows.length) markRead(DB.chatread, 'group_id', gid, uid, rows[0].id);
    const more = rows.length > 200; rows = rows.slice(0, 200).reverse();
    const members = DB.members.filter(m => m.group_id === gid).sort((a, b) => a.joined_at.localeCompare(b.joined_at) || a.staff_id - b.staff_id)
      .map(m => ({ id: String(m.staff_id), name: (staff[m.staff_id] || {}).name || '（不明な社員）', retired: !!(staff[m.staff_id] || {}).retired }));
    return { more, messages: rows.map(r => ({ id: r.id, mine: r.from_id === uid, from_name: (staff[r.from_id] || {}).name || '（不明な社員）',
      body: r.deleted_at ? '' : r.body, created_at: fmtDt(r.created_at), deleted: !!r.deleted_at })), group: { room_id: String(gid), name: g.name, members } };
  });
  on('POST', '/api/chat-groups/:gid/messages', ({ p, d }) => {
    const gid = +p.gid; groupOrReject(gid);
    const uid = myId();
    if (!findStaff(uid, true)) throw new Reject('このアカウントでは送信できません', 403);
    const id = nid('cmsg');
    DB.chatmsgs.push({ id, group_id: gid, from_id: uid, body: cleanBody(d), created_at: nowTs(), edited_at: null, deleted_at: null });
    markRead(DB.chatread, 'group_id', gid, uid, id);
    return R(201, { ok: true });
  });
  on('DELETE', '/api/chat-groups/:gid/messages/:mid', ({ p }) => {
    groupOrReject(+p.gid);
    const m = DB.chatmsgs.find(x => x.id === +p.mid && x.group_id === +p.gid && x.from_id === myId() && !x.deleted_at);
    if (!m) throw new Reject('削除できるメッセージが見つかりません（自分のメッセージだけ削除できます）', 404);
    m.deleted_at = nowTs();
    return { ok: true };
  });

  /* ----- 管理者グループ（一般社員ごとに1部屋） ----- */
  const roomOrReject = room => {
    const owner = findStaff(room, true);
    if (!owner) throw new Reject('相談している社員が見つかりません', 404);
    if (owner.is_admin) throw new Reject('管理者には管理者グループはありません', 404);
    if (+owner.id !== myId() && !isAdmin()) throw new Reject('この部屋は見られません', 403);
    return owner;
  };
  on('GET', '/api/groupchat/rooms', () => {
    const uid = myId(), staff = {}; staffList().forEach(s => staff[+s.id] = s);
    const last = {}; DB.rooms.forEach(m => { if (!last[m.room_id] || m.id > last[m.room_id].id) last[m.room_id] = m; });
    const ids = isAdmin() ? Object.keys(last).map(Number) : [uid];
    const rooms = ids.map(rid => {
      const owner = staff[rid]; if (!owner || owner.retired || owner.is_admin) return null;
      const m = last[rid], lr = lastRead(DB.roomread, 'room_id', rid, uid);
      return { room_id: String(rid), name: owner.name, last_id: m ? m.id : 0, last_body: m ? preview(m.deleted_at, m.body) : '',
        last_from: m ? (staff[m.from_id] || {}).name || '' : '', last_at: m ? fmtDt(m.created_at) : '',
        unread: DB.rooms.filter(x => x.room_id === rid && x.from_id !== uid && !x.deleted_at && x.id > lr).length };
    }).filter(Boolean).sort((a, b) => b.last_id - a.last_id || a.name.localeCompare(b.name));
    return { rooms, unread: rooms.reduce((s, r) => s + r.unread, 0) };
  });
  on('GET', '/api/groupchat/:room', ({ p }) => {
    const room = +p.room, uid = myId(); roomOrReject(room);
    const staff = {}; staffList().forEach(s => staff[+s.id] = s);
    let rows = DB.rooms.filter(m => m.room_id === room).sort((a, b) => b.id - a.id);
    if (rows.length) markRead(DB.roomread, 'room_id', room, uid, rows[0].id);
    const more = rows.length > 200; rows = rows.slice(0, 200).reverse();
    return { more, messages: rows.map(r => { const f = staff[r.from_id] || {};
      return { id: r.id, mine: r.from_id === uid, from_name: f.name || '（不明な社員）', from_admin: !!f.is_admin, body: r.deleted_at ? '' : r.body, created_at: fmtDt(r.created_at), deleted: !!r.deleted_at }; }) };
  });
  on('POST', '/api/groupchat/:room', ({ p, d }) => {
    const room = +p.room, uid = myId();
    if (!findStaff(uid, true)) throw new Reject('このアカウントでは送信できません', 403);
    roomOrReject(room);
    const id = nid('rmsg');
    DB.rooms.push({ id, room_id: room, from_id: uid, body: cleanBody(d), created_at: nowTs(), edited_at: null, deleted_at: null });
    markRead(DB.roomread, 'room_id', room, uid, id);
    return R(201, { ok: true });
  });
  on('DELETE', '/api/groupchat/:room/messages/:mid', ({ p }) => {
    roomOrReject(+p.room);
    const m = DB.rooms.find(x => x.id === +p.mid && x.room_id === +p.room && x.from_id === myId() && !x.deleted_at);
    if (!m) throw new Reject('削除できるメッセージが見つかりません（自分のメッセージだけ削除できます）', 404);
    m.deleted_at = nowTs();
    return { ok: true };
  });

  /* ----- ピン止め ----- */
  on('GET', '/api/messages/pins', () => ({ pins: Object.assign({}, DB.pins[myId()] || {}) }));
  on('PUT', '/api/messages/pin', ({ d }) => {
    const key = String(d.key || '');
    if (!/^([cg]:)?\d{1,10}$/.test(key)) throw new Reject('ピン止めする会話が正しくありません');
    (DB.pins[myId()] = DB.pins[myId()] || {})[key] = d.pinned ? 1 : 0;
    return { ok: true };
  });

  /* ---------- fetch を差し替え ---------- */
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const path = url.split('?')[0];
    if (!path.startsWith('/api/')) return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = null;
    if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
    const [status, json] = handle(method, path, body);
    return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  };

  window.DEMO = {
    reset() { try { localStorage.removeItem(KEY); localStorage.removeItem(SESSION); } catch (e) {} DB = null; memSession = null; location.reload(); }
  };
})();
