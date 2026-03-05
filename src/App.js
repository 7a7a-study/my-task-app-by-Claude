import { useState, useMemo, useEffect } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

const COLORS={bg:"#0f1117",surface:"#1a1d27",surfaceHover:"#21253a",border:"#2a2d3e",accent:"#6c63ff",accentSoft:"rgba(108,99,255,0.15)",success:"#22d3a5",warning:"#f59e0b",danger:"#f43f5e",text:"#e2e8f0",textMuted:"#64748b",textSoft:"#94a3b8"};
const TAG_PRESETS=[{id:"t1",name:"仕事",color:"#6c63ff",parentId:null},{id:"t2",name:"個人",color:"#22d3a5",parentId:null},{id:"t3",name:"緊急",color:"#f43f5e",parentId:null},{id:"t4",name:"学習",color:"#f59e0b",parentId:null},{id:"t5",name:"健康",color:"#10b981",parentId:null}];
const REPEAT_OPTIONS=["なし","毎日","毎週","毎月","平日のみ"];
const DAYS_JP=["月","火","水","木","金","土","日"];
const HOURS=Array.from({length:24},(_,i)=>`${String(i).padStart(2,"0")}:00`);
const ALLOWED_UIDS=["w1HtaWxdSnMCV1miEm3yNF7g08J2","mszdWzOojoURpcIQdYdA3FRpQiG2"];

const flattenTasks=(tasks,result=[],parentTitle=null)=>{tasks.forEach(t=>{result.push({...t,_parentTitle:parentTitle});if(t.children?.length)flattenTasks(t.children,result,t.title);});return result;};
const getDaysInMonth=(y,m)=>new Date(y,m+1,0).getDate();
const formatDate=d=>{if(!d)return"";const dt=new Date(d);return`${dt.getMonth()+1}/${dt.getDate()}`;};
const formatDateTime=(d,t)=>{if(!d)return"";return t?`${formatDate(d)} ${t}`:formatDate(d);};
const isSameDay=(d1,d2)=>(!d1||!d2)?false:d1.slice(0,10)===d2.slice(0,10);
const getWeekDates=base=>{const d=new Date(base),day=d.getDay(),mon=new Date(d);mon.setDate(d.getDate()-day+1);return Array.from({length:7},(_,i)=>{const dt=new Date(mon);dt.setDate(mon.getDate()+i);return dt.toISOString().slice(0,10);});};
const isAutoLater=task=>!task.startDate&&!task.startTime;
const timeToMin=t=>{if(!t)return null;const[h,m]=t.split(":").map(Number);return h*60+m;};
const minToTime=m=>`${String(Math.floor(m/60)%24).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const calcDuration=(st,et)=>{if(!st||!et)return null;const d=timeToMin(et)-timeToMin(st);return d>0?d:null;};
const applyDuration=(st,dur)=>{if(!st||!dur)return"";return minToTime(timeToMin(st)+dur);};

// メモのチェックボックス記法パーサー
const parseMemo=(memo,onToggle)=>{
  if(!memo)return null;
  return memo.split("\n").map((line,i)=>{
    const m=line.match(/^- \[(x| )\] (.*)$/);
    if(m){const checked=m[1]==="x";return(<div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}><div onClick={()=>onToggle(i)} style={{width:14,height:14,borderRadius:3,border:`2px solid ${checked?COLORS.accent:COLORS.border}`,background:checked?COLORS.accent:"transparent",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{checked&&<span style={{color:"#fff",fontSize:9,fontWeight:700}}>✓</span>}</div><span style={{fontSize:12,color:checked?COLORS.textMuted:COLORS.textSoft,textDecoration:checked?"line-through":"none"}}>{m[2]}</span></div>);}
    return <div key={i} style={{fontSize:12,color:COLORS.textSoft,marginBottom:2}}>{line}</div>;
  });
};
const toggleMemoCheck=(memo,idx)=>{const lines=memo.split("\n");const m=lines[idx]?.match(/^- \[(x| )\] (.*)$/);if(m)lines[idx]=`- [${m[1]==="x"?" ":"x"}] ${m[2]}`;return lines.join("\n");};

const G=`
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Space+Grotesk:wght@600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;color:#e2e8f0;font-family:'Noto Sans JP',sans-serif}
  ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#0f1117}::-webkit-scrollbar-thumb{background:#2a2d3e;border-radius:3px}
  input,textarea,select{font-family:'Noto Sans JP',sans-serif;outline:none;border:none}
  button{cursor:pointer;font-family:'Noto Sans JP',sans-serif;border:none;outline:none}
  .tr:hover .ta{opacity:1!important}.nb:hover{background:#21253a!important}.ba:hover{filter:brightness(1.1);box-shadow:0 0 16px rgba(108,99,255,0.4)}
  .mo{animation:fi .15s ease}.mc{animation:su .2s ease}
  .task-chip:hover{filter:brightness(1.15);}
  .chip-drag{cursor:grab;} .chip-drag:active{cursor:grabbing;opacity:0.5;}
  @keyframes fi{from{opacity:0}to{opacity:1}}@keyframes su{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
`;

const Checkbox=({checked,onChange,size=18})=>(<div onClick={e=>{e.stopPropagation();onChange();}} style={{width:size,height:size,borderRadius:5,border:`2px solid ${checked?COLORS.accent:COLORS.border}`,background:checked?COLORS.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all .15s"}}>{checked&&<span style={{color:"#fff",fontSize:size*.6,fontWeight:700}}>✓</span>}</div>);
const Btn=({children,onClick,variant="ghost",style={},disabled})=>{const v={ghost:{background:"transparent",color:COLORS.textSoft,border:`1px solid ${COLORS.border}`},accent:{background:COLORS.accent,color:"#fff",border:"none"},danger:{background:COLORS.danger+"22",color:COLORS.danger,border:`1px solid ${COLORS.danger}44`}};return <button className={variant==="accent"?"ba":""} onClick={onClick} disabled={disabled} style={{padding:"6px 14px",borderRadius:8,fontSize:13,fontWeight:600,transition:"all .15s",opacity:disabled?.5:1,...v[variant],...style}}>{children}</button>;};
const Modal=({title,children,onClose,wide})=>(<div className="mo" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}><div className="mc" onClick={e=>e.stopPropagation()} style={{background:COLORS.surface,borderRadius:16,width:"100%",maxWidth:wide?720:520,border:`1px solid ${COLORS.border}`,maxHeight:"90vh",overflow:"auto"}}><div style={{padding:"18px 24px",borderBottom:`1px solid ${COLORS.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontWeight:700,fontSize:16}}>{title}</span><button onClick={onClose} style={{background:"none",color:COLORS.textMuted,fontSize:20}}>✕</button></div><div style={{padding:"20px 24px"}}>{children}</div></div></div>);
const Inp=({label,value,onChange,type="text",placeholder=""})=>(<div style={{marginBottom:14}}>{label&&<div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>{label}</div>}<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14}}/></div>);
const Sel=({label,value,onChange,options})=>(<div style={{marginBottom:14}}>{label&&<div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>{label}</div>}<select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14}}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></div>);

