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
import { openEditor } from './ui/editor';
import { LEDC, PARTS, PICO_NAMES, picoRole } from './parts/builtin';
import { solve } from './engine/solve';

const STORE_KEY = 'proofboard.design.v1';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* ---------- Alkatrész-definíciók ---------- */
const rgba=(hex,a)=>{const n=parseInt(hex.slice(1),16);return`rgba(${n>>16},${(n>>8)&255},${n&255},${a})`;};
const ROLEC={c:'#868e96',cp:'#e03131',cn:'#1f2328',col:'#5c666e',base:'#2563eb',emit:'#1f2328',vin:'#d6336c',pout:'#e8590c',chg:'#e8590c',sig:'#2563eb',adc:'#0ca678',nc:'#adb5bd',j:'#aeb5bb',s:'#1f2328',g:'#2563eb',d:'#868e96',A:'#2563eb',B:'#d97706',an:'#e03131',ka:'#1f2328',gnd:'#1f2328',p33:'#e03131',pwr:'#be4bdb',gpio:'#2563eb',misc:'#868e96',r:'#868e96',h:'#868e96',bp:'#e03131',bn:'#1f2328'};
const DEFS=compileAll(PARTS);
/** A saját alkatrészek fordítása a beépítettek mellé (a terv `customParts` mezőjéből). */
function syncDefs(custom){
  for(const k of Object.keys(DEFS))if(!(k in PARTS))delete DEFS[k];
  for(const [k,d] of Object.entries(custom||{})){try{DEFS[k]=compilePart(k,{cat:'Saját',...d});}catch(e){console.warn('Saját alkatrész kihagyva:',k,e);}}
}
const penv=p=>penvD(DEFS[p.type].def,p);
const hasPress=p=>(DEFS[p.type].def.controls||[]).some(c=>c.kind==='press');
const hasCap=(q,c)=>!!(q&&q.caps&&q.caps.includes(c));
/** Az ADC-képes GPIO-n analóg forrás (adc szerepű láb) is van → alapból analóg mód. */
function gpioDefault(q,A){const qs=A&&A.netPins.get(q.net)||[];return hasCap(q,'adc')&&qs.some(x=>x.role==='adc')?'adc':'pullup';}
const WCOL=[['#1c7ed6','kék'],['#e03131','piros'],['#212529','fekete'],['#f59f00','sárga'],['#2f9e44','zöld'],['#f1f3f5','fehér'],['#e8590c','narancs']];
const TOOLS=[['select','Kijelölés','V'],['bridge','Forrasztóhíd','B'],['wire','Vezeték','W'],['link','Kapcsolat','C'],['erase','Törlés','E'],['pan','Mozgatás','H']];

/* ---------- Állapot ---------- */
const emptyDesign=()=>({v:1,board:{rows:78,cols:39,sec:3},parts:[],bridges:[],wires:[],links:[],auto:{bridges:[],wires:[]},customParts:{},gpio:{},settings:{usb:true,btnMode:'hold',autoRoute:true},seq:1});
let D, A0, AS, SIM, ISSUES=[];
const ui={tool:'select',view:'comp',zoom:1,sim:false,hover:null,sel:null,placing:null,ghost:{rot:0,mir:false},wireStart:null,drag:null,pressed:{},holdPtr:new Map(),flash:null,undo:[],redo:[],wireColor:'#1c7ed6',confirmClear:0,linkStart:null,hideAuto:null,rats:false,xray:false,selLink:null,linkState:new Map()};

function presetMacropad(){
  /* Hídra optimalizált kiosztás: 0 vezeték. Cella = 3 lyukas szekció; sáv b = 3b…3b+2. sor.
     Pico alsó sora a 4. sávban (12. sor), a csatornák a gombtestek alatt futnak fel,
     a GND-t a gombok belső B1–B2 kötése viszi át soron belül. */
  const d=emptyDesign();
  const add=(type,r,c,rot,mir,props,label)=>{const p={id:'p'+(d.seq++),type,label,r,c,rot,mir,props:{...DEFS[type].props,...props}};d.parts.push(p);return p;};
  const br=(a,b,c,e)=>d.bridges.push([a,b,c,e]);
  const V=(col,b1,b2)=>{for(let b=Math.min(b1,b2);b<Math.max(b1,b2);b++)br(3*b+2,col,3*b+3,col);}; // függőleges lánc sávok között
  const H=(row,c1,c2)=>{const s=Math.sign(c2-c1);for(let c=c1;c!==c2;c+=s)br(row,c,row,c+s);};    // vízszintes lánc egy soron
  const mid=b=>3*b+1;
  const pico=add('pico',12,32,2,false,{span:6},'PICO');
  const ROWS=[25,34,43],COLS=[9,17,25],NM=[['K1','K2','K3'],['K4','K5','K6'],['K7','K8','K9']];
  ROWS.forEach((r,i)=>COLS.forEach((c,j)=>add('button',r,c,0,false,{},NM[i][j])));
  add('button',43,1,0,false,{},'Fn');
  // jelcsatornák → GPIO
  V(14,8,7);H(mid(7),14,17);V(17,7,4);            // K1 → GP19
  H(34,14,13);V(13,11,6);H(mid(6),13,16);V(16,6,4); // K4 → GP18
  H(43,14,12);V(12,14,5);H(mid(5),12,14);V(14,5,4); // K7 → GP17
  H(25,17,18);V(18,8,4);                          // K2 → GP20
  H(34,17,19);V(19,11,4);                         // K5 → GP21
  H(43,22,21);V(21,14,4);                         // K8 → GP22
  H(25,25,26);V(26,8,4);                          // K3 → GP28
  H(34,25,24);V(24,11,4);                         // K6 → GP27
  H(43,25,23);V(23,14,4);                         // K9 → GP26
  H(43,6,7);V(7,14,4);H(13,7,13);                 // Fn → GP16 (balról, a Pico mellett)
  // GND: soron belül a gombok viszik, résekben híd
  for(const r of [27,36,45])H(r,14,17);           // K1–K2, K4–K5, K7–K8
  V(15,9,15);                                     // bal oldali gerinc a sorok között
  H(45,6,9);H(45,22,25);                          // Fn–K7, K8–K9
  for(const r of [27,36,45])br(r,30,r,31);        // jobb oldali gerinc
  V(31,5,15);H(mid(5),31,30);V(30,5,4);           // → Pico GND (38. láb)
  // LED-ek a Pico bal oldalán, a felső lábsorról
  br(7,13,7,12);                                  // GP15 → 2. sáv
  br(5,14,6,14);H(5,14,12);                       // GP14 → 1. sáv
  br(5,16,6,16);br(2,16,3,16);H(2,16,12);         // GP13 → 0. sáv
  br(8,15,9,15);H(10,15,7);br(8,7,9,7);br(5,7,6,7);br(2,7,3,7); // GND (18. láb) → katódok
  [['red','R1','LED1'],['green','R2','LED2'],['yellow','R3','LED3']].forEach(([color,rl,ll],k)=>{
    add('res',3*k,12,2,false,{ohm:1000},rl);       // GPIO-cella (12. oszlop) → 8. oszlop
    add('led',3*k+1,8,2,false,{color},ll);         // anód 8. oszlop, katód 7. oszlop (GND)
  });
  d.gpio[pico.id+'.17']='out_high';d.gpio[pico.id+'.19']='out_low';d.gpio[pico.id+'.20']='out_low';
  return d;
}

/* ---------- Geometria ---------- */
function xf(p,lr,lc){let r=lr,c=p.mir?-lc:lc;for(let k=0;k<(p.rot&3);k++){const t=r;r=c;c=-t;}return[p.r+r,p.c+c];}
function xv(p,lr,lc){let r=lr,c=p.mir?-lc:lc;for(let k=0;k<(p.rot&3);k++){const t=r;r=c;c=-t;}return[r,c];}
function ixf(p,R,C){let r=R-p.r,c=C-p.c;const n=(4-(p.rot&3))&3;for(let k=0;k<n;k++){const t=r;r=c;c=-t;}if(p.mir)c=-c;return[r,c];}
function gpins(p){return DEFS[p.type].pins(p).map(pn=>{const[r,c]=xf(p,pn.lr,pn.lc);return{...pn,r,c,part:p};});}
const inb=(r,c)=>r>=0&&c>=0&&r<D.board.rows&&c<D.board.cols;
const secStart=r=>r-(r%D.board.sec);
const EXT=8; // ennyi lyuknyit lóghat ki egy alkatrész a panelról
function partFits(p){const g=gpins(p);return g.some(q=>inb(q.r,q.c))&&g.every(q=>q.r>=-EXT&&q.c>=-EXT&&q.r<D.board.rows+EXT&&q.c<D.board.cols+EXT);}

/* ---------- Netlista ---------- */
function analyze(press){
  const B=D.board,SR=Math.ceil(B.rows/B.sec),N=B.cols*SR;
  const sid=(r,c)=>c*SR+Math.floor(r/B.sec);
  const parts=D.parts.map(p=>[p,gpins(p)]);let off=0;for(const [,gp] of parts)for(const q of gp)if(!inb(q.r,q.c))off++;
  const par=new Int32Array(N+off);for(let i=0;i<N+off;i++)par[i]=i;
  const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
  const uni=(a,b)=>{a=find(a);b=find(b);if(a!==b)par[Math.max(a,b)]=Math.min(a,b);};
  const AB=D.auto.bridges.filter(b=>!autoHidden(b[4])),AW=D.auto.wires.filter(w=>!autoHidden(w.links));
  for(const b of [...D.bridges,...AB]) if(inb(b[0],b[1])&&inb(b[2],b[3])) uni(sid(b[0],b[1]),sid(b[2],b[3]));
  for(const w of [...D.wires,...AW]) if(inb(w.a[0],w.a[1])&&inb(w.b[0],w.b[1])) uni(sid(w.a[0],w.a[1]),sid(w.b[0],w.b[1]));
  const pins=[],byPart=new Map();let k=N;
  for(const [p,gp] of parts){
    const m={};
    for(const q of gp){q.on=inb(q.r,q.c);q.s=q.on?sid(q.r,q.c):k++;m[q.id]=q;pins.push(q);} // panelon kívüli láb: saját, magányos csomópont
    byPart.set(p.id,{pins:gp,map:m,out:gp.some(q=>!q.on)});
    for(const [a,b] of DEFS[p.type].internal(p)) uni(m[a].s,m[b].s);
    if(press&&ui.pressed[p.id])for(const c of DEFS[p.type].def.controls||[])if(c.kind==='press')for(const [a,b] of c.closes)if(m[a]&&m[b])uni(m[a].s,m[b].s);
  }
  for(const q of pins) q.net=find(q.s);
  const netPins=new Map(),netSecs=new Map();
  for(const q of pins){if(!netPins.has(q.net))netPins.set(q.net,[]);netPins.get(q.net).push(q);}
  for(let s=0;s<N;s++){const r=find(s);netSecs.set(r,(netSecs.get(r)||0)+1);}
  return{SR,N,find,sid,pins,byPart,netPins,netSecs};
}
const pinLabel=q=>q.part.type==='pico'?`${q.part.label}.${q.name}`:`${q.part.label}.${q.id}`;

/* ---------- Áramkör-szimuláció (csomóponti analízis, szakaszonként lineáris diódák) ---------- */
const GPIO_MODES=[['pullup','be, felhúzva'],['pulldown','be, lehúzva'],['float','be, lebegő'],['adc','analóg (ADC)'],['out_high','ki: 1'],['out_low','ki: 0']];
function gpioMode(p,id,q,A){return D.gpio[p.id+'.'+id]||(q?gpioDefault(q,A):'pullup');}
const RBE=20,RCE=1; // NPN: bázis-emitter és telítési soros ellenállás (Ω)
function simulate(A){
  const idx=new Map();const nd=net=>{if(!idx.has(net))idx.set(net,idx.size);return idx.get(net);};
  for(const q of A.pins) if(q.net>=0) nd(q.net);
  const n=idx.size;
  const picos=[],leds=[],ress=[],bats=[],fets=[],caps=[],bjts=[];
  for(const p of D.parts){const bp=A.byPart.get(p.id);const m=bp.map,N=id=>idx.get(m[id].net);const model=DEFS[p.type].def.model;if(!model)continue;const E=penv(p);
    for(const el of model){
      if(el.el==='pico')picos.push({p,gnd:N(el.gnd),vbus:N(el.vbus),vsys:N(el.vsys),v33:N(el.v33),gp:bp.pins.filter(q=>q.role==='gpio').map(q=>({q,node:idx.get(q.net),mode:gpioMode(p,q.id,q,A)})),reg:false,d:false});
      else if(el.el==='diode')leds.push({p,a:N(el.a),k:N(el.k),vf:num(el.vf,E),ron:Math.max(1e-3,num(el.ron??15,E)),imax:el.imax!=null?num(el.imax,E):null,light:!!el.light,on:false});
      else if(el.el==='resistor')ress.push({p,a:N(el.a),b:N(el.b),g:1/Math.max(1e-3,num(el.ohm,E))});
      else if(el.el==='source')bats.push({p,a:N(el.p),b:N(el.n),E:num(el.v,E),g:1/Math.max(1e-3,num(el.rint??0.1,E)),kind:el.kind||'battery'});
      else if(el.el==='capacitor')caps.push({p,a:N(el.a),b:N(el.b),f:num(el.f,E),vmax:el.vmax!=null?num(el.vmax,E):null,polar:!!el.polar});
      else if(el.el==='npn')bjts.push({p,c:N(el.c),b:N(el.b),e:N(el.e),beta:Math.max(1,num(el.beta,E)),vbe:num(el.vbe??0.65,E),vcesat:num(el.vcesat??0.1,E),imax:el.imax!=null?num(el.imax,E):null,be:false,st:'off',ic:0});
      else if(el.el==='nmos')fets.push({p,d:N(el.d),g:N(el.g),s:N(el.s),vth:num(el.vth,E),ron:Math.max(1e-3,num(el.ron,E)),imax:el.imax!=null?num(el.imax,E):null,on:false});
    }
  }
  let V=new Float64Array(n),els=[];
  for(let it=0;it<60;it++){
    els=[];const add=(a,b,g,E,kind,ref,cp,cn)=>els.push(cp==null?{a,b,g,E,kind,ref}:{a,b,g,E,kind,ref,cp,cn});
    for(let i=0;i<n;i++)add(i,-1,1e-9,0,'leak');
    for(const pc of picos){
      add(pc.gnd,-1,1e4,0,'gref',pc);
      if(D.settings.usb)add(pc.vbus,pc.gnd,10,5,'vbus',pc);
      add(pc.vbus,pc.vsys,pc.d?5:1e-9,pc.d?0.3:0,'pdiode',pc);
      if(pc.reg){add(pc.v33,pc.gnd,10,3.3,'v33',pc);
        for(const g of pc.gp){
          if(g.mode==='pullup')add(g.node,pc.v33,2e-5,0,'pull',g);
          else if(g.mode==='pulldown')add(g.node,pc.gnd,2e-5,0,'pull',g);
          else if(g.mode==='out_high')add(g.node,pc.gnd,1/40,3.3,'gout',g);
          else if(g.mode==='out_low')add(g.node,pc.gnd,1/40,0,'gout',g);}}
    }
    for(const r of ress)add(r.a,r.b,r.g,0,'res',r);
    for(const l of leds)add(l.a,l.k,l.on?1/l.ron:1e-9,l.on?l.vf:0,'led',l);
    for(const b of bats)add(b.a,b.b,b.g,b.E,'bat',b);
    for(const f of fets)add(f.d,f.s,f.on?1/f.ron:1e-9,0,'fet',f);
    // NPN: B–E dióda; C–E lezárva, telítve (kis ellenállás + Uce,sat) vagy aktívan (áramforrás Ic = β·Ib)
    for(const t of bjts){add(t.b,t.e,t.be?1/RBE:1e-9,t.be?t.vbe:0,'bjt_be',t);
      if(t.st==='sat')add(t.c,t.e,1/RCE,t.vcesat,'bjt_ce',t);else if(t.st==='act')add(t.c,t.e,t.beta/RBE,t.vbe,'bjt_ce',t,t.b,t.e);} // aktív: Ic = β·(Ube−0,65)/Rbe = β·Ib
    V=solve(n,els);
    let ch=false;
    for(const l of leds){const d=V[l.a]-V[l.k];if(!l.on&&d>l.vf+1e-4){l.on=true;ch=true;}else if(l.on&&d<l.vf){l.on=false;ch=true;}}
    for(const f of fets){const on=(V[f.g]-V[f.s])>f.vth;if(on!==f.on){f.on=on;ch=true;}}
    for(const t of bjts){const vbe=V[t.b]-V[t.e],vce=V[t.c]-V[t.e];
      if(!t.be&&vbe>t.vbe+1e-4){t.be=true;ch=true;}else if(t.be&&vbe<t.vbe){t.be=false;ch=true;}
      const want=t.beta*(t.be?Math.max(0,(vbe-t.vbe)/RBE):0);
      if(!t.be){if(t.st!=='off'){t.st='off';ch=true;}}
      else if(t.st==='off'){t.st='act';ch=true;}
      else if(t.st==='sat'){if((vce-t.vcesat)/RCE>want*1.02+1e-9){t.st='act';ch=true;}}
      else if(vce<t.vcesat-0.01){t.st='sat';ch=true;}}
    for(const pc of picos){const d=V[pc.vbus]-V[pc.vsys];if(!pc.d&&d>0.3001){pc.d=true;ch=true;}else if(pc.d&&d<0.3){pc.d=false;ch=true;}
      const w=(V[pc.vsys]-V[pc.gnd])>1.8;if(w!==pc.reg){pc.reg=w;ch=true;}}
    if(!ch)break;
  }
  const vv=i=>i>=0?V[i]:0,cur=e=>e.g*(vv(e.cp??e.a)-vv(e.cn??e.b)-e.E);
  // lebegés: forrásokból elérhető-e
  const adj=Array.from({length:n},()=>[]),seed=new Set();
  for(const e of els){if(e.kind==='leak'||e.g<1e-6||e.cp!=null)continue;if(e.a>=0&&e.b>=0){adj[e.a].push(e.b);adj[e.b].push(e.a);}
    if(['gref','vbus','v33','gout','bat'].includes(e.kind)){if(e.a>=0)seed.add(e.a);if(e.b>=0)seed.add(e.b);}}
  const reach=new Uint8Array(n),st=[...seed];st.forEach(i=>reach[i]=1);
  while(st.length){const i=st.pop();for(const j of adj[i])if(!reach[j]){reach[j]=1;st.push(j);}}
  const netV=new Map(),floating=new Set();
  for(const [net,i] of idx){netV.set(net,V[i]);if(!reach[i])floating.add(net);}
  const out={netV,floating,leds:[],picos:[],gpios:[],bats:[],srcI:[],fets:[],caps:[],bjts:[]};
  // kondenzátor: feszültség és időállandó (τ = R·C, R a kapcsain látott Thevenin-ellenállás a munkapontban)
  for(const k of caps){const U=V[k.a]-V[k.b],test=solve(n,[...els,{a:k.a,b:k.b,g:1e-9,E:-1e6}]),R=Math.abs((test[k.a]-test[k.b])-U)/1e-3;
    out.caps.push({p:k.p,U,f:k.f,vmax:k.vmax,polar:k.polar,R,tau:R<1e8?R*k.f:null,float:!reach[k.a]||!reach[k.b]});}
  for(const t of bjts){const be=els.find(e=>e.kind==='bjt_be'&&e.ref===t),ce=els.find(e=>e.kind==='bjt_ce'&&e.ref===t);
    out.bjts.push({p:t.p,st:t.st,ib:be?Math.max(0,cur(be)):0,ic:ce?cur(ce):0,vbe:V[t.b]-V[t.e],vce:V[t.c]-V[t.e],beta:t.beta,imax:t.imax,floatBase:!reach[t.b]});}
  for(const e of els){
    if(e.kind==='led')out.leds.push({p:e.ref.p,I:Math.max(0,cur(e)),on:e.ref.on,light:e.ref.light,imax:e.ref.imax});
    if(e.kind==='fet'){const f=e.ref;out.fets.push({p:f.p,on:f.on,vgs:V[f.g]-V[f.s],I:cur(e),imax:f.imax,floatGate:!reach[f.g]});}
    if(e.kind==='bat')out.bats.push({p:e.ref.p,I:cur(e),kind:e.ref.kind,node:e.a});
    if(e.kind==='vbus')out.srcI.push({kind:'vbus',pc:e.ref,I:-cur(e)});
    if(e.kind==='v33')out.srcI.push({kind:'v33',pc:e.ref,I:-cur(e)});
  }
  for(const pc of picos){
    out.picos.push({p:pc.p,powered:pc.reg,usb:D.settings.usb,feeds:pc.d,vsys:pc.vsys});
    for(const g of pc.gp){const e=els.find(x=>x.kind==='gout'&&x.ref===g);
      out.gpios.push({p:pc.p,q:g.q,mode:g.mode,V:V[g.node]-V[pc.gnd],I:e?-cur(e):0,float:!reach[g.node],powered:pc.reg});}
  }
  return out;
}
const logic=g=>!g.powered?'–':g.float?'?':g.mode==='adc'?'A':g.V>=2?'1':g.V<=0.8?'0':'?';

