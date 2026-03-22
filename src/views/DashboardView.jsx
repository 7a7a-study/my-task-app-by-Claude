import { C } from "../constants";
import { flatten, fd, sameDay, parseRepeat, matchesRepeat, isLaterTask, localDate } from "../utils";

export const DashboardView = ({tasks,tags,today,onToggle,onEdit}) => {
  const all = flatten(tasks);
  const nonRep = all.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし");
  const doneCnt  = nonRep.filter(t=>t.done).length;
  const totalCnt = nonRep.length;
  const pct = totalCnt > 0 ? Math.round(doneCnt/totalCnt*100) : 0;
  const todayTasks = all.filter(t => {
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") return matchesRepeat(t, today);
    return sameDay(t.startDate, today) || sameDay(t.deadlineDate, today);
  }).filter(t => !(t.isLater||isLaterTask(t)));
  const todayDone = todayTasks.filter(t => t.done).length;
  const overdue  = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate < today);
  const in7 = (() => { const d=new Date(today); d.setDate(d.getDate()+7); return localDate(d); })();
  const upcoming = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate > today && t.deadlineDate <= in7).sort((a,b)=>a.deadlineDate.localeCompare(b.deadlineDate));
  const laterTasks = all.filter(t => (t.isLater||isLaterTask(t)) && !t.done);
  const tagStats = tags.filter(t=>!t.parentId&&!t.archived).map(tag=>{
    const tt = nonRep.filter(t=>t.tags?.includes(tag.id));
    const td = tt.filter(t=>t.done).length;
    return {...tag, total:tt.length, done:td, pct: tt.length ? Math.round(td/tt.length*100) : 0};
  }).filter(t=>t.total>0);

  const Card = ({title,color=C.border,children}) => (
    <div style={{background:C.surface,borderRadius:11,padding:13,border:`1px solid ${color}44`}}>
      <div style={{fontSize:9,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:.6,marginBottom:10}}>{title}</div>
      {children}
    </div>
  );
  const MiniRow = ({task}) => {
    const c = tags.find(tg=>task.tags?.includes(tg.id))?.color || C.accent;
    return (
      <div style={{display:"flex",alignItems:"center",gap:7,padding:"4px 0",borderBottom:`1px solid ${C.border}18`,cursor:"pointer"}} onClick={()=>onEdit(task)}>
        <div onClick={e=>{e.stopPropagation();onToggle(task.id);}} style={{width:11,height:11,borderRadius:3,border:`2px solid ${task.done?c:C.border}`,background:task.done?c:"transparent",flexShrink:0,cursor:"pointer"}}/>
        <span style={{fontSize:11,color:task.done?C.textMuted:C.text,textDecoration:task.done?"line-through":"none",flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{task.title}</span>
        {task.deadlineDate && <span style={{fontSize:9,color:C.warn,flexShrink:0}}>{fd(task.deadlineDate)}</span>}
        <div style={{width:6,height:6,borderRadius:"50%",background:c,flexShrink:0}}/>
      </div>
    );
  };
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
      <Card title="📊 全体進捗" color={C.accent}>
        <div style={{fontSize:34,fontWeight:800,color:C.accent,fontFamily:"'Playfair Display',serif",lineHeight:1}}>{pct}<span style={{fontSize:16}}>%</span></div>
        <div style={{background:C.bg,borderRadius:6,height:6,overflow:"hidden",margin:"8px 0 4px"}}>
          <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${C.accent},${C.success})`,borderRadius:6,transition:"width .5s"}}/>
        </div>
        <div style={{fontSize:10,color:C.textMuted}}>{doneCnt} / {totalCnt} タスク完了</div>
      </Card>
      <Card title={`📅 今日 (${todayDone}/${todayTasks.length})`} color={C.success}>
        {todayTasks.length===0 ? <div style={{fontSize:11,color:C.textMuted}}>今日のタスクなし 🎉</div> : todayTasks.slice(0,6).map(t=><MiniRow key={t.id} task={t}/>)}
        {todayTasks.length>6 && <div style={{fontSize:10,color:C.textMuted,marginTop:5}}>他 {todayTasks.length-6} 件...</div>}
      </Card>
      {overdue.length>0 && <Card title={`⚠ 期限超過 (${overdue.length})`} color={C.danger}>{overdue.slice(0,5).map(t=><MiniRow key={t.id} task={t}/>)}{overdue.length>5 && <div style={{fontSize:10,color:C.textMuted,marginTop:5}}>他 {overdue.length-5} 件...</div>}</Card>}
      {upcoming.length>0 && <Card title={`📆 今後7日の締切 (${upcoming.length})`} color={C.warn}>{upcoming.map(t=><MiniRow key={t.id} task={t}/>)}</Card>}
      {tagStats.length>0 && <Card title="🏷 タグ別進捗" color={C.accent}>{tagStats.map(tag=><div key={tag.id} style={{marginBottom:9}}><div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}><span style={{color:tag.color,fontWeight:700}}>{tag.name}</span><span style={{color:C.textMuted,fontSize:10}}>{tag.pct}% ({tag.done}/{tag.total})</span></div><div style={{background:C.bg,borderRadius:5,height:5,overflow:"hidden"}}><div style={{width:`${tag.pct}%`,height:"100%",background:tag.color,borderRadius:5,transition:"width .5s"}}/></div></div>)}</Card>}
      {laterTasks.length>0 && <Card title={`📌 あとでやる (${laterTasks.length})`} color={C.warn}>{laterTasks.slice(0,5).map(t=><MiniRow key={t.id} task={t}/>)}{laterTasks.length>5 && <div style={{fontSize:10,color:C.textMuted,marginTop:5}}>他 {laterTasks.length-5} 件...</div>}</Card>}
    </div>
  );
};
