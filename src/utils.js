import { useState, useEffect, useRef, useCallback } from "react";
import { C } from "./constants";

// ── 日付・時刻ヘルパー ─────────────────────────────────────────────
export const localDate = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
export const dimOf   = (y,m) => new Date(y,m+1,0).getDate();
export const fd      = d => { if(!d) return ""; const x=new Date(d); return `${x.getMonth()+1}/${x.getDate()}`; };
export const fdt     = (d,t) => !d ? "" : (t ? `${fd(d)} ${t}` : fd(d));
export const sameDay = (a,b) => !!a && !!b && a.slice(0,10)===b.slice(0,10);
export const weekDates = base => {
  const d=new Date(base), w=d.getDay(), m=new Date(d);
  m.setDate(d.getDate()-w+1);
  return Array.from({length:7},(_,i)=>{const x=new Date(m);x.setDate(m.getDate()+i);return localDate(x);});
};
export const t2m  = t => { if(!t) return null; const[h,m]=t.split(":").map(Number); return h*60+m; };
export const m2t  = m => `${String(Math.floor(Math.max(0,m)/60)%24).padStart(2,"0")}:${String(Math.max(0,m)%60).padStart(2,"0")}`;
export const durFrom = (a,b) => { if(!a||!b) return null; const d=t2m(b)-t2m(a); return d>0?d:null; };
export const addDur  = (a,d) => (!a||!d) ? "" : m2t(t2m(a)+Number(d));
export const isLaterTask = t => {
  // 子タスクを持つ場合はグループ扱い → 「あとでやる」に出さない
  if (t.children?.length) return false;
  // 繰り返しタスクは日付未設定でも「あとでやる」にしない
  const repeatType = typeof t.repeat === "string" ? t.repeat : t.repeat?.type;
  if (repeatType && repeatType !== "なし") return false;
  const sessions = t.sessions || [];
  return !sessions.some(s => s.startDate || s.date || s.startTime);  // date は旧フィールド互換
};

// ── ツリー操作 ────────────────────────────────────────────────────
export const flatten = (ts, res=null, pt=null, pid=null) => {
  if (res === null) res = [];
  ts.forEach(t => {
    res.push({...t, _pt:pt, _pid:pid});
    if (t.children?.length) flatten(t.children, res, t.title, t.id);
  });
  return res;
};
export const updTree = (tasks, id, fn) => tasks.map(t =>
  t.id===id ? fn(t) : {...t, children: updTree(t.children||[], id, fn)}
);
export const delTree = (tasks, id) => tasks
  .filter(t => t.id!==id)
  .map(t => ({...t, children: delTree(t.children||[], id)}));

// ── 繰り返しユーティリティ ────────────────────────────────────────
export const parseRepeat = r => {
  if (!r || r === "なし") return { type: "なし" };
  if (typeof r === "string") {
    if (r === "毎日")   return { type: "毎日" };
    if (r === "平日のみ") return { type: "平日のみ" };
    if (r === "毎週")   return { type: "毎週", weekDays: [] };
    if (r === "毎月")   return { type: "毎月", monthDays: [] };
    return { type: "なし" };
  }
  return r;
};

export const matchesRepeat = (task, date) => {
  const r = parseRepeat(task.repeat);
  if (r.type === "なし") return false;
  if ((task.skipDates || []).includes(date)) return false;
  if (task.overrideDates && task.overrideDates[date]) return false;
  // 期間フィルタ
  const s0 = task.sessions?.[0] || {};
  const startDate = s0.startDate || s0.date || null;  // createdAt フォールバック廃止（毎日表示バグの原因）
  if (!startDate) return false;  // startDateなし繰り返しは表示しない（データ不正）
  const endDate = s0.endDate || task.endDate || null;
  if (date < startDate) return false;
  if (endDate && date > endDate) return false;
  if (r.type === "毎日") return true;
  if (r.type === "平日のみ") { const d = new Date(date).getDay(); return d >= 1 && d <= 5; }
  if (r.type === "毎週") {
    const days = r.weekDays && r.weekDays.length > 0
      ? r.weekDays
      : (task.sessions?.[0]?.startDate||task.sessions?.[0]?.date ? [new Date(task.sessions[0].startDate||task.sessions[0].date).getDay()] : []);
    return days.includes(new Date(date).getDay());
  }
  if (r.type === "毎月") {
    const days = r.monthDays && r.monthDays.length > 0
      ? r.monthDays
      : (task.sessions?.[0]?.startDate||task.sessions?.[0]?.date ? [new Date(task.sessions[0].startDate||task.sessions[0].date).getDate()] : []);
    return days.includes(new Date(date).getDate());
  }
  if (r.type === "月末") {
    const d = new Date(date);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === lastDay;
  }
  if (r.type === "月末平日") {
    // その月の最終平日（土曜→金曜、日曜→金曜）
    const d = new Date(date);
    const lastD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const dow = lastD.getDay();
    const offset = dow === 0 ? 2 : dow === 6 ? 1 : 0;
    const lastWeekday = new Date(lastD);
    lastWeekday.setDate(lastD.getDate() - offset);
    return d.getDate() === lastWeekday.getDate();
  }
  if (r.type === "毎年") {
    const ref = r.yearDate || task.sessions?.[0]?.date;
    if (!ref) return false;
    return date.slice(5) === ref.slice(5);
  }
  if (r.type === "カスタム") return (r.customDates || []).includes(date);
  return false;
};

