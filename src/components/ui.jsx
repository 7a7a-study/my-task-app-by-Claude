import { useState } from "react";
import { C } from "../constants";
import { requestNotificationPermission, sendTestNotification } from "../notifications";

export const CB = ({checked,onChange,size=14,color}) => (
  <div onClick={e=>{e.stopPropagation();onChange();}}
    style={{width:size,height:size,borderRadius:Math.max(3,size*.22),border:`2px solid ${checked?(color||C.accent):C.border}`,background:checked?(color||C.accent):"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all .15s"}}>
    {checked && <span style={{color:"#fff",fontSize:size*.58,fontWeight:800,lineHeight:1}}>✓</span>}
  </div>
);

export const Btn = ({children,onClick,v="ghost",style={},disabled,title}) => {
  const vs = {
    ghost:  {bg:"transparent",col:C.textSub,brd:`1px solid ${C.border}`,sh:"none"},
    accent: {bg:`linear-gradient(135deg,${C.accent},${C.info})`,col:"#1a1e28",brd:"none",sh:"0 2px 10px rgba(139,184,212,.25)"},
    danger: {bg:C.dangerS,col:C.danger,brd:`1px solid ${C.danger}44`,sh:"none"},
    success:{bg:C.successS,col:C.success,brd:`1px solid ${C.success}44`,sh:"none"},
    subtle: {bg:C.surfHov,col:C.textSub,brd:`1px solid ${C.border}`,sh:"none"},
  };
  const s = vs[v];
  return (
    <button className={v==="accent"?"acc":""} onClick={onClick} disabled={disabled} title={title}
      style={{padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:600,transition:"all .15s",opacity:disabled?.4:1,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,background:s.bg,color:s.col,border:s.brd,boxShadow:s.sh,...style}}>
      {children}
    </button>
  );
};

