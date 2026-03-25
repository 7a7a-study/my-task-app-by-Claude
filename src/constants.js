// ── カラーパレット ──────────────────────────────────────────────────
export const C = {
  bg:"#23272e", bgSub:"#2a2f38", surface:"#313843", surfHov:"#3a4250",
  border:"#4a5260",
  accent:"#8bb8d4", accentS:"rgba(139,184,212,.15)", accentG:"rgba(139,184,212,.3)",
  success:"#7aaa82", successS:"rgba(122,170,130,.18)",
  warn:"#c8a96e",   warnS:"rgba(200,169,110,.18)",
  danger:"#c47878", dangerS:"rgba(196,120,120,.18)",
  info:"#b8c4b0",   infoS:"rgba(184,196,176,.15)",
  text:"#e8e0d0", textSub:"#c4b89a", textMuted:"#8a8070",
};

export const TAG_PRESETS = [
  {id:"t1",name:"仕事",  color:"#8bb8d4",parentId:null},
  {id:"t2",name:"個人",  color:"#7aaa82",parentId:null},
  {id:"t3",name:"緊急",  color:"#c47878",parentId:null},
  {id:"t4",name:"学習",  color:"#c8a96e",parentId:null},
  {id:"t5",name:"健康",  color:"#b8c4b0",parentId:null},
];

export const REPEAT_TYPES = ["なし","毎日","平日のみ","毎週","毎月","月末","月末平日","毎年","カスタム"];
export const DAYS_JP = ["月","火","水","木","金","土","日"];
export const ALLOWED = ["w1HtaWxdSnMCV1miEm3yNF7g08J2","mszdWzOojoURpcIQdYdA3FRpQiG2"];
export const SORTS   = ["デフォルト","開始日順","締切日順","タググループ順","完了を最後に"];

// タッチデバイス判定：hover:hover AND pointer:fine = PC確定
export const IS_TOUCH = typeof window !== "undefined" &&
  !window.matchMedia("(hover:hover) and (pointer:fine)").matches &&
  (window.matchMedia("(pointer:coarse)").matches || "ontouchstart" in window);

// グローバルCSS
export const G = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Playfair+Display:wght@600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#23272e;color:#e8e0d0;font-family:'Noto Sans JP',sans-serif;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#5a6070;border-radius:4px}
input,textarea,select{font-family:'Noto Sans JP',sans-serif;outline:none;border:none;color:#e8e0d0}
input[type=date],input[type=time],input[type=number],input[type=color]{color-scheme:light dark}
button{cursor:pointer;font-family:'Noto Sans JP',sans-serif;border:none;outline:none}
.hov:hover{background:rgba(139,184,212,0.08)!important}
.nb:hover{background:#3a4250!important}
.acc:hover{filter:brightness(1.1);box-shadow:0 4px 14px rgba(139,184,212,.3)}.acc:active{transform:scale(.97)}
.mo{animation:fi .13s ease}.mc{animation:su .18s cubic-bezier(.34,1.56,.64,1)}
.drag{cursor:grab!important}.drag:active{cursor:grabbing!important;opacity:.5!important}
.rh{cursor:ns-resize!important}
.ew{cursor:ew-resize!important}
.tr .ta{display:none!important}
.swipe-actions{display:none!important}
@media(hover:hover) and (pointer:fine){.tr:hover .ta{display:flex!important}.swipe-actions{display:none!important}}
@media not all and (hover:hover) and (pointer:fine){.tr .ta{display:none!important}.swipe-actions{display:flex!important}}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(8px) scale(.97);opacity:0}to{transform:none;opacity:1}}
@media(min-width:768px){body{font-size:14px}}
`;