const LoginScreen=({onLogin,loading})=>(<div style={{minHeight:"100vh",background:COLORS.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center",padding:40}}><div style={{fontSize:56,marginBottom:16}}>✅</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:28,marginBottom:8}}><span style={{color:COLORS.accent}}>◈</span> マイタスク</div><div style={{color:COLORS.textMuted,marginBottom:32,fontSize:14}}>あなただけのタスク管理アプリ</div><button onClick={onLogin} disabled={loading} style={{display:"flex",alignItems:"center",gap:12,background:"#fff",color:"#333",border:"none",borderRadius:12,padding:"14px 28px",fontSize:15,fontWeight:600,cursor:"pointer",margin:"0 auto",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",opacity:loading?0.7:1}}><svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>{loading?"ログイン中...":"Googleでログイン"}</button></div></div>);

const TaskPopup=({task,tags,onClose,onEdit,onToggle,onDelete,onMemoToggle,anchor})=>{
  const allTags=flattenTasks([task]);
  const tTags=tags.filter(t=>task.tags?.includes(t.id));
  const today=new Date().toISOString().slice(0,10);
  const isOverdue=task.deadlineDate&&!task.done&&task.deadlineDate<today;
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:500}}>
      <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:anchor?.y||100,left:anchor?.x||100,background:COLORS.surface,borderRadius:14,padding:16,border:`1px solid ${COLORS.border}`,width:290,boxShadow:"0 8px 32px rgba(0,0,0,0.5)",zIndex:501}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
          <Checkbox checked={task.done} onChange={()=>{onToggle(task.id);onClose();}} size={20}/>
          <div style={{flex:1}}>
            {task._parentTitle&&<div style={{fontSize:10,color:COLORS.textMuted,marginBottom:2}}>📁 {task._parentTitle}</div>}
            <div style={{fontSize:14,fontWeight:700,textDecoration:task.done?"line-through":"none",color:task.done?COLORS.textMuted:COLORS.text}}>{task.title}</div>
            {tTags.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>{tTags.map(t=><span key={t.id} style={{fontSize:10,color:t.color,background:t.color+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>{t.name}</span>)}</div>}
          </div>
        </div>
        <div style={{fontSize:12,color:COLORS.textMuted,display:"flex",flexDirection:"column",gap:3,marginBottom:10}}>
          {task.startDate&&<div>▶ 開始: {formatDateTime(task.startDate,task.startTime)}</div>}
          {task.endDate&&<div>⏹ 終了: {formatDateTime(task.endDate,task.endTime)}</div>}
          {task.duration&&<div style={{color:COLORS.accent}}>⏱ {task.duration}分</div>}
          {task.deadlineDate&&<div style={{color:isOverdue?COLORS.danger:COLORS.warning}}>⚠ 締切: {formatDateTime(task.deadlineDate,task.deadlineTime)}</div>}
          {task.repeat!=="なし"&&<div style={{color:COLORS.success}}>↻ {task.repeat}</div>}
        </div>
        {task.memo&&<div style={{background:COLORS.bg,borderRadius:8,padding:"8px 10px",marginBottom:10}}>{parseMemo(task.memo,idx=>onMemoToggle(task.id,idx))}</div>}
        <div style={{display:"flex",gap:8}}>
          <Btn variant="accent" onClick={()=>{onEdit(task);onClose();}} style={{flex:1,textAlign:"center"}}>編集</Btn>
          <Btn variant="danger" onClick={()=>{onDelete(task.id);onClose();}}>削除</Btn>
        </div>
      </div>
    </div>
  );
};

const LaterPanel=({tasks,tags,dragTask,setDragTask})=>{
  const laterTasks=flattenTasks(tasks).filter(t=>t.isLater||isAutoLater(t));
  return (
    <div style={{width:196,flexShrink:0,background:COLORS.surface,borderLeft:`1px solid ${COLORS.border}`,padding:12,overflowY:"auto"}}>
      <div style={{fontSize:11,fontWeight:700,color:COLORS.warning,marginBottom:4,textTransform:"uppercase",letterSpacing:1}}>📌 あとでやる</div>
      <div style={{fontSize:10,color:COLORS.textMuted,marginBottom:8}}>ドラッグして日時設定</div>
      {laterTasks.length===0&&<div style={{fontSize:12,color:COLORS.textMuted,textAlign:"center",padding:"16px 0"}}>なし</div>}
      {laterTasks.map(t=>{
        const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||COLORS.accent;
        const isDragging=dragTask?.id===t.id;
        return (
          <div key={t.id} draggable className="chip-drag" onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDragTask(t);}} onDragEnd={()=>setDragTask(null)}
            style={{background:isDragging?COLORS.accentSoft:COLORS.bg,borderLeft:`3px solid ${c}`,borderRadius:"0 8px 8px 0",padding:"7px 9px",marginBottom:7,opacity:isDragging?0.5:1,transition:"all .15s"}}>
            <div style={{fontSize:12,fontWeight:600,color:COLORS.text,marginBottom:2}}>{t.title}</div>
            {t.duration&&<div style={{fontSize:10,color:COLORS.accent}}>⏱ {t.duration}分</div>}
            {t.deadlineDate&&<div style={{fontSize:10,color:COLORS.warning}}>⚠ {formatDate(t.deadlineDate)}</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:3}}>{tags.filter(tg=>t.tags?.includes(tg.id)).map(tg=><span key={tg.id} style={{fontSize:9,color:tg.color,background:tg.color+"22",padding:"1px 5px",borderRadius:10}}>{tg.name}</span>)}</div>
          </div>
        );
      })}
    </div>
  );
};

