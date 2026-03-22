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
export const isLaterTask = t => !t.startDate && !t.startTime && !(t.sessions||[]).length;

// ── ツリー操作 ────────────────────────────────────────────────────
export const flatten = (ts, res=[], pt=null, pid=null) => {
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
  if (r.type === "カスタム") return (r.customDates || []).includes(date);
  return false;
};

export const expandOverrides = (tasks) => {
  const extras = [];
  flatten(tasks).forEach(t => {
    if (!t.overrideDates) return;
    Object.entries(t.overrideDates).forEach(([origDate, ov]) => {
      extras.push({
        ...t,
        startDate:    ov.startDate    ?? t.startDate,
        startTime:    ov.startTime    ?? t.startTime,
        endDate:      ov.endDate      ?? t.endDate,
        endTime:      ov.endTime      ?? t.endTime,
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
