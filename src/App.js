import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { requestNotificationPermission, registerSW, scheduleNotifications, startForegroundCheck } from "./notifications";

// ★ 祝日API（holidays-jp.github.io）から動的取得・年別キャッシュ
const HCACHE = {};
async function fetchHolidays(year) {
  if (HCACHE[year]) return HCACHE[year];
  try {
    const res = await fetch(`https://holidays-jp.github.io/api/v1/${year}/date.json`);
    if (!res.ok) return {};
    const data = await res.json();
    HCACHE[year] = data;
    return data;
  } catch { return {}; }
}
const isHol = d => !!(d && HCACHE[d.slice(0,4)]?.[d]);
const holName = d => (d && HCACHE[d.slice(0,4)]?.[d]) || null;
const isRed = d => !!(d && (new Date(d).getDay() === 0 || isHol(d)));

// カラーテーマ
// ── JST日付ヘルパー（toISOString()はUTCなのでローカル時刻を使う）──
const localDate = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};

const C = {
  bg:"#28304e", bgSub:"#303860", surface:"#38426e", surfHov:"#424e80",
  border:"#4e5888",
  accent:"#99aaff", accentS:"rgba(153,170,255,.15)", accentG:"rgba(153,170,255,.3)",
  success:"#5ceeaa", successS:"rgba(92,238,170,.15)",
  warn:"#ffd077",   warnS:"rgba(255,208,119,.15)",
  danger:"#ff8899", dangerS:"rgba(255,136,153,.15)",
  info:"#77d8ff",   infoS:"rgba(119,216,255,.15)",
  text:"#eef2ff", textSub:"#c0c8e8", textMuted:"#9aa8cc",
};

const TAG_PRESETS = [
  {id:"t1",name:"仕事",  color:"#99aaff",parentId:null},
  {id:"t2",name:"個人",  color:"#5ceeaa",parentId:null},
  {id:"t3",name:"緊急",  color:"#ff8899",parentId:null},
  {id:"t4",name:"学習",  color:"#ffd077",parentId:null},
  {id:"t5",name:"健康",  color:"#77d8ff",parentId:null},
];
// 繰り返しタイプ（repeat フィールドはオブジェクト or 旧文字列に後方互換）
const REPEAT_TYPES = ["なし","毎日","平日のみ","毎週","毎月","毎年","カスタム"];
const DAYS_JP = ["月","火","水","木","金","土","日"];
const ALLOWED = ["w1HtaWxdSnMCV1miEm3yNF7g08J2","mszdWzOojoURpcIQdYdA3FRpQiG2"];
const SORTS   = ["デフォルト","開始日順","締切日順","タググループ順","完了を最後に"];

// ── ユーティリティ ──────────────────────────────────────────────────
const flatten = (ts, res=[], pt=null, pid=null) => {
  ts.forEach(t => {
    res.push({...t, _pt:pt, _pid:pid});
    if (t.children?.length) flatten(t.children, res, t.title, t.id);
  });
  return res;
};
const dimOf   = (y,m) => new Date(y,m+1,0).getDate();
const fd      = d => { if(!d) return ""; const x=new Date(d); return `${x.getMonth()+1}/${x.getDate()}`; };
const fdt     = (d,t) => !d ? "" : (t ? `${fd(d)} ${t}` : fd(d));
const sameDay = (a,b) => !!a && !!b && a.slice(0,10)===b.slice(0,10);
const weekDates = base => {
  const d=new Date(base), w=d.getDay(), m=new Date(d);
  m.setDate(d.getDate()-w+1);
  return Array.from({length:7},(_,i)=>{const x=new Date(m);x.setDate(m.getDate()+i);return localDate(x);});
};
const isLaterTask = t => !t.startDate && !t.startTime;

// ── 繰り返しユーティリティ ────────────────────────────────────────
// repeat フィールドは文字列（旧） or { type, weekDays, monthDays, customDates } (新)
const parseRepeat = r => {
  if (!r || r === "なし") return { type: "なし" };
  if (typeof r === "string") {
    if (r === "毎日")   return { type: "毎日" };
    if (r === "平日のみ") return { type: "平日のみ" };
    if (r === "毎週")   return { type: "毎週", weekDays: [] }; // 旧毎週→startDateの曜日で判定
    if (r === "毎月")   return { type: "毎月", monthDays: [] };
    return { type: "なし" };
  }
  return r; // 新オブジェクト形式
};

// date: "YYYY-MM-DD", task.startDate: "YYYY-MM-DD"
const matchesRepeat = (task, date) => {
  const r = parseRepeat(task.repeat);
  if (r.type === "なし") return false;
  // スキップ or 完了済みの日は非表示
  if ((task.skipDates || []).includes(date)) return false;
  // 別日に移動した元日は非表示（overrideDatesのキーが元の日付）
  if (task.overrideDates && task.overrideDates[date]) return false;
  if (r.type === "毎日") return true;
  if (r.type === "平日のみ") { const d = new Date(date).getDay(); return d >= 1 && d <= 5; }
  if (r.type === "毎週") {
    const days = r.weekDays && r.weekDays.length > 0
      ? r.weekDays
      : (task.startDate ? [new Date(task.startDate).getDay()] : []);
    return days.includes(new Date(date).getDay());
  }
  if (r.type === "毎月") {
    const days = r.monthDays && r.monthDays.length > 0
      ? r.monthDays
      : (task.startDate ? [new Date(task.startDate).getDate()] : []);
    return days.includes(new Date(date).getDate());
  }
  if (r.type === "毎年") {
    const ref = r.yearDate || task.startDate;
    if (!ref) return false;
    return date.slice(5) === ref.slice(5);
  }
  if (r.type === "カスタム") {
    return (r.customDates || []).includes(date);
  }
  return false;
};

// overrideDatesに保存された「今回だけ別日」のタスクを仮想タスクとして展開
// 各ビューのgetDay/todayTで使用する
const expandOverrides = (tasks) => {
  const extras = [];
  flatten(tasks).forEach(t => {
    if (!t.overrideDates) return;
    Object.entries(t.overrideDates).forEach(([origDate, ov]) => {
      extras.push({
        ...t,
        // オーバーライドの日時で上書き
        startDate:    ov.startDate    ?? t.startDate,
        startTime:    ov.startTime    ?? t.startTime,
        endDate:      ov.endDate      ?? t.endDate,
        endTime:      ov.endTime      ?? t.endTime,
        deadlineDate: ov.deadlineDate ?? t.deadlineDate,
        deadlineTime: ov.deadlineTime ?? t.deadlineTime,
        // 識別用
        _overrideKey: origDate,
        _overrideId:  t.id,
        id: t.id + "_ov_" + origDate, // 仮想ID（ポップアップ表示用）
        repeat: "なし", // 仮想タスクは繰り返しなし扱い
      });
    });
  });
  return extras;
};

// 繰り返しラベル表示用
const repeatLabel = r => {
  const p = parseRepeat(r);
  const JP_DAYS = ["日","月","火","水","木","金","土"];
  if (p.type === "なし")   return "なし";
  if (p.type === "毎日")   return "毎日";
  if (p.type === "平日のみ") return "平日のみ";
  if (p.type === "毎週") {
    if (!p.weekDays || p.weekDays.length === 0) return "毎週";
    return "毎週" + p.weekDays.map(d => JP_DAYS[d]).join("・");
  }
  if (p.type === "毎月") {
    if (!p.monthDays || p.monthDays.length === 0) return "毎月";
    return "毎月" + p.monthDays.join("・") + "日";
  }
  if (p.type === "毎年") {
    const ref = p.yearDate;
    return ref ? "毎年" + ref.slice(5).replace("-","/") : "毎年";
  }
  if (p.type === "カスタム") return "カスタム(" + (p.customDates||[]).length + "日)";
  return "なし";
};
const t2m  = t => { if(!t) return null; const[h,m]=t.split(":").map(Number); return h*60+m; };
const m2t  = m => `${String(Math.floor(Math.max(0,m)/60)%24).padStart(2,"0")}:${String(Math.max(0,m)%60).padStart(2,"0")}`;
const durFrom = (a,b) => { if(!a||!b) return null; const d=t2m(b)-t2m(a); return d>0?d:null; };
const addDur  = (a,d) => (!a||!d) ? "" : m2t(t2m(a)+Number(d));

// ★ タグ同期 - シンプルで確実な完全上書き方式
// ルール:
//   編集タスク → editedTags そのまま（親タグは子タグから自動補完）
//   編集タスクの子孫 → 既存タグを保持（親タグのみ補完）
//   他のタスク → 変更しない
//   ※子タスクのタグを親タスクに「伝播させない」（これが汚染の原因だった）
const syncTags = (tasks, editedId, editedTags, allTags) => {
  // 子タグIDから親タグIDを自動補完
  const withParents = tids => {
    const result = [...tids];
    tids.forEach(tid => {
      const tag = allTags.find(t => t.id === tid);
      if (tag?.parentId && !result.includes(tag.parentId)) result.push(tag.parentId);
    });
    return result;
  };

  const walk = (task) => {
    if (task.id === editedId) {
      // ★ 編集タスク：完全上書き（子タグから親タグを自動補完）
      return { ...task, tags: withParents(editedTags), children: (task.children||[]).map(c => walk(c)) };
    }
    // ★ 他タスク：タグは変更しない（ただし親タグだけ補完）
    return {
      ...task,
      tags: withParents(task.tags || []),
      children: (task.children||[]).map(c => walk(c))
    };
  };
  return tasks.map(t => walk(t));
};

// ★ 親子完了連動
// 子が全て完了 → 親も完了
// 子が1つでも未完了 → 親を強制的に未完了に戻す
const syncDone = tasks => {
  const up = t => {
    const ch = (t.children||[]).map(c => up(c));
    if (ch.length === 0) return {...t, children:ch};
    const allDone = ch.every(c => c.done);
    const anyUndone = ch.some(c => !c.done);
    // 子全完了→親完了。子に未完了あり→親を強制未完了
    return {...t, children:ch, done: anyUndone ? false : allDone};
  };
  return tasks.map(t => up(t));
};

// メモ
const renderMemo = (memo, onToggle) => {
  if (!memo) return null;

  // インライン装飾（太字・コード）をパース
  const renderInline = (text) => {
    const parts = [];
    // **bold** と `code` を処理
    const re = /(\*\*(.+?)\*\*|`(.+?)`)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      if (m[0].startsWith("**")) {
        parts.push(<strong key={m.index} style={{color:C.text,fontWeight:700}}>{m[2]}</strong>);
      } else {
        parts.push(<code key={m.index} style={{background:C.bg,color:C.accent,padding:"0 4px",borderRadius:3,fontSize:10,fontFamily:"monospace"}}>{m[3]}</code>);
      }
      last = re.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length ? parts : text;
  };

  return memo.split("\n").map((line, i) => {
    // チェックリスト
    const chk = line.match(/^- \[(x| )\] (.*)$/);
    if (chk) {
      const checked = chk[1]==="x";
      return (
        <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
          <div onClick={e=>{e.stopPropagation();e.preventDefault();onToggle&&onToggle(i);}}
            style={{width:13,height:13,borderRadius:3,border:`2px solid ${checked?C.accent:C.border}`,background:checked?C.accent:"transparent",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {checked && <span style={{color:"#fff",fontSize:8,fontWeight:800}}>✓</span>}
          </div>
          <span style={{fontSize:11,color:checked?C.textMuted:C.textSub,textDecoration:checked?"line-through":"none"}}>{renderInline(chk[2])}</span>
        </div>
      );
    }
    // 箇条書き "- " or "* "
    const bullet = line.match(/^([-*]) (.*)$/);
    if (bullet) {
      return (
        <div key={i} style={{display:"flex",alignItems:"baseline",gap:5,marginBottom:2}}>
          <span style={{color:C.accent,fontSize:10,flexShrink:0}}>•</span>
          <span style={{fontSize:11,color:C.textSub,lineHeight:1.4}}>{renderInline(bullet[2])}</span>
        </div>
      );
    }
    // 通常行（太字・コードインライン対応）
    return (
      <div key={i} style={{fontSize:11,color:C.textSub,marginBottom:1,lineHeight:1.4}}>
        {line ? renderInline(line) : <br/>}
      </div>
    );
  });
};
const toggleMemo = (memo, idx) => {
  const lines = memo.split("\n");
  const m = lines[idx]?.match(/^- \[(x| )\] (.*)$/);
  if (m) lines[idx] = `- [${m[1]==="x"?" ":"x"}] ${m[2]}`;
  return lines.join("\n");
};

// グローバルCSS
const G = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=DM+Sans:wght@500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#28304e;color:#eef2ff;font-family:'Noto Sans JP',sans-serif;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#4e5888;border-radius:4px}
input,textarea,select{font-family:'Noto Sans JP',sans-serif;outline:none;border:none;color:#eef2ff}
input[type=date],input[type=time],input[type=number],input[type=color]{color-scheme:light dark}
button{cursor:pointer;font-family:'Noto Sans JP',sans-serif;border:none;outline:none}
.hov:hover{background:rgba(153,170,255,0.07)!important}
.nb:hover{background:#424e80!important}
.acc:hover{filter:brightness(1.1);box-shadow:0 4px 14px rgba(153,170,255,.35)}.acc:active{transform:scale(.97)}
.mo{animation:fi .13s ease}.mc{animation:su .18s cubic-bezier(.34,1.56,.64,1)}
.drag{cursor:grab!important}.drag:active{cursor:grabbing!important;opacity:.5!important}
.rh{cursor:ns-resize!important}
.ew{cursor:ew-resize!important}
.tr .ta{opacity:0;transition:opacity .15s}.tr:hover .ta{opacity:1}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(8px) scale(.97);opacity:0}to{transform:none;opacity:1}}
`;

// 基本UI
const CB = ({checked,onChange,size=14,color}) => (
  <div onClick={e=>{e.stopPropagation();onChange();}}
    style={{width:size,height:size,borderRadius:Math.max(3,size*.22),border:`2px solid ${checked?(color||C.accent):C.border}`,background:checked?(color||C.accent):"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all .15s"}}>
    {checked && <span style={{color:"#fff",fontSize:size*.58,fontWeight:800,lineHeight:1}}>✓</span>}
  </div>
);

const Btn = ({children,onClick,v="ghost",style={},disabled,title}) => {
  const vs = {
    ghost:  {bg:"transparent",col:C.textSub,brd:`1px solid ${C.border}`,sh:"none"},
    accent: {bg:`linear-gradient(135deg,${C.accent},#bbccff)`,col:"#1a1e38",brd:"none",sh:"0 2px 10px rgba(153,170,255,.3)"},
    danger: {bg:C.dangerS,col:C.danger,brd:`1px solid ${C.danger}44`,sh:"none"},
    success:{bg:C.successS,col:C.success,brd:`1px solid ${C.success}44`,sh:"none"},
    subtle: {bg:C.surfHov,col:C.textSub,brd:`1px solid ${C.border}`,sh:"none"},
  };
  const s = vs[v];
  return (
    <button className={v==="accent"?"acc":""} onClick={onClick} disabled={disabled} title={title}
      style={{padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:600,transition:"all .15s",opacity:disabled?.4:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,background:s.bg,color:s.col,border:s.brd,boxShadow:s.sh,...style}}>
      {children}
    </button>
  );
};

const Modal = ({title,children,onClose,wide,noBackdropClose}) => (
  <div className="mo" onClick={noBackdropClose ? undefined : onClose} style={{position:"fixed",inset:0,background:"rgba(5,7,18,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:10,backdropFilter:"blur(5px)"}}>
    <div className="mc" onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:13,width:"100%",maxWidth:wide?700:490,border:`1px solid ${C.border}`,maxHeight:"92vh",overflow:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.7)"}}>
      <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:C.surface,zIndex:1,borderRadius:"13px 13px 0 0"}}>
        <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14}}>{title}</span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {noBackdropClose && <span style={{fontSize:8,color:C.textMuted}}>Esc でキャンセル / Ctrl+Enter で保存</span>}
          <button onClick={onClose} style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:24,height:24,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>
      <div style={{padding:"13px 16px"}}>{children}</div>
    </div>
  </div>
);

