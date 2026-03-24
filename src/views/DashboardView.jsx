import { useState, useEffect } from "react";
import { C } from "../constants";
import { flatten, fd, sameDay, parseRepeat, matchesRepeat, isLaterTask, localDate, t2m } from "../utils";
import { Popup } from "../components/Popup";

export const DashboardView = ({tasks,tags,today,onToggle,onEdit,onDelete,onDuplicate,onSkip,onOverride,onAddSession,onRemoveSession,onMemoToggle}) => {
  const [isPC, setIsPC] = useState(window.innerWidth >= 768);
  const [popup, setPopup] = useState(null);
  useEffect(() => {
    const fn = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const all = flatten(tasks);
  const nonRep = all.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし");

  const todayTasks = all.filter(t => {
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") return matchesRepeat(t, today);
    return sameDay(t.startDate, today) || sameDay(t.deadlineDate, today);
  }).filter(t => !(t.isLater || isLaterTask(t)));
  const todayDone = todayTasks.filter(t => {
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") return (t.doneDates||[]).includes(today);
    return t.done;
  }).length;

  const in7 = (() => { const d = new Date(today); d.setDate(d.getDate() + 7); return localDate(d); })();
  const overdue  = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate < today)
                         .sort((a,b) => a.deadlineDate.localeCompare(b.deadlineDate));
  const upcoming = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate >= today && t.deadlineDate <= in7)
                         .sort((a,b) => a.deadlineDate.localeCompare(b.deadlineDate));
  const startingIn7 = nonRep.filter(t =>
    t.startDate && t.startDate > today && t.startDate <= in7 && !t.done && !t.deadlineDate
  ).sort((a,b) => a.startDate.localeCompare(b.startDate));
  const week7 = [...overdue, ...upcoming, ...startingIn7];

  const laterTasks = all.filter(t => (t.isLater || isLaterTask(t)) && !t.done);

  // 子タグのみ表示
  const tagStats = tags.filter(t => t.parentId && !t.archived).map(tag => {
    const tt = nonRep.filter(t => t.tags?.includes(tag.id));
    const td = tt.filter(t => t.done).length;
    return {...tag, total: tt.length, done: td, pct: tt.length ? Math.round(td / tt.length * 100) : 0};
  }).filter(t => t.total > 0);

  const doneCnt  = nonRep.filter(t => t.done).length;
  const totalCnt = nonRep.length;
  const pct = totalCnt > 0 ? Math.round(doneCnt / totalCnt * 100) : 0;

  const openPopup = (e, task) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setPopup({task, x: Math.min(r.right+8, window.innerWidth-308), y: Math.min(r.top, window.innerHeight-420)});
  };
  const hToggle = (id) => {
    const t = all.find(x=>x.id===id);
    const isRep = t?.repeat && parseRepeat(t.repeat).type !== "なし";
    onToggle(id, isRep ? today : undefined);
  };

  // タイムライン定数
  const DAY_START = 6, DAY_END = 23, PPM = 0.75;
  const HH = 60 * PPM;
  const dayStartMin = DAY_START * 60;

  // タイムライン: 時刻付き / 未設定
  const timedTasks   = todayTasks.filter(t => t.startTime);
  const untimedTasks = todayTasks.filter(t => !t.startTime);

  // 簡易overlap計算
  const calcOverlap = (timed) => {
    const endCols = [];
    const res = timed.map(t => ({...t}));
    res.forEach(t => {
      const s = t2m(t.startTime)||0;
      const e = t.endTime ? t2m(t.endTime) : s+(Number(t.duration)||60);
      let col = 0;
      while (endCols[col] && endCols[col] > s) col++;
      endCols[col] = e;
      t._col = col;
    });
    res.forEach(t => {
      const s = t2m(t.startTime)||0;
      const e = t.endTime ? t2m(t.endTime) : s+(Number(t.duration)||60);
      let maxCols = 1;
      res.forEach(u => {
        const us = t2m(u.startTime)||0;
        const ue = u.endTime ? t2m(u.endTime) : us+(Number(u.duration)||60);
        if (us < e && ue > s) maxCols = Math.max(maxCols, u._col+1);
      });
      t._totalCols = maxCols;
    });
    return res;
  };
  const timedWithCols = calcOverlap(timedTasks);

  const MiniRow = ({task, showDate}) => {
    const c = tags.find(tg => task.tags?.includes(tg.id))?.color || C.accent;
    const childTag = tags.find(tg => task.tags?.includes(tg.id) && tg.parentId);
    const isOver = task.deadlineDate && task.deadlineDate < today && !task.done;
    const isDone = task.repeat && parseRepeat(task.repeat).type !== "なし"
      ? (task.doneDates||[]).includes(today)
      : task.done;
    return (
      <div style={{display:"flex",alignItems:"center",gap:7,padding:"5px 0",
        borderBottom:`1px solid ${C.border}18`,cursor:"pointer",opacity:isDone?.55:1}}
        onClick={e=>openPopup(e,task)}>
        <div onClick={e=>{e.stopPropagation();hToggle(task.id);}}
          style={{width:12,height:12,borderRadius:3,border:`2px solid ${isDone?c:C.border}`,
            background:isDone?c:"transparent",flexShrink:0,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
          {isDone && <span style={{color:"#fff",fontSize:7,fontWeight:900}}>✓</span>}
        </div>
        <span style={{fontSize:12,color:isDone?C.textMuted:C.text,
          textDecoration:isDone?"line-through":"none",
          flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{task.title}</span>
        {childTag && <span style={{fontSize:8,color:childTag.color,fontWeight:600,flexShrink:0,
          padding:"1px 5px",borderRadius:8,background:childTag.color+"18"}}>{childTag.name}</span>}
        {showDate && task.deadlineDate &&
          <span style={{fontSize:9,color:isOver?C.danger:C.warn,flexShrink:0,fontWeight:isOver?700:400}}>
            {isOver?"⚠ ":""}{fd(task.deadlineDate)}
          </span>}
        {showDate && !task.deadlineDate && task.startDate &&
          <span style={{fontSize:9,color:C.accent,flexShrink:0}}>{fd(task.startDate)}〜</span>}
      </div>
    );
  };

  const SectionHead = ({icon,title,count,color,done}) => (
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,paddingBottom:7,
      borderBottom:`2px solid ${color}44`}}>
      <span style={{fontSize:14}}>{icon}</span>
      <span style={{fontSize:12,fontWeight:800,color,fontFamily:"'Playfair Display',serif",flex:1}}>{title}</span>
      {done !== undefined
        ? <span style={{fontSize:10,color:C.textMuted,background:C.surfHov,padding:"1px 7px",borderRadius:8}}>{done}/{count}</span>
        : <span style={{fontSize:10,color:C.textMuted,background:C.surfHov,padding:"1px 7px",borderRadius:8}}>{count}</span>}
    </div>
  );

  const ProgressBar = ({value,color,height=5}) => (
    <div style={{background:C.bg,borderRadius:99,height,overflow:"hidden"}}>
      <div style={{width:`${value}%`,height:"100%",background:color,borderRadius:99,transition:"width .5s"}}/>
    </div>
  );

  const cardStyle = color => ({
    background:C.surface,borderRadius:12,padding:16,
    border:`1px solid ${color}33`,display:"flex",flexDirection:"column",
  });

  // PCタイムライン
  const PCTimeline = () => {
    const now = new Date();
    const nowMin = now.getHours()*60+now.getMinutes();
    const tlH = (DAY_END-DAY_START)*HH;
    return (
      <div style={{flex:1,overflowY:"auto",position:"relative",marginBottom:6}}>
        <div style={{position:"relative",height:tlH+HH}}>
          {Array.from({length:DAY_END-DAY_START+1},(_,i)=>DAY_START+i).map(h=>(
            <div key={h} style={{position:"absolute",top:(h-DAY_START)*HH,left:0,right:0,display:"flex",alignItems:"flex-start",pointerEvents:"none"}}>
              <span style={{fontSize:8,color:C.textMuted,width:26,flexShrink:0,lineHeight:1,marginTop:-5}}>{h}:00</span>
              <div style={{flex:1,borderTop:`1px solid ${C.border}33`}}/>
            </div>
          ))}
          {timedWithCols.map(t => {
            const s = t2m(t.startTime)||0;
            const e = t.endTime?t2m(t.endTime):s+(Number(t.duration)||60);
            const top = (s-dayStartMin)*PPM;
            const h2 = Math.max(20,(e-s)*PPM);
            const colW = `${100/t._totalCols}%`;
            const colL = `${t._col*100/t._totalCols}%`;
            const c = tags.find(tg=>t.tags?.includes(tg.id))?.color||C.accent;
            const isDone = t.repeat&&parseRepeat(t.repeat).type!=="なし"?(t.doneDates||[]).includes(today):t.done;
            return (
              <div key={t.id} onClick={e2=>openPopup(e2,t)}
                style={{position:"absolute",top:top,left:`calc(26px + ${colL})`,
                  width:`calc(${colW} - 3px)`,height:h2,
                  background:isDone?C.border+"38":c+"22",
                  borderLeft:`3px solid ${isDone?C.textMuted:c}`,
                  borderRadius:"0 5px 5px 0",overflow:"hidden",cursor:"pointer",
                  opacity:isDone?.5:1,zIndex:2,padding:"2px 4px"}}>
                <div style={{fontSize:9,color:isDone?C.textMuted:c,fontWeight:600,
                  whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                  textDecoration:isDone?"line-through":"none"}}>
                  {t.startTime}{t.endTime?`〜${t.endTime}`:""} {t.title}
                </div>
              </div>
            );
          })}
          {nowMin>=dayStartMin&&nowMin<=DAY_END*60&&(
            <div style={{position:"absolute",top:(nowMin-dayStartMin)*PPM,left:0,right:0,
              height:1.5,background:C.danger,zIndex:5,pointerEvents:"none"}}>
              <div style={{width:5,height:5,borderRadius:"50%",background:C.danger,
                position:"absolute",left:22,top:-2}}/>
            </div>
          )}
        </div>
        {untimedTasks.length>0&&(
          <div style={{marginTop:6,borderTop:`1px solid ${C.border}33`,paddingTop:5}}>
            <div style={{fontSize:8,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>時刻未設定</div>
            {untimedTasks.map(t=><MiniRow key={t.id} task={t} showDate={false}/>)}
          </div>
        )}
      </div>
    );
  };

  const PopupLayer = () => popup ? (
    <Popup
      task={popup.task} tags={tags} anchor={{x:popup.x,y:popup.y}}
      viewDate={today}
      onClose={()=>setPopup(null)}
      onEdit={t=>{onEdit(t);setPopup(null);}}
      onToggle={hToggle}
      onDelete={id=>{if(onDelete){onDelete(id);}setPopup(null);}}
      onDuplicate={t=>{if(onDuplicate){onDuplicate(t);}setPopup(null);}}
      onSkip={onSkip||((id,d)=>{})}
      onOverride={onOverride||((id,d,ov)=>{})}
      onAddSession={onAddSession}
      onRemoveSession={onRemoveSession}
      onMemoToggle={onMemoToggle||((id,idx)=>{})}
    />
  ) : null;

  if (isPC) {
    return (
      <>
      <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 3fr",gap:14,
        height:"calc(100vh - 120px)",minHeight:400}}>
        {/* 左: 今日（タイムライン） */}
        <div style={{...cardStyle(C.success),overflow:"hidden"}}>
          <SectionHead icon="📅" title="今日" count={todayTasks.length} done={todayDone} color={C.success}/>
          <div style={{marginBottom:10,flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:10,color:C.textMuted}}>今日の進捗</span>
              <span style={{fontSize:11,fontWeight:700,color:C.success}}>
                {todayTasks.length?Math.round(todayDone/todayTasks.length*100):0}%
              </span>
            </div>
            <ProgressBar value={todayTasks.length?Math.round(todayDone/todayTasks.length*100):0} color={C.success} height={6}/>
          </div>
          {todayTasks.length===0
            ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今日のタスクなし 🎉</div>
            : <PCTimeline/>}
          {tagStats.length>0&&(
            <div style={{borderTop:`1px solid ${C.border}33`,paddingTop:10,marginTop:4,flexShrink:0}}>
              <div style={{fontSize:9,color:C.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:7}}>🏷 タグ別進捗</div>
              {tagStats.map(tag=>(
                <div key={tag.id} style={{marginBottom:7}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}>
                    <span style={{color:tag.color,fontWeight:700}}>{tag.name}</span>
                    <span style={{color:C.textMuted}}>{tag.pct}%</span>
                  </div>
                  <ProgressBar value={tag.pct} color={tag.color} height={4}/>
                </div>
              ))}
            </div>
          )}
          <div style={{borderTop:`1px solid ${C.border}33`,paddingTop:10,marginTop:4,flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <span style={{fontSize:10,color:C.textMuted}}>📊 全体進捗</span>
              <span style={{fontSize:13,fontWeight:800,color:C.accent,fontFamily:"'Playfair Display',serif"}}>
                {pct}<span style={{fontSize:10}}>%</span>
              </span>
            </div>
            <ProgressBar value={pct} color={C.accent} height={5}/>
            <div style={{fontSize:9,color:C.textMuted,marginTop:3}}>{doneCnt} / {totalCnt} 完了</div>
          </div>
        </div>
        {/* 中: 今後7日 */}
        <div style={{...cardStyle(C.warn),overflow:"hidden"}}>
          <SectionHead icon="📆" title="今後7日間" count={week7.length} color={C.warn}/>
          {overdue.length>0&&(
            <div style={{background:C.dangerS,borderRadius:7,padding:"6px 9px",marginBottom:10,border:`1px solid ${C.danger}33`,flexShrink:0}}>
              <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:4}}>⚠ 期限超過 ({overdue.length})</div>
              {overdue.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
            </div>
          )}
          <div style={{flex:1,overflowY:"auto"}}>
            {upcoming.length===0&&startingIn7.length===0&&overdue.length===0
              ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今後7日の予定なし 🎉</div>
              : <>{upcoming.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
                  {startingIn7.length>0&&(<div style={{marginTop:8}}>
                    <div style={{fontSize:9,color:C.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:5}}>開始予定</div>
                    {startingIn7.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
                  </div>)}</>}
          </div>
        </div>
        {/* 右: あとでやる */}
        <div style={{...cardStyle(C.warn),overflow:"hidden"}}>
          <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.warn}/>
          <div style={{flex:1,overflowY:"auto"}}>
            {laterTasks.length===0
              ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>あとでやるなし</div>
              : laterTasks.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
          </div>
        </div>
      </div>
      <PopupLayer/>
      </>
    );
  }

  // スマホ: リスト表示
  return (
    <>
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={cardStyle(C.accent)}>
        <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
          <span style={{fontSize:28,fontWeight:800,color:C.accent,fontFamily:"'Playfair Display',serif",lineHeight:1}}>
            {pct}<span style={{fontSize:14}}>%</span>
          </span>
          <span style={{fontSize:10,color:C.textMuted}}>{doneCnt} / {totalCnt} タスク完了</span>
        </div>
        <ProgressBar value={pct} color={C.accent} height={6}/>
      </div>
      <div style={cardStyle(C.success)}>
        <SectionHead icon="📅" title="今日" count={todayTasks.length} done={todayDone} color={C.success}/>
        {todayTasks.length===0
          ? <div style={{fontSize:11,color:C.textMuted}}>今日のタスクなし 🎉</div>
          : todayTasks.map(t=><MiniRow key={t.id} task={t} showDate={false}/>)}
      </div>
      <div style={cardStyle(C.warn)}>
        <SectionHead icon="📆" title="今後7日間" count={week7.length} color={C.warn}/>
        {overdue.length>0&&(
          <div style={{background:C.dangerS,borderRadius:7,padding:"6px 9px",marginBottom:8,border:`1px solid ${C.danger}33`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:4}}>⚠ 期限超過 ({overdue.length})</div>
            {overdue.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
          </div>
        )}
        {upcoming.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
        {startingIn7.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
        {week7.length===0&&<div style={{fontSize:11,color:C.textMuted}}>今後7日の予定なし 🎉</div>}
      </div>
      <div style={cardStyle(C.warn)}>
        <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.warn}/>
        {laterTasks.length===0
          ? <div style={{fontSize:11,color:C.textMuted}}>あとでやるなし</div>
          : laterTasks.map(t=><MiniRow key={t.id} task={t} showDate={true}/>)}
      </div>
      {tagStats.length>0&&(
        <div style={cardStyle(C.accent)}>
          <SectionHead icon="🏷" title="タグ別進捗" count={tagStats.length} color={C.accent}/>
          {tagStats.map(tag=>(
            <div key={tag.id} style={{marginBottom:9}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                <span style={{color:tag.color,fontWeight:700}}>{tag.name}</span>
                <span style={{color:C.textMuted,fontSize:10}}>{tag.pct}% ({tag.done}/{tag.total})</span>
              </div>
              <ProgressBar value={tag.pct} color={tag.color} height={5}/>
            </div>
          ))}
        </div>
      )}
    </div>
    <PopupLayer/>
    </>
  );
};
