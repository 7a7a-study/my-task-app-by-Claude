import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

// ── 祝日データ（2024-2027）─────────────────────────────────────────
const HOLIDAYS = {
  "2024-01-01":"元日","2024-01-08":"成人の日","2024-02-11":"建国記念の日","2024-02-12":"振替",
  "2024-02-23":"天皇誕生日","2024-03-20":"春分の日","2024-04-29":"昭和の日","2024-05-03":"憲法記念日",
  "2024-05-04":"みどりの日","2024-05-05":"こどもの日","2024-05-06":"振替","2024-07-15":"海の日",
  "2024-08-11":"山の日","2024-08-12":"振替","2024-09-16":"敬老の日","2024-09-22":"秋分の日",
  "2024-09-23":"振替","2024-10-14":"スポーツの日","2024-11-03":"文化の日","2024-11-04":"振替",
  "2024-11-23":"勤労感謝の日",
  "2025-01-01":"元日","2025-01-13":"成人の日","2025-02-11":"建国記念の日","2025-02-23":"天皇誕生日",
  "2025-02-24":"振替","2025-03-20":"春分の日","2025-04-29":"昭和の日","2025-05-03":"憲法記念日",
  "2025-05-04":"みどりの日","2025-05-05":"こどもの日","2025-05-06":"振替","2025-07-21":"海の日",
  "2025-08-11":"山の日","2025-09-15":"敬老の日","2025-09-23":"秋分の日","2025-10-13":"スポーツの日",
  "2025-11-03":"文化の日","2025-11-23":"勤労感謝の日","2025-11-24":"振替",
  "2026-01-01":"元日","2026-01-12":"成人の日","2026-02-11":"建国記念の日","2026-02-23":"天皇誕生日",
  "2026-03-20":"春分の日","2026-04-29":"昭和の日","2026-05-03":"憲法記念日","2026-05-04":"みどりの日",
  "2026-05-05":"こどもの日","2026-05-06":"振替","2026-07-20":"海の日","2026-08-11":"山の日",
  "2026-09-21":"敬老の日","2026-09-22":"国民の休日","2026-09-23":"秋分の日","2026-10-12":"スポーツの日",
  "2026-11-03":"文化の日","2026-11-23":"勤労感謝の日",
  "2027-01-01":"元日","2027-01-11":"成人の日","2027-02-11":"建国記念の日","2027-02-23":"天皇誕生日",
  "2027-03-21":"春分の日","2027-04-29":"昭和の日","2027-05-03":"憲法記念日","2027-05-04":"みどりの日",
  "2027-05-05":"こどもの日","2027-07-19":"海の日","2027-08-11":"山の日","2027-09-20":"敬老の日",
  "2027-09-23":"秋分の日","2027-10-11":"スポーツの日","2027-11-03":"文化の日","2027-11-23":"勤労感謝の日",
};
const isHol = d => !!HOLIDAYS[d];
const isRed = d => { if(!d) return false; const w = new Date(d).getDay(); return w===0 || isHol(d); };

// ── カラーテーマ（明るめ・date picker対応）────────────────────────
const C = {
  bg:         "#28304e",
  bgSub:      "#303860",
  surface:    "#38426e",
  surfHov:    "#424e80",
  border:     "#4e5888",
  borderLt:   "#6070a8",
  accent:     "#99aaff",
  accentS:    "rgba(153,170,255,.15)",
  accentG:    "rgba(153,170,255,.3)",
  success:    "#5ceeaa",
  successS:   "rgba(92,238,170,.15)",
  warn:       "#ffd077",
  warnS:      "rgba(255,208,119,.15)",
  danger:     "#ff8899",
  dangerS:    "rgba(255,136,153,.15)",
  info:       "#77d8ff",
  infoS:      "rgba(119,216,255,.15)",
  text:       "#eef2ff",
  textSub:    "#aab4d8",
  textMuted:  "#7080a8",
};

const TAG_PRESETS=[
  {id:"t1",name:"仕事",  color:"#99aaff",parentId:null},
  {id:"t2",name:"個人",  color:"#5ceeaa",parentId:null},
  {id:"t3",name:"緊急",  color:"#ff8899",parentId:null},
  {id:"t4",name:"学習",  color:"#ffd077",parentId:null},
  {id:"t5",name:"健康",  color:"#77d8ff",parentId:null},
];
const REPEATS=["なし","毎日","毎週","毎月","平日のみ"];
const DAYS_JP=["月","火","水","木","金","土","日"];
const HOURS=Array.from({length:24},(_,i)=>`${String(i).padStart(2,"0")}:00`);
const ALLOWED=["w1HtaWxdSnMCV1miEm3yNF7g08J2","mszdWzOojoURpcIQdYdA3FRpQiG2"];
const SORTS=["デフォルト","開始日順","締切日順","タググループ順","完了を最後に"];

// ── ユーティリティ ──────────────────────────────────────────────────
const flatten=(ts,res=[],pt=null,pid=null)=>{ts.forEach(t=>{res.push({...t,_pt:pt,_pid:pid});if(t.children?.length)flatten(t.children,res,t.title,t.id);});return res;};
const dim=(y,m)=>new Date(y,m+1,0).getDate();
const fd=d=>{if(!d)return"";const x=new Date(d);return`${x.getMonth()+1}/${x.getDate()}`;};
const fdt=(d,t)=>{if(!d)return"";return t?`${fd(d)} ${t}`:fd(d);};
const sameDay=(a,b)=>!!a&&!!b&&a.slice(0,10)===b.slice(0,10);
const weekDates=base=>{const d=new Date(base),w=d.getDay(),m=new Date(d);m.setDate(d.getDate()-w+1);return Array.from({length:7},(_,i)=>{const x=new Date(m);x.setDate(m.getDate()+i);return x.toISOString().slice(0,10);});};
const isLater=t=>!t.startDate&&!t.startTime;
const t2m=t=>{if(!t)return null;const[h,m]=t.split(":").map(Number);return h*60+m;};
const m2t=m=>`${String(Math.floor(Math.max(0,m)/60)%24).padStart(2,"0")}:${String(Math.max(0,m)%60).padStart(2,"0")}`;
const durFrom=(a,b)=>{if(!a||!b)return null;const d=t2m(b)-t2m(a);return d>0?d:null;};
const addDur=(a,d)=>{if(!a||!d)return"";return m2t(t2m(a)+Number(d));};

// ★ 子タスク全完了→親も完了
const autoCompleteParents=tasks=>{
  const up=t=>{
    const ch=(t.children||[]).map(c=>up(c));
    const allDone=ch.length>0&&ch.every(c=>c.done);
    return{...t,children:ch,done:allDone?true:t.done};
  };
  return tasks.map(t=>up(t));
};

// ★ タグ同期（編集タスクのタグを完全上書き）
const syncTags=(tasks,editedId,editedTags,allTags)=>{
  const complete=tids=>tids.reduce((acc,tid)=>{
    if(!acc.includes(tid))acc.push(tid);
    const tag=allTags.find(t=>t.id===tid);
    if(tag?.parentId&&!acc.includes(tag.parentId))acc.push(tag.parentId);
    return acc;
  },[]);
  const walk=(task,fromParent=null)=>{
    let myTags;
    if(task.id===editedId){
      myTags=complete(editedTags); // ★完全上書き
    } else if(fromParent!==null){
      myTags=complete([...new Set([...(task.tags||[]),...fromParent])]);
    } else {
      myTags=complete(task.tags||[]);
    }
    const isEdited=task.id===editedId;
    const children=(task.children||[]).map(c=>walk(c,isEdited?editedTags:null));
    const childTids=[...new Set(children.flatMap(c=>c.tags||[]))];
    return{...task,tags:[...new Set([...myTags,...childTids])],children};
  };
  return tasks.map(t=>walk(t));
};

// メモ
const renderMemo=(memo,onToggle)=>{
  if(!memo)return null;
  return memo.split("\n").map((line,i)=>{
    const m=line.match(/^- \[(x| )\] (.*)$/);
    if(m){
      const checked=m[1]==="x";
      return(
        <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
          <div onClick={e=>{e.stopPropagation();e.preventDefault();onToggle&&onToggle(i);}}
            style={{width:13,height:13,borderRadius:3,border:`2px solid ${checked?C.accent:C.border}`,background:checked?C.accent:"transparent",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {checked&&<span style={{color:"#fff",fontSize:8,fontWeight:800}}>✓</span>}
          </div>
          <span style={{fontSize:11,color:checked?C.textMuted:C.textSub,textDecoration:checked?"line-through":"none"}}>{m[2]}</span>
        </div>
      );
    }
    return <div key={i} style={{fontSize:11,color:C.textSub,marginBottom:1,lineHeight:1.4}}>{line||<br/>}</div>;
  });
};
const toggleMemo=(memo,idx)=>{const lines=memo.split("\n");const m=lines[idx]?.match(/^- \[(x| )\] (.*)$/);if(m)lines[idx]=`- [${m[1]==="x"?" ":"x"}] ${m[2]}`;return lines.join("\n");};

// ── グローバルCSS ───────────────────────────────────────────────────
const G=`
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=DM+Sans:wght@500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#28304e;color:#eef2ff;font-family:'Noto Sans JP',sans-serif;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#4e5888;border-radius:4px}
input,textarea,select{font-family:'Noto Sans JP',sans-serif;outline:none;border:none;color:#eef2ff}
input[type=date],input[type=time],input[type=number],input[type=color]{color-scheme:light dark}
button{cursor:pointer;font-family:'Noto Sans JP',sans-serif;border:none;outline:none}
.hov:hover{background:rgba(153,170,255,0.07)!important}
.nb:hover{background:#424e80!important}
.acc:hover{filter:brightness(1.1);box-shadow:0 4px 14px rgba(153,170,255,.35)}
.acc:active{transform:scale(.97)}
.mo{animation:fi .13s ease}
.mc{animation:su .18s cubic-bezier(.34,1.56,.64,1)}
.chip:hover{filter:brightness(1.12)!important}
.drag{cursor:grab!important}.drag:active{cursor:grabbing!important;opacity:.5!important}
.rh{cursor:ns-resize!important}.rh:hover{background:rgba(153,170,255,.6)!important}
.ew{cursor:ew-resize!important}.ew:hover{background:rgba(153,170,255,.6)!important}
.tr .ta{opacity:0;transition:opacity .15s}.tr:hover .ta{opacity:1}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(8px) scale(.97);opacity:0}to{transform:none;opacity:1}}
`;

// ── 基本UI ──────────────────────────────────────────────────────────
const CB=({checked,onChange,size=14,color})=>(
  <div onClick={e=>{e.stopPropagation();onChange();}}
    style={{width:size,height:size,borderRadius:Math.max(3,size*.22),border:`2px solid ${checked?(color||C.accent):C.border}`,background:checked?(color||C.accent):"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all .15s"}}>
    {checked&&<span style={{color:"#fff",fontSize:size*.58,fontWeight:800,lineHeight:1}}>✓</span>}
  </div>
);

const Btn=({children,onClick,v="ghost",style={},disabled,title})=>{
  const vs={
    ghost: {bg:"transparent",col:C.textSub,brd:`1px solid ${C.border}`},
    accent:{bg:`linear-gradient(135deg,${C.accent},#bbccff)`,col:"#1a1e38",brd:"none",sh:"0 2px 10px rgba(153,170,255,.3)"},
    danger:{bg:C.dangerS,col:C.danger,brd:`1px solid ${C.danger}44`},
    success:{bg:C.successS,col:C.success,brd:`1px solid ${C.success}44`},
    subtle:{bg:C.surfHov,col:C.textSub,brd:`1px solid ${C.border}`},
  };
  const s=vs[v];
  return <button className={v==="accent"?"acc":""} onClick={onClick} disabled={disabled} title={title}
    style={{padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:600,transition:"all .15s",opacity:disabled?.4:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,background:s.bg,color:s.col,border:s.brd,boxShadow:s.sh,...style}}>{children}</button>;
};

const Modal=({title,children,onClose,wide})=>(
  <div className="mo" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(5,7,18,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:10,backdropFilter:"blur(5px)"}}>
    <div className="mc" onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:13,width:"100%",maxWidth:wide?680:480,border:`1px solid ${C.border}`,maxHeight:"92vh",overflow:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.7)"}}>
      <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:C.surface,zIndex:1,borderRadius:"13px 13px 0 0"}}>
        <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14}}>{title}</span>
        <button onClick={onClose} style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:24,height:24,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
      </div>
      <div style={{padding:"13px 16px"}}>{children}</div>
    </div>
  </div>
);