export const expandOverrides = (tasks) => {
  const extras = [];
  flatten(tasks).forEach(t => {
    if (!t.overrideDates || Object.keys(t.overrideDates).length === 0) return;
    Object.entries(t.overrideDates).forEach(([origDate, ov]) => {
      const s0 = t.sessions?.[0] || {};
      const ovStartDate = ov.startDate ?? origDate;
      const ovStartTime = ov.startTime ?? s0.startTime ?? "";
      const ovEndDate   = ov.endDate   ?? (ovStartDate !== (s0.startDate || s0.date) ? ovStartDate : (s0.endDate || ""));
      const ovEndTime   = ov.endTime   ?? s0.endTime ?? "";
      extras.push({
        ...t,
        sessions: [{
          ...s0,
          startDate: ovStartDate,
          startTime: ovStartTime,
          endDate:   ovEndDate,
          endTime:   ovEndTime,
          date: ovStartDate,  // 旧フィールド互換
        }, ...(t.sessions||[]).slice(1)],
        startDate: "",
        startTime: ovStartTime,
        endTime:   ovEndTime,
        endDate:   ov.endDate ?? t.endDate,
        deadlineDate: ov.deadlineDate ?? t.deadlineDate,
        deadlineTime: ov.deadlineTime ?? t.deadlineTime,
        _overrideKey: origDate,
        _overrideId:  t.id,
        id: t.id + "_ov_" + origDate,
        repeat: "なし",
      });
    });
  });
  return extras;
};

export const repeatLabel = r => {
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
  if (p.type === "月末")   return "月末";
  if (p.type === "月末平日") return "月末平日";
  if (p.type === "毎年") {
    const ref = p.yearDate;
    return ref ? "毎年" + ref.slice(5).replace("-","/") : "毎年";
  }
  if (p.type === "カスタム") return "カスタム(" + (p.customDates||[]).length + "日)";
  return "なし";
};

// ── タグ・完了同期 ────────────────────────────────────────────────
export const syncTags = (tasks, editedId, editedTags, allTags) => {
  const withParents = tids => {
    const result = [...tids];
    tids.forEach(tid => {
      const tag = allTags.find(t => t.id === tid);
      if (tag?.parentId && !result.includes(tag.parentId)) result.push(tag.parentId);
    });
    return result;
  };
  const walk = (task) => {
    if (task.id === editedId)
      return { ...task, tags: withParents(editedTags), children: (task.children||[]).map(c => walk(c)) };
    return { ...task, tags: withParents(task.tags || []), children: (task.children||[]).map(c => walk(c)) };
  };
  return tasks.map(t => walk(t));
};

export const syncDone = tasks => {
  const up = t => {
    const ch = (t.children||[]).map(c => up(c));
    if (ch.length === 0) return {...t, children:ch};
    const allDone = ch.every(c => c.done);
    const anyUndone = ch.some(c => !c.done);
    return {...t, children:ch, done: anyUndone ? false : allDone};
  };
  return tasks.map(t => up(t));
};

