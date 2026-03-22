import { useState } from "react";
import { C } from "../constants";
import { flatten, localDate, parseRepeat } from "../utils";

export const ReportView = ({tasks, tags}) => {
  const [period, setPeriod] = useState("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]   = useState("");
  const [chartType, setChartType] = useState("bar");

  const today = localDate();
  const all = flatten(tasks);

  const getRange = () => {
    const now = new Date(today);
    if (period === "custom") return { from: customFrom || today, to: customTo || today };
    const from = new Date(now);
    if (period === "week")   from.setDate(now.getDate() - 6);
    if (period === "month")  from.setMonth(now.getMonth() - 1);
    if (period === "3month") from.setMonth(now.getMonth() - 3);
    if (period === "year")   from.setFullYear(now.getFullYear() - 1);
    return { from: localDate(from), to: today };
  };

  const { from, to } = getRange();

  const doneTasks = all.filter(t => {
    if (!t.done) return false;
    if (t.repeat && parseRepeat(t.repeat).type !== "なし") {
      return (t.doneDates||[]).some(d => d >= from && d <= to);
    }
    const ref = t.deadlineDate || t.startDate || "";
    return ref >= from && ref <= to;
  });

  const tagStats = tags.filter(t => t.parentId).map(tag => {
    const cnt = doneTasks.filter(t => t.tags?.includes(tag.id)).length;
    return { tag, cnt };
  }).filter(s => s.cnt > 0).sort((a,b) => b.cnt - a.cnt);

  const dayMap = {};
  doneTasks.forEach(t => {
    const d = t.deadlineDate || t.startDate || "";
    if (d >= from && d <= to) dayMap[d] = (dayMap[d]||0) + 1;
  });

  const days = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    days.push(localDate(new Date(cur)));
    cur.setDate(cur.getDate() + 1);
  }

  const maxDay = Math.max(1, ...days.map(d => dayMap[d]||0));
  const totalDone = doneTasks.length;
  const totalAll  = all.filter(t => !t.repeat || parseRepeat(t.repeat).type === "なし").length;
  const doneRate  = totalAll > 0 ? Math.round(totalDone / totalAll * 100) : 0;
  const labelStep = days.length <= 14 ? 1 : days.length <= 31 ? 3 : days.length <= 90 ? 7 : 14;

  const PERIODS = [
    { id:"week",   label:"1週間" },
    { id:"month",  label:"1ヶ月" },
    { id:"3month", label:"3ヶ月" },
    { id:"year",   label:"1年" },
    { id:"custom", label:"カスタム" },
  ];

  const barW = Math.max(4, Math.min(28, Math.floor(560 / days.length) - 2));
  const graphH = 120;

  return (
    <div style={{paddingBottom:24}}>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {PERIODS.map(p => (
          <button key={p.id} onClick={()=>setPeriod(p.id)}
            style={{padding:"4px 12px",borderRadius:14,fontSize:10,fontWeight:period===p.id?700:400,
              border:`1px solid ${period===p.id?C.accent:C.border}`,
              background:period===p.id?C.accentS:"transparent",
              color:period===p.id?C.accent:C.textMuted,cursor:"pointer"}}>
            {p.label}
          </button>
        ))}
        {period==="custom" && (
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
              style={{background:C.surface,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 7px",fontSize:10}}/>
            <span style={{color:C.textMuted,fontSize:10}}>〜</span>
            <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
              style={{background:C.surface,color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"3px 7px",fontSize:10}}/>
          </div>
        )}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
        {[
          { label:"完了タスク数", value:totalDone, color:C.success, icon:"✓" },
          { label:"完了率", value:`${doneRate}%`, color:C.accent, icon:"📊" },
          { label:"集計期間", value:`${days.length}日`, color:C.warn, icon:"📅" },
        ].map(s => (
          <div key={s.label} style={{background:C.surface,borderRadius:10,padding:"10px 12px",border:`1px solid ${C.border}`,textAlign:"center"}}>
            <div style={{fontSize:16,marginBottom:3}}>{s.icon}</div>
            <div style={{fontSize:20,fontWeight:800,color:s.color,fontFamily:"'Playfair Display',serif"}}>{s.value}</div>
            <div style={{fontSize:9,color:C.textMuted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{background:C.surface,borderRadius:10,padding:"14px 12px",marginBottom:14,border:`1px solid ${C.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:10,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:.5}}>📈 日別完了数</span>
          <div style={{display:"flex",gap:4}}>
            {["bar","line"].map(ct=>(
              <button key={ct} onClick={()=>setChartType(ct)}
                style={{padding:"2px 8px",borderRadius:10,fontSize:9,
                  border:`1px solid ${chartType===ct?C.accent:C.border}`,
                  background:chartType===ct?C.accentS:"transparent",
                  color:chartType===ct?C.accent:C.textMuted,cursor:"pointer"}}>
                {ct==="bar"?"棒":"折れ線"}
              </button>
            ))}
          </div>
        </div>
        <div style={{overflowX:"auto"}}>
          <svg width={Math.max(560, days.length*(barW+2)+40)} height={graphH+40} style={{display:"block"}}>
            {[0,0.25,0.5,0.75,1].map(r=>(
              <line key={r} x1={30} y1={graphH*r+4} x2={days.length*(barW+2)+34} y2={graphH*r+4}
                stroke={C.border} strokeWidth={0.5} strokeDasharray="3,3"/>
            ))}
            {[0,0.5,1].map(r=>(
              <text key={r} x={26} y={graphH*r+8} textAnchor="end" fill={C.textMuted} fontSize={8}>
                {Math.round(maxDay*(1-r))}
              </text>
            ))}
            {chartType==="bar" ? (
              days.map((d,i)=>{
                const v = dayMap[d]||0;
                const bh = v/maxDay*graphH;
                return (
                  <g key={d}>
                    <rect x={32+i*(barW+2)} y={graphH-bh+4} width={barW} height={bh}
                      fill={C.accent} opacity={0.75} rx={2}/>
                    {v>0 && <text x={32+i*(barW+2)+barW/2} y={graphH-bh+1} textAnchor="middle" fill={C.accent} fontSize={8}>{v}</text>}
                  </g>
                );
              })
            ) : (
              <g>
                <polyline
                  points={days.map((d,i)=>`${32+i*(barW+2)+barW/2},${graphH-(dayMap[d]||0)/maxDay*graphH+4}`).join(" ")}
                  fill="none" stroke={C.accent} strokeWidth={2} strokeLinejoin="round"/>
                {days.map((d,i)=>{
                  const v=dayMap[d]||0;
                  return v>0?(
                    <circle key={d} cx={32+i*(barW+2)+barW/2} cy={graphH-v/maxDay*graphH+4} r={3} fill={C.accent}/>
                  ):null;
                })}
              </g>
            )}
            {days.map((d,i)=> i%labelStep===0 ? (
              <text key={d} x={32+i*(barW+2)+barW/2} y={graphH+18} textAnchor="middle" fill={C.textMuted} fontSize={8}>
                {d.slice(5).replace("-","/")}
              </text>
            ):null)}
          </svg>
        </div>
      </div>

      {tagStats.length > 0 && (
        <div style={{background:C.surface,borderRadius:10,padding:"14px 12px",marginBottom:14,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>🏷 タグ別完了数</div>
          {tagStats.map(({tag,cnt})=>(
            <div key={tag.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <div style={{width:7,height:7,borderRadius:2,background:tag.color,flexShrink:0}}/>
              <span style={{fontSize:10,color:C.textSub,minWidth:80}}>{tag.name}</span>
              <div style={{flex:1,background:C.bgSub,borderRadius:4,height:8,overflow:"hidden"}}>
                <div style={{width:`${cnt/tagStats[0].cnt*100}%`,height:"100%",background:tag.color,borderRadius:4,transition:"width .3s"}}/>
              </div>
              <span style={{fontSize:10,fontWeight:700,color:tag.color,minWidth:24,textAlign:"right"}}>{cnt}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{background:C.surface,borderRadius:10,padding:"14px 12px",border:`1px solid ${C.border}`}}>
        <div style={{fontSize:10,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>📝 期間サマリー</div>
        <div style={{fontSize:11,color:C.textSub,lineHeight:1.8}}>
          <div>📅 対象期間：<span style={{color:C.text,fontWeight:600}}>{from} 〜 {to}（{days.length}日間）</span></div>
          <div>✓ 完了タスク：<span style={{color:C.success,fontWeight:700}}>{totalDone}件</span></div>
          <div>📊 完了率：<span style={{color:C.accent,fontWeight:700}}>{doneRate}%</span>（全{totalAll}件中）</div>
          {tagStats.length>0 && (
            <div>🏆 最多タグ：<span style={{color:tagStats[0].tag.color,fontWeight:700}}>{tagStats[0].tag.name}</span>（{tagStats[0].cnt}件）</div>
          )}
          {days.length>0 && totalDone>0 && (
            <div>⚡ 1日平均：<span style={{color:C.warn,fontWeight:700}}>{(totalDone/days.length).toFixed(1)}件/日</span></div>
          )}
          {totalDone===0 && (
            <div style={{color:C.textMuted,marginTop:4}}>この期間に完了したタスクはありません。</div>
          )}
        </div>
      </div>
    </div>
  );
};
