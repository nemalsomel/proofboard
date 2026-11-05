// @ts-nocheck
/*
 * Proofboard – alkalmazás (felület, netlista, szimuláció, ellenőrzés, útvonalkereső).
 * A tiszta, típusos részek külön modulokban: core/ (séma, kifejezések, fordító),
 * parts/ (beépített alkatrészek), engine/ (egyenletmegoldó). Ez a fájl a következő
 * lépésekben bomlik tovább engine/ és ui/ modulokra; addig típusellenőrzés nélkül fut.
 */
import './style.css';
import { evx, fmtSI, num, parseSI, stepE12, tpl } from './core/expr';
import { compileAll, compilePart, penvD } from './core/compile';
import { hasErrors, validatePartDef } from './core/validate';
import { exportLibrary, importLibrary, typeKeyFor } from './core/library';
import { History } from './ui/history';
import { ROLEC, makePainter, plugColor, rgba } from './ui/drawpart';
import { applyRotation, fromScreen as vpFrom, toScreen as vpTo } from './ui/viewport';
import { EventLog } from './ui/log';
import { favToggled, libPref, libPrefSet, libraryHtml, recentWith } from './ui/library';
import { EXAMPLES, EX_CATS } from './ui/examples';
import { editorHistory, formToDef, openEditor, restoreParked } from './ui/editor';
import { LEDC, PARTS, PICO_NAMES, picoRole } from './parts/builtin';
import { solve } from './engine/solve';
import { buildLayout, planCuts } from './engine/board';
import { pinLabelPositions } from './core/labels';
import { evalExpr, parseExpr, pinRef, varsOf } from './core/logic';
import { DEFS, syncDefs, setLibrary, penv, hasPress, isOff, isMcu } from './engine/defs';
import { matchingSocket, plugOf, pluggedInto, plugPairs, plugRedundantLinks, plugSpot, socketProps, socketType } from './engine/plug';
import { xf, xv, ixf, placedPins as gpins } from './engine/geometry';
import { analyze as analyzeNet, layoutOf, pinLabel } from './engine/netlist';
import { checkAll as checkAllOf } from './engine/check';
import { evalProgram, gpioOf, newRuntime, normProgram, withProgram } from './engine/program';
import { mountProgEditor } from './ui/progedit';
import { mountCodeView } from './ui/progcode';
import { icon, hydrateIcons } from './ui/icons';
import { LAYOUTS, LAYOUT_DEFAULTS, isLayout, parseStore, stateOf, remember as layRemember, switchTo as laySwitch, resetLayout, isCustom } from './ui/layout';
import { mountFloatWin, parseWin } from './ui/floatwin';
import { generateCode } from './engine/codegen';
import { emptyDesign, normalize, normCutList, rekeyAgainstLibrary, NOTE_COL } from './engine/design';
import { swapMcu as swapMcuOf } from './engine/swap';
import { presetMacropad, presetRouted } from './engine/presets';
import { route as routeOf, suggestCuts as suggestCutsOf, manualToAuto as manualToAutoOf, autoCutOn as autoCutOnOf } from './engine/route';
import { findPin as findPinOf, linkText as linkTextOf, linkStates as linkStatesOf, partGroups, equivPins, groupLabel, pinRows, linkTargets, setPinLink, setLinkTarget, ROLE_HU } from './engine/links';
import { simulate as simulateOf, gpioMode as gpioModeOf, pwmCfg as pwmCfgOf, gpioLevel, BLINK_HZ, LSTATE, STSTATE } from './engine/simulate';
import { hasCap, hasAdc, SPECIAL_CAPS, fnWant, fnCaps, mcuMux, capLabel, fnName, pinFns, fnPenalty, gpioPenalty, gpioFits, GPIO_MODES, gpioModeOk, gpioDefault } from './engine/mcu';

const STORE_KEY = 'proofboard.design.v1';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* ---------- Alkatrész-definíciók ---------- */
/** LED látható fényereje 0…1: a szem kb. az áram négyzetgyöke szerint érzékel, ~15 mA-nél telítve. */
const WCOL=[['#1c7ed6','kék'],['#e03131','piros'],['#212529','fekete'],['#f59f00','sárga'],['#2f9e44','zöld'],['#f1f3f5','fehér'],['#e8590c','narancs']];
/** Eszközök: azonosító, név, gyorsbillentyű, ikon, súgó. */
const TOOLS=[['select','Kijelölés','V','tSelect','Kijelölés és mozgatás; Shift+kattintás vagy keret: több elem'],['bridge','Híd','B','tBridge','Forrasztóhíd szomszédos lyukak között (húzással több is)'],['wire','Vezeték','W','tWire','Huzal két tetszőleges lyuk között'],['link','Kapcsolat','C','tLink','Két láb összekötése; az útvonalat a program keresi meg'],['cut','Csíkvágás','K','tCut','A réz megszakítása két lyuk között, vagy egy lyuk kifúrása'],['note','Jegyzet','J','tNote','Szöveges cédula a panelon'],['erase','Törlés','E','tErase','Kattintásra vagy húzással töröl'],['pan','Mozgatás','H','tHand','A nézet mozgatása (Szóköz + húzás is)']];
/** Egyszerű módban rejtett eszközök. */
const ADV_TOOLS=new Set(['cut']);
/** Szimulációban is használható eszközök. */
const SIM_TOOLS=new Set(['select','pan']);

/* ---------- Állapot ---------- */
let D, A0, AS, SIM, ISSUES=[];
const ui={stub:false,hoverWire:-1,phase:{},anim:false,tool:'select',view:'comp',zoom:1,sim:false,hover:null,sel:null,placing:null,ghost:{rot:0,mir:false},wireStart:null,drag:null,pressed:{},holdPtr:new Map(),flash:null,wireColor:'#1c7ed6',confirmClear:0,linkStart:null,hideAuto:null,rats:false,xray:false,selLink:null,linkState:new Map()};

/* ---------- Geometria ---------- */
const inb=(r,c)=>r>=0&&c>=0&&r<D.board.rows&&c<D.board.cols;
const secStart=r=>r-(r%D.board.sec);
/* Panel-elrendezés (csíkdarabok a szekciók és a csíkvágások szerint), gyorsítótárazva. */
const LAY=()=>layoutOf(D);
const autoCutOn=()=>autoCutOnOf(D);
/** A lyuk csíkdarabja: [kezdő sor, záró sor]. */
const segOf=(r,c)=>{const L=LAY(),s=L.segs[L.cell(r,c)];return s;};
const EXT=8; // ennyi lyuknyit lóghat ki egy alkatrész a panelról
const NEXT=24; // a vászon ennyi lyuknyit mutat a panel körül (jegyzeteknek, magyarázatnak)
const inCanvas=(r,c)=>r>=-EXT-0.5&&c>=-EXT-0.5&&r<=D.board.rows+EXT-0.5&&c<=D.board.cols+EXT-0.5;
const isOff=p=>DEFS[p.type].def.mount==='off';
function partFits(p){const g=gpins(p);
  if(isOff(p)){const b=DEFS[p.type].bounds(p),cs=[[b.r0,b.c0],[b.r0,b.c1],[b.r1,b.c0],[b.r1,b.c1]].map(([r,c])=>xf(p,r,c));
    return g.every(q=>!inb(q.r,q.c))&&cs.every(([r,c])=>inCanvas(r,c));}
  return g.some(q=>inb(q.r,q.c))&&g.every(q=>q.r>=-EXT&&q.c>=-EXT&&q.r<D.board.rows+EXT&&q.c<D.board.cols+EXT);}
/** Külső alkatrész kivezetése (vagy panelon kívüli láb) egy pontos helyen. */
function offPinAt(r,c){for(const p of D.parts){if(!isOff(p))continue;for(const q of gpins(p))if(q.r===r&&q.c===c)return q;}return null;}

/* ---------- Netlista ---------- */
function analyze(press){return analyzeNet(D,{pressed:press?p=>!!ui.pressed[p.id]:undefined,hidden:autoHidden});}

/* ---------- Áramkör-szimuláció: engine/simulate.ts ---------- */
/* Futás közben a program GPIO-beállításai a terv fölé kerülnek (engine/program.ts). */
const DP=()=>ui.sim&&ui.prog?withProgram(D,ui.prog.out):D;
const gpioMode=(p,id,q,A)=>gpioModeOf(DP(),p,id,q,A);
const pwmCfg=key=>pwmCfgOf(DP(),key);
function simulate(A,slow){return simulateOf(DP(),A,{running:ui.sim,slow});}
const logic=gpioLevel;

/* ---------- Ellenőrzés: engine/check.ts ---------- */
function checkAll(){return checkAllOf(DP(),{A0,AS,SIM,linkState:ui.linkState});}

/* ---------- Rajzolás ---------- */
const cv=$('#cv'),ctx=cv.getContext('2d');
let P=14,M=32,dpr=1;
const VR=()=>(D&&D.settings.vrot)|0,VA=()=>VR()*Math.PI/2;
const bw=()=>2*M+D.board.cols*P,bh=()=>2*M+D.board.rows*P;
function toScreen(x,y){return vpTo(x,y,bw(),bh(),VR());} // ui/viewport.ts
function fromScreen(x,y){return vpFrom(x,y,bw(),bh(),VR());}
function applyView(){applyRotation(ctx,bw(),bh(),VR());}
function vlabel(x,y,str,col){ctx.save();ctx.translate(x,y);ctx.rotate(-VA());ctx.fillStyle=col;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(str,0,0);ctx.restore();}const MONO='"IBM Plex Mono",ui-monospace,monospace';
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const cu=()=>ui.view==='cu';
const hx=c=>M+(cu()?D.board.cols-1-c:c)*P+P/2;
const hy=r=>M+r*P+P/2;
function L(p,lr,lc){const[r,c]=xf(p,lr,lc);return[hx(c),hy(r)];}
function poly(p,r0,r1,c0,c1){const pts=[L(p,r0,c0),L(p,r0,c1),L(p,r1,c1),L(p,r1,c0)];ctx.beginPath();ctx.moveTo(...pts[0]);for(let i=1;i<4;i++)ctx.lineTo(...pts[i]);ctx.closePath();}
function vdir(p,dr,dc){const[r,c]=xv(p,dr,dc);return[cu()?-c:c,r];}
function resize(){
  P=Math.round(14*ui.zoom);M=32+NEXT*P;dpr=window.devicePixelRatio||1;
  let W=bw(),H=bh();if(VR()&1){const t=W;W=H;H=t;}
  cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';
  // szabad vászon: a panel körül a látómező nagyjának megfelelő üres tér, így bárhová húzható
  const sc=$('#scroll'),px=Math.round(sc.clientWidth*0.35),py=Math.round(sc.clientHeight*0.35);
  if(px!==ui.padX||py!==ui.padY){const dx=px-(ui.padX||0),dy=py-(ui.padY||0);ui.padX=px;ui.padY=py;cv.style.margin=`${py}px ${px}px`;sc.scrollLeft+=dx;sc.scrollTop+=dy;}
  $('#zLbl').textContent=Math.round(ui.zoom*100)+'%';draw();
}
/** Vászonkoordinátából görgetési pozíció (a panel körüli üres tér figyelembevételével). */
const vpX=x=>x+cv.offsetLeft,vpY=y=>y+cv.offsetTop;
/** A látómező közepe vagy egy pont (kliens-koordináta) maradjon a helyén nagyítás közben. */
function zoomTo(z,cx,cy){const sc=$('#scroll'),r=sc.getBoundingClientRect();
  z=Math.max(0.25,Math.min(3,+(+z).toFixed(3)));if(cx==null){cx=r.left+sc.clientWidth/2;cy=r.top+sc.clientHeight/2;}
  const P0=P,ox=sc.scrollLeft+cx-r.left-cv.offsetLeft,oy=sc.scrollTop+cy-r.top-cv.offsetTop;
  const u=(ox-32)/P0,v=(oy-32)/P0;ui.zoom=z;resize();
  sc.scrollLeft=cv.offsetLeft+32+u*P-(cx-r.left);sc.scrollTop=cv.offsetTop+32+v*P-(cy-r.top);}
/** Az egész panel látszódjon, középen. */
function fitView(){const sc=$('#scroll'),B=D.board;let w=B.cols+2,h=B.rows+3;if(VR()&1){const t=w;w=h;h=t;}
  const z=Math.min((sc.clientWidth-40)/(w*14),(sc.clientHeight-40)/(h*14));ui.zoom=Math.max(0.25,Math.min(3,Math.floor(14*z)/14));resize();centerView();}
function centerView(){const sc=$('#scroll');sc.scrollLeft=cv.offsetLeft+cv.offsetWidth/2-sc.clientWidth/2;sc.scrollTop=cv.offsetTop+cv.offsetHeight/2-sc.clientHeight/2;}
/** Kiinduló nézet: a panel teteje, vízszintesen középen (ha szélesebb, a bal széle). */
function homeView(){const sc=$('#scroll'),W=cv.offsetWidth,m=Math.max(0,M-36);
  sc.scrollLeft=W<=sc.clientWidth?cv.offsetLeft+W/2-sc.clientWidth/2:cv.offsetLeft+m;sc.scrollTop=cv.offsetTop+m;}
function netTint(root,A){
  const qs=A.netPins.get(root)||[];
  if(ui.sim&&SIM){if(!qs.length&&(A.netSecs.get(root)||0)<2)return null;
    if(!qs.length)return null;
    if(SIM.floating.has(root))return'hsla(210,8%,62%,A)';
    const v=SIM.netV.get(root)||0;const h=v<=3.3?215-190*Math.max(0,v)/3.3:Math.max(0,25-25*(v-3.3)/1.7);return`hsla(${h},78%,50%,A)`;}
  if(!qs.length&&(A.netSecs.get(root)||0)<2)return null;
  const pq=qs.filter(q=>isMcu(q.part));
  if(pq.some(q=>q.role==='gnd'))return'hsla(210,10%,20%,A)';
  if(pq.some(q=>q.role==='p33'))return'hsla(0,75%,52%,A)';
  if(pq.some(q=>q.role==='pwr'))return'hsla(290,60%,55%,A)';
  const g=pq.find(q=>q.role==='gpio');if(g)return`hsla(${((g.num??(+String(g.name).replace(/\D/g,'')||0))*67)%360},65%,48%,A)`;
  return`hsla(${(root*137.5)%360},55%,50%,A)`;
}
/** A rajz villogtatás közben a pillanatnyi szimulációt mutatja. */
function draw(){const keep=SIM;if(ui.sim&&ui.blinkSim)SIM=ui.blinkSim;try{draw0();}finally{SIM=keep;}}
function draw0(){
  if(!D||!A0)return;
  const B=D.board,A=ui.sim?AS:A0,C=cu();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const W=bw(),H=bh();
  ctx.fillStyle=css('--stage');ctx.fillRect(0,0,Math.max(W,H),Math.max(W,H));
  ctx.save();applyView();
  // panel
  ctx.fillStyle=C?'#d7b68a':'#ead6a8';ctx.fillRect(M-4,M-4,B.cols*P+8,B.rows*P+8);
  // vonalzók
  ctx.font=`${Math.max(8,Math.min(11,P*0.55))}px ${css('--mono')}`;ctx.textBaseline='middle';
  const hv=ui.hover;
  for(let r=0;r<B.rows;r++){if(r%B.sec&&!(hv&&hv.r===r))continue;vlabel(M-14,hy(r),r,hv&&hv.r===r?css('--accent'):css('--muted'));}
  const step=P>=17?1:2;
  for(let c=0;c<B.cols;c++){if(c%step&&!(hv&&hv.c===c))continue;vlabel(hx(c),M-12,c,hv&&hv.c===c?css('--accent'):css('--muted'));}
  // szekciók
  const hoverNet=hv&&inb(hv.r,hv.c)?A.find(A.sid(hv.r,hv.c)):-1;
  const tints=new Map();
  const LY=LAY();
  for(const sg of LY.segs){if(sg.drilled)continue;const c=sg.c,s=sg.r0;
    const x=hx(c)-P*0.44,y=hy(s)-P*0.45,w=P*0.88,h=(sg.r1-sg.r0)*P+P*0.9;
    const root=A.find(A.sid(s,c));
    if(!tints.has(root))tints.set(root,netTint(root,A));
    const t=tints.get(root);
    if(C){ctx.fillStyle='#c4844f';rr(x,y,w,h,P*0.12);ctx.fill();if(t){ctx.fillStyle=t.replace('A',ui.sim?'.55':'.38');ctx.fill();}}
    else{if(t){ctx.fillStyle=t.replace('A',ui.sim?'.42':'.24');rr(x,y,w,h,P*0.12);ctx.fill();}
      ctx.strokeStyle='rgba(120,88,40,.22)';ctx.lineWidth=1;rr(x,y,w,h,P*0.12);ctx.stroke();}
    if(root===hoverNet&&ui.tool!=='cut'){ctx.strokeStyle=css('--accent');ctx.lineWidth=2;rr(x-1,y-1,w+2,h+2,P*0.14);ctx.stroke();}
  }
  // lyukak
  ctx.fillStyle=C?'#3a2414':'#4a3c24';
  for(let r=0;r<B.rows;r++)for(let c=0;c<B.cols;c++){ctx.beginPath();ctx.arc(hx(c),hy(r),P*0.16,0,7);ctx.fill();}
  // csíkvágások: rés a sorok között, kifúrt lyuk (az automatikusak szaggatottan)
  const autoK=new Set(((D.auto&&D.auto.cuts)||[]).map(x=>x.join(',')));
  for(const [r,c,k] of LY.cuts){const au=autoK.has([r,c,k].join(','));ctx.save();
    if(k){ctx.fillStyle=C?'#d7b68a':'#ead6a8';ctx.beginPath();ctx.arc(hx(c),hy(r),P*0.4,0,7);ctx.fill();ctx.strokeStyle=C?'#7a4a22':'#b0473a';ctx.lineWidth=1.6;if(au)ctx.setLineDash([3,2]);ctx.stroke();
      ctx.fillStyle=C?'#3a2414':'#4a3c24';ctx.beginPath();ctx.arc(hx(c),hy(r),P*0.2,0,7);ctx.fill();}
    else{const y=(hy(r)+hy(r+1))/2,x0=hx(c)-P*0.5,x1=hx(c)+P*0.5;if(C){ctx.fillStyle='#d7b68a';ctx.fillRect(x0,y-P*0.09,x1-x0,P*0.18);}
      ctx.strokeStyle=C?'#7a4a22':'#b0473a';ctx.lineWidth=Math.max(1.5,P*0.1);if(au)ctx.setLineDash([3,2]);ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x1,y);ctx.stroke();}
    ctx.restore();}
  if(ui.tool==='cut'&&hv&&inb(hv.r,hv.c)&&!ui.sim){const ct=cutAt(hv);ctx.save();ctx.strokeStyle=css('--accent');ctx.lineWidth=2;ctx.setLineDash([4,3]);
    if(ct[2]){ctx.beginPath();ctx.arc(hx(ct[1]),hy(ct[0]),P*0.42,0,7);ctx.stroke();}else{const y=(hy(ct[0])+hy(ct[0]+1))/2;ctx.beginPath();ctx.moveTo(hx(ct[1])-P*0.55,y);ctx.lineTo(hx(ct[1])+P*0.55,y);ctx.stroke();}ctx.restore();}
  // hidak
  D.bridges.forEach((b,i)=>{const x1=hx(b[1]),y1=hy(b[0]),x2=hx(b[3]),y2=hy(b[2]);const sel=ui.sel&&((ui.sel.kind==='bridge'&&ui.sel.i===i)||(isGroup()&&ui.sel.bridges.has(i)));
    ctx.lineCap='round';
    if(C){ctx.strokeStyle=sel?css('--accent'):'#a9aeb4';ctx.lineWidth=P*0.58;line(x1,y1,x2,y2);ctx.strokeStyle='#dde1e5';ctx.lineWidth=P*0.2;line(x1,y1,x2,y2);}
    else{ctx.setLineDash([P*0.18,P*0.14]);ctx.strokeStyle=sel?css('--accent'):'rgba(105,112,120,.8)';ctx.lineWidth=P*0.13;line(x1,y1,x2,y2);ctx.setLineDash([]);}
  });
  for(const b of D.auto.bridges){if(autoHidden(b[4]))continue;ctx.save();if(ui.rats)ctx.globalAlpha=0.3;const x1=hx(b[1]),y1=hy(b[0]),x2=hx(b[3]),y2=hy(b[2]);ctx.lineCap='round';
    if(C){ctx.strokeStyle='#8fa9c2';ctx.lineWidth=P*0.58;line(x1,y1,x2,y2);ctx.strokeStyle='#d7e6f4';ctx.lineWidth=P*0.2;line(x1,y1,x2,y2);}
    else{ctx.setLineDash([P*0.18,P*0.14]);ctx.strokeStyle='rgba(56,120,190,.9)';ctx.lineWidth=P*0.15;line(x1,y1,x2,y2);ctx.setLineDash([]);}ctx.restore();}
  // forrpontok rézoldalon
  if(C){for(const q of A.pins){if(!q.on)continue;ctx.fillStyle='#b8bdc3';ctx.beginPath();ctx.arc(hx(q.c),hy(q.r),P*0.36,0,7);ctx.fill();ctx.fillStyle='#e6e9ec';ctx.beginPath();ctx.arc(hx(q.c)-P*0.08,hy(q.r)-P*0.08,P*0.12,0,7);ctx.fill();}}
  // vezetékek (alatta a rézoldali nézetben)
  if(C){drawWires(0.28);drawPlugs(0.28);}
  // alkatrészek (ui/drawpart.ts)
  const PNT=makePainter({ctx,P,M,cols:B.cols,cu:C,angle:VA(),xray:!!ui.xray,accent:css('--accent'),mono:MONO,design:D,sim:ui.sim?SIM:null,pressed:id=>!!ui.pressed[id],phase:id=>ui.phase[id]||0});
  for(const p of D.parts)PNT.drawPart(p,C?0.32:1,isSelPart(p));
  if(!C){drawWires(1);drawPlugs(1);}
  drawNotes();
  // szellem
  if(ui.placing&&hv){const g=ghostPart(hv);PNT.drawPart(g,0.6,false,!partFits(g));}
  if(ui.tool==='wire'&&ui.wireStart&&hv){ctx.setLineDash([5,4]);ctx.strokeStyle=ui.wireColor;ctx.lineWidth=P*0.18;line(hx(ui.wireStart[1]),hy(ui.wireStart[0]),hx(hv.c),hy(hv.r));ctx.setLineDash([]);}
  if(ui.tool==='wire'&&ui.wireStart){ring(ui.wireStart[0],ui.wireStart[1],css('--accent'));}
  drawRats(A);
  drawLinkSel();
  if(ui.linkStart){const q=findPin(ui.linkStart);if(q){ring(q.r,q.c,css('--accent'),P*0.55,3);if(hv){ctx.setLineDash([4,4]);ctx.strokeStyle=css('--accent');ctx.lineWidth=2;line(hx(q.c),hy(q.r),hx(hv.c),hy(hv.r));ctx.setLineDash([]);}}}
  if(hv&&inb(hv.r,hv.c)&&!ui.placing&&ui.tool!=='pan'&&ui.tool!=='cut'){ctx.strokeStyle=css('--accent');ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(hx(hv.c),hy(hv.r),P*0.42,0,7);ctx.stroke();}
  if(ui.progHi){const q=findPin(ui.progHi);if(q){ring(q.r,q.c,css('--accent'),P*0.62,3.5);ring(q.r,q.c,'rgba(255,255,255,.8)',P*0.78,1.5);}} // a programban kijelölt csomópont lába
  if(ui.flash&&performance.now()<ui.flash.until){for(const [r,c] of ui.flash.holes)ring(r,c,'#e03131',P*0.62,3);}
  if(ui.drag&&ui.drag.kind==='box'){const a=ui.drag.h0,b2=ui.drag.h1;const x1=hx(Math.min(a.cf,b2.cf)),x2=hx(Math.max(a.cf,b2.cf)),y1=hy(Math.min(a.rf,b2.rf)),y2=hy(Math.max(a.rf,b2.rf));ctx.save();ctx.setLineDash([6,4]);ctx.strokeStyle=css('--accent');ctx.lineWidth=1.5;ctx.fillStyle=rgba(css('--accent'),.08);ctx.beginPath();ctx.rect(Math.min(x1,x2),y1,Math.abs(x2-x1),y2-y1);ctx.fill();ctx.stroke();ctx.restore();}
  ctx.restore();
}
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):ctx.rect(x,y,w,h);}
function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function ring(r,c,col,rad,w){ctx.strokeStyle=col;ctx.lineWidth=w||2.5;ctx.beginPath();ctx.arc(hx(c),hy(r),rad||P*0.48,0,7);ctx.stroke();}
/* Rövidített vezetékrajz: hosszú vezetéknél csak a két vég csonkja látszik, szakadásjellel;
   rámutatva (bármelyik végére vagy csonkjára), kijelölve vagy kapcsolatkiemeléskor a teljes vonal. */
const STUB_MIN=5; // lyuk: ennél rövidebb vezeték mindig teljes
function stubOf(w){if(!ui.stub)return null;const dr=w.b[0]-w.a[0],dc=w.b[1]-w.a[1],len=Math.hypot(dr,dc);if(len<STUB_MIN)return null;const k=Math.min(1.6,len*0.25)/len;return{k,len};}
function wireFull(w,i,auto){const hv=ui.hover;if(hv&&((hv.r===w.a[0]&&hv.c===w.a[1])||(hv.r===w.b[0]&&hv.c===w.b[1])))return true;
  if(!auto&&ui.sel&&((ui.sel.kind==='wire'&&ui.sel.i===i)||(isGroup()&&ui.sel.wires.has(i))))return true;
  if(!auto&&hv&&ui.hoverWire===i)return true;if(auto&&ui.selLink&&(w.links||[]).includes(ui.selLink))return true;return false;}