export const Modal = ({title,children,onClose,wide,noBackdropClose}) => (
  <div className="mo" onClick={noBackdropClose ? undefined : onClose} style={{position:"fixed",inset:0,background:"rgba(5,7,18,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:10,backdropFilter:"blur(5px)"}}>
    <div className="mc" onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:13,width:"100%",maxWidth:wide?700:490,border:`1px solid ${C.border}`,maxHeight:"92vh",overflow:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.7)"}}>
      <div style={{padding:"11px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:C.surface,zIndex:1,borderRadius:"13px 13px 0 0"}}>
        <span style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:14}}>{title}</span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {noBackdropClose && <span style={{fontSize:8,color:C.textMuted}}>Esc でキャンセル / Ctrl+Enter で保存</span>}
          <button onClick={onClose} style={{background:C.surfHov,color:C.textSub,border:"none",borderRadius:6,width:24,height:24,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>
      <div style={{padding:"13px 16px"}}>{children}</div>
    </div>
  </div>
);

export const Inp = ({label,value,onChange,type="text",placeholder=""}) => (
  <div style={{marginBottom:7}}>
    {label && <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>{label}</div>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:C.bgSub,color:C.text,padding:"6px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,transition:"border .15s"}}
      onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
  </div>
);

export const Sel = ({label,value,onChange,options}) => (
  <div style={{marginBottom:7}}>
    {label && <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:C.bgSub,color:C.text,padding:"6px 9px",borderRadius:6,border:`1px solid ${C.border}`,fontSize:12}}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

export const Pill = ({tag}) => (
  <span style={{display:"inline-flex",alignItems:"center",padding:"1px 5px",borderRadius:8,fontSize:9,fontWeight:700,color:tag.color,background:tag.color+"1c",border:`1px solid ${tag.color}44`,whiteSpace:"nowrap"}}>{tag.name}</span>
);

export const ConfirmDialog = ({title, message, confirmLabel="削除", onConfirm, onCancel, danger=true}) => (
  <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(5,7,18,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:16,backdropFilter:"blur(5px)"}}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:12,padding:20,width:"100%",maxWidth:320,border:`1px solid ${danger?C.danger+"55":C.border}`,boxShadow:"0 24px 64px rgba(0,0,0,.7)"}}>
      <div style={{fontWeight:700,fontSize:14,marginBottom:8,color:danger?C.danger:C.text}}>{title}</div>
      <div style={{fontSize:12,color:C.textSub,marginBottom:18,lineHeight:1.5}}>{message}</div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn onClick={onCancel} style={{padding:"6px 16px"}}>キャンセル</Btn>
        <Btn v={danger?"danger":"accent"} onClick={onConfirm} style={{padding:"6px 16px"}}>{confirmLabel}</Btn>
      </div>
    </div>
  </div>
);

export const Login = ({onLogin,loading}) => (
  <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",backgroundImage:"radial-gradient(ellipse at 30% 20%, rgba(139,184,212,.07) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(122,170,130,.05) 0%, transparent 60%)"}}>
    <div style={{textAlign:"center",padding:36}}>
      <div style={{width:140,height:140,borderRadius:28,overflow:"hidden",margin:"0 auto 22px",boxShadow:"0 8px 32px rgba(0,0,0,.5), 0 0 0 3px rgba(200,169,110,.25)"}}>
        <img src="/logo512.png" alt="Slate" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
      </div>
      <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:42,marginBottom:8}}>
        <span style={{background:`linear-gradient(135deg,${C.accent},${C.info})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"'Playfair Display',serif",letterSpacing:1}}>Slate</span>
      </div>
      <div style={{color:C.textMuted,marginBottom:28,fontSize:14,letterSpacing:"0.08em"}}>あなただけのタスク管理</div>
      <button onClick={onLogin} disabled={loading}
        style={{display:"flex",alignItems:"center",gap:9,background:"#fff",color:"#333",border:"none",borderRadius:10,padding:"10px 24px",fontSize:13,fontWeight:700,cursor:"pointer",margin:"0 auto",opacity:loading?.7:1}}>
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {loading ? "ログイン中..." : "Googleでログイン"}
      </button>
    </div>
  </div>
);

const NOTIFY_OPTIONS = [
  { value: 15,   label: "15分前" },
  { value: 30,   label: "30分前" },
  { value: 60,   label: "1時間前" },
  { value: 180,  label: "3時間前" },
  { value: 360,  label: "6時間前" },
  { value: 1440, label: "24時間前" },
];

export const NotificationModal = ({settings, onSave, onClose}) => {
  const [enabled, setEnabled]       = useState(settings?.enabled ?? false);
  const [minutes, setMinutes]       = useState(settings?.minutesBefore ?? 60);
  const [permission, setPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "default");
  const [requesting, setRequesting] = useState(false);
  const [msg, setMsg]               = useState("");

  const handleEnable = async () => {
    if (enabled) { setEnabled(false); return; }
    setRequesting(true);
    const res = await requestNotificationPermission();
    setRequesting(false);
    if (res.ok) { setEnabled(true); setPermission("granted"); setMsg("通知が有効になりました！"); }
    else { setMsg(res.reason); }
  };

  const permColor = permission === "granted" ? C.success : permission === "denied" ? C.danger : C.warn;
  const permLabel = permission === "granted" ? "許可済み" : permission === "denied" ? "ブロック中" : "未設定";

  return (
    <Modal title="🔔 通知設定" onClose={onClose}>
      <div style={{background:C.bg,borderRadius:8,padding:"9px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:C.text}}>ブラウザ通知</div>
          <div style={{fontSize:9,color:C.textMuted,marginTop:2}}>OSの通知センターに届きます</div>
        </div>
        <span style={{fontSize:10,padding:"2px 9px",borderRadius:10,background:permColor+"22",color:permColor,fontWeight:700,border:`1px solid ${permColor}44`}}>{permLabel}</span>
      </div>
      <div style={{background:C.accentS,borderRadius:7,padding:"7px 10px",marginBottom:12,fontSize:10,color:C.textSub,border:`1px solid ${C.accent}33`}}>
        📱 <strong style={{color:C.accent}}>iPhoneの方へ</strong>：Safariでこのページをホーム画面に追加すると通知が届きます<br/>
        <span style={{fontSize:9,color:C.textMuted}}>共有ボタン → ホーム画面に追加 → iOS 16.4以降が必要</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,padding:"9px 12px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:C.text}}>締切・開始の通知</div>
          <div style={{fontSize:9,color:C.textMuted,marginTop:1}}>開始時刻・締切時刻の前 / 締切日のみは朝9:00</div>
        </div>
        <button onClick={handleEnable} disabled={requesting}
          style={{width:42,height:24,borderRadius:12,border:"none",cursor:"pointer",transition:"all .2s",background:enabled?C.accent:C.border,position:"relative",opacity:requesting?.6:1}}>
          <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:enabled?21:3,transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.3)"}}/>
        </button>
      </div>
      {enabled && (
        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:3,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>開始・締切時刻ありの場合の通知タイミング</div>
          <div style={{fontSize:9,color:C.textMuted,marginBottom:6}}>※締切日のみ（時刻なし）は朝9:00に固定通知</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {NOTIFY_OPTIONS.map(o=>(
              <button key={o.value} onClick={()=>setMinutes(o.value)}
                style={{padding:"4px 10px",borderRadius:14,fontSize:10,border:`1px solid ${minutes===o.value?C.accent:C.border}`,background:minutes===o.value?C.accentS:"transparent",color:minutes===o.value?C.accent:C.textMuted,fontWeight:minutes===o.value?700:400,cursor:"pointer"}}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <div style={{fontSize:10,color:msg.includes("成功")||msg.includes("有効")?C.success:C.danger,marginBottom:8,padding:"5px 9px",background:msg.includes("成功")||msg.includes("有効")?C.successS:C.dangerS,borderRadius:6}}>{msg}</div>}
      {permission==="granted" && (
        <div style={{marginBottom:12}}>
          <Btn v="success" onClick={async ()=>{
            setMsg("送信中...");
            const ok = await sendTestNotification();
            setMsg(ok ? "✅ テスト通知を送信しました！通知が届きましたか？" : "❌ 送信失敗。ブラウザのSWが起動していない可能性があります");
          }} style={{width:"100%",padding:"8px"}}>🔔 今すぐテスト通知を送る</Btn>
          <div style={{fontSize:9,color:C.textMuted,marginTop:4,textAlign:"center"}}>※これが届かない場合はOS・ブラウザの通知設定を確認してください</div>
        </div>
      )}
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>キャンセル</Btn>
        <Btn v="accent" onClick={()=>{onSave({enabled,minutesBefore:minutes});onClose();}}>保存</Btn>
      </div>
    </Modal>
  );
};
