import { useState, useEffect, useRef } from "react";
import { C, REPEAT_TYPES } from "../constants";
import { renderMemo, parseRepeat, addDur, durFrom, isLaterTask, t2m } from "../utils";
import { Btn, Modal, Inp } from "./ui";

// ── メモエディター ─────────────────────────────────────────────────
export const MemoEditor = ({value, onChange}) => {
  const [mode, setMode] = useState("write");
  const textareaRef = useRef(null);
  const cursorRef = useRef(null);

  useEffect(() => {
    if (cursorRef.current !== null && textareaRef.current) {
      const el = textareaRef.current;
      const {start, end} = cursorRef.current;
      el.selectionStart = start;
      el.selectionEnd = end;
      cursorRef.current = null;
    }
  });

  const handleKeyDown = e => {
    if (e.key !== "Enter") return;
    const el = e.target;
    const pos = el.selectionStart;
    const text = el.value;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const line = text.slice(lineStart, pos);
    const checkMatch = line.match(/^(\s*)(- \[[ x]\] )/);
    if (checkMatch) {
      e.preventDefault();
      const content = line.slice(checkMatch[0].length).trim();
      if (!content) { onChange(text.slice(0, lineStart) + text.slice(pos)); setTimeout(() => { el.selectionStart = el.selectionEnd = lineStart; }, 0); return; }
      const insert = "\n" + checkMatch[1] + "- [ ] ";
      onChange(text.slice(0, pos) + insert + text.slice(pos));
      setTimeout(() => { el.selectionStart = el.selectionEnd = pos + insert.length; }, 0);
      return;
    }
    const listMatch = line.match(/^(\s*)([-*] )/);
    if (listMatch) {
      e.preventDefault();
      const content = line.slice(listMatch[0].length).trim();
      if (!content) { onChange(text.slice(0, lineStart) + text.slice(pos)); setTimeout(() => { el.selectionStart = el.selectionEnd = lineStart; }, 0); return; }
      const insert = "\n" + listMatch[1] + listMatch[2];
      onChange(text.slice(0, pos) + insert + text.slice(pos));
      setTimeout(() => { el.selectionStart = el.selectionEnd = pos + insert.length; }, 0);
      return;
    }
  };

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
const JP_DAYS_R = ["日","月","火","水","木","金","土"];
const WDAY_OPTS = [1,2,3,4,5,6,0];
const MDAY_OPTS = Array.from({length:31},(_,i)=>i+1);

export const RepeatEditor = ({value, onChange}) => {
  const r = parseRepeat(value);
  const setType = type => {
    if (type === "なし")   onChange("なし");
    else if (type === "毎日")   onChange("毎日");
    else if (type === "平日のみ") onChange("平日のみ");
    else if (type === "毎週")   onChange({type:"毎週",  weekDays:[]});
    else if (type === "毎月")   onChange({type:"毎月",  monthDays:[]});
    else if (type === "月末")   onChange({type:"月末"});
    else if (type === "月末平日") onChange({type:"月末平日"});
    else if (type === "毎年")   onChange({type:"毎年",  yearDate:""});
    else if (type === "カスタム") onChange({type:"カスタム", customDates:[]});
  };
  const toggleWeekDay = d => { const cur = r.weekDays||[]; onChange({...r, weekDays: cur.includes(d) ? cur.filter(x=>x!==d) : [...cur,d]}); };
  const toggleMonthDay = d => { const cur = r.monthDays||[]; onChange({...r, monthDays: cur.includes(d) ? cur.filter(x=>x!==d) : [...cur,d].sort((a,b)=>a-b)}); };
  const toggleCustomDate = d => { const cur = r.customDates||[]; onChange({...r, customDates: cur.includes(d) ? cur.filter(x=>x!==d) : [...cur,d].sort()}); };
  const btnStyle = (active) => ({padding:"3px 8px", borderRadius:12, fontSize:10, cursor:"pointer", border:`1px solid ${active?C.success:C.border}`, background: active ? C.successS : "transparent", color: active ? C.success : C.textMuted, fontWeight: active ? 700 : 400, transition:"all .12s"});

  return (
    <div style={{marginBottom:9}}>
      <div style={{fontSize:9,color:C.textMuted,marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>繰り返し</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
        {REPEAT_TYPES.map(t=>(<button key={t} onClick={()=>setType(t)} style={btnStyle(r.type===t)}>{t}</button>))}
      </div>
      {r.type==="毎週" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:5}}>曜日を選択（複数可）</div>
          <div style={{display:"flex",gap:4}}>
            {WDAY_OPTS.map(d=>(<button key={d} onClick={()=>toggleWeekDay(d)} style={{...btnStyle((r.weekDays||[]).includes(d)), width:28, padding:"3px 0", textAlign:"center"}}>{JP_DAYS_R[d]}</button>))}
          </div>
          {(r.weekDays||[]).length===0 && <div style={{fontSize:9,color:C.warn,marginTop:4}}>⚠ 曜日を1つ以上選んでください</div>}
        </div>
      )}
      {r.type==="毎月" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:5}}>日付を選択（複数可）</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
            {MDAY_OPTS.map(d=>(<button key={d} onClick={()=>toggleMonthDay(d)} style={{...btnStyle((r.monthDays||[]).includes(d)), width:26, padding:"2px 0", textAlign:"center", fontSize:9}}>{d}</button>))}
          </div>
          {(r.monthDays||[]).length===0 && <div style={{fontSize:9,color:C.warn,marginTop:4}}>⚠ 日付を1つ以上選んでください</div>}
        </div>
      )}
      {r.type==="毎年" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
          <div style={{fontSize:9,color:C.textMuted}}>毎年</div>
          <input type="date" value={r.yearDate||""} onChange={e=>onChange({...r,yearDate:e.target.value})}
            style={{background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
          <div style={{fontSize:9,color:C.textMuted}}>の月日</div>
        </div>
      )}
      {r.type==="カスタム" && (
        <div style={{background:C.bg,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:5}}>日付を追加（複数可）</div>
          <div style={{display:"flex",gap:6,marginBottom:6,alignItems:"center"}}>
            <input type="date" id="customDateInput"
              style={{background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
            <Btn v="accent" style={{padding:"3px 10px",fontSize:10}} onClick={()=>{ const el=document.getElementById("customDateInput"); if (el?.value) { toggleCustomDate(el.value); el.value=""; } }}>追加</Btn>
          </div>
          {(r.customDates||[]).length>0 && (
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {(r.customDates||[]).map(d=>(<span key={d} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",borderRadius:10,background:C.successS,color:C.success,fontSize:9,border:`1px solid ${C.success}44`}}>{d.slice(5).replace("-","/")}<button onClick={()=>toggleCustomDate(d)} style={{background:"none",border:"none",color:C.success,cursor:"pointer",fontSize:10,lineHeight:1,padding:0}}>×</button></span>))}
            </div>
          )}
          {(r.customDates||[]).length===0 && <div style={{fontSize:9,color:C.warn}}>⚠ 日付を1つ以上追加してください</div>}
        </div>
      )}
    </div>
  );
};

// ── タスクフォーム ─────────────────────────────────────────────────
export const TaskForm = ({task,tags,onSave,onClose,isChild,defDate,defTime,parentTags,isDuplicate}) => {
  const blank = {id:"task_"+Date.now(),title:"",done:false,tags:[],memo:"",startDate:defDate||"",startTime:defTime||"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",duration:"",children:[],isLater:false,notifyStart:0,notifyDeadline:null,sessions:[]};
  const initTags = isChild && parentTags ? parentTags : (task?.tags || []);

  // _sessions の初期値を組み立てる
  const buildInitSessions = (src) => {
    const s0 = {id:"s_main", date: src.startDate||defDate||"", startTime: src.startTime||defTime||"", endTime: src.endTime||""};
    const rest = (src.sessions||[]).map((s,i) => ({id:s.id||"s_"+i, date:s.date||"", startTime:s.startTime||"", endTime:s.endTime||""}));
    return [s0, ...rest];
  };

  const initSrc = task ? {...task, tags:initTags} : {...blank, tags:initTags};
  const [f, setF] = useState({...initSrc, _sessions: buildInitSessions(initSrc)});
  const u = (k,v) => setF(p => ({...p,[k]:v}));

  // PC / スマホ判定（レイアウト切り替え用）
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  // _sessions 更新ヘルパー
  const updateSession = (idx, field, val) => {
    setF(p => {
      const ns = p._sessions.map((s,i) => i===idx ? {...s,[field]:val} : s);
      // 1枠目が変わった場合は startDate/startTime/endTime にも同期
      if (idx === 0) {
        return {...p, _sessions:ns,
          startDate: field==="date" ? val : p.startDate,
          startTime: field==="startTime" ? val : p.startTime,
          endTime:   field==="endTime"   ? val : p.endTime,
        };
      }
      return {...p, _sessions:ns};
    });
  };

  const togTag = tid => {
    if (isChild && parentTags?.length > 0) return;
    if (f.tags.includes(tid)) { u("tags", []); } else { u("tags", [tid]); }
  };

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

  const hSt  = v => { updateSession(0,"startTime",v); if(f.duration&&v) u("endTime",addDur(v,Number(f.duration))); else if(f.endTime&&v){const d=durFrom(v,f.endTime);if(d)u("duration",String(d));} };
  const hEt  = v => { updateSession(0,"endTime",v);   if(f.startTime&&v){const d=durFrom(f.startTime,v);if(d)u("duration",String(d));} };
  const hDur = v => { u("duration",v);  if(f.startTime&&v) { const et=addDur(f.startTime,Number(v)); u("endTime",et); updateSession(0,"endTime",et); } };

  const pt = tags.filter(t => !t.parentId && !t.archived);
  const ct = pid => tags.filter(t => t.parentId===pid && !t.archived);
  const tagLocked = isChild && parentTags && parentTags.length > 0;

  return (
    <Modal title={isDuplicate?"タスクを複製":task?"タスクを編集":isChild?"子タスクを追加":"タスクを追加"} onClose={onClose} wide noBackdropClose>
      <Inp label="タスク名 *" value={f.title} onChange={v=>u("title",v)} placeholder="タスク名..." autoFocus/>
      <div style={{marginBottom:9}}>
        <div style={{fontSize:9,color:C.textMuted,marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>
          タグ（1つのみ選択）{tagLocked && <span style={{color:C.warn,marginLeft:5,fontWeight:400,textTransform:"none"}}>※親タスクのタグで固定</span>}
        </div>
        {tagLocked ? (
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {parentTags.map(tid => { const tg = tags.find(t=>t.id===tid); return tg ? <div key={tid} style={{display:"inline-flex",padding:"3px 10px",borderRadius:14,fontSize:11,fontWeight:700,border:`1.5px solid ${tg.color}`,background:tg.color+"1e",color:tg.color}}>{tg.name} 🔒</div> : null; })}
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

      {/* ── 時間枠（開始日時統合） ── */}
      <div style={{background:C.bgSub,borderRadius:8,padding:9,marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:7}}>
          <div style={{fontSize:9,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:.4}}>📅 日程・時間枠</div>
          <Btn v="accent" style={{padding:"2px 9px",fontSize:9}} onClick={()=>{ u("_sessions",[...(f._sessions||[]),{id:"s_"+Date.now(),date:"",startTime:"",endTime:""}]); }}>＋ 枠を追加</Btn>
        </div>
        {(f._sessions||[]).map((s,i)=>(
          <div key={s.id||i} style={{marginBottom:5}}>
            {i===0 ? (
              /* 1枠目（削除不可・アクセントボーダー） */
              <>
                <div style={{background:C.surface,borderRadius:6,padding:"6px 8px",border:`1px solid ${C.accent}44`}}>
                  <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:4}}>
                    <input type="date" value={s.date}
                      onChange={e=>{ updateSession(0,"date",e.target.value); u("startDate",e.target.value); }}
                      style={{flex:"1 1 0",minWidth:0,background:"transparent",color:C.text,padding:"4px 5px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
                    <input type="time" value={s.startTime} onChange={e=>hSt(e.target.value)}
                      style={{flex:"0 0 76px",background:"transparent",color:C.text,padding:"4px 5px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
                    <span style={{fontSize:9,color:C.textMuted}}>〜</span>
                    <input type="time" value={s.endTime} onChange={e=>hEt(e.target.value)}
                      style={{flex:"0 0 76px",background:"transparent",color:C.text,padding:"4px 5px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
                  </div>
                </div>
                <div style={{fontSize:9,color:C.textMuted,marginTop:3,paddingLeft:2}}>
                  日付・時間が未入力の場合は「あとでやる」に分類されます
                </div>
              </>
            ) : (
              /* 2枠目以降（同じ1行レイアウト＋削除ボタン） */
              <div style={{background:C.bg,borderRadius:6,padding:"6px 8px",border:`1px solid ${C.border}`}}>
                <div style={{display:"flex",alignItems:"center",gap:3}}>
                  <input type="date" value={s.date}
                    onChange={e=>updateSession(i,"date",e.target.value)}
                    style={{flex:"1 1 0",minWidth:0,background:"transparent",color:C.text,padding:"4px 5px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
                  <input type="time" value={s.startTime}
                    onChange={e=>updateSession(i,"startTime",e.target.value)}
                    style={{flex:"0 0 76px",background:"transparent",color:C.text,padding:"4px 5px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
                  <span style={{fontSize:9,color:C.textMuted}}>〜</span>
                  <input type="time" value={s.endTime}
                    onChange={e=>updateSession(i,"endTime",e.target.value)}
                    style={{flex:"0 0 76px",background:"transparent",color:C.text,padding:"4px 5px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:11}}/>
                  <button onClick={()=>{ const ns=(f._sessions||[]).filter((_,j)=>j!==i); u("_sessions",ns); }}
                    style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:5,width:24,height:24,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* ── 見積もり所要時間 ── */}
      <div style={{background:C.bgSub,borderRadius:8,padding:9,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
        <div style={{fontSize:9,fontWeight:700,color:C.textMuted,whiteSpace:"nowrap"}}>⏱ 見積もり所要時間（分）</div>
        <input type="number" min="0" value={f.duration} onChange={e=>hDur(e.target.value)} placeholder="60"
          style={{width:80,background:C.surface,color:C.text,padding:"5px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:12}}/>
      </div>
      {/* ── 締切 ── */}
      <div style={{background:C.bgSub,borderRadius:8,padding:9,marginBottom:8}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
          <Inp label="⚠️ 締切日" value={f.deadlineDate} onChange={v=>u("deadlineDate",v)} type="date"/>
          <Inp label="締切時刻" value={f.deadlineTime} onChange={v=>u("deadlineTime",v)} type="time"/>
        </div>
      </div>
      {/* ── 通知 ── */}
      <div style={{background:C.bgSub,borderRadius:8,padding:9,marginBottom:8}}>
        <div style={{fontSize:9,fontWeight:700,color:C.textMuted,marginBottom:7,textTransform:"uppercase",letterSpacing:.4}}>🔔 通知タイミング</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div>
            <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:600}}>開始時刻{f.startTime?"":" (時刻なしは非通知)"}</div>
            <select value={f.notifyStart??0} onChange={e=>u("notifyStart",Number(e.target.value))}
              disabled={!f.startTime}
              style={{width:"100%",background:f.startTime?C.surface:C.bg,color:f.startTime?C.text:C.textMuted,padding:"5px 8px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11,opacity:f.startTime?1:0.5}}>
              <option value={0}>定刻に通知</option>
              <option value={5}>5分前</option>
              <option value={10}>10分前</option>
              <option value={15}>15分前</option>
              <option value={30}>30分前</option>
              <option value={60}>1時間前</option>
              <option value={180}>3時間前</option>
              <option value={-1}>通知しない</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:600}}>締切{f.deadlineDate?"":" (日付なしは非通知)"}</div>
            <select value={f.notifyDeadline??( f.deadlineTime ? 180 : null )} onChange={e=>u("notifyDeadline",e.target.value==="null"?null:Number(e.target.value))}
              disabled={!f.deadlineDate}
              style={{width:"100%",background:f.deadlineDate?C.surface:C.bg,color:f.deadlineDate?C.text:C.textMuted,padding:"5px 8px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11,opacity:f.deadlineDate?1:0.5}}>
              {f.deadlineTime ? (
                <><option value={15}>15分前</option><option value={30}>30分前</option><option value={60}>1時間前</option><option value={180}>3時間前</option><option value={360}>6時間前</option><option value={1440}>24時間前</option><option value={-1}>通知しない</option></>
              ) : (
                <><option value="null">当日朝9:00</option><option value={-1}>通知しない</option></>
              )}
            </select>
          </div>
        </div>
      </div>
      <RepeatEditor value={f.repeat} onChange={v=>u("repeat",v)}/>
      <MemoEditor value={f.memo} onChange={v=>u("memo",v)}/>
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn v="accent" onClick={()=>{
          if(!f.title.trim()) return;
          const s0 = (f._sessions||[])[0] || {};
          const rest = (f._sessions||[]).slice(1).filter(s=>s.date||s.startTime)
            .map(s => ({id:s.id, date:s.date||"", startTime:s.startTime||"", endTime:s.endTime||""}));
          const {_sessions, ...fClean} = f;
          onSave({
            ...fClean,
            startDate: s0.date||"",
            startTime: s0.startTime||"",
            endTime:   s0.endTime||"",
            sessions: rest,
            isLater: isLaterTask({...fClean, startDate: s0.date||"", startTime: s0.startTime||"", sessions: rest}),
          });
          onClose();
        }}>保存</Btn>
      </div>
    </Modal>
  );
};