function wireStroke(x1,y1,x2,y2,w,dash,auto,full){const sb=full?null:stubOf(w);
  const seg=(a,b,c,d)=>{ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=P*0.26;line(a,b,c,d);if(dash)ctx.setLineDash([P*0.4,P*0.2]);ctx.strokeStyle=w.color||'#1c7ed6';ctx.lineWidth=P*0.17;line(a,b,c,d);ctx.setLineDash([]);};
  if(!sb){seg(x1,y1,x2,y2);return;}
  const dx=(x2-x1)*sb.k,dy=(y2-y1)*sb.k,ux=dx/Math.hypot(dx,dy),uy=dy/Math.hypot(dx,dy),nx=-uy*P*0.32,ny=ux*P*0.32;
  for(const [x,y,sx,sy] of [[x1,y1,dx,dy],[x2,y2,-dx,-dy]]){seg(x,y,x+sx,y+sy);
    // szakadásjel: két ferde vonás a csonk végén
    const ex=x+sx,ey=y+sy,s=Math.sign(sx*ux+sy*uy)||1;ctx.strokeStyle=w.color||'#1c7ed6';ctx.lineWidth=Math.max(1.4,P*0.1);
    for(const o of [0.18,0.42]){const cx=ex+ux*s*P*o,cy=ey+uy*s*P*o;line(cx-nx+ux*s*P*0.12,cy-ny+uy*s*P*0.12,cx+nx-ux*s*P*0.12,cy+ny-uy*s*P*0.12);}}}
