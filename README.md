# Stock Alert (GAS × LINE)

日本株の**終値**を監視し、  
指定した価格を **上抜け／下抜けしたタイミングだけ**  
LINEに通知する Google Apps Script アプリです。

> 監視は **引け後のみ**（終値ベース）  
> 同じ状態が続く限り **重複通知しません**

---

## Features

- 日本株（東証）の終値を自動取得
- 上限／下限の **閾値アラート**
- 状態変化時のみ通知（ノイズなし）
- LINE Messaging API による Push 通知
- サーバ不要（GAS＋Spreadsheet）

---

## Architecture

Google Spreadsheet
├─ WATCH（監視設定）
├─ LOG（実行ログ）
└─ Apps Script
│
├─ Yahoo Finance（終値取得）
└─ LINE Messaging API（通知）


---

## Spreadsheet Structure

### WATCH（監視設定）

| Column | Description |
|---|---|
| A | 証券コード |
| B | 銘柄名 |
| C | 上限価格 |
| D | 下限価格 |
| E | 有効（TRUE / FALSE） |
| F | 前回状態（inside / above / below） |
| G | 最終終値 |
| H | 最終通知日時 |

---

### LOG（実行ログ）

| Column | Description |
|---|---|
| A | 実行日時 |
| B | 証券コード |
| C | 終値 |
| D | 状態 |
| E | 通知判定（UP / DOWN / NO） |
| F | メッセージ |
| G | エラー内容 |

---

## Workflow

```text
Trigger / Manual Run
        ↓
notifyCloseCheck()
        ↓
Weekday check
        ↓
Read WATCH rows
        ↓
Fetch close price (Yahoo)
        ↓
State判定（above / below / inside）
        ↓
前回状態と比較
        ↓
状態変化あり？
   ├─ NO → LOGのみ
   └─ YES → LINE通知
        ↓
WATCH / LOG 更新
```

## Alert Logic

終値と設定した閾値を比較し、**状態が変化した瞬間のみ**通知します。  
同じ状態が続く限り、**重複通知は行いません**。

### State Definitions

- **above**：終値 > 上限価格
- **below**：終値 < 下限価格
- **inside**：上限・下限の範囲内

### Trigger Conditions

| Previous State | Current State | Alert |
|---|---|---|
| inside | above | 📈 UP（上抜け） |
| inside | below | 📉 DOWN（下抜け） |
| above | above | ❌ No alert |
| below | below | ❌ No alert |
| above | inside | ❌ No alert |
| below | inside | ❌ No alert |

> 状態が **inside に戻っただけ** では通知しません。  
> 次に再び上抜け／下抜けした場合のみ、再通知されます。

---

## Execution Timing

- **Automatic Execution**
  - Google Apps Script time-based trigger
  - Runs every weekday around **15:35 JST** (after market close)

- **Manual Execution**
  - Spreadsheet menu  
    `Stock Alert → 引け後チェック（手動実行）`

---

## LINE Notification

Notifications are sent via **LINE Messaging API (Push Message)**.

### Example Message

📈 上抜け
7203 トヨタ自動車
終値: 2985
上限: 2900

📉 下抜け
6758 ソニーグループ
終値: 10250
下限: 10500


---

## Configuration

### Script Properties

The following Script Properties must be set:

| Key | Description |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API access token |
| `LINE_USER_ID` | Destination LINE user ID |

> `LINE_USER_ID` only needs to be retrieved once via Webhook.  
> Webhook is **not required** for normal alert operation.

---

## Getting Started

1. Create a Google Spreadsheet
2. Create `WATCH` and `LOG` sheets
3. Paste `Code.gs` into Apps Script
4. Set required Script Properties
5. Create a time trigger (weekday after close)
6. Run manually once to verify behavior

---

## Notes

- Japanese market holidays are not explicitly handled  
  (price fetch failure will be skipped automatically)
- Price data source can be replaced with other APIs
- Designed primarily for **personal use**

---

## Possible Enhancements

- JPX trading calendar support
- Percentage / day-over-day change alerts
- Multiple user support
- Redundant price data sources

## License
MIT License