const TaskForm=({task,tags,onSave,onClose,isChild,defaultDate,defaultTime})=>{
  const empty={id:"task_"+Date.now(),title:"",done:false,tags:[],memo:"",startDate:defaultDate||"",startTime:defaultTime||"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",duration:"",children:[],isLater:false};
  const [f,setF]=useState(task?{duration:"",...task}:empty);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));

  // 小タグ選択時に親タグ自動連動
  const tog=tid=>{
    const tag=tags.find(t=>t.id===tid);
    let newTags=[...f.tags];
    if(newTags.includes(tid)){
      newTags=newTags.filter(x=>x!==tid);
    } else {
      newTags=[...newTags,tid];
      if(tag?.parentId&&!newTags.includes(tag.parentId))newTags=[...newTags,tag.parentId];
    }
    upd("tags",newTags);
  };

  // 所要時間の自動計算・反映
  const handleStartTime=v=>{
    upd("startTime",v);
    if(f.duration&&v){upd("endTime",applyDuration(v,Number(f.duration)));}
    else if(f.endTime&&v){const d=calcDuration(v,f.endTime);if(d)upd("duration",String(d));}
  };
  const handleEndTime=v=>{
    upd("endTime",v);
    if(f.startTime&&v){const d=calcDuration(f.startTime,v);if(d)upd("duration",String(d));}
  };
  const handleDuration=v=>{
    upd("duration",v);
    if(f.startTime&&v){upd("endTime",applyDuration(f.startTime,Number(v)));}
  };

  const parentTags=tags.filter(t=>!t.parentId&&!t.archived);
  const childTags=pid=>tags.filter(t=>t.parentId===pid&&!t.archived);
  return (
    <Modal title={task?"タスクを編集":isChild?"子タスクを追加":"タスクを追加"} onClose={onClose} wide>
      <Inp label="タスク名 *" value={f.title} onChange={v=>upd("title",v)} placeholder="タスク名..."/>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:6,fontWeight:600}}>タグ</div>
        {parentTags.map(pt=>(<div key={pt.id} style={{marginBottom:6}}><div onClick={()=>tog(pt.id)} style={{display:"inline-flex",padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:700,cursor:"pointer",border:`1px solid ${pt.color}44`,background:f.tags.includes(pt.id)?pt.color+"33":"transparent",color:f.tags.includes(pt.id)?pt.color:COLORS.textMuted,marginBottom:3}}>{pt.name}</div>{childTags(pt.id).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5,paddingLeft:14}}>{childTags(pt.id).map(ct=><div key={ct.id} onClick={()=>tog(ct.id)} style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",border:`1px solid ${ct.color}44`,background:f.tags.includes(ct.id)?ct.color+"33":"transparent",color:f.tags.includes(ct.id)?ct.color:COLORS.textMuted}}>└ {ct.name}</div>)}</div>}</div>))}
      </div>
      <div style={{background:COLORS.bg,borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:4}}>
          <Inp label="📅 開始日" value={f.startDate} onChange={v=>upd("startDate",v)} type="date"/>
          <Inp label="開始時刻" value={f.startTime} onChange={handleStartTime} type="time"/>
          <div style={{marginBottom:14}}><div style={{fontSize:12,color:COLORS.accent,marginBottom:5,fontWeight:600}}>⏱ 所要時間(分)</div><input type="number" min="0" value={f.duration} onChange={e=>handleDuration(e.target.value)} placeholder="例: 60" style={{width:"100%",background:COLORS.surface,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14}}/></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
          <Inp label="⏹ 終了日" value={f.endDate} onChange={v=>upd("endDate",v)} type="date"/>
          <Inp label="終了時刻" value={f.endTime} onChange={handleEndTime} type="time"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <Inp label="⚠️ 締切日" value={f.deadlineDate} onChange={v=>upd("deadlineDate",v)} type="date"/>
          <Inp label="締切時刻" value={f.deadlineTime} onChange={v=>upd("deadlineTime",v)} type="time"/>
        </div>
      </div>
      <div style={{fontSize:11,color:COLORS.textMuted,marginBottom:12,padding:"7px 10px",background:COLORS.accentSoft,borderRadius:8}}>💡 開始日未設定→「あとでやる」に自動追加 / ドラッグ時に所要時間で終了時刻自動設定</div>
      <Sel label="繰り返し" value={f.repeat} onChange={v=>upd("repeat",v)} options={REPEAT_OPTIONS}/>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>メモ <span style={{fontWeight:400,fontSize:11}}>（チェックボックス: <code style={{background:COLORS.bg,padding:"1px 4px",borderRadius:4}}>- [ ] テキスト</code>）</span></div>
        <textarea value={f.memo} onChange={e=>upd("memo",e.target.value)} placeholder={`メモ...\n- [ ] チェック項目1\n- [ ] チェック項目2`} rows={4} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:13,resize:"vertical",lineHeight:1.6}}/>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}><Btn onClick={onClose}>キャンセル</Btn><Btn variant="accent" onClick={()=>{if(f.title.trim()){onSave({...f,isLater:isAutoLater(f)});onClose();}}}>保存</Btn></div>
    </Modal>
  );
};

const TaskRow=({task,tags,depth=0,onEdit,onDelete,onToggle,onAddChild})=>{
  const [exp,setExp]=useState(true);
  const tTags=tags.filter(t=>task.tags?.includes(t.id)&&!t.parentId);// 親タグのみ表示
  const today=new Date().toISOString().slice(0,10);
  const isOverdue=task.deadlineDate&&!task.done&&task.deadlineDate<today;
  const isUrgent=task.deadlineDate&&!task.done&&task.deadlineDate===today;
  const isLater=task.isLater||isAutoLater(task);
  return (
    <div style={{marginLeft:depth*22}}>
      <div className="tr" style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:10,marginBottom:4,background:depth===0?COLORS.surface:"transparent",border:depth===0?`1px solid ${isOverdue?COLORS.danger+"66":COLORS.border}`:undefined,borderLeft:depth>0?`2px solid ${COLORS.border}`:undefined,paddingLeft:depth>0?14:12,opacity:task.done?.55:1}}>
        <div style={{paddingTop:2}}><Checkbox checked={task.done} onChange={()=>onToggle(task.id)}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {task.children?.length>0&&<span onClick={()=>setExp(!exp)} style={{cursor:"pointer",fontSize:10,color:COLORS.textMuted,transform:exp?"rotate(90deg)":"",transition:"transform .15s",display:"inline-block"}}>▶</span>}
            <span style={{fontSize:14,fontWeight:depth===0?600:400,textDecoration:task.done?"line-through":"none",color:task.done?COLORS.textMuted:COLORS.text}}>{task.title}</span>
            {task.repeat!=="なし"&&<span style={{fontSize:10,color:COLORS.success,background:COLORS.success+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>↻ {task.repeat}</span>}
            {isLater&&<span style={{fontSize:10,color:COLORS.warning,background:COLORS.warning+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>📌 あとで</span>}
            {isOverdue&&<span style={{fontSize:10,color:COLORS.danger,background:COLORS.danger+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>⚠ 期限超過</span>}
            {isUrgent&&<span style={{fontSize:10,color:COLORS.warning,background:COLORS.warning+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>🔥 今日締切</span>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4,alignItems:"center"}}>
            {tTags.map(t=><span key={t.id} style={{fontSize:10,color:t.color,background:t.color+"22",padding:"1px 6px",borderRadius:10,fontWeight:600,border:`1px solid ${t.color}44`}}>{t.name}</span>)}
            {task.startDate&&<span style={{fontSize:11,color:COLORS.textMuted}}>▶ {formatDateTime(task.startDate,task.startTime)}</span>}
            {task.duration&&<span style={{fontSize:11,color:COLORS.accent}}>⏱{task.duration}分</span>}
            {task.deadlineDate&&<span style={{fontSize:11,color:isOverdue?COLORS.danger:COLORS.warning,fontWeight:600}}>⚠ {formatDateTime(task.deadlineDate,task.deadlineTime)}</span>}
            {task.memo&&<span style={{fontSize:11,color:COLORS.textMuted,fontStyle:"italic"}}>{task.memo.replace(/- \[[ x]\] /g,"").slice(0,28)}...</span>}
          </div>
        </div>
        <div className="ta" style={{display:"flex",gap:4,opacity:0,transition:"opacity .15s",flexShrink:0}}>
          <button onClick={()=>onAddChild(task.id)} style={{background:COLORS.accentSoft,color:COLORS.accent,border:"none",borderRadius:6,width:28,height:28,fontSize:16}}>+</button>
          <button onClick={()=>onEdit(task)} style={{background:COLORS.surfaceHover,color:COLORS.textSoft,border:"none",borderRadius:6,width:28,height:28,fontSize:12}}>✎</button>
          <button onClick={()=>onDelete(task.id)} style={{background:COLORS.danger+"22",color:COLORS.danger,border:"none",borderRadius:6,width:28,height:28,fontSize:12}}>✕</button>
        </div>
      </div>
      {exp&&task.children?.map(c=><TaskRow key={c.id} task={c} tags={tags} depth={depth+1} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild}/>)}
    </div>
  );
};

const ListView=({tasks,tags,filters,onEdit,onDelete,onToggle,onAddChild})=>{
  const filtered=useMemo(()=>{let list=tasks;if(filters.tag)list=list.filter(t=>t.tags?.includes(filters.tag));if(filters.search)list=list.filter(t=>t.title.toLowerCase().includes(filters.search.toLowerCase()));if(filters.hideCompleted)list=list.filter(t=>!t.done);return list;},[tasks,filters]);
  const later=filtered.filter(t=>t.isLater||isAutoLater(t));
  const habits=filtered.filter(t=>!(t.isLater||isAutoLater(t))&&t.repeat!=="なし");
  const regular=filtered.filter(t=>!(t.isLater||isAutoLater(t))&&t.repeat==="なし");
  const Sec=({title,items,accent})=>items.length===0?null:(<div style={{marginBottom:24}}><div style={{fontSize:12,fontWeight:700,color:accent,textTransform:"uppercase",letterSpacing:1,marginBottom:10,display:"flex",alignItems:"center",gap:8}}><div style={{width:20,height:2,background:accent}}></div>{title} ({items.length})</div>{items.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild}/>)}</div>);
  return (<div><Sec title="習慣・繰り返し" items={habits} accent={COLORS.success}/><Sec title="タスク" items={regular} accent={COLORS.accent}/><Sec title="あとでやる" items={later} accent={COLORS.warning}/>{filtered.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:COLORS.textMuted}}><div style={{fontSize:48,marginBottom:12}}>🎉</div><div>タスクがありません</div></div>}</div>);
};