function drawWires(alpha){
  ctx.save();ctx.globalAlpha=alpha;ctx.lineCap='round';
  for(const w of D.auto.wires){if(autoHidden(w.links))continue;const x1=hx(w.a[1]),y1=hy(w.a[0]),x2=hx(w.b[1]),y2=hy(w.b[0]);
    wireStroke(x1,y1,x2,y2,w,true,true,wireFull(w,-1,true));
    for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.fillStyle=w.color;ctx.beginPath();ctx.arc(x,y,P*0.2,0,7);ctx.fill();}}
  D.wires.forEach((w,i)=>{const x1=hx(w.a[1]),y1=hy(w.a[0]),x2=hx(w.b[1]),y2=hy(w.b[0]);const sel=ui.sel&&((ui.sel.kind==='wire'&&ui.sel.i===i)||(isGroup()&&ui.sel.wires.has(i)));
    const full=wireFull(w,i,false);
    if(sel){ctx.strokeStyle=css('--accent');ctx.lineWidth=P*0.42;line(x1,y1,x2,y2);}
    else if(full&&stubOf(w)){ctx.strokeStyle='rgba(168,87,31,.35)';ctx.lineWidth=P*0.42;line(x1,y1,x2,y2);}
    wireStroke(x1,y1,x2,y2,w,false,false,full);
    for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.fillStyle='rgba(0,0,0,.5)';ctx.beginPath();ctx.arc(x,y,P*0.24,0,7);ctx.fill();ctx.fillStyle=w.color||'#1c7ed6';ctx.beginPath();ctx.arc(x,y,P*0.17,0,7);ctx.fill();}
  });ctx.restore();
}
function stext(x,y,str,size,color,halo){ctx.save();ctx.translate(x,y);ctx.rotate(-VA());ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${size}px ${MONO}`;if(halo){ctx.lineWidth=3;ctx.lineJoin='round';ctx.strokeStyle=halo;ctx.strokeText(str,0,0);}ctx.fillStyle=color;ctx.fillText(str,0,0);ctx.restore();}
/* Az alkatrészek rajza: ui/drawpart.ts (makePainter) */

/* ---------- Interakció ---------- */
function toHole(ev){const rc=cv.getBoundingClientRect();const[x,y]=fromScreen(ev.clientX-rc.left,ev.clientY-rc.top);let cf=(x-M)/P-0.5,rf=(y-M)/P-0.5;if(cu())cf=D.board.cols-1-cf;return{rf,cf,r:Math.round(rf),c:Math.round(cf)};}
function ghostPart(h){return{id:'ghost',type:ui.placing,label:DEFS[ui.placing].prefix,r:h.r,c:h.c,rot:ui.ghost.rot,mir:ui.ghost.mir,xray:!!ui.ghost.xray,props:{...DEFS[ui.placing].props,...(ui.ghost.props||{})}};}
function duplicate(p){if(!p||ui.sim)return;ui.placing=p.type;ui.ghost={rot:p.rot,mir:p.mir,props:JSON.parse(JSON.stringify(p.props)),xray:!!p.xray,from:p.label};ui.sel=null;ui.wireStart=null;ui.linkStart=null;renderLeft();draw();}
function hitPart(rf,cf){for(let i=D.parts.length-1;i>=0;i--){const p=D.parts[i],b=DEFS[p.type].bounds(p),[lr,lc]=ixf(p,rf,cf);if(lr>=b.r0&&lr<=b.r1&&lc>=b.c0&&lc<=b.c1)return p;}return null;}
function segDist(pr,pc,r1,c1,r2,c2){const dr=r2-r1,dc=c2-c1,l=dr*dr+dc*dc;let t=l?((pr-r1)*dr+(pc-c1)*dc)/l:0;t=Math.max(0,Math.min(1,t));return Math.hypot(pr-(r1+t*dr),pc-(c1+t*dc));}
function hitWire(rf,cf){let best=-1,bd=ui.coarse?0.5:0.32;D.wires.forEach((w,i)=>{const sb=stubOf(w);let d;
  if(sb&&!wireFull(w,i,false)){const ar=w.a[0]+(w.b[0]-w.a[0])*sb.k,ac=w.a[1]+(w.b[1]-w.a[1])*sb.k,br=w.b[0]-(w.b[0]-w.a[0])*sb.k,bc=w.b[1]-(w.b[1]-w.a[1])*sb.k;d=Math.min(segDist(rf,cf,w.a[0],w.a[1],ar,ac),segDist(rf,cf,br,bc,w.b[0],w.b[1]));}
  else d=segDist(rf,cf,w.a[0],w.a[1],w.b[0],w.b[1]);if(d<bd){bd=d;best=i;}});return best;}
function hitBridge(rf,cf){let best=-1,bd=ui.coarse?0.45:0.3;D.bridges.forEach((b,i)=>{const d=segDist(rf,cf,b[0],b[1],b[2],b[3]);if(d<bd){bd=d;best=i;}});return best;}
/* Visszavonás: a terv és a saját könyvtár együtt (a könyvtár szerkesztése is visszavonható). */
const snap=()=>JSON.stringify({D,L:LIB});
function restoreSnap(s){const o=JSON.parse(s);if(o&&o.D&&o.L){D=o.D;setLib(o.L);}else D=o;}
/** Visszavonás és újra egy helyen (ui/history.ts): a változás előtti állapot a terv és a saját könyvtár pillanatképe. */
const HIST=new History(150,()=>undoUI());
function pushUndo(){HIST.push(snap());}
function commit(noRoute){queueMicrotask(progRefresh);syncDefs(D.customParts);const bk=JSON.stringify(D.board);if(!noRoute&&D.settings.autoRoute&&D.links.length)route({moved:ui.moved});ui.moved=null;save();if(bk!==ui.lastBoard){ui.lastBoard=bk;resize();boardUI();}recompute();renderLeft();}
function save(){try{localStorage.setItem(STORE_KEY,JSON.stringify(D));}catch(e){}}
function sameSec(r1,c1,r2,c2){const L=LAY();return L.cell(r1,c1)===L.cell(r2,c2);}
function addBridge(r1,c1,r2,c2){if(!inb(r1,c1)||!inb(r2,c2))return false;if(LAY().drilled(r1,c1)||LAY().drilled(r2,c2))return false;if(Math.abs(r1-r2)+Math.abs(c1-c2)!==1)return false;if(sameSec(r1,c1,r2,c2))return false;
  if(D.bridges.some(b=>(b[0]===r1&&b[1]===c1&&b[2]===r2&&b[3]===c2)||(b[0]===r2&&b[1]===c2&&b[2]===r1&&b[3]===c1)))return false;D.bridges.push([r1,c1,r2,c2]);return true;}

function onDown(ev,hAt){
  const h=hAt||toHole(ev);ui.hover=h;
  if(ui.tool==='pan'){ui.drag={kind:'pan',x:ev.clientX,y:ev.clientY};cv.setPointerCapture(ev.pointerId);return;}
  if(ui.sim){const p=hitPart(h.rf,h.cf);if(!(p&&hasPress(p))){if(ui.tool==='select'){ui.sel=p?grp([p.id]):null;renderLeft();draw();}return;}if(p&&hasPress(p)){if(D.settings.btnMode==='toggle')ui.pressed[p.id]=!ui.pressed[p.id];else{ui.pressed[p.id]=true;ui.holdPtr.set(ev.pointerId,p.id);cv.setPointerCapture(ev.pointerId);}recompute();}return;}
  if(ui.placing){const g=ghostPart(h);if(!partFits(g))return;pushUndo();useInProject(ui.placing);libRecent(ui.placing);const p={...g,id:'p'+(D.seq++),label:nextLabel(ui.placing)};if(!p.xray)delete p.xray;D.parts.push(p);if(isOff(p))attachPlug(p);
    if(ev.shiftKey){commit();return;} // Shift: további példányok
    ui.sel=grp([p.id]);ui.placing=null;setTool('select');commit();return;}
  if(ui.tool==='note'){addNote(h);return;}
  if(ui.tool==='select'){
    {const n=hitNote(h.rf,h.cf);if(n&&!ev.shiftKey){ui.sel={kind:'note',id:n.id};ui.drag={kind:noteCorner(n,h.rf,h.cf)?'nsize':'nmove',n,h0:h,r0:n.r,c0:n.c,w0:n.w,h0n:n.h,pushed:false};cv.setPointerCapture(ev.pointerId);renderLeft();draw();return;}}
    const p=hitPart(h.rf,h.cf),sh=ev.shiftKey;
    if(p){
      if(sh){const g=isGroup()?ui.sel:grp();if(g.parts.has(p.id))g.parts.delete(p.id);else g.parts.add(p.id);ui.sel=gSize(g)?g:null;renderLeft();draw();return;}
      if(!(isGroup()&&ui.sel.parts.has(p.id)))ui.sel=grp([p.id]);
      ui.drag={kind:'gmove',h0:h,sn:groupSnap(ui.sel),dr:0,dc:0,pushed:false};cv.setPointerCapture(ev.pointerId);renderLeft();draw();return;}
    const w=hitWire(h.rf,h.cf),b=w<0?hitBridge(h.rf,h.cf):-1;
    if(w>=0||b>=0){
      if(sh||(isGroup()&&(w>=0?ui.sel.wires.has(w):ui.sel.bridges.has(b)))){const g=isGroup()?ui.sel:grp();
        if(sh){if(w>=0){g.wires.has(w)?g.wires.delete(w):g.wires.add(w);}else{g.bridges.has(b)?g.bridges.delete(b):g.bridges.add(b);}ui.sel=gSize(g)?g:null;renderLeft();draw();return;}
        ui.drag={kind:'gmove',h0:h,sn:groupSnap(g),dr:0,dc:0,pushed:false};cv.setPointerCapture(ev.pointerId);return;}
      ui.sel=w>=0?{kind:'wire',i:w}:{kind:'bridge',i:b};renderLeft();draw();return;}
    ui.drag={kind:'box',h0:h,h1:h,add:sh};cv.setPointerCapture(ev.pointerId);return;}
  if(ui.tool==='bridge'){if(!inb(h.r,h.c))return;pushUndo();ui.drag={kind:'bridge',last:[h.r,h.c],n:0};cv.setPointerCapture(ev.pointerId);return;}
  if(ui.tool==='wire'){if(!inb(h.r,h.c)&&!offPinAt(h.r,h.c))return;
    if(!ui.wireStart){ui.wireStart=[h.r,h.c];draw();return;}
    if(ui.wireStart[0]===h.r&&ui.wireStart[1]===h.c){ui.wireStart=null;draw();return;}
    pushUndo();D.wires.push({a:ui.wireStart,b:[h.r,h.c],color:ui.wireColor});ui.wireStart=null;commit();return;}
  if(ui.tool==='link'){const q=hitPin(h.rf,h.cf);if(!q){ui.linkStart=null;renderLeft();draw();return;}const ref=q.part.id+'.'+q.id;
    if(!ui.linkStart||ui.linkStart===ref){ui.linkStart=ui.linkStart===ref?null:ref;renderLeft();draw();return;}
    addLink(ui.linkStart,ref);ui.linkStart=null;return;}
  if(ui.tool==='cut'){if(!inb(h.r,h.c))return;toggleCut(cutAt(h));return;}
  if(ui.tool==='erase'){pushUndo();ui.drag={kind:'erase',any:false};cv.setPointerCapture(ev.pointerId);eraseAt(h,true);return;}
}
/** A kattintás helye szerinti vágás: lyuk közepén kifúrt lyuk, két sor között rés. */
/** A csíkvágás típusa: hely szerint (a kattintás helye dönt: lyuk közepén furat, két lyuk között rés), furat vagy rés. */
const CUT_KINDS=[['auto','Hely szerint','A kattintás helye dönt: lyuk közepén furat, két lyuk között rés'],['hole','Furat','A lyuk kifúrása: a csík ott megszakad'],['gap','Rés','Szakadás két lyuk között: a csík a két lyuk között megszakad']];
const cutKind=()=>{const k=uiPref().cutKind;return k==='hole'||k==='gap'?k:'auto';};
function cutAt(h){const k=cutKind(),gap=()=>{const r=Math.floor(h.rf);return[Math.max(0,Math.min(D.board.rows-2,r)),h.c,0];};
  if(k==='hole')return[h.r,h.c,1];if(k==='gap')return gap();
  if(Math.abs(h.rf-h.r)<0.28)return[h.r,h.c,1];return gap();}
function toggleCut(ct){const k=ct.join(','),same=x=>x.join(',')===k;
  if((D.cuts||[]).some(same)){pushUndo();D.cuts=D.cuts.filter(x=>!same(x));commit();return;}
  const L=buildLayout(D.board,[ct]);if(!L.cuts.length){flashMsg(ct[2]?'Ide nem tehető vágás':'Itt nincs mit elvágni (szekcióhatár vagy a csík vége)');return;}
  pushUndo();D.cuts=[...(D.cuts||[]),ct];if((D.auto.cuts||[]).some(same))D.auto.cuts=D.auto.cuts.filter(x=>!same(x));commit();}
function hitCut(rf,cf){let best=-1,bd=ui.coarse?0.6:0.4;(D.cuts||[]).forEach((x,i)=>{const d=x[2]?Math.hypot(x[0]-rf,x[1]-cf):Math.hypot(x[0]+0.5-rf,x[1]-cf);if(d<bd){bd=d;best=i;}});return best;}
/* ---------- Jegyzetek: szöveges megjegyzés a vásznon (nem villamos elem), opcionális mutatóval egy alkatrészre ---------- */
function hitNote(rf,cf){const ns=D.notes||[];for(let i=ns.length-1;i>=0;i--){const n=ns[i];if(rf>=n.r-0.5&&rf<=n.r+n.h-0.5&&cf>=n.c-0.5&&cf<=n.c+n.w-0.5)return n;}return null;}
const noteCorner=(n,rf,cf)=>Math.abs(rf-(n.r+n.h-0.5))<0.6&&Math.abs(cf-(n.c+n.w-0.5))<0.6;
function addNote(h){pushUndo();const id='n'+(D.seq++);const n={id,r:Math.round(h.rf),c:Math.round(h.cf),w:12,h:6,text:'Jegyzet\nÍrd ide a leírást…',color:NOTE_COL[0][0],target:null};
  D.notes=[...(D.notes||[]),n];ui.sel={kind:'note',id};setTool('select');commit(true);setTimeout(()=>{const t=$('#nText');if(t){t.focus();t.select();}},0);}
function noteLines(n,maxW){ctx.font=`500 ${Math.max(9,P*0.62)}px ${css('--display')}`;const out=[];
  for(const raw of String(n.text).split('\n')){const head=/^#\s+/.test(raw),line=raw.replace(/^#\s+/,'');const words=line.split(/\s+/);let cur='';
    ctx.font=`${head?700:500} ${Math.max(9,P*(head?0.75:0.62))}px ${css('--display')}`;
    for(const w of words){const t=cur?cur+' '+w:w;if(ctx.measureText(t).width>maxW&&cur){out.push({t:cur,head});cur=w;}else cur=t;}out.push({t:cur,head});}
  return out;}
function drawNotes(){if(!(D.notes||[]).length)return;ctx.save();
  for(const n of D.notes){const x=hx(n.c)-P/2,y=hy(n.r)-P/2,w=n.w*P,h=n.h*P,sel=ui.sel&&ui.sel.kind==='note'&&ui.sel.id===n.id;
    // mutató: szaggatott, nyílhegyes – nem vezeték
    const t=n.target&&D.parts.find(p=>p.id===n.target);
    if(t){const b=DEFS[t.type].bounds(t),[tr,tc]=xf(t,(b.r0+b.r1)/2,(b.c0+b.c1)/2),tx=hx(tc),ty=hy(tr);
      const ex=Math.max(x,Math.min(x+w,tx)),ey=Math.max(y,Math.min(y+h,ty));
      ctx.setLineDash([5,4]);ctx.strokeStyle='rgba(73,80,87,.85)';ctx.lineWidth=1.6;line(ex,ey,tx,ty);ctx.setLineDash([]);
      const a=Math.atan2(ty-ey,tx-ex),L=9;ctx.fillStyle='rgba(73,80,87,.9)';ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx-L*Math.cos(a-0.4),ty-L*Math.sin(a-0.4));ctx.lineTo(tx-L*Math.cos(a+0.4),ty-L*Math.sin(a+0.4));ctx.closePath();ctx.fill();}
    ctx.shadowColor='rgba(0,0,0,.18)';ctx.shadowBlur=8;ctx.shadowOffsetY=2;ctx.fillStyle=n.color;rr(x,y,w,h,6);ctx.fill();ctx.shadowColor='transparent';
    ctx.strokeStyle=sel?css('--accent'):'rgba(0,0,0,.18)';ctx.lineWidth=sel?2:1;rr(x,y,w,h,6);ctx.stroke();
    ctx.save();ctx.beginPath();ctx.rect(x+4,y+4,w-8,h-8);ctx.clip();ctx.translate(x,y);ctx.fillStyle='#2b2f33';ctx.textBaseline='top';ctx.textAlign='left';
    let yy=P*0.35;for(const l of noteLines(n,w-P*0.8)){ctx.font=`${l.head?700:500} ${Math.max(9,P*(l.head?0.75:0.62))}px ${css('--display')}`;ctx.fillText(l.t,P*0.4,yy);yy+=Math.max(11,P*(l.head?0.95:0.8));}
    ctx.restore();
    if(sel){ctx.fillStyle=css('--accent');ctx.fillRect(x+w-7,y+h-7,7,7);}}
  ctx.restore();}
function eraseAt(h,click){
  const order=cu()?['bridge','wire','part']:['wire','part','bridge'];
  if(click){const n=hitNote(h.rf,h.cf);if(n){D.notes=D.notes.filter(x=>x!==n);ui.drag.any=true;ui.sel=null;commit(true);return;}}
  for(const k of order){
    if(k==='bridge'&&cu()||k==='wire'&&!cu()){const i=hitCut(h.rf,h.cf);if(i>=0){D.cuts.splice(i,1);ui.drag.any=true;ui.sel=null;commit();return;}}
    if(k==='wire'){const i=hitWire(h.rf,h.cf);if(i>=0){D.wires.splice(i,1);ui.drag.any=true;ui.sel=null;commit();return;}}
    if(k==='bridge'){const i=hitBridge(h.rf,h.cf);if(i>=0){D.bridges.splice(i,1);ui.drag.any=true;ui.sel=null;commit();return;}}
    if(k==='part'&&click){const p=hitPart(h.rf,h.cf);if(p){removeParts([p.id]);ui.drag.any=true;ui.sel=null;commit();return;}}
  }
}
function onMove(ev,hAt){
  const h=hAt||toHole(ev);
  if(ui.stub&&!ui.drag){const hw=hitWire(h.rf,h.cf);if(hw!==ui.hoverWire){ui.hoverWire=hw;draw();}}const prev=ui.hover;ui.hover=h;const d=ui.drag;
  if(d&&d.kind==='pan'){const sc=$('#scroll');sc.scrollLeft-=ev.clientX-d.x;sc.scrollTop-=ev.clientY-d.y;d.x=ev.clientX;d.y=ev.clientY;return;}
  if(d&&d.kind==='box'){d.h1=h;draw();return;}
  if(d&&(d.kind==='nmove'||d.kind==='nsize')){const dr=Math.round(h.rf-d.h0.rf),dc=Math.round(h.cf-d.h0.cf);
    const nr=d.kind==='nmove'?Math.max(-NEXT,Math.min(D.board.rows+NEXT-2,d.r0+dr)):d.n.r,nc=d.kind==='nmove'?Math.max(-NEXT,Math.min(D.board.cols+NEXT-2,d.c0+dc)):d.n.c;
    const nw=d.kind==='nsize'?Math.max(3,Math.min(60,d.w0+dc)):d.n.w,nh=d.kind==='nsize'?Math.max(2,Math.min(60,d.h0n+dr)):d.n.h;
    if(nr!==d.n.r||nc!==d.n.c||nw!==d.n.w||nh!==d.n.h){if(!d.pushed){pushUndo();d.pushed=true;}Object.assign(d.n,{r:nr,c:nc,w:nw,h:nh});draw();}return;}
  if(d&&d.kind==='gmove'){let dr=h.r-d.h0.r,dc=h.c-d.h0.c,g=0;
    while(!groupOk(d.sn,dr,dc)&&(dr||dc)&&g++<300){if(dr)dr-=Math.sign(dr);if(!groupOk(d.sn,dr,dc)&&dc)dc-=Math.sign(dc);}
    if(!groupOk(d.sn,dr,dc)){dr=d.dr;dc=d.dc;}else if((h.r-d.h0.r!==dr||h.c-d.h0.c!==dc)&&!d.warned){d.warned=true;flashMsg('Tovább nem mozdítható (panel széle)');}
    if(dr!==d.dr||dc!==d.dc){if(!d.pushed){pushUndo();d.pushed=true;if(D.settings.autoRoute&&D.links.length){const ids=new Set();for(const o of d.sn.parts)movedLinks(o.p).forEach(x=>ids.add(x));ui.hideAuto=ids;}}
      d.dr=dr;d.dc=dc;groupApply(d.sn,dr,dc);recompute();renderLeft();}}
  if(d&&d.kind==='move'){let nr=d.r0+(h.r-d.h0.r),nc=d.c0+(h.c-d.h0.c);
    if(!partFits({...d.p,r:nr,c:nc})){let g=0;while(!partFits({...d.p,r:nr,c:nc})&&(nr!==d.p.r||nc!==d.p.c)&&g++<200){if(nr!==d.p.r)nr+=Math.sign(d.p.r-nr);if(!partFits({...d.p,r:nr,c:nc})&&nc!==d.p.c)nc+=Math.sign(d.p.c-nc);}if(!d.warned){d.warned=true;flashMsg('A panel szélénél tovább nem mozdítható');}}
    if(nr!==d.p.r||nc!==d.p.c){const t={...d.p,r:nr,c:nc};if(partFits(t)){if(!d.pushed){pushUndo();d.pushed=true;if(D.settings.autoRoute&&D.links.length)ui.hideAuto=movedLinks(d.p);}d.p.r=nr;d.p.c=nc;recompute();renderLeft();}}}
  if(d&&d.kind==='bridge'&&inb(h.r,h.c)){let[r,c]=d.last;let guard=0;while((r!==h.r||c!==h.c)&&guard++<200){let nr=r,nc=c;if(r!==h.r)nr+=Math.sign(h.r-r);else nc+=Math.sign(h.c-c);if(addBridge(r,c,nr,nc))d.n++;r=nr;c=nc;}d.last=[r,c];if(d.n)recompute();}
  if(d&&d.kind==='erase')eraseAt(h,false);
  if(!prev||prev.r!==h.r||prev.c!==h.c||ui.placing||ui.wireStart||(ui.tool==='cut'&&String(cutAt(prev))!==String(cutAt(h)))){status();draw();} // csíkvágásnál a lyukon belül is követi, hová kerül
}
function endDrag(ev){
  const pid=ui.holdPtr.get(ev.pointerId);if(pid){ui.pressed[pid]=false;ui.holdPtr.delete(ev.pointerId);recompute();}
  const d=ui.drag;ui.drag=null;if(!d)return;
  if((d.kind==='nmove'||d.kind==='nsize')){if(d.pushed){save();renderLeft();}return;}
  if(d.kind==='move'&&d.pushed){ui.hideAuto=null;ui.moved=new Set([d.p.id]);commit();}
  if(d.kind==='gmove'&&d.pushed){ui.hideAuto=null;ui.moved=new Set(d.sn.parts.map(o=>o.p.id));commit();}
  if(d.kind==='box'){const r0=Math.min(d.h0.rf,d.h1.rf),r1=Math.max(d.h0.rf,d.h1.rf),c0=Math.min(d.h0.cf,d.h1.cf),c1=Math.max(d.h0.cf,d.h1.cf);
    const inR=(r,c)=>r>=r0-0.5&&r<=r1+0.5&&c>=c0-0.5&&c<=c1+0.5;
    if(r1-r0<0.5&&c1-c0<0.5){if(!d.add)ui.sel=null;}
    else{const g=d.add&&isGroup()?ui.sel:grp();
      for(const p of D.parts){const ps=gpins(p);const mr=ps.reduce((s,q)=>s+q.r,0)/ps.length,mc=ps.reduce((s,q)=>s+q.c,0)/ps.length;if(inR(mr,mc))g.parts.add(p.id);}
      D.bridges.forEach((b,i)=>{if(inR(b[0],b[1])&&inR(b[2],b[3]))g.bridges.add(i);});
      D.wires.forEach((w,i)=>{if(inR(w.a[0],w.a[1])&&inR(w.b[0],w.b[1]))g.wires.add(i);});
      ui.sel=gSize(g)?g:null;}
    renderLeft();draw();}
  if(d.kind==='bridge'){if(d.n)commit();else HIST.drop();}
  if(d.kind==='erase'&&!d.any)HIST.drop();
}
/* ---------- Érintés: gesztusok ----------
   egy ujj: koppintás = kattintás; húzás alkatrészen = mozgatás, üres helyen = görgetés (híd/törlés eszköznél az eszköz);
   hosszan nyomva üres helyen = kijelölő keret; két ujj = nagyítás és görgetés (a félbehagyott művelet visszaáll);
   lerakáskor az előnézet az ujj fölött jár, felengedéskor kerül le. */
const T={pts:new Map(),mode:null,start:null,timer:0,last:null,pinch:null,raf:0};
const PLACE_LIFT=56; // px: lerakáskor ennyivel az ujj fölött az előnézet
function holeAt(x,y){return toHole({clientX:x,clientY:y});}
const liftHole=ev=>holeAt(ev.clientX,ev.clientY-PLACE_LIFT);
function tCancel(){clearTimeout(T.timer);
  if(T.mode==='active'&&ui.drag){const d=ui.drag;ui.drag=null;
    if((d.kind==='gmove'&&d.pushed)||d.kind==='bridge'||d.kind==='erase'){restoreSnap(HIST.drop());ui.hideAuto=null;commit(true);}else draw();}
  if(T.mode==='direct'){for(const [id,pid] of ui.holdPtr){ui.pressed[pid]=false;ui.holdPtr.delete(id);}recompute();}
  if(T.mode==='place'){ui.hover=null;draw();}
  T.mode=null;T.start=null;}
function pinchStart(){const [a,b]=[...T.pts.values()],cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;T.pinch={d0:Math.hypot(a.x-b.x,a.y-b.y)||1,z0:ui.zoom,bp:holeAt(cx,cy),cx,cy};T.mode='pinch';}
function pinchMove(){if(T.raf)return;T.raf=requestAnimationFrame(()=>{T.raf=0;if(T.mode!=='pinch'||T.pts.size<2)return;
  const [a,b]=[...T.pts.values()],pc=T.pinch,cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,z=Math.max(0.6,Math.min(2.6,pc.z0*Math.hypot(a.x-b.x,a.y-b.y)/pc.d0));
  if(Math.round(14*z)!==P){ui.zoom=+z.toFixed(3);resize();}
  const sc=$('#scroll'),rc=cv.getBoundingClientRect(),[vx,vy]=toScreen(hx(pc.bp.cf),hy(pc.bp.rf));
  sc.scrollLeft+=rc.left+vx-cx;sc.scrollTop+=rc.top+vy-cy;});}
function tDown(ev){ui.coarse=true;if(sheetOpen()&&T.pts.size===0){sheet('');}T.pts.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});try{cv.setPointerCapture(ev.pointerId);}catch(e){}
  if(T.pts.size===2){tCancel();pinchStart();return;}
  if(T.pts.size>2||T.mode==='pinch')return;
  const h=toHole(ev);T.start=ev;T.last={x:ev.clientX,y:ev.clientY};
  if(ui.sim){const p=hitPart(h.rf,h.cf);if(p&&hasPress(p)){onDown(ev);T.mode='direct';}else T.mode='pan';return;}
  if(ui.placing){ui.hover=liftHole(ev);T.mode='place';status();draw();return;}
  T.mode='pend';
  if(ui.tool==='select'&&!hitPart(h.rf,h.cf))
    T.timer=setTimeout(()=>{if(T.mode!=='pend')return;T.mode='active';const h0=toHole(T.start);ui.hover=h0;ui.drag={kind:'box',h0,h1:h0,add:false};draw();if(navigator.vibrate)try{navigator.vibrate(12);}catch(e){}flashHint('Kijelölő keret: húzd az ujjad');},450);}
function tMove(ev){const pt=T.pts.get(ev.pointerId);if(!pt)return;pt.x=ev.clientX;pt.y=ev.clientY;
  if(T.mode==='pinch'){pinchMove();return;}
  if(T.mode==='place'){ui.hover=liftHole(ev);status();draw();return;}
  if(T.mode==='active'||T.mode==='direct'){onMove(ev);return;}
  if(T.mode==='pend'){const s0=T.start;if(Math.hypot(ev.clientX-s0.clientX,ev.clientY-s0.clientY)<9)return;clearTimeout(T.timer);
    const h=toHole(s0),onPart=!!hitPart(h.rf,h.cf)||!!hitNote(h.rf,h.cf);
    if((ui.tool==='select'&&onPart)||ui.tool==='bridge'||ui.tool==='erase'){T.mode='active';onDown(s0);onMove(ev);return;}
    T.mode='pan';}
  if(T.mode==='pan'){const sc=$('#scroll');sc.scrollLeft-=ev.clientX-T.last.x;sc.scrollTop-=ev.clientY-T.last.y;T.last={x:ev.clientX,y:ev.clientY};}}
function tUp(ev,cancel){T.pts.delete(ev.pointerId);
  if(T.mode==='pinch'){if(!T.pts.size)T.mode=null;return;}
  clearTimeout(T.timer);const m=T.mode;T.mode=null;
  if(cancel){T.mode=m;tCancel();return;}
  if(m==='place'){const h=liftHole(ev);ui.hover=h;onDown(ev,h);draw();}
  else if(m==='pend'){onDown(T.start);endDrag(ev);}
  else if(m==='active'||m==='direct')endDrag(ev);
  T.start=null;}
let hintTimer;function flashHint(m){const s=$('#status');s.textContent=m;clearTimeout(hintTimer);hintTimer=setTimeout(status,1800);}
cv.addEventListener('pointerdown',ev=>{if(ev.pointerType==='touch'){ev.preventDefault();tDown(ev);}else if(ev.button===1||ui.space){panStart(ev,cv);}else{ui.coarse=false;onDown(ev);}});
cv.addEventListener('pointermove',ev=>{if(ev.pointerType==='touch')tMove(ev);else onMove(ev);});
cv.addEventListener('pointerup',ev=>{if(ev.pointerType==='touch')tUp(ev);else endDrag(ev);});
cv.addEventListener('pointercancel',ev=>{if(ev.pointerType==='touch')tUp(ev,true);else endDrag(ev);});
cv.addEventListener('contextmenu',ev=>{if(ui.coarse)ev.preventDefault();});
cv.addEventListener('pointerleave',()=>{if(!ui.drag){ui.hover=null;status();draw();}});
$('#scroll').addEventListener('wheel',ev=>{if(ev.ctrlKey||ev.metaKey){ev.preventDefault();zoomTo(ui.zoom*Math.pow(1.0015,-Math.max(-120,Math.min(120,ev.deltaY))),ev.clientX,ev.clientY);}},{passive:false});
/* pásztázás: középső gombbal, szóköz + húzással, vagy a panel melletti üres téren húzva */
function panStart(ev,el){ev.preventDefault();const sc=$('#scroll');let x=ev.clientX,y=ev.clientY;sc.classList.add('panning');try{el.setPointerCapture(ev.pointerId);}catch(e){}
  const mv=e=>{sc.scrollLeft-=e.clientX-x;sc.scrollTop-=e.clientY-y;x=e.clientX;y=e.clientY;};
  const up=()=>{sc.classList.remove('panning');el.removeEventListener('pointermove',mv);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);};
  el.addEventListener('pointermove',mv);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);}
$('#scroll').addEventListener('pointerdown',ev=>{if(ev.pointerType==='touch')return;if(ev.target===$('#scroll')&&ev.button===0||ev.button===1)panStart(ev,$('#scroll'));},true);
document.addEventListener('keydown',ev=>{if(ev.code!=='Space'||ev.repeat)return;const t=ev.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.tagName==='BUTTON'||t.closest&&t.closest('#progView,#partView,.pg,dialog'))||ui.part)return;ev.preventDefault();ui.space=true;$('.app').classList.add('space');});
document.addEventListener('keyup',ev=>{if(ev.code==='Space'){ui.space=false;$('.app').classList.remove('space');}});
window.addEventListener('blur',()=>{ui.space=false;$('.app').classList.remove('space');});

function nextLabel(type){const pre=DEFS[type].prefix;let n=0;for(const p of D.parts){const m=new RegExp('^'+pre+'(\\d+)$').exec(p.label);if(m)n=Math.max(n,+m[1]);}return pre+(n+1);}
const grp=(parts,bridges,wires)=>({kind:'group',parts:new Set(parts||[]),bridges:new Set(bridges||[]),wires:new Set(wires||[])});
const isGroup=()=>ui.sel&&ui.sel.kind==='group';
const gSize=g=>g.parts.size+g.bridges.size+g.wires.size;
function selPart(){if(!isGroup()||ui.sel.parts.size!==1||ui.sel.bridges.size||ui.sel.wires.size)return null;const id=[...ui.sel.parts][0];return D.parts.find(p=>p.id===id)||null;}
function isSelPart(p){return isGroup()&&ui.sel.parts.has(p.id);}
function groupSnap(g){return{parts:[...g.parts].map(id=>D.parts.find(p=>p.id===id)).filter(Boolean).map(p=>({p,r:p.r,c:p.c})),bridges:[...g.bridges].map(i=>({i,b:[...D.bridges[i]]})),wires:[...g.wires].map(i=>({i,a:[...D.wires[i].a],b:[...D.wires[i].b]}))};}
function groupOk(sn,dr,dc){return sn.parts.every(o=>partFits({...o.p,r:o.r+dr,c:o.c+dc}))&&sn.bridges.every(o=>inb(o.b[0]+dr,o.b[1]+dc)&&inb(o.b[2]+dr,o.b[3]+dc))&&sn.wires.every(o=>inb(o.a[0]+dr,o.a[1]+dc)&&inb(o.b[0]+dr,o.b[1]+dc));}
function groupApply(sn,dr,dc){for(const o of sn.parts){o.p.r=o.r+dr;o.p.c=o.c+dc;}for(const o of sn.bridges){const b=D.bridges[o.i];b[0]=o.b[0]+dr;b[1]=o.b[1]+dc;b[2]=o.b[2]+dr;b[3]=o.b[3]+dc;}for(const o of sn.wires){const w=D.wires[o.i];w.a=[o.a[0]+dr,o.a[1]+dc];w.b=[o.b[0]+dr,o.b[1]+dc];}}
function groupTransform(kind){ // kind: 'rot' | 'mir'
  const g=ui.sel,pts=[];
  for(const id of g.parts){const p=D.parts.find(x=>x.id===id);if(!p)continue;const ps=gpins(p);pts.push([ps.reduce((t,q)=>t+q.r,0)/ps.length,ps.reduce((t,q)=>t+q.c,0)/ps.length]);} // a lábak középpontja körül
  for(const i of g.bridges){const b=D.bridges[i];pts.push([b[0],b[1]],[b[2],b[3]]);}
  for(const i of g.wires){const w=D.wires[i];pts.push(w.a,w.b);}
  if(!pts.length)return;
  // kétszeres középpont: fél lyukra eső tengely is lehet (pl. 20 lábú sor közepe)
  const R2=Math.round(2*pts.reduce((s,p)=>s+p[0],0)/pts.length);let C2=Math.round(2*pts.reduce((s,p)=>s+p[1],0)/pts.length);
  if(kind==='rot'&&((R2-C2)&1))C2+=1; // forgatásnál azonos paritás kell, hogy rácspontra képezzen
  const T=kind==='rot'?(r,c)=>[(R2+2*c-C2)/2,(C2-2*r+R2)/2]:(r,c)=>[r,C2-c];
  const apply=()=>{
    for(const id of g.parts){const p=D.parts.find(x=>x.id===id);if(!p)continue;[p.r,p.c]=T(p.r,p.c);if(kind==='rot')p.rot=(p.rot+1)&3;else{p.rot=(4-p.rot)&3;p.mir=!p.mir;}}
    for(const i of g.bridges){const b=D.bridges[i];const[a1,a2]=T(b[0],b[1]),[b1,b2]=T(b[2],b[3]);D.bridges[i]=[a1,a2,b1,b2];}
    for(const i of g.wires){const w=D.wires[i];w.a=T(w.a[0],w.a[1]);w.b=T(w.b[0],w.b[1]);}};
  const before=JSON.stringify(D);apply();
  const ok=[...g.parts].every(id=>{const p=D.parts.find(x=>x.id===id);return !p||partFits(p);})&&[...g.bridges].every(i=>inb(D.bridges[i][0],D.bridges[i][1])&&inb(D.bridges[i][2],D.bridges[i][3]))&&[...g.wires].every(i=>inb(...D.wires[i].a)&&inb(...D.wires[i].b));
  D=JSON.parse(before);
  if(!ok){flashMsg('Így lelógna a panelról (legalább egy láb a panelon, legfeljebb 8 lyuknyi túllógás)');return;}
  pushUndo();apply();ui.moved=new Set(g.parts);commit();
}
function rotate(){if(ui.placing){ui.ghost.rot=(ui.ghost.rot+1)&3;draw();return;}if(isGroup()&&gSize(ui.sel))groupTransform('rot');}
function mirror(){if(ui.placing){ui.ghost.rot=(4-ui.ghost.rot)&3;ui.ghost.mir=!ui.ghost.mir;draw();return;}if(isGroup()&&gSize(ui.sel))groupTransform('mir');}
function delSel(){if(!ui.sel)return;pushUndo();if(ui.sel.kind==='group'){const g=ui.sel;removeParts(g.parts);D.bridges=D.bridges.filter((b,i)=>!g.bridges.has(i));D.wires=D.wires.filter((w,i)=>!g.wires.has(i));}else if(ui.sel.kind==='wire')D.wires.splice(ui.sel.i,1);else if(ui.sel.kind==='bridge')D.bridges.splice(ui.sel.i,1);else if(ui.sel.kind==='note')D.notes=D.notes.filter(n=>n.id!==ui.sel.id);ui.sel=null;commit();}
function undo(){const E=editorHistory();if(E){E.go(false);return;}const s=HIST.undo(snap());if(s==null)return;restoreSnap(s);ui.sel=null;commit();}
function redo(){const E=editorHistory();if(E){E.go(true);return;}const s=HIST.redo(snap());if(s==null)return;restoreSnap(s);ui.sel=null;commit();}
function setTool(t){ui.tool=t;ui.wireStart=null;ui.linkStart=null;if(t!=='place')ui.placing=null;renderLeft();draw();}
function setView(v){ui.view=v;$('#vComp').classList.toggle('on',v==='comp');$('#vCu').classList.toggle('on',v==='cu');draw();}
function zoom(dz){zoomTo(ui.zoom+dz);}
/* ---------- Jobb oldali sáv: fülek (Terv / Ellenőrzés / Szimuláció) és harmonika ---------- */
const UIKEY='proofboard.ui.right';
const uiPref=()=>{try{return JSON.parse(localStorage.getItem(UIKEY)||'{}')||{};}catch(e){return{};}};
const uiPrefSet=o=>{try{localStorage.setItem(UIKEY,JSON.stringify({...uiPref(),...o}));}catch(e){}};
/* ---------- Egyszerű mód (5.5): a haladó részek rejtve ([data-adv] elemek, csíkvágás, ritkább kategóriák), a Problémák közül csak a hibák ---------- */
const SIMPLE_HIDE_CATS=new Set(['Logika','Csatlakozó']);
const isSimple=()=>document.documentElement.classList.contains('simple');
function setSimple(on,remember=true){on=!!on;document.documentElement.classList.toggle('simple',on);if(remember)uiPrefSet({simple:on});
  const b=$('#bSimple');b.setAttribute('aria-checked',String(on));b.classList.toggle('on',on);$('#simpleBadge').hidden=!on;
  if(on&&ADV_TOOLS.has(ui.tool))setTool('select');
  if(D){renderLib();renderLeft();renderRight();sbUpdate();codeRefresh();}
  if(remember)log(on?'Egyszerű mód: a haladó részek rejtve.':'Egyszerű mód kikapcsolva.');}
function rtab(name,remember=true){if(name==='code'){if(ui.rtab!=='code')ui.rtabBeforeCode=ui.rtab;codeMount();}ui.rtab=name;
  document.querySelectorAll('[data-rtab]').forEach(b=>{const on=b.dataset.rtab===name;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on));});
  document.querySelectorAll('[data-rpane]').forEach(p=>{p.hidden=p.dataset.rpane!==name;});
  document.querySelectorAll('[data-rail-rtab]').forEach(b=>b.classList.toggle('on',b.dataset.railRtab===name));
  if(name==='code')PC.refresh();
  if(remember&&name!=='props')layPatch({rtab:name});}
document.querySelector('.right .rtabs').addEventListener('click',e=>{const b=e.target.closest('[data-rtab]');if(b)rtab(b.dataset.rtab);});
document.querySelector('.right .rtabs').addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;const ts=[...document.querySelectorAll('[data-rtab]')],i=ts.findIndex(b=>b.classList.contains('on')),n=ts[(i+(e.key==='ArrowRight'?1:ts.length-1))%ts.length];rtab(n.dataset.rtab);n.focus();e.preventDefault();});
document.querySelectorAll('details.acc').forEach(d=>{const st=(uiPref().acc||{})[d.id];if(st!=null)d.open=!!st;d.addEventListener('toggle',()=>uiPrefSet({acc:{...(uiPref().acc||{}),[d.id]:d.open}}));});
ui.stub=!!uiPref().stub;$('#vStub').classList.toggle('on',ui.stub);
$('#vStub').onclick=()=>{ui.stub=!ui.stub;$('#vStub').classList.toggle('on',ui.stub);uiPrefSet({stub:ui.stub});draw();};
/* bal oldali sáv: Szerkesztés (eszközök, kijelölés) / Alkatrészek (könyvtár) */
/* bal oldali sáv: az alkatrészkönyvtár (a régi Szerkesztés fül tartalma az eszközsávba és a lebegő ablakba költözött) */
function ltab(name){ui.ltab=name==='props'?'props':'lib';
  document.querySelectorAll('[data-ltab]').forEach(b=>{const on=b.dataset.ltab===ui.ltab;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on));});
  document.querySelectorAll('[data-lpane]').forEach(p=>{p.hidden=p.dataset.lpane!==ui.ltab;});
  document.querySelectorAll('[data-rail-ltab]').forEach(b=>b.classList.toggle('on',b.dataset.railLtab===ui.ltab));}
document.querySelector('.ltabs').addEventListener('click',e=>{const b=e.target.closest('[data-ltab]');if(b)ltab(b.dataset.ltab);});
ui.ltab='lib';
function setSim(on){if(on&&!ui.sim){LSTATE.clear();STSTATE.clear();if(LAY_S.cur!=='sim'){ui.layBack=LAY_S.cur;applyLayout('sim',true,{work:ui.work||'board'});}else ui.layBack=null;log('Szimuláció elindítva.');}
  else if(!on&&ui.sim){if(ui.layBack&&LAY_S.cur==='sim')applyLayout(ui.layBack);ui.layBack=null;log('Szimuláció leállítva.');}
  ui.sim=on;if(!on){ui.pressed={};ui.holdPtr.clear();}ui.wireStart=null;ui.placing=null;simBtn();
  progStart(on);
  recompute();if(on&&ui.prog)progTick(0);renderLeft();if(PE&&ui.work!=='board'){progLiveAt=0;PE.live();}}
/* ---------- Program futtatása: ütemenként kiértékel, és ha a GPIO-beállítások változnak, újraszámol ---------- */
const PROG_MS=20;
/* ---------- Munkaterület: Panel / Vezérlés / Mindkettő; a programszerkesztő (ui/progedit.ts) ---------- */
let PE=null,PC=null,progLiveAt=0;
function progRefresh(){codeRefresh();if(!PE||!ui.work||ui.work==='board')return;PE.refresh();}
/** A Program nézet: a blokkszerkesztő (ui/progedit.ts). A generált kód a jobb sáv Kód fülén (ui/progcode.ts). */
function progMount(){if(PE)return;const v=$('#progView');
  v.innerHTML=`<div class="pv-pane" id="pvNodes"></div>`;
  PE=mountProgEditor($('#pvNodes'),progHost);}
/** Kód fül: a jobb sávban (régi API: pvTab('code')). */
function codeMount(){if(!PC)PC=mountCodeView($('#codeView'),codeHost);return PC;}
const codeOpen=()=>ui.rtab==='code'&&!$('.app').classList.contains('colR');
function codeRefresh(){if(PC&&ui.rtab==='code')PC.refresh();}
function pvTab(t){if(t==='code'){codeMount();sideCollapse('r',false);rtab('code');}else{ui.pvTab='nodes';if(ui.rtab==='code')rtab(ui.rtabBeforeCode||'design');}ui.pvTab=t==='code'?'code':'nodes';}
const codeHost={
  code(lang){return D.program&&D.program.nodes.length?generateCode(D,A0||analyze(false),D.program,lang):null;},
  selected:()=>ui.progSel||null,
  select(id){ui.progSel=id;if(PE)PE.select(id);codeRefresh();},
  download(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);},
  lang:()=>uiPref().codeLang==='arduino'?'arduino':'micropython',
  setLang(l){uiPrefSet({codeLang:l});},
};
function progLive(){if(!PE||!ui.work||ui.work==='board')return;const n=performance.now();if(n-progLiveAt<100)return;progLiveAt=n;PE.live();}
function setWork(v,remember=true){if(ui.part)partShow(null);if(!['board','prog','split'].includes(v))v='board';ui.work=v;const a=$('.app').classList;
  a.toggle('work-prog',v==='prog');a.toggle('work-split',v==='split');$('#progView').hidden=v==='board';
  document.querySelectorAll('[data-work]').forEach(b=>{const on=b.dataset.work===v;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
  if(v!=='board'){progMount();progRefresh();}else{ui.progHi=null;}
  $('#splitDir').hidden=v!=='split';
  if(remember)layPatch({work:v});resize();draw();toolFit();}
/* Mindkettő: egymás mellett vagy egymás alatt (a panel felül) */
function splitDir(vert){if(vert==null)vert=!$('.app').classList.contains('split-v');$('.app').classList.toggle('split-v',!!vert);const b=$('#splitDir');b.innerHTML=icon(vert?'sideB':'sideR');b.title=vert?'Egymás alatt (kattintva: egymás mellett)':'Egymás mellett (kattintva: egymás alatt)';b.setAttribute('aria-pressed',String(!!vert));uiPrefSet({splitV:!!vert});resize();if(PE)PE.refresh();}
$('#splitDir').onclick=()=>splitDir();
const progHost={
  get:()=>D.program||null,
  set(p,layoutOnly){pushUndo();const n=normProgram(p);if(n&&n.nodes.length)D.program=n;else delete D.program;
    if(layoutOnly){save();return;}if(ui.sim)progStart(true);commit(true);if(ui.sim&&ui.prog)progTick(0);},
  pins(){const A=A0||analyze(false),out=[];const ps=[...D.parts].sort((a,b)=>(isMcu(a)?1:0)-(isMcu(b)?1:0));
    for(const p of ps)for(const q of gpins(p)){if(isMcu(p)&&q.role!=='gpio')continue;const ref=p.id+'.'+q.id,g=gpioOf(D,A,ref),gq=g&&findPin(g);
      out.push({ref,part:p.label,name:q.name!==q.id&&!isMcu(p)?`${q.name} (${q.id})`:q.name,gpio:gq?gq.name:null});}
    return out;},
  live(){const P=ui.prog;return P&&P.out?{running:!!ui.sim,vals:Object.fromEntries(P.rt.vals),errors:Object.fromEntries(P.out.errors)}:null;},
  running:()=>!!ui.sim,
  sim(on){setSim(on);},
  highlight(ref){ui.progHi=ref||null;draw();},
  onSelect(id){ui.progSel=id;codeRefresh();},
};
document.querySelectorAll('[data-work]').forEach(b=>b.addEventListener('click',()=>setWork(b.dataset.work)));
function progStart(on){if(ui.progTimer){clearInterval(ui.progTimer);ui.progTimer=null;}
  ui.prog=on&&D.program&&D.program.nodes.length?{rt:newRuntime(),t:0,out:null,key:''}:null;
  if(ui.prog&&ui.progAuto!==false){let last=performance.now();ui.progTimer=setInterval(()=>{const n=performance.now(),dt=Math.min(200,n-last);last=n;progTick(dt);},PROG_MS);}}
function progTick(dt){const P=ui.prog;if(!P||!ui.sim)return;P.t+=dt;progLive();
  const lv=new Map((SIM?SIM.gpios:[]).map(g=>[g.p.id+'.'+g.q.id,{level:!g.powered||g.float?null:g.V>=2?1:g.V<=0.8?0:null,V:g.V}]));
  P.out=evalProgram(D,A0||analyze(false),D.program,P.rt,P.t,k=>lv.get(k)||null);
  const key=JSON.stringify([P.out.gpio,P.out.pwm]);if(key!==P.key){P.key=key;recompute();}}
let msgTimer;function flashMsg(m){const s=$('#status');s.textContent=m;s.style.color='var(--err)';clearTimeout(msgTimer);msgTimer=setTimeout(()=>{s.style.color='';status();},1800);}

document.addEventListener('keydown',ev=>{
  const t=ev.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))return;
  const k=ev.key.toLowerCase();
  if((ev.ctrlKey||ev.metaKey)&&k==='z'){ev.preventDefault();ev.shiftKey?redo():undo();return;}
  if((ev.ctrlKey||ev.metaKey)&&k==='y'){ev.preventDefault();redo();return;}
  if((ev.ctrlKey||ev.metaKey)&&k==='s'){ev.preventDefault();$('#bSaveFile').click();return;}
  if((ev.ctrlKey||ev.metaKey)&&k==='o'){ev.preventDefault();$('#bOpenFile').click();return;}
  if(ev.altKey&&k==='n'){ev.preventDefault();openNew();return;}
  if(ev.altKey&&!ev.ctrlKey&&['1','2','3'].includes(ev.key)){ev.preventDefault();applyLayout(LAYOUTS[+ev.key-1].id);return;}
  if(t&&t.closest&&t.closest('#progView,#partView,.pg,dialog'))return; // a program- és az alkatrész-szerkesztő, valamint a párbeszédablakok saját billentyűi
  if(ui.part&&!$('.app').classList.contains('part-split')&&!['1','2','3'].includes(ev.key)&&!(ev.ctrlKey||ev.metaKey))return; // az Alkatrész-szerkesztő látszik (panel nélkül): a panel billentyűi nem élnek
  if((ev.ctrlKey||ev.metaKey)&&k==='a'&&!ui.sim){ev.preventDefault();ui.sel=grp(D.parts.map(p=>p.id),D.bridges.map((b,i)=>i),D.wires.map((w,i)=>i));setTool('select');return;}
  if(ev.ctrlKey||ev.metaKey||ev.altKey)return;
  if(k==='escape'){ui.placing=null;ui.wireStart=null;ui.sel=null;if(ui.selLink){ui.selLink=null;renderLinks();}renderLeft();draw();status();return;}
  if(k==='s'){setSim(!ui.sim);return;}
  if(k==='f'){setView(cu()?'comp':'cu');return;}
  if(k==='n'){toggleRats();return;}
  if(k==='t'){rotView();return;}
  if(k==='0'){fitView();return;}
  if(k==='w'&&ev.shiftKey){$('#vStub').click();return;}
  if(['1','2','3'].includes(ev.key)&&!ev.shiftKey){const w=['board','prog','split'][+ev.key-1];if(w!=='split'||!MOB.matches)setWork(w);return;}
  if(k==='p'){bottomPanel();return;}
  if(ui.sim){const tool=TOOLS.find(x=>x[2].toLowerCase()===k&&SIM_TOOLS.has(x[0]));if(tool)setTool(tool[0]);return;}
  const tool=TOOLS.find(x=>x[2].toLowerCase()===k&&!(isSimple()&&ADV_TOOLS.has(x[0])));if(tool){setTool(tool[0]);return;}
  if(k==='r')rotate();else if(k==='m')mirror();else if(k==='delete'||k==='backspace')delSel();else if(k==='d'){const p=selPart();if(p)duplicate(p);}else if(k==='x'){toggleXray();}
});

/* ---------- Panelek ---------- */
let kbdEdit=0;
document.addEventListener('keydown',e=>{const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'))kbdEdit=Date.now();},true);
document.addEventListener('pointerdown',e=>{const t=e.target;if(t&&t.tagName==='INPUT'&&t.type==='number')kbdEdit=Date.now();},true);
function focusKey(){const a=document.activeElement;if(!a||a===document.body||Date.now()-kbdEdit>800)return null;if(a.id)return{id:a.id,v:a.type==='text'?a.selectionStart:null};if(a.dataset&&a.dataset.gpio)return{gpio:a.dataset.gpio};return null;}
function restoreFocus(k){if(!k)return;const el=k.id?document.getElementById(k.id):document.querySelector(`[data-gpio="${k.gpio}"]`);if(!el||el===document.activeElement)return;el.focus({preventScroll:true});try{if(k.v!=null)el.setSelectionRange(k.v,k.v);}catch(e){}}
function renderLeft(){const fk=focusKey();renderLeft0();toolFit();restoreFocus(fk);renderFab();sbUpdate();introUI();pwUpdate();undoUI();cursorUI();}
/* ---------- Mobil: alsó lapok és lebegő műveletgombok ---------- */
const MOB=window.matchMedia('(max-width:1000px)');
function sheet(name){const app=$('.app');app.classList.toggle('sheet-left',name==='left');app.classList.toggle('sheet-right',name==='right');
  document.querySelectorAll('#tabbar [data-sheet]').forEach(b=>{const on=b.dataset.sheet===(name||'');b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});}
const sheetOpen=()=>{const c=$('.app').classList;return c.contains('sheet-left')||c.contains('sheet-right');};
document.querySelectorAll('[data-sheet-close]').forEach(b=>b.addEventListener('click',()=>sheet('')));
$('#tabbar').addEventListener('click',e=>{const b=e.target.closest('[data-sheet]');if(!b)return;const n=b.dataset.sheet;sheet(b.classList.contains('on')&&n?'':n);});
function renderFab(){const f=$('#fab');if(!f)return;const B=(a,l,cls='')=>`<button class="btn ${cls}" data-fab="${a}">${l}</button>`;let h='';
  if(ui.sim)h='';
  else if(ui.placing)h=B('rot','⟳ Forgatás')+B('mir','⇋ Tükrözés')+B('esc','✕ Mégse');
  else if(ui.wireStart||ui.linkStart)h=B('esc','✕ Mégse');
  else if(ui.sel){const p=selPart();h=isGroup()&&ui.sel.parts.size?B('rot','⟳ Forgatás')+B('mir','⇋ Tükrözés')+(p?B('dup','⧉ Másolat')+B('props','⚙ Tulajdonságok'):''):'';h+=B('del','Törlés','danger');}
  f.innerHTML=h;f.hidden=!h;}
$('#fab').addEventListener('click',e=>{const b=e.target.closest('[data-fab]');if(!b)return;const a=b.dataset.fab;
  if(a==='rot')rotate();else if(a==='mir')mirror();else if(a==='del')delSel();else if(a==='dup')duplicate(selPart());
  else if(a==='props'){rtab('props',false);sheet('right');}
  else if(a==='esc'){ui.placing=null;ui.wireStart=null;ui.linkStart=null;ui.hover=null;setTool(ui.tool==='place'?'select':ui.tool);}
  renderFab();});
function paramUI(p){const def=DEFS[p.type].def,E=penv(p);let h=def.meta&&typeof def.meta.help==='string'?`<p class="help" style="margin:4px 0 8px">${esc(def.meta.help)}</p>`:'';
  for(const pr of def.params||[]){const k=pr.key,id='pp_'+k;
    if(pr.type==='span')h+=`<div class="row"><label>${esc(pr.label)}</label><input type="number" id="pp_dr" data-pk="dr" min="-12" max="12" value="${E.dr}" style="width:58px" aria-label="sor eltolás"><span class="muted small">sor</span><input type="number" id="pp_dc" data-pk="dc" min="-12" max="12" value="${E.dc}" style="width:58px" aria-label="oszlop eltolás"><span class="muted small">oszlop</span></div>`;
    else if(pr.type==='select')h+=`<div class="row"><label for="${id}">${esc(pr.label)}</label><select id="${id}" data-pk="${k}" style="flex:1;min-width:0">${pr.options.map(o=>`<option value="${esc(o.v)}" ${String(o.v)===String(E[k])?'selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;
    else if(pr.type==='color')h+=`<div class="row"><label>${esc(pr.label)}</label><div class="swatches" role="group" aria-label="${esc(pr.label)}">${pr.options.map(o=>`<button class="sw ${String(o.v)===String(E[k])?'on':''}" data-pk="${k}" data-pv="${esc(o.v)}" title="${esc(o.label)}" aria-label="${esc(o.label)}" style="background:${o.hex}"></button>`).join('')}</div></div>`;
    else if(pr.type==='names')h+=`<div class="row"><label for="${id}">${esc(pr.label)}</label><input type="text" id="${id}" data-pk="${k}" value="${esc(E[k]||'')}" placeholder="pl. GND,VCC,SDA,SCL" autocomplete="off" style="flex:1;min-width:0"></div>`;
    else if(pr.type==='value')h+=`<div class="row"><label for="${id}">${esc(pr.label)}</label><input type="text" id="${id}" data-pk="${k}" value="${fmtSI(E[k])}" inputmode="decimal" autocomplete="off" style="width:96px;flex:0 1 auto" title="Pl. 4,7k · 4k7 · 100n · 2.1 — ↑/↓: ${pr.series==='E12'?'E12-sor':'léptetés'}"><span class="muted small">${esc(pr.unit||'')}</span></div>`;
    else h+=`<div class="row"><label for="${id}">${esc(pr.label)}</label><input type="number" id="${id}" data-pk="${k}" value="${E[k]}" ${pr.min!=null?`min="${pr.min}"`:''} ${pr.max!=null?`max="${pr.max}"`:''} step="${pr.step||(pr.type==='int'?1:'any')}" style="width:80px"><span class="muted small">${esc(pr.unit||'')}</span></div>`;
    if(pr.help)h+=`<p class="help">${esc(tpl(pr.help,E))}</p>`;
  }return h;}
function bindParams(root,p){
  const def=DEFS[p.type].def,find=k=>(def.params||[]).find(x=>x.key===k)||((k==='dr'||k==='dc')?(def.params||[]).find(x=>x.type==='span'):null);
  const set=(k,raw)=>{const pr=find(k);if(!pr)return;let v;
    if(pr.type==='span')v=Math.round(+raw)||0;
    else if(pr.type==='value'){v=parseSI(raw);if(!isFinite(v)){flashMsg('Nem értelmezhető érték (pl. 4,7k · 4k7 · 100n)');renderLeft();return;}}
    else if(pr.type==='number'||pr.type==='int'){v=+raw;if(!isFinite(v)){renderLeft();return;}if(pr.type==='int')v=Math.round(v);}
    else if(pr.type==='names')v=String(raw).split(',').map(x=>x.trim()).join(',').replace(/,+$/,'');
    else{const o=pr.options.find(o=>String(o.v)===String(raw));v=o?o.v:raw;}
    if(typeof v==='number'&&pr.type!=='span'){if(pr.min!=null)v=Math.max(pr.min,v);if(pr.max!=null)v=Math.min(pr.max,v);}
    const t={...p,props:{...p.props,[k]:v}},geo=pr.geo||pr.type==='span';
    if(pr.type==='span'){const dr=+(t.props.dr??pr.default[0])||0,dc=+(t.props.dc??pr.default[1])||0;if(!dr&&!dc){flashMsg('A két láb nem lehet ugyanabban a lyukban');renderLeft();return;}}
    if(geo&&!partFits(t)){flashMsg('Ennyire nem lóghat ki (legalább egy láb a panelon, legfeljebb 8 lyuknyi túllógás)');renderLeft();return;}
    if(p.props[k]===v){renderLeft();return;}
    pushUndo();p.props[k]=v;if(geo)ui.moved=new Set([p.id]);commit(!geo);};
  root.querySelectorAll('[data-pk]').forEach(el=>{
    if(el.tagName==='BUTTON'){el.onclick=()=>set(el.dataset.pk,el.dataset.pv);return;}
    el.addEventListener('change',()=>set(el.dataset.pk,el.value));
    const pr=find(el.dataset.pk);
    if(pr&&pr.type==='value')el.addEventListener('keydown',ev=>{if(ev.key!=='ArrowUp'&&ev.key!=='ArrowDown')return;ev.preventDefault();const dir=ev.key==='ArrowUp'?1:-1,cur=parseSI(el.value);const base=isFinite(cur)?cur:pr.default;
      const nv=pr.series==='E12'?stepE12(base,dir):+(base+dir*(pr.step||Math.max(1e-6,Math.abs(base)*0.05))).toPrecision(4);el.value=fmtSI(nv);set(el.dataset.pk,el.value);});
  });
}
/** Lábak és bekötés: lábcsoportonként a szerep, a mostani bekötés (háló vagy kapcsolat) és a kapcsolat célja. */
function targetSelect(attr,id,cur,except){const ts=linkTargets(D,A0,except),groups=new Map();
  if(cur&&!ts.some(t=>t.value===cur)){const q=findPin(cur);ts.push({value:cur,label:q?groupLabel(q):cur,group:'Jelenlegi'});}
  for(const t of ts){if(!groups.has(t.group))groups.set(t.group,[]);groups.get(t.group).push(t);}
  return `<select ${attr}="${esc(id)}"><option value="">– nincs kapcsolat –</option>${[...groups].map(([g,xs])=>`<optgroup label="${esc(g)}">${xs.map(t=>`<option value="${esc(t.value)}" ${t.value===cur?'selected':''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('')}</select>`;}
function pinsUI(p){const rows=pinRows(D,A0,p),open=uiPref().pinsOpen!==false,nf=rows.filter(r=>r.floating&&r.on).length;
  return `<details class="pr-sec" id="pinsSec" ${open?'open':''}><summary>Lábak és bekötés <span class="muted small">${rows.length} láb${nf?` · <span class="c-warn">${nf} lebeg</span>`:''}</span></summary><div class="pins">${rows.map(r=>{
    const st=!r.on?'<span class="muted">a panelon kívül</span>':r.link?`<span class="muted">kapcsolat${(ui.linkState.get(r.link.id)||{}).ok?', bekötve':', <span class="c-err">nincs bekötve</span>'}</span>`:r.net.length?`<span class="muted" title="${esc(r.net.join(', '))}">háló: ${esc(r.net.slice(0,3).join(', '))}${r.net.length>3?` +${r.net.length-3}`:''}</span>`:'<span class="c-warn">lebeg (sehova sincs kötve)</span>';
    return `<div class="pin${r.floating&&r.on?' float':''}"><div class="pin-n"><b>${esc(r.name)}</b>${ROLE_HU[r.role]?`<span class="muted small"> ${esc(ROLE_HU[r.role])}</span>`:''}</div>${targetSelect('data-pinlink',r.ref,r.target||'',p.id)}<div class="pin-s small">${st}</div></div>`;}).join('')}</div></details>`;}
function bindPins(pr){const d=pr.querySelector('#pinsSec');if(d)d.addEventListener('toggle',()=>uiPrefSet({pinsOpen:d.open}));
  pr.querySelectorAll('[data-pinlink]').forEach(s=>s.addEventListener('change',()=>{pushUndo();if(!setPinLink(D,s.dataset.pinlink,s.value,()=>'l'+(D.seq++))){HIST.drop();renderLeft();return;}commit();}));}
/** Tulajdonság-művelet gomb: ikon + név, a gyorsbillentyű súgóban és Ctrl-címkén. */
const ACT=(id,ic,l,k,t='',cls='')=>`<button class="btn${cls}" id="${id}" data-kbd="${k}" title="${t?t+' ':''}(${k})">${icon(ic)}${l}</button>`;
/** Eszközsáv: ha a nevekkel nem fér ki (pl. Mindkettő nézetben), csak ikonok, de minden eszköz látszik. */
function toolFit(){const ts=$('#toolstrip'),t=$('#tools');if(!ts||!t||ts.classList.contains('col'))return;ts.classList.remove('icons');if(t.scrollWidth>t.clientWidth+1)ts.classList.add('icons');}
new ResizeObserver(()=>toolFit()).observe(document.querySelector('#carea'));
function renderLeft0(){
  $('#tools').innerHTML=TOOLS.filter(x=>!(isSimple()&&ADV_TOOLS.has(x[0]))).map(([id,l,k,ic,h])=>`<button class="btn tool ${ui.tool===id&&!ui.placing?'on':''}" data-tool="${id}" title="${l} (${k}) – ${h}" aria-label="${l}" aria-keyshortcuts="${k}" ${ui.sim&&!SIM_TOOLS.has(id)?'disabled':''}><span class="ti">${icon(ic)}<kbd>${k}</kbd></span><span class="tl">${l}</span></button>`).join('');
  renderLib();
  $('#wireColorRow').hidden=ui.tool!=='wire'||!!ui.placing;
  $('#cutKindRow').hidden=ui.tool!=='cut'||!!ui.placing;
  {const ck=cutKind();$('#cutKinds').innerHTML=CUT_KINDS.map(([k,l,t])=>`<button class="btn ${ck===k?'on':''}" data-ck="${k}" aria-pressed="${ck===k}" title="${t}">${l}</button>`).join('');}
  {const g=isGroup()?ui.sel:null,sp=selPart();$('#selSumm').textContent=sp?sp.label:g&&gSize(g)?`${gSize(g)} elem`:ui.sel&&ui.sel.kind==='wire'?'vezeték':ui.sel&&ui.sel.kind==='bridge'?'híd':ui.sel&&ui.sel.kind==='note'?'jegyzet':'';}
  $('#swatches').innerHTML=WCOL.map(([c,l])=>`<button class="sw ${ui.wireColor===c?'on':''}" data-col="${c}" title="${l}" aria-label="${l}" style="background:${c}"></button>`).join('');
  const pr=$('#props');const p=selPart();
  if(p){const d=DEFS[p.type];const extra=paramUI(p);
    pr.innerHTML=`<div class="row"><label for="pLabel">Név</label><input type="text" id="pLabel" value="${esc(p.label)}"></div>
      <div class="small muted">${d.name} · origó <span class="mono">${p.r}:${p.c}</span> · ${p.rot*90}°${p.mir?' · tükrözve':''}</div>
      <div class="pr-acts">${ACT('pRot','rotate','Forgatás','R')}${ACT('pMir','mirror','Tükrözés','M')}${ACT('pDup','copy','Duplikálás','D','Új példány ugyanezekkel a beállításokkal')}${ACT('pDel','trash','Törlés','Del','',' danger')}</div>
      <label class="check small"><input type="checkbox" id="pXray" ${p.xray?'checked':''}> Röntgen (csak körvonal és lábak)</label>${extra}
      ${pinsUI(p)}
      <div class="pr-more" id="pMore"></div>`;
    const ch=(id,fn)=>{const e=$(id);if(e)e.addEventListener('change',()=>{pushUndo();fn(e.value);commit();});};
    ch('#pLabel',v=>p.label=v.trim()||p.label);
    bindParams(pr,p);bindPins(pr);
    $('#pRot').onclick=rotate;$('#pMir').onclick=mirror;$('#pDel').onclick=delSel;
    const more=$('#pMore');
    {$('#pDup').onclick=()=>duplicate(p);$('#pXray').onchange=e=>{pushUndo();if(e.target.checked)p.xray=true;else delete p.xray;commit(true);};}
    {const row=more;const own=!(p.type in PARTS);row.innerHTML=own?'<button class="btn" data-adv id="pEditDef">✎ Alkatrész szerkesztése</button>':'<button class="btn" data-adv id="pCopyDef" title="A beépített leírásból saját, szerkeszthető alkatrész">Másolat saját alkatrészként</button>';pr.appendChild(row);
      if(own)$('#pEditDef').onclick=()=>openEditor(editorHost,{type:p.type});else $('#pCopyDef').onclick=()=>openEditor(editorHost,{from:PARTS[p.type]});}
    {more.insertAdjacentHTML('beforeend','<button class="btn" id="pToAuto" title="Az alkatrész kézi bekötését kapcsolatokká alakítja, így mozgatáskor követi">Bekötés automatikusra</button>');
      $('#pToAuto').onclick=()=>{if(!manualToAuto(p.id))flashMsg('Ennek az alkatrésznek nincs kézi bekötése');};}
    if(isMcu(p)){const ts=Object.entries(DEFS).filter(([k,d])=>d.mcu&&k!==p.type);if(ts.length){const row=document.createElement('div');row.className='row';
      row.innerHTML=`<label for="pSwap">Csere</label><select id="pSwap" style="flex:1">${ts.map(([k,d])=>`<option value="${k}">${esc(d.name)}</option>`).join('')}</select><button class="btn" id="pSwapGo" title="Másik vezérlőre cseréli; a kapcsolatok megmaradnak, a GPIO-k újra kiosztódnak">Csere</button>`;pr.appendChild(row);
      $('#pSwapGo').onclick=()=>{const r=swapMcu(p.id,$('#pSwap').value);if(r)flashMsg(r.msg);};}}
    if(isOff(p)){const h=plugOf(D,p),row=document.createElement('div');row.className='row';
      row.innerHTML=h?`<span class="small">Csatlakozó: <b>${esc(h.label)}</b> (tüskesor a panelon)</span><button class="btn" id="pUnplug" title="A kábel kihúzása: a tüskesor a panelon marad, a lábak szabad kábelként köthetők be">Kihúzás</button>`
        :`<button class="btn" id="pPlug" title="Tüskesor a panelra a lábszámával és lábneveivel; a kábel abba dugva, a bekötés onnan indul">Csatlakozó (tüskesor) a panelra</button>`;pr.appendChild(row);
      if(h)$('#pUnplug').onclick=()=>{pushUndo();delete p.plug;commit();};
      else $('#pPlug').onclick=()=>{pushUndo();const nh=attachPlug(p);if(!nh){HIST.drop();flashMsg('Nincs elég szabad hely a panelon a csatlakozónak');return;}commit();flashMsg(`${nh.label}: a csatlakozó a panelon, a kábel bedugva. Mozgasd oda, ahová forrasztanád.`);};}
    if(DEFS[p.type].def.socket){const o=pluggedInto(D,p),offs=D.parts.filter(x=>isOff(x)&&!plugOf(D,x)&&DEFS[x.type].pins(x).length<=DEFS[p.type].pins(p).length);
      const row=document.createElement('div');row.className='row';
      row.innerHTML=o?`<span class="small">Ide csatlakozik: <b>${esc(o.label)}</b> (${esc(DEFS[o.type].name)}). A lábak sorrendje a kábelé.</span>`
        :offs.length?`<label for="pPlugTo">Kábel</label><select id="pPlugTo" style="flex:1">${offs.map(x=>`<option value="${x.id}">${esc(x.label)} · ${esc(DEFS[x.type].name)}</option>`).join('')}</select><button class="btn" id="pPlugGo" title="A külső alkatrész kábele ebbe a csatlakozóba">Bedugás</button>`
        :`<span class="help">Csatlakozó: külső alkatrész (motor, szervó, szenzor) kábele dugható bele. A lábnevek a feliratokhoz valók.</span>`;
      pr.appendChild(row);
      if(!o&&offs.length)$('#pPlugGo').onclick=()=>{const x=D.parts.find(y=>y.id===$('#pPlugTo').value);if(!x)return;pushUndo();x.plug=p.id;const sp=DEFS[p.type].def.socket;if(sp.names&&!p.props[sp.names])p.props[sp.names]=socketProps(DEFS[p.type].def,x)[sp.names];commit();};}
    if(p.type==='button'){more.insertAdjacentHTML('afterbegin','<button class="btn" id="pAuto" title="Kapcsolatok: az A láb szabad GPIO-ra, a B láb a földre">A → GPIO, B → GND</button>');
      $('#pAuto').onclick=()=>{const a=p.id+'.A1',b=p.id+'.B1';pushUndo();if(!D.links.some(l=>l.a===a))D.links.push({id:'l'+(D.seq++),a,b:'GPIO'});if(!D.links.some(l=>l.a===b))D.links.push({id:'l'+(D.seq++),a:b,b:'GND'});commit();};}
  } else if(isGroup()&&gSize(ui.sel)){const g=ui.sel;
    pr.innerHTML=`<div class="small"><b>${g.parts.size}</b> alkatrész, <b>${g.bridges.size}</b> kézi híd, <b>${g.wires.size}</b> vezeték kijelölve</div>
      <div class="small muted">Húzással együtt mozognak. Shift+kattintás: hozzáadás/elvétel.</div>
      <div class="pr-acts">${ACT('gRot','rotate','Forgatás','R')}${ACT('gMir','mirror','Tükrözés','M')}${ACT('gDel','trash','Törlés','Del','',' danger')}</div>
      ${g.parts.size?'<div class="pr-more"><button class="btn" id="gAuto">Bekötés automatikusra</button><button class="btn" id="gXray">Röntgen be/ki</button></div>':''}`;
    if($('#gXray'))$('#gXray').onclick=()=>{pushUndo();const ps=D.parts.filter(p=>g.parts.has(p.id));const on=!ps.every(p=>p.xray);ps.forEach(p=>{if(on)p.xray=true;else delete p.xray;});commit(true);};
    $('#gRot').onclick=rotate;$('#gMir').onclick=mirror;$('#gDel').onclick=delSel;
    if($('#gAuto'))$('#gAuto').onclick=()=>{if(!manualToAuto(new Set(g.parts)))flashMsg('A kijelölésnek nincs kézi bekötése');};
  } else if(ui.sel&&ui.sel.kind==='wire'){const w=D.wires[ui.sel.i];
    pr.innerHTML=`<div class="small">Vezeték <span class="mono">${w.a.join(':')} → ${w.b.join(':')}</span></div><div class="swatches">${WCOL.map(([c,l])=>`<button class="sw ${w.color===c?'on':''}" data-wcol="${c}" title="${l}" aria-label="${l}" style="background:${c}"></button>`).join('')}</div><div class="row"><button class="btn danger" id="pDel">Törlés</button></div>`;
    pr.querySelectorAll('[data-wcol]').forEach(b=>b.onclick=()=>{pushUndo();w.color=b.dataset.wcol;commit();});$('#pDel').onclick=delSel;
  } else if(ui.sel&&ui.sel.kind==='note'&&(D.notes||[]).some(n=>n.id===ui.sel.id)){const n=D.notes.find(x=>x.id===ui.sel.id);
    pr.innerHTML=`<div class="small">Jegyzet <span class="muted">(nem villamos elem)</span></div>
      <textarea id="nText" class="note-text" rows="6" spellcheck="true" aria-label="Jegyzet szövege">${esc(n.text)}</textarea>
      <p class="help" style="margin:2px 0 6px">Új sor: Enter. <code># Cím</code> sor félkövér címsor. Méret: húzd a jobb alsó sarkát, vagy add meg.</p>
      <div class="row nowrap"><label for="nW">Méret</label><input type="number" id="nW" min="3" max="60" value="${n.w}" aria-label="szélesség"><span class="muted small">×</span><input type="number" id="nH" min="2" max="60" value="${n.h}" aria-label="magasság"><span class="muted small">lyuk</span></div>
      <div class="row"><label>Szín</label><div class="swatches">${NOTE_COL.map(([c,l])=>`<button class="sw ${n.color===c?'on':''}" data-ncol="${c}" title="${l}" aria-label="${l}" style="background:${c}"></button>`).join('')}</div></div>
      <div class="row"><label for="nTarget" title="Szaggatott nyíl a jegyzettől az alkatrészig; csak jelölés, nem kapcsolat">Mutat</label><select id="nTarget" style="flex:1"><option value="">– semmire –</option>${D.parts.map(p=>`<option value="${p.id}" ${n.target===p.id?'selected':''}>${esc(p.label)} · ${esc(DEFS[p.type].name)}</option>`).join('')}</select></div>
      <div class="row"><button class="btn danger" id="pDel">Törlés</button></div>`;
    let undoPushed=false;const ta=$('#nText');
    ta.addEventListener('input',()=>{if(!undoPushed){pushUndo();undoPushed=true;}n.text=ta.value;save();draw();});
    const sz=()=>{pushUndo();n.w=Math.max(3,Math.min(60,+$('#nW').value||n.w));n.h=Math.max(2,Math.min(60,+$('#nH').value||n.h));save();draw();};
    $('#nW').onchange=sz;$('#nH').onchange=sz;
    pr.querySelectorAll('[data-ncol]').forEach(b=>b.onclick=()=>{pushUndo();n.color=b.dataset.ncol;save();renderLeft();draw();});
    $('#nTarget').onchange=e=>{pushUndo();n.target=e.target.value||null;save();draw();};$('#pDel').onclick=delSel;
  } else if(ui.sel&&ui.sel.kind==='bridge'){const b=D.bridges[ui.sel.i];
    pr.innerHTML=`<div class="small">Híd <span class="mono">${b[0]}:${b[1]} – ${b[2]}:${b[3]}</span></div><div class="row"><button class="btn danger" id="pDel">Törlés</button></div>`;$('#pDel').onclick=delSel;
  } else if(ui.linkStart){const q=findPin(ui.linkStart);
    pr.innerHTML=`<div class="small">Kapcsolat innen: <b class="mono">${q?esc(pinLabel(q)):'?'}</b></div><div class="small muted">Kattints a cél lábra, vagy válassz:</div><div class="row"><button class="btn" id="lkGnd">→ GND</button><button class="btn" id="lkGpio">→ szabad GPIO</button><button class="btn" id="lkNo">Mégse</button></div>`;
    $('#lkGnd').onclick=()=>{addLink(ui.linkStart,'GND');ui.linkStart=null;renderLeft();};$('#lkGpio').onclick=()=>{addLink(ui.linkStart,'GPIO');ui.linkStart=null;renderLeft();};$('#lkNo').onclick=()=>{ui.linkStart=null;renderLeft();draw();};
  } else pr.innerHTML=`<span class="muted small">${ui.tool==='link'&&!ui.placing?'Kattints egy lábra, majd a cél lábra (vagy GND / szabad GPIO).':''}${ui.placing?`Lerakás: <b>${DEFS[ui.placing].name}</b>${ui.ghost.from?` (${esc(ui.ghost.from)} másolata)`:''}. Kattints a panelra; Shift+kattintással több példány.`:ui.tool==='bridge'?'Húzd az egeret szomszédos lyukakon át: minden szekcióhatárnál híd keletkezik.':ui.tool==='wire'?'Kattints a kezdő, majd a cél lyukra.':ui.tool==='erase'?'Kattints vagy húzz a törlendő elemen.':'Kattints egy alkatrészre, vezetékre vagy hídra. Shift+kattintás vagy keret húzása üres helyen: több elem. Ctrl+A: minden.'}</span>`;
}
$('#tools').addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(b){setTool(b.dataset.tool);if(MOB.matches)sheet('');}});
$('#lib').addEventListener('click',e=>{const ed=e.target.closest('[data-edit]');if(ed){openEditor(editorHost,{type:ed.dataset.edit});return;}
  const fv=e.target.closest('[data-fav]');if(fv){libFavToggle(fv.dataset.fav);renderLib();return;}
  const tl=e.target.closest('[data-tolib]');if(tl){toLibrary(tl.dataset.tolib);return;}const b=e.target.closest('[data-lib]');if(!b)return;const t=b.dataset.lib;ui.placing=ui.placing===t?null:t;ui.ghost={rot:0,mir:false};ui.sel=null;ui.wireStart=null;renderLeft();draw();if(MOB.matches&&ui.placing){sheet('');flashHint('Érintsd meg a panelt, húzd a helyére, és engedd fel');}});
$('#cutKinds').addEventListener('click',e=>{const b=e.target.closest('[data-ck]');if(b){uiPrefSet({cutKind:b.dataset.ck});renderLeft();draw();}});
$('#swatches').addEventListener('click',e=>{const b=e.target.closest('[data-col]');if(b){ui.wireColor=b.dataset.col;renderLeft();}});

function renderRight(){const fk=focusKey();renderRight0();restoreFocus(fk);}
function renderRight0(){
  const ne=ISSUES.filter(i=>i.sev==='err').length,nw=isSimple()?0:ISSUES.filter(i=>i.sev==='warn').length,np=ne+nw;
  for(const t of [$('#tabIss'),$('#bpIssN')]){t.textContent=np?String(np):'';t.classList.toggle('err',ne>0);}
  const SO={err:0,warn:1,info:2},SHOWN=ISSUES.map((x,i)=>[x,i]).filter(([x])=>!isSimple()||x.sev==='err'); // egyszerű módban csak a hibák
  $('#issues').innerHTML=SHOWN.length?SHOWN.sort((a,b)=>SO[a[0].sev]-SO[b[0].sev]).map(([x,i])=>`<li data-i="${i}" class="c-${x.sev}"><span class="dot"></span><span style="color:var(--fg)">${esc(x.msg)}</span></li>`).join(''):'<li class="muted" style="cursor:default">Nincs zárlat vagy bekötési hiba.</li>';
  $('#usb').checked=!!D.settings.usb;
  $('#mHold').classList.toggle('on',D.settings.btnMode!=='toggle');$('#mToggle').classList.toggle('on',D.settings.btnMode==='toggle');
  let h='';
  renderSliders();
  if(!SIM){$('#simOut').innerHTML='';return;}
  const pcs=SIM.picos;
  if(pcs.length)h+=pcs.map(pc=>`<div class="small">${esc(pc.p.label)}: ${pc.powered?'<span class="c-ok">táp van</span>':'<span class="c-err">nincs táp</span>'}${pc.usb?' (USB)':''}</div>`).join('');
  else h+='<div class="small muted">Nincs vezérlő (Pico, ESP32) a panelon.</div>';
  // gombteszt
  const A=ui.sim?AS:A0;const btns=D.parts.filter(p=>hasPress(p));
  if(btns.length&&pcs.length){h+=`<table class="tbl" style="margin-top:8px"><thead><tr><th>Gomb</th><th>GPIO</th><th>Állapot</th><th>Olvas</th></tr></thead><tbody>`;
    for(const b of btns){const m=A0.byPart.get(b.id).map;let gq=null;for(const id of (DEFS[b.type].def.controls.find(c=>c.kind==='press').closes[0])){gq=(A0.netPins.get(m[id].net)||[]).find(q=>isMcu(q.part)&&q.role==='gpio');if(gq)break;}
      const g=gq&&SIM.gpios.find(x=>x.q.part===gq.part&&x.q.id===gq.id);const l=g?logic(g):'–';
      h+=`<tr><td>${esc(b.label)}</td><td>${gq?gq.name:'—'}</td><td>${ui.pressed[b.id]?'<b>lenyomva</b>':'fel'}</td><td><span class="lv ${l==='1'?'lv1':l==='0'?'lv0':'lvq'}">${l}</span></td></tr>`;}
    h+='</tbody></table>';
    if(!ui.sim)h+='<p class="help" style="margin-top:6px">Indítsd a szimulációt, és kattints a gombokra a panelon.</p>';}
  // GPIO-k
  const used=SIM.gpios.filter(g=>{const net=A.pins.find(q=>q.part===g.q.part&&q.id===g.q.id).net;return (A0.netPins.get(A0.pins.find(q=>q.part===g.q.part&&q.id===g.q.id).net)||[]).length>1||(A0.netSecs.get(A0.pins.find(q=>q.part===g.q.part&&q.id===g.q.id).net)||0)>1;});
  if(used.length){h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>GPIO</th><th>Mód</th><th>U</th><th>Szint</th></tr></thead><tbody>`;
    for(const g of used){const key=g.p.id+'.'+g.q.id,l=logic(g);
      h+=`<tr><td title="${esc(pinFns(g.q).join(', '))}">${g.q.name}</td><td><select data-gpio="${key}" aria-label="${g.q.name} mód">${GPIO_MODES.filter(x=>gpioModeOk(g.q,x[0])).map(([v,t])=>`<option value="${v}" ${g.mode===v?'selected':''}>${t}</option>`).join('')}</select></td><td>${g.powered&&!g.float?g.V.toFixed(2):'–'}</td><td><span class="lv ${l==='1'?'lv1':l==='0'?'lv0':'lvq'}">${l}</span>${Math.abs(g.I)>1e-4?` <span class="muted">${(Math.abs(g.I)*1000).toFixed(1)} mA</span>`:''}</td></tr>`
      if(g.mode==='pwm'){const c=pwmCfg(key),sid=key.replace('.','_');h+=`<tr class="pwmrow"><td></td><td colspan="3"><label class="small" for="pwmd_${sid}">kitöltés</label> <input type="number" id="pwmd_${sid}" data-pwm="${key}" data-pf="duty" min="0" max="100" step="1" value="${c.duty}" style="width:58px"> % <label class="small" for="pwmf_${sid}">frekv.</label> <input type="number" id="pwmf_${sid}" data-pwm="${key}" data-pf="freq" min="1" max="100000" step="1" value="${c.freq}" style="width:76px"> Hz <span class="small muted" title="${+c.freq<BLINK_HZ?'Lassú PWM: a panelon valós időben villog; a táblázat az átlagot mutatja.':'Gyors PWM: a szem az átlagot látja, a szimuláció is átlagol.'}">${+c.freq<BLINK_HZ?'· villog':'· átlagolva'}</span></td></tr>`;}}
    h+='</tbody></table>';}
  const lights=SIM.leds.filter(l=>l.light);
  if(SIM.fets.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>FET</th><th>U<sub>GS</sub></th><th>I<sub>D</sub></th><th>Állapot</th></tr></thead><tbody>`+SIM.fets.map(f=>`<tr><td>${esc(f.p.label)}</td><td>${f.floatGate?'lebeg':f.vgs.toFixed(2)+' V'}</td><td>${fmtSI(Math.abs(f.I))}A</td><td>${f.on?'<span class="c-ok">nyitva</span>':'<span class="muted">zárva</span>'}</td></tr>`).join('')+'</tbody></table>';
  if(lights.length){h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>LED</th><th>Áram</th><th>Állapot</th></tr></thead><tbody>`+lights.map(l=>`<tr><td>${esc(l.p.label)}</td><td>${(l.I*1000).toFixed(2)} mA</td><td>${l.I>2e-4?'<span class="c-ok">világít</span>':'<span class="muted">sötét</span>'}</td></tr>`).join('')+'</tbody></table>';}
  const BST={off:'<span class="muted">zárva</span>',act:'<span class="c-warn">aktív</span>',sat:'<span class="c-ok">telítve</span>'};
  if(SIM.bjts.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>NPN</th><th>I<sub>B</sub></th><th>I<sub>C</sub></th><th>U<sub>CE</sub></th><th>Állapot</th></tr></thead><tbody>`+SIM.bjts.map(t=>`<tr><td>${esc(t.p.label)}</td><td>${t.floatBase?'lebeg':fmtSI(t.ib)+'A'}</td><td>${fmtSI(Math.abs(t.ic))}A</td><td>${t.vce.toFixed(2)} V</td><td>${BST[t.st]}</td></tr>`).join('')+'</tbody></table>';
  if(SIM.caps.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>Kond.</th><th>U</th><th title="Időállandó: ennyi idő alatt töltődik fel kb. 63%-ra, 5τ alatt teljesen">τ</th></tr></thead><tbody>`+SIM.caps.map(k=>`<tr><td>${esc(k.p.label)} <span class="muted">${fmtSI(k.f)}F</span></td><td>${k.float?'–':k.U.toFixed(2)+' V'}</td><td>${k.tau!=null?fmtSI(k.tau)+'s':'<span class="muted">nincs töltőút</span>'}</td></tr>`).join('')+'</tbody></table>';
  const LVC=v=>v===1?'lv1':v===0?'lv0':'lvq',LVT=v=>v==='z'?'Z':v==='X'?'?':String(v);
  if(SIM.logics.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>Logika</th><th>Bemenet</th><th>Kimenet</th></tr></thead><tbody>`+SIM.logics.map(L=>`<tr><td>${esc(L.p.label)}${L.vdd<1?'<br><span class="c-err small">nincs táp</span>':''}</td><td class="lgcells">${L.ins.map(x=>`<span title="${esc(x.name)}${x.open?' (lebeg)':''}">${esc(x.name)}<span class="lv ${LVC(x.lv)}">${LVT(x.lv)}</span></span>`).join(' ')}</td><td class="lgcells">${L.outs.map(o=>`<span>${esc(o.name)}<span class="lv ${LVC(o.st)}">${LVT(o.st)}</span></span>`).join(' ')}${L.regs.length?`<div class="small muted" style="margin-top:2px">tárolók: ${L.regs.map(r=>`<span>${esc(r.name)}<span class="lv ${LVC(r.val)}">${LVT(r.val)}</span></span>`).join(' ')}</div>`:''}</td></tr>`).join('')+'</tbody></table>';
  if(SIM.motors.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>Motor</th><th>U</th><th>I</th><th>Fordulat</th></tr></thead><tbody>`+SIM.motors.map(m=>`<tr><td>${esc(m.p.label)}</td><td>${m.U.toFixed(2)} V</td><td>${fmtSI(Math.abs(m.I))}A</td><td>${Math.abs(m.speed)<0.02?'<span class="muted">áll</span>':`${Math.round(Math.abs(m.speed)*100)} %${m.speed<0?' ↺':''}`}</td></tr>`).join('')+'</tbody></table>';
  if(SIM.steppers.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>Léptető</th><th>Tekercs</th><th>Lépés</th><th>Tengely</th></tr></thead><tbody>`+SIM.steppers.map(s=>`<tr><td>${esc(s.p.label)}</td><td>${s.coils||'<span class="muted">–</span>'}</td><td>${s.pos}</td><td>${s.angle.toFixed(1)}°</td></tr>`).join('')+'</tbody></table>';
  if(SIM.servos.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>Szervó</th><th>U</th><th>Jel</th><th>Szög</th></tr></thead><tbody>`+SIM.servos.map(s=>`<tr><td>${esc(s.p.label)}</td><td>${s.U.toFixed(2)} V</td><td>${s.pulse!=null?s.pulse.toFixed(2)+' ms':'–'}</td><td>${s.angle!=null&&s.U>3?Math.round(s.angle)+'°':'<span class="muted">–</span>'}</td></tr>`).join('')+'</tbody></table>';
  const batt=SIM.bats.filter(b=>b.kind!=='supply');
  if(batt.length)h+=batt.map(b=>`<div class="small" style="margin-top:6px">${esc(b.p.label)}: ${b.I>1e-4?'töltődik':b.I<-1e-4?'merül':'nincs terhelés'} ${Math.abs(b.I)>1e-4?`(${(Math.abs(b.I)*1000).toFixed(1)} mA)`:''}</div>`).join('');
  $('#simOut').innerHTML=h;
}
$('#issues').addEventListener('click',e=>{const li=e.target.closest('[data-i]');if(!li)return;const x=ISSUES[+li.dataset.i];if(!x.holes.length)return;ui.flash={holes:x.holes,until:performance.now()+2200};
  const [r,c]=x.holes[0],sc=$('#scroll'),[vx,vy]=toScreen(hx(c),hy(r));sc.scrollTo({left:vpX(vx)-sc.clientWidth/2,top:vpY(vy)-sc.clientHeight/2,behavior:'smooth'});
  const tick=()=>{draw();if(performance.now()<ui.flash.until)requestAnimationFrame(tick);else draw();};tick();});
/* csúszka-vezérlők (pl. joystick-tengely): külön tárolóban, hogy húzás közben ne épüljön újra */
const sliders=()=>D.parts.flatMap(p=>(DEFS[p.type].def.controls||[]).filter(c=>c.kind==='slider').map(c=>({p,c,pr:(DEFS[p.type].def.params||[]).find(x=>x.key===c.key)})).filter(x=>x.pr));
function renderSliders(){const ss=sliders(),el=$('#simCtl');
  const sig=ss.map(({p,c})=>p.id+':'+p.label+':'+c.key).join('|');
  if(el.dataset.sig===sig){for(const {p,c,pr} of ss){const k=p.id+'|'+c.key,v=penv(p)[c.key],i=el.querySelector(`[data-sl="${k}"]`),o=el.querySelector(`[data-slv="${k}"]`);if(i&&i!==document.activeElement)i.value=v;if(o)o.textContent=v+(pr.unit?' '+pr.unit:'');}return;}
  el.dataset.sig=sig;
  el.innerHTML=ss.length?`<p class="small muted" style="margin:8px 0 2px">Vezérlők</p>`+ss.map(({p,c,pr})=>{const v=penv(p)[c.key],k=p.id+'|'+c.key;
    return `<div class="row slider"><label for="sl_${p.id}_${c.key}">${esc(p.label)} ${esc(c.label||pr.label)}</label><input type="range" id="sl_${p.id}_${c.key}" data-sl="${k}" min="${pr.min}" max="${pr.max}" step="${pr.step||1}" value="${v}"><output data-slv="${k}">${v}${pr.unit?' '+esc(pr.unit):''}</output></div>`;}).join(''):'';}
/* ---------- Jelsorozat: GPIO-kimenetek léptetése előre megadott minták szerint (pl. léptetőmotor) ---------- */
function setSlider(p,key,v){const pr=(DEFS[p.type].def.params||[]).find(x=>x.key===key);if(!pr)return false;v=Math.max(pr.min,Math.min(pr.max,+v||0));p.props={...p.props,[key]:v};
  SIM=simulate(AS);ISSUES=checkAll();renderRight();draw();save();return true;}
$('#simCtl').addEventListener('input',e=>{const t=e.target.closest('[data-sl]');if(!t)return;const [pid,key]=t.dataset.sl.split('|');const p=D.parts.find(x=>x.id===pid);if(p)setSlider(p,key,t.value);});
$('#simOut').addEventListener('change',e=>{const w=e.target.closest('[data-pwm]');if(w){const v=+w.value;if(!isFinite(v))return;pushUndo();const k=w.dataset.pwm,c=pwmCfg(k);
    c[w.dataset.pf]=w.dataset.pf==='duty'?Math.max(0,Math.min(100,v)):Math.max(1,Math.min(100000,v));D.pwm={...(D.pwm||{}),[k]:c};commit();return;}
  const s=e.target.closest('[data-gpio]');if(!s)return;pushUndo();D.gpio[s.dataset.gpio]=s.value;commit();});
$('#usb').addEventListener('change',e=>{pushUndo();D.settings.usb=e.target.checked;commit();});
$('#mHold').onclick=()=>{D.settings.btnMode='hold';ui.pressed={};save();recompute();};
$('#mToggle').onclick=()=>{D.settings.btnMode='toggle';save();recompute();};

function status(){
  const s=$('#status'),h=ui.hover;if(ui.selLink&&(!h||!inb(h.r,h.c))){const t=linkStatusText();if(t){s.textContent=t;return;}}if(!h||!inb(h.r,h.c)){const ab=D.auto.bridges.length,aw=D.auto.wires.length;s.textContent=`${D.parts.length} alkatrész · ${D.bridges.length+ab} híd · ${D.wires.length+aw} vezeték`;return;}
  const A=ui.sim?AS:A0,root=A.find(A.sid(h.r,h.c)),qs=A.netPins.get(root)||[],sg=segOf(h.r,h.c);
  let t=sg.drilled?`${h.r}:${h.c} · kifúrt lyuk (nincs réz)`:`${h.r}:${h.c} · ${D.board.sec>=D.board.rows||sg.r1-sg.r0+1<Math.min(D.board.sec,D.board.rows-sg.r0)?'csík':'szekció'} ${sg.r0}–${sg.r1}:${h.c}`;
  if(qs.length)t+=` · net: ${qs.slice(0,7).map(pinLabel).join(', ')}${qs.length>7?` +${qs.length-7}`:''}`;
  {const here=A.pins.find(q=>q.on&&q.r===h.r&&q.c===h.c);if(here&&isMcu(here.part)&&here.role==='gpio'){const f=pinFns(here);if(f.length)t+=` · ${here.name}: ${f.join(', ')}`;}else if(here&&here.fn)t+=` · ${pinLabel(here)}: ${fnName(here.fn)}`;}
  if(ui.sim&&SIM&&qs.length)t+=SIM.floating.has(root)?' · lebeg':` · ${(SIM.netV.get(root)||0).toFixed(2)} V`;
  s.textContent=t;
}
function recompute(){A0=analyze(false);AS=ui.sim?analyze(true):A0;SIM=simulate(AS);ui.simGen=(ui.simGen||0)+1;ui.blinkSim=null;linkStates();ISSUES=checkAll();renderRight();renderLinks();status();sbUpdate();introUI();draw();animate();blink();}
/* lassú PWM (BLINK_HZ alatt): a kijelzés valós időben követi a magas/alacsony szakaszokat; az ellenőrzés és a panel az átlagot mutatja */
const slowPwm=()=>{const out=[];if(!ui.sim||!AS)return out;for(const p of D.parts){if(!isMcu(p))continue;for(const q of AS.byPart.get(p.id).pins)if(q.role==='gpio'&&gpioMode(p,q.id,q,AS)==='pwm'){const k=p.id+'.'+q.id,c=pwmCfg(k);if(+c.freq<BLINK_HZ)out.push({key:k,freq:+c.freq,duty:+c.duty||0});}}return out;};
function blink(){if(ui.blinkOn||!slowPwm().length)return;ui.blinkOn=true;const t0=performance.now();let last=null;
  const stop=()=>{ui.blinkOn=false;ui.blinkSim=null;draw();};
  const step=t=>{if(!ui.sim)return stop();const sl=slowPwm();if(!sl.length)return stop();
    const s=(t-t0)/1000,hi=new Set(sl.filter(x=>((s*x.freq)%1)<x.duty/100).map(x=>x.key)),key=[...hi].sort().join('|')+'#'+ui.simGen;
    if(key!==last){last=key;ui.blinkSim=simulate(AS,hi);draw();}
    requestAnimationFrame(step);};
  requestAnimationFrame(step);}
/* motorok forgása szimuláció közben (kb. 30 kép/s, csak amíg valami forog) */
function animate(){if(ui.anim||!ui.sim||!SIM||!SIM.motors.some(m=>Math.abs(m.speed)>0.02))return;ui.anim=true;let last=performance.now();
  const step=t=>{if(!ui.sim||!SIM||!SIM.motors.some(m=>Math.abs(m.speed)>0.02)){ui.anim=false;return;}
    if(t-last>=33){const dt=Math.min(0.2,(t-last)/1000);last=t;for(const m of (ui.blinkSim||SIM).motors)ui.phase[m.p.id]=((ui.phase[m.p.id]||0)+m.speed*dt*2*Math.PI*1.5)%(2*Math.PI);draw();}
    requestAnimationFrame(step);};requestAnimationFrame(step);}

/* ---------- Felső sáv ---------- */
$('#vRats').onclick=()=>toggleRats();
$('#vRot').onclick=()=>rotView();
$('#vXray').onclick=()=>toggleXray();
function toggleXray(){ui.xray=!ui.xray;$('#vXray').classList.toggle('on',ui.xray);draw();}
function rotView(){D.settings.vrot=(VR()+1)&3;save();resize();homeView();}
$('#vComp').onclick=()=>setView('comp');$('#vCu').onclick=()=>setView('cu');
$('#zIn').onclick=()=>zoomTo(ui.zoom*1.2);$('#zOut').onclick=()=>zoomTo(ui.zoom/1.2);$('#zLbl').onclick=()=>fitView();$('#zFit').onclick=()=>fitView();
$('#bUndo').onclick=undo;$('#bRedo').onclick=redo;
$('#bSim').onclick=()=>setSim(!ui.sim);
function simBtn(){const b=$('#bSim');b.classList.toggle('on',!!ui.sim);b.innerHTML=ui.sim?icon('stop')+'Szimuláció leállítása':icon('play')+'Szimuláció';}
simBtn();
/* ---------- Vezérlőcsere: engine/swap.ts ---------- */
function swapMcu(pid,type){const p=D.parts.find(x=>x.id===pid);const r=swapMcuOf(D,pid,type,{before:pushUndo,nextLabel});if(!r)return null;
  ui.sel=null;commit(true);resize();const fits=partFits(p);
  return{dropped:r.dropped,fits,msg:`Csere: ${DEFS[type].name}${r.dropped.length?` · ${r.dropped.length} kapcsolat elveszett`:''}${fits?'':' · nem fér el a panelon, mozgasd'}`};}

/* ---------- Példák ---------- */
function loadExample(id){const ex=EXAMPLES.find(e=>e.id===id);if(!ex)return false;
  const raw=JSON.parse(JSON.stringify(ex.design));
  if(raw.customForms){raw.customParts={...(raw.customParts||{}),...Object.fromEntries(Object.entries(raw.customForms).map(([k,f])=>[k,formToDef(f)]))};delete raw.customForms;} // saját alkatrész az űrlapjából (a szerkesztőben diagrammal nyílik)
  const d={...raw,bridges:[],wires:[],auto:{bridges:[],wires:[]},seq:100,
    links:raw.links.map(([a,b],i)=>({id:'l'+(10+i),a,b,gpio:null})),notes:raw.notes.map((n,i)=>({id:'n'+(80+i),...n})),
    settings:{usb:true,btnMode:'hold',autoRoute:true,...(raw.settings||{})}};
  if(ui.sim)setSim(false);pushUndo();
  D=(normalize(d));syncDefs(D.customParts);ui.sel=null;ui.selLink=null;LSTATE.clear();STSTATE.clear();
  for(const p of [...D.parts])if(isOff(p)&&!p.plug)attachPlug(p); // a külső alkatrészek csatlakozóba dugva
  if(D.links.length){route({full:true});}
  if(ex.freeze){D.cuts=[...(D.cuts||[]),...(D.auto.cuts||[])];D.bridges.push(...D.auto.bridges.map(b=>b.slice(0,4)));D.wires.push(...D.auto.wires.map(w=>({a:w.a,b:w.b,color:w.color})));
    D.auto={bridges:[],wires:[],cuts:[]};D.links=[];D.settings.autoRoute=false;}
  if(ex.design.program&&(!ui.work||ui.work==='board'))setWork(window.innerWidth>1000?'split':'prog');
  for(const [a,m] of Object.entries(ex.gpioFrom||{})){const l=D.links.find(x=>x.a===a);if(l&&l.gpio)D.gpio[l.gpio]=m;}
  commit(true);resize();boardUI();homeView();
  toast(`Betöltve: ${ex.title}. Az előző terv visszavonással (Ctrl+Z) visszahozható.`);
  closeDlg('#dlgEx');renderExamples();return true;}
/** Példák: balra a kategóriák (darabszámmal), jobbra kártyák (cím, leírás, szint, mit tanulsz); keresés a fejlécben. */
/** Példák ablak: kategóriák balra, kártyák jobbra; keresés és címkeszűrő (szint: VAGY, program: ÉS) minden kategórián. */
const EX_FILTERS=[['kezdő','kezdő','lv-beg'],['haladó','haladó','lv-adv'],['program','program','prog']];
function renderExamples(){const el=$('#examples');if(!el)return;const q=(($('#exSearch')||{}).value||'').trim().toLowerCase(),F=ui.exF||(ui.exF=new Set());
  const lv=['kezdő','haladó'].filter(x=>F.has(x)),fl=lv.length||F.has('program'),every=ui.exCat==='*',all=!!q||every;
  const tag=(e,k)=>k==='program'?!!e.design.program:e.level===k;
  const pass=e=>(!lv.length||lv.includes(e.level))&&(!F.has('program')||!!e.design.program);
  const found=e=>!q||[e.title,e.desc,e.cat,...(e.learn||[])].join(' ').toLowerCase().includes(q);
  const hit=e=>found(e)&&pass(e),nOf=c=>EXAMPLES.filter(e=>e.cat===c&&hit(e)).length;
  let cat=every?'*':ui.exCat||'Alapok';if(!all&&fl&&!nOf(cat))cat=EX_CATS.find(c=>nOf(c))||cat; // üres kategóriából a szűrő az első találatosra visz
  const scope=e=>(all||e.cat===cat)&&found(e),list=EXAMPLES.filter(e=>scope(e)&&pass(e));
  const cnt=k=>EXAMPLES.filter(e=>scope(e)&&tag(e,k)).length;
  el.innerHTML=`<nav class="ex-cats" role="tablist" aria-label="Példák kategóriái" aria-orientation="vertical"><button class="ex-cat ex-all ${every&&!q?'on':''}" role="tab" aria-selected="${every&&!q}" data-excat="*"><span>Összes kategória</span><span class="ex-n">${EXAMPLES.filter(hit).length}</span></button>${EX_CATS.map(c=>{const n=EXAMPLES.filter(e=>e.cat===c&&hit(e)).length;
      return `<button class="ex-cat ${c===cat&&!all?'on':''}" role="tab" aria-selected="${c===cat&&!all}" data-excat="${c}" ${(all||fl)&&!n?'disabled':''}><span>${c}</span><span class="ex-n">${n}</span></button>`;}).join('')}</nav>
    <div class="ex-main"><div class="ex-filters" role="group" aria-label="Szűrés címkére"><span class="small muted">Szűrés:</span>${EX_FILTERS.map(([k,l,c])=>`<button class="ex-tag ex-f ${c} ${F.has(k)?'on':''}" data-exf="${k}" aria-pressed="${F.has(k)}" ${!F.has(k)&&!cnt(k)?'disabled':''}>${l} <span class="ex-n">${cnt(k)}</span></button>`).join('')}${fl?'<button class="btn ghost ex-fclear" data-exf="">Szűrők törlése</button>':''}</div>
    ${q?`<p class="small muted ex-q">Találatok minden kategóriában: ${list.length}</p>`:''}<ul class="ex-list">${list.map(e=>`<li><button class="ex-item" data-ex="${e.id}">
      <span class="ex-tags">${all?`<span class="ex-tag">${esc(e.cat)}</span>`:''}${e.level?`<span class="ex-tag lv-${e.level==='haladó'?'adv':'beg'}">${esc(e.level)}</span>`:''}${e.design.program?'<span class="ex-tag prog">program</span>':''}</span>
      <b>${esc(e.title)}</b><span class="ex-desc">${esc(e.desc)}</span>
      ${e.learn&&e.learn.length?`<span class="ex-learn"><span class="small muted">Mit tanulsz:</span><ul>${e.learn.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></span>`:''}</button></li>`).join('')||'<li class="muted">Nincs ilyen példa.</li>'}</ul></div>`;}
$('#examples').addEventListener('click',e=>{const c=e.target.closest('[data-excat]');if(c){ui.exCat=c.dataset.excat;$('#exSearch').value='';renderExamples();return;}
  const f=e.target.closest('[data-exf]');if(f){const F=ui.exF||(ui.exF=new Set()),k=f.dataset.exf;if(!k)F.clear();else if(F.has(k))F.delete(k);else F.add(k);renderExamples();const b=$(`#examples [data-exf="${k}"]`);if(b)b.focus();return;}
  const x=e.target.closest('[data-ex]');if(x)loadExample(x.dataset.ex);});
$('#exSearch').addEventListener('input',()=>renderExamples());
renderExamples();
$('#autoR').addEventListener('change',e=>{pushUndo();D.settings.autoRoute=e.target.checked;commit();});
$('#autoCut').addEventListener('change',e=>{pushUndo();D.settings.autoCut=e.target.checked;if(!e.target.checked)D.auto.cuts=[];if(D.settings.autoRoute&&D.links.length)route({full:true});commit(true);});
const routeSummary=()=>{const n=D.links.length,ok=D.links.filter(l=>(ui.linkState.get(l.id)||{}).ok).length;return`Útvonalkeresés: ${ok}/${n} kapcsolat bekötve, ${D.auto.bridges.length} híd, ${D.auto.wires.length} vezeték.`;};
$('#bRoute').onclick=()=>{pushUndo();route({full:true});commit(true);log(routeSummary());};
$('#bFreeze').onclick=()=>{if(!D.auto.bridges.length&&!D.auto.wires.length&&!(D.auto.cuts||[]).length)return;pushUndo();D.cuts=[...(D.cuts||[]),...(D.auto.cuts||[])];D.settings.autoCut=false;D.bridges.push(...D.auto.bridges.map(b=>b.slice(0,4)));D.wires.push(...D.auto.wires.map(w=>({a:w.a,b:w.b,color:w.color})));D.auto={bridges:[],wires:[],cuts:[]};commit(true);log('Az automatikus bekötés kézivé rögzítve.');};
$('#bToAuto').onclick=()=>{const n=manualToAuto(null);if(!n)flashMsg('Nincs kézi bekötés, amit át lehetne alakítani');};
$('#bUnroute').onclick=()=>{pushUndo();D.auto={bridges:[],wires:[],cuts:[]};D.settings.autoRoute=false;commit(true);log('Az automatikus hidak törölve, az útvonaltervezés kikapcsolva.');};
$('#links').addEventListener('change',e=>{const s=e.target.closest('[data-linkto]');if(!s)return;pushUndo();if(!setLinkTarget(D,s.dataset.linkto,s.value)){HIST.drop();renderLinks();return;}commit();});
$('#links').addEventListener('click',e=>{const b=e.target.closest('[data-dl]');if(b){pushUndo();D.links=D.links.filter(l=>l.id!==b.dataset.dl);commit();return;}
  const li=e.target.closest('[data-li]');if(li){const id=li.dataset.li;ui.selLink=ui.selLink===id?null:id;renderLinks();draw();status();
    if(ui.selLink){const g=linkGeom(D.links.find(x=>x.id===id));if(g){const sc=$('#scroll'),pts=[g.start,g.end].filter(Boolean).map(([r,c])=>toScreen(hx(c),hy(r)));const vx=pts.reduce((t,p)=>t+p[0],0)/pts.length,vy=pts.reduce((t,p)=>t+p[1],0)/pts.length;sc.scrollTo({left:vpX(vx)-sc.clientWidth/2,top:vpY(vy)-sc.clientHeight/2,behavior:'smooth'});}}}});
/* ---------- Fájl menü, párbeszédablakok, értesítés, téma, kezdőkép, állapotsor (5.1 alapozó kör) ---------- */
let toastTimer;
/** Rövid értesítés a vászon alján (a régi panelenkénti üzenetsorok helyett). */
function toast(m,err){log(m,err);const t=$('#toast');t.textContent=m;t.classList.toggle('err',!!err);t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true;},5000);}
$('#toast').addEventListener('click',()=>{$('#toast').hidden=true;});
function openDlg(sel){const d=$(sel);closeMenu();if(!d.open)d.showModal();}
function closeDlg(sel){const d=$(sel);if(d&&d.open)d.close();}
document.querySelectorAll('dialog.dlg').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d||e.target.closest('[data-close]'))d.close();});});
const menuBtn=$('#bFile'),menu=$('#fileMenu');
function openMenu(){menu.hidden=false;menuBtn.setAttribute('aria-expanded','true');themeUI();const f=menu.querySelector('.menu-item');if(f)f.focus();}
function closeMenu(){if(menu.hidden)return;menu.hidden=true;menuBtn.setAttribute('aria-expanded','false');}
menuBtn.onclick=()=>menu.hidden?openMenu():closeMenu();
menu.addEventListener('click',e=>{if(e.target.closest('.menu-item'))setTimeout(closeMenu);});
document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!e.target.closest('.menuwrap'))closeMenu();});
menu.addEventListener('keydown',e=>{const it=[...menu.querySelectorAll('.menu-item,.menu-seg .btn')],i=it.indexOf(document.activeElement);
  if(e.key==='Escape'){closeMenu();menuBtn.focus();e.preventDefault();}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();it[(i+(e.key==='ArrowDown'?1:it.length-1))%it.length].focus();}});