const Inp = ({label,value,onChange,type="text",placeholder=""}) => (
  <div style={{marginBottom:7}}>
    {label && <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>{label}</div>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:C.bgSub,color:C.text,padding:"6px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,transition:"border .15s"}}
      onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
  </div>
);

const Sel = ({label,value,onChange,options}) => (
  <div style={{marginBottom:7}}>
    {label && <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:C.bgSub,color:C.text,padding:"6px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12}}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const Pill = ({tag}) => (
  <span style={{display:"inline-flex",alignItems:"center",padding:"1px 5px",borderRadius:8,fontSize:9,fontWeight:700,color:tag.color,background:tag.color+"1c",border:`1px solid ${tag.color}44`,whiteSpace:"nowrap"}}>{tag.name}</span>
);

// ── 通知設定モーダル ────────────────────────────────────────────────
const NOTIFY_OPTIONS = [
  { value: 15,   label: "15分前" },
  { value: 30,   label: "30分前" },
  { value: 60,   label: "1時間前" },
  { value: 180,  label: "3時間前" },
  { value: 360,  label: "6時間前" },
  { value: 1440, label: "24時間前" },
];

const NotificationModal = ({settings, onSave, onClose}) => {
  const [enabled, setEnabled]       = useState(settings?.enabled ?? false);
  const [minutes, setMinutes]       = useState(settings?.minutesBefore ?? 60);
  const [permission, setPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "default");
  const [requesting, setRequesting] = useState(false);
  const [msg, setMsg]               = useState("");

  const handleEnable = async () => {
    if (enabled) { setEnabled(false); return; }
    setRequesting(true);
    const res = await requestNotificationPermission();
    setRequesting(false);
    if (res.ok) {
      setEnabled(true);
      setPermission("granted");
      setMsg("通知が有効になりました！");
    } else {
      setMsg(res.reason);
    }
  };

  const permColor = permission === "granted" ? C.success : permission === "denied" ? C.danger : C.warn;
  const permLabel = permission === "granted" ? "許可済み" : permission === "denied" ? "ブロック中" : "未設定";

  return (
    <Modal title="🔔 通知設定" onClose={onClose}>
      <div style={{background:C.bg,borderRadius:8,padding:"9px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:C.text}}>ブラウザ通知</div>
          <div style={{fontSize:9,color:C.textMuted,marginTop:2}}>OSの通知センターに届きます</div>
        </div>
        <span style={{fontSize:10,padding:"2px 9px",borderRadius:10,background:permColor+"22",color:permColor,fontWeight:700,border:`1px solid ${permColor}44`}}>{permLabel}</span>
      </div>
      <div style={{background:C.accentS,borderRadius:7,padding:"7px 10px",marginBottom:12,fontSize:10,color:C.textSub,border:`1px solid ${C.accent}33`}}>
        📱 <strong style={{color:C.accent}}>iPhoneの方へ</strong>：Safariでこのページをホーム画面に追加すると通知が届きます<br/>
        <span style={{fontSize:9,color:C.textMuted}}>共有ボタン → ホーム画面に追加 → iOS 16.4以降が必要</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,padding:"9px 12px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:C.text}}>締切・開始の通知</div>
          <div style={{fontSize:9,color:C.textMuted,marginTop:1}}>開始時刻・締切時刻の前 / 締切日のみは朝9:00</div>
        </div>
        <button onClick={handleEnable} disabled={requesting}
          style={{width:42,height:24,borderRadius:12,border:"none",cursor:"pointer",transition:"all .2s",background:enabled?C.accent:C.border,position:"relative",opacity:requesting?.6:1}}>
          <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:enabled?21:3,transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.3)"}}/>
        </button>
      </div>
      {enabled && (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>開始・締切時刻ありの場合の通知タイミング</div>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:6}}>※締切日のみ（時刻なし）は朝9:00に固定通知</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {NOTIFY_OPTIONS.map(o=>(
              <button key={o.value} onClick={()=>setMinutes(o.value)}
                style={{padding:"4px 10px",borderRadius:14,fontSize:10,border:`1px solid ${minutes===o.value?C.accent:C.border}`,background:minutes===o.value?C.accentS:"transparent",color:minutes===o.value?C.accent:C.textMuted,fontWeight:minutes===o.value?700:400,cursor:"pointer"}}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <div style={{fontSize:10,color:enabled?C.success:C.danger,marginBottom:8,padding:"5px 9px",background:enabled?C.successS:C.dangerS,borderRadius:6}}>{msg}</div>}
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn v="accent" onClick={()=>{onSave({enabled,minutesBefore:minutes});onClose();}}>保存</Btn>
      </div>
    </Modal>
  );
};

// ── ログイン ────────────────────────────────────────────────────────
const Login = ({onLogin,loading}) => (
  <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{textAlign:"center",padding:36}}>
      <div style={{width:62,height:62,borderRadius:18,background:`linear-gradient(135deg,${C.accent},#bbccff)`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontSize:26}}>✅</div>
      <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:24,marginBottom:4}}>
        <span style={{background:`linear-gradient(135deg,${C.accent},${C.info})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>マイタスク</span>
      </div>
      <div style={{color:C.textMuted,marginBottom:26,fontSize:12}}>あなただけのタスク管理</div>
      <button onClick={onLogin} disabled={loading}
        style={{display:"flex",alignItems:"center",gap:9,background:"#fff",color:"#333",border:"none",borderRadius:10,padding:"10px 24px",fontSize:13,fontWeight:700,cursor:"pointer",margin:"0 auto",opacity:loading?.7:1}}>
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {loading ? "ログイン中..." : "Googleでログイン"}
      </button>
    </div>
  </div>
);

// ── 確認ダイアログ ─────────────────────────────────────────────────
const ConfirmDialog = ({title, message, confirmLabel="削除", onConfirm, onCancel, danger=true}) => (
  <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(5,7,18,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16,backdropFilter:"blur(5px)"}}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:12,padding:20,width:"100%",maxWidth:320,border:`1px solid ${danger?C.danger+"55":C.border}`,boxShadow:"0 24px 64px rgba(0,0,0,.7)"}}>
      <div style={{fontWeight:700,fontSize:14,marginBottom:8,color:danger?C.danger:C.text}}>{title}</div>
      <div style={{fontSize:12,color:C.textSub,marginBottom:18,lineHeight:1.5}}>{message}</div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn onClick={onCancel} style={{padding:"6px 16px"}}>キャンセル</Btn>
        <Btn v={danger?"danger":"accent"} onClick={onConfirm} style={{padding:"6px 16px"}}>{confirmLabel}</Btn>
      </div>
    </div>
  </div>
);

// ── ポップアップ ────────────────────────────────────────────────────
const Popup = ({task,tags,onClose,onEdit,onToggle,onDelete,onMemoToggle,onDuplicate,onSkip,onOverride,anchor}) => {
  const tTags = tags.filter(t => task.tags?.includes(t.id) && t.parentId);
  const tc = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;
  const over = task.deadlineDate && !task.done && task.deadlineDate < localDate();
  // 繰り返しタスクかどうか（仮想オーバーライドタスクも含む）
  const isRepeat = (task.repeat && parseRepeat(task.repeat).type !== "なし") || !!task._overrideKey;
  // 今回の「本来の日付」（スキップ/移動のキー）
  const origDate = task._overrideKey || task.startDate || task.deadlineDate || "";
  // 今回だけ日程変更フォームの表示
  const [showOverride, setShowOverride] = useState(false);
  const [confirmDel, setConfirmDel]   = useState(false);
  const [ov, setOv] = useState({
    startDate: task.startDate||"", startTime: task.startTime||"",
    endDate: task.endDate||"",     endTime: task.endTime||"",
    deadlineDate: task.deadlineDate||"", deadlineTime: task.deadlineTime||"",
  });
  const ovInp = (k,v) => setOv(p=>({...p,[k]:v}));
  const inpStyle = {background:C.bgSub,color:C.text,padding:"3px 6px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:10,width:"100%"};
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:500}}>
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:Math.min(anchor?.y||80,window.innerHeight-420),left:Math.min(anchor?.x||80,window.innerWidth-308),background:C.surface,borderRadius:12,padding:13,border:`1px solid ${C.border}`,width:296,boxShadow:"0 16px 48px rgba(0,0,0,.68)",zIndex:501,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,borderRadius:"12px 12px 0 0",background:`linear-gradient(90deg,${tc},${tc}55)`}}/>
        <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8,marginTop:3}}>
          <CB checked={task.done} onChange={()=>{onToggle(task._overrideId||task.id);onClose();}} size={16} color={tc}/>
          <div style={{flex:1,minWidth:0}}>
            {task._pt && <div style={{fontSize:9,color:C.textMuted,marginBottom:1}}>📁 {task._pt}</div>}
            <div style={{fontSize:13,fontWeight:700,textDecoration:task.done?"line-through":"none",color:task.done?C.textMuted:C.text,lineHeight:1.3}}>{task.title}</div>
            {task._overrideKey && <div style={{fontSize:8,color:C.accent,marginTop:2}}>📅 今回だけ変更済み（元：{task._overrideKey}）</div>}
            {tTags.length>0 && <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:4}}>{tTags.map(t=><Pill key={t.id} tag={t}/>)}</div>}
          </div>
        </div>
        {(task.startDate||task.duration||task.deadlineDate||task.repeat!=="なし") && (
          <div style={{background:C.bg,borderRadius:7,padding:"6px 8px",marginBottom:8,fontSize:11,display:"flex",flexDirection:"column",gap:3}}>
            {task.startDate && <div style={{color:C.textSub,display:"flex",gap:4}}><span style={{color:C.accent}}>▶</span>{fdt(task.startDate,task.startTime)}{task.endDate&&<><span style={{color:C.textMuted}}>→</span>{fdt(task.endDate,task.endTime)}</>}</div>}
            {task.duration && <div style={{color:C.accent}}>⏱ {task.duration}分</div>}
            {task.deadlineDate && <div style={{color:over?C.danger:C.warn}}>⚠ {fdt(task.deadlineDate,task.deadlineTime)}</div>}
            {task.repeat && parseRepeat(task.repeat).type !== "なし" && <div style={{color:C.success}}>↻ {repeatLabel(task.repeat)}</div>}
          </div>
        )}
        {task.memo && <div onClick={e=>e.stopPropagation()} style={{background:C.bg,borderRadius:7,padding:"6px 8px",marginBottom:8,maxHeight:110,overflowY:"auto"}}>{renderMemo(task.memo, idx=>onMemoToggle(task._overrideId||task.id,idx))}</div>}

        {/* ── 繰り返しイレギュラーボタン ── */}
        {isRepeat && !showOverride && (
          <div style={{display:"flex",gap:4,marginBottom:8}}>
            <button onClick={()=>setShowOverride(true)}
              style={{flex:1,padding:"4px 6px",borderRadius:6,border:`1px solid ${C.accent}44`,background:C.accentS,color:C.accent,fontSize:9,cursor:"pointer",fontWeight:600}}>
              📅 今回だけ日程変更
            </button>
            <button onClick={()=>{onSkip(task._overrideId||task.id, origDate);onClose();}}
              style={{flex:1,padding:"4px 6px",borderRadius:6,border:`1px solid ${C.warn}44`,background:C.warnS,color:C.warn,fontSize:9,cursor:"pointer",fontWeight:600}}>
              ⏭ 今回だけスキップ
            </button>
          </div>
        )}

        {/* ── 今回だけ日程変更フォーム ── */}
        {showOverride && (
          <div style={{background:C.bg,borderRadius:8,padding:"8px 9px",marginBottom:8,border:`1px solid ${C.accent}44`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.accent,marginBottom:6}}>📅 今回だけ日程変更</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:4}}>
              <div>
                <div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>開始日</div>
                <input type="date" value={ov.startDate} onChange={e=>ovInp("startDate",e.target.value)} style={inpStyle}/>
              </div>
              <div>
                <div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>開始時刻</div>
                <input type="time" value={ov.startTime} onChange={e=>ovInp("startTime",e.target.value)} style={inpStyle}/>
              </div>
              <div>
                <div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>終了日</div>
                <input type="date" value={ov.endDate} onChange={e=>ovInp("endDate",e.target.value)} style={inpStyle}/>
              </div>
              <div>
                <div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>終了時刻</div>
                <input type="time" value={ov.endTime} onChange={e=>ovInp("endTime",e.target.value)} style={inpStyle}/>
              </div>
              <div>
                <div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>締切日</div>
                <input type="date" value={ov.deadlineDate} onChange={e=>ovInp("deadlineDate",e.target.value)} style={inpStyle}/>
              </div>
              <div>
                <div style={{fontSize:8,color:C.textMuted,marginBottom:2}}>締切時刻</div>
                <input type="time" value={ov.deadlineTime} onChange={e=>ovInp("deadlineTime",e.target.value)} style={inpStyle}/>
              </div>
            </div>
            <div style={{fontSize:8,color:C.textMuted,marginBottom:6}}>元の日付（キー）: {origDate}</div>
            <div style={{display:"flex",gap:4}}>
              <Btn onClick={()=>setShowOverride(false)} style={{flex:1,padding:"4px",fontSize:9}}>キャンセル</Btn>
              <Btn v="accent" onClick={()=>{onOverride(task._overrideId||task.id, origDate, ov);onClose();}} style={{flex:1,padding:"4px",fontSize:9}}>保存</Btn>
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:5}}>
          <Btn v="accent" onClick={()=>{onEdit(task._overrideKey ? {...task,id:task._overrideId} : task);onClose();}} style={{flex:1,padding:"5px 7px",fontSize:10}}>✎ 編集</Btn>
          <Btn v="success" onClick={()=>{onDuplicate(task._overrideKey ? {...task,id:task._overrideId} : task);onClose();}} style={{padding:"5px 8px",fontSize:10}} title="複製して編集">⧉</Btn>
          <Btn v="danger" onClick={()=>setConfirmDel(true)} style={{padding:"5px 8px",fontSize:10}} title="削除">✕</Btn>
        </div>
        {confirmDel && <ConfirmDialog title="タスクを削除" message={`「${task.title}」を削除しますか？\n子タスクも一緒に削除されます。`} onConfirm={()=>{onDelete(task._overrideId||task.id);onClose();}} onCancel={()=>setConfirmDel(false)}/>}
      </div>
    </div>
  );
};

// ── あとでやるパネル ────────────────────────────────────────────────
const LaterPanel = ({tasks,tags,dragTask,setDragTask,onEdit}) => {
  const later = flatten(tasks).filter(t => t.isLater || isLaterTask(t));
  const [open, setOpen] = useState(true);
  return (
    <div style={{width:open?168:28,flexShrink:0,background:C.surface,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden",transition:"width .2s"}}>
      <div style={{padding:"8px 8px 4px",flexShrink:0,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",minWidth:0}}>
        {open ? (
          <>
            <div>
              <div style={{fontSize:9,fontWeight:700,color:C.warn,textTransform:"uppercase",letterSpacing:1,whiteSpace:"nowrap"}}>📌 あとでやる</div>
              <div style={{fontSize:8,color:C.textMuted,marginTop:1,whiteSpace:"nowrap"}}>ドラッグで配置 / ✎で編集</div>
            </div>
            <button onClick={()=>setOpen(false)} title="閉じる"
              style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:13,lineHeight:1,flexShrink:0,padding:"0 2px"}}>‹</button>
          </>
        ) : (
          <button onClick={()=>setOpen(true)} title="あとでやるを開く"
            style={{background:"none",border:"none",color:C.warn,cursor:"pointer",fontSize:13,lineHeight:1,width:"100%",padding:"2px 0",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span>›</span>
            {later.length>0 && <span style={{fontSize:8,background:C.warnS,color:C.warn,borderRadius:8,padding:"1px 3px",fontWeight:700}}>{later.length}</span>}
          </button>
        )}
      </div>
      {open && later.length===0 && <div style={{fontSize:11,color:C.textMuted,textAlign:"center",padding:"12px 0",flex:1}}>なし</div>}
      {open && <div style={{flex:1,overflowY:"auto",padding:"4px 6px 6px"}}>
        {later.map(t => {
          const c = tags.find(tg=>t.tags?.includes(tg.id))?.color || C.accent;
          const isDragging = dragTask?.id===t.id;
          const childTag = tags.find(tg=>t.tags?.includes(tg.id)&&tg.parentId);
          return (
            <div key={t.id} style={{background:isDragging?C.accentS:C.bgSub,borderLeft:`3px solid ${c}`,borderRadius:"0 6px 6px 0",padding:"5px 6px",marginBottom:4,opacity:isDragging?.4:1,position:"relative"}}>
              <div draggable className="drag"
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("laterTaskId",t.id);setDragTask(t);}}
                onDragEnd={()=>setDragTask(null)}>
                {t._pt && <div style={{fontSize:8,color:C.textMuted,marginBottom:1}}>📁{t._pt}</div>}
                <div style={{fontSize:10,fontWeight:600,color:C.text,lineHeight:1.3,paddingRight:16}}>{t.title}</div>
                <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:2}}>
                  {t.duration && <span style={{fontSize:8,color:C.accent}}>⏱{t.duration}分</span>}
                  {t.deadlineDate && <span style={{fontSize:8,color:C.warn}}>⚠{fd(t.deadlineDate)}</span>}
                  {childTag && <Pill tag={childTag}/>}
                </div>
              </div>
              <button onClick={()=>onEdit(t)} title="編集"
                style={{position:"absolute",top:4,right:4,background:C.surfHov,color:C.textSub,border:"none",borderRadius:4,width:16,height:16,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>✎</button>
            </div>
          );
        })}
      </div>}
    </div>
  );
};

// ── メモエディター ─────────────────────────────────────────────────
const MemoEditor = ({value, onChange}) => {
  const [mode, setMode] = useState("write"); // "write" | "preview"
  const textareaRef = useRef(null);
  const cursorRef = useRef(null); // カーソル復元用

  // カーソル位置を復元（insertLine/insertAt後）
  useEffect(() => {
    if (cursorRef.current !== null && textareaRef.current) {
      const el = textareaRef.current;
      const {start, end} = cursorRef.current;
      el.selectionStart = start;
      el.selectionEnd = end;
      cursorRef.current = null;
    }
  });

  // Enterキーで箇条書き・チェックリストを自動継続
  const handleKeyDown = e => {
    if (e.key !== "Enter") return;
    const el = e.target;
    const pos = el.selectionStart;
    const text = el.value;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const line = text.slice(lineStart, pos);

    // チェックリスト継続: "- [ ] " or "- [x] "
    const checkMatch = line.match(/^(\s*)(- \[[ x]\] )/);
    if (checkMatch) {
      e.preventDefault();
      // 中身が空なら箇条書きを終了
      const content = line.slice(checkMatch[0].length).trim();
      if (!content) {
        const newVal = text.slice(0, lineStart) + text.slice(pos);
        onChange(newVal);
        setTimeout(() => { el.selectionStart = el.selectionEnd = lineStart; }, 0);
        return;
      }
      const insert = "\n" + checkMatch[1] + "- [ ] ";
      const newVal = text.slice(0, pos) + insert + text.slice(pos);
      onChange(newVal);
      setTimeout(() => { el.selectionStart = el.selectionEnd = pos + insert.length; }, 0);
      return;
    }

    // 箇条書き継続: "- " or "* "
    const listMatch = line.match(/^(\s*)([-*] )/);
    if (listMatch) {
      e.preventDefault();
      const content = line.slice(listMatch[0].length).trim();
      if (!content) {
        const newVal = text.slice(0, lineStart) + text.slice(pos);
        onChange(newVal);
        setTimeout(() => { el.selectionStart = el.selectionEnd = lineStart; }, 0);
        return;
      }
      const insert = "\n" + listMatch[1] + listMatch[2];
      const newVal = text.slice(0, pos) + insert + text.slice(pos);
      onChange(newVal);
      setTimeout(() => { el.selectionStart = el.selectionEnd = pos + insert.length; }, 0);
      return;
    }
  };

  // ツールバーボタン: テキストを挿入・変換
  const insertAt = (before, after = "") => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const s = el.selectionStart, e2 = el.selectionEnd;
    const sel = el.value.slice(s, e2);
    const newVal = el.value.slice(0, s) + before + sel + after + el.value.slice(e2);
    cursorRef.current = {start: s + before.length, end: s + before.length + sel.length};
    onChange(newVal);
  };

  const insertLine = prefix => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const pos = el.selectionStart;
    const text = el.value;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const lineEnd = text.indexOf("\n", pos);
    const end = lineEnd === -1 ? text.length : lineEnd;
    const line = text.slice(lineStart, end);

    let newVal, newCursor;
    if (line.startsWith(prefix)) {
      newVal = text.slice(0, lineStart) + line.slice(prefix.length) + text.slice(end);
      newCursor = Math.max(lineStart, pos - prefix.length);
    } else {
      newVal = text.slice(0, lineStart) + prefix + line + text.slice(end);
      newCursor = pos + prefix.length;
    }
    cursorRef.current = {start: newCursor, end: newCursor};
    onChange(newVal);
  };

  const tbBtn = (label, title, onClick) => (
    <button type="button" title={title} onClick={onClick}
      style={{padding:"2px 7px",borderRadius:5,fontSize:10,border:`1px solid ${C.border}`,background:"transparent",color:C.textSub,cursor:"pointer",fontWeight:600,lineHeight:1.4}}
      onMouseEnter={e=>e.currentTarget.style.background=C.surfHov}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      {label}
    </button>
  );

  return (
    <div style={{marginBottom:9}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <div style={{fontSize:9,color:C.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>メモ</div>
        <div style={{display:"flex",gap:3}}>
          <button onClick={()=>setMode(mode==="write"?"preview":"write")}
            style={{padding:"1px 8px",borderRadius:5,fontSize:9,border:`1px solid ${mode==="preview"?C.accent:C.border}`,background:mode==="preview"?C.accentS:"transparent",color:mode==="preview"?C.accent:C.textMuted,cursor:"pointer"}}>
            {mode==="write"?"👁 プレビュー":"✎ 編集"}
          </button>
        </div>
      </div>
      {mode==="write" && (
        <>
          {/* ツールバー */}
          <div style={{display:"flex",gap:3,marginBottom:4,flexWrap:"wrap"}}>
            {tbBtn("−","箇条書き",()=>insertLine("- "))}
            {tbBtn("☐","チェックリスト",()=>insertLine("- [ ] "))}
            {tbBtn("**B**","太字",()=>insertAt("**","**"))}
            {tbBtn("` `","コード",()=>insertAt("`","`"))}
          </div>
          <textarea
            ref={textareaRef}
            value={value} onChange={e=>onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={"メモ...\n- 箇条書き\n- [ ] チェック項目"}
            rows={4}
            style={{width:"100%",background:C.bgSub,color:C.text,padding:"7px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11,resize:"vertical",lineHeight:1.6}}
          />
          <div style={{fontSize:8,color:C.textMuted,marginTop:2}}>
            Enterで箇条書き・チェックを自動継続 / 空行Enterで終了
          </div>
        </>
      )}
      {mode==="preview" && (
        <div style={{background:C.bgSub,borderRadius:6,border:`1px solid ${C.border}`,padding:"7px 9px",minHeight:80,fontSize:11,lineHeight:1.6}}>
          {value ? renderMemo(value, null) : <span style={{color:C.textMuted}}>メモなし</span>}
        </div>
      )}
    </div>
  );
};

// ── 繰り返しエディター ─────────────────────────────────────────────
const JP_DAYS   = ["日","月","火","水","木","金","土"];
const WDAY_OPTS = [1,2,3,4,5,6,0]; // 月〜日の順
const MDAY_OPTS = Array.from({length:31},(_,i)=>i+1);

const RepeatEditor = ({value, onChange}) => {
  const r = parseRepeat(value);

  const setType = type => {
    if (type === "なし")   onChange("なし");
    else if (type === "毎日")   onChange("毎日");
    else if (type === "平日のみ") onChange("平日のみ");
    else if (type === "毎週")   onChange({type:"毎週",  weekDays:[]});
    else if (type === "毎月")   onChange({type:"毎月",  monthDays:[]});
    else if (type === "毎年")   onChange({type:"毎年",  yearDate:""});
    else if (type === "カスタム") onChange({type:"カスタム", customDates:[]});
  };

  const toggleWeekDay = d => {
    const cur = r.weekDays||[];
    const next = cur.includes(d) ? cur.filter(x=>x!==d) : [...cur,d];
    onChange({...r, weekDays:next});
  };
  const toggleMonthDay = d => {
    const cur = r.monthDays||[];
    const next = cur.includes(d) ? cur.filter(x=>x!==d) : [...cur,d].sort((a,b)=>a-b);
    onChange({...r, monthDays:next});
  };
  const toggleCustomDate = d => {
    const cur = r.customDates||[];
    const next = cur.includes(d) ? cur.filter(x=>x!==d) : [...cur,d].sort();
    onChange({...r, customDates:next});
  };

  const btnStyle = (active) => ({
    padding:"3px 8px", borderRadius:12, fontSize:10, cursor:"pointer", border:`1px solid ${active?C.success:C.border}`,
    background: active ? C.successS : "transparent",
    color: active ? C.success : C.textMuted,
    fontWeight: active ? 700 : 400,
    transition:"all .12s",
  });

  return (
    <div style={{marginBottom:9}}>
      <div style={{fontSize:9,color:C.textMuted,marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>繰り返し</div>
      {/* タイプ選択 */}
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
        {REPEAT_TYPES.map(t=>(
          <button key={t} onClick={()=>setType(t)} style={btnStyle(r.type===t)}>{t}</button>
        ))}
      </div>

      {/* 毎週：曜日選択 */}
      {r.type==="毎週" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:5}}>曜日を選択（複数可）</div>
          <div style={{display:"flex",gap:4}}>
            {WDAY_OPTS.map(d=>(
              <button key={d} onClick={()=>toggleWeekDay(d)}
                style={{...btnStyle((r.weekDays||[]).includes(d)), width:28, padding:"3px 0", textAlign:"center"}}>
                {JP_DAYS[d]}
              </button>
            ))}
          </div>
          {(r.weekDays||[]).length===0 && <div style={{fontSize:9,color:C.warn,marginTop:4}}>⚠ 曜日を1つ以上選んでください</div>}
        </div>
      )}

      {/* 毎月：日付選択 */}
      {r.type==="毎月" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:5}}>日付を選択（複数可）</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
            {MDAY_OPTS.map(d=>(
              <button key={d} onClick={()=>toggleMonthDay(d)}
                style={{...btnStyle((r.monthDays||[]).includes(d)), width:26, padding:"2px 0", textAlign:"center", fontSize:9}}>
                {d}
              </button>
            ))}
          </div>
          {(r.monthDays||[]).length===0 && <div style={{fontSize:9,color:C.warn,marginTop:4}}>⚠ 日付を1つ以上選んでください</div>}
        </div>
      )}

      {/* 毎年：月日指定 */}
      {r.type==="毎年" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
          <div style={{fontSize:9,color:C.textMuted}}>毎年</div>
          <input type="date" value={r.yearDate||""} onChange={e=>onChange({...r,yearDate:e.target.value})}
            style={{background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
          <div style={{fontSize:9,color:C.textMuted}}>の月日</div>
        </div>
      )}

      {/* カスタム：特定日付を複数指定 */}
      {r.type==="カスタム" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:5}}>日付を追加（複数可）</div>
          <div style={{display:"flex",gap:6,marginBottom:6,alignItems:"center"}}>
            <input type="date" id="customDateInput"
              style={{background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
            <Btn v="accent" style={{padding:"3px 10px",fontSize:10}} onClick={()=>{
              const el=document.getElementById("customDateInput");
              if (el?.value) { toggleCustomDate(el.value); el.value=""; }
            }}>追加</Btn>
          </div>
          {(r.customDates||[]).length>0 && (
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {(r.customDates||[]).map(d=>(
                <span key={d} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",borderRadius:10,background:C.successS,color:C.success,fontSize:9,border:`1px solid ${C.success}44`}}>
                  {d.slice(5).replace("-","/")}
                  <button onClick={()=>toggleCustomDate(d)} style={{background:"none",border:"none",color:C.success,cursor:"pointer",fontSize:10,lineHeight:1,padding:0}}>×</button>
                </span>
              ))}
            </div>
          )}
          {(r.customDates||[]).length===0 && <div style={{fontSize:9,color:C.warn}}>⚠ 日付を1つ以上追加してください</div>}
        </div>
      )}
    </div>
  );
};

// ── タスクフォーム ──────────────────────────────────────────────────
const TaskForm = ({task,tags,onSave,onClose,isChild,defDate,defTime,parentTags}) => {
  const blank = {id:"task_"+Date.now(),title:"",done:false,tags:[],memo:"",startDate:defDate||"",startTime:defTime||"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",duration:"",children:[],isLater:false};
  // ★ 子タスク作成時は親タスクのタグを初期値に設定
  const initTags = isChild && parentTags ? parentTags : (task?.tags || []);
  const [f, setF] = useState(task ? {...task, tags:initTags} : {...blank, tags:initTags});
  const u = (k,v) => setF(p => ({...p,[k]:v}));

  // ★ タグ：1タスク1つのみ。選択済みを再クリックで解除
  const togTag = tid => {
    if (isChild && parentTags?.length > 0) return; // 子タスクは固定
    if (f.tags.includes(tid)) {
      u("tags", []); // 解除
    } else {
      u("tags", [tid]); // 1つだけ選択
    }
  };

  // Esc でキャンセル、Ctrl+Enter で保存
  useEffect(() => {
    const handler = e => {
      if (e.key === "Escape") { onClose(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        if (f.title.trim()) { onSave({...f, isLater:isLaterTask(f)}); onClose(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [f, onSave, onClose]);

  const hSt  = v => { u("startTime",v); if(f.duration&&v) u("endTime",addDur(v,Number(f.duration))); else if(f.endTime&&v){const d=durFrom(v,f.endTime);if(d)u("duration",String(d));} };
  const hEt  = v => { u("endTime",v);   if(f.startTime&&v){const d=durFrom(f.startTime,v);if(d)u("duration",String(d));} };
  const hDur = v => { u("duration",v);  if(f.startTime&&v) u("endTime",addDur(f.startTime,Number(v))); };

  const pt = tags.filter(t => !t.parentId && !t.archived);
  const ct = pid => tags.filter(t => t.parentId===pid && !t.archived);
  const tagLocked = isChild && parentTags && parentTags.length > 0;

  return (
    <Modal title={task?"タスクを編集":isChild?"子タスクを追加":"タスクを追加"} onClose={onClose} wide noBackdropClose>
      <Inp label="タスク名 *" value={f.title} onChange={v=>u("title",v)} placeholder="タスク名..."/>
      {/* タグ：1つのみ選択。子タスクは親タスクのタグで固定 */}
      <div style={{marginBottom:9}}>
        <div style={{fontSize:9,color:C.textMuted,marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>
          タグ（1つのみ選択）{tagLocked && <span style={{color:C.warn,marginLeft:5,fontWeight:400,textTransform:"none"}}>※親タスクのタグで固定</span>}
        </div>
        {tagLocked ? (
          // 子タスクは固定表示
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {parentTags.map(tid => {
              const tg = tags.find(t=>t.id===tid);
              return tg ? <div key={tid} style={{display:"inline-flex",padding:"3px 10px",borderRadius:14,fontSize:11,fontWeight:700,border:`1.5px solid ${tg.color}`,background:tg.color+"1e",color:tg.color}}>{tg.name} 🔒</div> : null;
            })}
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {pt.map(p => (
              <div key={p.id}>
                <div onClick={()=>togTag(p.id)} style={{display:"inline-flex",padding:"3px 10px",borderRadius:14,fontSize:11,fontWeight:700,cursor:"pointer",border:`1.5px solid ${p.color}55`,background:f.tags.includes(p.id)?p.color+"1e":"transparent",color:f.tags.includes(p.id)?p.color:C.textMuted,marginBottom:3,transition:"all .15s"}}>{p.name}</div>
                {ct(p.id).length>0 && (
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,paddingLeft:10}}>
                    {ct(p.id).map(c => (
                      <div key={c.id} onClick={()=>togTag(c.id)} style={{display:"inline-flex",padding:"2px 8px",borderRadius:14,fontSize:10,fontWeight:600,cursor:"pointer",border:`1.5px solid ${c.color}55`,background:f.tags.includes(c.id)?c.color+"1e":"transparent",color:f.tags.includes(c.id)?c.color:C.textMuted,transition:"all .15s"}}>└ {c.name}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 日時 */}
      <div style={{background:C.bgSub,borderRadius:8,padding:9,marginBottom:8}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
          <Inp label="📅 開始日" value={f.startDate} onChange={v=>u("startDate",v)} type="date"/>
          <Inp label="開始時刻" value={f.startTime} onChange={hSt} type="time"/>
          <div style={{marginBottom:7}}>
            <div style={{fontSize:9,color:C.accent,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>⏱ 所要(分)</div>
            <input type="number" min="0" value={f.duration} onChange={e=>hDur(e.target.value)} placeholder="60"
              style={{width:"100%",background:C.surface,color:C.text,padding:"6px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12}}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:7}}>
          <Inp label="⏹ 終了日" value={f.endDate} onChange={v=>u("endDate",v)} type="date"/>
          <Inp label="終了時刻" value={f.endTime} onChange={hEt} type="time"/>
          <Inp label="⚠️ 締切日" value={f.deadlineDate} onChange={v=>u("deadlineDate",v)} type="date"/>
          <Inp label="締切時刻" value={f.deadlineTime} onChange={v=>u("deadlineTime",v)} type="time"/>
        </div>
      </div>
      <div style={{fontSize:9,color:C.textMuted,marginBottom:8,padding:"4px 8px",background:C.accentS,borderRadius:5,border:`1px solid ${C.accent}33`}}>
        💡 開始日未設定→「あとでやる」リストへ
      </div>
      {/* ── 繰り返しUI ── */}
      <RepeatEditor value={f.repeat} onChange={v=>u("repeat",v)}/>
      <MemoEditor value={f.memo} onChange={v=>u("memo",v)}/>
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn v="accent" onClick={()=>{if(f.title.trim()){onSave({...f,isLater:isLaterTask(f)});onClose();}}}>保存</Btn>
      </div>
    </Modal>
  );
};

// ── タスク行 ────────────────────────────────────────────────────────
const TaskRow = ({task,tags,depth=0,onEdit,onDelete,onToggle,onAddChild,onDuplicate,onMemoToggle}) => {
  const [exp, setExp]             = useState(true);
  const [memoOpen, setMemoOpen]   = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const tTags = tags.filter(t => task.tags?.includes(t.id) && t.parentId);
  const today = localDate();
  const over   = task.deadlineDate && !task.done && task.deadlineDate < today;
  const urgent = task.deadlineDate && !task.done && task.deadlineDate === today;
  const later  = task.isLater || isLaterTask(task);
  const tc = tags.find(t => task.tags?.includes(t.id))?.color || C.accent;
  const hasMemo = !!task.memo;
  return (
    <div style={{marginLeft:depth*16}}>
      <div className="hov tr" style={{display:"flex",alignItems:"flex-start",gap:6,padding:"5px 9px",borderRadius:memoOpen?`7px 7px 0 0`:7,marginBottom:memoOpen?0:2,background:depth===0?C.surface:C.bgSub,border:`1px solid ${over?C.danger+"55":depth===0?C.border:"transparent"}`,borderLeft:depth>0?`3px solid ${tc}55`:undefined,opacity:task.done?.45:1,transition:"opacity .15s"}}>
        <div style={{paddingTop:1,flexShrink:0}}><CB checked={task.done} onChange={()=>onToggle(task.id)} color={tc}/></div>
        <div style={{flex:1,minWidth:0,cursor:hasMemo?"pointer":"default"}} onClick={hasMemo?()=>setMemoOpen(o=>!o):undefined}>
          <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap",marginBottom:1}}>
            {task.children?.length>0 && <span onClick={e=>{e.stopPropagation();setExp(!exp);}} style={{cursor:"pointer",fontSize:8,color:C.textMuted,transform:exp?"rotate(90deg)":"",transition:"transform .15s",display:"inline-block"}}>▶</span>}
            <span style={{fontSize:12,fontWeight:depth===0?600:400,textDecoration:task.done?"line-through":"none",color:task.done?C.textMuted:C.text}}>{task.title}</span>
            {task.repeat && parseRepeat(task.repeat).type !== "なし" && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.successS,color:C.success,fontWeight:600}}>↻{repeatLabel(task.repeat)}</span>}
            {later  && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>📌</span>}
            {over   && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.dangerS,color:C.danger,fontWeight:600}}>⚠超過</span>}
            {urgent && <span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>🔥今日</span>}
            {hasMemo && <span style={{fontSize:8,color:C.textMuted,opacity:.6}}>{memoOpen?"▲":"📝"}</span>}
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
            {tTags.map(t=><Pill key={t.id} tag={t}/>)}
            {task.startDate && <span style={{fontSize:9,color:C.textMuted}}>▶{fdt(task.startDate,task.startTime)}</span>}
            {task.duration  && <span style={{fontSize:9,color:C.accent}}>⏱{task.duration}分</span>}
            {task.deadlineDate && <span style={{fontSize:9,color:over?C.danger:C.warn}}>⚠{fdt(task.deadlineDate,task.deadlineTime)}</span>}
          </div>
        </div>
        <div className="ta" style={{display:"flex",gap:3,flexShrink:0}}>
          <button title="子タスク追加" onClick={()=>onAddChild(task.id)} style={{background:C.accentS,color:C.accent,border:"none",borderRadius:6,width:28,height:28,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
          <button title="複製して編集"  onClick={()=>onDuplicate(task)} style={{background:C.successS,color:C.success,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>⧉</button>
          <button title="編集"          onClick={()=>onEdit(task)}      style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button>
          <button title="削除" onClick={()=>setConfirmDel(true)} style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:6,width:28,height:28,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          {confirmDel && <ConfirmDialog title="タスクを削除" message={`「${task.title}」を削除しますか？
子タスクも一緒に削除されます。`} onConfirm={()=>{onDelete(task.id);setConfirmDel(false);}} onCancel={()=>setConfirmDel(false)}/>}
        </div>
      </div>
      {/* ── メモ展開パネル ── */}
      {memoOpen && hasMemo && (
        <div style={{background:depth===0?C.surface:C.bgSub,borderTop:`1px solid ${C.border}22`,borderRadius:`0 0 7px 7px`,padding:"6px 12px 8px 36px",marginBottom:2,border:`1px solid ${over?C.danger+"55":depth===0?C.border:"transparent"}`,borderLeft:depth>0?`3px solid ${tc}55`:undefined}}>
          {renderMemo(task.memo, onMemoToggle ? idx=>onMemoToggle(task.id,idx) : null)}
        </div>
      )}
      {exp && task.children?.map(c=><TaskRow key={c.id} task={c} tags={tags} depth={depth+1} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)}
    </div>
  );
};

// ── リストビュー ────────────────────────────────────────────────────
const ListView = ({tasks,tags,filters,onEdit,onDelete,onToggle,onAddChild,onDuplicate,onMemoToggle,sortOrder,setSortOrder}) => {
  const filtered = useMemo(() => {
    let list = tasks;
    if (filters.tag)           list = list.filter(t => t.tags?.includes(filters.tag));
    if (filters.search)        list = list.filter(t => t.title.toLowerCase().includes(filters.search.toLowerCase()));
    if (filters.hideCompleted) list = list.filter(t => !t.done);
    if (sortOrder==="開始日順")     list = [...list].sort((a,b) => (a.startDate||"9")>(b.startDate||"9")?1:-1);
    else if (sortOrder==="締切日順") list = [...list].sort((a,b) => (a.deadlineDate||"9")>(b.deadlineDate||"9")?1:-1);
    else if (sortOrder==="タググループ順") list = [...list].sort((a,b) => (a.tags?.[0]||"")>(b.tags?.[0]||"")?1:-1);
    else if (sortOrder==="完了を最後に") list = [...list].sort((a,b) => a.done===b.done?0:a.done?1:-1);
    return list;
  }, [tasks, filters, sortOrder]);
  const later   = filtered.filter(t => t.isLater||isLaterTask(t));
  const habits  = filtered.filter(t => !(t.isLater||isLaterTask(t)) && t.repeat && parseRepeat(t.repeat).type !== "なし");
  const regular = filtered.filter(t => !(t.isLater||isLaterTask(t)) && (!t.repeat || parseRepeat(t.repeat).type === "なし"));
  const Sec = ({title,items,color,icon}) => items.length===0 ? null : (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
        <span>{icon}</span>
        <span style={{fontSize:10,fontWeight:700,color,textTransform:"uppercase",letterSpacing:.6}}>{title}</span>
        <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>{items.length}</span>
      </div>
      {items.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate} onMemoToggle={onMemoToggle}/>)}
    </div>
  );
  // PCか判定（768px以上）
  const [isPC, setIsPC] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const fn = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const sortBar = (
    <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:11,flexWrap:"wrap"}}>
      <span style={{fontSize:9,color:C.textMuted,fontWeight:600}}>並び替え</span>
      {SORTS.map(s=><button key={s} onClick={()=>setSortOrder(s)} style={{fontSize:9,padding:"2px 7px",borderRadius:14,border:`1px solid ${sortOrder===s?C.accent:C.border}`,background:sortOrder===s?C.accentS:"transparent",color:sortOrder===s?C.accent:C.textMuted,cursor:"pointer",fontWeight:sortOrder===s?700:400}}>{s}</button>)}
    </div>
  );

  if (isPC) {
    // PC: 2カラムレイアウト（左=習慣+あとでやる、右=通常タスク）
    return (
      <div>
        {sortBar}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"}}>
          <div>
            <Sec title="習慣・繰り返し" items={habits} color={C.success} icon="🔄"/>
            <Sec title="あとでやる"     items={later}  color={C.warn}   icon="📌"/>
            {habits.length===0 && later.length===0 && <div style={{textAlign:"center",padding:"24px 0",color:C.textMuted,fontSize:12}}>習慣・あとでやるなし</div>}
          </div>
          <div>
            <Sec title="タスク" items={regular} color={C.accent} icon="📋"/>
            {regular.length===0 && <div style={{textAlign:"center",padding:"24px 0",color:C.textMuted,fontSize:12}}>タスクなし 🎉</div>}
          </div>
        </div>
        {filtered.length===0 && <div style={{textAlign:"center",padding:"36px 0",color:C.textMuted}}><div style={{fontSize:36,marginBottom:7}}>🎉</div>タスクがありません</div>}
      </div>
    );
  }

  return (
    <div>
      {sortBar}
      <Sec title="習慣・繰り返し" items={habits}  color={C.success} icon="🔄"/>
      <Sec title="タスク"         items={regular} color={C.accent}  icon="📋"/>
      <Sec title="あとでやる"     items={later}   color={C.warn}    icon="📌"/>
      {filtered.length===0 && <div style={{textAlign:"center",padding:"36px 0",color:C.textMuted}}><div style={{fontSize:36,marginBottom:7}}>🎉</div>タスクがありません</div>}
    </div>
  );
};

// ★ タイムラインチップ（開始〜終了の高さにまたがる）
const TimelineChip = ({task,tags,color,startMin,endMin,dayStartMin,ppm,onPopup,onToggle,onUpdate,onRSStart}) => {
  const top  = (startMin - dayStartMin) * ppm;
  const h    = Math.max(22, (endMin - startMin) * ppm);
  const over = task.deadlineDate && !task.done && task.deadlineDate < localDate();
  return (
    <div className="drag" draggable
      onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",task.id);e.stopPropagation();}}
      onClick={e=>{e.stopPropagation();onPopup(e,task);}}
      style={{position:"absolute",top,left:1,right:1,height:h,background:task.done?C.border+"38":color+"22",borderLeft:`3px solid ${task.done?C.textMuted:color}`,borderRadius:"0 5px 5px 0",overflow:"hidden",display:"flex",flexDirection:"column",justifyContent:"space-between",zIndex:2,userSelect:"none",cursor:"grab",opacity:task.done?.5:1}}>
      <div style={{padding:"2px 5px 0",flex:1,minHeight:0,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <div onClick={e=>{e.stopPropagation();onToggle(task.id);}} style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${task.done?C.textMuted:color}`,background:task.done?color:"transparent",flexShrink:0,cursor:"pointer"}}/>
          <span style={{fontSize:10,fontWeight:600,color:task.done?C.textMuted:color,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration:task.done?"line-through":"none"}}>
            {task.startTime} {task.title}
          </span>
          {over && <span style={{fontSize:7,color:C.danger,flexShrink:0}}>⚠</span>}
        </div>
        {h > 34 && task.endTime && <div style={{fontSize:8,color:color,paddingLeft:11,opacity:.8}}>〜{task.endTime}（{task.duration}分）</div>}
        {h > 48 && task._pt    && <div style={{fontSize:7,color:C.textMuted,paddingLeft:11}}>📁{task._pt}</div>}
      </div>
      {/* ★ リサイズハンドル（下端ドラッグで終了時刻を変更） */}
      <div className="rh" onMouseDown={e=>onRSStart(e,task)} onTouchStart={e=>onRSStart(e,task)} onClick={e=>e.stopPropagation()}
        style={{height:7,background:color+"30",borderTop:`1px dashed ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <div style={{width:14,height:1.5,borderRadius:1,background:color+"88"}}/>
      </div>
    </div>
  );
};

// ── 日ビュー ────────────────────────────────────────────────────────
const DayView = ({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,dragTask,setDragTask}) => {
  const DAY_START = 6;
  const DAY_END   = 23;
  const PPM       = 1.2;   // pixel per minute（1時間=72px）
  const HH        = 60 * PPM;
  const [popup, setPopup]   = useState(null);
  const [dropH, setDropH]   = useState(null);
  const [holReady, setHolReady] = useState(false);
  const all = flatten(tasks);

  useEffect(() => { fetchHolidays(today.slice(0,4)).then(()=>setHolReady(true)); }, [today]);

  const todayT = [
    ...all.filter(t => {
      if (t.repeat && parseRepeat(t.repeat).type !== "なし") return matchesRepeat(t, today);
      return sameDay(t.startDate,today) || sameDay(t.deadlineDate,today);
    }),
    ...expandOverrides(tasks).filter(t => sameDay(t.startDate,today) || sameDay(t.deadlineDate,today)),
  ];
  const timed   = todayT.filter(t =>  t.startTime && !(t.isLater||isLaterTask(t)));
  const untimed = todayT.filter(t => !t.startTime && !(t.isLater||isLaterTask(t)));

  const hp = (e,task) => { const r=e.currentTarget.getBoundingClientRect(); setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350)}); };
  const hMemo = (id,idx) => { const t=all.find(x=>x.id===id); if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)}); setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null); };
  // 繰り返しタスクのトグルには日付を渡す
  const hToggle = (id) => { const t=all.find(x=>x.id===id); const isRep=t?.repeat&&parseRepeat(t.repeat).type!=="なし"; onToggle(id, isRep?today:undefined); };

  // リサイズ：下端ドラッグで所要時間変更
  const rsRef=useRef(false), rsTask=useRef(null), rsY=useRef(0), rsDur=useRef(0);
  const onRSStart = useCallback((e,task) => {
    e.stopPropagation(); e.preventDefault();
    rsRef.current=true; rsTask.current=task;
    rsY.current=e.clientY||(e.touches?.[0]?.clientY)||0;
    rsDur.current=Number(task.duration)||60;
    const mv = ev => {
      if (!rsRef.current) return;
      const y = ev.clientY||(ev.touches?.[0]?.clientY)||0;
      const nd = Math.max(15, Math.round((rsDur.current+(y-rsY.current)/PPM)/15)*15);
      onUpdate({...rsTask.current, duration:String(nd), endTime:rsTask.current.startTime?addDur(rsTask.current.startTime,nd):""});
    };
    const up = () => { rsRef.current=false; document.removeEventListener("mousemove",mv); document.removeEventListener("mouseup",up); document.removeEventListener("touchmove",mv); document.removeEventListener("touchend",up); };
    document.addEventListener("mousemove",mv); document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",mv,{passive:false}); document.addEventListener("touchend",up);
  }, [onUpdate]);

  const hDrop = (e, relY) => {
    e.preventDefault(); setDropH(null);
    const h = Math.max(DAY_START, Math.min(DAY_END-1, Math.floor(relY/HH)+DAY_START));
    const tid = e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
    const t   = tid ? all.find(x=>x.id===tid)||dragTask : dragTask;
    if (!t) return;
    const st = `${String(h).padStart(2,"0")}:00`;
    onUpdate({...t, startDate:today, startTime:st, endTime:t.duration?addDur(st,Number(t.duration)):"", isLater:false});
    setDragTask(null);
  };

  const now     = new Date();
  const isToday = today === localDate(now);
  const dayStartMin = DAY_START * 60;
  const totalH  = (DAY_END - DAY_START) * HH;

  return (
    <div>
      {/* ★ 時間未定タスクを最上部に表示 */}
      {untimed.length>0 && (
        <div style={{padding:"6px 9px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:8}}>
          <div style={{fontSize:9,fontWeight:700,color:C.textMuted,marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>時間未定</div>
          {untimed.map(t => {
            const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
            return (
              <div key={t.id} draggable className="drag"
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",t.id);setDragTask(t);}}
                onDragEnd={()=>setDragTask(null)}
                onClick={e=>hp(e,t)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"3px 6px",borderLeft:`3px solid ${c}`,borderRadius:"0 5px 5px 0",marginBottom:2,background:c+"18",cursor:"grab"}}>
                <div onClick={e=>{e.stopPropagation();hToggle(t.id);}} style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${t.done?C.textMuted:c}`,background:t.done?c:"transparent",flexShrink:0,cursor:"pointer"}}/>
                <span style={{fontSize:10,fontWeight:600,color:t.done?C.textMuted:c,textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                {t.deadlineDate && <span style={{fontSize:8,color:C.warn,marginLeft:"auto"}}>⚠{fd(t.deadlineDate)}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* ★ タイムライン本体：absoluteで高さをまたがる */}
      <div style={{display:"grid",gridTemplateColumns:"40px 1fr"}}>
        {/* 時刻ラベル */}
        <div style={{position:"relative",height:totalH}}>
          {Array.from({length:DAY_END-DAY_START},(_,i) => (
            <div key={i} style={{position:"absolute",top:i*HH-6,right:4,fontSize:9,color:C.textMuted,fontFamily:"'DM Sans',sans-serif",lineHeight:1,width:32,textAlign:"right"}}>
              {DAY_START+i}
            </div>
          ))}
        </div>
        {/* イベントエリア */}
        <div style={{position:"relative",height:totalH,borderLeft:`1px solid ${C.border}44`}}
          onDragOver={e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();setDropH(Math.floor((e.clientY-rect.top)/HH)+DAY_START);}}
          onDragLeave={()=>setDropH(null)}
          onDrop={e=>{const rect=e.currentTarget.getBoundingClientRect();hDrop(e,e.clientY-rect.top);}}
          onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();const h=Math.max(DAY_START,Math.min(DAY_END-1,Math.floor((e.clientY-rect.top)/HH)+DAY_START));onAdd(today,h);}}>
          {/* グリッド */}
          {Array.from({length:DAY_END-DAY_START},(_,i) => (
            <div key={i} style={{position:"absolute",top:i*HH,left:0,right:0,height:HH,borderTop:`1px solid ${C.border}20`}}>
              <div style={{position:"absolute",top:"50%",left:0,right:0,height:1,background:`${C.border}10`}}/>
            </div>
          ))}
          {/* 現在時刻線 */}
          {isToday && (
            <div style={{position:"absolute",left:0,right:0,top:(now.getHours()*60+now.getMinutes()-dayStartMin)*PPM,height:2,background:C.danger,zIndex:3,pointerEvents:"none"}}>
              <div style={{width:5,height:5,borderRadius:"50%",background:C.danger,position:"absolute",left:-2.5,top:-1.5}}/>
            </div>
          )}
          {/* ドロップハイライト */}
          {dropH!==null && (
            <div style={{position:"absolute",top:(dropH-DAY_START)*HH,left:0,right:0,height:HH,background:C.accentS,border:`2px dashed ${C.accent}`,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.accent,pointerEvents:"none",zIndex:1}}>
              {dropH}:00{dragTask?` ← ${dragTask.title}`:""}
            </div>
          )}
          {/* ★ タスクチップ（開始〜終了にまたがる） */}
          {timed.map(t => {
            const c  = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
            const sm = t2m(t.startTime)||0;
            const dur = Number(t.duration)||60;
            const em = t.endTime ? t2m(t.endTime) : sm+dur;
            return <TimelineChip key={t.id} task={t} tags={tags} color={c} startMin={sm} endMin={em} dayStartMin={dayStartMin} ppm={PPM} onPopup={hp} onToggle={onToggle} onUpdate={onUpdate} onRSStart={onRSStart}/>;
          })}
        </div>
      </div>
      {popup && <Popup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo} onSkip={(id,date)=>{onSkip(id,date);setPopup(null);}} onOverride={(id,orig,ov)=>{onOverride(id,orig,ov);setPopup(null);}}/> }
    </div>
  );
};

