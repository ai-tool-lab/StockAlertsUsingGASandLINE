function doPost(e) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("LINE") || ss.insertSheet("LINE");

  const body = e?.postData?.contents || "";
  sh.getRange("A1").setValue("received_at");
  sh.getRange("A2").setValue(new Date());
  sh.getRange("B1").setValue("raw");
  sh.getRange("B2").setValue(body);

  if (body) {
    const json = JSON.parse(body);
    const userId = json?.events?.[0]?.source?.userId || "";
    sh.getRange("C1").setValue("userId");
    sh.getRange("C2").setValue(userId);

    if (userId) {
      PropertiesService.getScriptProperties().setProperty("LINE_USER_ID", userId);
      sh.getRange("D1").setValue("saved");
      sh.getRange("D2").setValue("LINE_USER_ID saved");
    }
  }

  return ContentService.createTextOutput("OK");
}

/***************
 * 0) メニュー
 ***************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Stock Alert')
    .addItem('引け後チェック（手動実行）', 'notifyCloseCheck')
    .addItem('平日15:35トリガー作成', 'createCloseTrigger')
    .addToUi();
}

/********************************
 * 1) トリガー作成（平日引け後）
 ********************************/
function createCloseTrigger() {
  // 既存の同名トリガー重複を避けたい場合はここで削除してもOK
  ScriptApp.newTrigger('notifyCloseCheck')
    .timeBased()
    .everyDays(1)
    .atHour(15)
    .nearMinute(35) // 15:35前後に実行（GASは数分ズレることがあります）:contentReference[oaicite:6]{index=6}
    .create();

  SpreadsheetApp.getUi().alert('トリガーを作成しました（毎日15:35前後）。');
}

/******************************************
 * 2) 本体：引け後のみ 終値取得 → 閾値判定
 ******************************************/
function notifyCloseCheck() {
  const tz = Session.getScriptTimeZone();

  // 平日だけ（日本の祝日は最短では未対応：取得失敗→スキップで運用）
  const now = new Date();
  const dow = now.getDay(); // 0=日,6=土
  if (dow === 0 || dow === 6) return;

  const ss = SpreadsheetApp.getActive();
  const shWatch = ss.getSheetByName('WATCH');
  const shLog = ss.getSheetByName('LOG');
  if (!shWatch || !shLog) throw new Error('WATCH / LOG シートを作成してください。');

  const values = shWatch.getDataRange().getValues();
  if (values.length <= 1) return;

  // 1行目は見出し想定
  for (let r = 1; r < values.length; r++) {
    try {
      const row = values[r];
      const code = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      const upper = parseNum_(row[2]);
      const lower = parseNum_(row[3]);
      const enabled = toBool_(row[4]);

      if (!enabled || !code) continue;

      // 終値取得（試作：Stooq→Yahooに変更 日足）
      const close = fetchCloseFromYahoo_(code); // number
      if (!isFinite(close)) throw new Error('終値が取得できませんでした');

      const state = calcState_(close, upper, lower); // above/below/inside
      const lastState = String(row[5] || 'na');
      const triggered = calcTriggered_(lastState, state); // UP/DOWN/NO

      // ログ
      const msgBase = `${code}${name ? ' ' + name : ''} 終値: ${close}`;
      shLog.appendRow([
        new Date(),
        code,
        close,
        state,
        triggered,
        msgBase,
        ''
      ]);

      // WATCH更新（F,G）
      shWatch.getRange(r + 1, 6).setValue(state);  // F: last_state
      shWatch.getRange(r + 1, 7).setValue(close);  // G: last_close

      // 発火時のみ通知 + 通知時刻更新
      if (triggered !== 'NO') {
        const text = buildLineMessage_(code, name, close, upper, lower, triggered);
        pushLine_(text);
        shWatch.getRange(r + 1, 8).setValue(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm')); // H
      }

    } catch (e) {
      // エラーもLOGへ
      const code = String(values[r][0] || '').trim();
      shLog.appendRow([new Date(), code, '', '', 'NO', '', String(e)]);
    }
  }
}

/***********************
 * 5) LINE Push（自分だけ）
 ***********************/
function pushLine_(text) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const userId = PropertiesService.getScriptProperties().getProperty('LINE_USER_ID');
  if (!token || !userId) throw new Error('LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID を Script Properties に設定してください。');

  // Pushメッセージ：Authorization: Bearer {token} で送信 :contentReference[oaicite:7]{index=7}
  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: userId,
    messages: [{ type: 'text', text }]
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`LINE push failed (${code}): ${res.getContentText()}`);
  }
}

/*****************************************
 * 6) 株価取得（試作：Stooq→Yahooに変更 日足の終値）
 *****************************************/
function fetchCloseFromYahoo_(jpCode) {
  // Yahoo Finance: Tokyo = ".T"
  const symbol = `${jpCode}.T`;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;

  const res = UrlFetchApp.fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GAS Stock Bot/1.0)",
      "Accept": "application/json"
    },
    followRedirects: true,
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const text = res.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`Yahoo HTTP ${status}: ${text.slice(0, 120)}`);
  }

  const json = JSON.parse(text);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo result missing");

  // close配列の最後の「nullじゃない値」を終値として採用
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) throw new Error("Yahoo close missing");

  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (typeof c === "number" && isFinite(c)) return c;
  }
  throw new Error("No valid close found");
}

/***********************
 * 7) 判定ロジック
 ***********************/
function calcState_(close, upper, lower) {
  if (isFinite(upper) && close > upper) return 'above';
  if (isFinite(lower) && close < lower) return 'below';
  return 'inside';
}

function calcTriggered_(lastState, state) {
  // 「中→上」「中→下」「下→上」「上→下」など、状態が変わった瞬間だけ通知
  if (lastState === state) return 'NO';
  if (state === 'above') return 'UP';
  if (state === 'below') return 'DOWN';
  return 'NO'; // insideに戻っただけでは通知しない（うるさいので）
}

function buildLineMessage_(code, name, close, upper, lower, trig) {
  const head = trig === 'UP' ? '📈 上抜け' : '📉 下抜け';
  const u = isFinite(upper) ? `上限:${upper}` : '';
  const l = isFinite(lower) ? `下限:${lower}` : '';
  const lim = [u, l].filter(Boolean).join(' / ');
  return `${head}\n${code}${name ? ' ' + name : ''}\n終値: ${close}\n${lim}`;
}

/***********************
 * 8) 小物
 ***********************/
function parseNum_(v) {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : NaN;
}
function toBool_(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}