$('#bExamples').onclick=()=>{renderExamples();openDlg('#dlgEx');};
$('#bJson').onclick=()=>openDlg('#dlgJson');
$('#bSimple').onclick=()=>{setSimple(!isSimple());};
$('#simpleBadge').onclick=()=>setSimple(false);
/* téma: automatikus (a rendszer szerint), világos, sötét; a választás megmarad */
const THEMEKEY='proofboard.ui.theme';
const themeGet=()=>{try{const v=localStorage.getItem(THEMEKEY);return v==='light'||v==='dark'?v:'auto';}catch(e){return'auto';}};
function setTheme(v,remember=true){const r=document.documentElement;if(v==='light'||v==='dark')r.dataset.theme=v;else{delete r.dataset.theme;v='auto';}
  if(remember){try{localStorage.setItem(THEMEKEY,v);}catch(e){}}themeUI();draw();}
function themeUI(){const v=themeGet();document.querySelectorAll('[data-theme-set]').forEach(b=>{const on=b.dataset.themeSet===v;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});}
document.querySelectorAll('[data-theme-set]').forEach(b=>b.addEventListener('click',()=>setTheme(b.dataset.themeSet)));
window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>draw());
setTheme(themeGet(),false);
/* új terv és kezdőkép: panelválasztás a beépített méretekből */
function boardSelects(){const b=D.board,cur=Math.max(0,BOARDS.findIndex(x=>x[1]===b.cols&&x[2]===b.rows&&(x[3]||x[2])===b.sec));
  for(const id of ['#introBoard','#newBoard'])$(id).innerHTML=BOARDS.map((x,i)=>`<option value="${i}" ${i===cur?'selected':''}>${esc(x[0])} (${x[1]}×${x[2]})</option>`).join('');}