/* ---------- Ellenőrzés ---------- */
function checkAll(){
  const iss=[],add=(sev,msg,holes)=>iss.push({sev,msg,holes:holes||[]});
  const A=A0;
  const hasPico=D.parts.some(p=>p.type==='pico');
  for(const p of D.parts){const bp=A.byPart.get(p.id);if(bp.pins.every(q=>!q.on))add('warn',`${p.label}: teljesen a panelon kívül esik`,[]);}
  const hole=new Map();
  for(const q of A.pins){if(!q.on)continue;const k=q.r+':'+q.c;if(!hole.has(k))hole.set(k,[]);hole.get(k).push(q);}
  for(const [k,a] of hole) if(a.length>1) add('err',`Ütközés a ${k} lyukban: ${a.map(pinLabel).join(', ')}`,[[a[0].r,a[0].c]]);
  // alkatrészen belüli rövidzár (Pico kivételével)
  for(const p of D.parts){if(p.type==='pico')continue;const bp=A.byPart.get(p.id);
    const g={};const f=x=>g[x]===x?x:(g[x]=f(g[x]));bp.pins.forEach(q=>g[q.id]=q.id);
    for(const [a,b] of DEFS[p.type].internal(p))g[f(a)]=f(b);
    const byNet=new Map();for(const q of bp.pins){const k=f(q.id);if(!byNet.has(q.net))byNet.set(q.net,new Map());const m=byNet.get(q.net);if(!m.has(k))m.set(k,q);}
    for(const [,m] of byNet) if(m.size>1){const qs=[...m.values()];const same=qs.some((x,i)=>qs.some((y,j)=>j>i&&x.s===y.s));
      let msg=p.type==='button'?`${p.label}: az A és B oldal közös neten van, a gomb rövidre zárt`:p.type==='bat'?`${p.label}: az akku + és − pólusa össze van kötve`:`${p.label}: ${qs.map(q=>q.name).join(' és ')} össze van kötve`;
      if(same)msg+=' (egy szekcióba esnek)';
      add(p.type==='button'||p.type==='bat'?'err':'warn',msg,qs.map(q=>[q.r,q.c]));}
  }
  // net-szintű szabályok
  const picoSec=[];
  for(const [net,qs] of A.netPins){
    const pq=qs.filter(q=>q.part.type==='pico');
    const distinct=new Map();pq.forEach(q=>{const k=q.part.id+'.'+(q.role==='gnd'?'GND':q.id);if(!distinct.has(k))distinct.set(k,q);});
    const dq=[...distinct.values()];
    if(dq.length>1){const same=dq.some((x,i)=>dq.some((y,j)=>j>i&&x.s===y.s&&x.part===y.part));
      if(same){picoSec.push(dq);continue;}}
    const rails=new Set();
    for(const q of qs){if(q.part.type==='pico'){if(q.role==='gnd')rails.add('GND');else if(q.role==='p33')rails.add('3V3');else if(q.role==='pwr')rails.add(q.name);}
      else if(q.role==='bp'||q.role==='chg'||q.role==='pout')rails.add('BAT+');}
    const holes=qs.map(q=>[q.r,q.c]);
    if(rails.has('GND')&&rails.size>1)add('err',`Zárlat: GND – ${[...rails].filter(x=>x!=='GND').join(', ')}`,holes);
    else if(rails.has('3V3')&&rails.size>1)add('err',`Zárlat: 3V3 – ${[...rails].filter(x=>x!=='3V3').join(', ')}`,holes);
    const gp=dq.filter(q=>q.role==='gpio');
    if(gp.length>1)add('warn',`${gp.map(q=>q.name).join(', ')} közös neten van`,holes);
    if(gp.length&&rails.size)add('warn',`${gp.map(q=>q.name).join(', ')} közvetlenül ${[...rails].join('/')}-re kötve`,holes);
  }
  {const srcSig=new Map();for(const l of D.links){if(l.b!=='GND'&&l.b!=='GPIO')continue;const q=findPin(l.a);if(!q)continue;const k=q.part.id+':'+partGroups(q.part)[q.id];if(!srcSig.has(k))srcSig.set(k,{sg:l.b==='GND'?'GND':'G'+l.id,q});}
    for(const [net,qs] of A.netPins){const sigs=new Map();if(qs.some(q=>q.part.type==='pico'&&q.role==='gnd'))sigs.set('GND',null);
      for(const q of qs){const e=srcSig.get(q.part.id+':'+partGroups(q.part)[q.id]);if(e&&!sigs.has(e.sg))sigs.set(e.sg,e.q);}
      if(sigs.size>1){const names=[...sigs.entries()].map(([k,q])=>q?pinLabel(q):'GND');add('err',`Összeérő jelek: ${names.join(' · ')}`,qs.map(q=>[q.r,q.c]));}
      else{const btnA=new Map();for(const q of qs)if(q.part.type==='button'&&q.role==='A')btnA.set(q.part.id,q);const gp=qs.find(q=>q.part.type==='pico'&&q.role==='gpio');
        if(gp&&btnA.size>1)add('warn',`${[...btnA.values()].map(q=>q.part.label).join(', ')} ugyanazon a GPIO-n (${gp.name})`,[...btnA.values()].map(q=>[q.r,q.c]));}}}
  {const box=p=>{const b=DEFS[p.type].bounds(p),pts=[[b.r0,b.c0],[b.r0,b.c1],[b.r1,b.c0],[b.r1,b.c1]].map(([r,c])=>xf(p,r,c));const rs=pts.map(x=>x[0]),cs=pts.map(x=>x[1]);return[Math.min(...rs)+0.25,Math.max(...rs)-0.25,Math.min(...cs)+0.25,Math.max(...cs)-0.25];};
    const bx=D.parts.map(p=>[p,box(p)]);
    for(let i=0;i<bx.length;i++)for(let j=i+1;j<bx.length;j++){const [p,a]=bx[i],[q,b]=bx[j];if(a[0]<b[1]&&b[0]<a[1]&&a[2]<b[3]&&b[2]<a[3])add('warn',`${p.label} és ${q.label} teste átfed`,[[p.r,p.c],[q.r,q.c]]);}}
  if(picoSec.length>3){const p=picoSec[0][0].part;add('err',`${p.label}: ${picoSec.length} szekcióban több láb közös szekcióba esik. A lábsor nem futhat szekcióirányban, forgasd 90°-kal.`,picoSec.flatMap(a=>a.map(q=>[q.r,q.c])));}
  else for(const dq of picoSec)add('err',`Zárlat: ${dq.map(pinLabel).join(' · ')} egy szekcióba esik`,dq.map(q=>[q.r,q.c]));
  // vezetékvégek
  const pinHole=new Set(A.pins.map(q=>q.r+':'+q.c)),wend=new Map();
  D.wires.forEach((w,i)=>{for(const e of [w.a,w.b]){const k=e[0]+':'+e[1];wend.set(k,(wend.get(k)||0)+1);
    if(pinHole.has(k)){const sug=freeHoleNear(e[0],e[1],pinHole);add('warn',`Vezetékvég a ${k} lyukban egy alkatrészlábbal közösen, ez nem elég stabil. ${sug?`Tedd át a ${sug} lyukba (ugyanaz a szekció).`:'A szekcióban nincs szabad lyuk: hídd át egy oldalszomszédos szekcióba, és onnan vezesd tovább.'}`,[e]);}}});
  for(const [k,n] of wend) if(n>1){const [r,c]=k.split(':').map(Number);add('warn',`${n} vezetékvég ugyanabban a ${k} lyukban`,[[r,c]]);}
  // gombok GPIO nélkül
  for(const l of D.links){const st=ui.linkState.get(l.id);if(st&&!st.ok){const q=findPin(l.a);add('warn',`Kapcsolat nincs bekötve: ${linkText(l)}`,q?[[q.r,q.c]]:[]);}
    else if(st&&st.wire){const q=findPin(l.a);add('warn',`${linkText(l)}: csak vezetékkel köthető be (nincs szabad hídút)`,q?[[q.r,q.c]]:[]);}}
  if(hasPico)for(const p of D.parts){if(p.type!=='button')continue;if(D.links.some(l=>l.a.startsWith(p.id+'.')))continue;const m=A.byPart.get(p.id).map;
    const ok=['A1','B1'].some(id=>(A.netPins.get(m[id].net)||[]).some(q=>q.part.type==='pico'&&q.role==='gpio'));
    if(!ok)add('warn',`${p.label}: egyik oldala sincs GPIO-ra kötve`,[[m.A1.r,m.A1.c]]);}
  // szimulációs áramok
  if(SIM){
    for(const s of SIM.srcI){if(s.kind==='vbus'&&s.I>1)add('err',`Zárlat a VBUS-on (${s.I.toFixed(1)} A)`,[]);if(s.kind==='v33'&&s.I>0.3)add('err',`3V3 túlterhelve vagy zárlatos (${(s.I*1000).toFixed(0)} mA)`,[]);}
    for(const g of SIM.gpios){const mA=Math.abs(g.I)*1000;if(mA>50)add('err',`${g.q.name}: ${mA.toFixed(0)} mA, kimenet zárlatban`,[[g.q.r,g.q.c]]);else if(mA>12)add('warn',`${g.q.name}: ${mA.toFixed(1)} mA, sok (ajánlott max. ~12 mA)`,[[g.q.r,g.q.c]]);}
    for(const l of SIM.leds){if(l.light&&l.I>0.03)add('warn',`${l.p.label}: ${(l.I*1000).toFixed(0)} mA, előtét-ellenállás kell`,[]);else if(!l.light&&l.imax&&l.I>l.imax)add('warn',`${l.p.label}: ${fmtSI(l.I)}A, több a megengedett ${fmtSI(l.imax)}A-nél`,[]);}
    for(const t of SIM.bjts){const L=t.p.label;
      if(t.floatBase)add('warn',`${L}: a bázis lebeg. Tegyél lehúzó ellenállást a B és az E közé (pl. 10 kΩ), vagy kösd kimenetre.`,[]);
      if(t.imax&&Math.abs(t.ic)>t.imax)add('warn',`${L}: ${fmtSI(Math.abs(t.ic))}A kollektoráram, több a megengedett ${fmtSI(t.imax)}A-nél`,[]);
      else if(t.st==='act'&&t.ic>1e-3)add('warn',`${L}: nem telítődik (Uce ${t.vce.toFixed(2)} V, Ic ${fmtSI(t.ic)}A = β·Ib). Kapcsolónak kisebb bázisellenállás kell: a bázisáram (most ${fmtSI(t.ib)}A) legyen a kívánt kollektoráram kb. tizede.`,[]);}
    for(const k of SIM.caps){const L=k.p.label;if(k.float)continue;
      if(k.polar&&k.U<-0.5)add('err',`${L}: fordítva van bekötve (${k.U.toFixed(2)} V). Az elektrolit kondenzátor + lába kerüljön a magasabb feszültségre.`,[]);
      else if(k.vmax!=null&&Math.abs(k.U)>k.vmax)add('err',`${L}: ${Math.abs(k.U).toFixed(2)} V, több a névleges ${k.vmax} V-nál`,[]);}
    for(const f of SIM.fets){if(f.floatGate)add('warn',`${f.p.label}: a gate lebeg. Tegyél lehúzó ellenállást a G és az S közé (pl. 100 kΩ), vagy kösd kimenetre.`,[]);if(f.imax&&Math.abs(f.I)>f.imax)add('warn',`${f.p.label}: ${fmtSI(Math.abs(f.I))}A, több a megengedett ${fmtSI(f.imax)}A-nél`,[]);}
    for(const b of SIM.bats){if(b.kind==='supply'){if(b.I<-2)add('err',`${b.p.label}: zárlat a tápbemeneten (${(-b.I).toFixed(1)} A)`,[]);continue;}
      // töltőmodulról (chg láb) tölt-e, vagy közvetlenül a Pico USB-jéről a VSYS-en át
      const bq=AS.byPart.get(b.p.id).pins,direct=SIM.picos.some(pc=>pc.feeds&&pc.vsys===b.node);
      const charger=!direct&&bq.some(q=>(AS.netPins.get(q.net)||[]).some(x=>x.role==='chg'&&x.part!==b.p));
      if(direct&&b.I>0.1){add('err',`${b.p.label}: a Pico USB-je a VSYS-en át közvetlenül tölti az akkut (${b.I.toFixed(1)} A). Az akku és a VSYS közé Schottky-dióda kell.`,[]);continue;}
      if(charger&&b.I>0){if(b.I>1.2)add('warn',`${b.p.label}: ${b.I.toFixed(1)} A töltőáram, sok`,[]);continue;}
      if(b.I>2)add('err',`${b.p.label}: zárlat (${b.I.toFixed(1)} A)`,[]);else if(b.I>0.1)add('err',`${b.p.label}: az USB közvetlenül tölti az akkut (${b.I.toFixed(1)} A). A VSYS elé Schottky-dióda kell.`,[]);else if(b.I<-2)add('err',`${b.p.label}: zárlat (${(-b.I).toFixed(1)} A)`,[]);}
  }
  // tápbemenetek: feszültség a saját GND-lábhoz képest
  if(SIM)for(const p of D.parts){const bp=AS.byPart.get(p.id);const vins=bp.pins.filter(q=>q.role==='vin');if(!vins.length)continue;
    const gq=bp.pins.find(q=>q.role==='gnd'),model=DEFS[p.type].def.model||[],V=q=>SIM.floating.has(q.net)?null:SIM.netV.get(q.net);
    for(const q of vins){const own=model.some(el=>el.el==='source'&&el.p===q.id);
      const v=V(q),g=gq?V(gq):0,U=v==null||g==null?null:v-g,at=[[q.r,q.c]];
      if(U==null||U<0.5){if(!own)add('warn',`${p.label}.${q.name}: nincs tápfeszültség${v!=null&&gq&&g==null?` (a ${gq.name} nincs bekötve)`:''}`,at);}
      else if(q.vmax!=null&&U>q.vmax+0.05)add('err',`${p.label}.${q.name}: ${U.toFixed(2)} V, több a megengedett ${q.vmax} V-nál`,at);
      else if(q.vmin!=null&&U<q.vmin-0.05)add('warn',`${p.label}.${q.name}: csak ${U.toFixed(2)} V, legalább ${q.vmin} V kell`,at);}}
  // analóg jelek: csak ADC-képes GPIO-ra
  for(const [,qs] of A.netPins){const an=qs.filter(q=>q.role==='adc');if(!an.length)continue;
    for(const g of qs.filter(q=>q.role==='gpio')){const at=[[g.r,g.c]],src=an.map(pinLabel).join(', ');
      if(!hasCap(g,'adc')){const ok=[...new Set(gpins(g.part).filter(x=>hasCap(x,'adc')).map(x=>x.name))];add('warn',`${src}: analóg jel a ${g.name}-n, de azon nincs ADC. Erre alkalmas: ${ok.join(', ')||'–'}`,at);}
      else{const m=gpioMode(g.part,g.id,g,A);if(m!=='adc'&&m!=='float')add('warn',`${g.name}: az analóg méréshez állítsd ADC módba (most: ${GPIO_MODES.find(x=>x[0]===m)[1]})`,at);}}}
  return iss;
}
function freeHoleNear(r,c,pinHole){const s=secStart(r);for(let i=s;i<s+D.board.sec;i++){if(i===r||!inb(i,c))continue;const k=i+':'+c;if(!pinHole.has(k)&&!D.wires.some(w=>(w.a[0]===i&&w.a[1]===c)||(w.b[0]===i&&w.b[1]===c)))return k;}return null;}

