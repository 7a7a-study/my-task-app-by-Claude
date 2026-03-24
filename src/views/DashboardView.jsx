import { useState, useEffect } from "react";
import { C } from "../constants";
import { flatten, fd, sameDay, parseRepeat, matchesRepeat, isLaterTask, localDate } from "../utils";

export const DashboardView = ({tasks,tags,today,onToggle,onEdit}) => {
  const [isPC, setIsPC] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const fn = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const all = flatten(tasks);
  const nonRep = all.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし");

  // 今日のタスク
  const todayTasks = all.filter(t => {
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") return matchesRepeat(t, today);
    return sameDay(t.startDate, today) || sameDay(t.deadlineDate, today);
  }).filter(t => !(t.isLater || isLaterTask(t)));
  const todayDone = todayTasks.filter(t => t.done).length;

  // 今後7日
  const in7 = (() => { const d = new Date(today); d.setDate(d.getDate() + 7); return localDate(d); })();
  const overdue  = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate < today)
                         .sort((a,b) => a.deadlineDate.localeCompare(b.deadlineDate));
  const upcoming = nonRep.filter(t => t.deadlineDate && !t.done && t.deadlineDate >= today && t.deadlineDate <= in7)
                         .sort((a,b) => a.deadlineDate.localeCompare(b.deadlineDate));
  const startingIn7 = nonRep.filter(t =>
    t.startDate && t.startDate > today && t.startDate <= in7 && !t.done && !t.deadlineDate
  ).sort((a,b) => a.startDate.localeCompare(b.startDate));
  const week7 = [...overdue, ...upcoming, ...startingIn7];

  // あとでやる
  const laterTasks = all.filter(t => (t.isLater || isLaterTask(t)) && !t.done);

  // タグ別進捗
  const tagStats = tags.filter(t => !t.parentId && !t.archived).map(tag => {
    const tt = nonRep.filter(t => t.tags?.includes(tag.id));
    const td = tt.filter(t => t.done).length;
    return {...tag, total: tt.length, done: td, pct: tt.length ? Math.round(td / tt.length * 100) : 0};
  }).filter(t => t.total > 0);

  // 全体進捗
  const doneCnt  = nonRep.filter(t => t.done).length;
  const totalCnt = nonRep.length;
  const pct = totalCnt > 0 ? Math.round(doneCnt / totalCnt * 100) : 0;

  const MiniRow = ({task, showDate}) => {
    const c = tags.find(tg => task.tags?.includes(tg.id))?.color || C.accent;
    const isOver = task.deadlineDate && task.deadlineDate < today && !task.done;
    return (
      <div style={{display:"flex",alignItems:"center",gap:7,padding:"5px 0",
        borderBottom:`1px solid ${C.border}18`,cursor:"pointer"}}
        onClick={() => onEdit(task)}>
        <div onClick={e => {e.stopPropagation(); onToggle(task.id);}}
          style={{width:12,height:12,borderRadius:3,border:`2px solid ${task.done ? c : C.border}`,
            background:task.done ? c : "transparent",flexShrink:0,cursor:"pointer"}}/>
        <span style={{fontSize:12,color:task.done ? C.textMuted : C.text,
          textDecoration:task.done ? "line-through" : "none",
          flex:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{task.title}</span>
        {showDate && task.deadlineDate &&
          <span style={{fontSize:9,color:isOver ? C.danger : C.warn,flexShrink:0,fontWeight:isOver?700:400}}>
            {isOver ? "⚠ " : ""}{fd(task.deadlineDate)}
          </span>}
        {showDate && !task.deadlineDate && task.startDate &&
          <span style={{fontSize:9,color:C.accent,flexShrink:0}}>{fd(task.startDate)}〜</span>}
        <div style={{width:6,height:6,borderRadius:"50%",background:c,flexShrink:0}}/>
      </div>
    );
  };

  const SectionHead = ({icon, title, count, color, done}) => (
    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,paddingBottom:7,
      borderBottom:`2px solid ${color}44`}}>
      <span style={{fontSize:14}}>{icon}</span>
      <span style={{fontSize:12,fontWeight:800,color,fontFamily:"'Playfair Display',serif",flex:1}}>{title}</span>
      {done !== undefined
        ? <span style={{fontSize:10,color:C.textMuted,background:C.surfHov,padding:"1px 7px",borderRadius:8}}>{done}/{count}</span>
        : <span style={{fontSize:10,color:C.textMuted,background:C.surfHov,padding:"1px 7px",borderRadius:8}}>{count}</span>}
    </div>
  );

  const ProgressBar = ({value, color, height=5}) => (
    <div style={{background:C.bg,borderRadius:99,height,overflow:"hidden"}}>
      <div style={{width:`${value}%`,height:"100%",background:color,borderRadius:99,transition:"width .5s"}}/>
    </div>
  );

  const cardStyle = (color) => ({
    background:C.surface, borderRadius:12, padding:16,
    border:`1px solid ${color}33`, display:"flex", flexDirection:"column",
  });

  // ── PC レイアウト（3ペイン: 今日2fr | 今後7日2fr | あとでやる3fr）──
  if (isPC) {
    return (
      <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 3fr",gap:14,
        height:"calc(100vh - 120px)",minHeight:400}}>

        {/* 左: 今日 */}
        <div style={{...cardStyle(C.success),overflow:"hidden"}}>
          <SectionHead icon="📅" title="今日" count={todayTasks.length} done={todayDone} color={C.success}/>
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:10,color:C.textMuted}}>今日の進捗</span>
              <span style={{fontSize:11,fontWeight:700,color:C.success}}>
                {todayTasks.length ? Math.round(todayDone/todayTasks.length*100) : 0}%
              </span>
            </div>
            <ProgressBar value={todayTasks.length ? Math.round(todayDone/todayTasks.length*100) : 0} color={C.success} height={6}/>
          </div>
          <div style={{flex:1,overflowY:"auto",marginBottom:12}}>
            {todayTasks.length === 0
              ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今日のタスクなし 🎉</div>
              : todayTasks.map(t => <MiniRow key={t.id} task={t} showDate={false}/>)}
          </div>
          {tagStats.length > 0 && (
            <div style={{borderTop:`1px solid ${C.border}33`,paddingTop:10}}>
              <div style={{fontSize:9,color:C.textMuted,fontWeight:700,textTransform:"uppercase",
                letterSpacing:.5,marginBottom:7}}>🏷 タグ別進捗</div>
              {tagStats.map(tag => (
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
          <div style={{borderTop:`1px solid ${C.border}33`,paddingTop:10,marginTop:4}}>
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
          {overdue.length > 0 && (
            <div style={{background:C.dangerS,borderRadius:7,padding:"6px 9px",marginBottom:10,
              border:`1px solid ${C.danger}33`}}>
              <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:4}}>
                ⚠ 期限超過 ({overdue.length})
              </div>
              {overdue.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
            </div>
          )}
          <div style={{flex:1,overflowY:"auto"}}>
            {upcoming.length === 0 && startingIn7.length === 0 && overdue.length === 0
              ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>今後7日の予定なし 🎉</div>
              : <>
                  {upcoming.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
                  {startingIn7.length > 0 && (
                    <div style={{marginTop:8}}>
                      <div style={{fontSize:9,color:C.textMuted,fontWeight:700,
                        textTransform:"uppercase",letterSpacing:.5,marginBottom:5}}>開始予定</div>
                      {startingIn7.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
                    </div>
                  )}
                </>}
          </div>
        </div>

        {/* 右: あとでやる（広め） */}
        <div style={{...cardStyle(C.warn),overflow:"hidden"}}>
          <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.warn}/>
          <div style={{flex:1,overflowY:"auto"}}>
            {laterTasks.length === 0
              ? <div style={{textAlign:"center",padding:"32px 0",color:C.textMuted,fontSize:12}}>あとでやるなし</div>
              : laterTasks.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
          </div>
        </div>
      </div>
    );
  }

  // ── スマホ レイアウト（縦積み）──
  return (
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
        {todayTasks.length === 0
          ? <div style={{fontSize:11,color:C.textMuted}}>今日のタスクなし 🎉</div>
          : todayTasks.map(t => <MiniRow key={t.id} task={t} showDate={false}/>)}
      </div>
      <div style={cardStyle(C.warn)}>
        <SectionHead icon="📆" title="今後7日間" count={week7.length} color={C.warn}/>
        {overdue.length > 0 && (
          <div style={{background:C.dangerS,borderRadius:7,padding:"6px 9px",marginBottom:8,
            border:`1px solid ${C.danger}33`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.danger,marginBottom:4}}>⚠ 期限超過 ({overdue.length})</div>
            {overdue.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
          </div>
        )}
        {upcoming.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
        {startingIn7.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
        {week7.length === 0 && <div style={{fontSize:11,color:C.textMuted}}>今後7日の予定なし 🎉</div>}
      </div>
      <div style={cardStyle(C.warn)}>
        <SectionHead icon="📌" title="あとでやる" count={laterTasks.length} color={C.warn}/>
        {laterTasks.length === 0
          ? <div style={{fontSize:11,color:C.textMuted}}>あとでやるなし</div>
          : laterTasks.map(t => <MiniRow key={t.id} task={t} showDate={true}/>)}
      </div>
      {tagStats.length > 0 && (
        <div style={cardStyle(C.accent)}>
          <SectionHead icon="🏷" title="タグ別進捗" count={tagStats.length} color={C.accent}/>
          {tagStats.map(tag => (
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
  );
};