const isEmpty=()=>!D.parts.length&&!D.bridges.length&&!D.wires.length&&!(D.notes||[]).length&&!D.links.length&&!(D.program&&D.program.nodes.length);
/** Üres terv a választott panellal (visszavonható). */
function newDesign(i){const x=BOARDS[+i]||BOARDS[0];if(ui.sim)setSim(false);pushUndo();
  const d=emptyDesign();d.board={cols:x[1],rows:x[2],sec:x[3]||x[2]};D=d;ui.sel=null;ui.selLink=null;ui.placing=null;ui.introOff=true;LSTATE.clear();STSTATE.clear();
  commit(true);resize();boardUI();homeView();}
function openNew(){boardSelects();openDlg('#dlgNew');}
$('#bNew').onclick=openNew;
$('#bNewOk').onclick=()=>{const wasEmpty=isEmpty();newDesign($('#newBoard').value);closeDlg('#dlgNew');if(!wasEmpty)toast('Új terv. Az előző visszavonással (Ctrl+Z) visszahozható.');};
$('#introBlank').onclick=()=>{newDesign($('#introBoard').value);ltab('lib');sideCollapse('l',false);};
$('#introEx').onclick=()=>{renderExamples();openDlg('#dlgEx');};
/** A kezdőkép üres tervnél látszik, amíg nem választasz sablont vagy nem kezdesz lerakni. */
function introUI(){const el=$('#intro');if(!el||!D)return;el.hidden=!(isEmpty()&&!ui.introOff&&!ui.placing&&!ui.sim&&ui.work!=='prog');}
/* állapotsor: üzenet, eszköz, kijelölés, problémák (kattintásra a Problémák fül), szimuláció */
function sbUpdate(){const tl=$('#sbTool');if(!tl||!D)return;const T=TOOLS.find(x=>x[0]===ui.tool);
  tl.innerHTML=ui.sim?'':ui.placing?`Lerakás: <b>${esc(DEFS[ui.placing]?DEFS[ui.placing].name:ui.placing)}</b>`:`Eszköz: <b>${T?T[1]:esc(ui.tool)}</b>`;
  let sel='';if(ui.sel){if(ui.sel.kind==='group'){const p=selPart(),n=gSize(ui.sel);sel=p?p.label:n?`${n} elem`:'';}else sel={wire:'vezeték',bridge:'híd',note:'jegyzet'}[ui.sel.kind]||'';}
  $('#sbSel').innerHTML=sel?`Kijelölve: <b>${esc(sel)}</b>`:'';
  const ne=ISSUES.filter(i=>i.sev==='err').length,nw=isSimple()?0:ISSUES.filter(i=>i.sev==='warn').length,ni=isSimple()?0:ISSUES.length-ne-ISSUES.filter(i=>i.sev==='warn').length,b=$('#sbIss');
  b.className='sb-item sb-btn '+(ne?'err':nw?'warn':'ok');
  b.innerHTML=ne||nw?icon(ne?'error':'warn')+[ne?`${ne} hiba`:'',nw?`${nw} figyelmeztetés`:''].filter(Boolean).join(' · '):ni?icon('info')+`${ni} megjegyzés`:icon('check')+'Nincs probléma';
  const sm=$('#sbSim');sm.className='sb-item'+(ui.sim?' run':'');sm.innerHTML=`<i class="sb-dot"></i>${ui.sim?'Szimuláció fut':'Szimuláció áll'}`;}