/* ---------- Rajzolás ---------- */
const cv=$('#cv'),ctx=cv.getContext('2d');
let P=14,M=32,dpr=1;
const VR=()=>(D&&D.settings.vrot)|0,VA=()=>VR()*Math.PI/2;
const bw=()=>2*M+D.board.cols*P,bh=()=>2*M+D.board.rows*P;
function toScreen(x,y){const W=bw(),H=bh();switch(VR()){case 1:return[H-y,x];case 2:return[W-x,H-y];case 3:return[y,W-x];default:return[x,y];}}
function fromScreen(x,y){const W=bw(),H=bh();switch(VR()){case 1:return[y,H-x];case 2:return[W-x,H-y];case 3:return[W-y,x];default:return[x,y];}}
function applyView(){const W=bw(),H=bh();switch(VR()){case 1:ctx.translate(H,0);ctx.rotate(Math.PI/2);break;case 2:ctx.translate(W,H);ctx.rotate(Math.PI);break;case 3:ctx.translate(0,W);ctx.rotate(-Math.PI/2);break;}}
function vlabel(x,y,str,col){ctx.save();ctx.translate(x,y);ctx.rotate(-VA());ctx.fillStyle=col;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(str,0,0);ctx.restore();}const MONO='"IBM Plex Mono",ui-monospace,monospace';
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const cu=()=>ui.view==='cu';
const hx=c=>M+(cu()?D.board.cols-1-c:c)*P+P/2;
const hy=r=>M+r*P+P/2;
function L(p,lr,lc){const[r,c]=xf(p,lr,lc);return[hx(c),hy(r)];}
function poly(p,r0,r1,c0,c1){const pts=[L(p,r0,c0),L(p,r0,c1),L(p,r1,c1),L(p,r1,c0)];ctx.beginPath();ctx.moveTo(...pts[0]);for(let i=1;i<4;i++)ctx.lineTo(...pts[i]);ctx.closePath();}
function vdir(p,dr,dc){const[r,c]=xv(p,dr,dc);return[cu()?-c:c,r];}
function resize(){
  P=Math.round(14*ui.zoom);M=32+EXT*P;dpr=window.devicePixelRatio||1;
  let W=bw(),H=bh();if(VR()&1){const t=W;W=H;H=t;}
  cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';
  $('#zLbl').textContent=Math.round(ui.zoom*100)+'%';draw();
}
function netTint(root,A){
  const qs=A.netPins.get(root)||[];
  if(ui.sim&&SIM){if(!qs.length&&(A.netSecs.get(root)||0)<2)return null;
    if(!qs.length)return null;
    if(SIM.floating.has(root))return'hsla(210,8%,62%,A)';
    const v=SIM.netV.get(root)||0;const h=v<=3.3?215-190*Math.max(0,v)/3.3:Math.max(0,25-25*(v-3.3)/1.7);return`hsla(${h},78%,50%,A)`;}
  if(!qs.length&&(A.netSecs.get(root)||0)<2)return null;
  const pq=qs.filter(q=>q.part.type==='pico');
  if(pq.some(q=>q.role==='gnd'))return'hsla(210,10%,20%,A)';
  if(pq.some(q=>q.role==='p33'))return'hsla(0,75%,52%,A)';
  if(pq.some(q=>q.role==='pwr'))return'hsla(290,60%,55%,A)';
  const g=pq.find(q=>q.role==='gpio');if(g)return`hsla(${(g.num*67)%360},65%,48%,A)`;
  return`hsla(${(root*137.5)%360},55%,50%,A)`;
}
function draw(){
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
  for(let c=0;c<B.cols;c++)for(let s=0;s<B.rows;s+=B.sec){
    const x=hx(c)-P*0.44,y=hy(s)-P*0.45,w=P*0.88,h=(Math.min(B.sec,B.rows-s)-1)*P+P*0.9;
    const root=A.find(A.sid(s,c));
    if(!tints.has(root))tints.set(root,netTint(root,A));
    const t=tints.get(root);
    if(C){ctx.fillStyle='#c4844f';rr(x,y,w,h,P*0.12);ctx.fill();if(t){ctx.fillStyle=t.replace('A',ui.sim?'.55':'.38');ctx.fill();}}
    else{if(t){ctx.fillStyle=t.replace('A',ui.sim?'.42':'.24');rr(x,y,w,h,P*0.12);ctx.fill();}
      ctx.strokeStyle='rgba(120,88,40,.22)';ctx.lineWidth=1;rr(x,y,w,h,P*0.12);ctx.stroke();}
    if(root===hoverNet){ctx.strokeStyle=css('--accent');ctx.lineWidth=2;rr(x-1,y-1,w+2,h+2,P*0.14);ctx.stroke();}
  }
  // lyukak
  ctx.fillStyle=C?'#3a2414':'#4a3c24';
  for(let r=0;r<B.rows;r++)for(let c=0;c<B.cols;c++){ctx.beginPath();ctx.arc(hx(c),hy(r),P*0.16,0,7);ctx.fill();}
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
  if(C)drawWires(0.28);
  // alkatrészek
  for(const p of D.parts)drawPart(p,C?0.32:1,isSelPart(p));
  if(!C)drawWires(1);
  // szellem
  if(ui.placing&&hv){const g=ghostPart(hv);drawPart(g,0.6,false,!partFits(g));}
  if(ui.tool==='wire'&&ui.wireStart&&hv){ctx.setLineDash([5,4]);ctx.strokeStyle=ui.wireColor;ctx.lineWidth=P*0.18;line(hx(ui.wireStart[1]),hy(ui.wireStart[0]),hx(hv.c),hy(hv.r));ctx.setLineDash([]);}
  if(ui.tool==='wire'&&ui.wireStart){ring(ui.wireStart[0],ui.wireStart[1],css('--accent'));}
  drawRats(A);
  drawLinkSel();
  if(ui.linkStart){const q=findPin(ui.linkStart);if(q){ring(q.r,q.c,css('--accent'),P*0.55,3);if(hv){ctx.setLineDash([4,4]);ctx.strokeStyle=css('--accent');ctx.lineWidth=2;line(hx(q.c),hy(q.r),hx(hv.c),hy(hv.r));ctx.setLineDash([]);}}}
  if(hv&&inb(hv.r,hv.c)&&!ui.placing&&ui.tool!=='pan'){ctx.strokeStyle=css('--accent');ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(hx(hv.c),hy(hv.r),P*0.42,0,7);ctx.stroke();}
  if(ui.flash&&performance.now()<ui.flash.until){for(const [r,c] of ui.flash.holes)ring(r,c,'#e03131',P*0.62,3);}
  if(ui.drag&&ui.drag.kind==='box'){const a=ui.drag.h0,b2=ui.drag.h1;const x1=hx(Math.min(a.cf,b2.cf)),x2=hx(Math.max(a.cf,b2.cf)),y1=hy(Math.min(a.rf,b2.rf)),y2=hy(Math.max(a.rf,b2.rf));ctx.save();ctx.setLineDash([6,4]);ctx.strokeStyle=css('--accent');ctx.lineWidth=1.5;ctx.fillStyle='rgba(168,87,31,.08)';ctx.beginPath();ctx.rect(Math.min(x1,x2),y1,Math.abs(x2-x1),y2-y1);ctx.fill();ctx.stroke();ctx.restore();}
  ctx.restore();
}
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):ctx.rect(x,y,w,h);}
function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function ring(r,c,col,rad,w){ctx.strokeStyle=col;ctx.lineWidth=w||2.5;ctx.beginPath();ctx.arc(hx(c),hy(r),rad||P*0.48,0,7);ctx.stroke();}
function drawWires(alpha){
  ctx.save();ctx.globalAlpha=alpha;ctx.lineCap='round';
  for(const w of D.auto.wires){if(autoHidden(w.links))continue;const x1=hx(w.a[1]),y1=hy(w.a[0]),x2=hx(w.b[1]),y2=hy(w.b[0]);
    ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=P*0.26;line(x1,y1,x2,y2);ctx.setLineDash([P*0.4,P*0.2]);ctx.strokeStyle=w.color;ctx.lineWidth=P*0.17;line(x1,y1,x2,y2);ctx.setLineDash([]);
    for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.fillStyle=w.color;ctx.beginPath();ctx.arc(x,y,P*0.2,0,7);ctx.fill();}}
  D.wires.forEach((w,i)=>{const x1=hx(w.a[1]),y1=hy(w.a[0]),x2=hx(w.b[1]),y2=hy(w.b[0]);const sel=ui.sel&&((ui.sel.kind==='wire'&&ui.sel.i===i)||(isGroup()&&ui.sel.wires.has(i)));
    if(sel){ctx.strokeStyle=css('--accent');ctx.lineWidth=P*0.42;line(x1,y1,x2,y2);}
    ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=P*0.26;line(x1,y1,x2,y2);
    ctx.strokeStyle=w.color||'#1c7ed6';ctx.lineWidth=P*0.17;line(x1,y1,x2,y2);
    for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.fillStyle='rgba(0,0,0,.5)';ctx.beginPath();ctx.arc(x,y,P*0.24,0,7);ctx.fill();ctx.fillStyle=w.color||'#1c7ed6';ctx.beginPath();ctx.arc(x,y,P*0.17,0,7);ctx.fill();}
  });ctx.restore();
}
function text(p,lr,lc,str,size,color,dir,halo){ // dir: lokális irány, amerre a szöveg fut
  const[x,y]=L(p,lr,lc);ctx.save();ctx.translate(x,y);ctx.rotate(-VA());
  if(dir){let[dx0,dy0]=vdir(p,dir[0],dir[1]);const ca=Math.cos(VA()),sa=Math.sin(VA());let dx=dx0*ca-dy0*sa,dy=dx0*sa+dy0*ca;let a=Math.atan2(dy,dx),al='left';if(Math.abs(a)>Math.PI/2+0.01){a+=Math.PI;al='right';}ctx.rotate(a);ctx.textAlign=al;}else ctx.textAlign='center';
  ctx.textBaseline='middle';ctx.font=`600 ${size}px ${MONO}`;if(halo){ctx.lineWidth=3;ctx.lineJoin='round';ctx.strokeStyle=halo;ctx.strokeText(str,0,0);}ctx.fillStyle=color;ctx.fillText(str,0,0);ctx.restore();
}
function stext(x,y,str,size,color,halo){ctx.save();ctx.translate(x,y);ctx.rotate(-VA());ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${size}px ${MONO}`;if(halo){ctx.lineWidth=3;ctx.lineJoin='round';ctx.strokeStyle=halo;ctx.strokeText(str,0,0);}ctx.fillStyle=color;ctx.fillText(str,0,0);ctx.restore();}
function drawPart(p,alpha,selected,bad){
  const CD=DEFS[p.type],def=CD.def,b=CD.bounds(p),C=cu()&&!bad&&alpha<1,XR=!C&&(ui.xray||!!p.xray);
  const o={mode:C?'cu':XR?'xr':'solid',env:penv(p),pressed:!!(ui.sim&&ui.pressed[p.id]),lit:!!(ui.sim&&SIM&&SIM.leds.some(l=>l.p===p&&l.light&&l.I>2e-4)),halo:XR?'rgba(255,252,240,.92)':null,alpha,pinAt:{}};
  for(const q of CD.pins(p))o.pinAt[q.id]=q;
  ctx.save();ctx.globalAlpha=alpha;
  for(const g of def.graphics||[])drawPrim(p,g,o);
  const S=SIM&&ui.sim,PL=def.pinLabels;
  const gp=gpins(p),mid=gp.reduce((t,q)=>t+q.lr,0)/(gp.length||1);
  for(const q of gp){const x=hx(q.c),y=hy(q.r);
    ctx.fillStyle=ROLEC[q.role]||'#888';ctx.beginPath();ctx.arc(x,y,P*0.28,0,7);ctx.fill();
    ctx.fillStyle=p.type==='pico'?'#d4b25c':'#e9ecef';ctx.beginPath();ctx.arc(x,y,P*0.12,0,7);ctx.fill();
    if(!PL||C||P<(PL.minP||12))continue;
    if(PL.mode==='role')text(p,q.lr+(q.lr?PL.off:-PL.off),q.lc,q.role,Math.max(7,P*0.45),(PL.colors||{})[q.role]||'#333',null,o.halo);
    else if(PL.mode==='sign'){const plus=(PL.plus||[]).includes(q.role);text(p,q.lr+PL.off,q.lc,plus?(PL.plusText||'+'):(PL.minusText||'−'),Math.max(8,P*0.6),plus?'#c92a2a':'#1f2328',null,o.halo);}
    else if(PL.mode==='name'&&PL.inward){const inward=q.lr<=mid?1:-1;
      let col=XR||!PL.onBody?(q.role==='gpio'?'#1c4fd1':q.role==='gnd'?'#212529':q.role==='p33'?'#c92a2a':q.role==='pwr'?'#9c36b5':'#5c666e')
                :(q.role==='gpio'?'#bfe0ff':q.role==='gnd'?'#9fb3a8':q.role==='p33'?'#ffb3b3':q.role==='pwr'?'#f3c4ff':'#c8d1cc');
      if(S&&q.role==='gpio'){const g=SIM.gpios.find(x=>x.q.part===p&&x.q.id===q.id);if(g){const l=logic(g);col=XR?(l==='1'?'#d9480f':l==='0'?'#1864ab':'#5c666e'):(l==='1'?'#ffb27a':l==='0'?'#8fc2ff':'#c8d1cc');}}
      text(p,q.lr+inward*0.5,q.lc,(PL.rename||{})[q.name]||q.name,Math.max(6,P*0.4),col,[inward,0],o.halo);}
    else if(PL.mode==='name')text(p,q.lr+PL.off,q.lc,q.name,Math.max(7,P*0.42),XR?(ROLEC[q.role]||'#333'):(PL.colors||{})[q.role]||'#333',null,o.halo);
  }
  if(selected||bad){poly(p,b.r0-0.2,b.r1+0.2,b.c0-0.2,b.c1+0.2);ctx.setLineDash([5,4]);ctx.strokeStyle=bad?'#e03131':css('--accent');ctx.lineWidth=2;ctx.globalAlpha=1;ctx.stroke();ctx.setLineDash([]);}
  ctx.restore();
}
function drawPrim(p,g,o){
  const LY=g.layer||'body',m=o.mode;
  if(LY==='xray'&&m!=='xr')return;
  if((LY==='detail'||LY==='label'||LY==='xray')&&m==='cu')return;
  if(LY==='detail'&&m==='xr'&&!g.xray)return;
  let st={...g};
  if(m==='xr'&&g.xray){st={...st,...g.xray};if(o.pressed&&g.xray.pressed)st={...st,...g.xray.pressed};}
  else if(o.pressed&&g.pressed)st={...st,...g.pressed};
  if(o.lit&&g.lit&&m==='solid')st={...st,...g.lit};
  const E=o.env,N=x=>num(x,E),col=c=>c==null?null:c==='accent'?css('--accent'):String(c).includes('{')?tpl(c,E):c;
  const pt=v=>Array.isArray(v)?[N(v[0]),N(v[1])]:(o.pinAt[v]?[o.pinAt[v].lr,o.pinAt[v].lc]:[0,0]);
  const paint=()=>{
    if(LY==='body'){
      if(m==='solid'){if(st.fill){ctx.fillStyle=col(st.fill);ctx.fill();}if(st.stroke){ctx.strokeStyle=col(st.stroke);ctx.lineWidth=st.width||1.2;ctx.stroke();}}
      else if(m==='xr'){ctx.fillStyle='rgba(60,60,60,.06)';ctx.fill();ctx.setLineDash([P*0.32,P*0.2]);ctx.strokeStyle=col(st.stroke||'#333');ctx.lineWidth=1.6;ctx.stroke();ctx.setLineDash([]);}
      else{ctx.strokeStyle=col(st.stroke||'#333');ctx.lineWidth=2;ctx.stroke();}}
    else{if(st.fill){ctx.fillStyle=col(st.fill);ctx.fill();}if(st.stroke){if(st.dash)ctx.setLineDash([3,3]);ctx.strokeStyle=col(st.stroke);ctx.lineWidth=st.width||1.2;ctx.stroke();ctx.setLineDash([]);}}};
  const ends=()=>{const a=pt(st.from),b=pt(st.to),[x1,y1]=L(p,a[0],a[1]),[x2,y2]=L(p,b[0],b[1]);const len=Math.hypot(x2-x1,y2-y1)||1;return{x1,y1,x2,y2,len,ux:(x2-x1)/len,uy:(y2-y1)/len,mx:(x1+x2)/2,my:(y1+y2)/2,ang:Math.atan2(y2-y1,x2-x1)};};
  switch(st.shape){
    case 'rect':poly(p,N(st.r[0]),N(st.r[1]),N(st.c[0]),N(st.c[1]));paint();break;
    case 'circle':{const[r,c]=pt(st.at),[x,y]=L(p,r,c);ctx.beginPath();ctx.arc(x,y,N(st.rad)*P,0,7);paint();break;}
    case 'poly':{const ps=st.pts.map(pt).map(([r,c])=>L(p,r,c));ctx.beginPath();ctx.moveTo(ps[0][0],ps[0][1]);for(const q of ps.slice(1))ctx.lineTo(q[0],q[1]);ctx.closePath();paint();break;}
    case 'line':{const e=ends();ctx.strokeStyle=col(st.stroke||'#8d959c');ctx.lineWidth=N(st.width||0.12)*P;ctx.lineCap='round';line(e.x1,e.y1,e.x2,e.y2);break;}
    case 'link':{const e=ends();ctx.lineCap='round';ctx.strokeStyle=col(st.edge||'#5f676e');ctx.lineWidth=N(st.width||0.22)*P+2;line(e.x1,e.y1,e.x2,e.y2);ctx.strokeStyle=col(st.stroke||'#b8bec4');ctx.lineWidth=N(st.width||0.22)*P;line(e.x1,e.y1,e.x2,e.y2);break;}
    case 'text':{const str=tpl(st.text,E),sz=Math.max(st.min||7,P*N(st.size||0.42)),c=col(st.color||'#3a2c14');
      if(st.between){const[a,b]=st.between.map(pt).map(([r,cc])=>L(p,r,cc));const len=Math.hypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/len,ny=(b[0]-a[0])/len,k=P*N(st.perp||0);stext((a[0]+b[0])/2+nx*k,(a[1]+b[1])/2+ny*k,str,sz,c,o.halo);}
      else{const[r,cc]=pt(st.at);text(p,r,cc,str,sz,c,null,o.halo);}break;}
    case 'axial':{const e=ends();ctx.strokeStyle='#8d959c';ctx.lineWidth=P*0.12;line(e.x1,e.y1,e.x2,e.y2);const BLw=N(st.len||2.3);
      if(e.len>=(BLw+0.3)*P){ctx.save();ctx.translate(e.mx,e.my);ctx.rotate(e.ang);const BL=Math.min(BLw*P,e.len-0.9*P),BH=N(st.w||0.76)*P;
        ctx.beginPath();ctx.rect(-BL/2,-BH/2,BL,BH);paint();
        if(m==='solid'&&st.bands)resBands(N(st.bands)).forEach((c,i)=>{ctx.fillStyle=c;ctx.fillRect(-BL/2+0.4*P+i*0.42*P,-BH/2,0.2*P,BH);});
        if(st.stripe){const sx=BL*(st.stripe.at-0.5);if(m==='solid'){ctx.fillStyle=st.stripe.color;ctx.fillRect(sx-0.1*P,-BH/2,0.2*P,BH);}else{ctx.strokeStyle='rgba(0,0,0,.65)';ctx.lineWidth=2;line(sx,-BH/2,sx,BH/2);}}
        ctx.restore();}
      else{ctx.beginPath();ctx.arc(e.x1,e.y1,P*0.5,0,7);paint();}
      break;}
    case 'radial':{const e=ends(),nx=-e.uy,ny=e.ux,fc=col(st.fill)||'#e03131',R=P*N(st.rad||0.62);
      if(e.len>1.3*P){ctx.strokeStyle='#8d959c';ctx.lineWidth=P*0.1;line(e.x1,e.y1,e.x2,e.y2);}
      if(st.glow&&SIM&&ui.sim){const l=SIM.leds.find(x=>x.p===p);if(l&&l.I>2e-4){const k=Math.min(1,l.I/0.004);const gr=ctx.createRadialGradient(e.mx,e.my,0,e.mx,e.my,P*2.6);gr.addColorStop(0,'rgba(255,255,255,.95)');gr.addColorStop(0.18,rgba(fc,.95));gr.addColorStop(0.5,rgba(fc,.45));gr.addColorStop(1,rgba(fc,0));ctx.save();ctx.globalAlpha=o.alpha*(0.6+0.4*k);ctx.fillStyle=gr;ctx.beginPath();ctx.arc(e.mx,e.my,P*2.6,0,7);ctx.fill();ctx.restore();}}
      ctx.beginPath();ctx.arc(e.mx,e.my,R,0,7);
      if(m==='solid'){ctx.fillStyle=fc;ctx.globalAlpha=o.alpha*0.85;ctx.fill();ctx.globalAlpha=o.alpha;ctx.strokeStyle='rgba(0,0,0,.55)';ctx.lineWidth=1.5;ctx.stroke();}
      else if(m==='xr'){ctx.fillStyle=fc;ctx.globalAlpha=o.alpha*0.2;ctx.fill();ctx.globalAlpha=o.alpha;ctx.setLineDash([3,3]);ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=1.4;ctx.stroke();ctx.setLineDash([]);}
      else{ctx.strokeStyle='rgba(0,0,0,.55)';ctx.lineWidth=1.5;ctx.stroke();}
      const fx=e.mx+e.ux*R*0.65,fy=e.my+e.uy*R*0.65;ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=2;line(fx+nx*R*0.9,fy+ny*R*0.9,fx-nx*R*0.9,fy-ny*R*0.9);
      break;}
  }
}
const BANDC=['#000','#7b3f00','#e03131','#f76707','#fab005','#2f9e44','#1c7ed6','#7048e8','#868e96','#fff'];
function resBands(o){let e=0,v=o;while(v>=100){v/=10;e++;}while(v<10&&e>-2){v*=10;e--;}v=Math.round(v);if(v>=100){v=10;e++;}return[BANDC[Math.floor(v/10)],BANDC[v%10],e>=0?BANDC[e]:'#d4af37'];}
function fmtOhm(o){return o>=1e6?(+(o/1e6).toFixed(2))+'M':o>=1000?(+(o/1000).toFixed(2))+'k':o+'Ω';}

/* ---------- Interakció ---------- */
function toHole(ev){const rc=cv.getBoundingClientRect();const[x,y]=fromScreen(ev.clientX-rc.left,ev.clientY-rc.top);let cf=(x-M)/P-0.5,rf=(y-M)/P-0.5;if(cu())cf=D.board.cols-1-cf;return{rf,cf,r:Math.round(rf),c:Math.round(cf)};}
function ghostPart(h){return{id:'ghost',type:ui.placing,label:DEFS[ui.placing].prefix,r:h.r,c:h.c,rot:ui.ghost.rot,mir:ui.ghost.mir,xray:!!ui.ghost.xray,props:{...DEFS[ui.placing].props,...(ui.ghost.props||{})}};}
function duplicate(p){if(!p||ui.sim)return;ui.placing=p.type;ui.ghost={rot:p.rot,mir:p.mir,props:JSON.parse(JSON.stringify(p.props)),xray:!!p.xray,from:p.label};ui.sel=null;ui.wireStart=null;ui.linkStart=null;renderLeft();draw();}
function hitPart(rf,cf){for(let i=D.parts.length-1;i>=0;i--){const p=D.parts[i],b=DEFS[p.type].bounds(p),[lr,lc]=ixf(p,rf,cf);if(lr>=b.r0&&lr<=b.r1&&lc>=b.c0&&lc<=b.c1)return p;}return null;}
function segDist(pr,pc,r1,c1,r2,c2){const dr=r2-r1,dc=c2-c1,l=dr*dr+dc*dc;let t=l?((pr-r1)*dr+(pc-c1)*dc)/l:0;t=Math.max(0,Math.min(1,t));return Math.hypot(pr-(r1+t*dr),pc-(c1+t*dc));}
function hitWire(rf,cf){let best=-1,bd=0.32;D.wires.forEach((w,i)=>{const d=segDist(rf,cf,w.a[0],w.a[1],w.b[0],w.b[1]);if(d<bd){bd=d;best=i;}});return best;}
function hitBridge(rf,cf){let best=-1,bd=0.3;D.bridges.forEach((b,i)=>{const d=segDist(rf,cf,b[0],b[1],b[2],b[3]);if(d<bd){bd=d;best=i;}});return best;}
function pushUndo(){ui.undo.push(JSON.stringify(D));if(ui.undo.length>150)ui.undo.shift();ui.redo=[];}
function commit(noRoute){syncDefs(D.customParts);const bk=JSON.stringify(D.board);if(!noRoute&&D.settings.autoRoute&&D.links.length)route({moved:ui.moved});ui.moved=null;save();if(bk!==ui.lastBoard){ui.lastBoard=bk;resize();boardUI();}recompute();renderLeft();}
function save(){try{localStorage.setItem(STORE_KEY,JSON.stringify(D));}catch(e){}}
function sameSec(r1,c1,r2,c2){return c1===c2&&secStart(r1)===secStart(r2);}
function addBridge(r1,c1,r2,c2){if(!inb(r1,c1)||!inb(r2,c2))return false;if(Math.abs(r1-r2)+Math.abs(c1-c2)!==1)return false;if(sameSec(r1,c1,r2,c2))return false;
  if(D.bridges.some(b=>(b[0]===r1&&b[1]===c1&&b[2]===r2&&b[3]===c2)||(b[0]===r2&&b[1]===c2&&b[2]===r1&&b[3]===c1)))return false;D.bridges.push([r1,c1,r2,c2]);return true;}

cv.addEventListener('pointerdown',ev=>{
  const h=toHole(ev);ui.hover=h;
  if(ui.tool==='pan'){ui.drag={kind:'pan',x:ev.clientX,y:ev.clientY};cv.setPointerCapture(ev.pointerId);return;}
  if(ui.sim){const p=hitPart(h.rf,h.cf);if(p&&hasPress(p)){if(D.settings.btnMode==='toggle')ui.pressed[p.id]=!ui.pressed[p.id];else{ui.pressed[p.id]=true;ui.holdPtr.set(ev.pointerId,p.id);cv.setPointerCapture(ev.pointerId);}recompute();}return;}
  if(ui.placing){const g=ghostPart(h);if(!partFits(g))return;pushUndo();const p={...g,id:'p'+(D.seq++),label:nextLabel(ui.placing)};if(!p.xray)delete p.xray;D.parts.push(p);
    if(ev.shiftKey){commit();return;} // Shift: további példányok
    ui.sel=grp([p.id]);ui.placing=null;setTool('select');commit();return;}
  if(ui.tool==='select'){
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
  if(ui.tool==='wire'){if(!inb(h.r,h.c))return;
    if(!ui.wireStart){ui.wireStart=[h.r,h.c];draw();return;}
    if(ui.wireStart[0]===h.r&&ui.wireStart[1]===h.c){ui.wireStart=null;draw();return;}
    pushUndo();D.wires.push({a:ui.wireStart,b:[h.r,h.c],color:ui.wireColor});ui.wireStart=null;commit();return;}
  if(ui.tool==='link'){const q=hitPin(h.rf,h.cf);if(!q){ui.linkStart=null;renderLeft();draw();return;}const ref=q.part.id+'.'+q.id;
    if(!ui.linkStart||ui.linkStart===ref){ui.linkStart=ui.linkStart===ref?null:ref;renderLeft();draw();return;}
    addLink(ui.linkStart,ref);ui.linkStart=null;return;}
  if(ui.tool==='erase'){pushUndo();ui.drag={kind:'erase',any:false};cv.setPointerCapture(ev.pointerId);eraseAt(h,true);return;}
});
function eraseAt(h,click){
  const order=cu()?['bridge','wire','part']:['wire','part','bridge'];
  for(const k of order){
    if(k==='wire'){const i=hitWire(h.rf,h.cf);if(i>=0){D.wires.splice(i,1);ui.drag.any=true;ui.sel=null;commit();return;}}
    if(k==='bridge'){const i=hitBridge(h.rf,h.cf);if(i>=0){D.bridges.splice(i,1);ui.drag.any=true;ui.sel=null;commit();return;}}
    if(k==='part'&&click){const p=hitPart(h.rf,h.cf);if(p){D.parts=D.parts.filter(x=>x!==p);dropLinks(p.id);ui.drag.any=true;ui.sel=null;commit();return;}}
  }
}
cv.addEventListener('pointermove',ev=>{
  const h=toHole(ev);const prev=ui.hover;ui.hover=h;const d=ui.drag;
  if(d&&d.kind==='pan'){const sc=$('#scroll');sc.scrollLeft-=ev.clientX-d.x;sc.scrollTop-=ev.clientY-d.y;d.x=ev.clientX;d.y=ev.clientY;return;}
  if(d&&d.kind==='box'){d.h1=h;draw();return;}
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
  if(!prev||prev.r!==h.r||prev.c!==h.c||ui.placing||ui.wireStart){status();draw();}
});
function endDrag(ev){
  const pid=ui.holdPtr.get(ev.pointerId);if(pid){ui.pressed[pid]=false;ui.holdPtr.delete(ev.pointerId);recompute();}
  const d=ui.drag;ui.drag=null;if(!d)return;
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
  if(d.kind==='bridge'){if(d.n)commit();else ui.undo.pop();}
  if(d.kind==='erase'&&!d.any)ui.undo.pop();
}
cv.addEventListener('pointerup',endDrag);cv.addEventListener('pointercancel',endDrag);
cv.addEventListener('pointerleave',()=>{if(!ui.drag){ui.hover=null;status();draw();}});
$('#scroll').addEventListener('wheel',ev=>{if(ev.ctrlKey||ev.metaKey){ev.preventDefault();zoom(ev.deltaY<0?0.2:-0.2);}},{passive:false});

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
function delSel(){if(!ui.sel)return;pushUndo();if(ui.sel.kind==='group'){const g=ui.sel;D.parts=D.parts.filter(p=>!g.parts.has(p.id));g.parts.forEach(dropLinks);D.bridges=D.bridges.filter((b,i)=>!g.bridges.has(i));D.wires=D.wires.filter((w,i)=>!g.wires.has(i));}else if(ui.sel.kind==='wire')D.wires.splice(ui.sel.i,1);else if(ui.sel.kind==='bridge')D.bridges.splice(ui.sel.i,1);ui.sel=null;commit();}
function undo(){if(!ui.undo.length)return;ui.redo.push(JSON.stringify(D));D=JSON.parse(ui.undo.pop());ui.sel=null;commit();}
function redo(){if(!ui.redo.length)return;ui.undo.push(JSON.stringify(D));D=JSON.parse(ui.redo.pop());ui.sel=null;commit();}
function setTool(t){ui.tool=t;ui.wireStart=null;ui.linkStart=null;if(t!=='place')ui.placing=null;renderLeft();draw();}
function setView(v){ui.view=v;$('#vComp').classList.toggle('on',v==='comp');$('#vCu').classList.toggle('on',v==='cu');draw();}
function zoom(dz){ui.zoom=Math.max(0.6,Math.min(2.6,+(ui.zoom+dz).toFixed(2)));resize();}
function setSim(on){ui.sim=on;if(!on){ui.pressed={};ui.holdPtr.clear();}ui.wireStart=null;ui.placing=null;const b=$('#bSim');b.classList.toggle('on',on);b.textContent=on?'■ Szimuláció leállítása':'▶ Szimuláció';recompute();renderLeft();}
let msgTimer;function flashMsg(m){const s=$('#status');s.textContent=m;s.style.color='var(--err)';clearTimeout(msgTimer);msgTimer=setTimeout(()=>{s.style.color='';status();},1800);}

document.addEventListener('keydown',ev=>{
  const t=ev.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))return;
  const k=ev.key.toLowerCase();
  if((ev.ctrlKey||ev.metaKey)&&k==='z'){ev.preventDefault();ev.shiftKey?redo():undo();return;}
  if((ev.ctrlKey||ev.metaKey)&&k==='y'){ev.preventDefault();redo();return;}
  if((ev.ctrlKey||ev.metaKey)&&k==='a'&&!ui.sim){ev.preventDefault();ui.sel=grp(D.parts.map(p=>p.id),D.bridges.map((b,i)=>i),D.wires.map((w,i)=>i));setTool('select');return;}
  if(ev.ctrlKey||ev.metaKey||ev.altKey)return;
  if(k==='escape'){ui.placing=null;ui.wireStart=null;ui.sel=null;if(ui.selLink){ui.selLink=null;renderLinks();}renderLeft();draw();status();return;}
  if(k==='s'){setSim(!ui.sim);return;}
  if(k==='f'){setView(cu()?'comp':'cu');return;}
  if(k==='n'){toggleRats();return;}
  if(k==='t'){rotView();return;}
  if(ui.sim)return;
  const tool=TOOLS.find(x=>x[2].toLowerCase()===k);if(tool){setTool(tool[0]);return;}
  if(k==='r')rotate();else if(k==='m')mirror();else if(k==='delete'||k==='backspace')delSel();else if(k==='d'){const p=selPart();if(p)duplicate(p);}else if(k==='x'){toggleXray();}
});

/* ---------- Panelek ---------- */
let kbdEdit=0;
document.addEventListener('keydown',e=>{const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='SELECT'))kbdEdit=Date.now();},true);
document.addEventListener('pointerdown',e=>{const t=e.target;if(t&&t.tagName==='INPUT'&&t.type==='number')kbdEdit=Date.now();},true);
function focusKey(){const a=document.activeElement;if(!a||a===document.body||Date.now()-kbdEdit>800)return null;if(a.id)return{id:a.id,v:a.type==='text'?a.selectionStart:null};if(a.dataset&&a.dataset.gpio)return{gpio:a.dataset.gpio};return null;}
function restoreFocus(k){if(!k)return;const el=k.id?document.getElementById(k.id):document.querySelector(`[data-gpio="${k.gpio}"]`);if(!el||el===document.activeElement)return;el.focus({preventScroll:true});try{if(k.v!=null)el.setSelectionRange(k.v,k.v);}catch(e){}}
function renderLeft(){const fk=focusKey();renderLeft0();restoreFocus(fk);}
function paramUI(p){const def=DEFS[p.type].def,E=penv(p);let h='';
  for(const pr of def.params||[]){const k=pr.key,id='pp_'+k;
    if(pr.type==='span')h+=`<div class="row"><label>${esc(pr.label)}</label><input type="number" id="pp_dr" data-pk="dr" min="-12" max="12" value="${E.dr}" style="width:58px" aria-label="sor eltolás"><span class="muted small">sor</span><input type="number" id="pp_dc" data-pk="dc" min="-12" max="12" value="${E.dc}" style="width:58px" aria-label="oszlop eltolás"><span class="muted small">oszlop</span></div>`;
    else if(pr.type==='select')h+=`<div class="row"><label for="${id}">${esc(pr.label)}</label><select id="${id}" data-pk="${k}" style="flex:1;min-width:0">${pr.options.map(o=>`<option value="${esc(o.v)}" ${String(o.v)===String(E[k])?'selected':''}>${esc(o.label)}</option>`).join('')}</select></div>`;
    else if(pr.type==='color')h+=`<div class="row"><label>${esc(pr.label)}</label><div class="swatches" role="group" aria-label="${esc(pr.label)}">${pr.options.map(o=>`<button class="sw ${String(o.v)===String(E[k])?'on':''}" data-pk="${k}" data-pv="${esc(o.v)}" title="${esc(o.label)}" aria-label="${esc(o.label)}" style="background:${o.hex}"></button>`).join('')}</div></div>`;
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
function renderLeft0(){
  $('#tools').innerHTML=TOOLS.map(([id,l,k])=>`<button class="btn ${ui.tool===id&&!ui.placing?'on':''}" data-tool="${id}" ${ui.sim?'disabled':''}>${l}<kbd>${k}</kbd></button>`).join('');
  const cats=[...new Set(Object.values(DEFS).map(d=>d.cat))];
  const libBtn=(id,d)=>`<button class="btn ${ui.placing===id?'on':''}" data-lib="${id}" ${ui.sim?'disabled':''}>${esc(d.name)}<span>${esc(d.fp)}</span></button>`;
  $('#lib').innerHTML=cats.map(c=>`<div class="libcat">${esc(c)}</div>`+Object.entries(DEFS).filter(([,d])=>d.cat===c).map(([id,d])=>id in PARTS?libBtn(id,d):`<div class="libitem">${libBtn(id,d)}<button class="btn" data-edit="${id}" title="Szerkesztés" aria-label="${esc(d.name)} szerkesztése" ${ui.sim?'disabled':''}>✎</button></div>`).join('')).join('');
  $('#swatches').innerHTML=WCOL.map(([c,l])=>`<button class="sw ${ui.wireColor===c?'on':''}" data-col="${c}" title="${l}" aria-label="${l}" style="background:${c}"></button>`).join('');
  const pr=$('#props');const p=selPart();
  if(p){const d=DEFS[p.type];const extra=paramUI(p);
    pr.innerHTML=`<div class="row"><label for="pLabel">Név</label><input type="text" id="pLabel" value="${esc(p.label)}"></div>
      <div class="small muted">${d.name} · origó <span class="mono">${p.r}:${p.c}</span> · ${p.rot*90}°${p.mir?' · tükrözve':''}</div>${extra}
      <div class="row"><button class="btn" id="pRot">↻ Forgatás <kbd>R</kbd></button><button class="btn" id="pMir">⇋ Tükrözés <kbd>M</kbd></button><button class="btn danger" id="pDel">Törlés</button></div>`;
    const ch=(id,fn)=>{const e=$(id);if(e)e.addEventListener('change',()=>{pushUndo();fn(e.value);commit();});};
    ch('#pLabel',v=>p.label=v.trim()||p.label);
    bindParams(pr,p);
    $('#pRot').onclick=rotate;$('#pMir').onclick=mirror;$('#pDel').onclick=delSel;
    {const row=document.createElement('div');row.className='row';row.innerHTML=`<button class="btn" id="pDup" title="Új példány ugyanezekkel a beállításokkal">⧉ Duplikálás <kbd>D</kbd></button><label class="check small"><input type="checkbox" id="pXray" ${p.xray?'checked':''}> Röntgen</label>`;pr.appendChild(row);
      $('#pDup').onclick=()=>duplicate(p);$('#pXray').onchange=e=>{pushUndo();if(e.target.checked)p.xray=true;else delete p.xray;commit(true);};}
    {const row=document.createElement('div');row.className='row';const own=!(p.type in PARTS);row.innerHTML=own?'<button class="btn" id="pEditDef">✎ Alkatrész szerkesztése</button>':'<button class="btn" id="pCopyDef" title="A beépített leírásból saját, szerkeszthető alkatrész">Másolat saját alkatrészként</button>';pr.appendChild(row);
      if(own)$('#pEditDef').onclick=()=>openEditor(editorHost,{type:p.type});else $('#pCopyDef').onclick=()=>openEditor(editorHost,{from:PARTS[p.type]});}
    {const row=document.createElement('div');row.className='row';row.innerHTML='<button class="btn" id="pToAuto" title="Az alkatrész kézi bekötését kapcsolatokká alakítja, így mozgatáskor követi">Bekötés automatikusra</button>';pr.appendChild(row);
      $('#pToAuto').onclick=()=>{if(!manualToAuto(p.id))flashMsg('Ennek az alkatrésznek nincs kézi bekötése');};}
    if(p.type==='button'){const row=document.createElement('div');row.className='row';row.innerHTML='<button class="btn" id="pAuto">A → GPIO, B → GND</button>';pr.appendChild(row);
      $('#pAuto').onclick=()=>{const a=p.id+'.A1',b=p.id+'.B1';pushUndo();if(!D.links.some(l=>l.a===a))D.links.push({id:'l'+(D.seq++),a,b:'GPIO'});if(!D.links.some(l=>l.a===b))D.links.push({id:'l'+(D.seq++),a:b,b:'GND'});commit();};}
  } else if(isGroup()&&gSize(ui.sel)){const g=ui.sel;
    pr.innerHTML=`<div class="small"><b>${g.parts.size}</b> alkatrész, <b>${g.bridges.size}</b> kézi híd, <b>${g.wires.size}</b> vezeték kijelölve</div>
      <div class="small muted">Húzással együtt mozognak. Shift+kattintás: hozzáadás/elvétel.</div>
      <div class="row"><button class="btn" id="gRot">↻ Forgatás <kbd>R</kbd></button><button class="btn" id="gMir">⇋ Tükrözés <kbd>M</kbd></button><button class="btn danger" id="gDel">Törlés</button></div>
      ${g.parts.size?'<div class="row"><button class="btn" id="gAuto">Bekötés automatikusra</button><button class="btn" id="gXray">Röntgen be/ki</button></div>':''}`;
    if($('#gXray'))$('#gXray').onclick=()=>{pushUndo();const ps=D.parts.filter(p=>g.parts.has(p.id));const on=!ps.every(p=>p.xray);ps.forEach(p=>{if(on)p.xray=true;else delete p.xray;});commit(true);};
    $('#gRot').onclick=rotate;$('#gMir').onclick=mirror;$('#gDel').onclick=delSel;
    if($('#gAuto'))$('#gAuto').onclick=()=>{if(!manualToAuto(new Set(g.parts)))flashMsg('A kijelölésnek nincs kézi bekötése');};
  } else if(ui.sel&&ui.sel.kind==='wire'){const w=D.wires[ui.sel.i];
    pr.innerHTML=`<div class="small">Vezeték <span class="mono">${w.a.join(':')} → ${w.b.join(':')}</span></div><div class="swatches">${WCOL.map(([c,l])=>`<button class="sw ${w.color===c?'on':''}" data-wcol="${c}" title="${l}" aria-label="${l}" style="background:${c}"></button>`).join('')}</div><div class="row"><button class="btn danger" id="pDel">Törlés</button></div>`;
    pr.querySelectorAll('[data-wcol]').forEach(b=>b.onclick=()=>{pushUndo();w.color=b.dataset.wcol;commit();});$('#pDel').onclick=delSel;
  } else if(ui.sel&&ui.sel.kind==='bridge'){const b=D.bridges[ui.sel.i];
    pr.innerHTML=`<div class="small">Forrasztóhíd <span class="mono">${b[0]}:${b[1]} – ${b[2]}:${b[3]}</span></div><div class="row"><button class="btn danger" id="pDel">Törlés</button></div>`;$('#pDel').onclick=delSel;
  } else if(ui.linkStart){const q=findPin(ui.linkStart);
    pr.innerHTML=`<div class="small">Kapcsolat innen: <b class="mono">${q?esc(pinLabel(q)):'?'}</b></div><div class="small muted">Kattints a cél lábra, vagy válassz:</div><div class="row"><button class="btn" id="lkGnd">→ GND</button><button class="btn" id="lkGpio">→ szabad GPIO</button><button class="btn" id="lkNo">Mégse</button></div>`;
    $('#lkGnd').onclick=()=>{addLink(ui.linkStart,'GND');ui.linkStart=null;renderLeft();};$('#lkGpio').onclick=()=>{addLink(ui.linkStart,'GPIO');ui.linkStart=null;renderLeft();};$('#lkNo').onclick=()=>{ui.linkStart=null;renderLeft();draw();};
  } else pr.innerHTML=`<span class="muted small">${ui.tool==='link'&&!ui.placing?'Kattints egy lábra, majd a cél lábra (vagy GND / szabad GPIO).':''}${ui.placing?`Lerakás: <b>${DEFS[ui.placing].name}</b>${ui.ghost.from?` (${esc(ui.ghost.from)} másolata)`:''}. Kattints a panelra; Shift+kattintással több példány.`:ui.tool==='bridge'?'Húzd az egeret szomszédos lyukakon át: minden szekcióhatárnál híd keletkezik.':ui.tool==='wire'?'Kattints a kezdő, majd a cél lyukra.':ui.tool==='erase'?'Kattints vagy húzz a törlendő elemen.':'Kattints egy alkatrészre, vezetékre vagy hídra. Shift+kattintás vagy keret húzása üres helyen: több elem. Ctrl+A: minden.'}</span>`;
}
$('#tools').addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(b)setTool(b.dataset.tool);});
$('#lib').addEventListener('click',e=>{const ed=e.target.closest('[data-edit]');if(ed){openEditor(editorHost,{type:ed.dataset.edit});return;}const b=e.target.closest('[data-lib]');if(!b)return;const t=b.dataset.lib;ui.placing=ui.placing===t?null:t;ui.ghost={rot:0,mir:false};ui.sel=null;ui.wireStart=null;renderLeft();draw();});
$('#swatches').addEventListener('click',e=>{const b=e.target.closest('[data-col]');if(b){ui.wireColor=b.dataset.col;renderLeft();}});

function renderRight(){const fk=focusKey();renderRight0();restoreFocus(fk);}
function renderRight0(){
  const ne=ISSUES.filter(i=>i.sev==='err').length,nw=ISSUES.length-ne;
  $('#issueSum').innerHTML=ISSUES.length?`${ne?`<span class="chip c-err">${ne} hiba</span> `:''}${nw?`<span class="chip c-warn">${nw} figyelmeztetés</span>`:''}`:'<span class="chip c-ok">Rendben</span>';
  $('#issues').innerHTML=ISSUES.length?ISSUES.map((x,i)=>`<li data-i="${i}" class="${x.sev==='err'?'c-err':'c-warn'}"><span class="dot"></span><span style="color:var(--fg)">${esc(x.msg)}</span></li>`).join(''):'<li class="muted" style="cursor:default">Nincs zárlat vagy bekötési hiba.</li>';
  $('#usb').checked=!!D.settings.usb;
  $('#mHold').classList.toggle('on',D.settings.btnMode!=='toggle');$('#mToggle').classList.toggle('on',D.settings.btnMode==='toggle');
  let h='';
  renderSliders();
  if(!SIM){$('#simOut').innerHTML='';return;}
  const pcs=SIM.picos;
  if(pcs.length)h+=pcs.map(pc=>`<div class="small">${esc(pc.p.label)}: ${pc.powered?'<span class="c-ok">táp van</span>':'<span class="c-err">nincs táp</span>'}${pc.usb?' (USB)':''}</div>`).join('');
  else h+='<div class="small muted">Nincs Pico a panelon.</div>';
  // gombteszt
  const A=ui.sim?AS:A0;const btns=D.parts.filter(p=>hasPress(p));
  if(btns.length&&pcs.length){h+=`<table class="tbl" style="margin-top:8px"><thead><tr><th>Gomb</th><th>GPIO</th><th>Állapot</th><th>Olvas</th></tr></thead><tbody>`;
    for(const b of btns){const m=A0.byPart.get(b.id).map;let gq=null;for(const id of (DEFS[b.type].def.controls.find(c=>c.kind==='press').closes[0])){gq=(A0.netPins.get(m[id].net)||[]).find(q=>q.part.type==='pico'&&q.role==='gpio');if(gq)break;}
      const g=gq&&SIM.gpios.find(x=>x.q.part===gq.part&&x.q.id===gq.id);const l=g?logic(g):'–';
      h+=`<tr><td>${esc(b.label)}</td><td>${gq?gq.name:'—'}</td><td>${ui.pressed[b.id]?'<b>lenyomva</b>':'fel'}</td><td><span class="lv ${l==='1'?'lv1':l==='0'?'lv0':'lvq'}">${l}</span></td></tr>`;}
    h+='</tbody></table>';
    if(!ui.sim)h+='<p class="help" style="margin-top:6px">Indítsd a szimulációt, és kattints a gombokra a panelon.</p>';}
  // GPIO-k
  const used=SIM.gpios.filter(g=>{const net=A.pins.find(q=>q.part===g.q.part&&q.id===g.q.id).net;return (A0.netPins.get(A0.pins.find(q=>q.part===g.q.part&&q.id===g.q.id).net)||[]).length>1||(A0.netSecs.get(A0.pins.find(q=>q.part===g.q.part&&q.id===g.q.id).net)||0)>1;});
  if(used.length){h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>GPIO</th><th>Mód</th><th>U</th><th>Szint</th></tr></thead><tbody>`;
    for(const g of used){const key=g.p.id+'.'+g.q.id,l=logic(g);
      h+=`<tr><td>${g.q.name}</td><td><select data-gpio="${key}" aria-label="${g.q.name} mód">${GPIO_MODES.filter(x=>x[0]!=='adc'||hasCap(g.q,'adc')).map(([v,t])=>`<option value="${v}" ${g.mode===v?'selected':''}>${t}</option>`).join('')}</select></td><td>${g.powered&&!g.float?g.V.toFixed(2):'–'}</td><td><span class="lv ${l==='1'?'lv1':l==='0'?'lv0':'lvq'}">${l}</span>${Math.abs(g.I)>1e-4?` <span class="muted">${(Math.abs(g.I)*1000).toFixed(1)} mA</span>`:''}</td></tr>`;}
    h+='</tbody></table>';}
  const lights=SIM.leds.filter(l=>l.light);
  if(SIM.fets.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>FET</th><th>U<sub>GS</sub></th><th>I<sub>D</sub></th><th>Állapot</th></tr></thead><tbody>`+SIM.fets.map(f=>`<tr><td>${esc(f.p.label)}</td><td>${f.floatGate?'lebeg':f.vgs.toFixed(2)+' V'}</td><td>${fmtSI(Math.abs(f.I))}A</td><td>${f.on?'<span class="c-ok">nyitva</span>':'<span class="muted">zárva</span>'}</td></tr>`).join('')+'</tbody></table>';
  if(lights.length){h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>LED</th><th>Áram</th><th>Állapot</th></tr></thead><tbody>`+lights.map(l=>`<tr><td>${esc(l.p.label)}</td><td>${(l.I*1000).toFixed(2)} mA</td><td>${l.I>2e-4?'<span class="c-ok">világít</span>':'<span class="muted">sötét</span>'}</td></tr>`).join('')+'</tbody></table>';}
  const BST={off:'<span class="muted">zárva</span>',act:'<span class="c-warn">aktív</span>',sat:'<span class="c-ok">telítve</span>'};
  if(SIM.bjts.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>NPN</th><th>I<sub>B</sub></th><th>I<sub>C</sub></th><th>U<sub>CE</sub></th><th>Állapot</th></tr></thead><tbody>`+SIM.bjts.map(t=>`<tr><td>${esc(t.p.label)}</td><td>${t.floatBase?'lebeg':fmtSI(t.ib)+'A'}</td><td>${fmtSI(Math.abs(t.ic))}A</td><td>${t.vce.toFixed(2)} V</td><td>${BST[t.st]}</td></tr>`).join('')+'</tbody></table>';
  if(SIM.caps.length)h+=`<table class="tbl" style="margin-top:10px"><thead><tr><th>Kond.</th><th>U</th><th title="Időállandó: ennyi idő alatt töltődik fel kb. 63%-ra, 5τ alatt teljesen">τ</th></tr></thead><tbody>`+SIM.caps.map(k=>`<tr><td>${esc(k.p.label)} <span class="muted">${fmtSI(k.f)}F</span></td><td>${k.float?'–':k.U.toFixed(2)+' V'}</td><td>${k.tau!=null?fmtSI(k.tau)+'s':'<span class="muted">nincs töltőút</span>'}</td></tr>`).join('')+'</tbody></table>';
  const batt=SIM.bats.filter(b=>b.kind!=='supply');
  if(batt.length)h+=batt.map(b=>`<div class="small" style="margin-top:6px">${esc(b.p.label)}: ${b.I>1e-4?'töltődik':b.I<-1e-4?'merül':'nincs terhelés'} ${Math.abs(b.I)>1e-4?`(${(Math.abs(b.I)*1000).toFixed(1)} mA)`:''}</div>`).join('');
  $('#simOut').innerHTML=h;
}
$('#issues').addEventListener('click',e=>{const li=e.target.closest('[data-i]');if(!li)return;const x=ISSUES[+li.dataset.i];if(!x.holes.length)return;ui.flash={holes:x.holes,until:performance.now()+2200};
  const [r,c]=x.holes[0],sc=$('#scroll'),[vx,vy]=toScreen(hx(c),hy(r));sc.scrollTo({left:vx-sc.clientWidth/2,top:vy-sc.clientHeight/2,behavior:'smooth'});
  const tick=()=>{draw();if(performance.now()<ui.flash.until)requestAnimationFrame(tick);else draw();};tick();});
/* csúszka-vezérlők (pl. joystick-tengely): külön tárolóban, hogy húzás közben ne épüljön újra */
const sliders=()=>D.parts.flatMap(p=>(DEFS[p.type].def.controls||[]).filter(c=>c.kind==='slider').map(c=>({p,c,pr:(DEFS[p.type].def.params||[]).find(x=>x.key===c.key)})).filter(x=>x.pr));
function renderSliders(){const ss=sliders(),el=$('#simCtl');
  const sig=ss.map(({p,c})=>p.id+':'+p.label+':'+c.key).join('|');
  if(el.dataset.sig===sig){for(const {p,c,pr} of ss){const k=p.id+'|'+c.key,v=penv(p)[c.key],i=el.querySelector(`[data-sl="${k}"]`),o=el.querySelector(`[data-slv="${k}"]`);if(i&&i!==document.activeElement)i.value=v;if(o)o.textContent=v+(pr.unit?' '+pr.unit:'');}return;}
  el.dataset.sig=sig;
  el.innerHTML=ss.length?`<p class="small muted" style="margin:8px 0 2px">Vezérlők</p>`+ss.map(({p,c,pr})=>{const v=penv(p)[c.key],k=p.id+'|'+c.key;
    return `<div class="row slider"><label for="sl_${p.id}_${c.key}">${esc(p.label)} ${esc(c.label||pr.label)}</label><input type="range" id="sl_${p.id}_${c.key}" data-sl="${k}" min="${pr.min}" max="${pr.max}" step="${pr.step||1}" value="${v}"><output data-slv="${k}">${v}${pr.unit?' '+esc(pr.unit):''}</output></div>`;}).join(''):'';}
function setSlider(p,key,v){const pr=(DEFS[p.type].def.params||[]).find(x=>x.key===key);if(!pr)return false;v=Math.max(pr.min,Math.min(pr.max,+v||0));p.props={...p.props,[key]:v};
  SIM=simulate(AS);ISSUES=checkAll();renderRight();draw();save();return true;}
$('#simCtl').addEventListener('input',e=>{const t=e.target.closest('[data-sl]');if(!t)return;const [pid,key]=t.dataset.sl.split('|');const p=D.parts.find(x=>x.id===pid);if(p)setSlider(p,key,t.value);});
$('#simOut').addEventListener('change',e=>{const s=e.target.closest('[data-gpio]');if(!s)return;pushUndo();D.gpio[s.dataset.gpio]=s.value;commit();});
$('#usb').addEventListener('change',e=>{pushUndo();D.settings.usb=e.target.checked;commit();});
$('#mHold').onclick=()=>{D.settings.btnMode='hold';ui.pressed={};save();recompute();};
$('#mToggle').onclick=()=>{D.settings.btnMode='toggle';save();recompute();};

function status(){
  const s=$('#status'),h=ui.hover;if(ui.selLink&&(!h||!inb(h.r,h.c))){const t=linkStatusText();if(t){s.textContent=t;return;}}if(!h||!inb(h.r,h.c)){const ab=D.auto.bridges.length,aw=D.auto.wires.length;s.textContent=`${D.parts.length} alkatrész · ${D.bridges.length+ab} híd · ${D.wires.length+aw} vezeték`;return;}
  const A=ui.sim?AS:A0,root=A.find(A.sid(h.r,h.c)),qs=A.netPins.get(root)||[],s0=secStart(h.r);
  let t=`${h.r}:${h.c} · szekció ${s0}–${Math.min(s0+D.board.sec-1,D.board.rows-1)}:${h.c}`;
  if(qs.length)t+=` · net: ${qs.slice(0,7).map(pinLabel).join(', ')}${qs.length>7?` +${qs.length-7}`:''}`;
  if(ui.sim&&SIM&&qs.length)t+=SIM.floating.has(root)?' · lebeg':` · ${(SIM.netV.get(root)||0).toFixed(2)} V`;
  s.textContent=t;
}
function recompute(){A0=analyze(false);AS=ui.sim?analyze(true):A0;SIM=simulate(AS);linkStates();ISSUES=checkAll();renderRight();renderLinks();status();draw();}

/* ---------- Felső sáv ---------- */
$('#vRats').onclick=()=>toggleRats();
$('#vRot').onclick=()=>rotView();
$('#vXray').onclick=()=>toggleXray();
function toggleXray(){ui.xray=!ui.xray;$('#vXray').classList.toggle('on',ui.xray);draw();}
function rotView(){const sc=$('#scroll');D.settings.vrot=(VR()+1)&3;save();resize();sc.scrollTo(0,0);}
$('#vComp').onclick=()=>setView('comp');$('#vCu').onclick=()=>setView('cu');
$('#zIn').onclick=()=>zoom(0.2);$('#zOut').onclick=()=>zoom(-0.2);
$('#bUndo').onclick=undo;$('#bRedo').onclick=redo;
$('#bSim').onclick=()=>setSim(!ui.sim);
$('#bPreset').onclick=()=>{pushUndo();D=keepLib(presetMacropad());ui.sel=null;commit();};
$('#bPreset2').onclick=()=>{pushUndo();D=keepLib(presetRouted());ui.sel=null;commit();};
$('#autoR').addEventListener('change',e=>{pushUndo();D.settings.autoRoute=e.target.checked;commit();});
$('#bRoute').onclick=()=>{pushUndo();route({full:true});commit(true);};
$('#bFreeze').onclick=()=>{if(!D.auto.bridges.length&&!D.auto.wires.length)return;pushUndo();D.bridges.push(...D.auto.bridges.map(b=>b.slice(0,4)));D.wires.push(...D.auto.wires.map(w=>({a:w.a,b:w.b,color:w.color})));D.auto={bridges:[],wires:[]};commit(true);};
$('#bToAuto').onclick=()=>{const n=manualToAuto(null);if(!n)flashMsg('Nincs kézi bekötés, amit át lehetne alakítani');};
$('#bUnroute').onclick=()=>{pushUndo();D.auto={bridges:[],wires:[]};D.settings.autoRoute=false;commit(true);};
$('#links').addEventListener('click',e=>{const b=e.target.closest('[data-dl]');if(b){pushUndo();D.links=D.links.filter(l=>l.id!==b.dataset.dl);commit();return;}
  const li=e.target.closest('[data-li]');if(li){const id=li.dataset.li;ui.selLink=ui.selLink===id?null:id;renderLinks();draw();status();
    if(ui.selLink){const g=linkGeom(D.links.find(x=>x.id===id));if(g){const sc=$('#scroll'),pts=[g.start,g.end].filter(Boolean).map(([r,c])=>toScreen(hx(c),hy(r)));const vx=pts.reduce((t,p)=>t+p[0],0)/pts.length,vy=pts.reduce((t,p)=>t+p[1],0)/pts.length;sc.scrollTo({left:vx-sc.clientWidth/2,top:vy-sc.clientHeight/2,behavior:'smooth'});}}}});
$('#bClear').onclick=()=>{const b=$('#bClear');if(Date.now()-ui.confirmClear<3000){pushUndo();D=keepLib(emptyDesign());ui.sel=null;commit();b.textContent='Üres panel';ui.confirmClear=0;return;}ui.confirmClear=Date.now();b.textContent='Biztos? Kattints újra';setTimeout(()=>{b.textContent='Üres panel';},3000);};
$('#bExport').onclick=()=>{$('#json').value=JSON.stringify(D,null,1);$('#jsonMsg').textContent='A terv JSON-ja a mezőben.';};
$('#bCopy').onclick=()=>{const ta=$('#json');if(!ta.value)ta.value=JSON.stringify(D,null,1);navigator.clipboard.writeText(ta.value).then(()=>$('#jsonMsg').textContent='Vágólapra másolva.').catch(()=>{ta.focus();ta.select();$('#jsonMsg').textContent='Kijelöltem a szöveget, másold Ctrl+C-vel.';});};
$('#bImport').onclick=()=>{try{const d=normalize(JSON.parse($('#json').value));pushUndo();D=d;ui.sel=null;commit();$('#jsonMsg').textContent=`Betöltve: ${d.parts.length} alkatrész, ${d.bridges.length} híd, ${d.wires.length} vezeték.`;}catch(e){$('#jsonMsg').textContent='Hibás JSON: '+e.message;}};
function normalize(d){
  if(!d||typeof d!=='object')throw new Error('nem objektum');
  const o=emptyDesign();if(d.board)Object.assign(o.board,d.board);
  for(const [k,def] of Object.entries(d.customParts||{})){if(!/^c_[a-z0-9_]+$/.test(k)||k in PARTS||hasErrors(validatePartDef(def)))continue;o.customParts[k]=def;}
  syncDefs(o.customParts);
  o.parts=(d.parts||[]).map((p,i)=>{if(!DEFS[p.type])throw new Error('ismeretlen alkatrész: '+p.type);return{id:p.id||('p'+(1000+i)),type:p.type,label:p.label||DEFS[p.type].prefix+(i+1),r:p.r|0,c:p.c|0,rot:(p.rot|0)&3,mir:!!p.mir,...(p.xray?{xray:true}:{}),props:{...DEFS[p.type].props,...(p.props||{})}};});
  o.bridges=(d.bridges||[]).filter(b=>Array.isArray(b)&&b.length===4).map(b=>b.map(Number));
  o.wires=(d.wires||[]).filter(w=>w&&w.a&&w.b).map(w=>({a:w.a.map(Number),b:w.b.map(Number),color:w.color||'#1c7ed6'}));
  o.gpio=d.gpio||{};o.settings={...o.settings,...(d.settings||{})};
  o.links=(d.links||[]).filter(l=>l&&l.a&&l.b).map((l,i)=>({id:l.id||('l'+(5000+i)),a:String(l.a),b:String(l.b),gpio:l.gpio||null}));
  const au=d.auto||{};o.auto={bridges:(au.bridges||[]).filter(b=>Array.isArray(b)&&b.length>=4).map(b=>[...b.slice(0,4).map(Number),Array.isArray(b[4])?b[4]:(b[4]?[b[4]]:[])]),wires:(au.wires||[]).filter(w=>w&&w.a&&w.b).map(w=>({a:w.a,b:w.b,color:w.color||'#7048e8',links:w.links||(w.link?[w.link]:[])}))};
  o.seq=Math.max(d.seq||1,...o.parts.map(p=>+(String(p.id).replace(/\D/g,''))+1||1),...o.links.map(l=>+(String(l.id).replace(/\D/g,''))+1||1));
  return o;
}

/* ---------- Kapcsolatok és útvonalkereső ---------- */
function findPin(ref){const i=ref.indexOf('.');if(i<0)return null;const p=D.parts.find(x=>x.id===ref.slice(0,i));if(!p)return null;return gpins(p).find(q=>q.id===ref.slice(i+1))||null;}
function equivPins(q){if(!q)return[];const g=partGroups(q.part),k=g[q.id];return gpins(q.part).filter(x=>g[x.id]===k);}
function groupLabel(q){if(!q)return'?';const eq=equivPins(q);if(eq.length<2)return pinLabel(q);
  if(q.part.type==='button')return `${q.part.label}.${q.role}`;if(q.part.type==='pico'&&q.role==='gnd')return `${q.part.label}.GND`;
  return `${q.part.label}.${eq.map(x=>x.id).join('/')}`;}
function linkText(l){const a=findPin(l.a);const b=l.b==='GND'?'GND':l.b==='GPIO'?'GPIO':groupLabel(findPin(l.b));return `${groupLabel(a)} → ${b}`;}
function hitPin(rf,cf){let best=null,bd=0.45;for(const p of D.parts)for(const q of gpins(p)){const d=Math.hypot(q.r-rf,q.c-cf);if(d<bd){bd=d;best=q;}}return best;}
function dropLinks(pid){D.links=D.links.filter(l=>!l.a.startsWith(pid+'.')&&!l.b.startsWith(pid+'.'));}
function addLink(a,b){if(D.links.some(l=>(l.a===a&&l.b===b)||(l.a===b&&l.b===a)))return;pushUndo();D.links.push({id:'l'+(D.seq++),a,b,gpio:null});commit();}
function linkStates(){
  ui.linkState=new Map();const A=A0;
  const pinNet=ref=>{const q=findPin(ref);if(!q||!inb(q.r,q.c))return -1;return A.find(A.sid(q.r,q.c));};
  for(const l of D.links){const na=pinNet(l.a);let ok=false,gp=null;
    if(na>=0){const qs=A.netPins.get(na)||[];
      if(l.b==='GND')ok=qs.some(q=>q.part.type==='pico'&&q.role==='gnd');
      else if(l.b==='GPIO'){const an=(findPin(l.a)||{}).role==='adc';gp=qs.find(q=>q.part.type==='pico'&&q.role==='gpio'&&(!an||hasCap(q,'adc')));ok=!!gp;}
      else ok=pinNet(l.b)===na;}
    const nb=D.auto.bridges.filter(b=>(b[4]||[]).includes(l.id)).length,wire=D.auto.wires.some(w=>(w.links||[]).includes(l.id));
    ui.linkState.set(l.id,{ok,gpio:gp?gp.name:null,gpioRef:gp?gp.part.id+'.'+gp.id:null,nb,wire});}
}
function renderLinks(){
  $('#autoR').checked=!!D.settings.autoRoute;
  const n=D.links.length,ok=[...ui.linkState.values()].filter(s=>s.ok).length;
  $('#linkSum').innerHTML=n?`<span class="chip ${ok===n?'c-ok':'c-warn'}">${ok}/${n} bekötve</span>`:'';
  $('#links').innerHTML=n?D.links.map(l=>{const s=ui.linkState.get(l.id)||{};
    const st=!s.ok?'<span class="c-err">nincs</span>':s.wire?'<span class="c-warn">vezeték</span>':s.nb?`<span class="c-ok">${s.nb} híd</span>`:'<span class="muted">kézi</span>';
    return `<li class="lk${ui.selLink===l.id?' on':''}" data-li="${l.id}" title="Kattints: kezdő- és végpont, útvonal kiemelése"><span class="t">${esc(linkText(l))}${s.gpio&&l.b==='GPIO'?` <b>${s.gpio}</b>`:''}</span>${st}<button data-dl="${l.id}" aria-label="Kapcsolat törlése" title="Törlés">×</button></li>`;}).join('')
    :'<li class="muted small" style="padding:4px 6px">Még nincs kapcsolat.</li>';
  const ab=D.auto.bridges.length,aw=D.auto.wires.length,mb=D.bridges.length,mw=D.wires.length;
  const sum=[...ui.linkState.values()].reduce((t,s)=>t+(s.nb||0),0);
  const parts=[`<b>${ab+mb}</b> híd`+(ab&&mb?` <span class="muted">(${ab} auto + ${mb} kézi)</span>`:ab?' <span class="muted">(auto)</span>':mb?' <span class="muted">(kézi)</span>':'')];
  if(aw+mw)parts.push(`<b>${aw+mw}</b> vezeték`+(aw&&mw?` <span class="muted">(${aw} auto + ${mw} kézi)</span>`:aw?' <span class="muted">(auto)</span>':' <span class="muted">(kézi)</span>'));
  $('#linkTotal').innerHTML=(n||ab+mb+aw+mw)?`<span>Összesen: ${parts.join(' · ')}</span>`+(ab&&sum>ab?`<span class="muted" title="A soronkénti számok összege ${sum}; a közös szakaszok (pl. GND-törzs) több kapcsolatnál is szerepelnek, de csak egyszer kell beforrasztani.">ⓘ sorok összege: ${sum} (közös szakaszok)</span>`:''):'';
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
function movedLinks(p){const ids=new Set();for(const l of D.links){if(l.a.startsWith(p.id+'.')||l.b.startsWith(p.id+'.'))ids.add(l.id);else if(p.type==='pico'&&(l.b==='GND'||l.b==='GPIO'))ids.add(l.id);}return ids;}
function toggleRats(){ui.rats=!ui.rats;$('#vRats').classList.toggle('on',ui.rats);draw();}
function ratTarget(l,A,st,a){
  a=a||findPin(l.a);if(!a)return null;
  if(l.b!=='GND'&&l.b!=='GPIO'){const ts=equivPins(findPin(l.b));let bt=null,bd=1e9;for(const t of ts){const d=Math.hypot(t.r-a.r,t.c-a.c);if(d<bd){bd=d;bt=t;}}return bt;}
  const na=inb(a.r,a.c)?A.find(A.sid(a.r,a.c)):-1;
  if(l.b==='GPIO'){const ref=(st&&st.gpioRef)||l.gpio;const t=ref&&findPin(ref);if(t)return t;
    const an=a.role==='adc';let bt=null,bd=1e9;for(const q of A.pins){if(q.part.type!=='pico'||q.role!=='gpio'||!q.on||(an&&!hasCap(q,'adc')))continue;if((A.netPins.get(q.net)||[]).length>1||(A.netSecs.get(q.net)||0)>1)continue;const d=Math.abs(q.r-a.r)/3+Math.abs(q.c-a.c);if(d<bd){bd=d;bt=q;}}return bt;}
  // GND: a legközelebbi GND-hálózati láb (bekötött kapcsolatnál a saját hálózatán belül a Pico GND)
  let bt=null,bd=1e9;
  for(const [net,qs] of A.netPins){if(!qs.some(q=>q.part.type==='pico'&&q.role==='gnd'))continue;
    if(st&&st.ok){if(net!==na)continue;for(const q of qs){if(q.part.type!=='pico'||q.role!=='gnd')continue;const d=Math.abs(q.r-a.r)/3+Math.abs(q.c-a.c);if(d<bd){bd=d;bt=q;}}}
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
function partGroups(p){const g={};const f=x=>g[x]===x?x:(g[x]=f(g[x]));DEFS[p.type].pins(p).forEach(pn=>g[pn.id]=pn.id);for(const [a,b] of DEFS[p.type].internal(p))g[f(a)]=f(b);const o={};for(const k in g)o[k]=f(k);return o;}
function route(opts){
  opts=opts||{};
  const B=D.board,SR=Math.ceil(B.rows/B.sec),NC=B.cols*SR;
  const cellOf=(r,c)=>c*SR+Math.floor(r/B.sec);
  const allPins=[];for(const p of D.parts)for(const q of gpins(p))if(inb(q.r,q.c))allPins.push(q);
  const pinByRef=new Map(allPins.map(q=>[q.part.id+'.'+q.id,q]));
  const links=D.links.filter(l=>pinByRef.has(l.a)&&(l.b==='GND'||l.b==='GPIO'||pinByRef.has(l.b)));
  const valid=new Set(links.map(l=>l.id));
  const pinHoles=new Set(allPins.map(q=>q.r+':'+q.c));
  const PG=new Map(D.parts.map(p=>[p.id,partGroups(p)]));
  const okB=b=>inb(b[0],b[1])&&inb(b[2],b[3]);
  function base(kb,kw){
    const par=new Int32Array(NC),sz=new Int32Array(NC).fill(1),used=new Uint8Array(NC);for(let i=0;i<NC;i++)par[i]=i;
    const find=x=>{while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;};
    const uni=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(a>b){const t=a;a=b;b=t;}par[b]=a;sz[a]+=sz[b];};
    for(const b of [...D.bridges,...kb])if(okB(b)){const x=cellOf(b[0],b[1]),y=cellOf(b[2],b[3]);used[x]=used[y]=1;uni(x,y);}
    for(const w of [...D.wires,...kw])if(inb(w.a[0],w.a[1])&&inb(w.b[0],w.b[1])){const x=cellOf(w.a[0],w.a[1]),y=cellOf(w.b[0],w.b[1]);used[x]=used[y]=1;uni(x,y);}
    for(const q of allPins)used[cellOf(q.r,q.c)]=1;
    for(const p of D.parts){const m={};for(const q of gpins(p))m[q.id]=q;for(const [a,b] of DEFS[p.type].internal(p))if(inb(m[a].r,m[a].c)&&inb(m[b].r,m[b].c))uni(cellOf(m[a].r,m[a].c),cellOf(m[b].r,m[b].c));}
    return{par,sz,used,find,uni,bridges:kb.map(b=>[...b.slice(0,4),[...b[4]]]),wires:kw.map(w=>({...w,links:[...w.links]})),
      wireEnds:new Set([...D.wires,...kw].flatMap(w=>[w.a.join(':'),w.b.join(':')]))};
  }
  const info=S=>{const m=new Map();for(const q of allPins){const r=S.find(cellOf(q.r,q.c));if(!m.has(r))m.set(r,[]);m.get(r).push(q);}return m;};
  const isGnd=qs=>!!qs&&qs.some(q=>q.part.type==='pico'&&q.role==='gnd');
  const freeGpio=(qs,r,S)=>!!qs&&qs.length===1&&qs[0].part.type==='pico'&&qs[0].role==='gpio'&&S.sz[r]===1;
  const needAdc=l=>(pinByRef.get(l.a)||{}).role==='adc';
  function predFor(S,l,I){
    if(l.b==='GND')return r=>isGnd(I.get(r));
    if(l.b==='GPIO'){const an=needAdc(l);
      // annyi ADC-képes GPIO-t hagy szabadon, ahány analóg kapcsolat még bekötetlen
      let useAdc=an;if(!an){let free=0;const seen=new Set();for(const q of allPins){if(!hasCap(q,'adc')||q.role!=='gpio')continue;const r=S.find(cellOf(q.r,q.c));if(!seen.has(r)&&freeGpio(I.get(r),r,S)){seen.add(r);free++;}}
        const pend=links.filter(x=>x.b==='GPIO'&&needAdc(x)&&!sat(S,x,I)).length;useAdc=free>pend;}
      return r=>{const qs=I.get(r);if(!freeGpio(qs,r,S))return false;return hasCap(qs[0],'adc')?useAdc:!an;};}
    const qb=pinByRef.get(l.b),t=S.find(cellOf(qb.r,qb.c));return r=>r===t;
  }
  const srcOf=(S,l)=>{const qa=pinByRef.get(l.a);return S.find(cellOf(qa.r,qa.c));};
  const sat=(S,l,I)=>{const src=srcOf(S,l);if(l.b==='GPIO'){const an=needAdc(l);return(I.get(src)||[]).some(q=>q.part.type==='pico'&&q.role==='gpio'&&(!an||hasCap(q,'adc')));}return predFor(S,l,I)(src);};
  const srcSig=new Map();for(const l of links){const q=pinByRef.get(l.a);const k=q.part.id+':'+PG.get(q.part.id)[q.id];const sg=l.b==='GND'?'GND':l.b==='GPIO'?'G'+l.id:null;if(sg&&!srcSig.has(k))srcSig.set(k,sg);}
  const badNet=qs=>{const pico=qs.filter(q=>q.part.type==='pico');const gnd=pico.some(q=>q.role==='gnd');
    const sigs=new Set(gnd?['GND']:[]);for(const q of qs){const sg=srcSig.get(q.part.id+':'+PG.get(q.part.id)[q.id]);if(sg)sigs.add(sg);}if(sigs.size>1)return true;
    const other=new Set(pico.filter(q=>q.role!=='gnd').map(q=>q.part.id+'.'+q.id));if((gnd&&other.size)||other.size>1)return true;
    const seen=new Map();for(const q of qs){if(q.part.type==='pico')continue;const g=PG.get(q.part.id)[q.id];if(seen.has(q.part.id)&&seen.get(q.part.id)!==g)return true;seen.set(q.part.id,g);}return false;};
  const geo=(a,b)=>{const ca=Math.floor(a/SR),ba=a%SR,cb=Math.floor(b/SR),bb=b%SR;
    const Q=B.sec;if(ca===cb){const lo=Math.min(ba,bb);return[Q*lo+Q-1,ca,Q*lo+Q,ca];}
    const row=Math.min(Q*ba+(Q>>1),B.rows-1);return[row,Math.min(ca,cb),row,Math.max(ca,cb)];};
  const DIRS=[[0,-1],[0,1],[-1,0],[1,0]];
  function routeOne(S,l){
    const I=info(S),src=srcOf(S,l);
    if(sat(S,l,I))return{ok:true,n:0};
    const pred=predFor(S,l,I);
    const spare=l.b==='GPIO'&&!needAdc(l); // az ADC-képes GPIO-kat az analóg jeleknek tartogatja
    let prefRoot=-1;if(l.b==='GPIO'&&l.gpio&&pinByRef.has(l.gpio)){const g=pinByRef.get(l.gpio);prefRoot=S.find(cellOf(g.r,g.c));}
    const dist=new Float64Array(NC*5).fill(1e9),prev=new Int32Array(NC*5).fill(-1);
    const hp=[];const push=(d,s)=>{hp.push([d,s]);let i=hp.length-1;while(i>0){const p=(i-1)>>1;if(hp[p][0]<=hp[i][0])break;[hp[p],hp[i]]=[hp[i],hp[p]];i=p;}};
    const pop=()=>{const t=hp[0],l2=hp.pop();if(hp.length){hp[0]=l2;let i=0;for(;;){const a=2*i+1,b=a+1;let m=i;if(a<hp.length&&hp[a][0]<hp[m][0])m=a;if(b<hp.length&&hp[b][0]<hp[m][0])m=b;if(m===i)break;[hp[m],hp[i]]=[hp[i],hp[m]];i=m;}}return t;};
    for(let i=0;i<NC;i++)if(S.find(i)===src){dist[i*5+4]=0;push(0,i*5+4);}
    let best=null,bc=1e9;
    while(hp.length){const [d,s]=pop();if(d>dist[s])continue;if(d>=bc)break;
      const cell=(s/5)|0,dir=s%5,col=(cell/SR)|0,band=cell%SR;
      for(let k=0;k<4;k++){const nc=col+DIRS[k][0],nb=band+DIRS[k][1];if(nc<0||nc>=B.cols||nb<0||nb>=SR||B.sec*nb>=B.rows)continue;
        const n=nc*SR+nb,rn=S.find(n);if(rn===src)continue;
        const step=1+(dir!==4&&dir!==k?0.6:0);
        if(S.used[n]||S.sz[rn]>1){if(pred(rn)){const tc=d+step+(prefRoot>=0&&rn!==prefRoot?14:0)+(spare&&hasCap((I.get(rn)||[])[0],'adc')?12:0);if(tc<bc){bc=tc;best={s,n};}}continue;}
        const ns=n*5+k,nd=d+step;if(nd<dist[ns]){dist[ns]=nd;prev[ns]=s;push(nd,ns);}}}
    if(!best)return{ok:false};
    const cells=[best.n];let s=best.s;while(s>=0){cells.push((s/5)|0);s=prev[s];}
    for(let i=0;i+1<cells.length;i++)S.bridges.push([...geo(cells[i],cells[i+1]),[l.id]]);
    for(const c of cells)S.used[c]=1;for(let i=0;i+1<cells.length;i++)S.uni(cells[i],cells[i+1]);
    return{ok:true,n:cells.length-1};
  }
  const est=l=>{const a=pinByRef.get(l.a);if(l.b!=='GND'&&l.b!=='GPIO'){const b=pinByRef.get(l.b);return Math.abs(a.r-b.r)/3+Math.abs(a.c-b.c);}
    const an=l.b==='GPIO'&&needAdc(l);let bd=1e9;for(const q of allPins)if(q.part.type==='pico'&&q.role===(l.b==='GND'?'gnd':'gpio')&&(!an||hasCap(q,'adc')))bd=Math.min(bd,Math.abs(a.r-q.r)/3+Math.abs(a.c-q.c));return bd;};
  const prio=l=>l.b==='GND'?2:l.b==='GPIO'?(needAdc(l)?0.5:1):0;
  const cmp=(x,y)=>prio(x)-prio(y)||est(y)-est(x);
  function full(){
    let order=[...links].sort(cmp);let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
    let best=null,firstOk=-1;
    for(let att=0;att<60;att++){
      const S=base([],[]),fails=[];let nb=0;
      for(const l of order){const r=routeOne(S,l);if(!r.ok)fails.push(l);else nb+=r.n||0;}
      const score=fails.length*10000+nb;
      if(!best||score<best.score)best={score,S,fails};
      if(!fails.length&&firstOk<0)firstOk=att;
      if(firstOk>=0&&att>=firstOk+14)break;
      if(fails.length)order=[...fails,...order.filter(l=>!fails.includes(l))];
      if(att>8||firstOk>=0){for(let i=order.length-1;i>0;i--){if(rnd()<0.3){const j=(rnd()*(i+1))|0;[order[i],order[j]]=[order[j],order[i]];}}}
    }
    return best||{S:base([],[]),fails:[]};
  }
  function incremental(){
    let kb=D.auto.bridges.filter(okB).map(b=>[...b.slice(0,4),[...(b[4]||[])]]);
    let kw=D.auto.wires.map(w=>({...w,links:[...(w.links||[])]}));
    const dirty=new Set();
    if(opts.moved)for(const l of links)if([l.a,l.b].some(x=>opts.moved.has(x.split('.')[0])))dirty.add(l.id);
    for(let it=0;it<10;it++){
      const strip=x=>x.filter(id=>valid.has(id)&&!dirty.has(id));
      kb=kb.map(b=>{b[4]=strip(b[4]);return b;}).filter(b=>b[4].length);
      kw=kw.map(w=>{w.links=strip(w.links);return w;}).filter(w=>w.links.length);
      const S=base(kb,kw),I=info(S),bad=new Set();let more=false;
      for(const [r,qs] of I)if(badNet(qs))bad.add(r);
      const mark=ids=>{for(const id of ids)if(!dirty.has(id)){dirty.add(id);more=true;}};
      for(const b of kb)if(bad.has(S.find(cellOf(b[0],b[1]))))mark(b[4]);
      for(const w of kw)if(bad.has(S.find(cellOf(w.a[0],w.a[1]))))mark(w.links);
      const own=new Set([...kb.flatMap(b=>b[4]),...kw.flatMap(w=>w.links)]);
      for(const l of links)if(own.has(l.id)&&!sat(S,l,I))mark([l.id]);
      if(!more)break;
    }
    const S=base(kb,kw),fails=[];
    for(const l of links.filter(l=>!sat(S,l,info(S))).sort(cmp)){const r=routeOne(S,l);if(!r.ok)fails.push(l);}
    return{S,fails};
  }
  let out=(opts.full||(!D.auto.bridges.length&&!D.auto.wires.length))?full():incremental();
  if(out.fails.length&&!opts.full){const f=full();if(f.fails.length<out.fails.length)out=f;}
  const S=out.S;
  const freeHoles=cell=>{const c=(cell/SR)|0,b=cell%SR,o=[];for(let r=B.sec*b;r<Math.min(B.sec*b+B.sec,B.rows);r++){const k=r+':'+c;if(!pinHoles.has(k)&&!S.wireEnds.has(k))o.push([r,c]);}return o;};
  for(const l of out.fails){
    const src=srcOf(S,l),I=info(S),pred=predFor(S,l,I);
    const sc=[],tc=[];for(let i=0;i<NC;i++){const r=S.find(i);if(r===src)sc.push(i);else if(pred(r))tc.push(i);}
    let bp=null,bd=1e9;
    for(const a of sc)for(const h1 of freeHoles(a))for(const t of tc)for(const h2 of freeHoles(t)){const d=Math.hypot(h1[0]-h2[0],h1[1]-h2[1]);if(d<bd){bd=d;bp=[h1,h2,t];}}
    if(bp){S.wires.push({a:bp[0],b:bp[1],color:'#7048e8',links:[l.id]});S.wireEnds.add(bp[0].join(':'));S.wireEnds.add(bp[1].join(':'));S.uni(src,bp[2]);}
  }
  D.auto={bridges:S.bridges,wires:S.wires};
  const I=info(S);for(const l of links){if(l.b!=='GPIO')continue;const an=needAdc(l);const g=(I.get(srcOf(S,l))||[]).find(q=>q.part.type==='pico'&&q.role==='gpio'&&(!an||hasCap(q,'adc')));if(g)l.gpio=g.part.id+'.'+g.id;}
}
function manualToAuto(pid){
  const want=pid?(pid instanceof Set?pid:new Set([pid])):null;
  const keep=ui.hideAuto;ui.hideAuto='all';const A=analyze(false);ui.hideAuto=keep;
  const conv=new Set(),add=[];
  const has=(a,b)=>D.links.some(l=>(l.a===a&&l.b===b)||(l.a===b&&l.b===a))||add.some(l=>l.a===a&&l.b===b);
  const ref=q=>q.part.id+'.'+q.id;
  for(const [net,qs] of A.netPins){
    if(want&&!qs.some(q=>want.has(q.part.id)))continue;
    const groups=new Map();
    for(const q of qs){const k=q.part.id+':'+(q.part.type==='pico'&&q.role==='gnd'?'GND':partGroups(q.part)[q.id]);if(!groups.has(k))groups.set(k,q);}
    if(groups.size<2)continue;
    conv.add(net);
    const reps=[...groups.values()];
    const gnd=reps.find(q=>q.part.type==='pico'&&q.role==='gnd');
    const gp=reps.filter(q=>q.part.type==='pico'&&q.role==='gpio');
    const others=reps.filter(q=>q.part.type!=='pico');
    const pico=reps.filter(q=>q.part.type==='pico'&&q.role!=='gnd'&&q.role!=='gpio');
    if(gnd){for(const q of others)if(!has(ref(q),'GND'))add.push({a:ref(q),b:'GND'});for(const q of [...pico,...gp])add.push({a:ref(q),b:ref(gnd)});}
    else if(gp.length===1&&others.length&&!pico.length&&(D.gpio[gp[0].part.id+'.'+gp[0].id]||'pullup').startsWith('pull')){
      const g=ref(gp[0]);others.forEach((q,i)=>{if(i===0){if(!has(ref(q),'GPIO'))add.push({a:ref(q),b:'GPIO',gpio:g});}else if(!has(ref(q),ref(others[0])))add.push({a:ref(q),b:ref(others[0])});});}
    else{const anchor=reps[0];for(const q of reps.slice(1))if(!has(ref(q),ref(anchor)))add.push({a:ref(q),b:ref(anchor)});}
  }
  if(!add.length)return 0;
  pushUndo();
  const inConv=(r,c)=>inb(r,c)&&conv.has(A.find(A.sid(r,c)));
  const pinless=(r,c)=>inb(r,c)&&!(A.netPins.get(A.find(A.sid(r,c)))||[]).length;
  const isC=(r1,c1,r2,c2)=>inConv(r1,c1)||inConv(r2,c2);
  const convB=D.bridges.filter(b=>isC(b[0],b[1],b[2],b[3])),convW=D.wires.filter(w=>isC(w.a[0],w.a[1],w.b[0],w.b[1]));
  // a meglévő hidakat útvonalakra bontja: minden kapcsolat megkapja a saját útját
  const cell=(r,c)=>A.sid(r,c),adj=new Map(),addE=(x,y,k,i)=>{if(!adj.has(x))adj.set(x,[]);if(!adj.has(y))adj.set(y,[]);adj.get(x).push([y,k,i]);adj.get(y).push([x,k,i]);};
  convB.forEach((b,i)=>addE(cell(b[0],b[1]),cell(b[2],b[3]),'b',i));
  convW.forEach((w,i)=>addE(cell(w.a[0],w.a[1]),cell(w.b[0],w.b[1]),'w',i));
  for(const p of D.parts){const m={};for(const q of gpins(p))m[q.id]=q;for(const [a,b] of DEFS[p.type].internal(p))if(inb(m[a].r,m[a].c)&&inb(m[b].r,m[b].c))addE(cell(m[a].r,m[a].c),cell(m[b].r,m[b].c),'i',-1);}
  const cellPins=new Map();for(const q of A.pins){if(!q.on)continue;if(!cellPins.has(q.s))cellPins.set(q.s,[]);cellPins.get(q.s).push(q);}
  const aB=convB.map(()=>[]),aW=convW.map(()=>[]);
  const newLinks=add.map(l=>({id:'l'+(D.seq++),a:l.a,b:l.b,gpio:l.gpio||null}));
  for(const l of newLinks){
    const qa=findPin(l.a),start=cell(qa.r,qa.c);
    const goal=l.b==='GND'?(c=>(cellPins.get(c)||[]).some(q=>q.part.type==='pico'&&q.role==='gnd')):l.b==='GPIO'?(c=>{const g=findPin(l.gpio);return g&&c===cell(g.r,g.c);}):(c=>{const t=findPin(l.b);return t&&c===cell(t.r,t.c);});
    const prev=new Map([[start,null]]),qu=[start];let hit=goal(start)?start:-1;
    while(qu.length&&hit<0){const x=qu.shift();for(const e of adj.get(x)||[]){if(prev.has(e[0]))continue;prev.set(e[0],[x,e[1],e[2]]);if(goal(e[0])){hit=e[0];break;}qu.push(e[0]);}}
    for(let x=hit;x>=0&&prev.get(x);){const [px,k,i]=prev.get(x);if(k==='b')aB[i].push(l.id);else if(k==='w')aW[i].push(l.id);x=px;}
  }
  D.bridges=D.bridges.filter(b=>!(isC(b[0],b[1],b[2],b[3])||(!pid&&pinless(b[0],b[1]))));
  D.wires=D.wires.filter(w=>!isC(w.a[0],w.a[1],w.b[0],w.b[1]));
  D.auto.bridges.push(...convB.map((b,i)=>[...b.slice(0,4),aB[i]]).filter(b=>b[4].length));
  D.auto.wires.push(...convW.map((w,i)=>({a:w.a,b:w.b,color:w.color,links:aW[i]})).filter(w=>w.links.length));
  D.links.push(...newLinks);D.settings.autoRoute=true;commit();
  return newLinks.length;
}
function presetRouted(){
  const d=presetMacropad();
  d.bridges=[];d.wires=[];d.links=[];d.auto={bridges:[],wires:[]};d.settings.autoRoute=true;
  const P=d.parts.find(p=>p.type==='pico').id,L=(a,b)=>d.links.push({id:'l'+(d.seq++),a,b,gpio:null});
  for(const p of d.parts)if(p.type==='button'){L(p.id+'.A1','GPIO');L(p.id+'.B1','GND');}
  const by=lab=>d.parts.find(p=>p.label===lab).id;
  [['17','R1','LED1'],['19','R2','LED2'],['20','R3','LED3']].forEach(([pin,r,led])=>{L(P+'.'+pin,by(r)+'.1');L(by(r)+'.2',by(led)+'.A');L(by(led)+'.K','GND');});
  return d;
}

/* ---------- Saját alkatrészek ---------- */
function keepLib(nd){nd.customParts={...(D&&D.customParts||{})};return nd;}
const editorHost={
  builtin:PARTS,
  custom:()=>D.customParts||{},
  save(type,def){pushUndo();const t=type||typeKeyFor(def.name,k=>k in DEFS);D.customParts={...D.customParts,[t]:def};commit();libMsg(`Mentve: ${def.name}`);return t;},
  remove(type){pushUndo();const rest={...D.customParts};delete rest[type];D.customParts=rest;const gone=D.parts.filter(p=>p.type===type).map(p=>p.id);D.parts=D.parts.filter(p=>p.type!==type);gone.forEach(dropLinks);ui.sel=null;commit();libMsg('Alkatrész törölve');},
  usage:t=>D.parts.filter(p=>p.type===t).length,
  place(t){if(!DEFS[t])return;ui.placing=t;ui.ghost={rot:0,mir:false};ui.sel=null;ui.wireStart=null;renderLeft();draw();flashMsg('Kattints a panelra a lerakáshoz');},
  roleColor:r=>ROLEC[r]||'#868e96'
};
function libMsg(t){const e=$('#libMsg');if(e)e.textContent=t;}
$('#bNewPart').onclick=()=>openEditor(editorHost,{});
$('#bLibExp').onclick=()=>{const n=Object.keys(D.customParts||{}).length;if(!n){libMsg('Még nincs saját alkatrész.');return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify(exportLibrary(D.customParts),null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='proofboard-alkatreszek.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);libMsg(`${n} alkatrész exportálva.`);};
$('#bLibImp').onclick=()=>$('#libFile').click();
$('#libFile').addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
  try{const res=importLibrary(JSON.parse(await f.text()),k=>k in DEFS);const n=Object.keys(res.parts).length;
    if(n){pushUndo();D.customParts={...D.customParts,...res.parts};commit();}
    libMsg(`${n} alkatrész betöltve${res.rejected.length?`, ${res.rejected.length} hibás kihagyva (${res.rejected.map(r=>r.key).join(', ')})`:''}.`);}
  catch(err){libMsg('Nem sikerült betölteni: '+err.message);}});

/* ---------- Oldalsávok méretezése ---------- */
(function(){
  const app=$('.app'),DEF={l:250,r:320},LIM={l:[180,560],r:[220,640]};let w={...DEF};
  try{const v=JSON.parse(localStorage.getItem('proofboard.ui.sides')||'null');if(v&&v.l&&v.r)w={l:+v.l,r:+v.r};}catch(e){}
  const clamp=(k,v)=>Math.max(LIM[k][0],Math.min(LIM[k][1],Math.round(v)));
  const apply=()=>{w.l=clamp('l',w.l);w.r=clamp('r',w.r);app.style.setProperty('--lw',w.l+'px');app.style.setProperty('--rw',w.r+'px');};
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
  commit(true);resize();boardUI();
};

/* ---------- API ---------- */
window.pcb={
  load(d){D=normalize(typeof d==='string'?JSON.parse(d):d);ui.sel=null;commit();return true;},
  get(){return JSON.parse(JSON.stringify(D));},
  preset(){D=keepLib(presetMacropad());commit();},
  sim(on=true){setSim(!!on);},
  press(label,down=true){const p=D.parts.find(x=>x.label===label&&hasPress(x));if(!p)return false;if(!ui.sim)setSim(true);ui.pressed[p.id]=!!down;recompute();return true;},
  read(){return SIM?SIM.gpios.map(g=>({pin:g.q.name,mode:g.mode,V:+g.V.toFixed(3),level:logic(g)})):[];},
  issues(){return ISSUES.map(i=>({sev:i.sev,msg:i.msg,holes:i.holes}));},
  route(){route({full:true});commit(true);return pcb.links();},
  move(label,dr,dc){const p=D.parts.find(x=>x.label===label);if(!p)return false;const t={...p,r:p.r+dr,c:p.c+dc};if(!partFits(t))return false;pushUndo();p.r=t.r;p.c=t.c;ui.moved=new Set([p.id]);commit();return true;},
  links(){return D.links.map(l=>({...l,text:linkText(l),...(ui.linkState.get(l.id)||{})}));},
  presetRouted(){D=keepLib(presetRouted());commit();},
  toAuto(pid){return manualToAuto(pid||null);},
  defs(){return JSON.parse(JSON.stringify(PARTS));},
  // --- tesztekhez és szkripteléshez ---
  select(labels){const ids=D.parts.filter(p=>labels.includes(p.label)).map(p=>p.id);ui.sel=ids.length?grp(ids):null;renderLeft();draw();return ids.length;},
  rotate(){rotate();},mirror(){mirror();},undo(){undo();},redo(){redo();},
  simInfo(){return SIM?{leds:SIM.leds.map(l=>({label:l.p.label,I:l.I,light:!!l.light})),fets:SIM.fets.map(f=>({label:f.p.label,on:f.on,vgs:f.vgs,I:f.I,floatGate:f.floatGate})),bats:SIM.bats.map(b=>({label:b.p.label,I:b.I,kind:b.kind})),picos:SIM.picos.map(x=>({label:x.p.label,powered:x.powered})),caps:SIM.caps.map(k=>({label:k.p.label,U:k.U,R:k.R,tau:k.tau})),bjts:SIM.bjts.map(t=>({label:t.p.label,st:t.st,ib:t.ib,ic:t.ic,vbe:t.vbe,vce:t.vce}))}:null;},
  pins(label){const p=D.parts.find(x=>x.label===label);if(!p)return null;const A=A0;return gpins(p).map(q=>{const on=inb(q.r,q.c);return{id:q.id,name:q.name,r:q.r,c:q.c,net:on?A.find(A.sid(q.r,q.c)):null};});},
  netV(label,pin){const p=D.parts.find(x=>x.label===label);const q=p&&A0.pins.find(x=>x.part===p&&x.id===pin);return q&&SIM?SIM.netV.get(q.net):null;},
  linkInfo(){return D.links.map(l=>{const g=linkGeom(l);return{text:linkText(l),start:g&&g.start,end:g&&g.end,endPin:g&&g.endPin?pinLabel(g.endPin):null,bridges:g?g.bridges.length:0};});},
  selectLink(i){const l=D.links[i];ui.selLink=l?l.id:null;renderLinks();draw();status();return statusText();},
  reveal(r,c){const sc=$('#scroll'),[vx,vy]=toScreen(hx(c),hy(r));sc.scrollTo(vx-sc.clientWidth/2,vy-sc.clientHeight/2);const rc=cv.getBoundingClientRect();return{x:rc.left+vx,y:rc.top+vy};},
  customParts(){return JSON.parse(JSON.stringify(D.customParts||{}));},
  addPart(def){const problems=validatePartDef(def);if(hasErrors(problems))return{type:null,problems};return{type:editorHost.save(null,def),problems};},
  openEditor(type){openEditor(editorHost,type?{type}:{});},
  slider(label,key,v){const p=D.parts.find(x=>x.label===label);return !!p&&setSlider(p,key,v);},
  version:__APP_VERSION__
};
function statusText(){return $('#status').textContent;}

/* ---------- Indulás ---------- */
(function init(){
  let d=null;try{const s=localStorage.getItem(STORE_KEY);if(s)d=normalize(JSON.parse(s));}catch(e){d=null;}
  D=d||presetMacropad();syncDefs(D.customParts);
  boardUI();
  A0=analyze(false);AS=A0;setView('comp');renderLeft();recompute();
  // kezdeti nagyítás a szélességhez
  const sc=$('#scroll');const fit=(sc.clientWidth-2*M)/(D.board.cols*14);ui.zoom=Math.max(0.8,Math.min(1.6,Math.floor(fit*5)/5||1));resize();
  window.addEventListener('resize',()=>draw());
})();