// タスクチップ（ビュー上のタスク表示、ドラッグ対応）
const TaskChip=({task,tags,color,onPopup,onToggle,onUpdateTask,compact,allTasks})=>{
  const isOverdue=task.deadlineDate&&!task.done&&task.deadlineDate<new Date().toISOString().slice(0,10);
  const parentTitle=task._parentTitle;
  return (
    <div className="task-chip chip-drag"
      draggable
      onDragStart={e=>{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("taskId",task.id);e.stopPropagation();}}
      onClick={e=>{e.stopPropagation();onPopup(e,task);}}
      style={{background:task.done?COLORS.border+"44":color+"33",borderLeft:`3px solid ${task.done?COLORS.textMuted:color}`,borderRadius:"0 6px 6px 0",padding:compact?"2px 6px":"5px 8px",marginBottom:2,transition:"all .15s",opacity:task.done?.6:1,userSelect:"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <div onClick={e=>{e.stopPropagation();onToggle(task.id);}} style={{width:10,height:10,borderRadius:3,border:`2px solid ${task.done?COLORS.textMuted:color}`,background:task.done?color:"transparent",flexShrink:0,cursor:"pointer"}}/>
        <span style={{fontSize:compact?10:12,fontWeight:600,color:task.done?COLORS.textMuted:color,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration:task.done?"line-through":"none"}}>{task.startTime&&!compact?`${task.startTime} `:""}{task.title}</span>
        {isOverdue&&!compact&&<span style={{fontSize:9,color:COLORS.danger}}>⚠</span>}
      </div>
      {parentTitle&&!compact&&<div style={{fontSize:9,color:COLORS.textMuted,paddingLeft:14}}>📁{parentTitle}</div>}
      {task.duration&&!compact&&<div style={{fontSize:9,color:COLORS.accent,paddingLeft:14}}>⏱{task.duration}分</div>}
    </div>
  );
};

const DayView=({tasks,tags,today,onUpdateTask,onAddTask,onToggle,onEdit,onDelete,dragTask,setDragTask})=>{
  const [dropHour,setDropHour]=useState(null);
  const [popup,setPopup]=useState(null);
  const allFlat=flattenTasks(tasks);
  const todayTasks=allFlat.filter(t=>{
    if(t.repeat==="毎日")return true;
    if(t.repeat==="平日のみ"){const d=new Date(today).getDay();return d>=1&&d<=5;}
    return isSameDay(t.startDate,today)||isSameDay(t.deadlineDate,today);
  });
  const timed=todayTasks.filter(t=>t.startTime&&!(t.isLater||isAutoLater(t)));
  const untimed=todayTasks.filter(t=>!t.startTime&&!(t.isLater||isAutoLater(t)));
  const handlePopup=(e,task)=>{const r=e.currentTarget.getBoundingClientRect();setPopup({task,x:Math.min(r.right+8,window.innerWidth-300),y:Math.min(r.top,window.innerHeight-320)});};
  const handleDrop=(e,h)=>{
    e.preventDefault();setDropHour(null);
    const tid=e.dataTransfer.getData("taskId");
    const t=tid?allFlat.find(x=>x.id===tid):dragTask;
    if(!t)return;
    const st=`${String(h).padStart(2,"0")}:00`;
    const et=t.duration?applyDuration(st,Number(t.duration)):"";
    onUpdateTask({...t,startDate:today,startTime:st,endTime:et||t.endTime,isLater:false});
    setDragTask(null);
  };
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr",gap:16}}>
      <div>
        {HOURS.slice(6,23).map((hour,i)=>{
          const h=6+i;
          const ht=timed.filter(t=>t.startTime?.slice(0,2)===String(h).padStart(2,"0"));
          const isDrop=dropHour===h;
          return (
            <div key={hour} onDragOver={e=>{e.preventDefault();setDropHour(h);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDropHour(null);}} onDrop={e=>handleDrop(e,h)}
              style={{display:"grid",gridTemplateColumns:"46px 1fr",minHeight:52,borderTop:`1px solid ${COLORS.border}`,background:isDrop?"rgba(108,99,255,0.1)":"transparent",transition:"background .15s"}}>
              <div style={{fontSize:11,color:isDrop?COLORS.accent:COLORS.textMuted,paddingTop:3,paddingRight:6,textAlign:"right",fontWeight:isDrop?700:400}}>{hour}</div>
              <div style={{padding:"2px 0 2px 6px",position:"relative"}}>
                {isDrop?<div style={{position:"absolute",inset:"2px 4px",border:`2px dashed ${COLORS.accent}`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:COLORS.accent,pointerEvents:"none",background:COLORS.accentSoft}}>{(dragTask||{title:"タスク"}).title} → {hour}</div>:
                ht.length>0?ht.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||COLORS.accent;return <TaskChip key={t.id} task={t} tags={tags} color={c} onPopup={handlePopup} onToggle={onToggle} onUpdateTask={onUpdateTask} allTasks={allFlat}/>;}):<div onClick={()=>onAddTask(today,h)} style={{height:44,cursor:"pointer",borderRadius:6,display:"flex",alignItems:"center",paddingLeft:6,fontSize:11,color:"transparent",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(108,99,255,0.07)";e.currentTarget.style.color=COLORS.textMuted;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="transparent";}}>+ 追加</div>}
              </div>
            </div>
          );
        })}
        {untimed.length>0&&<div style={{marginTop:12}}><div style={{fontSize:11,fontWeight:700,color:COLORS.textMuted,marginBottom:6}}>時間未定</div>{untimed.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||COLORS.accent;return <TaskChip key={t.id} task={t} tags={tags} color={c} onPopup={handlePopup} onToggle={onToggle} onUpdateTask={onUpdateTask} allTasks={allFlat}/>;})}</div>}
      </div>
      {popup&&<TaskPopup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onMemoToggle={(id,idx)=>{const t=allFlat.find(x=>x.id===id);if(t)onUpdateTask({...t,memo:toggleMemoCheck(t.memo,idx)});setPopup(null);}}/>}
    </div>
  );
};