$('#sbIss').onclick=()=>{bottomPanel(true,'issues');};
/* ---------- Elrendezések (5.2): Tervezés, Program, Szimuláció; a kézi módosítás elrendezésenként megmarad ---------- */
const LAYKEY='proofboard.ui.layout';
let LAY_S=(()=>{let raw=null;try{raw=JSON.parse(localStorage.getItem(LAYKEY)||'null');}catch(e){}const o=uiPref();
  return parseStore(raw,{l:!!o.colL,r:!!o.colR,...(['board','prog','split'].includes(o.work)?{work:o.work}:{})});})();
function layStore(){try{localStorage.setItem(LAYKEY,JSON.stringify(LAY_S));}catch(e){}}
function layUI(){document.querySelectorAll('[data-layout]').forEach(b=>{const on=b.dataset.layout===LAY_S.cur;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
  $('#layReset').hidden=!isCustom(LAY_S);const c=$('.app').classList;for(const l of LAYOUTS)c.toggle('lay-'+l.id,l.id===LAY_S.cur);}
/** Kézi módosítás a mostani elrendezésben (oldalsáv, alsó panel, nézet, jobb fül). */
function layPatch(o){if(ui.layApplying)return;LAY_S=layRemember(LAY_S,o);layStore();layUI();}
function applyLayout(id,store=true,over){if(!isLayout(id))id='design';const r=laySwitch(LAY_S,id);LAY_S=r.store;const st={...r.state,...(over||{})};ui.layApplying=true;
  try{sideCollapse('l',st.l,false);sideCollapse('r',st.r,false);setWork(MOB.matches&&st.work==='split'?'prog':st.work,false);rtab(st.rtab,false);bottomPanel(st.bottom,null,false);}
  finally{ui.layApplying=false;}
  if(id==='sim'&&!SIM_TOOLS.has(ui.tool))setTool('select'); // a Szimuláció elrendezésben csak Kijelölés és Mozgatás (a Programban a panelen minden eszköz kell)
  if(store)layStore();layUI();return id;}
document.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>applyLayout(b.dataset.layout)));
$('#layReset').onclick=()=>{LAY_S=resetLayout(LAY_S);applyLayout(LAY_S.cur);};
/* ---------- Alsó panel: Problémák és Napló (csak olvasnivaló; alapból összecsukva) ---------- */
const LOG=new EventLog(300); // ui/log.ts
/** Naplóbejegyzés (betöltés, mentés, útvonalkeresés, szimuláció…); olvasatlan, amíg a Napló nincs nyitva. */
function log(m,err){LOG.add(m,err,$('#bpanel').classList.contains('open')&&ui.btab==='log');renderLog();}
function renderLog(){const el=$('#log');if(!el)return;el.innerHTML=LOG.html();$('#bpLogN').textContent=LOG.unread?String(LOG.unread):'';}
function logRead(){LOG.read();renderLog();}
function btab(t,remember=true){ui.btab=t==='log'?'log':'issues';
  document.querySelectorAll('[data-btab]').forEach(b=>{const on=b.dataset.btab===ui.btab;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on));});
  document.querySelectorAll('[data-bpane]').forEach(p=>{p.hidden=p.dataset.bpane!==ui.btab;});
  $('#bpRead').hidden=$('#bpClear').hidden=ui.btab!=='log';
  if(remember)uiPrefSet({btab:ui.btab});if(ui.btab==='log'&&$('#bpanel').classList.contains('open'))setTimeout(logRead,1500);}
/** Az alsó panel nyitása/csukása (elhagyva: vált), opcionálisan fülváltással. */
function bottomPanel(open,tab,remember=true){const bp=$('#bpanel');if(open==null)open=!bp.classList.contains('open');open=!!open;
  bp.classList.toggle('open',open);{const b=$('#colB');b.classList.toggle('on',open);b.setAttribute('aria-pressed',String(open));}const t=$('#bpTog');t.setAttribute('aria-expanded',String(open));t.setAttribute('aria-label',open?'Alsó panel összecsukása':'Alsó panel kinyitása');
  if(tab)btab(tab);else if(open&&ui.btab==='log')setTimeout(logRead,1500);
  if(remember)layPatch({bottom:open});resize();if(typeof PW!=='undefined')PW.place();return{open,tab:ui.btab};}
document.querySelector('.bp-head').addEventListener('click',e=>{const b=e.target.closest('[data-btab]');if(!b)return;const open=$('#bpanel').classList.contains('open');
  if(open&&ui.btab===b.dataset.btab)bottomPanel(false);else{btab(b.dataset.btab);if(!open)bottomPanel(true);}});
$('#bpTog').onclick=()=>bottomPanel();$('#colB').onclick=()=>bottomPanel();
$('#bpRead').onclick=logRead;
$('#bpClear').onclick=()=>{LOG.clear();renderLog();};
{const bp=$('#bpanel'),g=$('#bpGrip'),setH=h=>{h=Math.max(80,Math.min(Math.round(window.innerHeight*0.6),Math.round(h)));bp.style.setProperty('--bph',h+'px');return h;};
  if(uiPref().bph)setH(+uiPref().bph);
  g.addEventListener('pointerdown',e=>{e.preventDefault();g.setPointerCapture(e.pointerId);g.classList.add('on');const y0=e.clientY,h0=$('#bpBody').offsetHeight;
    const mv=ev=>{setH(h0-(ev.clientY-y0));};
    const up=()=>{g.classList.remove('on');g.removeEventListener('pointermove',mv);g.removeEventListener('pointerup',up);g.removeEventListener('pointercancel',up);uiPrefSet({bph:$('#bpBody').offsetHeight});resize();PW.place();};
    g.addEventListener('pointermove',mv);g.addEventListener('pointerup',up);g.addEventListener('pointercancel',up);});
  g.addEventListener('keydown',e=>{if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;e.preventDefault();uiPrefSet({bph:setH($('#bpBody').offsetHeight+(e.key==='ArrowUp'?24:-24))});resize();});}
btab(uiPref().btab,false);renderLog();
/* ---------- Eszközsáv a vászon alján (összecsukva csak az aktív eszköz) ---------- */
function strip(col){const t=$('#toolstrip');if(col==null)col=!t.classList.contains('col');t.classList.toggle('col',!!col);$('#tsTog').setAttribute('aria-expanded',String(!col));uiPrefSet({strip:!!col});toolFit();}
$('#tsTog').onclick=()=>strip();
strip(!!uiPref().strip);
/* ---------- Lebegő tulajdonságablak (alapból lebeg; a jobb sávba rögzíthető) ---------- */
const PWKEY='proofboard.ui.propwin';
/** Melyik oldalsávba van rögzítve: 'r' (alapból) vagy 'l'. */
const dockSide=()=>MOB.matches?'r':uiPref().dockSide==='l'?'l':'r';
/** Rögzítve van-e (mobilon mindig: a Részletek lap Tulajdonságok fülén). */
const isDocked=()=>PW.state().docked||MOB.matches;
/** Oldalsáv füle: a bal sávon 'lib' | 'props', a jobbon 'design' | 'sim' | 'props'. */
function sideTab(k,name){if(k==='l')ltab(name);else rtab(name,false);}
const sideCur=k=>k==='l'?ui.ltab:ui.rtab;
function pwPlace(d){const pr=$('#props'),side=dockSide();(d?$('#dockBody'):$('#pwBody')).appendChild(pr);$('#propDock').hidden=!d;
  if(d)(side==='l'?$('#lpProps'):$('#rpProps')).appendChild($('#propDock'));
  for(const [k,sel] of [['l','[data-ltab="props"],[data-rail-ltab="props"]'],['r','[data-rtab="props"],[data-rail-rtab="props"]']])
    for(const b of document.querySelectorAll(sel))b.hidden=!(d&&side===k);
  if(ui.ltab==='props'&&!(d&&side==='l'))ltab('lib');
  if(ui.rtab==='props'&&!(d&&side==='r'))rtab(ui.rtabProps||'design',false);}
const PW=mountFloatWin({win:$('#propWin'),head:$('#pwHead'),body:$('#pwBody'),area:$('#carea'),
  load:()=>{try{return parseWin(JSON.parse(localStorage.getItem(PWKEY)||'null'));}catch(e){return parseWin(null);}},
  save:st=>{try{localStorage.setItem(PWKEY,JSON.stringify(st));}catch(e){}},
  onDock:d=>{pwPlace(d);ui.pwHad=false;if(d)sideCollapse(dockSide(),false);renderLeft();},
  compact:()=>MOB.matches});
pwPlace(isDocked());
MOB.addEventListener('change',()=>{pwPlace(isDocked());renderLeft();});
$('#pwCol').onclick=()=>{PW.collapse();pwUpdate();};$('#pwDock').onclick=()=>PW.dock(true);$('#pwUndock').onclick=()=>PW.dock(false);
/* áttétel a másik oldalsávba (a bal sáv is fogadhatja) */
$('#pwSwap').onclick=()=>{const was=dockSide(),to=was==='l'?'r':'l';const on=sideCur(was)==='props';uiPrefSet({dockSide:to});pwPlace(true);sideCollapse(to,false);
  if(on){if(to==='r'){ui.rtabProps=ui.rtab==='props'?ui.rtabProps:ui.rtab;}sideTab(to,'props');}};
/** A lebegő ablak kijelöléskor (vagy félkész kapcsolatnál) látszik; mobilon csak a Beállítás gombra. */
function pwUpdate(){const has=!!(ui.sel||ui.linkStart);PW.show(has&&!MOB.matches);
  $('#pwTitle').textContent=ui.linkStart&&!ui.sel?'Kapcsolat':'Kijelölés';$('#dockSumm').textContent=$('#selSumm').textContent;
  $('#pwCol').setAttribute('aria-expanded',String(!PW.state().collapsed));
  // rögzítve: kijelöléskor a Tulajdonságok fülre vált, a kijelölés megszűntével vissza oda, ahonnan jött
  if(isDocked()&&has!==!!ui.pwHad){const k=dockSide();
    if(k==='r'){if(has&&ui.rtab!=='props'){ui.rtabProps=ui.rtab;rtab('props',false);}else if(!has&&ui.rtab==='props')rtab(ui.rtabProps||'design',false);}
    else{if(has&&ui.ltab!=='props')ltab('props');else if(!has&&ui.ltab==='props')ltab('lib');}}
  ui.pwHad=has;}
window.addEventListener('resize',()=>PW.place());
/* Ctrl nyomva tartva (kis késleltetéssel, más billentyű nélkül): a gyorsbillentyűk láthatók.
   Az eszközsávon az ikon helyén a betű, máshol kis címke a gombon. (Az Alt a böngésző menüjét fókuszálná.) */
{let t=0;const app=$('.app'),off=()=>{clearTimeout(t);t=0;app.classList.remove('keys');};
  document.addEventListener('keydown',e=>{if(e.key==='Control'){if(!e.repeat){clearTimeout(t);t=setTimeout(()=>app.classList.add('keys'),350);}}else off();}); // a nyomva tartott Ctrl ismétlődő eseménye nem kapcsolja ki
  document.addEventListener('keyup',e=>{if(e.key==='Control')off();});
  document.addEventListener('pointerdown',off,true);document.addEventListener('wheel',off,{capture:true,passive:true});
  window.addEventListener('blur',off);}
/* Összecsukott eszközsáv: rámutatva kinyílik, és nyitva marad, amíg nem választasz vagy el nem hagyod */
{const ts=$('#toolstrip');ts.addEventListener('mouseenter',()=>{if(ts.classList.contains('col'))ts.classList.add('peek');});
  ts.addEventListener('mouseleave',()=>ts.classList.remove('peek'));
  ts.addEventListener('click',e=>{if(e.target.closest('[data-tool]'))ts.classList.remove('peek');});}
/* Visszavonás / újra: csak akkor aktív, ha van mit */
/** A fejléc visszavonása: ha egy alkatrész-szerkesztő látszik, az övé (a panelé addig érintetlen), egyébként a panelé. */
function undoUI(){const u=$('#bUndo'),r=$('#bRedo'),E=editorHistory(),cu=E?E.canUndo:HIST.canUndo,cr=E?E.canRedo:HIST.canRedo;
  if(u){u.disabled=!cu;u.title=E?'Visszavonás az alkatrész-szerkesztőben (Ctrl+Z)':'Visszavonás (Ctrl+Z)';}if(r){r.disabled=!cr;r.title=E?'Újra az alkatrész-szerkesztőben (Ctrl+Y)':'Újra (Ctrl+Y)';}}
/* A kurzor mutatja, mit csinál a kattintás: az eszköz ikonja a célkereszt mellett */
const CURSORS={};
function toolCursor(){if(ui.sim||ui.placing||ui.tool==='select')return'';if(ui.tool==='pan')return'grab';const t=TOOLS.find(x=>x[0]===ui.tool);if(!t)return'';
  if(!CURSORS[t[0]]){const g=icon(t[3]).replace(/<svg[^>]*>/,'').replace('</svg>','');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"><path d="M7 1v12M1 7h12"/></g><g stroke="#111" stroke-width="1.4" fill="none" stroke-linecap="round"><path d="M7 1v12M1 7h12"/></g><g transform="translate(13 13) scale(.75)" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#fff" stroke-width="5">${g}</g><g stroke="#111" stroke-width="2">${g}</g></g></svg>`;
    CURSORS[t[0]]=`url("data:image/svg+xml,${encodeURIComponent(svg)}") 7 7, crosshair`;}
  return CURSORS[t[0]];}