const Inp=({label,value,onChange,type="text",placeholder=""})=>(
  <div style={{marginBottom:7}}>
    {label&&<div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>{label}</div>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:C.bgSub,color:C.text,padding:"6px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,transition:"border .15s"}}
      onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
  </div>
);
const Sel=({label,value,onChange,options})=>(
  <div style={{marginBottom:7}}>
    {label&&<div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:C.bgSub,color:C.text,padding:"6px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12}}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
  </div>
);
const Pill=({tag})=>(
  <span style={{display:"inline-flex",alignItems:"center",padding:"1px 5px",borderRadius:8,fontSize:9,fontWeight:700,color:tag.color,background:tag.color+"1c",border:`1px solid ${tag.color}44`,whiteSpace:"nowrap"}}>{tag.name}</span>
);

// ── ログイン ────────────────────────────────────────────────────────
const Login=({onLogin,loading})=>(
  <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{textAlign:"center",padding:36}}>
      <div style={{width:62,height:62,borderRadius:18,background:`linear-gradient(135deg,${C.accent},#bbccff)`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",boxShadow:`0 8px 26px ${C.accentG}`,fontSize:26}}>✅</div>
      <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:24,marginBottom:4}}>
        <span style={{background:`linear-gradient(135deg,${C.accent},${C.info})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>マイタスク</span>
      </div>
      <div style={{color:C.textMuted,marginBottom:26,fontSize:12}}>あなただけのタスク管理</div>
      <button onClick={onLogin} disabled={loading}
        style={{display:"flex",alignItems:"center",gap:9,background:"#fff",color:"#333",border:"none",borderRadius:10,padding:"10px 24px",fontSize:13,fontWeight:700,cursor:"pointer",margin:"0 auto",boxShadow:"0 4px 16px rgba(0,0,0,.24)",opacity:loading?.7:1}}>
        <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        {loading?"ログイン中...":"Googleでログイン"}
      </button>
    </div>
  </div>
);

// ── ポップアップ ────────────────────────────────────────────────────
const Popup=({task,tags,onClose,onEdit,onToggle,onDelete,onMemoToggle,onDuplicate,anchor})=>{
  const tTags=tags.filter(t=>task.tags?.includes(t.id)&&t.parentId);
  const tc=tags.find(t=>task.tags?.includes(t.id))?.color||C.accent;
  const over=task.deadlineDate&&!task.done&&task.deadlineDate<new Date().toISOString().slice(0,10);
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:500}}>
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:Math.min(anchor?.y||80,window.innerHeight-340),left:Math.min(anchor?.x||80,window.innerWidth-306),background:C.surface,borderRadius:12,padding:13,border:`1px solid ${C.border}`,width:296,boxShadow:`0 16px 48px rgba(0,0,0,.68)`,zIndex:501}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:3,borderRadius:"12px 12px 0 0",background:`linear-gradient(90deg,${tc},${tc}55)`}}/>
        <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8,marginTop:3}}>
          <CB checked={task.done} onChange={()=>{onToggle(task.id);onClose();}} size={16} color={tc}/>
          <div style={{flex:1,minWidth:0}}>
            {task._pt&&<div style={{fontSize:9,color:C.textMuted,marginBottom:1}}>📁 {task._pt}</div>}
            <div style={{fontSize:13,fontWeight:700,textDecoration:task.done?"line-through":"none",color:task.done?C.textMuted:C.text,lineHeight:1.3}}>{task.title}</div>
            {tTags.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:4}}>{tTags.map(t=><Pill key={t.id} tag={t}/>)}</div>}
          </div>
        </div>
        {(task.startDate||task.duration||task.deadlineDate||task.repeat!=="なし")&&(
          <div style={{background:C.bg,borderRadius:7,padding:"6px 8px",marginBottom:8,fontSize:11,display:"flex",flexDirection:"column",gap:3}}>
            {task.startDate&&<div style={{color:C.textSub,display:"flex",gap:4}}><span style={{color:C.accent}}>▶</span>{fdt(task.startDate,task.startTime)}{task.endDate&&<><span style={{color:C.textMuted}}>→</span>{fdt(task.endDate,task.endTime)}</>}</div>}
            {task.duration&&<div style={{color:C.accent}}>⏱ {task.duration}分</div>}
            {task.deadlineDate&&<div style={{color:over?C.danger:C.warn}}>⚠ {fdt(task.deadlineDate,task.deadlineTime)}</div>}
            {task.repeat!=="なし"&&<div style={{color:C.success}}>↻ {task.repeat}</div>}
          </div>
        )}
        {task.memo&&<div onClick={e=>e.stopPropagation()} style={{background:C.bg,borderRadius:7,padding:"6px 8px",marginBottom:8,maxHeight:110,overflowY:"auto"}}>{renderMemo(task.memo,idx=>onMemoToggle(task.id,idx))}</div>}
        <div style={{display:"flex",gap:5}}>
          <Btn v="accent" onClick={()=>{onEdit(task);onClose();}} style={{flex:1,padding:"5px 7px",fontSize:10}}>✎ 編集</Btn>
          <Btn v="success" onClick={()=>{onDuplicate(task);onClose();}} style={{padding:"5px 8px",fontSize:10}} title="複製">⧉</Btn>
          <Btn v="danger" onClick={()=>{onDelete(task.id);onClose();}} style={{padding:"5px 8px",fontSize:10}} title="削除">✕</Btn>
        </div>
      </div>
    </div>
  );
};

// ── あとでやるパネル（★編集ボタン追加）────────────────────────────
const LaterPanel=({tasks,tags,dragTask,setDragTask,onEdit})=>{
  const later=flatten(tasks).filter(t=>t.isLater||isLater(t));
  return(
    <div style={{width:168,flexShrink:0,background:C.surface,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"8px 8px 4px",flexShrink:0,borderBottom:`1px solid ${C.border}`}}>
        <div style={{fontSize:9,fontWeight:700,color:C.warn,textTransform:"uppercase",letterSpacing:1}}>📌 あとでやる</div>
        <div style={{fontSize:8,color:C.textMuted,marginTop:1}}>ドラッグで配置 / ✎で編集</div>
      </div>
      {later.length===0&&<div style={{fontSize:11,color:C.textMuted,textAlign:"center",padding:"12px 0",flex:1}}>なし</div>}
      <div style={{flex:1,overflowY:"auto",padding:"4px 6px 6px"}}>
        {later.map(t=>{
          const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
          const isDragging=dragTask?.id===t.id;
          const childTag=tags.find(tg=>t.tags?.includes(tg.id)&&tg.parentId);
          return(
            <div key={t.id} style={{background:isDragging?C.accentS:C.bgSub,borderLeft:`3px solid ${c}`,borderRadius:"0 6px 6px 0",padding:"5px 6px",marginBottom:4,opacity:isDragging?.4:1,position:"relative"}}>
              <div draggable className="drag"
                onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("laterTaskId",t.id);setDragTask(t);}}
                onDragEnd={()=>setDragTask(null)}>
                {t._pt&&<div style={{fontSize:8,color:C.textMuted,marginBottom:1}}>📁{t._pt}</div>}
                <div style={{fontSize:10,fontWeight:600,color:C.text,lineHeight:1.3,paddingRight:16}}>{t.title}</div>
                <div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:2}}>
                  {t.duration&&<span style={{fontSize:8,color:C.accent}}>⏱{t.duration}分</span>}
                  {t.deadlineDate&&<span style={{fontSize:8,color:C.warn}}>⚠{fd(t.deadlineDate)}</span>}
                  {childTag&&<Pill tag={childTag}/>}
                </div>
              </div>
              {/* ★ 編集ボタン */}
              <button onClick={()=>onEdit(t)} title="編集"
                style={{position:"absolute",top:4,right:4,background:C.surfHov,color:C.textSub,border:"none",borderRadius:4,width:16,height:16,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>✎</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── タスクフォーム ──────────────────────────────────────────────────
const TaskForm=({task,tags,onSave,onClose,isChild,defDate,defTime})=>{
  const blank={id:"task_"+Date.now(),title:"",done:false,tags:[],memo:"",startDate:defDate||"",startTime:defTime||"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",duration:"",children:[],isLater:false};
  const [f,setF]=useState(task?{duration:"",...task}:blank);
  const u=(k,v)=>setF(p=>({...p,[k]:v}));

  const togTag=tid=>{
    const tag=tags.find(t=>t.id===tid);
    let nt=[...f.tags];
    if(nt.includes(tid)){
      nt=nt.filter(x=>x!==tid);
      if(tag?.parentId){const sib=tags.filter(t=>t.parentId===tag.parentId&&t.id!==tid).some(t=>nt.includes(t.id));if(!sib)nt=nt.filter(x=>x!==tag.parentId);}
      else{nt=nt.filter(x=>!tags.filter(t=>t.parentId===tid).map(t=>t.id).includes(x));}
    }else{nt=[...nt,tid];if(tag?.parentId&&!nt.includes(tag.parentId))nt=[...nt,tag.parentId];}
    u("tags",nt);
  };

  const hSt=v=>{u("startTime",v);if(f.duration&&v)u("endTime",addDur(v,Number(f.duration)));else if(f.endTime&&v){const d=durFrom(v,f.endTime);if(d)u("duration",String(d));}};
  const hEt=v=>{u("endTime",v);if(f.startTime&&v){const d=durFrom(f.startTime,v);if(d)u("duration",String(d));}};
  const hDur=v=>{u("duration",v);if(f.startTime&&v)u("endTime",addDur(f.startTime,Number(v)));};

  const pt=tags.filter(t=>!t.parentId&&!t.archived);
  const ct=pid=>tags.filter(t=>t.parentId===pid&&!t.archived);
  const R2=({c})=><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>{c}</div>;
  const R3=({c})=><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>{c}</div>;

  return(
    <Modal title={task?"タスクを編集":isChild?"子タスクを追加":"タスクを追加"} onClose={onClose} wide>
      <Inp label="タスク名 *" value={f.title} onChange={v=>u("title",v)} placeholder="タスク名..."/>
      {/* タグ */}
      <div style={{marginBottom:9}}>
        <div style={{fontSize:9,color:C.textMuted,marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>タグ</div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {pt.map(p=>(
            <div key={p.id}>
              <div onClick={()=>togTag(p.id)} style={{display:"inline-flex",padding:"3px 10px",borderRadius:14,fontSize:11,fontWeight:700,cursor:"pointer",border:`1.5px solid ${p.color}55`,background:f.tags.includes(p.id)?p.color+"1e":"transparent",color:f.tags.includes(p.id)?p.color:C.textMuted,marginBottom:3,transition:"all .15s"}}>{p.name}</div>
              {ct(p.id).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,paddingLeft:10}}>
                {ct(p.id).map(c=><div key={c.id} onClick={()=>togTag(c.id)} style={{display:"inline-flex",padding:"2px 8px",borderRadius:14,fontSize:10,fontWeight:600,cursor:"pointer",border:`1.5px solid ${c.color}55`,background:f.tags.includes(c.id)?c.color+"1e":"transparent",color:f.tags.includes(c.id)?c.color:C.textMuted,transition:"all .15s"}}>└ {c.name}</div>)}
              </div>}
            </div>
          ))}
        </div>
      </div>
      {/* 日時（コンパクト） */}
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
      <Sel label="繰り返し" value={f.repeat} onChange={v=>u("repeat",v)} options={REPEATS}/>
      <div style={{marginBottom:9}}>
        <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>
          メモ <span style={{fontWeight:400,textTransform:"none"}}>(- [ ] でチェックボックス)</span>
        </div>
        <textarea value={f.memo} onChange={e=>u("memo",e.target.value)} placeholder={"メモ...\n- [ ] チェック項目"} rows={3}
          style={{width:"100%",background:C.bgSub,color:C.text,padding:"7px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11,resize:"vertical",lineHeight:1.5}}/>
      </div>
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn v="accent" onClick={()=>{if(f.title.trim()){onSave({...f,isLater:isLater(f)});onClose();}}}>保存</Btn>
      </div>
    </Modal>
  );
};

// ── タスク行 ────────────────────────────────────────────────────────
const TaskRow=({task,tags,depth=0,onEdit,onDelete,onToggle,onAddChild,onDuplicate})=>{
  const [exp,setExp]=useState(true);
  const tTags=tags.filter(t=>task.tags?.includes(t.id)&&t.parentId);
  const today=new Date().toISOString().slice(0,10);
  const over=task.deadlineDate&&!task.done&&task.deadlineDate<today;
  const urgent=task.deadlineDate&&!task.done&&task.deadlineDate===today;
  const later=task.isLater||isLater(task);
  const tc=tags.find(t=>task.tags?.includes(t.id))?.color||C.accent;
  return(
    <div style={{marginLeft:depth*16}}>
      <div className="hov tr" style={{display:"flex",alignItems:"flex-start",gap:6,padding:"5px 9px",borderRadius:7,marginBottom:2,background:depth===0?C.surface:C.bgSub,border:`1px solid ${over?C.danger+"55":depth===0?C.border:"transparent"}`,borderLeft:depth>0?`3px solid ${tc}55`:undefined,opacity:task.done?.45:1,transition:"opacity .15s"}}>
        <div style={{paddingTop:1,flexShrink:0}}><CB checked={task.done} onChange={()=>onToggle(task.id)} color={tc}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap",marginBottom:1}}>
            {task.children?.length>0&&<span onClick={()=>setExp(!exp)} style={{cursor:"pointer",fontSize:8,color:C.textMuted,transform:exp?"rotate(90deg)":"",transition:"transform .15s",display:"inline-block"}}>▶</span>}
            <span style={{fontSize:12,fontWeight:depth===0?600:400,textDecoration:task.done?"line-through":"none",color:task.done?C.textMuted:C.text}}>{task.title}</span>
            {task.repeat!=="なし"&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.successS,color:C.success,fontWeight:600}}>↻{task.repeat}</span>}
            {later&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>📌</span>}
            {over&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.dangerS,color:C.danger,fontWeight:600}}>⚠超過</span>}
            {urgent&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:6,background:C.warnS,color:C.warn,fontWeight:600}}>🔥今日</span>}
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center"}}>
            {tTags.map(t=><Pill key={t.id} tag={t}/>)}
            {task.startDate&&<span style={{fontSize:9,color:C.textMuted}}>▶{fdt(task.startDate,task.startTime)}</span>}
            {task.duration&&<span style={{fontSize:9,color:C.accent}}>⏱{task.duration}分</span>}
            {task.deadlineDate&&<span style={{fontSize:9,color:over?C.danger:C.warn}}>⚠{fdt(task.deadlineDate,task.deadlineTime)}</span>}
          </div>
        </div>
        <div className="ta" style={{display:"flex",gap:2,flexShrink:0}}>
          <button title="子タスク" onClick={()=>onAddChild(task.id)} style={{background:C.accentS,color:C.accent,border:"none",borderRadius:4,width:20,height:20,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
          <button title="複製" onClick={()=>onDuplicate(task)} style={{background:C.successS,color:C.success,border:"none",borderRadius:4,width:20,height:20,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>⧉</button>
          <button title="編集" onClick={()=>onEdit(task)} style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:4,width:20,height:20,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>✎</button>
          <button title="削除" onClick={()=>onDelete(task.id)} style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:4,width:20,height:20,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>
      {exp&&task.children?.map(c=><TaskRow key={c.id} task={c} tags={tags} depth={depth+1} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate}/>)}
    </div>
  );
};

// ── リストビュー ────────────────────────────────────────────────────
const ListView=({tasks,tags,filters,onEdit,onDelete,onToggle,onAddChild,onDuplicate,sortOrder,setSortOrder})=>{
  const filtered=useMemo(()=>{
    let list=tasks;
    if(filters.tag)list=list.filter(t=>t.tags?.includes(filters.tag));
    if(filters.search)list=list.filter(t=>t.title.toLowerCase().includes(filters.search.toLowerCase()));
    if(filters.hideCompleted)list=list.filter(t=>!t.done);
    if(sortOrder==="開始日順")list=[...list].sort((a,b)=>(a.startDate||"9")>(b.startDate||"9")?1:-1);
    else if(sortOrder==="締切日順")list=[...list].sort((a,b)=>(a.deadlineDate||"9")>(b.deadlineDate||"9")?1:-1);
    else if(sortOrder==="タググループ順")list=[...list].sort((a,b)=>(a.tags?.[0]||"")>(b.tags?.[0]||"")?1:-1);
    else if(sortOrder==="完了を最後に")list=[...list].sort((a,b)=>a.done===b.done?0:a.done?1:-1);
    return list;
  },[tasks,filters,sortOrder]);
  const later=filtered.filter(t=>t.isLater||isLater(t));
  const habits=filtered.filter(t=>!(t.isLater||isLater(t))&&t.repeat!=="なし");
  const regular=filtered.filter(t=>!(t.isLater||isLater(t))&&t.repeat==="なし");
  const Sec=({title,items,color,icon})=>items.length===0?null:(
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:5}}>
        <span>{icon}</span>
        <span style={{fontSize:10,fontWeight:700,color,textTransform:"uppercase",letterSpacing:.6}}>{title}</span>
        <span style={{fontSize:9,color:C.textMuted,background:C.surfHov,padding:"0 5px",borderRadius:6}}>{items.length}</span>
      </div>
      {items.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild} onDuplicate={onDuplicate}/>)}
    </div>
  );
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:11,flexWrap:"wrap"}}>
        <span style={{fontSize:9,color:C.textMuted,fontWeight:600}}>並び替え</span>
        {SORTS.map(s=><button key={s} onClick={()=>setSortOrder(s)} style={{fontSize:9,padding:"2px 7px",borderRadius:14,border:`1px solid ${sortOrder===s?C.accent:C.border}`,background:sortOrder===s?C.accentS:"transparent",color:sortOrder===s?C.accent:C.textMuted,cursor:"pointer",fontWeight:sortOrder===s?700:400}}>{s}</button>)}
      </div>
      <Sec title="習慣・繰り返し" items={habits} color={C.success} icon="🔄"/>
      <Sec title="タスク" items={regular} color={C.accent} icon="📋"/>
      <Sec title="あとでやる" items={later} color={C.warn} icon="📌"/>
      {filtered.length===0&&<div style={{textAlign:"center",padding:"36px 0",color:C.textMuted}}><div style={{fontSize:36,marginBottom:7}}>🎉</div>タスクがありません</div>}
    </div>
  );
};

// ── タスクチップ（★リサイズハンドル常時表示）──────────────────────
const Chip=({task,tags,color,onPopup,onToggle,onUpdate,compact,hh=52})=>{
  const over=task.deadlineDate&&!task.done&&task.deadlineDate<new Date().toISOString().slice(0,10);
  const rsRef=useRef(false),rsY=useRef(0),rsDur=useRef(0);
  const onRS=useCallback(e=>{
    e.stopPropagation();e.preventDefault();
    rsRef.current=true;rsY.current=e.clientY||(e.touches?.[0]?.clientY)||0;rsDur.current=Number(task.duration)||60;
    const mv=ev=>{
      if(!rsRef.current)return;
      const y=ev.clientY||(ev.touches?.[0]?.clientY)||0;
      const nd=Math.max(15,Math.round((rsDur.current+(y-rsY.current)*60/hh)/15)*15);
      onUpdate({...task,duration:String(nd),endTime:task.startTime?addDur(task.startTime,nd):""});
    };
    const up=()=>{rsRef.current=false;document.removeEventListener("mousemove",mv);document.removeEventListener("mouseup",up);document.removeEventListener("touchmove",mv);document.removeEventListener("touchend",up);};
    document.addEventListener("mousemove",mv);document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",mv,{passive:false});document.addEventListener("touchend",up);
  },[task,onUpdate,hh]);

  const durMin=Number(task.duration)||0;
  const chipH=durMin>0&&!compact?Math.max(32,durMin/60*hh):undefined;

  return(
    <div className="chip drag" draggable
      onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",task.id);e.stopPropagation();}}
      onClick={e=>{e.stopPropagation();onPopup(e,task);}}
      style={{background:task.done?C.border+"38":color+"20",borderLeft:`3px solid ${task.done?C.textMuted:color}`,borderRadius:"0 5px 5px 0",padding:compact?"2px 4px":"3px 7px",marginBottom:2,opacity:task.done?.5:1,userSelect:"none",position:"relative",height:chipH,minHeight:compact?16:24,overflow:"hidden",display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
      <div>
        <div style={{display:"flex",alignItems:"center",gap:3}}>
          <div onClick={e=>{e.stopPropagation();onToggle(task.id);}} style={{width:7,height:7,borderRadius:1.5,border:`1.5px solid ${task.done?C.textMuted:color}`,background:task.done?color:"transparent",flexShrink:0,cursor:"pointer"}}/>
          <span style={{fontSize:compact?8:10,fontWeight:600,color:task.done?C.textMuted:color,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration:task.done?"line-through":"none"}}>
            {task.startTime&&!compact?`${task.startTime} `:""}{task.title}
          </span>
          {over&&!compact&&<span style={{fontSize:7,color:C.danger}}>⚠</span>}
        </div>
        {task._pt&&!compact&&<div style={{fontSize:7,color:C.textMuted,paddingLeft:11}}>📁{task._pt}</div>}
        {task.duration&&!compact&&<div style={{fontSize:7,color:color,paddingLeft:11,opacity:.8}}>⏱{task.duration}分</div>}
      </div>
      {/* ★ リサイズハンドル：コンパクトでなければ常に表示 */}
      {!compact&&(
        <div className="rh" onMouseDown={onRS} onTouchStart={onRS} onClick={e=>e.stopPropagation()}
          style={{height:6,width:"100%",background:color+"30",borderTop:`1px dashed ${color}55`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:2}}>
          <div style={{width:14,height:1.5,borderRadius:1,background:color+"88"}}/>
        </div>
      )}
    </div>
  );
};

// ── 日ビュー ────────────────────────────────────────────────────────
const DayView=({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,dragTask,setDragTask})=>{
  const HH=54;
  const [dropH,setDropH]=useState(null);
  const [popup,setPopup]=useState(null);
  const all=flatten(tasks);
  const todayT=all.filter(t=>{
    if(t.repeat==="毎日")return true;
    if(t.repeat==="平日のみ"){const d=new Date(today).getDay();return d>=1&&d<=5;}
    return sameDay(t.startDate,today)||sameDay(t.deadlineDate,today);
  });
  const timed=todayT.filter(t=>t.startTime&&!(t.isLater||isLater(t)));
  const untimed=todayT.filter(t=>!t.startTime&&!(t.isLater||isLater(t)));
  const hp=(e,task)=>{const r=e.currentTarget.getBoundingClientRect();setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350)});};
  const hDrop=(e,h)=>{
    e.preventDefault();setDropH(null);
    const tid=e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
    const t=tid?all.find(x=>x.id===tid)||dragTask:dragTask;
    if(!t)return;
    const st=`${String(h).padStart(2,"0")}:00`;
    onUpdate({...t,startDate:today,startTime:st,endTime:t.duration?addDur(st,Number(t.duration)):t.endTime||"",isLater:false});
    setDragTask(null);
  };
  const hMemo=(id,idx)=>{const t=all.find(x=>x.id===id);if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)});setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null);};
  const now=new Date();const isToday=today===now.toISOString().slice(0,10);
  return(
    <div style={{position:"relative"}}>
      {HOURS.slice(6,23).map((hour,i)=>{
        const h=6+i;const isDrop=dropH===h;
        const ht=timed.filter(t=>t.startTime?.slice(0,2)===String(h).padStart(2,"0"));
        return(
          <div key={hour} onDragOver={e=>{e.preventDefault();setDropH(h);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDropH(null);}} onDrop={e=>hDrop(e,h)}
            style={{display:"grid",gridTemplateColumns:"42px 1fr",minHeight:HH,borderTop:`1px solid ${C.border}20`,background:isDrop?C.accentS:"transparent",position:"relative"}}>
            {isToday&&now.getHours()===h&&<div style={{position:"absolute",left:42,right:0,top:`${(now.getMinutes()/60)*100}%`,height:2,background:C.danger,zIndex:3,pointerEvents:"none"}}><div style={{width:5,height:5,borderRadius:"50%",background:C.danger,position:"absolute",left:-2.5,top:-1.5}}/></div>}
            <div style={{fontSize:9,color:isDrop?C.accent:C.textMuted,paddingTop:2,paddingRight:4,textAlign:"right",fontFamily:"'DM Sans',sans-serif"}}>{hour}</div>
            <div style={{padding:"2px 0 2px 5px"}}>
              {isDrop?<div style={{position:"absolute",inset:"2px 5px",border:`2px dashed ${C.accent}`,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.accent,pointerEvents:"none",background:C.accentS}}>{(dragTask||{title:"タスク"}).title} → {hour}</div>
              :ht.length>0?ht.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;return<Chip key={t.id} task={t} tags={tags} color={c} onPopup={hp} onToggle={onToggle} onUpdate={onUpdate} hh={HH}/>;})
              :<div onClick={()=>onAdd(today,h)} style={{height:HH-4,cursor:"pointer",borderRadius:5,display:"flex",alignItems:"center",paddingLeft:6,fontSize:9,color:"transparent"}} onMouseEnter={e=>{e.currentTarget.style.background=C.accentS;e.currentTarget.style.color=C.accent;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="transparent";}}>＋ 追加</div>}
            </div>
          </div>
        );
      })}
      {untimed.length>0&&<div style={{marginTop:7,padding:"7px 9px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
        <div style={{fontSize:9,fontWeight:700,color:C.textMuted,marginBottom:4,textTransform:"uppercase",letterSpacing:.4}}>時間未定</div>
        {untimed.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;return<Chip key={t.id} task={t} tags={tags} color={c} onPopup={hp} onToggle={onToggle} onUpdate={onUpdate} hh={HH}/>;})}</div>}
      {popup&&<Popup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo}/>}
    </div>
  );
};

// ── 週ビュー ────────────────────────────────────────────────────────
const WeekView=({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,dragTask,setDragTask})=>{
  const HH=48;
  const wd=weekDates(today);
  const [dropCell,setDropCell]=useState(null);
  const [popup,setPopup]=useState(null);
  const all=flatten(tasks);
  const getDay=date=>all.filter(t=>{
    if(t.repeat==="毎日")return true;
    if(t.repeat==="平日のみ"){const d=new Date(date).getDay();return d>=1&&d<=5;}
    if(t.repeat==="毎週"&&t.startDate)return new Date(t.startDate).getDay()===new Date(date).getDay();
    return sameDay(t.startDate,date)||sameDay(t.deadlineDate,date);
  }).filter(t=>!(t.isLater||isLater(t)));
  const hp=(e,task)=>{const r=e.currentTarget.getBoundingClientRect();setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350)});};
  const hDrop=(e,d,h)=>{
    e.preventDefault();setDropCell(null);
    const tid=e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
    const t=tid?all.find(x=>x.id===tid)||dragTask:dragTask;
    if(!t)return;
    const st=`${String(h).padStart(2,"0")}:00`;
    onUpdate({...t,startDate:d,startTime:st,endTime:t.duration?addDur(st,Number(t.duration)):t.endTime||"",isLater:false});
    setDragTask(null);
  };
  const hMemo=(id,idx)=>{const t=all.find(x=>x.id===id);if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)});setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null);};
  return(
    <div style={{overflowX:"auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"40px repeat(7,1fr)",minWidth:540}}>
        <div/>
        {wd.map((d,i)=>{
          const isT=d===today,dt=new Date(d),isSat=dt.getDay()===6,isR=isRed(d);
          return(
            <div key={d} style={{padding:"4px 2px",textAlign:"center",borderBottom:`2px solid ${isT?C.accent:C.border}`,color:isT?C.accent:isSat?C.info:isR?C.danger:C.textSub}} title={HOLIDAYS[d]||undefined}>
              <div style={{fontSize:8,fontWeight:700}}>{DAYS_JP[i]}{HOLIDAYS[d]?<span style={{fontSize:7}}> 祝</span>:null}</div>
              <div style={{fontSize:13,fontWeight:isT?700:400,fontFamily:"'DM Sans',sans-serif"}}>{dt.getDate()}</div>
            </div>
          );
        })}
        {HOURS.slice(6,23).map((hour,i)=>{
          const h=6+i;
          return[
            <div key={hour+"l"} style={{fontSize:8,color:C.textMuted,paddingRight:3,textAlign:"right",paddingTop:2,borderTop:`1px solid ${C.border}20`,height:HH,display:"flex",alignItems:"flex-start",justifyContent:"flex-end",fontFamily:"'DM Sans',sans-serif"}}>{hour}</div>,
            ...wd.map(d=>{
              const dts=getDay(d).filter(t=>t.startTime?.slice(0,2)===String(h).padStart(2,"0"));
              const key=`${d}_${h}`;const isDrop=dropCell===key;
              const isSat=new Date(d).getDay()===6;const isR=isRed(d);
              return(
                <div key={d+hour} onDragOver={e=>{e.preventDefault();setDropCell(key);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDropCell(null);}} onDrop={e=>hDrop(e,d,h)}
                  style={{borderTop:`1px solid ${C.border}20`,height:HH,padding:"1px 2px",background:isDrop?C.accentS:isSat?"rgba(119,216,255,.04)":isR?"rgba(255,136,153,.04)":"transparent",cursor:"pointer"}} onClick={()=>{if(!dragTask)onAdd(d,h);}}>
                  {isDrop?<div style={{height:"100%",border:`2px dashed ${C.accent}`,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:C.accent}}>{hour}</div>
                  :dts.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;return<Chip key={t.id} task={t} tags={tags} color={c} onPopup={hp} onToggle={onToggle} onUpdate={onUpdate} compact hh={HH}/>;})}</div>
              );
            })
          ];
        })}
      </div>
      {popup&&<Popup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo}/>}
    </div>
  );
};

// ── ガントチャート（★開始〜終了バー＋締切マーカー＋子タグ表示）──
const GanttView=({tasks,tags,today,onUpdate,onAdd,onToggle,onEdit,onDelete,onDuplicate,dragTask,setDragTask})=>{
  const [vy,setVy]=useState(new Date(today).getFullYear());
  const [vm,setVm]=useState(new Date(today).getMonth());
  const [popup,setPopup]=useState(null);
  const [dragBar,setDragBar]=useState(null);
  const [dragDL,setDragDL]=useState(null);
  const [dropDay,setDropDay]=useState(null);
  const d=dim(vy,vm);
  const DW=30;const RH=28;
  const all=flatten(tasks);
  const vis=all.filter(t=>(t.startDate||t.endDate||t.deadlineDate)&&!(t.isLater||isLater(t)));

  const groups=useMemo(()=>{
    const g={};
    vis.forEach(t=>{
      const pid=t.tags?.find(id=>tags.find(tg=>tg.id===id&&!tg.parentId))||"__none__";
      if(!g[pid])g[pid]=[];g[pid].push(t);
    });
    return g;
  },[JSON.stringify(vis.map(t=>t.id+t.done+t.startDate+t.endDate+t.deadlineDate)),JSON.stringify(tags.map(t=>t.id))]);

  // ★ バー：startDate〜endDate
  const getBar=task=>{
    const s=task.startDate?new Date(task.startDate):null;
    const e=task.endDate?new Date(task.endDate):s;
    if(!s)return null;
    const ms=new Date(vy,vm,1),me=new Date(vy,vm,d);
    if(e<ms||s>me)return null;
    const cs=s<ms?ms:s,ce=e>me?me:e;
    return{startDay:cs.getDate(),width:Math.max(1,ce.getDate()-cs.getDate()+1)};
  };
  // ★ 締切日マーカー
  const getDL=task=>{
    if(!task.deadlineDate)return null;
    const x=new Date(task.deadlineDate);
    const ms=new Date(vy,vm,1),me=new Date(vy,vm,d);
    if(x<ms||x>me)return null;
    return x.getDate();
  };

  const ds=n=>`${vy}-${String(vm+1).padStart(2,"0")}-${String(n).padStart(2,"0")}`;
  const MN=["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const todD=today.startsWith(`${vy}-${String(vm+1).padStart(2,"0")}`)?parseInt(today.slice(8)):null;

  const hp=(e,task)=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();setPopup({task,x:Math.min(r.right+8,window.innerWidth-308),y:Math.min(r.top,window.innerHeight-350)});};
  const hMemo=(id,idx)=>{const t=all.find(x=>x.id===id);if(t)onUpdate({...t,memo:toggleMemo(t.memo,idx)});setPopup(p=>p?{...p,task:{...p.task,memo:toggleMemo(p.task.memo,idx)}}:null);};

  const hDrop=(e,n)=>{
    e.preventDefault();setDropDay(null);
    if(dragDL){
      onUpdate({...dragDL,deadlineDate:ds(n)});setDragDL(null);
    } else if(dragBar){
      const diff=n-dragBar.startDay;
      const t=dragBar.task;
      const sh=x=>{if(!x)return x;const dt=new Date(x);dt.setDate(dt.getDate()+diff);return dt.toISOString().slice(0,10);};
      onUpdate({...t,startDate:sh(t.startDate),endDate:sh(t.endDate),isLater:false});setDragBar(null);
    } else {
      const tid=e.dataTransfer.getData("taskId")||e.dataTransfer.getData("laterTaskId");
      const t=tid?all.find(x=>x.id===tid)||dragTask:dragTask;
      if(t){onUpdate({...t,startDate:ds(n),isLater:false});setDragTask(null);}
    }
  };

  // バー右端リサイズ（★endDate変更）
  const brsRef=useRef(false),brsTask=useRef(null),brsX=useRef(0),brsW=useRef(0);
  const onBRS=useCallback((e,task,barW)=>{
    e.stopPropagation();e.preventDefault();
    brsRef.current=true;brsTask.current=task;brsX.current=e.clientX||(e.touches?.[0]?.clientX)||0;brsW.current=barW;
    const mv=ev=>{
      if(!brsRef.current)return;
      const x=ev.clientX||(ev.touches?.[0]?.clientX)||0;
      const nw=Math.max(1,brsW.current+Math.round((x-brsX.current)/DW));
      const t=brsTask.current;const sd=t.startDate||t.endDate;if(!sd)return;
      const ne=new Date(sd);ne.setDate(ne.getDate()+nw-1);
      onUpdate({...t,endDate:ne.toISOString().slice(0,10)});
    };
    const up=()=>{brsRef.current=false;document.removeEventListener("mousemove",mv);document.removeEventListener("mouseup",up);document.removeEventListener("touchmove",mv);document.removeEventListener("touchend",up);};
    document.addEventListener("mousemove",mv);document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",mv,{passive:false});document.addEventListener("touchend",up);
  },[onUpdate]);

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7,flexWrap:"wrap"}}>
        <Btn onClick={()=>{if(vm===0){setVy(y=>y-1);setVm(11);}else setVm(m=>m-1);}}>‹</Btn>
        <span style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14}}>{vy}年 {MN[vm]}</span>
        <Btn onClick={()=>{if(vm===11){setVy(y=>y+1);setVm(0);}else setVm(m=>m+1);}}>›</Btn>
        <span style={{fontSize:9,color:C.textMuted}}>バー=開始〜終了 / 🔴=締切（ドラッグで移動） / 右端ドラッグ=期間変更</span>
      </div>
      <div style={{overflowX:"auto",borderRadius:10,border:`1px solid ${C.border}`,background:C.surface}}>
        <div style={{minWidth:d*DW+218}}>
          {/* ヘッダー */}
          <div style={{display:"flex",borderBottom:`2px solid ${C.border}`,background:C.bgSub,position:"sticky",top:0,zIndex:10}}>
            <div style={{width:218,flexShrink:0,padding:"6px 10px",fontSize:9,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:.4,borderRight:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:4}}>
              <span style={{width:14}}/>タスク名
            </div>
            <div style={{display:"flex"}}>
              {Array.from({length:d},(_,i)=>{
                const n=i+1,dStr=ds(n),dt=new Date(vy,vm,n);
                const isSat=dt.getDay()===6,isR=isRed(dStr),isT=n===todD;
                return(
                  <div key={n}
                    onDragOver={e=>{e.preventDefault();setDropDay(n);}} onDragLeave={()=>setDropDay(null)} onDrop={e=>hDrop(e,n)}
                    onClick={()=>{if(!dragTask&&!dragBar&&!dragDL)onAdd(dStr,null);}}
                    style={{width:DW,flexShrink:0,textAlign:"center",fontSize:9,fontWeight:isT?800:400,fontFamily:"'DM Sans',sans-serif",color:isT?C.accent:isSat?C.info:isR?C.danger:C.textMuted,background:isT?C.accentS:isSat?"rgba(119,216,255,.05)":isR?"rgba(255,136,153,.07)":"transparent",borderLeft:`1px solid ${C.border}20`,padding:"5px 0",cursor:"pointer",position:"relative"}} title={HOLIDAYS[dStr]||undefined}>
                    {n}{isHol(dStr)&&<div style={{fontSize:6,color:C.danger,lineHeight:1}}>祝</div>}
                    {isT&&<div style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
                    {dropDay===n&&<div style={{position:"absolute",inset:0,background:`${C.accent}16`,borderLeft:`2px dashed ${C.accent}`,pointerEvents:"none"}}/>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* グループ */}
          {Object.entries(groups).map(([tagId,gTasks])=>{
            const tag=tags.find(t=>t.id===tagId);
            const gc=tag?.color||C.textMuted;
            // ★ グループヘッダーに子タグを表示
            const childTagIds=[...new Set(gTasks.flatMap(t=>t.tags||[]).filter(tid=>tags.find(tg=>tg.id===tid&&tg.parentId)))];
            return(
              <div key={tagId}>
                {tagId!=="__none__"&&(
                  <div style={{display:"flex",background:`${gc}0a`,borderTop:`2px solid ${gc}44`,borderBottom:`1px solid ${gc}30`}}>
                    <div style={{width:218,flexShrink:0,padding:"4px 10px",display:"flex",alignItems:"center",gap:5,borderRight:`1px solid ${C.border}`}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:gc,boxShadow:`0 0 6px ${gc}88`,flexShrink:0}}/>
                      <span style={{fontSize:11,fontWeight:700,color:gc}}>{tag?.name}</span>
                      {childTagIds.map(tid=>{const ct=tags.find(t=>t.id===tid);return ct?<Pill key={tid} tag={ct}/>:null;})}
                      <span style={{fontSize:8,color:C.textMuted,background:C.surface+"aa",padding:"0 4px",borderRadius:5,marginLeft:"auto"}}>{gTasks.length}</span>
                    </div>
                    <div style={{flex:1,position:"relative"}}>
                      {todD&&<div style={{position:"absolute",left:(todD-1)*DW+DW/2,top:0,bottom:0,width:1,background:`${C.danger}30`,pointerEvents:"none"}}/>}
                    </div>
                  </div>
                )}
                {gTasks.map((task,ri)=>{
                  const bar=getBar(task);
                  const dlDay=getDL(task);
                  const c=tags.find(t=>task.tags?.includes(t.id))?.color||C.accent;
                  const isParent=!task._pid;
                  // ★ タスク行にも子タグをドット表示
                  const taskChildTags=tags.filter(t=>task.tags?.includes(t.id)&&t.parentId);
                  const isBarDrag=dragBar?.task?.id===task.id;
                  const isDLDrag=dragDL?.id===task.id;
                  const tod2=new Date().toISOString().slice(0,10);
                  const isOver=task.deadlineDate&&!task.done&&task.deadlineDate<tod2;
                  return(
                    <div key={task.id} style={{display:"flex",borderBottom:`1px solid ${C.border}18`,height:RH,background:ri%2===0?"transparent":"rgba(255,255,255,.01)"}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.surfHov+"44"}
                      onMouseLeave={e=>e.currentTarget.style.background=ri%2===0?"transparent":"rgba(255,255,255,.01)"}>
                      {/* 左カラム */}
                      <div style={{width:218,flexShrink:0,display:"flex",alignItems:"center",gap:5,padding:"0 7px 0 10px",borderRight:`1px solid ${C.border}`,overflow:"hidden"}}>
                        {task._pid&&<span style={{color:C.textMuted,fontSize:9,flexShrink:0,marginLeft:6}}>└</span>}
                        <CB checked={task.done} onChange={()=>onToggle(task.id)} size={12} color={c}/>
                        <span style={{fontSize:10,fontWeight:isParent?600:400,color:task.done?C.textMuted:C.text,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration:task.done?"line-through":"none",flex:1}}>{task.title}</span>
                        {/* ★ 子タグをドット表示 */}
                        <div style={{display:"flex",gap:2,flexShrink:0}}>
                          {taskChildTags.slice(0,3).map(t=><div key={t.id} style={{width:5,height:5,borderRadius:"50%",background:t.color}} title={t.name}/>)}
                          {isOver&&<span style={{fontSize:8,color:C.danger}}>⚠</span>}
                        </div>
                      </div>
                      {/* バー列 */}
                      <div style={{flex:1,position:"relative",overflow:"visible"}}
                        onDragOver={e=>{e.preventDefault();const n=Math.ceil(e.nativeEvent.offsetX/DW);setDropDay(Math.max(1,Math.min(d,n)));}}
                        onDragLeave={()=>setDropDay(null)}
                        onDrop={e=>{const n=Math.ceil(e.nativeEvent.offsetX/DW);hDrop(e,Math.max(1,Math.min(d,n)));}}>
                        {todD&&<div style={{position:"absolute",left:(todD-1)*DW+DW/2,top:0,bottom:0,width:1,background:`${C.danger}30`,pointerEvents:"none",zIndex:1}}/>}
                        {/* ★ バー（開始〜終了） */}
                        {bar&&(
                          <div draggable
                            onDragStart={e=>{e.stopPropagation();e.dataTransfer.effectAllowed="move";setDragBar({task,startDay:bar.startDay});}}
                            onDragEnd={()=>{setDragBar(null);setDropDay(null);}}
                            onClick={e=>hp(e,task)}
                            style={{position:"absolute",left:(bar.startDay-1)*DW+1,width:Math.max(bar.width*DW-2,DW/2),height:isParent?18:13,top:(RH-(isParent?18:13))/2,background:isBarDrag?`${c}38`:task.done?C.border+"44":`linear-gradient(90deg,${c}55,${c}38)`,border:`1px solid ${c}77`,borderRadius:4,display:"flex",alignItems:"center",paddingLeft:4,fontSize:8,color:task.done?C.textMuted:c,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap",cursor:"grab",textDecoration:task.done?"line-through":"none",zIndex:3,userSelect:"none"}}>
                            {bar.width>1?task.title.slice(0,16):""}
                            {/* 右端リサイズ */}
                            <div className="ew" onMouseDown={e=>onBRS(e,task,bar.width)} onTouchStart={e=>onBRS(e,task,bar.width)} onClick={e=>e.stopPropagation()}
                              style={{position:"absolute",right:0,top:0,bottom:0,width:6,background:`${c}55`,borderRadius:"0 3px 3px 0",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              <div style={{width:1.5,height:7,background:"rgba(255,255,255,.5)",borderRadius:1}}/>
                            </div>
                          </div>
                        )}
                        {/* ★ 締切日マーカー（ドラッグ移動可） */}
                        {dlDay&&(
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
                })}
              </div>
            );
          })}
          {vis.length===0&&<div style={{padding:"28px 0",textAlign:"center",color:C.textMuted,fontSize:11}}>この月にタスクがありません<br/><span style={{fontSize:9}}>日付クリックで追加</span></div>}
        </div>
      </div>
      {popup&&<Popup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onDuplicate={onDuplicate} onMemoToggle={hMemo}/>}
    </div>
  );
};

// ── テンプレート ────────────────────────────────────────────────────
const TemplatesView=({templates,setTemplates,onUse,tags})=>{
  const [show,setShow]=useState(false);
  const [form,setForm]=useState({name:"",tasks:[{title:"",memo:"",tags:[],children:[]}]});
  const pt=tags.filter(t=>!t.parentId&&!t.archived);
  const ct=pid=>tags.filter(t=>t.parentId===pid&&!t.archived);
  const togT=(cur,tid,fn)=>{
    const tag=tags.find(t=>t.id===tid);let nt=[...cur];
    if(nt.includes(tid)){
      nt=nt.filter(x=>x!==tid);
      if(tag?.parentId){const sib=tags.filter(t=>t.parentId===tag.parentId&&t.id!==tid).some(t=>nt.includes(t.id));if(!sib)nt=nt.filter(x=>x!==tag.parentId);}
      else{nt=nt.filter(x=>!tags.filter(t=>t.parentId===tid).map(t=>t.id).includes(x));}
    }else{nt=[...nt,tid];if(tag?.parentId&&!nt.includes(tag.parentId))nt=[...nt,tag.parentId];}
    fn(nt);
  };
  const TagRow=({sel,onChange})=>(
    <div style={{marginBottom:5}}>
      {pt.map(p=>(
        <div key={p.id} style={{marginBottom:3}}>
          <div onClick={()=>togT(sel,p.id,onChange)} style={{display:"inline-flex",padding:"2px 9px",borderRadius:12,fontSize:10,fontWeight:700,cursor:"pointer",border:`1.5px solid ${p.color}55`,background:sel.includes(p.id)?p.color+"1e":"transparent",color:sel.includes(p.id)?p.color:C.textMuted,marginBottom:2,transition:"all .15s"}}>{p.name}</div>
          {ct(p.id).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,paddingLeft:10}}>{ct(p.id).map(c=><div key={c.id} onClick={()=>togT(sel,c.id,onChange)} style={{display:"inline-flex",padding:"1px 7px",borderRadius:12,fontSize:9,fontWeight:600,cursor:"pointer",border:`1.5px solid ${c.color}55`,background:sel.includes(c.id)?c.color+"1e":"transparent",color:sel.includes(c.id)?c.color:C.textMuted,transition:"all .15s"}}>└ {c.name}</div>)}</div>}
        </div>
      ))}
    </div>
  );
  const save=()=>{if(!form.name.trim())return;setTemplates(t=>[...t,{id:"tpl_"+Date.now(),name:form.name,tasks:form.tasks.filter(t=>t.title)}]);setForm({name:"",tasks:[{title:"",memo:"",tags:[],children:[]}]});setShow(false);};
  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:9}}><Btn v="accent" onClick={()=>setShow(true)}>+ テンプレートを作成</Btn></div>
      {templates.length===0&&<div style={{textAlign:"center",padding:28,color:C.textMuted}}>テンプレートがまだありません</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:9}}>
        {templates.map(tpl=>(
          <div key={tpl.id} style={{background:C.surface,borderRadius:11,padding:11,border:`1px solid ${C.border}`,display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13}}>{tpl.name}</div>
            <div style={{flex:1}}>
              {tpl.tasks.map((t,i)=>(
                <div key={i}>
                  <div style={{display:"flex",alignItems:"center",gap:4,padding:"3px 0",borderBottom:`1px solid ${C.border}20`,fontSize:11,color:C.textSub}}>
                    <div style={{width:4,height:4,borderRadius:"50%",background:C.accent,flexShrink:0}}/>{t.title}
                    {(t.tags||[]).length>0&&<div style={{display:"flex",gap:2,marginLeft:"auto"}}>{(t.tags||[]).map(tid=>{const tg=tags.find(x=>x.id===tid&&x.parentId);return tg?<Pill key={tid} tag={tg}/>:null;})}</div>}
                  </div>
                  {(t.children||[]).map((c,j)=><div key={j} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 0 2px 9px",fontSize:10,color:C.textMuted}}><div style={{width:3,height:3,borderRadius:"50%",background:C.textMuted,flexShrink:0}}/>{c.title}</div>)}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:5}}>
              <Btn v="accent" onClick={()=>onUse(tpl)} style={{flex:1,padding:"5px",fontSize:10}}>使う</Btn>
              <Btn v="danger" onClick={()=>setTemplates(t=>t.filter(x=>x.id!==tpl.id))} style={{padding:"5px 8px",fontSize:10}}>削除</Btn>
            </div>
          </div>
        ))}
      </div>
      {show&&(
        <Modal title="テンプレートを作成" onClose={()=>setShow(false)} wide>
          <Inp label="テンプレート名" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="例: 週次レビュー"/>
          <div style={{marginBottom:9}}>
            <div style={{fontSize:9,color:C.textMuted,marginBottom:6,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>タスク一覧</div>
            {form.tasks.map((t,i)=>(
              <div key={i} style={{background:C.bgSub,borderRadius:8,padding:9,marginBottom:6,border:`1px solid ${C.border}`}}>
                <div style={{display:"flex",gap:5,marginBottom:5}}>
                  <input value={t.title} onChange={e=>{const ts=[...form.tasks];ts[i]={...ts[i],title:e.target.value};setForm(f=>({...f,tasks:ts}));}} placeholder={`タスク ${i+1}`}
                    style={{flex:1,background:C.surface,color:C.text,padding:"5px 8px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:11}}/>
                  <button onClick={()=>setForm(f=>({...f,tasks:f.tasks.filter((_,idx)=>idx!==i)}))} style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:5,width:26,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>
                <textarea value={t.memo||""} onChange={e=>{const ts=[...form.tasks];ts[i]={...ts[i],memo:e.target.value};setForm(f=>({...f,tasks:ts}));}} placeholder="メモ（任意）" rows={2}
                  style={{width:"100%",background:C.surface,color:C.text,padding:"5px 8px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:10,resize:"none",marginBottom:5}}/>
                <TagRow sel={t.tags||[]} onChange={nt=>{const ts=[...form.tasks];ts[i]={...ts[i],tags:nt};setForm(f=>({...f,tasks:ts}));}}/>
                {(t.children||[]).map((c,j)=>(
                  <div key={j} style={{marginLeft:10,marginBottom:4,background:C.surface,borderRadius:6,padding:7,border:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
                      <span style={{color:C.textMuted,fontSize:10}}>└</span>
                      <input value={c.title} onChange={e=>{const ts=[...form.tasks];ts[i].children[j]={...ts[i].children[j],title:e.target.value};setForm(f=>({...f,tasks:ts}));}} placeholder={`子タスク ${j+1}`}
                        style={{flex:1,background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:10}}/>
                      <button onClick={()=>setForm(f=>{const ts=[...f.tasks];ts[i].children=ts[i].children.filter((_,idx)=>idx!==j);return{...f,tasks:ts};})}
                        style={{background:C.dangerS,color:C.danger,border:"none",borderRadius:4,width:20,height:20,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                    </div>
                    <textarea value={c.memo||""} onChange={e=>{const ts=[...form.tasks];ts[i].children[j]={...ts[i].children[j],memo:e.target.value};setForm(f=>({...f,tasks:ts}));}} placeholder="子タスクのメモ" rows={2}
                      style={{width:"100%",background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:5,border:`1px solid ${C.border}`,fontSize:9,resize:"none"}}/>
                  </div>
                ))}
                <button onClick={()=>{const ts=[...form.tasks];ts[i]={...ts[i],children:[...(ts[i].children||[]),{title:"",memo:"",tags:[]}]};setForm(f=>({...f,tasks:ts}));}}
                  style={{background:"none",color:C.accent,border:`1px dashed ${C.accent}44`,borderRadius:5,padding:"2px 8px",fontSize:9,cursor:"pointer",marginTop:2}}>+ 子タスク追加</button>
              </div>
            ))}
            <Btn onClick={()=>setForm(f=>({...f,tasks:[...f.tasks,{title:"",memo:"",tags:[],children:[]}]}))} style={{width:"100%",justifyContent:"center"}}>+ タスク追加</Btn>
          </div>
          <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}><Btn onClick={()=>setShow(false)}>キャンセル</Btn><Btn v="accent" onClick={save}>保存</Btn></div>
        </Modal>
      )}
    </div>
  );
};

// ── タグ管理 ────────────────────────────────────────────────────────
const TagsView=({tags,setTags})=>{
  const [form,setForm]=useState({name:"",color:"#99aaff",parentId:null});
  const [editId,setEditId]=useState(null);
  const [ef,setEf]=useState(null);
  const [showA,setShowA]=useState(false);
  const add=()=>{if(!form.name.trim())return;setTags(t=>[...t,{id:"tag_"+Date.now(),name:form.name,color:form.color,parentId:form.parentId||null,archived:false}]);setForm({name:"",color:"#99aaff",parentId:null});};
  const arch=id=>setTags(ts=>ts.map(t=>t.id===id?{...t,archived:true}:t));
  const rest=id=>setTags(ts=>ts.map(t=>t.id===id?{...t,archived:false}:t));
  const pt=tags.filter(t=>!t.parentId&&!t.archived);
  const ct=pid=>tags.filter(t=>t.parentId===pid&&!t.archived);
  const at=tags.filter(t=>t.archived);
  const ER=({t})=>editId===t.id&&ef?(
    <div style={{background:C.bgSub,borderRadius:6,padding:8,marginTop:5,display:"flex",gap:6,alignItems:"flex-end"}}>
      <div style={{flex:1}}><Inp label="タグ名" value={ef.name} onChange={v=>setEf(f=>({...f,name:v}))}/></div>
      <div style={{marginBottom:7}}><div style={{fontSize:8,color:C.textMuted,marginBottom:2,fontWeight:700}}>色</div><input type="color" value={ef.color} onChange={e=>setEf(f=>({...f,color:e.target.value}))} style={{width:34,height:30,borderRadius:5,border:`1px solid ${C.border}`,background:"none",cursor:"pointer",padding:2}}/></div>
      <div style={{marginBottom:7,display:"flex",gap:4}}><Btn v="accent" onClick={()=>{setTags(ts=>ts.map(t=>t.id===t.id?{...t,...ef}:t));setEditId(null);}}>保存</Btn><Btn onClick={()=>setEditId(null)}>✕</Btn></div>
    </div>
  ):null;
  return(
    <div>
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
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {pt.map(p=>(
          <div key={p.id} style={{background:C.surface,borderRadius:10,padding:10,border:`1px solid ${p.color}33`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:"50%",background:p.color}}/><span style={{fontWeight:700,color:p.color,fontSize:13}}>{p.name}</span><span style={{fontSize:8,color:C.textMuted,background:C.surfHov,padding:"0 4px",borderRadius:5}}>親</span></div>
              <div style={{display:"flex",gap:3}}><Btn onClick={()=>{setEditId(p.id);setEf({name:p.name,color:p.color});}} style={{padding:"2px 7px",fontSize:9}}>編集</Btn><Btn v="danger" onClick={()=>arch(p.id)} style={{padding:"2px 7px",fontSize:9}}>アーカイブ</Btn></div>
            </div>
            <ER t={p}/>
            {ct(p.id).length>0&&<div style={{paddingLeft:14,marginTop:6,display:"flex",flexDirection:"column",gap:3}}>
              {ct(p.id).map(c=>(
                <div key={c.id} style={{background:C.bgSub,borderRadius:7,border:`1px solid ${c.color}33`,padding:"5px 8px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:7,height:7,borderRadius:"50%",background:c.color}}/><span style={{fontSize:11,color:c.color,fontWeight:600}}>{c.name}</span><span style={{fontSize:8,color:C.textMuted}}>小</span></div><div style={{display:"flex",gap:3}}><Btn onClick={()=>{setEditId(c.id);setEf({name:c.name,color:c.color});}} style={{padding:"2px 6px",fontSize:9}}>編集</Btn><Btn v="danger" onClick={()=>arch(c.id)} style={{padding:"2px 6px",fontSize:9}}>アーカイブ</Btn></div></div>
                  <ER t={c}/>
                </div>
              ))}
            </div>}
          </div>
        ))}
      </div>
      {at.length>0&&<div style={{marginTop:12}}><button onClick={()=>setShowA(!showA)} style={{background:"none",border:"none",color:C.textMuted,fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:4,marginBottom:5}}>{showA?"▼":"▶"} アーカイブ済み ({at.length})</button>{showA&&<div style={{display:"flex",flexDirection:"column",gap:4}}>{at.map(t=>(<div key={t.id} style={{background:C.surface,borderRadius:7,padding:"6px 10px",border:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",opacity:.55}}><div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:7,height:7,borderRadius:"50%",background:t.color}}/><span style={{fontSize:11,color:C.textSub}}>{t.name}</span></div><div style={{display:"flex",gap:3}}><Btn onClick={()=>rest(t.id)} style={{padding:"2px 6px",fontSize:9}}>復元</Btn><Btn v="danger" onClick={()=>setTags(ts=>ts.filter(x=>x.id!==t.id))} style={{padding:"2px 6px",fontSize:9}}>完全削除</Btn></div></div>))}</div>}</div>}
    </div>
  );
};

// ── メインApp ───────────────────────────────────────────────────────
export default function App(){
  const [sideOpen,setSideOpen]=useState(true);
  const [sortOrder,setSortOrder]=useState("デフォルト");
  const today=new Date().toISOString().slice(0,10);
  const [user,setUser]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [loginLoading,setLoginLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [tasks,setTasksRaw]=useState([]);
  const [tags,setTagsRaw]=useState(TAG_PRESETS);
  const [templates,setTemplatesRaw]=useState([]);
  const [view,setView]=useState("list");
  const [showForm,setShowForm]=useState(false);
  const [editTask,setEditTask]=useState(null);
  const [addChildTo,setAddChildTo]=useState(null);
  const [filters,setFilters]=useState({tag:"",search:"",hideCompleted:false});
  const [dragTask,setDragTask]=useState(null);
  const [defDate,setDefDate]=useState(null);
  const [defTime,setDefTime]=useState(null);

  useEffect(()=>{const u=onAuthStateChanged(auth,u=>{setUser(u);setAuthLoading(false);});return u;},[]);
  useEffect(()=>{
    if(!user)return;
    const u=onSnapshot(doc(db,"users",user.uid),snap=>{
      if(snap.exists()){const d=snap.data();if(d.tasks)setTasksRaw(d.tasks);if(d.tags)setTagsRaw(d.tags);if(d.templates)setTemplatesRaw(d.templates);}
    });
    return u;
  },[user]);

  const save2DB=async(t,tg,tp)=>{if(!user)return;setSaving(true);try{await setDoc(doc(db,"users",user.uid),{tasks:t,tags:tg,templates:tp,updatedAt:new Date().toISOString()});}catch(e){console.error(e);}setSaving(false);};
  const setTasks=t=>{setTasksRaw(t);save2DB(t,tags,templates);};
  const setTags=t=>{setTagsRaw(t);save2DB(tasks,t,templates);};
  const setTemplates=t=>{setTemplatesRaw(t);save2DB(tasks,tags,t);};

  const handleLogin=async()=>{setLoginLoading(true);try{const r=await signInWithPopup(auth,provider);if(!ALLOWED.includes(r.user.uid)){await signOut(auth);alert("アクセスできません。");}}catch(e){console.error(e);}setLoginLoading(false);};

  const updTree=(ts,id,fn)=>ts.map(t=>t.id===id?fn(t):{...t,children:updTree(t.children||[],id,fn)});
  const delTree=(ts,id)=>ts.filter(t=>t.id!==id).map(t=>({...t,children:delTree(t.children||[],id)}));
  const addChild=(ts,pid,c)=>ts.map(t=>t.id===pid?{...t,children:[...(t.children||[]),c]}:{...t,children:addChild(t.children||[],pid,c)});

  const handleSave=f=>{
    const fw={...f,isLater:isLater(f)};
    let nt;
    if(editTask)nt=updTree(tasks,f.id,()=>fw);
    else if(addChildTo)nt=addChild(tasks,addChildTo,fw);
    else nt=[...tasks,fw];
    // ★ タグ同期（完全上書き）
    const synced=syncTags(nt,fw.id,fw.tags,tags);
    // ★ 子タスク全完了チェック
    setTasks(autoCompleteParents(synced));
    setEditTask(null);setAddChildTo(null);
  };

  const handleUpdate=updated=>{
    const clean={...updated};delete clean._pt;delete clean._pid;
    const synced=syncTags(updTree(tasks,clean.id,()=>clean),clean.id,clean.tags,tags);
    setTasks(autoCompleteParents(synced));
    setDragTask(null);
  };
  const handleAdd=(date,hour)=>{setDefDate(date);setDefTime(hour!=null?`${String(hour).padStart(2,"0")}:00`:null);setEditTask(null);setAddChildTo(null);setShowForm(true);};
  const handleToggle=id=>{setTasks(autoCompleteParents(updTree(tasks,id,t=>({...t,done:!t.done}))));};
  const handleDelete=id=>setTasks(delTree(tasks,id));
  const handleEdit=t=>{setEditTask(t);setShowForm(true);};
  const handleDuplicate=t=>{
    const dup=tk=>({...tk,id:"task_"+Date.now()+Math.random(),title:tk.title+" (コピー)",done:false,children:(tk.children||[]).map(c=>dup(c))});
    const d=dup(t);
    let nt;
    if(t._pid)nt=addChild(tasks,t._pid,d);
    else{const idx=tasks.findIndex(x=>x.id===t.id);nt=[...tasks.slice(0,idx+1),d,...tasks.slice(idx+1)];}
    setTasks(nt);
  };
  const handleUseTemplate=tpl=>{
    const mk=t=>({id:"task_"+Date.now()+Math.random(),title:t.title,done:false,tags:t.tags||[],memo:t.memo||"",startDate:"",startTime:"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",duration:"",isLater:true,children:(t.children||[]).map(c=>mk(c))});
    setTasks([...tasks,...tpl.tasks.map(t=>mk(t))]);setView("list");
  };

  const allFlat=flatten(tasks);
  const doneCnt=allFlat.filter(t=>t.done).length;
  const totalCnt=allFlat.length;
  // ★ 進捗分母＝未完了数（完了は除く）
  const activeCnt=allFlat.filter(t=>!t.done).length;
  const pct=totalCnt>0?Math.round((doneCnt/totalCnt)*100):0;

  const NAV=[
    {id:"list",label:"リスト",icon:"☰"},
    {id:"day",label:"日",icon:"📆"},
    {id:"week",label:"週",icon:"📅"},
    {id:"gantt",label:"ガント",icon:"📊"},
    {id:"templates",label:"テンプレート",icon:"📋"},
    {id:"tagmgr",label:"タグ管理",icon:"🏷"},
  ];
  const ptags=tags.filter(t=>!t.parentId&&!t.archived);
  const showLater=["day","week","gantt"].includes(view);

  if(authLoading)return<div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",color:C.textMuted,fontSize:13}}>読み込み中...</div>;
  if(!user)return<Login onLogin={handleLogin} loading={loginLoading}/>;

  return(
    <>
      <style>{G}</style>
      <div style={{minHeight:"100vh",background:C.bg,display:"flex"}}>
        {/* ── サイドバー ── */}
        <div style={{width:sideOpen?200:42,flexShrink:0,background:C.surface,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,height:"100vh",overflowY:"auto",zIndex:10,transition:"width .2s",boxShadow:"2px 0 16px rgba(0,0,0,.3)"}}>
          <div style={{padding:`10px ${sideOpen?12:5}px 9px`,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:4,flexShrink:0}}>
            {sideOpen&&<div style={{minWidth:0,flex:1}}>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:14,whiteSpace:"nowrap",letterSpacing:-.5}}>
                <span style={{background:`linear-gradient(135deg,${C.accent},${C.info})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>◈ マイタスク</span>
              </div>
              <div style={{fontSize:8,color:C.textMuted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</div>
              {saving&&<div style={{fontSize:8,color:C.success,marginTop:1}}>💾 保存中...</div>}
              {/* ★ 進捗：●/▲の▲は未完了数のみ */}
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

          {/* ナビ */}
          <div style={{padding:`6px ${sideOpen?6:3}px`,flex:1,overflowY:"auto"}}>
            {NAV.map(n=>(
              <button key={n.id} className="nb" onClick={()=>setView(n.id)} title={n.label}
                style={{display:"flex",alignItems:"center",gap:sideOpen?7:0,justifyContent:sideOpen?"flex-start":"center",width:"100%",padding:"6px 6px",borderRadius:7,marginBottom:1,background:view===n.id?C.accentS:"transparent",color:view===n.id?C.accent:C.textSub,border:view===n.id?`1px solid ${C.accent}33`:"1px solid transparent",fontSize:11,fontWeight:view===n.id?700:400,transition:"all .15s",textAlign:"left"}}>
                <span style={{fontSize:14,flexShrink:0}}>{n.icon}</span>
                {sideOpen&&n.label}
                {sideOpen&&view===n.id&&<div style={{marginLeft:"auto",width:4,height:4,borderRadius:"50%",background:C.accent}}/>}
              </button>
            ))}
          </div>

          {/* フィルター */}
          {sideOpen&&<div style={{padding:"8px 8px",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
            <div style={{position:"relative",marginBottom:4}}>
              <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",fontSize:10,color:C.textMuted}}>🔍</span>
              <input value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} placeholder="検索..."
                style={{width:"100%",background:C.bgSub,color:C.text,padding:"4px 7px 4px 22px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:10}}/>
            </div>
            <select value={filters.tag} onChange={e=>setFilters(f=>({...f,tag:e.target.value}))}
              style={{width:"100%",background:C.bgSub,color:C.text,padding:"4px 7px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:10,marginBottom:5}}>
              <option value="">すべてのタグ</option>
              {ptags.map(p=>(<optgroup key={p.id} label={p.name}><option value={p.id}>{p.name}（全体）</option>{tags.filter(t=>t.parentId===p.id&&!t.archived).map(c=><option key={c.id} value={c.id}>└ {c.name}</option>)}</optgroup>))}
            </select>
            <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:7}}>
              <CB checked={filters.hideCompleted} onChange={()=>setFilters(f=>({...f,hideCompleted:!f.hideCompleted}))} size={12}/>
              <span style={{fontSize:9,color:C.textMuted}}>完了を隠す</span>
            </div>
            <button onClick={()=>signOut(auth)} style={{width:"100%",background:"transparent",color:C.textMuted,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px",fontSize:9,cursor:"pointer"}}
              onMouseEnter={e=>{e.currentTarget.style.background=C.dangerS;e.currentTarget.style.color=C.danger;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.textMuted;}}>ログアウト</button>
          </div>}
          {!sideOpen&&<div style={{padding:"5px 3px",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
            <button onClick={()=>signOut(auth)} title="ログアウト" style={{background:"transparent",color:C.textMuted,border:`1px solid ${C.border}`,borderRadius:6,padding:"4px",fontSize:10,cursor:"pointer",width:"100%"}}>↩</button>
          </div>}
        </div>

        {/* ── メイン ── */}
        <div style={{marginLeft:sideOpen?200:42,flex:1,display:"flex",minHeight:"100vh",transition:"margin .2s",overflow:"hidden"}}>
          <div style={{flex:1,padding:"13px 17px",minWidth:0,overflowX:"auto",overflowY:"auto"}}>
            {/* ページヘッダー（コンパクト） */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:11}}>
              <div>
                <h1 style={{fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:17,letterSpacing:-.4,lineHeight:1.2}}>
                  {NAV.find(n=>n.id===view)?.icon} {NAV.find(n=>n.id===view)?.label}
                </h1>
                <div style={{fontSize:9,color:C.textMuted,marginTop:1}}>
                  {new Date(today).toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"short"})}
                </div>
              </div>
              {["list","day","week","gantt"].includes(view)&&(
                <Btn v="accent" onClick={()=>{setDefDate(null);setDefTime(null);setEditTask(null);setAddChildTo(null);setShowForm(true);}}>＋ 追加</Btn>
              )}
            </div>

            {view==="list"&&<ListView tasks={tasks} tags={tags} filters={filters} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onAddChild={pid=>{setAddChildTo(pid);setShowForm(true);}} onDuplicate={handleDuplicate} sortOrder={sortOrder} setSortOrder={setSortOrder}/>}
            {view==="day"&&<DayView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="week"&&<WeekView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="gantt"&&<GanttView tasks={tasks} tags={tags} today={today} onUpdate={handleUpdate} onAdd={handleAdd} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDuplicate={handleDuplicate} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="templates"&&<TemplatesView templates={templates} setTemplates={setTemplates} onUse={handleUseTemplate} tags={tags}/>}
            {view==="tagmgr"&&<TagsView tags={tags} setTags={setTags}/>}
          </div>
          {/* ★ あとでやるパネル（編集ボタン付き）*/}
          {showLater&&<LaterPanel tasks={tasks} tags={tags} dragTask={dragTask} setDragTask={setDragTask} onEdit={handleEdit}/>}
        </div>
      </div>
      {showForm&&<TaskForm task={editTask} tags={tags} isChild={!!addChildTo} onSave={handleSave} defDate={defDate} defTime={defTime} onClose={()=>{setShowForm(false);setEditTask(null);setAddChildTo(null);setDefDate(null);setDefTime(null);}}/>}
    </>
  );
}