// ── メモ ────────────────────────────────────────────────────────
export const renderMemo = (memo, onToggle) => {
  if (!memo) return null;
  const renderInline = (text) => {
    const parts = [];
    const re = /(\*\*(.+?)\*\*|`(.+?)`|(https?:\/\/[^\s<>"']+))/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      if (m[0].startsWith("**")) {
        parts.push(<strong key={m.index} style={{color:C.text,fontWeight:700}}>{m[2]}</strong>);
      } else if (m[0].startsWith("`")) {
        parts.push(<code key={m.index} style={{background:C.bg,color:C.accent,padding:"0 4px",borderRadius:3,fontSize:10,fontFamily:"monospace"}}>{m[3]}</code>);
      } else {
        parts.push(<a key={m.index} href={m[4]} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{color:C.accent,textDecoration:"underline",wordBreak:"break-all"}}>{m[4]}</a>);
      }
      last = re.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length ? parts : text;
  };
  return memo.split("\n").map((line, i) => {
    const chk = line.match(/^- \[(x| )\] (.*)$/);
    if (chk) {
      const checked = chk[1]==="x";
      return (
        <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
          <div onClick={e=>{e.stopPropagation();e.preventDefault();onToggle&&onToggle(i);}}
            onTouchEnd={e=>{e.stopPropagation();e.preventDefault();onToggle&&onToggle(i);}}
            style={{width:13,height:13,borderRadius:3,border:`2px solid ${checked?C.accent:C.border}`,background:checked?C.accent:"transparent",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {checked && <span style={{color:"#fff",fontSize:8,fontWeight:800}}>✓</span>}
          </div>
          <span style={{fontSize:11,color:checked?C.textMuted:C.textSub,textDecoration:checked?"line-through":"none"}}>{renderInline(chk[2])}</span>
        </div>
      );
    }
    const bullet = line.match(/^([-*]) (.*)$/);
    if (bullet) {
      return (
        <div key={i} style={{display:"flex",alignItems:"baseline",gap:5,marginBottom:2}}>
          <span style={{color:C.accent,fontSize:10,flexShrink:0}}>•</span>
          <span style={{fontSize:11,color:C.textSub,lineHeight:1.4}}>{renderInline(bullet[2])}</span>
        </div>
      );
    }
    return (
      <div key={i} style={{fontSize:11,color:C.textSub,marginBottom:1,lineHeight:1.4}}>
        {line ? renderInline(line) : <br/>}
      </div>
    );
  });
};

export const toggleMemo = (memo, idx) => {
  const lines = memo.split("\n");
  const m = lines[idx]?.match(/^- \[(x| )\] (.*)$/);
  if (m) lines[idx] = `- [${m[1]==="x"?" ":"x"}] ${m[2]}`;
  return lines.join("\n");
};

// ── 日付ごとのタスク取得（日ビュー・週ビュー共通） ──────────────────
// セッションの開始日を取得（新旧フィールド互換）
const sessionStartDate = s => s.startDate || s.date || "";

// セッションがその日に表示されるか（日またぎ対応）
const sessionCoversDate = (s, date) => {
  const sd = sessionStartDate(s);
  if (!sd) return false;  // startDateなければスキップ（startTimeだけでは日付特定不可）
  // endDateがstartDateより前の場合は不正値として無視（毎日表示バグの防止）
  const ed = (s.endDate && s.endDate >= sd) ? s.endDate : sd;
  return date >= sd && date <= ed;
};

export const getTasksForDate = (tasks, date) => {
  const all = flatten(tasks);
  const seen = new Set();
  const raw = [
    // ① 繰り返しタスク：sessions[0] の時間を反映
    ...all
      .filter(t => t.repeat && parseRepeat(t.repeat).type !== "なし" && matchesRepeat(t, date))
      .map(t => {
        const s0 = t.sessions?.[0] || {};
        return {
          ...t,
          startTime: s0.startTime || "",
          endTime:   s0.endTime   || "",
          duration:  s0.startTime && s0.endTime
            ? String(t2m(s0.endTime) - t2m(s0.startTime))
            : t.duration || "",
        };
      }),
    // ② 今回だけ変更（overrideDates展開）
    ...expandOverrides(tasks).filter(t => {
      const s0 = t.sessions?.[0] || {};
      return sessionCoversDate(s0, date);
    }),
    // ③ 通常タスク：sessions を展開（日またぎ対応）
    ...all
      .filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし")
      .flatMap(t => (t.sessions || [])
        .filter(s => sessionCoversDate(s, date))
        .map((s, idx) => {
          const sd = sessionStartDate(s);
          const sid = s.id || (sd + "_" + idx); // idなき古いデータは startDate+index で代替
          const totalSessions = t.sessions.filter(s => sessionCoversDate(s, date)).length;
          return {
            ...t,
            startDate: sd, startTime: s.startTime, endTime: s.endTime,
            endDate: s.endDate || sd,
            duration: s.startTime && s.endTime
              ? String(t2m(s.endTime) - t2m(s.startTime))
              : (s.startTime ? (t.duration || "") : ""),
            _sessionId: sid, _sessionOnly: totalSessions > 1,
          };
        })
      ),
  ];
  // 重複除去
  return raw.filter(t => {
    const isRepeat = t.repeat && parseRepeat(t.repeat).type !== "なし";
    const key = t._overrideKey
      ? t.id + "_ov_" + t._overrideKey
      : t._sessionId
        ? t.id + "_s_" + t._sessionId
        : (isRepeat ? t.id + "_repeat_" + date : t.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ── 締切タスク取得（日ビュー・週ビュー共通） ────────────────────────
export const getDeadlineTasksForDate = (tasks, date) => {
  const all = flatten(tasks);
  return all.filter(t => {
    if (!(t.deadlineDate && sameDay(t.deadlineDate, date))) return false;
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") return false;
    if (t.done) return false;
    return true;
  }).map(t => ({...t, _isDeadline: true}));
};

// ── 祝日 ────────────────────────────────────────────────────────
const HCACHE = {};
export async function fetchHolidays(year) {
  if (HCACHE[year]) return HCACHE[year];
  try {
    const res = await fetch(`https://holidays-jp.github.io/api/v1/${year}/date.json`);
    if (!res.ok) return {};
    const data = await res.json();
    HCACHE[year] = data;
    return data;
  } catch { return {}; }
}
export const isHol  = d => !!(d && HCACHE[d.slice(0,4)]?.[d]);
export const holName = d => (d && HCACHE[d.slice(0,4)]?.[d]) || null;
export const isRed  = d => !!(d && (new Date(d).getDay() === 0 || isHol(d)));

// ── useIsPC カスタムhook ─────────────────────────────────────────────
export const useIsPC = () => {
  const [isPC, setIsPC] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const fn = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return isPC;
};

// ── useResizeHandler カスタムhook ────────────────────────────────────
// DayView / WeekView / DashboardView 共通のリサイズハンドラ
// ドラッグ中はローカル表示のみ更新、離したときだけFirestoreに保存
export const useResizeHandler = (onUpdate, PPM) => {
  const rsRef       = useRef(false);
  const rsTask      = useRef(null);
  const rsY         = useRef(0);
  const rsDur       = useRef(0);
  const rsCurrent   = useRef(null); // ドラッグ中の最新状態をrefで保持
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const [rsPreview, setRsPreview] = useState(null); // ローカル表示用

  const onRSStart = useCallback((e, task) => {
    e.stopPropagation(); e.preventDefault();
    rsRef.current  = true;
    rsTask.current = task;
    rsY.current    = e.clientY || (e.touches?.[0]?.clientY) || 0;
    rsDur.current  = Number(task.duration) || 60;
    rsCurrent.current = null;
    const mv = ev => {
      if (!rsRef.current) return;
      const y  = ev.clientY || (ev.touches?.[0]?.clientY) || 0;
      const nd = Math.max(15, Math.round((rsDur.current + (y - rsY.current) / PPM) / 15) * 15);
      const t  = rsTask.current;
      const targetSId   = t._sessionId;
      const newSessions = (t.sessions || []).length > 0
        ? t.sessions.map(s => {
            const isTarget = targetSId ? s.id === targetSId : t.sessions.indexOf(s) === 0;
            if (!isTarget) return s;
            const newEnd2 = s.startTime ? addDur(s.startTime, nd) : "";
            return { ...s, endTime: newEnd2 };
          })
        : t.sessions;
      const newEnd = newSessions.find(s => targetSId ? s.id === targetSId : true)?.endTime || "";
      const updated = { ...t, duration: String(nd), endTime: newEnd, sessions: newSessions };
      rsCurrent.current = updated;
      setRsPreview(updated); // 見た目だけ更新（保存しない）
    };
    const up = () => {
      rsRef.current = false;
      setRsPreview(null);
      if (rsCurrent.current) {
        onUpdateRef.current(rsCurrent.current); // 離したときだけ保存
      }
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup",   up);
      document.removeEventListener("touchmove", mv);
      document.removeEventListener("touchend",  up);
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup",   up);
    document.addEventListener("touchmove", mv, { passive: false });
    document.addEventListener("touchend",  up);
  }, [PPM]);
  return { onRSStart, rsPreview };
};