function cursorUI(){cv.style.cursor=toolCursor();}
hydrateIcons();
$('#bExport').onclick=()=>{$('#json').value=JSON.stringify(D,null,1);$('#jsonMsg').textContent='A terv JSON-ja a mezőben.';};
$('#bCopy').onclick=()=>{const ta=$('#json');if(!ta.value)ta.value=JSON.stringify(D,null,1);navigator.clipboard.writeText(ta.value).then(()=>$('#jsonMsg').textContent='Vágólapra másolva.').catch(()=>{ta.focus();ta.select();$('#jsonMsg').textContent='Kijelöltem a szöveget, másold Ctrl+C-vel.';});};
/** Terv betöltése: a tervvel érkező saját alkatrészek mellé a meglévők megmaradnak; azonos kulcsnál, eltérő tartalommal a meglévőt átnevezi. */
function importPlan(raw){
  const {raw:r2,renamed}=rekeyAgainstLibrary(raw,LIB),inc=(r2&&r2.customParts&&typeof r2.customParts==='object')?r2.customParts:{};
  const d=normalize(r2);
  pushUndo();D=d;ui.sel=null;LSTATE.clear();STSTATE.clear();commit();
  const nIn=Object.keys(inc).filter(k=>k in (d.customParts||{})).length;
  return `Betöltve: ${d.parts.length} alkatrész, ${d.bridges.length+d.auto.bridges.length} híd, ${d.wires.length+d.auto.wires.length} vezeték`+(nIn?`; a tervvel ${nIn} saját alkatrész jött (a terv része, a könyvtáradat nem változtatta)`:'')+(renamed.length?`; a könyvtáradban más azonos nevű alkatrész van, ezért a terv változata új néven: ${renamed.map(x=>x.name+' → '+x.to).join(', ')}`:'')+'.';
}
$('#bImport').onclick=()=>{try{$('#jsonMsg').textContent=importPlan(JSON.parse($('#json').value));}catch(e){$('#jsonMsg').textContent='Hibás JSON: '+e.message;}};
$('#bSaveFile').onclick=()=>{const blob=new Blob([JSON.stringify(D,null,1)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  const t=new Date(),pad=x=>String(x).padStart(2,'0');a.href=url;a.download=`proofboard-terv-${t.getFullYear()}${pad(t.getMonth()+1)}${pad(t.getDate())}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  const n=Object.keys(D.customParts||{}).length;toast(`Mentve${n?`, ${n} saját alkatrésszel együtt`:''}.`);};
$('#bOpenFile').onclick=()=>$('#planFile').click();
$('#planFile').addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
  try{toast(importPlan(JSON.parse(await f.text())));resize();boardUI();homeView();}catch(err){toast('Nem sikerült betölteni: '+err.message,true);}});
/* ---------- Kapcsolatok és útvonalkereső ---------- */
const findPin=ref=>findPinOf(D,ref);
const linkText=l=>linkTextOf(D,l);
function hitPin(rf,cf){let best=null,bd=ui.coarse?0.8:0.45;for(const p of D.parts)for(const q of gpins(p)){const d=Math.hypot(q.r-rf,q.c-cf);if(d<bd){bd=d;best=q;}}return best;}
function dropLinks(pid){D.links=D.links.filter(l=>!l.a.startsWith(pid+'.')&&!l.b.startsWith(pid+'.'));}
/** Alkatrészek törlése a kapcsolataikkal; a külső alkatrésszel a csatlakozója is megy, a törölt csatlakozóból a dugó kikerül. */
function removeParts(ids){ids=new Set(ids);for(const p of D.parts)if(ids.has(p.id)&&p.plug)ids.add(p.plug);
  D.parts=D.parts.filter(p=>!ids.has(p.id));ids.forEach(dropLinks);for(const p of D.parts)if(p.plug&&ids.has(p.plug))delete p.plug;}
/** Külső alkatrészhez csatlakozó (tüskesor) a panelra, a lábszámával és lábneveivel, a lábaihoz legközelebbi szabad helyre; a kábel ebbe dugva. */
function attachPlug(p){if(!isOff(p))return null;
  {const h=matchingSocket(D,p);if(h){p.plug=h.id;const red=plugRedundantLinks(D);D.links=D.links.filter(l=>!red.has(l.id));return h;}} // meglévő csatlakozó (pl. modul motorcsatlakozója), amelyre a kapcsolatai mutatnak
  const t=socketType();if(!t)return null;const s=plugSpot(D,p,DEFS[p.type].pins(p).length);if(!s)return null;
  const h={id:'p'+(D.seq++),type:t,label:nextLabel(t),r:s.r,c:s.c,rot:s.rot,mir:false,props:{...DEFS[t].props,...socketProps(DEFS[t].def,p)}};
  D.parts.push(h);p.plug=h.id;return h;}
/* Csatlakozóba dugott kábel erei: föld fekete, táp piros, a jelek sorban narancs, sárga, kék, zöld, lila. */
/** Kábelkötegek: a külső alkatrész lábaitól a csatlakozóig ívelt erek, amelyek a köteg közepén összefutnak. */
function drawPlugs(alpha){ctx.save();ctx.globalAlpha=alpha;ctx.lineCap='round';
  for(const p of D.parts){const pr=plugPairs(D,p);if(!pr.length)continue;
    // az erek a külső alkatrész testéből kifelé indulnak, és a csatlakozó lábsorára merőlegesen érkeznek: párhuzamos szalagkábel
    const avg=a=>a.reduce((t,x)=>t+x,0)/a.length,nrm=(x,y)=>{const l=Math.hypot(x,y)||1;return[x/l,y/l];};
    const bb=DEFS[p.type].bounds(p),[orr,occ]=xf(p,(bb.r0+bb.r1)/2,(bb.c0+bb.c1)/2);
    const ax=avg(pr.map(([q])=>hx(q.c))),ay=avg(pr.map(([q])=>hy(q.r))),bx=avg(pr.map(([,h])=>hx(h.c))),by=avg(pr.map(([,h])=>hy(h.r)));
    let [ux,uy]=nrm(ax-hx(occ),ay-hy(orr));
    const h0=pr[0][1],h1=pr[pr.length-1][1];let [vx,vy]=pr.length<2?nrm(ax-bx,ay-by):nrm(hy(h1.r)-hy(h0.r),-(hx(h1.c)-hx(h0.c)));
    const side=vx*(ax-bx)+vy*(ay-by);if(side<-P||(Math.abs(side)<=P&&ux*vx+uy*vy<0)){vx=-vx;vy=-vy;} // a csatlakozó a kábel felé néz (egy vonalban: a kábellel egy irányba)
    const Lk=Math.max(P*1.6,Math.hypot(bx-ax,by-ay)*0.35),sel=isSelPart(p)||D.parts.some(h=>h.id===p.plug&&isSelPart(h));
    const hv=ui.hover,short=ui.stub&&!(hv&&pr.some(([q,h])=>(q.r===hv.r&&q.c===hv.c)||(h.r===hv.r&&h.c===hv.c))); // rámutatva a teljes kábel
    pr.forEach(([q,h],i)=>{const x1=hx(q.c),y1=hy(q.r),x2=hx(h.c),y2=hy(h.r),col=plugColor(q,i);
      const curve=()=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.bezierCurveTo(x1+ux*Lk,y1+uy*Lk,x2+vx*Lk,y2+vy*Lk,x2,y2);ctx.stroke();};
      // rövid vezeték nézet: a kábelből csak a két vég csonkja látszik szakadásjellel; kijelölve vagy rámutatva a teljes
      const B=(t,a,b,c,d)=>{const u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;},bx=t=>B(t,x1,x1+ux*Lk,x2+vx*Lk,x2),by=t=>B(t,y1,y1+uy*Lk,y2+vy*Lk,y2);
      const part=(t0,t1)=>{ctx.beginPath();ctx.moveTo(bx(t0),by(t0));for(let k=1;k<=12;k++){const t=t0+(t1-t0)*k/12;ctx.lineTo(bx(t),by(t));}ctx.stroke();};
      const stub=short&&!sel?Math.min(0.45,(P*1.8)/(Math.hypot(x2-x1,y2-y1)||1)):0;
      const draw3=f=>{if(sel){ctx.strokeStyle=css('--accent');ctx.lineWidth=P*0.42;f();}ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=P*0.26;f();ctx.strokeStyle=col;ctx.lineWidth=P*0.17;f();};
      if(!stub)draw3(curve);
      else{draw3(()=>part(0,stub));draw3(()=>part(1-stub,1));
        for(const [t,s] of [[stub,1],[1-stub,-1]]){const dx=bx(t+0.01*s)-bx(t),dy=by(t+0.01*s)-by(t),l=Math.hypot(dx,dy)||1,tx=dx/l,ty=dy/l,nx=-ty*P*0.3,ny=tx*P*0.3;
          ctx.strokeStyle=col;ctx.lineWidth=Math.max(1.4,P*0.1);for(const o of [0.2,0.42]){const cx=bx(t)+tx*P*o,cy=by(t)+ty*P*o;line(cx-nx,cy-ny,cx+nx,cy+ny);}}}
      ctx.fillStyle='#1d1d1d';ctx.fillRect(x2-P*0.22,y2-P*0.22,P*0.44,P*0.44);ctx.fillStyle=col;ctx.beginPath();ctx.arc(x2,y2,P*0.12,0,7);ctx.fill();});
    // lábnevek a csatlakozón, a kábellel átellenes oldalon (ahová forrasztasz)
    if(alpha>=1&&P>=12)pr.forEach(([q],i)=>{const h=pr[i][1];stext(hx(h.c)-vx*P*0.85,hy(h.r)-vy*P*0.85,q.name,Math.max(7,P*0.4),q.role==='gnd'?'#212529':plugColor(q,i)==='#c92a2a'?'#c92a2a':'#5c3d0a','rgba(255,252,240,.9)');});}
  ctx.restore();}
function addLink(a,b){if(D.links.some(l=>(l.a===a&&l.b===b)||(l.a===b&&l.b===a)))return;pushUndo();D.links.push({id:'l'+(D.seq++),a,b,gpio:null});commit();}
function linkStates(){ui.linkState=linkStatesOf(D,A0);}
function renderLinks(){
  $('#autoR').checked=!!D.settings.autoRoute;$('#autoCut').checked=autoCutOn();
  const n=D.links.length,ok=[...ui.linkState.values()].filter(s=>s.ok).length;
  $('#linkSum').innerHTML=n?`<span class="chip ${ok===n?'c-ok':'c-warn'}">${ok}/${n} bekötve</span>`:'';
  $('#links').innerHTML=n?D.links.map(l=>{const s=ui.linkState.get(l.id)||{};
    const st=!s.ok?'<span class="c-err">nincs</span>':s.cable?'<span class="c-ok">kábel</span>':s.wire?'<span class="c-warn">vezeték</span>':s.nb?`<span class="c-ok">${s.nb} híd</span>`:'<span class="muted">kézi</span>';
    return `<li class="lk${ui.selLink===l.id?' on':''}" data-li="${l.id}" title="Kattints: kezdő- és végpont, útvonal kiemelése"><span class="t">${esc(linkText(l))}${s.gpio&&l.b==='GPIO'?` <b>${s.gpio}</b>`:''}</span>${st}<button data-dl="${l.id}" aria-label="Kapcsolat törlése" title="Törlés">×</button></li>${ui.selLink===l.id?`<li class="lk-edit"><label class="small muted" for="lkTo">Cél</label>${targetSelect('data-linkto',l.id,l.b,l.a.split('.')[0]).replace('<select ','<select id="lkTo" ').replace('<option value="">– nincs kapcsolat –</option>','')}</li>`:''}`;}).join('')
    :'<li class="muted small" style="padding:4px 6px">Még nincs kapcsolat.</li>';
  const ab=D.auto.bridges.length,aw=D.auto.wires.length,mb=D.bridges.length,mw=D.wires.length;
  const sum=[...ui.linkState.values()].reduce((t,s)=>t+(s.nb||0),0);
  const parts=[`<b>${ab+mb}</b> híd`+(ab&&mb?` <span class="muted">(${ab} auto + ${mb} kézi)</span>`:ab?' <span class="muted">(auto)</span>':mb?' <span class="muted">(kézi)</span>':'')];
  if(aw+mw)parts.push(`<b>${aw+mw}</b> vezeték`+(aw&&mw?` <span class="muted">(${aw} auto + ${mw} kézi)</span>`:aw?' <span class="muted">(auto)</span>':' <span class="muted">(kézi)</span>'));
  {const ac=(D.auto.cuts||[]).length,mc=(D.cuts||[]).length;if(ac+mc)parts.push(`<b>${ac+mc}</b> vágás`+(ac&&mc?` <span class="muted">(${ac} auto + ${mc} kézi)</span>`:ac?' <span class="muted">(auto)</span>':' <span class="muted">(kézi)</span>'));}
  $('#linkTotal').innerHTML=(n||ab+mb+aw+mw||(D.cuts||[]).length)?`<span>Összesen: ${parts.join(' · ')}</span>`+(ab&&sum>ab?`<span class="muted" title="A soronkénti számok összege ${sum}; a közös szakaszok (pl. GND-törzs) több kapcsolatnál is szerepelnek, de csak egyszer kell beforrasztani.">ⓘ sorok összege: ${sum} (közös szakaszok)</span>`:''):'';
}
function linkGeom(l){
  if(!l)return null;const A=A0,st=ui.linkState.get(l.id)||{};
  const as=equivPins(findPin(l.a)).filter(q=>inb(q.r,q.c));if(!as.length)return null;
  const own=D.auto.bridges.filter(b=>(b[4]||[]).includes(l.id)),ownW=D.auto.wires.filter(w=>(w.links||[]).includes(l.id));
  if(own.length||ownW.length){
    const adj=new Map(),add=(x,y,h)=>{if(!adj.has(x))adj.set(x,[]);adj.get(x).push([y,h]);};
    for(const b of own){const x=A.sid(b[0],b[1]),y=A.sid(b[2],b[3]);add(x,y,[b[2],b[3]]);add(y,x,[b[0],b[1]]);}
    for(const w of ownW){const x=A.sid(w.a[0],w.a[1]),y=A.sid(w.b[0],w.b[1]);add(x,y,w.b);add(y,x,w.a);}
    const srcCells=new Set(as.map(q=>A.sid(q.r,q.c)));
    const start=as.find(q=>adj.has(A.sid(q.r,q.c)))||as[0];
    const dist=new Map(),hole=new Map(),qu=[];for(const c of srcCells){dist.set(c,0);qu.push(c);}
    let far=null;
    while(qu.length){const x=qu.shift();for(const [y,h] of adj.get(x)||[]){if(dist.has(y))continue;dist.set(y,dist.get(x)+1);hole.set(y,h);qu.push(y);if(!far||dist.get(y)>dist.get(far))far=y;}}
    let end=null;
    if(far!=null){const h=hole.get(far);const cand=A.pins.filter(q=>q.on&&A.sid(q.r,q.c)===far&&q.part!==start.part);
      if(cand.length){cand.sort((a,b)=>Math.hypot(a.r-h[0],a.c-h[1])-Math.hypot(b.r-h[0],b.c-h[1]));end=cand[0];}else end={r:h[0],c:h[1]};}
    return{start:[start.r,start.c],end:end?[end.r,end.c]:null,endPin:end&&end.part?end:null,bridges:own,wires:ownW};
  }
  let best=null,bd=1e9;for(const a0 of as){const t=ratTarget(l,A,st,a0);if(!t)continue;const d=Math.hypot(t.r-a0.r,t.c-a0.c);if(d<bd){bd=d;best={start:[a0.r,a0.c],end:[t.r,t.c],endPin:t,bridges:[],wires:[]};}}
  return best||{start:[as[0].r,as[0].c],end:null,endPin:null,bridges:[],wires:[]};
}
function drawLinkSel(){
  if(!ui.selLink)return;const l=D.links.find(x=>x.id===ui.selLink);if(!l){ui.selLink=null;return;}
  const g=linkGeom(l);if(!g)return;
  ctx.save();ctx.lineCap='round';
  for(const b of g.bridges){ctx.strokeStyle='rgba(255,145,0,.55)';ctx.lineWidth=P*0.75;line(hx(b[1]),hy(b[0]),hx(b[3]),hy(b[2]));}
  for(const w of g.wires){ctx.strokeStyle='rgba(255,145,0,.55)';ctx.lineWidth=P*0.6;line(hx(w.a[1]),hy(w.a[0]),hx(w.b[1]),hy(w.b[0]));}
  if(!g.bridges.length&&!g.wires.length&&g.end){ctx.setLineDash([P*0.4,P*0.25]);ctx.strokeStyle='rgba(255,145,0,.9)';ctx.lineWidth=Math.max(2.5,P*0.16);line(hx(g.start[1]),hy(g.start[0]),hx(g.end[1]),hy(g.end[0]));ctx.setLineDash([]);}
  const mark=([r,c],col,txt)=>{const x=hx(c),y=hy(r);ctx.fillStyle='rgba(255,255,255,.35)';ctx.beginPath();ctx.arc(x,y,P*0.7,0,7);ctx.fill();ctx.strokeStyle='rgba(20,20,20,.6)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(x,y,P*0.62,0,7);ctx.stroke();ctx.strokeStyle=col;ctx.lineWidth=3;ctx.stroke();
    stext(x,y-P*1.1,txt,Math.max(9,P*0.55),col,'rgba(255,252,240,.95)');};
  if(g.end)mark(g.end,'#c000e8','cél');
  mark(g.start,'#00a844','kezdet');
  ctx.restore();
}
function linkStatusText(){const l=D.links.find(x=>x.id===ui.selLink);if(!l)return null;const g=linkGeom(l);if(!g)return null;
  const e=g.endPin?` (${pinLabel(g.endPin)})`:'';return `${linkText(l)} · kezdet ${g.start.join(':')}${g.end?` → cél ${g.end.join(':')}${e}`:''}${g.bridges.length?` · ${g.bridges.length} híd`:''} · Esc: kiemelés vége`;}
function autoHidden(ids){const h=ui.hideAuto;if(!h)return false;if(h==='all')return true;return !!ids&&ids.length>0&&ids.every(id=>h.has(id));}
function movedLinks(p){const ids=new Set();for(const l of D.links){if(l.a.startsWith(p.id+'.')||l.b.startsWith(p.id+'.'))ids.add(l.id);else if(isMcu(p)&&(l.b==='GND'||l.b==='GPIO'))ids.add(l.id);}return ids;}
function toggleRats(){ui.rats=!ui.rats;$('#vRats').classList.toggle('on',ui.rats);draw();}
function ratTarget(l,A,st,a){
  a=a||findPin(l.a);if(!a)return null;
  if(l.b!=='GND'&&l.b!=='GPIO'){const ts=equivPins(findPin(l.b));let bt=null,bd=1e9;for(const t of ts){const d=Math.hypot(t.r-a.r,t.c-a.c);if(d<bd){bd=d;bt=t;}}return bt;}
  const na=inb(a.r,a.c)?A.find(A.sid(a.r,a.c)):-1;
  if(l.b==='GPIO'){const ref=(st&&st.gpioRef)||l.gpio;const t=ref&&findPin(ref);if(t)return t;
    const an=a.role==='adc';let bt=null,bd=1e9;for(const q of A.pins){if(!isMcu(q.part)||q.role!=='gpio'||!q.on||(an&&!hasCap(q,'adc')))continue;if((A.netPins.get(q.net)||[]).length>1||(A.netSecs.get(q.net)||0)>1)continue;const d=Math.abs(q.r-a.r)/3+Math.abs(q.c-a.c);if(d<bd){bd=d;bt=q;}}return bt;}
  // GND: a legközelebbi GND-hálózati láb (bekötött kapcsolatnál a saját hálózatán belül a Pico GND)
  let bt=null,bd=1e9;
  for(const [net,qs] of A.netPins){if(!qs.some(q=>isMcu(q.part)&&q.role==='gnd'))continue;
    if(st&&st.ok){if(net!==na)continue;for(const q of qs){if(!isMcu(q.part)||q.role!=='gnd')continue;const d=Math.abs(q.r-a.r)/3+Math.abs(q.c-a.c);if(d<bd){bd=d;bt=q;}}}
    else{if(net===na)continue;for(const q of qs){if(q.part===a.part)continue;const d=Math.abs(q.r-a.r)/3+Math.abs(q.c-a.c);if(d<bd){bd=d;bt=q;}}}}
  return bt;
}
function drawRats(A){
  if(!D.links.length)return;
  ctx.save();ctx.lineCap='round';
  for(const l of D.links){const st=ui.linkState.get(l.id);if(!st)continue;if(st.ok&&!ui.rats)continue;
    let a=null,t=null,bd=1e9;for(const a0 of equivPins(findPin(l.a))){const t0=ratTarget(l,A,st,a0);if(!t0)continue;const d=Math.hypot(t0.r-a0.r,t0.c-a0.c);if(d<bd){bd=d;a=a0;t=t0;}}if(!a||!t)continue;
    const col=!st.ok?'#ff1744':l.b==='GND'?'#00b8ff':l.b==='GPIO'?'#00e676':'#ffab00';
    const x1=hx(a.c),y1=hy(a.r),x2=hx(t.c),y2=hy(t.r);
    ctx.setLineDash([]);ctx.strokeStyle='rgba(20,20,20,.55)';ctx.lineWidth=Math.max(4,P*0.3);line(x1,y1,x2,y2);
    ctx.setLineDash(st.ok?[P*0.5,P*0.3]:[P*0.35,P*0.25]);ctx.strokeStyle=col;ctx.lineWidth=Math.max(2.5,P*0.17);line(x1,y1,x2,y2);
    ctx.setLineDash([]);for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.fillStyle='rgba(20,20,20,.6)';ctx.beginPath();ctx.arc(x,y,P*0.3,0,7);ctx.fill();ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,P*0.21,0,7);ctx.fill();}}
  ctx.restore();
}
/* ---------- Útvonalkereső: engine/route.ts ---------- */
function suggestCuts(){return suggestCutsOf(D);}
function route(opts){routeOf(D,opts||{});}
function manualToAuto(pid){const keep=ui.hideAuto;ui.hideAuto='all';const A=analyze(false);ui.hideAuto=keep;const n=manualToAutoOf(D,A,pid,pushUndo);if(n)commit();return n;}
/* ---------- Saját alkatrészek ---------- */
/* ---------- Saját könyvtár: a tervtől független alkatrészek (böngészőben), a terv csak a használtakat hordozza ---------- */
const LIBKEY='proofboard.library.v1';
let LIB={};
function setLib(parts){LIB={...(parts||{})};setLibrary(LIB);}
function saveLib(){try{localStorage.setItem(LIBKEY,JSON.stringify(exportLibrary(LIB)));}catch(e){}}
function loadLib(){try{const s=localStorage.getItem(LIBKEY);if(s==null)return null;const r=importLibrary(JSON.parse(s),()=>false);return r.parts;}catch(e){return {};}}
/** A tervbe lerakott könyvtári alkatrész leírása a terv része lesz (így a tervfájllal együtt utazik). */
function useInProject(t){if(t in PARTS||(D.customParts||{})[t]||!LIB[t])return;D.customParts={...D.customParts,[t]:LIB[t]};}
/** Projekt alkatrész → saját könyvtár (ütköző kulcsnál új kulccsal, a tervben is átírva). */
function toLibrary(t){const def=(D.customParts||{})[t];if(!def)return;pushUndo();
  if(LIB[t]&&JSON.stringify(LIB[t])!==JSON.stringify(def)){const nk=typeKeyFor(def.name,k=>k in DEFS||k in LIB);D.customParts={...D.customParts,[nk]:def};delete D.customParts[t];for(const p of D.parts)if(p.type===t)p.type=nk;t=nk;}
  setLib({...LIB,[t]:def});saveLib();commit(true);libMsg(`A saját könyvtárba került: ${def.name}`);}
/* Alkatrészlista: ui/library.ts (beállítások és a lista HTML-je) */
function libFavToggle(t){libPrefSet({fav:favToggled(libPref(),t)});}
function libRecent(t){libPrefSet({recent:recentWith(libPref(),t)});}
/** Alkatrészlista: keresés, kedvencek, legutóbb használtak, a terv saját alkatrészei, a saját könyvtár, majd a beépített kategóriák (összecsukhatók). */
function renderLib(){$('#lib').innerHTML=libraryHtml({defs:DEFS,builtin:new Set(Object.keys(PARTS)),library:new Set(Object.keys(LIB)),project:Object.keys(D.customParts||{}),
  pref:libPref(),query:ui.libQ||'',placing:ui.placing,sim:!!ui.sim,hideCats:isSimple()?SIMPLE_HIDE_CATS:undefined});}
$('#libSearch').addEventListener('input',e=>{ui.libQ=e.target.value;renderLib();libBar();});
/** Minden csoport kinyitása / becsukása (keresés közben minden találati csoport nyitva, ezért ott nem élnek). */
function libBar(){const q=!!(ui.libQ||'').trim();$('#libOpenAll').disabled=q;$('#libCloseAll').disabled=q;}
$('#libOpenAll').onclick=()=>{libPrefSet({closed:[]});renderLib();};
$('#libCloseAll').onclick=()=>{libPrefSet({closed:[...document.querySelectorAll('#lib details[data-grp]')].map(d=>d.dataset.grp)});renderLib();};
$('#lib').addEventListener('toggle',e=>{const d=e.target.closest&&e.target.closest('details[data-grp]');if(!d||(ui.libQ||'').trim())return;const c=new Set(libPref().closed||[]);if(d.open)c.delete(d.dataset.grp);else c.add(d.dataset.grp);libPrefSet({closed:[...c]});},true);
const editorHost={
  builtin:PARTS,
  custom:()=>({...LIB,...(D.customParts||{})}),
  /** Mentés: a saját könyvtárba (új vagy könyvtári alkatrész), és ha a terv is tartalmazza, oda is; csak a tervben lévőt csak a tervbe. */
  save(type,def){pushUndo();const t=type||typeKeyFor(def.name,k=>k in DEFS);const inLib=!type||t in LIB;
    if(inLib){setLib({...LIB,[t]:def});saveLib();}
    if(!inLib||(D.customParts||{})[t])D.customParts={...D.customParts,[t]:def};
    commit();libMsg(`Mentve: ${def.name}`);return t;},
  /** Törlés: a könyvtárból (a tervben lerakott példányok maradnak, a terv leírásával); csak a tervben lévőnél a tervből a példányaival együtt. */
  remove(type){pushUndo();
    if(type in LIB){const rest={...LIB};delete rest[type];setLib(rest);saveLib();if(!D.parts.some(p=>p.type===type)){const r={...D.customParts};delete r[type];D.customParts=r;}}
    else{const rest={...D.customParts};delete rest[type];D.customParts=rest;removeParts(D.parts.filter(p=>p.type===type).map(p=>p.id));}
    ui.sel=null;commit();libMsg('Alkatrész törölve');},
  /** Törléskor vele törlődő példányok száma (könyvtári alkatrésznél 0: a lerakottak a terv leírásával maradnak). */
  usage:t=>t in LIB?0:D.parts.filter(p=>p.type===t).length,
  place(t){if(!DEFS[t])return;ui.placing=t;ui.ghost={rot:0,mir:false};ui.sel=null;ui.wireStart=null;renderLeft();draw();flashMsg('Kattints a panelra a lerakáshoz');},
  roleColor:r=>ROLEC[r]||'#868e96',
  histChanged:()=>undoUI()
};
/* 5.6: az Alkatrész-szerkesztő középső nézet; fül a nézetsávban (Alkatrész: Név ×), a Panel / Program gombjai háttérbe teszik. */
const PT=new Map();let partCur=null; // nyitott szerkesztők: azonosító → {el, title, onClose}; partCur: a látható
/** A fül vége: a látható, nem mentett szerkesztőnél „háttérbe” (a fül marad), különben bezárás. */
const pxOf=(id,t)=>{const park=ui.part&&partCur===id&&/ •$/.test(t.title);
  return park?{ic:'minimize',lab:'Háttérbe: '+t.title,tip:'Háttérbe (Esc): a nem mentett alkatrész a fülén vár'}:{ic:'close',lab:'Bezárás: '+t.title,tip:'Bezárás (Esc)'+(/ •$/.test(t.title)?'; a piszkozat megmarad, az Új alkatrész folytatja':'')};};
/** Ha a fülek nem férnek ki a nézetsávban, görgetés helyett új sorba kerülnek (a nézetváltók alá). */
function ptWrap(){const v=$('.vbar'),c=$('#partTabs');v.classList.remove('pt-wrap');if(c.hidden)return;if(c.scrollWidth>c.clientWidth+1||v.scrollWidth>v.clientWidth+1)v.classList.add('pt-wrap');}
new ResizeObserver(()=>ptWrap()).observe(document.querySelector('.vbar'));
function partTabs(){const c=$('#partTabs');c.hidden=!PT.size;
  c.innerHTML=[...PT].map(([id,t])=>{const on=ui.part&&partCur===id,x=pxOf(id,t);return `<div class="grp seg ptab${on?' cur':''}" data-pt="${esc(id)}"><button class="btn pgo${on?' on':''}" aria-pressed="${on}" title="Az alkatrész szerkesztése">${esc(t.title)}</button><button class="btn icon px" aria-label="${esc(x.lab)}" title="${esc(x.tip)}">${icon(x.ic)}</button></div>`;}).join('');
  ptWrap();}
/** A látható szerkesztő váltása (null: egyik sem, a Panel / Program látszik). Csak a látható van a DOM-ban. */
function partShow(id){queueMicrotask(undoUI);const on=id!=null&&PT.has(id);if(on)partCur=id;ui.part=on;const v=$('#partView');v.hidden=!on;
  if(on){const el=PT.get(id).el;if(v.firstChild!==el)v.replaceChildren(el);}else v.replaceChildren();
  $('.app').classList.toggle('work-part',on);
  // Panel a szerkesztő mellett: a vászon bal fele látszik és használható (a beállítás megmarad)
  const sp=on&&!!uiPref().partSplit&&!MOB.matches;$('.app').classList.toggle('part-split',sp);
  const sb=$('#partSplit');sb.hidden=!on;sb.classList.toggle('on',sp);sb.setAttribute('aria-pressed',String(sp));
  document.querySelectorAll('[data-work]').forEach(b=>{const o=!on&&b.dataset.work===ui.work;b.classList.toggle('on',o);b.setAttribute('aria-pressed',String(o));});
  partTabs();if(!on||sp){resize();draw();}toolFit();}
editorHost.view={
  open(id,el,title,onClose,show=true){PT.set(id,{el,title,onClose});if(!show){partTabs();return;}partShow(id);if(MOB.matches)sheet('');log('Alkatrész-szerkesztő: '+title.replace(/^Alkatrész: /,''));},
  title(id,t){const x=PT.get(id);if(!x||x.title===t)return;const flip=/ •$/.test(t)!==/ •$/.test(x.title);x.title=t;if(flip){partTabs();return;}const g=[...document.querySelectorAll('#partTabs [data-pt]')].find(e=>e.dataset.pt===id);if(g)g.querySelector('.pgo').textContent=t;ptWrap();},
  close(id){if(!PT.has(id))return;const was=ui.part&&partCur===id;PT.delete(id);if(partCur===id)partCur=null;
    if(was){const next=[...PT.keys()].pop();partShow(next??null);}else partTabs();},
  hide(id){if(ui.part&&partCur===id)partShow(null);toast('A nem mentett alkatrész a fülén vár: kattints rá a folytatáshoz.');},
  show(id){partShow(id);if(MOB.matches)sheet('');},
  visible:id=>!!ui.part&&partCur===id,
};
$('#partSplit').onclick=()=>{uiPrefSet({partSplit:!uiPref().partSplit});partShow(partCur);};
$('#partTabs').addEventListener('click',e=>{const g=e.target.closest('[data-pt]');if(!g)return;const id=g.dataset.pt;
  if(e.target.closest('.px')){const x=PT.get(id);if(x)x.onClose();}else partShow(id);});
function libMsg(t){const e=$('#libMsg');if(e)e.textContent=t;toast(t);}
$('#bNewPart').onclick=()=>openEditor(editorHost,{});
$('#bLibExp').onclick=()=>{const n=Object.keys(LIB).length;if(!n){libMsg('A saját könyvtárad még üres.');return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify(exportLibrary(LIB),null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='proofboard-alkatreszek.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);libMsg(`${n} alkatrész exportálva.`);};
$('#bLibImp').onclick=()=>$('#libFile').click();
$('#libFile').addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
  try{const res=importLibrary(JSON.parse(await f.text()),k=>k in DEFS);const n=Object.keys(res.parts).length;
    if(n){pushUndo();setLib({...LIB,...res.parts});saveLib();commit();}
    libMsg(`${n} alkatrész betöltve a saját könyvtárba${res.rejected.length?`, ${res.rejected.length} hibás kihagyva (${res.rejected.map(r=>r.key).join(', ')})`:''}.`);}
  catch(err){libMsg('Nem sikerült betölteni: '+err.message);}});

/* ---------- Oldalsávok méretezése és összecsukása ---------- */
let sideCollapse=()=>null;
(function(){
  const app=$('.app'),DEF={l:250,r:320},LIM={l:[180,560],r:[220,640]};let w={...DEF};
  try{const v=JSON.parse(localStorage.getItem('proofboard.ui.sides')||'null');if(v&&v.l&&v.r)w={l:+v.l,r:+v.r};}catch(e){}
  const clamp=(k,v)=>Math.max(LIM[k][0],Math.min(LIM[k][1],Math.round(v)));
  // összecsukás: keskeny ikonsáv (asztali nézetben), állapota a felületi beállítások között
  const col={l:stateOf(LAY_S).l,r:stateOf(LAY_S).r},RAIL=46;
  const apply=()=>{w.l=clamp('l',w.l);w.r=clamp('r',w.r);app.style.setProperty('--lw',(col.l?RAIL:w.l)+'px');app.style.setProperty('--rw',(col.r?RAIL:w.r)+'px');
    app.classList.toggle('colL',col.l);app.classList.toggle('colR',col.r);
    for(const [id,c] of [['#colL',col.l],['#colR',col.r]]){const b=$(id);b.setAttribute('aria-pressed',String(!c));b.classList.toggle('on',!c);}};
  sideCollapse=(k,on,remember=true)=>{col[k]=on==null?!col[k]:!!on;apply();if(remember)layPatch(k==='l'?{l:col.l}:{r:col.r});resize();return{...col};};
  $('#colL').onclick=()=>sideCollapse('l');$('#colR').onclick=()=>sideCollapse('r');
  for(const b of document.querySelectorAll('[data-expand]'))b.onclick=()=>sideCollapse(b.dataset.expand,false);
  for(const b of document.querySelectorAll('[data-rail-ltab]'))b.onclick=()=>{ltab(b.dataset.railLtab);sideCollapse('l',false);};
  for(const b of document.querySelectorAll('[data-rail-rtab]'))b.onclick=()=>{rtab(b.dataset.railRtab,b.dataset.railRtab!=='sim');sideCollapse('r',false);};
  document.addEventListener('keydown',ev=>{const t=ev.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))return;if(ev.ctrlKey||ev.metaKey||ev.altKey)return;
    if(ev.key==='[')sideCollapse('l');else if(ev.key===']')sideCollapse('r');});
  const store=()=>{try{localStorage.setItem('proofboard.ui.sides',JSON.stringify(w));}catch(e){}};
  apply();
  for(const [id,k] of [['#gL','l'],['#gR','r']]){const g=$(id),sgn=k==='l'?1:-1;
    g.addEventListener('pointerdown',e=>{e.preventDefault();g.setPointerCapture(e.pointerId);g.classList.add('on');const x0=e.clientX,w0=w[k];
      const mv=ev=>{w[k]=w0+sgn*(ev.clientX-x0);apply();};
      const up=()=>{g.classList.remove('on');g.removeEventListener('pointermove',mv);g.removeEventListener('pointerup',up);g.removeEventListener('pointercancel',up);store();};
      g.addEventListener('pointermove',mv);g.addEventListener('pointerup',up);g.addEventListener('pointercancel',up);});
    g.addEventListener('dblclick',()=>{w[k]=DEF[k];apply();store();});
    g.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();w[k]+=(e.key==='ArrowRight'?16:-16)*sgn;apply();store();}});}
})();

/* ---------- Panelméret ---------- */
const BOARDS=[
  ['10×20 cm, 1×3 szekció',39,78,3],['10×16 cm Eurocard, 1×3',39,63,3],['10×10 cm, 1×3',39,39,3],
  ['10×16 cm csíkos (stripboard)',39,63,0],['7×9 cm pontraszter',24,30,1],['5×7 cm pontraszter',18,24,1],['4×6 cm pontraszter',14,20,1]];
function secLabel(b){return b.sec>=b.rows?'teljes csík':b.sec===1?'pontraszter':`1×${b.sec} szekció`;}
function boardUI(){
  const b=D.board,sel=$('#bdPreset');
  const cur=BOARDS.findIndex(x=>x[1]===b.cols&&x[2]===b.rows&&(x[3]||x[2])===b.sec);
  sel.innerHTML=BOARDS.map((x,i)=>`<option value="${i}" ${i===cur?'selected':''}>${x[0]} (${x[1]}×${x[2]})</option>`).join('')+`<option value="-1" ${cur<0?'selected':''}>Egyedi</option>`;
  $('#bdCols').value=b.cols;$('#bdRows').value=b.rows;$('#bdSec').value=b.sec>=b.rows?'0':String(Math.min(b.sec,5));
  bdMm();$('#boardInfo').textContent=`${b.cols}×${b.rows} lyuk · ${secLabel(b)}`;
}
function bdMm(){const c=+$('#bdCols').value||0,r=+$('#bdRows').value||0;$('#bdMm').textContent=`≈ ${(c*2.54).toFixed(0)} × ${(r*2.54).toFixed(0)} mm`;}
$('#bdPreset').addEventListener('change',e=>{const x=BOARDS[+e.target.value];if(!x)return;$('#bdCols').value=x[1];$('#bdRows').value=x[2];$('#bdSec').value=String(x[3]);bdMm();});
for(const id of ['#bdCols','#bdRows','#bdSec'])$(id).addEventListener('input',()=>{$('#bdPreset').value='-1';bdMm();});
$('#bdApply').onclick=()=>{
  const cols=Math.max(4,Math.min(120,+$('#bdCols').value|0)),rows=Math.max(4,Math.min(200,+$('#bdRows').value|0)),sv=+$('#bdSec').value;
  const sec=sv===0?rows:sv;
  if(cols===D.board.cols&&rows===D.board.rows&&sec===D.board.sec)return;
  pushUndo();D.board={cols,rows,sec};
  D.bridges=D.bridges.filter(b=>inb(b[0],b[1])&&inb(b[2],b[3])&&!sameSec(b[0],b[1],b[2],b[3]));
  D.wires=D.wires.filter(w=>inb(w.a[0],w.a[1])&&inb(w.b[0],w.b[1]));
  D.auto={bridges:[],wires:[]};ui.sel=null;
  if(D.settings.autoRoute&&D.links.length)route({full:true});
  commit(true);resize();boardUI();closeDlg('#dlgBoard');log(`Panel: ${cols}×${rows} lyuk, ${secLabel(D.board)}.`);
};
/* Panel beállításai: párbeszédablakban (ritkán kell); a Fájl menüből vagy a fejléc panel-adatára kattintva */
function openBoard(){boardUI();openDlg('#dlgBoard');}
$('#bBoard').onclick=openBoard;$('#boardInfo').onclick=openBoard;

/* ---------- API ---------- */
window.pcb={
  load(d){D=normalize(typeof d==='string'?JSON.parse(d):d);ui.sel=null;commit();return true;},
  get(){return JSON.parse(JSON.stringify(D));},
  /** Program (csomópontok, élek): lekérdezés, vagy beállítás (visszavonható). */
  program(p){if(p===undefined)return D.program?JSON.parse(JSON.stringify(D.program)):null;pushUndo();const n=normProgram(p);if(n&&n.nodes.length)D.program=n;else delete D.program;if(ui.sim)progStart(true);commit();return pcb.program();},
  /** Program léptetése kézzel: ms idővel előre (a valós idejű futás a progAuto(false)-szal állítható le). */
  progStep(ms=PROG_MS){progTick(ms);return pcb.progState();},
  progAuto(on){ui.progAuto=!!on;if(ui.sim)progStart(true);},
  /** Munkaterület: 'board' | 'prog' | 'split' (elhagyva: a mostani). */
  work(v){if(v)setWork(v);return ui.work||'board';},
  /** A Vezérlés nézet füle: 'nodes' | 'code'. */
  pvTab(t){if(!PE&&t!=='code')setWork('prog');if(t)pvTab(t);return ui.pvTab||'nodes';},
  /** Generált kód: lang = 'micropython' | 'arduino'. */
  code(lang='micropython'){const c=codeHost.code(lang);return c?{file:c.file,code:c.code,warnings:c.warnings,lines:c.lines}:null;},
  /** A program állapota: csomópont-kimenetek, hibák, a beállított GPIO-módok (lábnévvel). */
  progState(){const P=ui.prog;if(!P||!P.out)return null;const nm=k=>{const q=findPin(k);return q?q.name:k;};
    return{t:P.t,vals:Object.fromEntries(P.rt.vals),errors:Object.fromEntries(P.out.errors),gpio:Object.fromEntries(Object.entries(P.out.gpio).map(([k,v])=>[nm(k),v])),pwm:Object.fromEntries(Object.entries(P.out.pwm).map(([k,v])=>[nm(k),v]))};},
  /** Külső alkatrész csatlakozója: a tüskesor címkéje és a lábpárok (külső láb → tüskesor láb), vagy null. */
  plug(label){const p=D.parts.find(x=>x.label===label);const h=p&&plugOf(D,p);return h?{header:h.label,pins:plugPairs(D,p).map(([q,x])=>({from:q.id,to:x.id,name:x.name,r:x.r,c:x.c}))}:null;},
  /** Csatlakozó készítése a külső alkatrészhez (ha még nincs); a tüskesor címkéje vagy null. */
  attachPlug(label){const p=D.parts.find(x=>x.label===label);if(!p||plugOf(D,p))return null;pushUndo();const h=attachPlug(p);if(!h){HIST.drop();return null;}commit();return h.label;},
  preset(){D=(presetMacropad());commit();},
  /** Vezérlőcsere: a címkéjű vezérlőlapot a megadott típusra cseréli. */
  swapMcu(label,type){const p=D.parts.find(x=>x.label===label);return p?swapMcu(p.id,type):null;},
  /** Oldalsáv összecsukása: k = 'l' | 'r', on = true/false (elhagyva: vált). */
  /** Elrendezés: 'design' | 'prog' | 'sim' (elhagyva: a mostani). */
  layout(id){if(id)applyLayout(id);return LAY_S.cur;},
  /** Alsó panel: nyitás/csukás és fül ('issues' | 'log'); elhagyva csak lekérdez. */
  bottom(open,tab){if(open===undefined&&tab===undefined)return{open:$('#bpanel').classList.contains('open'),tab:ui.btab};return bottomPanel(open,tab);},
  /** A lebegő tulajdonságablak állapota (és hogy látszik-e). */
  propWin(){return{...PW.state(),visible:!$('#propWin').hidden};},
  /** A napló bejegyzései (a legrégebbi elöl). */
  log(){return LOG.entries.map(x=>x.m);},
  sides(k,on){return k?sideCollapse(k,on):{l:$('.app').classList.contains('colL'),r:$('.app').classList.contains('colR')};},
  examples(){return EXAMPLES.map(e=>({id:e.id,cat:e.cat,title:e.title}));},
  example(id){return loadExample(id);},
  sim(on=true){setSim(!!on);},
  press(label,down=true){const p=D.parts.find(x=>x.label===label&&hasPress(x));if(!p)return false;if(!ui.sim)setSim(true);ui.pressed[p.id]=!!down;recompute();return true;},
  read(){return SIM?SIM.gpios.map(g=>({pin:g.q.name,mode:g.mode,V:+g.V.toFixed(3),level:logic(g)})):[];},
  /** Problémák (hiba, figyelmeztetés); all: a megjegyzésekkel (info) együtt. */
  /** Egyszerű mód lekérdezése / állítása. */
  /** A csíkvágás típusa: 'auto' | 'hole' | 'gap'. */
  cutKind(k){if(k)uiPrefSet({cutKind:k});renderLeft();return cutKind();},
  simple(on){if(on!==undefined)setSimple(on);return isSimple();},
  issues(all){return ISSUES.filter(i=>all||i.sev!=='info').map(i=>({sev:i.sev,msg:i.msg,holes:i.holes}));},
  /** Az alkatrész lábai bekötöttséggel (a tulajdonságok Lábak táblázata). */
  pinRows(label){const p=D.parts.find(x=>x.label===label);return p?pinRows(D,A0,p).map(r=>({ref:r.ref,label:r.label,name:r.name,role:r.role,target:r.target,net:r.net,floating:r.floating})):null;},
  /** A láb kapcsolatának beállítása: cél 'GND' | 'GPIO' | lábhivatkozás | '' (törlés). */
  setPin(label,pin,target){const p=D.parts.find(x=>x.label===label);const q=p&&gpins(p).find(x=>x.id===pin||x.name===pin);if(!q)return false;pushUndo();if(!setPinLink(D,p.id+'.'+q.id,target,()=>'l'+(D.seq++))){HIST.drop();return false;}commit();return true;},
  route(){route({full:true});commit(true);return pcb.links();},
  move(label,dr,dc){const p=D.parts.find(x=>x.label===label);if(!p)return false;const t={...p,r:p.r+dr,c:p.c+dc};if(!partFits(t))return false;pushUndo();p.r=t.r;p.c=t.c;ui.moved=new Set([p.id]);commit();return true;},
  links(){return D.links.map(l=>({...l,text:linkText(l),...(ui.linkState.get(l.id)||{})}));},
  presetRouted(){D=(presetRouted());commit();},
  toAuto(pid){return manualToAuto(pid||null);},
  defs(){return JSON.parse(JSON.stringify(PARTS));},
  // --- tesztekhez és szkripteléshez ---
  select(labels){const ids=D.parts.filter(p=>labels.includes(p.label)).map(p=>p.id);ui.sel=ids.length?grp(ids):null;renderLeft();draw();return ids.length;},
  rotate(){rotate();},mirror(){mirror();},undo(){undo();},redo(){redo();},
  /** A rajzon éppen látható LED-áramok (lassú PWM-nél a pillanatnyi, egyébként az átlag). */
  ledView(){const S=ui.sim&&ui.blinkSim||SIM;return S?S.leds.map(l=>({label:l.p.label,I:l.I})):[];},
  simInfo(){return SIM?{leds:SIM.leds.map(l=>({label:l.p.label,I:l.I,light:!!l.light})),fets:SIM.fets.map(f=>({label:f.p.label,on:f.on,vgs:f.vgs,I:f.I,floatGate:f.floatGate})),bats:SIM.bats.map(b=>({label:b.p.label,I:b.I,kind:b.kind})),picos:SIM.picos.map(x=>({label:x.p.label,powered:x.powered})),caps:SIM.caps.map(k=>({label:k.p.label,U:k.U,R:k.R,tau:k.tau})),bjts:SIM.bjts.map(t=>({label:t.p.label,st:t.st,ib:t.ib,ic:t.ic,vbe:t.vbe,vce:t.vce})),motors:SIM.motors.map(m=>({label:m.p.label,U:m.U,I:m.I,speed:m.speed})),logics:SIM.logics.map(L=>({label:L.p.label,vdd:L.vdd,ins:Object.fromEntries(L.ins.map(x=>[x.name,x.lv])),outs:Object.fromEntries(L.outs.map(o=>[o.name,o.st])),regs:Object.fromEntries(L.regs.map(r=>[r.name,r.val]))})),servos:SIM.servos.map(s=>({label:s.p.label,U:s.U,pulse:s.pulse,angle:s.angle})),steppers:SIM.steppers.map(s=>({label:s.p.label,pos:s.pos,angle:s.angle,coils:s.coils}))}:null;},
  pins(label){const p=D.parts.find(x=>x.label===label);if(!p)return null;const m=A0.byPart.get(p.id).map;return gpins(p).map(q=>{const on=inb(q.r,q.c);return{id:q.id,name:q.name,r:q.r,c:q.c,net:on||isOff(p)?m[q.id].net:null};});},
  netV(label,pin){const p=D.parts.find(x=>x.label===label);const q=p&&A0.pins.find(x=>x.part===p&&x.id===pin);return q&&SIM?SIM.netV.get(q.net):null;},
  linkInfo(){return D.links.map(l=>{const g=linkGeom(l);return{text:linkText(l),start:g&&g.start,end:g&&g.end,endPin:g&&g.endPin?pinLabel(g.endPin):null,bridges:g?g.bridges.length:0};});},
  selectLink(i){const l=D.links[i];ui.selLink=l?l.id:null;renderLinks();draw();status();return statusText();},
  /** A lyuk helye a képernyőn (kliens-koordináta), görgetés nélkül. */
  at(r,c){const[vx,vy]=toScreen(hx(c),hy(r));const rc=cv.getBoundingClientRect();return{x:rc.left+vx,y:rc.top+vy};},
  reveal(r,c){const sc=$('#scroll'),[vx,vy]=toScreen(hx(c),hy(r));sc.scrollTo(vpX(vx)-sc.clientWidth/2,vpY(vy)-sc.clientHeight/2);const rc=cv.getBoundingClientRect();return{x:rc.left+vx,y:rc.top+vy};},
  /** Minden saját alkatrész (könyvtár + a terv saját alkatrészei). */
  customParts(){return JSON.parse(JSON.stringify({...LIB,...(D.customParts||{})}));},
  library(){return JSON.parse(JSON.stringify(LIB));},
  projectParts(){return JSON.parse(JSON.stringify(D.customParts||{}));},
  libSearch(q){ui.libQ=q;$('#libSearch').value=q;ltab('lib');renderLib();return[...document.querySelectorAll('#lib [data-lib]')].map(b=>b.dataset.lib);},
  addPart(def){const problems=validatePartDef(def);if(hasErrors(problems))return{type:null,problems};return{type:editorHost.save(null,def),problems};},
  openEditor(type){openEditor(editorHost,type?{type}:{});},
  notes(){return JSON.parse(JSON.stringify(D.notes||[]));},
  importPlan(o){return importPlan(typeof o==='string'?JSON.parse(o):o);},
  cuts(){return{manual:JSON.parse(JSON.stringify(D.cuts||[])),auto:JSON.parse(JSON.stringify(D.auto.cuts||[]))};},
  cut(r,c,kind=0){toggleCut([r,c,kind?1:0]);return pcb.cuts();},
  pwm(pin,duty,freq){const q=D.parts.flatMap(gpins).find(x=>x.name===pin&&x.role==='gpio');if(!q||!gpioModeOk(q,'pwm'))return false;const k=q.part.id+'.'+q.id;pushUndo();D.gpio[k]='pwm';D.pwm={...(D.pwm||{}),[k]:{...pwmCfg(k),...(duty!=null?{duty}:{}),...(freq!=null?{freq}:{})}};commit();return true;},
  gpio(pin,mode){const q=D.parts.flatMap(gpins).find(x=>x.name===pin&&x.role==='gpio');if(!q||!GPIO_MODES.some(m=>m[0]===mode)||!gpioModeOk(q,mode))return false;D.gpio[q.part.id+'.'+q.id]=mode;commit();return true;},
  slider(label,key,v){const p=D.parts.find(x=>x.label===label);return !!p&&setSlider(p,key,v);},
  version:__APP_VERSION__
};
function statusText(){return $('#status').textContent;}

/* ---------- Indulás ---------- */
(function init(){
  {const l=loadLib();if(l)setLib(l);else{try{const s=localStorage.getItem(STORE_KEY);const cp=s&&JSON.parse(s).customParts;if(cp&&typeof cp==='object'){const r=importLibrary(exportLibrary(cp),()=>false);setLib(r.parts);}}catch(e){}saveLib();}} // első indításkor a tervben lévő saját alkatrészek lesznek a könyvtár
  let d=null;try{const s=localStorage.getItem(STORE_KEY);if(s)d=normalize(JSON.parse(s));}catch(e){d=null;}
  D=d||emptyDesign();syncDefs(D.customParts);
  boardUI();
  A0=analyze(false);AS=A0;setView('comp');renderLeft();recompute();
  // kezdeti nagyítás a szélességhez
  const sc=$('#scroll');const fit=(sc.clientWidth-2*(32+EXT*14))/(D.board.cols*14);ui.zoom=Math.max(0.8,Math.min(1.6,Math.floor(fit*5)/5||1));
  if(MOB.matches){ui.zoom=1.2;resize();const [x,y]=toScreen(M-30,M-28);sc.scrollTo(vpX(x),vpY(y));}else{resize();homeView();}
  boardSelects();introUI();
  window.addEventListener('resize',()=>draw());
  splitDir(!!uiPref().splitV);
  applyLayout(LAY_S.cur,false);
  setSimple(!!uiPref().simple,false);
  restoreParked(editorHost); // a háttérben hagyott, nem mentett alkatrész füle
})();
