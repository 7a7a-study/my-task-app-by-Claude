import { useState, useMemo, useEffect } from "react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore";

const COLORS = {
  bg:"#0f1117",surface:"#1a1d27",surfaceHover:"#21253a",border:"#2a2d3e",
  accent:"#6c63ff",accentSoft:"rgba(108,99,255,0.15)",
  success:"#22d3a5",warning:"#f59e0b",danger:"#f43f5e",
  text:"#e2e8f0",textMuted:"#64748b",textSoft:"#94a3b8",
};
const TAG_PRESETS = [
  {id:"t1",name:"仕事",color:"#6c63ff",parentId:null},
  {id:"t2",name:"個人",color:"#22d3a5",parentId:null},
  {id:"t3",name:"緊急",color:"#f43f5e",parentId:null},
  {id:"t4",name:"学習",color:"#f59e0b",parentId:null},
  {id:"t5",name:"健康",color:"#10b981",parentId:null},
];
const REPEAT_OPTIONS = ["なし","毎日","毎週","毎月","平日のみ"];
const DAYS_JP = ["月","火","水","木","金","土","日"];
const HOURS = Array.from({length:24},(_,i)=>`${String(i).padStart(2,"0")}:00`);
const ALLOWED_UIDS = ["w1HtaWxdSnMCV1miEm3yNF7g08J2","mszdWzOojoURpcIQdYdA3FRpQiG2"];

const flattenTasks=(tasks,result=[])=>{tasks.forEach(t=>{result.push(t);if(t.children?.length)flattenTasks(t.children,result);});return result;};
const getDaysInMonth=(y,m)=>new Date(y,m+1,0).getDate();
const formatDate=d=>{if(!d)return"";const dt=new Date(d);return `${dt.getMonth()+1}/${dt.getDate()}`;};
const formatDateTime=(d,t)=>{if(!d)return"";return t?`${formatDate(d)} ${t}`:formatDate(d);};
const isSameDay=(d1,d2)=>(!d1||!d2)?false:d1.slice(0,10)===d2.slice(0,10);
const getWeekDates=base=>{const d=new Date(base),day=d.getDay(),mon=new Date(d);mon.setDate(d.getDate()-day+1);return Array.from({length:7},(_,i)=>{const dt=new Date(mon);dt.setDate(mon.getDate()+i);return dt.toISOString().slice(0,10);});};
const isAutoLater=task=>!task.startDate&&!task.startTime;

const G=`
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Space+Grotesk:wght@600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f1117;color:#e2e8f0;font-family:'Noto Sans JP',sans-serif}
  ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#0f1117}::-webkit-scrollbar-thumb{background:#2a2d3e;border-radius:3px}
  input,textarea,select{font-family:'Noto Sans JP',sans-serif;outline:none;border:none}
  button{cursor:pointer;font-family:'Noto Sans JP',sans-serif;border:none;outline:none}
  .tr:hover .ta{opacity:1!important}.nb:hover{background:#21253a!important}.ba:hover{filter:brightness(1.1);box-shadow:0 0 16px rgba(108,99,255,0.4)}
  .mo{animation:fi .15s ease}.mc{animation:su .2s ease}
  @keyframes fi{from{opacity:0}to{opacity:1}}@keyframes su{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
`;