const WeekView=({tasks,tags,today,onUpdateTask,onAddTask,onToggle,onEdit,onDelete,dragTask,setDragTask})=>{
  const weekDates=getWeekDates(today);
  const [dropCell,setDropCell]=useState(null);
  const [popup,setPopup]=useState(null);
  const allFlat=flattenTasks(tasks);
  const getDay=date=>allFlat.filter(t=>{
    if(t.repeat==="毎日")return true;
    if(t.repeat==="平日のみ"){const d=new Date(date).getDay();return d>=1&&d<=5;}
    if(t.repeat==="毎週"&&t.startDate)return new Date(t.startDate).getDay()===new Date(date).getDay();
    return isSameDay(t.startDate,date)||isSameDay(t.deadlineDate,date);
  }).filter(t=>!(t.isLater||isAutoLater(t)));
  const cellKey=(d,h)=>`${d}_${h}`;
  const handlePopup=(e,task)=>{const r=e.currentTarget.getBoundingClientRect();setPopup({task,x:Math.min(r.right+8,window.innerWidth-300),y:Math.min(r.top,window.innerHeight-320)});};
  const handleDrop=(e,d,h)=>{
    e.preventDefault();setDropCell(null);
    const tid=e.dataTransfer.getData("taskId");
    const t=tid?allFlat.find(x=>x.id===tid):dragTask;
    if(!t)return;
    const st=`${String(h).padStart(2,"0")}:00`;
    const et=t.duration?applyDuration(st,Number(t.duration)):"";
    onUpdateTask({...t,startDate:d,startTime:st,endTime:et||t.endTime,isLater:false});
    setDragTask(null);
  };
  return (
    <div style={{overflowX:"auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"46px repeat(7,1fr)",minWidth:640}}>
        <div></div>
        {weekDates.map((d,i)=>{const isT=d===today,dt=new Date(d);return(<div key={d} style={{padding:"6px 2px",textAlign:"center",borderBottom:`2px solid ${isT?COLORS.accent:COLORS.border}`,color:isT?COLORS.accent:COLORS.textSoft}}><div style={{fontSize:10,fontWeight:700}}>{DAYS_JP[i]}</div><div style={{fontSize:16,fontWeight:isT?700:400}}>{dt.getDate()}</div></div>);})}
        {HOURS.slice(6,23).map((hour,i)=>{
          const h=6+i;
          return [
            <div key={hour+"l"} style={{fontSize:10,color:COLORS.textMuted,paddingRight:4,textAlign:"right",paddingTop:3,borderTop:`1px solid ${COLORS.border}22`,height:48,display:"flex",alignItems:"flex-start",justifyContent:"flex-end"}}>{hour}</div>,
            ...weekDates.map(d=>{
              const dts=getDay(d).filter(t=>t.startTime?.slice(0,2)===String(h).padStart(2,"0"));
              const key=cellKey(d,h);const isDrop=dropCell===key;
              return (
                <div key={d+hour} onDragOver={e=>{e.preventDefault();setDropCell(key);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDropCell(null);}} onDrop={e=>handleDrop(e,d,h)}
                  style={{borderTop:`1px solid ${COLORS.border}22`,height:48,padding:1,background:isDrop?"rgba(108,99,255,0.15)":"transparent",transition:"background .15s",cursor:"pointer"}} onClick={()=>{if(!dragTask)onAddTask(d,h);}}>
                  {isDrop?<div style={{height:"100%",border:`2px dashed ${COLORS.accent}`,borderRadius:5,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:COLORS.accent}}>{hour}</div>:dts.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||COLORS.accent;return <TaskChip key={t.id} task={t} tags={tags} color={c} onPopup={handlePopup} onToggle={onToggle} onUpdateTask={onUpdateTask} compact allTasks={allFlat}/>;})}</div>
              );
            })
          ];
        })}
      </div>
      {popup&&<TaskPopup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onMemoToggle={(id,idx)=>{const t=allFlat.find(x=>x.id===id);if(t)onUpdateTask({...t,memo:toggleMemoCheck(t.memo,idx)});setPopup(null);}}/>}
    </div>
  );
};