// ── 週ビュー ────────────────────────────────────────────────────────
const WeekView = ({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,dragTask,setDragTask}) => {
  const DAY_START = 6;
  const DAY_END   = 23;
  const PPM       = 0.85;
  const HH        = 60 * PPM;
  const wd = weekDates(today);
  const [popup, setPopup]     = useState(null);
  const [holReady,setHolReady]= useState(false);

  useEffect(() => {
    const years = [...new Set(wd.map(d=>d.slice(0,4)))];
    Promise.all(years.map(y=>fetchHolidays(y))).then(()=>setHolReady(true));
  }, [wd.join(",")]);

  const all = flatten(tasks);
  const getDay = date => [
    ...all.filter(t => {
      if (t.repeat && parseRepeat(t.repeat).type !== "なし") return matchesRepeat(t, date);
      return sameDay(t.startDate,date)||sameDay(t.deadlineDate,date);
    }),
    ...expandOverrides(tasks).filter(t => sameDay(t.startDate,date)||sameDay(t.deadlineDate,date)),
  ].filter(t => !(t.isLater||isLaterTask(t)));

  const hp = (e,task) => { const r=e.currentTarget.getBoundingClientRect(); setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350)}); };
  const hMemo = (id,idx) => { const t=all.find(x=>x.id===id); if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)}); setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null); };
  const hToggle = (id, date) => { const t=all.find(x=>x.id===id); const isRep=t?.repeat&&parseRepeat(t.repeat).type!=="なし"; onToggle(id, isRep?(date||localDate()):undefined); };

  const rsRef=useRef(false),rsTask=useRef(null),rsY=useRef(0),rsDur=useRef(0);
  const onRSStart = useCallback((e,task) => {
    e.stopPropagation(); e.preventDefault();
    rsRef.current=true; rsTask.current=task;
    rsY.current=e.clientY||(e.touches?.[0]?.clientY)||0; rsDur.current=Number(task.duration)||60;
    const mv = ev => {
      if (!rsRef.current) return;
      const y = ev.clientY||(ev.touches?.[0]?.clientY)||0;
      const nd = Math.max(15,Math.round((rsDur.current+(y-rsY.current)/PPM)/15)*15);
      onUpdate({...rsTask.current, duration:String(nd), endTime:rsTask.current.startTime?addDur(rsTask.current.startTime,nd):""});
    };
    const up = () => { rsRef.current=false; document.removeEventListener("mousemove",mv); document.removeEventListener("mouseup",up); document.removeEventListener("touchmove",mv); document.removeEventListener("touchend",up); };
    document.addEventListener("mousemove",mv); document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",mv,{passive:false}); document.addEventListener("touchend",up);
  }, [onUpdate]);

  const dayStartMin = DAY_START * 60;
  const totalH      = (DAY_END - DAY_START) * HH;

  return (
    <div style={{overflowX:"auto"}}>
      {/* ★ 週ビュー時間未定タスク（最上部） */}
      {(() => {
        const rows = wd.map(d => ({d, ts:getDay(d).filter(t=>!t.startTime)}));
        if (!rows.some(r=>r.ts.length>0)) return null;
        return (
          <div style={{display:"grid",gridTemplateColumns:"38px repeat(7,1fr)",minWidth:540,marginBottom:3,background:C.surface,borderRadius:"8px 8px 0 0",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:7,color:C.textMuted,padding:"6px 3px 4px",textAlign:"right",borderRight:`1px solid ${C.border}20`}}>未定</div>
            {rows.map(({d,ts}) => {
              const isSat=new Date(d).getDay()===6, isR=isRed(d);
              return (
                <div key={d} style={{padding:"3px 2px",minHeight:22,borderLeft:`1px solid ${C.border}20`,background:isSat?"rgba(119,216,255,.04)":isR?"rgba(255,136,153,.04)":"transparent"}}>
                  {ts.map(t => {
                    const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
                    return (
                      <div key={t.id}
                        style={{display:"flex",alignItems:"center",gap:3,padding:"2px 3px",borderLeft:`2px solid ${c}`,marginBottom:1,background:c+"15",borderRadius:"0 3px 3px 0",overflow:"hidden"}}>
                        <div draggable className="drag"
                          onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",t.id);setDragTask(t);e.stopPropagation();}}
                          onDragEnd={()=>setDragTask(null)}
                          onClick={e=>hp(e,t)}
                          style={{display:"flex",alignItems:"center",gap:3,flex:1,minWidth:0,cursor:"grab"}}>
                          <div onClick={e=>{e.stopPropagation();hToggle(t.id,date);}} style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${t.done?C.textMuted:c}`,background:t.done?c:"transparent",flexShrink:0,cursor:"pointer"}}/>
                          <span style={{fontSize:8,fontWeight:600,color:t.done?C.textMuted:c,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })()}

      <div style={{display:"grid",gridTemplateColumns:"38px repeat(7,1fr)",minWidth:540}}>
        {/* ヘッダー */}
        <div/>
        {wd.map((d,i) => {
          const isT=d===today, dt=new Date(d), isSat=dt.getDay()===6, isR=isRed(d);
          const hName = holName(d);
          return (
            <div key={d} style={{padding:"4px 2px",textAlign:"center",borderBottom:`2px solid ${isT?C.accent:C.border}`,color:isT?C.accent:isSat?C.info:isR?C.danger:C.textSub}} title={hName||undefined}>
              <div style={{fontSize:8,fontWeight:700}}>{DAYS_JP[i]}{hName?<span style={{fontSize:7}}> 祝</span>:null}</div>
              <div style={{fontSize:13,fontWeight:isT?700:400,fontFamily:"'DM Sans',sans-serif"}}>{dt.getDate()}</div>
            </div>
          );
        })}
        {/* 時刻ラベル */}
        <div style={{position:"relative",height:totalH}}>
          {Array.from({length:DAY_END-DAY_START},(_,i) => (
            <div key={i} style={{position:"absolute",top:i*HH-6,right:3,fontSize:8,color:C.textMuted,fontFamily:"'DM Sans',sans-serif",lineHeight:1}}>{DAY_START+i}</div>
          ))}
        </div>
        {/* 各日カラム */}
        {wd.map(d => {
          const dayTasks = getDay(d).filter(t => !!t.startTime);
          const isSat=new Date(d).getDay()===6, isR=isRed(d);
          return (
            <div key={d} style={{position:"relative",height:totalH,borderLeft:`1px solid ${C.border}20`,background:isSat?"rgba(119,216,255,.04)":isR?"rgba(255,136,153,.04)":"transparent"}}
              onDragOver={e=>e.preventDefault()}
              onDrop={e=>{
                e.preventDefault();
                const tid=e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
                const task=tid?all.find(x=>x.id===tid)||dragTask:dragTask;
                if (!task) return;
                const rect=e.currentTarget.getBoundingClientRect();
                const h=Math.max(DAY_START,Math.min(DAY_END-1,Math.floor((e.clientY-rect.top)/HH)+DAY_START));
                const st=`${String(h).padStart(2,"0")}:00`;
                onUpdate({...task,startDate:d,startTime:st,endTime:task.duration?addDur(st,Number(task.duration)):"",isLater:false});
                setDragTask(null);
              }}
              onClick={e=>{
                if (dragTask) return;
                const rect=e.currentTarget.getBoundingClientRect();
                const h=Math.max(DAY_START,Math.min(DAY_END-1,Math.floor((e.clientY-rect.top)/HH)+DAY_START));
                onAdd(d,h);
              }}>
              {/* グリッド */}
              {Array.from({length:DAY_END-DAY_START},(_,i) => (
                <div key={i} style={{position:"absolute",top:i*HH,left:0,right:0,height:HH,borderTop:`1px solid ${C.border}18`}}>
                  <div style={{position:"absolute",top:"50%",left:0,right:0,height:1,background:`${C.border}08`}}/>
                </div>
              ))}
              {/* タスクチップ */}
              {dayTasks.map(t => {
                const c  = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
                const sm = t2m(t.startTime)||0;
                const dur = Number(t.duration)||60;
                const em = t.endTime ? t2m(t.endTime) : sm+dur;
                return <TimelineChip key={t.id} task={t} tags={tags} color={c} startMin={sm} endMin={em} dayStartMin={dayStartMin} ppm={PPM} onPopup={hp} onToggle={onToggle} onUpdate={onUpdate} onRSStart={onRSStart}/>;
              })}
            </div>
          );
        })}
      </div>
      {popup && <Popup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo} onSkip={(id,date)=>{onSkip(id,date);setPopup(null);}} onOverride={(id,orig,ov)=>{onOverride(id,orig,ov);setPopup(null);}}/> }
    </div>
  );
};

// ── ガントチャート ──────────────────────────────────────────────────
const GanttView = ({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,dragTask,setDragTask}) => {
  const [vy,setVy] = useState(new Date(today).getFullYear());
  const [vm,setVm] = useState(new Date(today).getMonth());
  const [popup,setPopup]   = useState(null);
  const [dragBar,setDragBar] = useState(null);
  const [dragDL, setDragDL]  = useState(null);
  const [dropDay,setDropDay] = useState(null);
  const [holReady,setHolReady] = useState(false);
  const D   = dimOf(vy,vm);
  const DW  = 30;
  const RH  = 28;
  const all = flatten(tasks);
  const vis = all.filter(t => (t.startDate||t.endDate||t.deadlineDate) && !(t.isLater||isLaterTask(t)));

  useEffect(() => { fetchHolidays(vy).then(()=>setHolReady(true)); }, [vy]);

  // ★ 親タグ別グループ
  const groups = useMemo(() => {
    const g = {};
    vis.forEach(t => {
      const pid = t.tags?.find(id=>tags.find(tg=>tg.id===id&&!tg.parentId)) || "__none__";
      if (!g[pid]) g[pid]=[];
      g[pid].push(t);
    });
    return g;
  }, [vis.map(t=>t.id+t.done+t.startDate+t.endDate+t.deadlineDate).join(), tags.map(t=>t.id).join()]);

  const getBar = task => {
    const s = task.startDate ? new Date(task.startDate) : null;
    const e = task.endDate   ? new Date(task.endDate)   : s;
    if (!s) return null;
    const ms=new Date(vy,vm,1), me=new Date(vy,vm,D);
    if (e<ms||s>me) return null;
    const cs=s<ms?ms:s, ce=e>me?me:e;
    return { startDay:cs.getDate(), width:Math.max(1,ce.getDate()-cs.getDate()+1) };
  };
  const getDL = task => {
    if (!task.deadlineDate) return null;
    const x=new Date(task.deadlineDate);
    const ms=new Date(vy,vm,1), me=new Date(vy,vm,D);
    if (x<ms||x>me) return null;
    return x.getDate();
  };

  const ds = n => `${vy}-${String(vm+1).padStart(2,"0")}-${String(n).padStart(2,"0")}`;
  const MN = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const todD = today.startsWith(`${vy}-${String(vm+1).padStart(2,"0")}`) ? parseInt(today.slice(8)) : null;

  const hp = (e,task) => { e.stopPropagation(); const r=e.currentTarget.getBoundingClientRect(); setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350)}); };
  const hMemo = (id,idx) => { const t=all.find(x=>x.id===id); if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)}); setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null); };

  const hDrop = (e,n) => {
    e.preventDefault(); setDropDay(null);
    if (dragDL) { onUpdate({...dragDL,deadlineDate:ds(n)}); setDragDL(null); return; }
    if (dragBar) {
      const diff=n-dragBar.startDay, t=dragBar.task;
      const sh = x => { if(!x)return x; const dt=new Date(x); dt.setDate(dt.getDate()+diff); return localDate(dt); };
      onUpdate({...t,startDate:sh(t.startDate),endDate:sh(t.endDate),isLater:false});
      setDragBar(null); return;
    }
    const tid=e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
    const t=tid?all.find(x=>x.id===tid)||dragTask:dragTask;
    if (t) { onUpdate({...t,startDate:ds(n),isLater:false}); setDragTask(null); }
  };

  const brsRef=useRef(false),brsTask=useRef(null),brsX=useRef(0),brsW=useRef(0);
  const onBRS = useCallback((e,task,barW) => {
    e.stopPropagation(); e.preventDefault();
    brsRef.current=true; brsTask.current=task; brsX.current=e.clientX||(e.touches?.[0]?.clientX)||0; brsW.current=barW;
    const mv = ev => {
      if (!brsRef.current) return;
      const x=ev.clientX||(ev.touches?.[0]?.clientX)||0;
      const nw=Math.max(1,brsW.current+Math.round((x-brsX.current)/DW));
      const t=brsTask.current, sd=t.startDate||t.endDate; if(!sd)return;
      const ne=new Date(sd); ne.setDate(ne.getDate()+nw-1);
      onUpdate({...t, endDate:localDate(ne)});
    };
    const up = () => { brsRef.current=false; document.removeEventListener("mousemove",mv); document.removeEventListener("mouseup",up); document.removeEventListener("touchmove",mv); document.removeEventListener("touchend",up); };
    document.addEventListener("mousemove",mv); document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",mv,{passive:false}); document.addEventListener("touchend",up);
  }, [onUpdate]);

  // ★ ガント行レンダリング
  // indent: 0=通常, 1=サブグループ内トップレベル, 2=サブグループ内子タスク
  const renderTaskRow = (task, ri, gc, indent=0) => {
    const bar = getBar(task);
    const dlDay = getDL(task);
    const c = tags.find(t=>task.tags?.includes(t.id))?.color||C.accent;
    const isParent = !task._pid;
    const isBarDrag = dragBar?.task?.id===task.id;
    const isDLDrag  = dragDL?.id===task.id;
    const todStr = localDate();
    const isOver = task.deadlineDate && !task.done && task.deadlineDate < todStr;
    const leftPad = 10 + indent * 14; // インデント
    return (
      <div key={task.id} style={{display:"flex",borderBottom:`1px solid ${C.border}18`,height:RH,background:ri%2===0?"transparent":"rgba(255,255,255,.01)"}}
        onMouseEnter={e=>e.currentTarget.style.background=C.surfHov+"44"}
        onMouseLeave={e=>e.currentTarget.style.background=ri%2===0?"transparent":"rgba(255,255,255,.01)"}>
        <div style={{width:218,flexShrink:0,display:"flex",alignItems:"center",gap:5,padding:`0 7px 0 ${leftPad}px`,borderRight:`1px solid ${C.border}`,overflow:"hidden"}}>
          {task._pid && <span style={{color:C.textMuted,fontSize:9,flexShrink:0}}>└</span>}
          <CB checked={task.done} onChange={()=>onToggle(task.id)} size={12} color={c}/>
          <span style={{fontSize:10,fontWeight:isParent?600:400,color:task.done?C.textMuted:C.text,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration:task.done?"line-through":"none",flex:1}}>{task.title}</span>
          {isOver && <span style={{fontSize:8,color:C.danger,flexShrink:0}}>⚠</span>}
        </div>
        <div style={{flex:1,position:"relative",overflow:"visible"}}
          onDragOver={e=>{e.preventDefault();const n=Math.ceil(e.nativeEvent.offsetX/DW);setDropDay(Math.max(1,Math.min(D,n)));}}
          onDragLeave={()=>setDropDay(null)}
          onDrop={e=>{const n=Math.ceil(e.nativeEvent.offsetX/DW);hDrop(e,Math.max(1,Math.min(D,n)));}}>
          {todD && <div style={{position:"absolute",left:(todD-1)*DW+DW/2,top:0,bottom:0,width:1,background:`${C.danger}30`,pointerEvents:"none",zIndex:1}}/>}
          {bar && (
            <div draggable
              onDragStart={e=>{e.stopPropagation();e.dataTransfer.effectAllowed="move";setDragBar({task,startDay:bar.startDay});}}
              onDragEnd={()=>{setDragBar(null);setDropDay(null);}}
              onClick={e=>hp(e,task)}
              style={{position:"absolute",left:(bar.startDay-1)*DW+1,width:Math.max(bar.width*DW-2,DW/2),height:isParent?18:13,top:(RH-(isParent?18:13))/2,background:isBarDrag?`${c}38`:task.done?C.border+"44":`linear-gradient(90deg,${c}55,${c}38)`,border:`1px solid ${c}77`,borderRadius:4,display:"flex",alignItems:"center",paddingLeft:4,fontSize:8,color:task.done?C.textMuted:c,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap",cursor:"grab",textDecoration:task.done?"line-through":"none",zIndex:3,userSelect:"none"}}>
              {bar.width>1 ? task.title.slice(0,16) : ""}
              <div className="ew" onMouseDown={e=>onBRS(e,task,bar.width)} onTouchStart={e=>onBRS(e,task,bar.width)} onClick={e=>e.stopPropagation()}
                style={{position:"absolute",right:0,top:0,bottom:0,width:6,background:`${c}55`,borderRadius:"0 3px 3px 0",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{width:1.5,height:7,background:"rgba(255,255,255,.5)",borderRadius:1}}/>
              </div>
            </div>
          )}
          {dlDay && (
            <div draggable
              onDragStart={e=>{e.stopPropagation();e.dataTransfer.effectAllowed="move";setDragDL(task);}}
              onDragEnd={()=>{setDragDL(null);setDropDay(null);}}
              onClick={e=>e.stopPropagation()}
              title={`締切: ${task.deadlineDate}`}
              style={{position:"absolute",left:(dlDay-1)*DW+DW/2-4,top:(RH-14)/2,width:8,height:14,zIndex:4,cursor:"grab",display:"flex",flexDirection:"column",alignItems:"center",opacity:isDLDrag?.4:1}}>
              <div style={{width:1.5,height:7,background:C.danger,borderRadius:1}}/>
              <div style={{width:0,height:0,borderLeft:"4px solid transparent",borderRight:"4px solid transparent",borderTop:`5px solid ${C.danger}`}}/>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ★ 親タグ→子タグ→タスク の3段グループ
  const renderGroup = (tagId, gTasks) => {
    const tag = tags.find(t=>t.id===tagId);
    const gc  = tag?.color || C.textMuted;

    // 子タグ別にサブグループ化
    const subMap = {};
    gTasks.forEach(t => {
      const ctid = t.tags?.find(id => tags.find(tg=>tg.id===id&&tg.parentId)) || "__none__";
      if (!subMap[ctid]) subMap[ctid] = [];
      subMap[ctid].push(t);
    });
    const hasSubGroups = Object.keys(subMap).some(k => k !== "__none__");

    return (
      <div key={tagId}>
        {/* 親タグヘッダー */}
        {tagId !== "__none__" && (
          <div style={{display:"flex",background:`${gc}0a`,borderTop:`2px solid ${gc}44`,borderBottom:`1px solid ${gc}30`}}>
            <div style={{width:218,flexShrink:0,padding:"4px 10px",display:"flex",alignItems:"center",gap:5,borderRight:`1px solid ${C.border}`}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:gc,boxShadow:`0 0 6px ${gc}88`,flexShrink:0}}/>
              <span style={{fontSize:11,fontWeight:700,color:gc}}>{tag?.name}</span>
              <span style={{fontSize:8,color:C.textMuted,marginLeft:"auto"}}>{gTasks.length}</span>
            </div>
            <div style={{flex:1,position:"relative"}}>
              {todD && <div style={{position:"absolute",left:(todD-1)*DW+DW/2,top:0,bottom:0,width:1,background:`${C.danger}30`,pointerEvents:"none"}}/>}
            </div>
          </div>
        )}
        {/* ★ 子タグ別サブグループ */}
        {hasSubGroups ? (
          Object.entries(subMap).map(([ctid, ctTasks]) => {
            const ctag = tags.find(t=>t.id===ctid);
            return (
              <div key={ctid}>
                {ctid !== "__none__" && ctag && (
                  <div style={{display:"flex",background:`${ctag.color}08`,borderTop:`1px solid ${ctag.color}33`,borderBottom:`1px solid ${ctag.color}22`}}>
                    <div style={{width:218,flexShrink:0,padding:"3px 10px 3px 20px",display:"flex",alignItems:"center",gap:6,borderRight:`1px solid ${C.border}`}}>
                      <span style={{color:C.textMuted,fontSize:9}}>└</span>
                      <Pill tag={ctag}/>
                      <span style={{fontSize:8,color:C.textMuted,marginLeft:"auto"}}>{ctTasks.length}</span>
                    </div>
                    <div style={{flex:1}}/>
                  </div>
                )}
                {ctTasks.map((task,ri) => renderTaskRow(task,ri,gc, task._pid ? 2 : 1))}
              </div>
            );
          })
        ) : (
          gTasks.map((task,ri) => renderTaskRow(task,ri,gc))
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7,flexWrap:"wrap"}}>
        <Btn onClick={()=>{if(vm===0){setVy(y=>y-1);setVm(11);}else setVm(m=>m-1);}}>‹</Btn>
        <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14}}>{vy}年 {MN[vm]}</span>
        <Btn onClick={()=>{if(vm===11){setVy(y=>y+1);setVm(0);}else setVm(m=>m+1);}}>›</Btn>
        <span style={{fontSize:9,color:C.textMuted}}>バー=開始〜終了 / 🔴=締切 / ドラッグ移動・右端で期間変更</span>
      </div>
      <div style={{overflowX:"auto",borderRadius:10,border:`1px solid ${C.border}`,background:C.surface}}>
        <div style={{minWidth:D*DW+218}}>
          {/* ヘッダー */}
          <div style={{display:"flex",borderBottom:`2px solid ${C.border}`,background:C.bgSub,position:"sticky",top:0,zIndex:10}}>
            <div style={{width:218,flexShrink:0,padding:"6px 10px",fontSize:9,fontWeight:700,color:C.textMuted,textTransform:"uppercase",borderRight:`1px solid ${C.border}`,display:"flex",alignItems:"center"}}>タスク名</div>
            <div style={{display:"flex"}}>
              {Array.from({length:D},(_,i) => {
                const n=i+1, dStr=ds(n), dt=new Date(vy,vm,n);
                const isSat=dt.getDay()===6, isR=isRed(dStr), isT=n===todD;
                const hName=holName(dStr);
                return (
                  <div key={n}
                    onDragOver={e=>{e.preventDefault();setDropDay(n);}}
                    onDragLeave={()=>setDropDay(null)}
                    onDrop={e=>hDrop(e,n)}
                    onClick={()=>{if(!dragTask&&!dragBar&&!dragDL)onAdd(dStr,null);}}
                    style={{width:DW,flexShrink:0,textAlign:"center",fontSize:9,fontWeight:isT?800:400,fontFamily:"'DM Sans',sans-serif",color:isT?C.accent:isSat?C.info:isR?C.danger:C.textMuted,background:isT?C.accentS:isSat?"rgba(119,216,255,.05)":isR?"rgba(255,136,153,.07)":"transparent",borderLeft:`1px solid ${C.border}20`,padding:"5px 0",cursor:"pointer",position:"relative"}} title={hName||undefined}>
                    {n}
                    {isHol(dStr) && <div style={{fontSize:6,color:C.danger,lineHeight:1}}>祝</div>}
                    {isT && <div style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
                    {dropDay===n && <div style={{position:"absolute",inset:0,background:`${C.accent}16`,borderLeft:`2px dashed ${C.accent}`,pointerEvents:"none"}}/>}
                  </div>
                );
              })}
            </div>
          </div>
          {Object.entries(groups).map(([tagId,gTasks]) => renderGroup(tagId,gTasks))}
          {vis.length===0 && <div style={{padding:"28px 0",textAlign:"center",color:C.textMuted,fontSize:11}}>この月にタスクがありません</div>}
        </div>
      </div>
      {popup && <Popup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo} onSkip={(id,date)=>{onSkip(id,date);setPopup(null);}} onOverride={(id,orig,ov)=>{onOverride(id,orig,ov);setPopup(null);}}/> }
    </div>
  );
};

// ── テンプレート ────────────────────────────────────────────────────
const TemplatesView = ({templates,setTemplates,onUse,tags}) => {
  const [show,setShow] = useState(false);
  const [form,setForm] = useState({name:"",tasks:[{title:"",memo:"",tags:[],children:[]}]});
  const pt=tags.filter(t=>!t.parentId&&!t.archived), ct=pid=>tags.filter(t=>t.parentId===pid&&!t.archived);
  const togT=(cur,tid,fn)=>{const tag=tags.find(t=>t.id===tid);let nt=[...cur];if(nt.includes(tid)){nt=nt.filter(x=>x!==tid);if(tag?.parentId){const sib=tags.filter(t=>t.parentId===tag.parentId&&t.id!==tid).some(t=>nt.includes(t.id));if(!sib)nt=nt.filter(x=>x!==tag.parentId);}else nt=nt.filter(x=>!tags.filter(t=>t.parentId===tid).map(t=>t.id).includes(x));}else{nt=[...nt,tid];if(tag?.parentId&&!nt.includes(tag.parentId))nt=[...nt,tag.parentId];}fn(nt);};
  const TagRow=({sel,onChange})=><div style={{marginBottom:5}}>{pt.map(p=><div key={p.id} style={{marginBottom:3}}><div onClick={()=>togT(sel,p.id,onChange)} style={{display:"inline-flex",padding:"2px 9px",borderRadius:12,fontSize:10,fontWeight:700,cursor:"pointer",border:`1.5px solid ${p.color}55`,background:sel.includes(p.id)?p.color+"1e":"transparent",color:sel.includes(p.id)?p.color:C.textMuted,marginBottom:2}}>{p.name}</div>{ct(p.id).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,paddingLeft:10}}>{ct(p.id).map(c=><div key={c.id} onClick={()=>togT(sel,c.id,onChange)} style={{display:"inline-flex",padding:"1px 7px",borderRadius:12,fontSize:9,fontWeight:600,cursor:"pointer",border:`1.5px solid ${c.color}55`,background:sel.includes(c.id)?c.color+"1e":"transparent",color:sel.includes(c.id)?c.color:C.textMuted}}>└ {c.name}</div>)}</div>}</div>)}</div>;
  const upT=(i,k,v)=>setForm(f=>{const ts=[...f.tasks];ts[i]={...ts[i],[k]:v};return{...f,tasks:ts};});
  const upC=(i,j,k,v)=>setForm(f=>{const ts=[...f.tasks];ts[i].children[j]={...ts[i].children[j],[k]:v};return{...f,tasks:ts};});
  const save=()=>{if(!form.name.trim())return;setTemplates(t=>[...t,{id:"tpl_"+Date.now(),name:form.name,tasks:form.tasks.filter(t=>t.title)}]);setForm({name:"",tasks:[{title:"",memo:"",tags:[],children:[]}]});setShow(false);};
  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:9}}><Btn v="accent" onClick={()=>setShow(true)}>+ テンプレートを作成</Btn></div>
      {templates.length===0&&<div style={{textAlign:"center",padding:28,color:C.textMuted}}>テンプレートがまだありません</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:9}}>
        {templates.map(tpl=><div key={tpl.id} style={{background:C.surface,borderRadius:11,padding:11,border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13}}>{tpl.name}</div>
          <div style={{flex:1}}>{tpl.tasks.map((t,i)=><div key={i}><div style={{display:"flex",alignItems:"center",gap:4,padding:"3px 0",borderBottom:`1px solid ${C.border}20`,fontSize:11,color:C.textSub}}><div style={{width:4,height:4,borderRadius:"50%",background:C.accent,flexShrink:0}}/>{t.title}{(t.tags||[]).length>0&&<div style={{display:"flex",gap:2,marginLeft:"auto"}}>{(t.tags||[]).map(tid=>{const tg=tags.find(x=>x.id===tid&&x.parentId);return tg?<Pill key={tid} tag={tg}/>:null;})}</div>}</div>{(t.children||[]).map((c,j)=><div key={j} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 0 2px 9px",fontSize:10,color:C.textMuted}}><div style={{width:3,height:3,borderRadius:"50%",background:C.textMuted,flexShrink:0}}/>{c.title}</div>)}</div>)}</div>
          <div style={{display:"flex",gap:5}}><Btn v="accent" onClick={()=>onUse(tpl)} style={{flex:1,padding:"5px",fontSize:10}}>使う</Btn><Btn v="danger" onClick={()=>setTemplates(t=>t.filter(x=>x.id!==tpl.id))} style={{padding:"5px 8px",fontSize:10}}>削除</Btn></div>
        </div>)}
      </div>
      {show&&<Modal title="テンプレートを作成" onClose={()=>setShow(false)} wide>
        <Inp label="テンプレート名" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="例: 週次レビュー"/>
        <div style={{marginBottom:9}}>
          {form.tasks.map((t,i)=><div key={i} style={{background:C.bgSub,borderRadius:8,padding:9,marginBottom:6,border:`1px solid ${C.border}`}}>
            <div style={{display:"flex",gap:5,marginBottom:5}}>
              <input value={t.title} onChange={e=>upT(i,"title",e.target.value)} placeholder={`タスク ${i+1}`} style={{flex:1,background:C.surface,color:C.text,padding:"5px 8px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11}}/>
              <button onClick={()=>setForm(f=>({...f,tasks:f.tasks.filter((_,idx)=>idx!==i)}))} style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:5,width:26,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            <textarea value={t.memo||""} onChange={e=>upT(i,"memo",e.target.value)} placeholder="メモ" rows={2} style={{width:"100%",background:C.surface,color:C.text,padding:"5px 8px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:10,resize:"none",marginBottom:5}}/>
            <TagRow sel={t.tags||[]} onChange={nt=>upT(i,"tags",nt)}/>
            {(t.children||[]).map((c,j)=><div key={j} style={{marginLeft:10,marginBottom:4,background:C.surface,borderRadius:6,padding:7,border:`1px solid ${C.border}`}}>
              <div style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}><span style={{color:C.textMuted,fontSize:10}}>└</span><input value={c.title} onChange={e=>upC(i,j,"title",e.target.value)} placeholder={`子タスク ${j+1}`} style={{flex:1,background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:10}}/><button onClick={()=>setForm(f=>{const ts=[...f.tasks];ts[i].children=ts[i].children.filter((_,idx)=>idx!==j);return{...f,tasks:ts};})} style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:4,width:20,height:20,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>
              <textarea value={c.memo||""} onChange={e=>upC(i,j,"memo",e.target.value)} placeholder="子タスクのメモ" rows={2} style={{width:"100%",background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:9,resize:"none"}}/>
            </div>)}
            <button onClick={()=>setForm(f=>{const ts=[...f.tasks];ts[i]={...ts[i],children:[...(ts[i].children||[]),{title:"",memo:"",tags:[]}]};return{...f,tasks:ts};})} style={{background:"none",color:C.accent,border:`1px dashed ${C.accent}44`,borderRadius:5,padding:"2px 8px",fontSize:9,cursor:"pointer",marginTop:2}}>+ 子タスク追加</button>
          </div>)}
          <Btn onClick={()=>setForm(f=>({...f,tasks:[...f.tasks,{title:"",memo:"",tags:[],children:[]}]}))} style={{width:"100%",justifyContent:"center"}}>+ タスク追加</Btn>
        </div>
        <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}><Btn onClick={()=>setShow(false)}>キャンセル</Btn><Btn v="accent" onClick={save}>保存</Btn></div>
      </Modal>}
    </div>
  );
};

// ── タグ管理 ────────────────────────────────────────────────────────
const TagsView = ({tags,setTags}) => {
  const [form,setForm]     = useState({name:"",color:"#99aaff",parentId:null});
  const [editId,setEditId] = useState(null);
  const [ef,setEf]         = useState(null);
  const [showA,setShowA]   = useState(false);
  const [confirmTag,setConfirmTag] = useState(null); // {id, name, isParent}

  const add = () => {
    if(!form.name.trim()) return;
    setTags(t=>[...t,{id:"tag_"+Date.now(),name:form.name,color:form.color,parentId:form.parentId||null,archived:false}]);
    setForm({name:"",color:"#99aaff",parentId:null});
  };

  const arch = id => setTags(ts=>ts.map(t=>t.id===id?{...t,archived:true}:t));
  const rest = id => setTags(ts=>ts.map(t=>t.id===id?{...t,archived:false}:t));

  // タグ削除（子タグも一緒に削除）
  const deleteTag = id => {
    setTags(ts=>ts.filter(t=>t.id!==id && t.parentId!==id));
    setConfirmTag(null);
  };

  const pt=tags.filter(t=>!t.parentId&&!t.archived), ct=pid=>tags.filter(t=>t.parentId===pid&&!t.archived), at=tags.filter(t=>t.archived);

  // 親タグの編集保存：色が変わった場合は子タグも同期
  const saveEdit = () => {
    const isParent = !tags.find(t=>t.id===editId)?.parentId;
    setTags(ts=>ts.map(t=>{
      if (t.id===editId) return {...t,...ef};
      // 親タグの色変更→子タグの色も自動更新
      if (isParent && t.parentId===editId) return {...t,color:ef.color};
      return t;
    }));
    setEditId(null);
  };

  const ER = ({t}) => editId===t.id&&ef ? (
    <div style={{background:C.bgSub,borderRadius:6,padding:8,marginTop:5,display:"flex",gap:6,alignItems:"flex-end",flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:100}}><Inp label="タグ名" value={ef.name} onChange={v=>setEf(f=>({...f,name:v}))}/></div>
      <div style={{marginBottom:7}}>
        <div style={{fontSize:8,color:C.textMuted,marginBottom:2,fontWeight:700}}>色</div>
        <input type="color" value={ef.color} onChange={e=>setEf(f=>({...f,color:e.target.value}))} style={{width:34,height:30,borderRadius:5,border:`1px solid ${C.border}`,background:"none",cursor:"pointer",padding:2}}/>
      </div>
      {!tags.find(x=>x.id===editId)?.parentId && (
        <div style={{fontSize:8,color:C.textMuted,marginBottom:7,alignSelf:"flex-end",paddingBottom:8}}>
          ※色変更時は子タグも連動
        </div>
      )}
      <div style={{marginBottom:7,display:"flex",gap:4}}>
        <Btn v="accent" onClick={saveEdit}>保存</Btn>
        <Btn onClick={()=>setEditId(null)}>✕</Btn>
      </div>
    </div>
  ) : null;

  return (
    <div>
      {/* 確認ダイアログ */}
      {confirmTag && (
        <ConfirmDialog
          title="タグを削除"
          message={confirmTag.isParent
            ? `「${confirmTag.name}」と、その子タグをすべて削除しますか？
タスクのタグ設定も外れます。`
            : `「${confirmTag.name}」を削除しますか？
タスクのタグ設定も外れます。`}
          onConfirm={()=>deleteTag(confirmTag.id)}
          onCancel={()=>setConfirmTag(null)}
        />
      )}

      {/* 新規作成フォーム */}
      <div style={{background:C.surface,borderRadius:11,padding:11,border:`1px solid ${C.border}`,marginBottom:9}}>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,marginBottom:8,fontSize:13}}>新しいタグを作成</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 50px",gap:6,marginBottom:6}}>
          <Inp label="タグ名" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="タグ名..."/>
          <div><div style={{fontSize:8,color:C.textMuted,marginBottom:2,fontWeight:700}}>色</div><input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} style={{width:"100%",height:33,borderRadius:5,border:`1px solid ${C.border}`,background:"none",cursor:"pointer",padding:2}}/></div>
        </div>
        <div style={{marginBottom:6}}>
          <div style={{fontSize:8,color:C.textMuted,marginBottom:2,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>親タグ</div>
          <select value={form.parentId||""} onChange={e=>{const p=tags.find(t=>t.id===e.target.value);setForm(f=>({...f,parentId:e.target.value||null,color:p?p.color:f.color}));}} style={{width:"100%",background:C.bgSub,color:C.text,padding:"5px 8px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11}}>
            <option value="">なし（親タグ）</option>
            {pt.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <Btn v="accent" onClick={add}>追加</Btn>
      </div>

      {/* タグ一覧 */}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {pt.map(p=>(
          <div key={p.id} style={{background:C.surface,borderRadius:10,padding:10,border:`1px solid ${p.color}33`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:p.color}}/>
                <span style={{fontWeight:700,color:p.color,fontSize:13}}>{p.name}</span>
                <span style={{fontSize:8,color:C.textMuted,background:C.surfHov,padding:"0 4px",borderRadius:5}}>親</span>
              </div>
              <div style={{display:"flex",gap:3}}>
                <Btn onClick={()=>{setEditId(p.id);setEf({name:p.name,color:p.color});}} style={{padding:"2px 7px",fontSize:9}}>編集</Btn>
                <Btn v="danger" onClick={()=>arch(p.id)} style={{padding:"2px 7px",fontSize:9}}>アーカイブ</Btn>
                <Btn v="danger" onClick={()=>setConfirmTag({id:p.id,name:p.name,isParent:true})} style={{padding:"2px 7px",fontSize:9}}>削除</Btn>
              </div>
            </div>
            <ER t={p}/>
            {ct(p.id).length>0&&(
              <div style={{paddingLeft:14,marginTop:6,display:"flex",flexDirection:"column",gap:3}}>
                {ct(p.id).map(c=>(
                  <div key={c.id} style={{background:C.bgSub,borderRadius:7,border:`1px solid ${c.color}33`,padding:"5px 8px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:c.color}}/>
                        <span style={{fontSize:11,color:c.color,fontWeight:600}}>{c.name}</span>
                      </div>
                      <div style={{display:"flex",gap:3}}>
                        <Btn onClick={()=>{setEditId(c.id);setEf({name:c.name,color:c.color});}} style={{padding:"2px 6px",fontSize:9}}>編集</Btn>
                        <Btn v="danger" onClick={()=>arch(c.id)} style={{padding:"2px 6px",fontSize:9}}>アーカイブ</Btn>
                        <Btn v="danger" onClick={()=>setConfirmTag({id:c.id,name:c.name,isParent:false})} style={{padding:"2px 6px",fontSize:9}}>削除</Btn>
                      </div>
                    </div>
                    <ER t={c}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* アーカイブ済み */}
      {at.length>0&&(
        <div style={{marginTop:12}}>
          <button onClick={()=>setShowA(!showA)} style={{background:"none",border:"none",color:C.textMuted,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:4,marginBottom:5}}>
            {showA?"▼":"▶"} アーカイブ済み ({at.length})
          </button>
          {showA&&(
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {at.map(t=>(
                <div key={t.id} style={{background:C.surface,borderRadius:7,padding:"6px 10px",border:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",opacity:.55}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:t.color}}/>
                    <span style={{fontSize:11,color:C.textSub}}>{t.name}</span>
                  </div>
                  <div style={{display:"flex",gap:3}}>
                    <Btn onClick={()=>rest(t.id)} style={{padding:"2px 6px",fontSize:9}}>復元</Btn>
                    <Btn v="danger" onClick={()=>setConfirmTag({id:t.id,name:t.name,isParent:!t.parentId})} style={{padding:"2px 6px",fontSize:9}}>完全削除</Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── メインApp ───────────────────────────────────────────────────────
export default function App() {
  const [sideOpen,setSideOpen]     = useState(true);
  const [sortOrder,setSortOrder]   = useState("デフォルト");
  const today = localDate();
  const [user,setUser]             = useState(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [loginLoading,setLoginLoading] = useState(false);
  const [saving,setSaving]         = useState(false);
  const [tasks,setTasksRaw]        = useState([]);
  const [tags,setTagsRaw]          = useState(TAG_PRESETS);
  const [templates,setTemplatesRaw]= useState([]);
  const [view,setView]             = useState("list");
  const [showForm,setShowForm]     = useState(false);
  const [editTask,setEditTask]     = useState(null);
  const [addChildTo,setAddChildTo] = useState(null);
  const [filters,setFilters]       = useState({tag:"",search:"",hideCompleted:false});
  const [dragTask,setDragTask]     = useState(null);
  const [defDate,setDefDate]       = useState(null);
  const [defTime,setDefTime]       = useState(null);
  const [showNotifModal,setShowNotifModal] = useState(false);
  const [notifSettings,setNotifSettingsRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem("notifSettings")||"null") || {enabled:false,minutesBefore:60}; } catch { return {enabled:false,minutesBefore:60}; }
  });
  const setNotifSettings = s => { setNotifSettingsRaw(s); try { localStorage.setItem("notifSettings", JSON.stringify(s)); } catch {} };

  // 認証
  useEffect(() => { const u=onAuthStateChanged(auth,u=>{setUser(u);setAuthLoading(false);}); return u; }, []);
  // Firestore同期
  useEffect(() => {
    if (!user) return;
    const u=onSnapshot(doc(db,"users",user.uid),snap=>{
      // 自分の書き込み直後のonSnapshotは無視（競合防止）
      if (isSavingRef.current) return;
      if (snap.exists()) { const d=snap.data(); if(d.tasks)setTasksRaw(d.tasks); if(d.tags)setTagsRaw(d.tags); if(d.templates)setTemplatesRaw(d.templates); }
    });
    return u;
  }, [user]);
  // 今年・来年の祝日プリフェッチ
  useEffect(() => { const y=new Date().getFullYear(); fetchHolidays(y); fetchHolidays(y+1); }, []);
  // Service Worker登録（PWA + バックグラウンド通知）
  useEffect(() => { registerSW(); }, []);
  // 通知スケジュール（タスク or 設定が変わるたびに再スケジュール）
  useEffect(() => {
    scheduleNotifications(tasks, notifSettings);
  }, [tasks, notifSettings]);
  // tasksとnotifSettingsをrefで追跡（stale closure防止）
  const tasksRef = useRef(tasks);
  const notifRef = useRef(notifSettings);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { notifRef.current = notifSettings; }, [notifSettings]);

  // アプリ起動中のフォアグラウンド通知チェック（1分おき・初回マウント時のみ登録）
  useEffect(() => {
    const stop = startForegroundCheck(() => tasksRef.current, () => notifRef.current, null);
    return stop;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ★ 自分の書き込みによるonSnapshot反応を無視するためのフラグ
  const isSavingRef = useRef(false);

  const save2DB = async (t,tg,tp) => {
    if (!user) return;
    setSaving(true);
    isSavingRef.current = true;
    try { await setDoc(doc(db,"users",user.uid),{tasks:t,tags:tg,templates:tp,updatedAt:new Date().toISOString()}); }
    catch(e){ console.error(e); }
    // 少し待ってからフラグを解除（onSnapshotの遅延を考慮）
    setTimeout(() => { isSavingRef.current = false; }, 1500);
    setSaving(false);
  };
  const setTasks     = t  => { setTasksRaw(t);     save2DB(t,tags,templates); };
  const setTags      = tg => { setTagsRaw(tg);     save2DB(tasks,tg,templates); };
  const setTemplates = tp => { setTemplatesRaw(tp); save2DB(tasks,tags,tp); };

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      const r = await signInWithPopup(auth,provider);
      if (!ALLOWED.includes(r.user.uid)) { await signOut(auth); alert("アクセスできません。"); }
    } catch(e){ console.error(e); }
    setLoginLoading(false);
  };

  // ツリー操作
  const updTree  = (ts,id,fn) => ts.map(t => t.id===id ? fn(t) : {...t,children:updTree(t.children||[],id,fn)});
  const delTree  = (ts,id)    => ts.filter(t=>t.id!==id).map(t=>({...t,children:delTree(t.children||[],id)}));
  const addChild = (ts,pid,c) => ts.map(t => t.id===pid ? {...t,children:[...(t.children||[]),c]} : {...t,children:addChild(t.children||[],pid,c)});

  // 保存
  const handleSave = f => {
    const fw = {...f, isLater:isLaterTask(f)};
    let nt;
    // ★ 複製フォームからの保存：editTaskはあるが既存タスクに同じIDがない→新規追加
    const isExisting = editTask && flatten(tasks).some(t => t.id === editTask.id);
    if (isExisting)      nt = updTree(tasks, f.id, ()=>fw);
    else if (addChildTo) nt = addChild(tasks, addChildTo, fw);
    else                 nt = [...tasks, fw];
    // ★ タグ同期（編集タスクのみ完全上書き、他タスクは親タグ補完のみ）
    const synced = syncTags(nt, fw.id, fw.tags, tags);
    setTasks(syncDone(synced));
    setEditTask(null); setAddChildTo(null);
  };

  const handleUpdate = updated => {
    const clean = {...updated}; delete clean._pt; delete clean._pid;
    const synced = syncTags(updTree(tasks,clean.id,()=>clean), clean.id, clean.tags, tags);
    setTasks(syncDone(synced));
    setDragTask(null);
  };

  const handleAdd    = (date,hour) => { setDefDate(date); setDefTime(hour!=null?`${String(hour).padStart(2,"0")}:00`:null); setEditTask(null); setAddChildTo(null); setShowForm(true); };
  const handleToggle = (id, forDate) => {
    const allFlat2 = flatten(tasks);
    const target = allFlat2.find(t => t.id === id);
    if (!target) return;

    const isRepeat = target.repeat && parseRepeat(target.repeat).type !== "なし";

    if (isRepeat) {
      // 繰り返しタスク：その日付をskipDates（完了済み日）に追加/削除
      const date = forDate || localDate();
      const skipDates = [...(target.skipDates || [])];
      const doneDates = [...(target.doneDates || [])];
      const alreadyDone = doneDates.includes(date);
      let newSkip, newDone;
      if (alreadyDone) {
        // 完了解除
        newSkip = skipDates.filter(d => d !== date);
        newDone = doneDates.filter(d => d !== date);
      } else {
        // 完了
        newSkip = skipDates.includes(date) ? skipDates : [...skipDates, date];
        newDone = [...doneDates, date];
      }
      setTasks(syncDone(updTree(tasks, id, t => ({...t, skipDates: newSkip, doneDates: newDone}))));
      return;
    }

    // 通常タスク：子タスクが1つでも未完了なら完了にできない
    if (!target.done && (target.children||[]).length > 0) {
      const hasPendingChild = flatten(target.children||[]).some(c => !c.done);
      if (hasPendingChild) {
        alert("子タスクをすべて完了してから親タスクを完了にしてください");
        return;
      }
    }
    setTasks(syncDone(updTree(tasks, id, t => ({...t, done: !t.done}))));
  };
  const handleDelete = id => setTasks(delTree(tasks,id));
  // 今回だけスキップ
  const handleSkip = (id, date) => {
    const t = flatten(tasks).find(x => x.id === id);
    if (!t) return;
    const skipDates = [...(t.skipDates || [])];
    if (!skipDates.includes(date)) skipDates.push(date);
    setTasks(syncDone(updTree(tasks, id, x => ({...x, skipDates}))));
  };

  // 今回だけ日程変更
  const handleOverride = (id, origDate, ov) => {
    const t = flatten(tasks).find(x => x.id === id);
    if (!t) return;
    const overrideDates = {...(t.overrideDates || {}), [origDate]: ov};
    setTasks(syncDone(updTree(tasks, id, x => ({...x, overrideDates}))));
  };

  const handleMemoToggle = (id, idx) => {
    const t = flatten(tasks).find(x => x.id === id);
    if (t) setTasks(syncDone(updTree(tasks, id, x => ({...x, memo: toggleMemo(x.memo, idx)}))));
  };
  const handleEdit   = t  => { setEditTask(t); setShowForm(true); };

  // ★ 複製→タイトルそのまま・(コピー)なし・フォームを開く
  const handleDuplicate = t => {
    const dupChildren = cs => (cs||[]).map(c=>({...c, id:"task_"+Date.now()+Math.random(), done:false, children:dupChildren(c.children)}));
    const dup = {...t, id:"task_"+Date.now(), done:false, children:dupChildren(t.children)};
    delete dup._pt; delete dup._pid;
    setEditTask(dup);
    setShowForm(true);
  };

  const handleUseTemplate = tpl => {
    const mk = t => ({id:"task_"+Date.now()+Math.random(),title:t.title,done:false,tags:t.tags||[],memo:t.memo||"",startDate:"",startTime:"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",duration:"",isLater:true,children:(t.children||[]).map(c=>mk(c))});
    setTasks([...tasks, ...tpl.tasks.map(t=>mk(t))]);
    setView("list");
  };

  const allFlat  = flatten(tasks);
  // 繰り返しタスクはカウントから除外（通常タスクのみ集計）
  const nonRepeat = allFlat.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし");
  const doneCnt  = nonRepeat.filter(t=>t.done).length;
  const totalCnt = nonRepeat.length;
  const activeCnt= nonRepeat.filter(t=>!t.done).length;
  const pct      = totalCnt>0 ? Math.round((doneCnt/totalCnt)*100) : 0;

  const NAV = [
    {id:"list",     label:"リスト",       icon:"☰"},
    {id:"day",      label:"日",           icon:"📆"},
    {id:"week",     label:"週",           icon:"📅"},
    {id:"gantt",    label:"ガント",       icon:"📊"},
    {id:"templates",label:"テンプレート", icon:"📋"},
    {id:"tagmgr",   label:"タグ管理",     icon:"🏷"},
  ];
  const ptags     = tags.filter(t=>!t.parentId&&!t.archived);
  const showLater = ["day","week","gantt"].includes(view);

  if (authLoading) return <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",color:C.textMuted}}>読み込み中...</div>;
  if (!user)       return <Login onLogin={handleLogin} loading={loginLoading}/>;

  return (
    <>
      <style>{G}</style>
      <div style={{minHeight:"100vh",background:C.bg,display:"flex"}}>
        {/* サイドバー */}
        <div style={{width:sideOpen?200:42,flexShrink:0,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,height:"100vh",overflowY:"auto",zIndex:10,transition:"width .2s",boxShadow:"2px 0 16px rgba(0,0,0,.3)"}}>
          <div style={{padding:`10px ${sideOpen?12:5}px 9px`,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:4,flexShrink:0}}>
            {sideOpen && <div style={{minWidth:0,flex:1}}>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14,whiteSpace:"nowrap",letterSpacing:-.5}}>
                <span style={{background:`linear-gradient(135deg,${C.accent},${C.info})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>◈ マイタスク</span>
              </div>
              <div style={{fontSize:8,color:C.textMuted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</div>
              {saving && <div style={{fontSize:8,color:C.success,marginTop:1}}>💾 保存中...</div>}
              <div style={{marginTop:7}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.textMuted,marginBottom:2}}>
                  <span>進捗</span><span style={{fontWeight:700,color:C.accent}}>{pct}%</span>
                </div>
                <div style={{background:C.bg,borderRadius:8,height:3,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${C.accent},${C.success})`,borderRadius:8,transition:"width .5s"}}/>
                </div>
                <div style={{fontSize:8,color:C.textMuted,marginTop:2}}>{doneCnt}件完了 / 残り{activeCnt}件</div>
              </div>
            </div>}
            <button onClick={()=>setSideOpen(!sideOpen)} style={{background:C.accentS,color:C.accent,border:`1px solid ${C.accent}33`,borderRadius:6,width:24,height:24,fontSize:11,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{sideOpen?"◀":"▶"}</button>
          </div>
          <div style={{padding:`6px ${sideOpen?6:3}px`,flex:1,overflowY:"auto"}}>
            {NAV.map(n=>(
              <button key={n.id} className="nb" onClick={()=>setView(n.id)} title={n.label}
                style={{display:"flex",alignItems:"center",gap:sideOpen?7:0,justifyContent:sideOpen?"flex-start":"center",width:"100%",padding:"6px 6px",borderRadius:7,marginBottom:1,background:view===n.id?C.accentS:"transparent",color:view===n.id?C.accent:C.textSub,border:view===n.id?`1px solid ${C.accent}33`:"1px solid transparent",fontSize:11,fontWeight:view===n.id?700:400,transition:"all .15s",textAlign:"left"}}>
                <span style={{fontSize:14,flexShrink:0}}>{n.icon}</span>
                {sideOpen && n.label}
                {sideOpen && view===n.id && <div style={{marginLeft:"auto",width:4,height:4,borderRadius:"50%",background:C.accent}}/>}
              </button>
            ))}
          </div>
          {sideOpen && <div style={{padding:"8px 8px",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
            <div style={{position:"relative",marginBottom:4}}>
              <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",fontSize:10,color:C.textMuted}}>🔍</span>
              <input value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} placeholder="検索..." style={{width:"100%",background:C.bgSub,color:C.text,padding:"4px 7px 4px 22px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:10}}/>
            </div>
            <select value={filters.tag} onChange={e=>setFilters(f=>({...f,tag:e.target.value}))} style={{width:"100%",background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:10,marginBottom:5}}>
              <option value="">すべてのタグ</option>
              {ptags.map(p=><optgroup key={p.id} label={p.name}><option value={p.id}>{p.name}（全体）</option>{tags.filter(t=>t.parentId===p.id&&!t.archived).map(c=><option key={c.id} value={c.id}>└ {c.name}</option>)}</optgroup>)}
            </select>
            <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:7}}>
              <CB checked={filters.hideCompleted} onChange={()=>setFilters(f=>({...f,hideCompleted:!f.hideCompleted}))} size={12}/>
              <span style={{fontSize:9,color:C.textMuted}}>完了を隠す</span>
            </div>
            <button onClick={()=>setShowNotifModal(true)} style={{width:"100%",background:notifSettings?.enabled?C.accentS:"transparent",color:notifSettings?.enabled?C.accent:C.textMuted,border:`1px solid ${notifSettings?.enabled?C.accent:C.border}`,borderRadius:6,padding:"4px",fontSize:9,cursor:"pointer",marginBottom:4,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
              {notifSettings?.enabled?"🔔":"🔕"} 通知設定
            </button>
            <button onClick={()=>signOut(auth)} style={{width:"100%",background:"transparent",color:C.textMuted,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px",fontSize:9,cursor:"pointer"}}
              onMouseEnter={e=>{e.currentTarget.style.background=C.dangerS;e.currentTarget.style.color=C.danger;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.textMuted;}}>ログアウト</button>
          </div>}
          {!sideOpen && <div style={{padding:"5px 3px",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
            <button onClick={()=>setShowNotifModal(true)} title="通知設定" style={{background:notifSettings?.enabled?C.accentS:"transparent",color:notifSettings?.enabled?C.accent:C.textMuted,border:`1px solid ${notifSettings?.enabled?C.accent:C.border}`,borderRadius:6,padding:"4px",fontSize:12,cursor:"pointer",width:"100%",marginBottom:3}}>{notifSettings?.enabled?"🔔":"🔕"}</button>
            <button onClick={()=>signOut(auth)} title="ログアウト" style={{background:"transparent",color:C.textMuted,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px",fontSize:10,cursor:"pointer",width:"100%"}}>↩</button>
          </div>}
        </div>

        {/* メイン */}
        <div style={{marginLeft:sideOpen?200:42,flex:1,display:"flex",minHeight:"100vh",transition:"margin .2s",overflow:"hidden"}}>
          <div style={{flex:1,padding:"13px 17px",minWidth:0,overflowX:"auto",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:11}}>
              <div>
                <h1 style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:17,letterSpacing:-.4,lineHeight:1.2}}>{NAV.find(n=>n.id===view)?.icon} {NAV.find(n=>n.id===view)?.label}</h1>
                <div style={{fontSize:9,color:C.textMuted,marginTop:1}}>{new Date(today).toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"short"})}</div>
              </div>
              {["list","day","week","gantt"].includes(view) && <Btn v="accent" onClick={()=>{setDefDate(null);setDefTime(null);setEditTask(null);setAddChildTo(null);setShowForm(true);}}>＋ 追加</Btn>}
            </div>
            {view==="list"      && <ListView tasks={tasks} tags={tags} filters={filters} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onAddChild={pid=>{setAddChildTo(pid);setShowForm(true);}} onDuplicate={handleDuplicate} onMemoToggle={handleMemoToggle} sortOrder={sortOrder} setSortOrder={setSortOrder}/>}
            {view==="day"       && <DayView  tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="week"      && <WeekView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="gantt"     && <GanttView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} onSkip={handleSkip} onOverride={handleOverride} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="templates" && <TemplatesView templates={templates} setTemplates={setTemplates} onUse={handleUseTemplate} tags={tags}/>}
            {view==="tagmgr"    && <TagsView tags={tags} setTags={setTags}/>}
          </div>
          {showLater && <LaterPanel tasks={tasks} tags={tags} dragTask={dragTask} setDragTask={setDragTask} onEdit={handleEdit}/>}
        </div>
      </div>
      {showForm && <TaskForm task={editTask} tags={tags} isChild={!!addChildTo}
        parentTags={addChildTo ? (flatten(tasks).find(t=>t.id===addChildTo)?.tags||[]) : null}
        onSave={handleSave} defDate={defDate} defTime={defTime}
        onClose={()=>{setShowForm(false);setEditTask(null);setAddChildTo(null);setDefDate(null);setDefTime(null);}}/>}
      {showNotifModal && <NotificationModal settings={notifSettings} onSave={setNotifSettings} onClose={()=>setShowNotifModal(false)}/>}
    </>
  );
}