const TagChip=({tag,onRemove})=>(
  <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:20,background:tag.color+"22",color:tag.color,fontSize:11,fontWeight:600,border:`1px solid ${tag.color}44`}}>
    {tag.name}{onRemove&&<span onClick={onRemove} style={{cursor:"pointer",fontSize:10,opacity:.7}}>✕</span>}
  </span>
);
const Checkbox=({checked,onChange,size=18})=>(
  <div onClick={onChange} style={{width:size,height:size,borderRadius:5,border:`2px solid ${checked?COLORS.accent:COLORS.border}`,background:checked?COLORS.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all .15s"}}>
    {checked&&<span style={{color:"#fff",fontSize:size*.6,fontWeight:700}}>✓</span>}
  </div>
);
const Btn=({children,onClick,variant="ghost",style={},disabled})=>{
  const v={ghost:{background:"transparent",color:COLORS.textSoft,border:`1px solid ${COLORS.border}`},accent:{background:COLORS.accent,color:"#fff",border:"none"},danger:{background:COLORS.danger+"22",color:COLORS.danger,border:`1px solid ${COLORS.danger}44`}};
  return <button className={variant==="accent"?"ba":""} onClick={onClick} disabled={disabled} style={{padding:"6px 14px",borderRadius:8,fontSize:13,fontWeight:600,transition:"all .15s",opacity:disabled?.5:1,...v[variant],...style}}>{children}</button>;
};
const Modal=({title,children,onClose,wide})=>(
  <div className="mo" onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
    <div className="mc" onClick={e=>e.stopPropagation()} style={{background:COLORS.surface,borderRadius:16,width:"100%",maxWidth:wide?720:520,border:`1px solid ${COLORS.border}`,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{padding:"18px 24px",borderBottom:`1px solid ${COLORS.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontWeight:700,fontSize:16}}>{title}</span>
        <button onClick={onClose} style={{background:"none",color:COLORS.textMuted,fontSize:20}}>✕</button>
      </div>
      <div style={{padding:"20px 24px"}}>{children}</div>
    </div>
  </div>
);
const Inp=({label,value,onChange,type="text",placeholder=""})=>(
  <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>{label}</div>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14}}/>
  </div>
);
const Sel=({label,value,onChange,options})=>(
  <div style={{marginBottom:14}}>
    {label&&<div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14}}>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const LoginScreen=({onLogin,loading})=>(
  <div style={{minHeight:"100vh",background:COLORS.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{textAlign:"center",padding:40}}>
      <div style={{fontSize:56,marginBottom:16}}>✅</div>
      <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:28,marginBottom:8}}><span style={{color:COLORS.accent}}>◈</span> マイタスク</div>
      <div style={{color:COLORS.textMuted,marginBottom:32,fontSize:14}}>あなただけのタスク管理アプリ</div>
      <button onClick={onLogin} disabled={loading} style={{display:"flex",alignItems:"center",gap:12,background:"#fff",color:"#333",border:"none",borderRadius:12,padding:"14px 28px",fontSize:15,fontWeight:600,cursor:"pointer",margin:"0 auto",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",opacity:loading?0.7:1}}>
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        {loading?"ログイン中...":"Googleでログイン"}
      </button>
    </div>
  </div>
);

const TaskForm=({task,tags,onSave,onClose,isChild})=>{
  const empty={id:"task_"+Date.now(),title:"",done:false,tags:[],memo:"",startDate:"",startTime:"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",children:[],isLater:false};
  const [f,setF]=useState(task||empty);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const tog=tid=>upd("tags",f.tags.includes(tid)?f.tags.filter(x=>x!==tid):[...f.tags,tid]);
  const parentTags=tags.filter(t=>!t.parentId);
  const childTags=pid=>tags.filter(t=>t.parentId===pid);
  return (
    <Modal title={task?"タスクを編集":isChild?"子タスクを追加":"タスクを追加"} onClose={onClose} wide>
      <Inp label="タスク名 *" value={f.title} onChange={v=>upd("title",v)} placeholder="タスク名..."/>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:6,fontWeight:600}}>タグ</div>
        {parentTags.map(pt=>(
          <div key={pt.id} style={{marginBottom:8}}>
            <div onClick={()=>tog(pt.id)} style={{display:"inline-flex",padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:700,cursor:"pointer",border:`1px solid ${pt.color}44`,background:f.tags.includes(pt.id)?pt.color+"33":"transparent",color:f.tags.includes(pt.id)?pt.color:COLORS.textMuted,marginBottom:4}}>{pt.name}</div>
            {childTags(pt.id).length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6,paddingLeft:16}}>
                {childTags(pt.id).map(ct=>(
                  <div key={ct.id} onClick={()=>tog(ct.id)} style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",border:`1px solid ${ct.color}44`,background:f.tags.includes(ct.id)?ct.color+"33":"transparent",color:f.tags.includes(ct.id)?ct.color:COLORS.textMuted}}>└ {ct.name}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{background:COLORS.bg,borderRadius:10,padding:12,marginBottom:14}}>
        <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:8,fontWeight:600}}>📅 開始日時</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <Inp label="開始日" value={f.startDate} onChange={v=>upd("startDate",v)} type="date"/>
          <Inp label="開始時刻（任意）" value={f.startTime} onChange={v=>upd("startTime",v)} type="time"/>
        </div>
        <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:8,fontWeight:600}}>⏹ 終了日時</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <Inp label="終了日" value={f.endDate} onChange={v=>upd("endDate",v)} type="date"/>
          <Inp label="終了時刻（任意）" value={f.endTime} onChange={v=>upd("endTime",v)} type="time"/>
        </div>
        <div style={{fontSize:12,color:COLORS.warning,marginBottom:8,fontWeight:600}}>⚠️ 締切日時</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <Inp label="締切日" value={f.deadlineDate} onChange={v=>upd("deadlineDate",v)} type="date"/>
          <Inp label="締切時刻（任意）" value={f.deadlineTime} onChange={v=>upd("deadlineTime",v)} type="time"/>
        </div>
      </div>
      <div style={{fontSize:11,color:COLORS.textMuted,marginBottom:14,padding:"8px 12px",background:COLORS.accentSoft,borderRadius:8}}>
        💡 開始日を設定しないと「あとでやる」に自動追加されます
      </div>
      <Sel label="繰り返し" value={f.repeat} onChange={v=>upd("repeat",v)} options={REPEAT_OPTIONS}/>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>メモ</div>
        <textarea value={f.memo} onChange={e=>upd("memo",e.target.value)} placeholder="メモ..." rows={3} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14,resize:"vertical"}}/>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn variant="accent" onClick={()=>{if(f.title.trim()){onSave({...f,isLater:isAutoLater(f)});onClose();}}}>保存</Btn>
      </div>
    </Modal>
  );
};

const TaskRow=({task,tags,depth=0,onEdit,onDelete,onToggle,onAddChild})=>{
  const [exp,setExp]=useState(true);
  const tTags=tags.filter(t=>task.tags?.includes(t.id));
  const today=new Date().toISOString().slice(0,10);
  const isOverdue=task.deadlineDate&&!task.done&&task.deadlineDate<today;
  const isUrgent=task.deadlineDate&&!task.done&&task.deadlineDate===today;
  return (
    <div style={{marginLeft:depth*22}}>
      <div className="tr" style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:10,marginBottom:4,background:depth===0?COLORS.surface:"transparent",border:depth===0?`1px solid ${isOverdue?COLORS.danger+"66":COLORS.border}`:undefined,borderLeft:depth>0?`2px solid ${COLORS.border}`:undefined,paddingLeft:depth>0?14:12,opacity:task.done?.55:1,position:"relative"}}>
        <div style={{paddingTop:2}}><Checkbox checked={task.done} onChange={()=>onToggle(task.id)}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {task.children?.length>0&&<span onClick={()=>setExp(!exp)} style={{cursor:"pointer",fontSize:10,color:COLORS.textMuted,transform:exp?"rotate(90deg)":"",transition:"transform .15s",display:"inline-block"}}>▶</span>}
            <span style={{fontSize:14,fontWeight:depth===0?600:400,textDecoration:task.done?"line-through":"none",color:task.done?COLORS.textMuted:COLORS.text}}>{task.title}</span>
            {task.repeat!=="なし"&&<span style={{fontSize:10,color:COLORS.success,background:COLORS.success+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>↻ {task.repeat}</span>}
            {(task.isLater||isAutoLater(task))&&<span style={{fontSize:10,color:COLORS.warning,background:COLORS.warning+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>📌 あとで</span>}
            {isOverdue&&<span style={{fontSize:10,color:COLORS.danger,background:COLORS.danger+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>⚠ 期限超過</span>}
            {isUrgent&&<span style={{fontSize:10,color:COLORS.warning,background:COLORS.warning+"22",padding:"1px 6px",borderRadius:10,fontWeight:600}}>🔥 今日締切</span>}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:5,alignItems:"center"}}>
            {tTags.map(t=><TagChip key={t.id} tag={t}/>)}
            {task.startDate&&<span style={{fontSize:11,color:COLORS.textMuted}}>▶ {formatDateTime(task.startDate,task.startTime)}</span>}
            {task.endDate&&<span style={{fontSize:11,color:COLORS.textMuted}}>⏹ {formatDateTime(task.endDate,task.endTime)}</span>}
            {task.deadlineDate&&<span style={{fontSize:11,color:isOverdue?COLORS.danger:COLORS.warning,fontWeight:600}}>⚠ {formatDateTime(task.deadlineDate,task.deadlineTime)}</span>}
            {task.memo&&<span style={{fontSize:11,color:COLORS.textMuted,fontStyle:"italic"}}>{task.memo.slice(0,30)}{task.memo.length>30?"...":""}</span>}
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
  const filtered=useMemo(()=>{
    let list=tasks;
    if(filters.tag)list=list.filter(t=>t.tags?.includes(filters.tag));
    if(filters.search)list=list.filter(t=>t.title.toLowerCase().includes(filters.search.toLowerCase()));
    if(filters.hideCompleted)list=list.filter(t=>!t.done);
    return list;
  },[tasks,filters]);
  const later=filtered.filter(t=>t.isLater||isAutoLater(t));
  const habits=filtered.filter(t=>!(t.isLater||isAutoLater(t))&&t.repeat!=="なし");
  const regular=filtered.filter(t=>!(t.isLater||isAutoLater(t))&&t.repeat==="なし");
  const Sec=({title,items,accent})=>items.length===0?null:(
    <div style={{marginBottom:28}}>
      <div style={{fontSize:12,fontWeight:700,color:accent,textTransform:"uppercase",letterSpacing:1,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:20,height:2,background:accent}}></div>{title} ({items.length})
      </div>
      {items.map(t=><TaskRow key={t.id} task={t} tags={tags} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onAddChild={onAddChild}/>)}
    </div>
  );
  return (
    <div>
      <Sec title="習慣・繰り返し" items={habits} accent={COLORS.success}/>
      <Sec title="タスク" items={regular} accent={COLORS.accent}/>
      <Sec title="あとでやる" items={later} accent={COLORS.warning}/>
      {filtered.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:COLORS.textMuted}}><div style={{fontSize:48,marginBottom:12}}>🎉</div><div>タスクがありません</div></div>}
    </div>
  );
};

const WeekView=({tasks,tags,today})=>{
  const weekDates=getWeekDates(today);
  const allTasks=flattenTasks(tasks);
  const getDay=date=>allTasks.filter(t=>{
    if(t.repeat==="毎日")return true;
    if(t.repeat==="平日のみ"){const d=new Date(date).getDay();return d>=1&&d<=5;}
    if(t.repeat==="毎週"&&t.startDate)return new Date(t.startDate).getDay()===new Date(date).getDay();
    return isSameDay(t.startDate,date)||isSameDay(t.deadlineDate,date);
  });
  return (
    <div style={{overflowX:"auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"56px repeat(7,1fr)",minWidth:700}}>
        <div></div>
        {weekDates.map((d,i)=>{const isT=d===today,dt=new Date(d);return(
          <div key={d} style={{padding:"8px 4px",textAlign:"center",borderBottom:`2px solid ${isT?COLORS.accent:COLORS.border}`,color:isT?COLORS.accent:COLORS.textSoft}}>
            <div style={{fontSize:11,fontWeight:700}}>{DAYS_JP[i]}</div>
            <div style={{fontSize:18,fontWeight:isT?700:400}}>{dt.getDate()}</div>
          </div>
        );})}
        {HOURS.slice(6,23).map(hour=>[
          <div key={hour+"l"} style={{fontSize:10,color:COLORS.textMuted,paddingRight:6,textAlign:"right",paddingTop:4,borderTop:`1px solid ${COLORS.border}22`,height:52,display:"flex",alignItems:"flex-start",justifyContent:"flex-end"}}>{hour}</div>,
          ...weekDates.map(d=>{
            const dts=getDay(d).filter(t=>t.startTime?.slice(0,2)===hour.slice(0,2));
            return <div key={d+hour} style={{borderTop:`1px solid ${COLORS.border}22`,height:52,padding:2}}>
              {dts.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||COLORS.accent;return(
                <div key={t.id} style={{background:c+"33",borderLeft:`3px solid ${c}`,borderRadius:"0 6px 6px 0",padding:"2px 6px",fontSize:10,color:c,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",marginBottom:2}}>{t.startTime} {t.title}</div>
              );})}
            </div>;
          })
        ])}
      </div>
    </div>
  );
};

const DayView=({tasks,tags,today})=>{
  const allTasks=flattenTasks(tasks);
  const todayTasks=allTasks.filter(t=>{
    if(t.repeat==="毎日")return true;
    if(t.repeat==="平日のみ"){const d=new Date(today).getDay();return d>=1&&d<=5;}
    return isSameDay(t.startDate,today)||isSameDay(t.deadlineDate,today);
  });
  const timed=todayTasks.filter(t=>t.startTime);
  const untimed=todayTasks.filter(t=>!t.startTime);
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:24}}>
      <div>
        <div style={{fontSize:12,fontWeight:700,color:COLORS.textMuted,marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>タイムライン</div>
        {HOURS.slice(6,23).map(hour=>{
          const ht=timed.filter(t=>t.startTime?.slice(0,2)===hour.slice(0,2));
          return <div key={hour} style={{display:"grid",gridTemplateColumns:"50px 1fr",minHeight:60,borderTop:`1px solid ${COLORS.border}`}}>
            <div style={{fontSize:11,color:COLORS.textMuted,paddingTop:4,paddingRight:8,textAlign:"right"}}>{hour}</div>
            <div style={{padding:"4px 0 4px 12px"}}>
              {ht.map(t=>{const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||COLORS.accent;return(
                <div key={t.id} style={{background:c+"22",borderLeft:`4px solid ${c}`,borderRadius:"0 10px 10px 0",padding:"8px 12px",marginBottom:4}}>
                  <div style={{fontSize:13,fontWeight:700,color:c}}>{t.title}</div>
                  <div style={{fontSize:11,color:COLORS.textMuted}}>{t.startTime}{t.endTime?` 〜 ${t.endTime}`:""}{t.deadlineDate?` | ⚠ ${formatDateTime(t.deadlineDate,t.deadlineTime)}`:""}</div>
                </div>
              );})}
            </div>
          </div>;
        })}
      </div>
      <div>
        <div style={{fontSize:12,fontWeight:700,color:COLORS.textMuted,marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>時間未定</div>
        {untimed.length===0?<div style={{color:COLORS.textMuted,fontSize:13}}>なし</div>:untimed.map(t=>{
          const c=tags.find(tg=>t.tags?.includes(tg.id))?.color||COLORS.accent;
          return <div key={t.id} style={{background:COLORS.surface,borderRadius:10,padding:"10px 14px",marginBottom:8,borderLeft:`3px solid ${c}`}}>
            <div style={{fontSize:13,fontWeight:600}}>{t.title}</div>
            {t.deadlineDate&&<div style={{fontSize:11,color:COLORS.warning,marginTop:2}}>⚠ {formatDateTime(t.deadlineDate,t.deadlineTime)}</div>}
          </div>;
        })}
      </div>
    </div>
  );
};

const MonthView=({tasks,tags,today})=>{
  const [vy,setVy]=useState(new Date(today).getFullYear());
  const [vm,setVm]=useState(new Date(today).getMonth());
  const dim=getDaysInMonth(vy,vm);
  const allTasks=flattenTasks(tasks).filter(t=>t.startDate||t.deadlineDate);
  const getBar=task=>{
    const s=task.startDate?new Date(task.startDate):task.deadlineDate?new Date(task.deadlineDate):null;
    const e=task.deadlineDate?new Date(task.deadlineDate):s;
    if(!s)return null;
    const ms=new Date(vy,vm,1),me=new Date(vy,vm,dim);
    if(e<ms||s>me)return null;
    const cs=s<ms?ms:s,ce=e>me?me:e;
    return{startDay:cs.getDate(),width:ce.getDate()-cs.getDate()+1};
  };
  const MN=["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <Btn onClick={()=>{if(vm===0){setVy(y=>y-1);setVm(11);}else setVm(m=>m-1);}}>‹ 前月</Btn>
        <span style={{fontWeight:700,fontSize:16}}>{vy}年 {MN[vm]}</span>
        <Btn onClick={()=>{if(vm===11){setVy(y=>y+1);setVm(0);}else setVm(m=>m+1);}}>次月 ›</Btn>
      </div>
      <div style={{overflowX:"auto"}}>
        <div style={{minWidth:dim*30+180}}>
          <div style={{display:"flex",borderBottom:`1px solid ${COLORS.border}`,paddingBottom:4,marginBottom:4}}>
            <div style={{width:180,flexShrink:0}}></div>
            {Array.from({length:dim},(_,i)=>{
              const d=i+1,isT=`${vy}-${String(vm+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`===today;
              return <div key={d} style={{width:30,flexShrink:0,textAlign:"center",fontSize:10,fontWeight:isT?700:400,color:isT?COLORS.accent:COLORS.textMuted}}>{d}</div>;
            })}
          </div>
          {allTasks.map(task=>{
            const bar=getBar(task),c=tags.find(t=>task.tags?.includes(t.id))?.color||COLORS.accent;
            return <div key={task.id} style={{display:"flex",alignItems:"center",marginBottom:6,height:28}}>
              <div style={{width:180,flexShrink:0,fontSize:12,paddingRight:8,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",color:COLORS.textSoft}}>{task.title}</div>
              <div style={{position:"relative",height:"100%",flex:1}}>
                {bar&&<div style={{position:"absolute",left:(bar.startDay-1)*30,width:bar.width*30-4,height:22,top:3,background:c+"33",border:`1px solid ${c}55`,borderRadius:6,display:"flex",alignItems:"center",paddingLeft:8,fontSize:10,color:c,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap"}}>
                  {bar.width>2?task.title.slice(0,15):""}
                </div>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>
  );
};

const TemplatesView=({templates,setTemplates,onUse})=>{
  const [show,setShow]=useState(false);
  const [form,setForm]=useState({name:"",tasks:[""]});
  const save=()=>{if(!form.name.trim())return;setTemplates(t=>[...t,{id:"tpl_"+Date.now(),name:form.name,tasks:form.tasks.filter(Boolean)}]);setForm({name:"",tasks:[""]});setShow(false);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:20}}><Btn variant="accent" onClick={()=>setShow(true)}>+ テンプレートを作成</Btn></div>
      {templates.length===0&&<div style={{textAlign:"center",padding:40,color:COLORS.textMuted}}>テンプレートがまだありません</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
        {templates.map(tpl=>(
          <div key={tpl.id} style={{background:COLORS.surface,borderRadius:14,padding:20,border:`1px solid ${COLORS.border}`}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>{tpl.name}</div>
            <div style={{marginBottom:14}}>{tpl.tasks.map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:`1px solid ${COLORS.border}22`,fontSize:13,color:COLORS.textSoft}}><div style={{width:6,height:6,borderRadius:"50%",background:COLORS.accent,flexShrink:0}}></div>{t}</div>)}</div>
            <div style={{display:"flex",gap:8}}>
              <Btn variant="accent" onClick={()=>onUse(tpl)} style={{flex:1,textAlign:"center"}}>使う</Btn>
              <Btn variant="danger" onClick={()=>setTemplates(t=>t.filter(x=>x.id!==tpl.id))}>削除</Btn>
            </div>
          </div>
        ))}
      </div>
      {show&&(
        <Modal title="テンプレートを作成" onClose={()=>setShow(false)}>
          <Inp label="テンプレート名" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="例: 週次レビュー"/>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:8,fontWeight:600}}>タスク一覧</div>
            {form.tasks.map((t,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:6}}>
                <input value={t} onChange={e=>{const ts=[...form.tasks];ts[i]=e.target.value;setForm(f=>({...f,tasks:ts}));}} placeholder={`タスク ${i+1}`} style={{flex:1,background:COLORS.bg,color:COLORS.text,padding:"8px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:13}}/>
                <button onClick={()=>setForm(f=>({...f,tasks:f.tasks.filter((_,idx)=>idx!==i)}))} style={{background:COLORS.danger+"22",color:COLORS.danger,border:"none",borderRadius:6,width:32}}>✕</button>
              </div>
            ))}
            <Btn onClick={()=>setForm(f=>({...f,tasks:[...f.tasks,""]}))}>+ 追加</Btn>
          </div>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}><Btn onClick={()=>setShow(false)}>キャンセル</Btn><Btn variant="accent" onClick={save}>保存</Btn></div>
        </Modal>
      )}
    </div>
  );
};

const TagsView=({tags,setTags})=>{
  const [form,setForm]=useState({name:"",color:"#6c63ff",parentId:null});
  const add=()=>{if(!form.name.trim())return;setTags(t=>[...t,{id:"tag_"+Date.now(),name:form.name,color:form.color,parentId:form.parentId||null}]);setForm({name:"",color:"#6c63ff",parentId:null});};
  const parentTags=tags.filter(t=>!t.parentId);
  const childTags=pid=>tags.filter(t=>t.parentId===pid);
  return (
    <div>
      <div style={{background:COLORS.surface,borderRadius:14,padding:20,border:`1px solid ${COLORS.border}`,marginBottom:20}}>
        <div style={{fontWeight:700,marginBottom:14}}>新しいタグを作成</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 80px",gap:12,marginBottom:12}}>
          <Inp label="タグ名" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="タグ名..."/>
          <div><div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>色</div><input type="color" value={form.color} onChange={e=>setForm(f=>({...f,color:e.target.value}))} style={{width:"100%",height:38,borderRadius:8,border:`1px solid ${COLORS.border}`,background:"none",cursor:"pointer",padding:2}}/></div>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,color:COLORS.textMuted,marginBottom:5,fontWeight:600}}>親タグ（小タグとして追加する場合）</div>
          <select value={form.parentId||""} onChange={e=>setForm(f=>({...f,parentId:e.target.value||null}))} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"9px 12px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:14}}>
            <option value="">なし（親タグとして作成）</option>
            {parentTags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <Btn variant="accent" onClick={add}>追加</Btn>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {parentTags.map(pt=>(
          <div key={pt.id} style={{background:COLORS.surface,borderRadius:12,padding:16,border:`1px solid ${pt.color}44`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:childTags(pt.id).length>0?12:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:12,height:12,borderRadius:"50%",background:pt.color}}></div>
                <span style={{fontWeight:700,color:pt.color,fontSize:14}}>{pt.name}</span>
                <span style={{fontSize:11,color:COLORS.textMuted}}>親タグ</span>
              </div>
              <button onClick={()=>setTags(ts=>ts.filter(x=>x.id!==pt.id&&x.parentId!==pt.id))} style={{background:"none",border:"none",color:COLORS.textMuted,fontSize:14}}>✕</button>
            </div>
            {childTags(pt.id).length>0&&(
              <div style={{paddingLeft:22,display:"flex",flexDirection:"column",gap:6}}>
                {childTags(pt.id).map(ct=>(
                  <div key={ct.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:COLORS.bg,borderRadius:8,border:`1px solid ${ct.color}33`}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:ct.color}}></div>
                      <span style={{fontSize:13,color:ct.color,fontWeight:600}}>{ct.name}</span>
                      <span style={{fontSize:10,color:COLORS.textMuted}}>小タグ</span>
                    </div>
                    <button onClick={()=>setTags(ts=>ts.filter(x=>x.id!==ct.id))} style={{background:"none",border:"none",color:COLORS.textMuted,fontSize:12}}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default function App() {
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

  useEffect(()=>{const unsub=onAuthStateChanged(auth,u=>{setUser(u);setAuthLoading(false);});return unsub;},[]);
  useEffect(()=>{
    if(!user)return;
    const unsub=onSnapshot(doc(db,"users",user.uid),snap=>{
      if(snap.exists()){const data=snap.data();if(data.tasks)setTasks(data.tasks);if(data.tags)setTags(data.tags);if(data.templates)setTemplates(data.templates);}
    });
    return unsub;
  },[user]);

  const save=async(t,tg,tp)=>{if(!user)return;setSaving(true);try{await setDoc(doc(db,"users",user.uid),{tasks:t,tags:tg,templates:tp,updatedAt:new Date().toISOString()});}catch(e){console.error(e);}setSaving(false);};
  const updT=t=>{setTasks(t);save(t,tags,templates);};
  const updTg=t=>{setTags(t);save(tasks,t,templates);};
  const updTp=t=>{setTemplates(t);save(tasks,tags,t);};

  const handleLogin=async()=>{
    setLoginLoading(true);
    try{const result=await signInWithPopup(auth,provider);if(!ALLOWED_UIDS.includes(result.user.uid)){await signOut(auth);alert("このアカウントはアクセスできません。");}}
    catch(e){console.error(e);}
    setLoginLoading(false);
  };

  const updTree=(ts,id,fn)=>ts.map(t=>t.id===id?fn(t):{...t,children:updTree(t.children||[],id,fn)});
  const delTree=(ts,id)=>ts.filter(t=>t.id!==id).map(t=>({...t,children:delTree(t.children||[],id)}));
  const addChild=(ts,pid,c)=>ts.map(t=>t.id===pid?{...t,children:[...(t.children||[]),c]}:{...t,children:addChild(t.children||[],pid,c)});

  const handleSave=f=>{
    const fw={...f,isLater:isAutoLater(f)};
    let nt;
    if(editTask)nt=updTree(tasks,f.id,()=>fw);
    else if(addChildTo)nt=addChild(tasks,addChildTo,fw);
    else nt=[...tasks,fw];
    updT(nt);setEditTask(null);setAddChildTo(null);
  };

  const allFlat=flattenTasks(tasks);
  const done=allFlat.filter(t=>t.done).length;
  const total=allFlat.length;
  const pct=total>0?Math.round((done/total)*100):0;
  const NAV=[{id:"list",label:"リスト",icon:"☰"},{id:"day",label:"日",icon:"📆"},{id:"week",label:"週",icon:"📅"},{id:"month",label:"月(ガント)",icon:"📊"},{id:"templates",label:"テンプレート",icon:"📋"},{id:"tagmgr",label:"タグ管理",icon:"🏷"}];
  const parentTags=tags.filter(t=>!t.parentId);

  if(authLoading)return<div style={{minHeight:"100vh",background:COLORS.bg,display:"flex",alignItems:"center",justifyContent:"center",color:COLORS.textMuted}}>読み込み中...</div>;
  if(!user)return<LoginScreen onLogin={handleLogin} loading={loginLoading}/>;

  return (
    <>
      <style>{G}</style>
      <div style={{minHeight:"100vh",background:COLORS.bg,display:"flex"}}>
        <div style={{width:216,flexShrink:0,background:COLORS.surface,borderRight:`1px solid ${COLORS.border}`,display:"flex",flexDirection:"column",padding:"24px 0",position:"fixed",top:0,left:0,height:"100vh",overflowY:"auto"}}>
          <div style={{padding:"0 18px 20px",borderBottom:`1px solid ${COLORS.border}`}}>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:17,letterSpacing:-.5}}><span style={{color:COLORS.accent}}>◈</span> マイタスク</div>
            <div style={{fontSize:11,color:COLORS.textMuted,marginTop:4}}>{user.email}</div>
            {saving&&<div style={{fontSize:10,color:COLORS.success,marginTop:4}}>💾 保存中...</div>}
            <div style={{marginTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:COLORS.textMuted,marginBottom:6}}><span>全体進捗</span><span style={{fontWeight:700,color:COLORS.accent}}>{pct}%</span></div>
              <div style={{background:COLORS.bg,borderRadius:10,height:6,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${COLORS.accent},${COLORS.success})`,borderRadius:10,transition:"width .4s"}}></div></div>
              <div style={{fontSize:10,color:COLORS.textMuted,marginTop:4}}>{done}/{total} 完了</div>
            </div>
          </div>
          <div style={{padding:"14px 10px",flex:1}}>
            {NAV.map(n=>(
              <button key={n.id} className="nb" onClick={()=>setView(n.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 12px",borderRadius:10,marginBottom:3,background:view===n.id?COLORS.accentSoft:"transparent",color:view===n.id?COLORS.accent:COLORS.textSoft,border:view===n.id?`1px solid ${COLORS.accent}33`:"1px solid transparent",fontSize:13,fontWeight:view===n.id?700:400,textAlign:"left"}}>
                <span style={{fontSize:15}}>{n.icon}</span>{n.label}
              </button>
            ))}
          </div>
          <div style={{padding:"14px 10px",borderTop:`1px solid ${COLORS.border}`}}>
            <div style={{fontSize:11,color:COLORS.textMuted,marginBottom:8,fontWeight:600}}>フィルター</div>
            <input value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} placeholder="検索..." style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"7px 10px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:12,marginBottom:8}}/>
            <select value={filters.tag} onChange={e=>setFilters(f=>({...f,tag:e.target.value}))} style={{width:"100%",background:COLORS.bg,color:COLORS.text,padding:"7px 10px",borderRadius:8,border:`1px solid ${COLORS.border}`,fontSize:12,marginBottom:8}}>
              <option value="">すべてのタグ</option>
              {parentTags.map(pt=>(
                <optgroup key={pt.id} label={pt.name}>
                  <option value={pt.id}>{pt.name}（全体）</option>
                  {tags.filter(t=>t.parentId===pt.id).map(ct=><option key={ct.id} value={ct.id}>└ {ct.name}</option>)}
                </optgroup>
              ))}
            </select>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <Checkbox checked={filters.hideCompleted} onChange={()=>setFilters(f=>({...f,hideCompleted:!f.hideCompleted}))} size={16}/>
              <span style={{fontSize:12,color:COLORS.textMuted}}>完了を隠す</span>
            </div>
            <button onClick={()=>signOut(auth)} style={{width:"100%",background:"transparent",color:COLORS.textMuted,border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"7px",fontSize:12,cursor:"pointer"}}>ログアウト</button>
          </div>
        </div>
        <div style={{marginLeft:216,flex:1,padding:32,maxWidth:"calc(100% - 216px)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:28}}>
            <div>
              <h1 style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:22,letterSpacing:-.5}}>{NAV.find(n=>n.id===view)?.icon} {NAV.find(n=>n.id===view)?.label}</h1>
              <div style={{fontSize:12,color:COLORS.textMuted,marginTop:2}}>{new Date(today).toLocaleDateString("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"})}</div>
            </div>
            {["list","day","week"].includes(view)&&<Btn variant="accent" onClick={()=>{setEditTask(null);setAddChildTo(null);setShowForm(true);}}>+ タスクを追加</Btn>}
          </div>
          {view==="list"&&<ListView tasks={tasks} tags={tags} filters={filters} onEdit={t=>{setEditTask(t);setShowForm(true);}} onDelete={id=>updT(delTree(tasks,id))} onToggle={id=>updT(updTree(tasks,id,t=>({...t,done:!t.done})))} onAddChild={pid=>{setAddChildTo(pid);setShowForm(true);}}/>}
          {view==="week"&&<WeekView tasks={tasks} tags={tags} today={today}/>}
          {view==="day"&&<DayView tasks={tasks} tags={tags} today={today}/>}
          {view==="month"&&<MonthView tasks={tasks} tags={tags} today={today}/>}
          {view==="templates"&&<TemplatesView templates={templates} setTemplates={updTp} onUse={tpl=>{updT([...tasks,...tpl.tasks.map(title=>({id:"task_"+Date.now()+Math.random(),title,done:false,tags:[],memo:"",startDate:"",startTime:"",endDate:"",endTime:"",deadlineDate:"",deadlineTime:"",repeat:"なし",children:[],isLater:true}))]);setView("list");}}/>}
          {view==="tagmgr"&&<TagsView tags={tags} setTags={updTg}/>}
        </div>
      </div>
      {showForm&&<TaskForm task={editTask} tags={tags} isChild={!!addChildTo} onSave={handleSave} onClose={()=>{setShowForm(false);setEditTask(null);setAddChildTo(null);}}/>}
    </>
  );
}