const MonthView=({tasks,tags,today,onUpdateTask,onAddTask,onToggle,onEdit,onDelete,dragTask,setDragTask})=>{
  const [vy,setVy]=useState(new Date(today).getFullYear());
  const [vm,setVm]=useState(new Date(today).getMonth());
  const [dropDay,setDropDay]=useState(null);
  const [popup,setPopup]=useState(null);
  const dim=getDaysInMonth(vy,vm);
  const allFlat=flattenTasks(tasks);
  const allTasks=allFlat.filter(t=>(t.startDate||t.deadlineDate)&&!(t.isLater||isAutoLater(t)));
  const getBar=task=>{const s=task.startDate?new Date(task.startDate):task.deadlineDate?new Date(task.deadlineDate):null;const e=task.deadlineDate?new Date(task.deadlineDate):s;if(!s)return null;const ms=new Date(vy,vm,1),me=new Date(vy,vm,dim);if(e<ms||s>me)return null;const cs=s<ms?ms:s,ce=e>me?me:e;return{startDay:cs.getDate(),width:ce.getDate()-cs.getDate()+1};};
  const MN=["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const dateStr=d=>`${vy}-${String(vm+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const handlePopup=(e,task)=>{const r=e.currentTarget.getBoundingClientRect();setPopup({task,x:Math.min(r.right+8,window.innerWidth-300),y:Math.min(r.top,window.innerHeight-320)});};
  const handleDrop=(e,d)=>{
    e.preventDefault();setDropDay(null);
    const tid=e.dataTransfer.getData("taskId");
    const t=tid?allFlat.find(x=>x.id===tid):dragTask;
    if(!t)return;
    onUpdateTask({...t,startDate:dateStr(d),isLater:false});
    setDragTask(null);
  };
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}><Btn onClick={()=>{if(vm===0){setVy(y=>y-1);setVm(11);}else setVm(m=>m-1);}}>‹</Btn><span style={{fontWeight:700,fontSize:15}}>{vy}年 {MN[vm]}</span><Btn onClick={()=>{if(vm===11){setVy(y=>y+1);setVm(0);}else setVm(m=>m+1);}}>›</Btn></div>
      <div style={{overflowX:"auto"}}>
        <div style={{minWidth:dim*30+180}}>
          <div style={{display:"flex",borderBottom:`1px solid ${COLORS.border}`,paddingBottom:4,marginBottom:4}}>
            <div style={{width:180,flexShrink:0}}></div>
            {Array.from({length:dim},(_,i)=>{const d=i+1,isT=dateStr(d)===today,isDrop=dropDay===d;return <div key={d} onDragOver={e=>{e.preventDefault();setDropDay(d);}} onDragLeave={()=>setDropDay(null)} onDrop={e=>handleDrop(e,d)} onClick={()=>{if(!dragTask)onAddTask(dateStr(d),null);}} style={{width:30,flexShrink:0,textAlign:"center",fontSize:10,fontWeight:isT?700:400,color:isDrop?COLORS.accent:isT?COLORS.accent:COLORS.textMuted,background:isDrop?"rgba(108,99,255,0.2)":"transparent",borderRadius:4,cursor:"pointer",padding:"2px 0"}}>{d}</div>;})}
          </div>
          {allTasks.map(task=>{
            const bar=getBar(task),c=tags.find(t=>task.tags?.includes(t.id))?.color||COLORS.accent;
            return <div key={task.id} style={{display:"flex",alignItems:"center",marginBottom:5,height:26}}>
              <div style={{width:180,flexShrink:0,fontSize:12,paddingRight:8,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",color:COLORS.textSoft}}>{task._parentTitle&&<span style={{fontSize:10,color:COLORS.textMuted}}>📁</span>}{task.title}</div>
              <div style={{position:"relative",height:"100%",flex:1}}>
                {bar&&<div draggable onDragStart={e=>{e.dataTransfer.setData("taskId",task.id);e.dataTransfer.effectAllowed="move";}} onClick={e=>handlePopup(e,task)} style={{position:"absolute",left:(bar.startDay-1)*30,width:bar.width*30-4,height:20,top:3,background:task.done?COLORS.border+"44":c+"33",border:`1px solid ${task.done?COLORS.textMuted:c}55`,borderRadius:5,display:"flex",alignItems:"center",paddingLeft:6,fontSize:10,color:task.done?COLORS.textMuted:c,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap",cursor:"grab",textDecoration:task.done?"line-through":"none"}} className="task-chip">{bar.width>2?task.title.slice(0,14):""}</div>}
              </div>
            </div>;
          })}
        </div>
      </div>
      {popup&&<TaskPopup task={popup.task} tags={tags} anchor={popup} onClose={()=>setPopup(null)} onEdit={onEdit} onToggle={id=>{onToggle(id);setPopup(null);}} onDelete={onDelete} onMemoToggle={(id,idx)=>{const t=allFlat.find(x=>x.id===id);if(t)onUpdateTask({...t,memo:toggleMemoCheck(t.memo,idx)});setPopup(null);}}/>}
    </div>
  );
};

const TemplatesView=({templates,setTemplates,onUse})=>{
  const [show,setShow]=useState(false);
  const [form,setForm]=useState({name:"",tasks:[""]});
  const save=()=>{if(!form.name.trim())return;setTemplates(t=>[...t,{id:"tpl_"+Date.now(),name:form.name,tasks:form.tasks.filter(Boolean)}]);setForm({name:"",tasks:[""]});setShow(false);};
  return (<div><div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}><Btn variant="accent" onClick={()=>setShow(true)}>+ テンプレートを作成</Btn></div>{templates.length===0&&<div style={{textAlign:"center",padding:40,color:COLORS.textMuted}}>テンプレートがまだありません</div>}<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>{templates.map(tpl=>(<div key={tpl.id} style={{background:COLORS.surface,borderRadius:14,padding:18,border:`1px solid ${COLORS.border}`}}><div style={{fontWeight:700,fontSize:15,marginBottom:10}}>{tpl.name}</div><div style={{marginBottom:12}}>{tpl.tasks.map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:`1px solid ${COLORS.border}22`,fontSize:13,color:COLORS.textSoft}}><div style={{width:6,height:6,borderRadius:"50%",background:COLORS.accent,flexShrink:0}}></div>{t}</div>)}</div><div style={{display:"flex",gap:8}}><Btn variant="accent" onClick={()=>onUse(tpl)} style={{flex:1,textAlign:"center"}}>使う</Btn><Btn variant="danger" onClick={()=>setTemplates(t=>t.filter(x=>x.id!==tpl.id))}>削除</Btn></div></div>))}</div>{show&&(<Modal title="テンプレートを作成" onClose={()=>setShow(false)}><Inp label="テンプレート名" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="例: 週次レビュー"/><div style={{marginBottom:14}}><div style={{fontSize:12,color:COLORS.textMuted,marginBottom:8,fontWeight:600}}>タスク一覧</div>{form.tasks.map((t,i)=>(<div key={i} style={{display:"flex",gap:8,marginBottom:6}}><input value={t} onChange={e=>{const ts=[...form.tasks];ts[i]=e.target.value;setForm(f=>({...f,tasks:ts}));}} placeholder={`タスク ${i+1}`} style={{flex:1,background:COLORS.bg,color:COLORS.text,padding:"8px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:13}}/><button onClick={()=>setForm(f=>({...f,tasks:f.tasks.filter((_,idx)=>idx!==i)}))} style={{background:COLORS.danger+"22",color:COLORS.danger,border:"none",borderRadius:6,width:32}}>✕</button></div>))}<Btn onClick={()=>setForm(f=>({...f,tasks:[...f.tasks,""]}))}>+ 追加</Btn></div><div style={{display:"flex",gap:10,justifyContent:"flex-end"}}><Btn onClick={()=>setShow(false)}>キャンセル</Btn><Btn variant="accent" onClick={save}>保存</Btn></div></Modal>)}</div>);
};

const TagsView=({tags,setTags})=>{
  const [form,setForm]=useState({name:"",color:"#6c63ff",parentId:null});
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState(null);
  const [showArchived,setShowArchived]=useState(false);
  const add=()=>{if(!form.name.trim())return;setTags(t=>[...t,{id:"tag_"+Date.now(),name:form.name,color:form.color,parentId:form.parentId||null,archived:false}]);setForm({name:"",color:"#6c63ff",parentId:null});};
  const archive=id=>setTags(ts=>ts.map(t=>t.id===id?{...t,archived:true}:t));
  const restore=id=>setTags(ts=>ts.map(t=>t.id===id?{...t,archived:false}:t));
  const startEdit=t=>{setEditId(t.id);setEditForm({name:t.name,color:t.color});};
  const saveEdit=id=>{setTags(ts=>ts.map(t=>t.id===id?{...t,...editForm}:t));setEditId(null);setEditForm(null);};
  const parentTags=tags.filter(t=>!t.parentId&&!t.archived);
  const childTags=pid=>tags.filter(t=>t.parentId===pid&&!t.archived);
  const archivedTags=tags.filter(t=>t.archived);
  // 親タグ選択時に色を親タグと同じにする
  const handleParentChange=pid=>{
    const parent=tags.find(t=>t.id===pid);
    setForm(f=>({...f,parentId:pid||null,color:parent?parent.color:f.color}));
  };
  const EditRow=({t})=>editId===t.id&&editForm?(<div style={{background:COLORS.bg,borderRadius:10,padding:10,marginTop:6,display:"flex",gap:10,alignItems:"flex-end"}}><div style={{flex:1}}><Inp label="タグ名" value={editForm.name} onChange={v=>setEditForm(f=>({...f,name:v}))}/></div><div style={{marginBottom:14}}><div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>色</div><input type="color" value={editForm.color} onChange={e=>setEditForm(f=>({...f,color:e.target.value}))} style={{width:44,height:38,borderRadius:8,border:`1px solid ${COLORS.border}`,background:"none",cursor:"pointer",padding:2}}/></div><div style={{marginBottom:14,display:"flex",gap:6}}><Btn variant="accent" onClick={()=>saveEdit(t.id)}>保存</Btn><Btn onClick={()=>setEditId(null)}>✕</Btn></div></div>):null;
  return (
    <div>
      <div style={{background:COLORS.surface,borderRadius:14,padding:18,border:`1px solid ${COLORS.border}`,marginBottom:16}}>
        <div style={{fontWeight:700,marginBottom:12}}>新しいタグを作成</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 70px",gap:10,marginBottom:10}}><Inp label="タグ名" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="タグ名..."/><div><div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>色</div><input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} style={{width:"100%",height:38,borderRadius:8,border:`1px solid ${COLORS.border}`,background:"none",cursor:"pointer",padding:2}}/></div></div>
        <div style={{marginBottom:10}}><div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>親タグ（小タグとして追加する場合）</div><select value={form.parentId||""} onChange={e=>handleParentChange(e.target.value||null)} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14}}><option value="">なし（親タグとして作成）</option>{parentTags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <Btn variant="accent" onClick={add}>追加</Btn>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {parentTags.map(pt=>(<div key={pt.id} style={{background:COLORS.surface,borderRadius:12,padding:14,border:`1px solid ${pt.color}44`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:12,height:12,borderRadius:"50%",background:pt.color}}></div><span style={{fontWeight:700,color:pt.color,fontSize:14}}>{pt.name}</span><span style={{fontSize:11,color:COLORS.textMuted}}>親タグ</span></div><div style={{display:"flex",gap:6}}><Btn onClick={()=>startEdit(pt)} style={{padding:"3px 10px",fontSize:11}}>編集</Btn><Btn variant="danger" onClick={()=>archive(pt.id)} style={{padding:"3px 10px",fontSize:11}}>アーカイブ</Btn></div></div><EditRow t={pt}/>{childTags(pt.id).length>0&&<div style={{paddingLeft:20,marginTop:10,display:"flex",flexDirection:"column",gap:5}}>{childTags(pt.id).map(ct=>(<div key={ct.id} style={{background:COLORS.bg,borderRadius:8,border:`1px solid ${ct.color}33`,padding:"5px 10px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:8,height:8,borderRadius:"50%",background:ct.color}}></div><span style={{fontSize:13,color:ct.color,fontWeight:600}}>{ct.name}</span><span style={{fontSize:10,color:COLORS.textMuted}}>小タグ</span></div><div style={{display:"flex",gap:6}}><Btn onClick={()=>startEdit(ct)} style={{padding:"2px 8px",fontSize:11}}>編集</Btn><Btn variant="danger" onClick={()=>archive(ct.id)} style={{padding:"2px 8px",fontSize:11}}>アーカイブ</Btn></div></div><EditRow t={ct}/></div>))}</div>}</div>))}
      </div>
      {archivedTags.length>0&&<div style={{marginTop:20}}><button onClick={()=>setShowArchived(!showArchived)} style={{background:"none",border:"none",color:COLORS.textMuted,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:6,marginBottom:10}}>{showArchived?"▼":"▶"} アーカイブ済み ({archivedTags.length})</button>{showArchived&&<div style={{display:"flex",flexDirection:"column",gap:7}}>{archivedTags.map(t=>(<div key={t.id} style={{background:COLORS.surface,borderRadius:10,padding:"9px 14px",border:`1px solid ${COLORS.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",opacity:.6}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:10,height:10,borderRadius:"50%",background:t.color}}></div><span style={{fontSize:13,color:COLORS.textSoft}}>{t.name}</span><span style={{fontSize:10,color:COLORS.textMuted}}>{t.parentId?"小タグ":"親タグ"}</span></div><div style={{display:"flex",gap:6}}><Btn onClick={()=>restore(t.id)} style={{padding:"3px 10px",fontSize:11}}>復元</Btn><Btn variant="danger" onClick={()=>setTags(ts=>ts.filter(x=>x.id!==t.id))} style={{padding:"3px 10px",fontSize:11}}>完全削除</Btn></div></div>))}</div>}</div>}
    </div>
  );
};

export default function App(){
  const today=new Date().toISOString().slice(0,10);
  const [user,setUser]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const [loginLoading,setLoginLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [tasks,setTasks]=useState([]);
  const [tags,setTags]=useState(TAG_PRESETS);
  const [templates,setTemplates]=useState([]);
  const [view,setView]=useState("list");
  const [showForm,setShowForm]=useState(false);
  const [editTask,setEditTask]=useState(null);
  const [addChildTo,setAddChildTo]=useState(null);
  const [filters,setFilters]=useState({tag:"",search:"",hideCompleted:false});
  const [dragTask,setDragTask]=useState(null);
  const [defaultDate,setDefaultDate]=useState(null);
  const [defaultTime,setDefaultTime]=useState(null);

  useEffect(()=>{const unsub=onAuthStateChanged(auth,u=>{setUser(u);setAuthLoading(false);});return unsub;},[]);
  useEffect(()=>{if(!user)return;const unsub=onSnapshot(doc(db,"users",user.uid),snap=>{if(snap.exists()){const data=snap.data();if(data.tasks)setTasks(data.tasks);if(data.tags)setTags(data.tags);if(data.templates)setTemplates(data.templates);}});return unsub;},[user]);

  const save=async(t,tg,tp)=>{if(!user)return;setSaving(true);try{await setDoc(doc(db,"users",user.uid),{tasks:t,tags:tg,templates:tp,updatedAt:new Date().toISOString()});}catch(e){console.error(e);}setSaving(false);};
  const updT=t=>{setTasks(t);save(t,tags,templates);};
  const updTg=t=>{setTags(t);save(tasks,t,templates);};
  const updTp=t=>{setTemplates(t);save(tasks,tags,t);};
  const handleLogin=async()=>{setLoginLoading(true);try{const result=await signInWithPopup(auth,provider);if(!ALLOWED_UIDS.includes(result.user.uid)){await signOut(auth);alert("このアカウントはアクセスできません。");}}catch(e){console.error(e);}setLoginLoading(false);};
  const updTree=(ts,id,fn)=>ts.map(t=>t.id===id?fn(t):{...t,children:updTree(t.children||[],id,fn)});
  const delTree=(ts,id)=>ts.filter(t=>t.id!==id).map(t=>({...t,children:delTree(t.children||[],id)}));
  const addChild=(ts,pid,c)=>ts.map(t=>t.id===pid?{...t,children:[...(t.children||[]),c]}:{...t,children:addChild(t.children||[],pid,c)});
  const handleSave=f=>{const fw={...f,isLater:isAutoLater(f)};let nt;if(editTask)nt=updTree(tasks,f.id,()=>fw);else if(addChildTo)nt=addChild(tasks,addChildTo,fw);else nt=[...tasks,fw];updT(nt);setEditTask(null);setAddChildTo(null);};
  const handleUpdateTask=updated=>{const clean={...updated};delete clean._parentTitle;updT(updTree(tasks,clean.id,()=>clean));setDragTask(null);};
  const handleAddTask=(date,hour)=>{setDefaultDate(date);setDefaultTime(hour!=null?`${String(hour).padStart(2,"0")}:00`:null);setEditTask(null);setAddChildTo(null);setShowForm(true);};
  const handleToggle=id=>updT(updTree(tasks,id,t=>({...t,done:!t.done})));
  const handleDelete=id=>updT(delTree(tasks,id));
  const handleEdit=t=>{setEditTask(t);setShowForm(true);};

  const allFlat=flattenTasks(tasks);
  const done=allFlat.filter(t=>t.done).length;
  const total=allFlat.length;
  const pct=total>0?Math.round((done/total)*100):0;
  const NAV=[{id:"list",label:"リスト",icon:"☰"},{id:"day",label:"日",icon:"📆"},{id:"week",label:"週",icon:"📅"},{id:"month",label:"月(ガント)",icon:"📊"},{id:"templates",label:"テンプレート",icon:"📋"},{id:"tagmgr",label:"タグ管理",icon:"🏷"}];
  const parentTags=tags.filter(t=>!t.parentId&&!t.archived);
  const showLaterPanel=["day","week","month"].includes(view);

  if(authLoading)return<div style={{minHeight:"100vh",background:COLORS.bg,display:"flex",alignItems:"center",justifyContent:"center",color:COLORS.textMuted}}>読み込み中...</div>;
  if(!user)return<LoginScreen onLogin={handleLogin} loading={loginLoading}/>;

  return (
    <>
      <style>{G}</style>
      <div style={{minHeight:"100vh",background:COLORS.bg,display:"flex"}}>
        <div style={{width:210,flexShrink:0,background:COLORS.surface,borderRight:`1px solid ${COLORS.border}`,display:"flex",flexDirection:"column",padding:"20px 0",position:"fixed",top:0,left:0,height:"100vh",overflowY:"auto",zIndex:10}}>
          <div style={{padding:"0 16px 16px",borderBottom:`1px solid ${COLORS.border}`}}>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:16,letterSpacing:-.5}}><span style={{color:COLORS.accent}}>◈</span> マイタスク</div>
            <div style={{fontSize:11,color:COLORS.textMuted,marginTop:3}}>{user.email}</div>
            {saving&&<div style={{fontSize:10,color:COLORS.success,marginTop:3}}>💾 保存中...</div>}
            <div style={{marginTop:10}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:COLORS.textMuted,marginBottom:4}}><span>進捗</span><span style={{fontWeight:700,color:COLORS.accent}}>{pct}%</span></div>
              <div style={{background:COLORS.bg,borderRadius:10,height:5,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${COLORS.accent},${COLORS.success})`,borderRadius:10,transition:"width .4s"}}></div></div>
              <div style={{fontSize:10,color:COLORS.textMuted,marginTop:3}}>{done}/{total} 完了</div>
            </div>
          </div>
          <div style={{padding:"10px 8px",flex:1}}>{NAV.map(n=>(<button key={n.id} className="nb" onClick={()=>setView(n.id)} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"9px 10px",borderRadius:10,marginBottom:2,background:view===n.id?COLORS.accentSoft:"transparent",color:view===n.id?COLORS.accent:COLORS.textSoft,border:view===n.id?`1px solid ${COLORS.accent}33`:"1px solid transparent",fontSize:13,fontWeight:view===n.id?700:400,textAlign:"left"}}><span style={{fontSize:14}}>{n.icon}</span>{n.label}</button>))}</div>
          <div style={{padding:"10px 8px",borderTop:`1px solid ${COLORS.border}`}}>
            <input value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} placeholder="🔍 検索..." style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"6px 10px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:12,marginBottom:6}}/>
            <select value={filters.tag} onChange={e=>setFilters(f=>({...f,tag:e.target.value}))} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"6px 10px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:12,marginBottom:6}}>
              <option value="">すべてのタグ</option>
              {parentTags.map(pt=>(<optgroup key={pt.id} label={pt.name}><option value={pt.id}>{pt.name}（全体）</option>{tags.filter(t=>t.parentId===pt.id&&!t.archived).map(ct=><option key={ct.id} value={ct.id}>└ {ct.name}</option>)}</optgroup>))}
            </select>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}><Checkbox checked={filters.hideCompleted} onChange={()=>setFilters(f=>({...f,hideCompleted:!f.hideCompleted}))} size={15}/><span style={{fontSize:12,color:COLORS.textMuted}}>完了を隠す</span></div>
            <button onClick={()=>signOut(auth)} style={{width:"100%",background:"transparent",color:COLORS.textMuted,border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"6px",fontSize:12,cursor:"pointer"}}>ログアウト</button>
          </div>
        </div>
        <div style={{marginLeft:210,flex:1,display:"flex",minHeight:"100vh"}}>
          <div style={{flex:1,padding:"24px 28px",minWidth:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><h1 style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:20,letterSpacing:-.5}}>{NAV.find(n=>n.id===view)?.icon} {NAV.find(n=>n.id===view)?.label}</h1><div style={{fontSize:11,color:COLORS.textMuted,marginTop:1}}>{new Date(today).toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"})}</div></div>
              {["list","day","week","month"].includes(view)&&<Btn variant="accent" onClick={()=>{setDefaultDate(null);setDefaultTime(null);setEditTask(null);setAddChildTo(null);setShowForm(true);}}>+ 追加</Btn>}
            </div>
            {view==="list"&&<ListView tasks={tasks} tags={tags} filters={filters} onEdit={handleEdit} onDelete={handleDelete} onToggle={handleToggle} onAddChild={pid=>{setAddChildTo(pid);setShowForm(true);}}/>}
            {view==="day"&&<DayView tasks={tasks} tags={tags} today={today} onUpdateTask={handleUpdateTask} onAddTask={handleAddTask} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="week"&&<WeekView tasks={tasks} tags={tags} today={today} onUpdateTask={handleUpdateTask} onAddTask={handleAddTask} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="month"&&<MonthView tasks={tasks} tags={tags} today={today} onUpdateTask={handleUpdateTask} onAddTask={handleAddTask} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} dragTask={dragTask} setDragTask={setDragTask}/>}
            {view==="templates"&&<TemplatesView templates={templates} setTemplates={updTp} onUse={tpl=>{updT([...tasks,...tpl.tasks.map(title=>({id:"task_"+Date.now()+Math.random(),title,done:false,tags:[],memo:"",startDate:"",startTime:"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",duration:"",children:[],isLater:true}))]);setView("list");}}/>}
            {view==="tagmgr"&&<TagsView tags={tags} setTags={updTg}/>}
          </div>
          {showLaterPanel&&<LaterPanel tasks={tasks} tags={tags} dragTask={dragTask} setDragTask={setDragTask}/>}
        </div>
      </div>
      {showForm&&<TaskForm task={editTask} tags={tags} isChild={!!addChildTo} onSave={handleSave} defaultDate={defaultDate} defaultTime={defaultTime} onClose={()=>{setShowForm(false);setEditTask(null);setAddChildTo(null);setDefaultDate(null);setDefaultTime(null);}}/>}
    </>
  );
}
