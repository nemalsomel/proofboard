import type { LogicReg, PartDef } from '../core/schema';

/** Raspberry Pi Pico W lábkiosztás (fizikai lábszám → név). */
export const PICO_NAMES: Record<number, string> = {1:'GP0',2:'GP1',3:'GND',4:'GP2',5:'GP3',6:'GP4',7:'GP5',8:'GND',9:'GP6',10:'GP7',11:'GP8',12:'GP9',13:'GND',14:'GP10',15:'GP11',16:'GP12',17:'GP13',18:'GND',19:'GP14',20:'GP15',21:'GP16',22:'GP17',23:'GND',24:'GP18',25:'GP19',26:'GP20',27:'GP21',28:'GND',29:'GP22',30:'RUN',31:'GP26',32:'GP27',33:'AGND',34:'GP28',35:'ADC_VREF',36:'3V3',37:'3V3_EN',38:'GND',39:'VSYS',40:'VBUS'};
export const picoRole = (n: string): string =>n==='GND'||n==='AGND'?'gnd':n==='3V3'?'p33':(n==='VBUS'||n==='VSYS')?'pwr':/^GP\d/.test(n)?'gpio':'misc';
/** LED-színek: kijelzés és nyitófeszültség. */
export const LEDC: Record<string, { vf: number; c: string; l: string }> = {red:{vf:2.0,c:'#e03131',l:'piros'},orange:{vf:2.0,c:'#fd7e14',l:'narancs'},yellow:{vf:2.1,c:'#f2b705',l:'sárga'},green:{vf:2.2,c:'#2f9e44',l:'zöld'},blue:{vf:3.0,c:'#1c7ed6',l:'kék'},violet:{vf:3.2,c:'#9c36b5',l:'lila'},white:{vf:3.0,c:'#f1f3f5',l:'fehér'}};

/* ---------- Alkatrész-leírások (adat) ----------
   pins     lábak: id, név, lokális sor:oszlop (lr:lc), szerep. "repeat" ismétlés i-vel; pinTable: név/szerep táblából.
   groups   gyárilag összekötött lábak (pl. gomb A1–A2).
   params   beállítások: value (SI-érték mértékegységgel), number, int, select, color, span (2. láb helye).
   graphics rajzelemek rétegekben: body (körvonal, röntgenben is), detail (díszítés), label (felirat),
            lead (láb, drót – mindig), xray (csak röntgenben). Alakok: rect, circle, poly, line, text,
            axial (test két láb között), radial (LED-test), link (drótátkötés).
   model    villamos elemek: resistor, diode, source, nmos, pico. A lábak azonosítóival hivatkoznak.
   controls szimuláció közbeni vezérlés: press = lenyomva a megadott lábpárok összeérnek,
            slider = csúszka a szimulációs panelen egy számparaméterhez.
   Szerepek: gnd föld, vin tápbemenet (vmin/vmax: megengedett feszültség a saját GND-hez),
            sig jel, adc analóg kimenet (csak ADC-képes GPIO-ra, caps:['adc']), chg/pout akku- és tápkimenet. */
/** Analóg mérésre alkalmas GPIO-k (ADC0–ADC2). */
export const PICO_ADC = new Set(['GP26', 'GP27', 'GP28']);
const PICO_TABLE: Record<string, readonly [string, string] | readonly [string, string, readonly string[]]> = {};
for(const k in PICO_NAMES){const n=PICO_NAMES[k];PICO_TABLE[k]=PICO_ADC.has(n)?[n,picoRole(n),['adc']]:[n,picoRole(n)];}
const TO92: Array<[number, number]> =Array.from({length:13},(_,k)=>{const a=Math.PI*k/12;return[+(0.35-1.25*Math.sin(a)).toFixed(3),+(1+1.45*Math.cos(a)).toFixed(3)];});
/**
 * DIP-tok (felülnézet, a bevágás balra): az 1. láb lent balra, a számozás az óramutatóval ellentétesen;
 * a két lábsor 3 osztásra (7,62 mm) van. A lábnevek befelé, a testre kerülnek.
 */
function dip(n: number, name: string, fp: string, names: string[], roleOf: (nm: string) => string, outs: Array<[string, string] | [string, string, string]>, help: string, regs: LogicReg[] = []): PartDef {
  const h = n / 2;
  return {
    name, fp, prefix: 'U', cat: 'Logika',
    pins: names.map((nm, i) => {
      const k = i + 1, lr = k <= h ? 3 : 0, lc = k <= h ? k - 1 : n - k;
      const role = roleOf(nm);
      return role === 'vin' ? { id: String(k), name: nm, lr, lc, role, vmin: 2, vmax: 6 } : { id: String(k), name: nm, lr, lc, role };
    }),
    bounds: { r: [-0.4, 3.4], c: [-0.6, h - 0.4] },
    graphics: [
      { shape: 'rect', layer: 'body', r: [0.45, 2.55], c: [-0.6, h - 0.4], fill: '#202124', stroke: '#000', width: 1.2, xray: { stroke: '#333' } },
      { shape: 'circle', layer: 'detail', at: [1.5, -0.6], rad: 0.32, fill: '#3c3f44' },
      { shape: 'circle', layer: 'detail', at: [2.15, -0.1], rad: 0.1, fill: '#9aa0a6' },
      { shape: 'text', layer: 'detail', at: [1.5, (h - 1) / 2], text: '{label} · ' + name.split(' ')[0], size: 0.42, min: 7, color: '#c8ccd0', xray: { color: '#1d231f' } },
    ],
    pinLabels: { mode: 'name', off: 0.62, side: 'in', minP: 15, colors: { sig: '#dee2e6', out: '#ffd8a8', vin: '#ffc9d6', gnd: '#adb5bd' } },
    model: [{ el: 'logic', vcc: String(names.indexOf('VCC') + 1), gnd: String(names.indexOf('GND') + 1), outs: outs.map(([o, expr, oe]) => ({ pin: String(names.indexOf(o) + 1), expr, ...(oe ? { oe } : {}) })), ...(regs.length ? { regs } : {}), rout: 50 }],
    meta: { help },
  };
}
const hcRole = (outs: string[]) => (nm: string) => (nm === 'VCC' ? 'vin' : nm === 'GND' ? 'gnd' : outs.includes(nm) ? 'out' : 'sig');
const N00 = ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'];
const O00 = ['1Y', '2Y', '3Y', '4Y'];
const N139 = ['1E', '1A0', '1A1', '1Y0', '1Y1', '1Y2', '1Y3', 'GND', '2Y3', '2Y2', '2Y1', '2Y0', '2A1', '2A0', '2E', 'VCC'];
const O139 = ['1Y0', '1Y1', '1Y2', '1Y3', '2Y0', '2Y1', '2Y2', '2Y3'];
const N74 = ['1CLR', '1D', '1CLK', '1PRE', '1Q', '1Qn', 'GND', '2Qn', '2Q', '2PRE', '2CLK', '2D', '2CLR', 'VCC'];
const O74 = ['1Q', '1Qn', '2Q', '2Qn'];
/** 74HC74: két D tároló felfutó élre, aktív alacsony aszinkron törléssel (CLR) és beállítással (PRE). */
const ff = (g: string): LogicReg => ({ name: 'F' + g, clk: `${g}CLK`, d: `${g}D`, reset: `!${g}CLR`, set: `!${g}PRE` });
const N595 = ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', 'QHs', 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'];
const O595 = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'QHs'];
/** 74HC595: 8 bites léptetőregiszter (S0…S7, SRCLK) és tárolóregiszter (R0…R7, RCLK); QH' (itt QHs) a soros kimenet. */
const R595: LogicReg[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ name: 'S' + i, clk: 'SRCLK', d: i ? 'S' + (i - 1) : 'SER', reset: '!SRCLR' })),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ name: 'R' + i, clk: 'RCLK', d: 'S' + i })),
];
/** 74HC139 kimenetei: aktív alacsony, aktív alacsony engedélyezés (E). */
const dec = (g: string) => [0, 1, 2, 3].map(k => [`${g}Y${k}`, `!(!${g}E & ${k & 2 ? '' : '!'}${g}A1 & ${k & 1 ? '' : '!'}${g}A0)`] as [string, string]);

export const PARTS: Record<string, PartDef> = {
  pico:{name:'Raspberry Pi Pico W',fp:'2×20 láb, sortáv 6',prefix:'PICO',cat:'Vezérlő',
    params:[{key:'span',label:'Sortáv (osztás)',type:'int',default:6,min:3,max:16,step:1,geo:true,help:'A két lábsor távolsága lyukban (0 → {span}). Adatlap szerint 17,78 mm = 7 osztás, de tüskesorral, foglalatban vagy adapterlapon más is lehet (pl. 6 vagy 8). Vonalzóval mérd le a sajátodat.'}],
    pinTable:PICO_TABLE,
    pins:[{repeat:20,id:'{40-i}',lr:0,lc:'{i}'},{repeat:20,id:'{1+i}',lr:'{span}',lc:'{i}'}],
    groups:[['3','8','13','18','23','28','33','38']],
    bounds:{r:[-0.75,'{span}+0.75'],c:[-1.45,19.6]},
    graphics:[
      {shape:'rect',layer:'body',r:[-0.75,'{span}+0.75'],c:[-0.6,19.6],fill:'#1f6b4a',stroke:'#134a33',width:1.5,xray:{stroke:'#1f6b4a'}},
      {shape:'rect',layer:'detail',r:['{span}/2-1.1','{span}/2+1.1'],c:[-1.45,-0.15],fill:'#b5bcc3',xray:{fill:null,stroke:'#6b7a72',dash:true}},
      {shape:'rect',layer:'detail',r:['{span}/2-1.3','{span}/2+1.3'],c:[7.6,10.2],fill:'#1b1b1b'},
      {shape:'rect',layer:'detail',r:[0.9,'{span}-0.9'],c:[13.4,18.4],fill:'#c3c8cd'},
      {shape:'text',layer:'detail',at:['{span}/2',4.6],text:'Pico W',size:0.6,min:8,color:'#e8f3ec'},
      {shape:'text',layer:'detail',at:['{span}/2',11.6],text:'{label}',size:0.42,color:'#bfe0cd'},
      {shape:'text',layer:'xray',at:['{span}/2',-1.0],text:'USB',size:0.4,color:'#4d5a52'},
      {shape:'text',layer:'xray',at:['{span}/2',9.5],text:'{label} · Pico W',size:0.55,min:8,color:'#1f6b4a'}],
    pinLabels:{mode:'name',inward:true,onBody:true,minP:13,rename:{ADC_VREF:'VREF'}},
    model:[{el:'pico',gnd:'38',vbus:'40',vsys:'39',v33:'36'}]},
  button:{name:'Nyomógomb 12 mm',fp:'A 0:0, 0:5 · B 2:0, 2:5',prefix:'S',cat:'Bemenet',
    pins:[{id:'A1',lr:0,lc:0,role:'A'},{id:'A2',lr:0,lc:5,role:'A'},{id:'B1',lr:2,lc:0,role:'B'},{id:'B2',lr:2,lc:5,role:'B'}],
    groups:[['A1','A2'],['B1','B2']],
    bounds:{r:[-1.36,3.36],c:[-0.3,5.3]},
    controls:[{kind:'press',closes:[['A1','B1']]}],
    graphics:[
      {shape:'line',layer:'lead',from:[0,0],to:[0,0.7],width:0.14},{shape:'line',layer:'lead',from:[0,5],to:[0,4.3],width:0.14},
      {shape:'line',layer:'lead',from:[2,0],to:[2,0.7],width:0.14},{shape:'line',layer:'lead',from:[2,5],to:[2,4.3],width:0.14},
      {shape:'rect',layer:'body',r:[-1.36,3.36],c:[0.14,4.86],fill:'#2a2a2a',stroke:'#111',width:1,xray:{stroke:'#333'}},
      {shape:'rect',layer:'detail',r:[-1,3],c:[0.5,4.5],fill:'#9aa3ab'},
      {shape:'circle',layer:'detail',at:[1,2.5],rad:1.35,fill:'#141414',pressed:{fill:'#4a4a4a',stroke:'accent',width:3},xray:{fill:null,stroke:'rgba(0,0,0,.4)',width:1.2,pressed:{stroke:'accent',width:3}}},
      {shape:'text',layer:'detail',at:[1,2.5],text:'{label}',size:0.62,min:8,color:'#f1f3f5',pressed:{color:'#ffd8bf'},xray:{color:'#1d231f',pressed:{color:'#c2410c'}}}],
    pinLabels:{mode:'role',off:0.62,colors:{A:'#1d4ed8',B:'#b45309'}}},
  res:{name:'Ellenállás',fp:'0:0 – 0:4 (állítható)',prefix:'R',cat:'Passzív',
    params:[{key:'ohm',label:'Érték',type:'value',unit:'Ω',default:1000,min:0.01,max:1e9,series:'E12'},
            {key:'span',label:'2. láb helye',type:'span',default:[0,4],help:'Az első lábhoz képest (forgatás előtt). Alap: 0:4. Nagyobb távolsággal a láb maga is áthidalhat.'}],
    pins:[{id:'1',lr:0,lc:0,role:'r'},{id:'2',lr:'{dr}',lc:'{dc}',role:'r'}],
    bounds:{pad:0.45},
    graphics:[{shape:'axial',layer:'body',from:'1',to:'2',len:2.3,w:0.76,fill:'#d9bf8c',stroke:'#8a6d3b',bands:'{ohm}'},
              {shape:'text',layer:'label',between:['1','2'],perp:0.95,text:'{label} {ohm|si}Ω',size:0.42}],
    model:[{el:'resistor',a:'1',b:'2',ohm:'{ohm}'}]},
  jumper:{name:'Átkötő huzal (0 Ω)',fp:'0:0 – 0:2 (állítható)',prefix:'JP',cat:'Passzív',
    params:[{key:'span',label:'2. vég helye',type:'span',default:[0,2],help:'Egyenes drótátkötés az alkatrészoldalon: a két vége egy hálózat.'}],
    pins:[{id:'1',lr:0,lc:0,role:'j'},{id:'2',lr:'{dr}',lc:'{dc}',role:'j'}],
    groups:[['1','2']],
    bounds:{pad:0.4},
    graphics:[{shape:'link',layer:'lead',from:'1',to:'2',width:0.22,stroke:'#b8bec4',edge:'#5f676e'},
              {shape:'text',layer:'label',between:['1','2'],perp:0.75,text:'{label}',size:0.38}]},
  led:{name:'LED 3 mm',fp:'anód 0:0 · katód 0:1 (állítható)',prefix:'LED',cat:'Félvezető',
    params:[{key:'color',label:'Szín',type:'color',default:'red',options:Object.entries(LEDC).map(([k,v])=>({v:k,label:v.l,hex:v.c,vf:v.vf})),help:'{color.label}, nyitófeszültség {color.vf} V'},
            {key:'span',label:'Katód helye',type:'span',default:[0,1],help:'Az anódhoz képest (forgatás előtt). Alap: 0:1.'}],
    pins:[{id:'A',name:'anód +',lr:0,lc:0,role:'an'},{id:'K',name:'katód −',lr:'{dr}',lc:'{dc}',role:'ka'}],
    bounds:{pad:0.3,mid:0.7},
    graphics:[{shape:'radial',layer:'body',from:'A',to:'K',rad:0.62,fill:'{color.hex}',glow:true},
              {shape:'text',layer:'label',between:['A','K'],perp:1.15,text:'{label}',size:0.42}],
    pinLabels:{mode:'sign',off:0.72,plus:['an']},
    model:[{el:'diode',a:'A',k:'K',vf:'{color.vf}',ron:15,light:true}]},
  diode:{name:'Dióda',fp:'anód 0:0 · katód 0:4 (állítható)',prefix:'D',cat:'Félvezető',
    params:[{key:'kind',label:'Típus',type:'select',default:'1N5817',options:[
              {v:'1N5817',label:'1N5817 Schottky (0,3 V, 1 A)',vf:0.3,ron:0.15,imax:1},
              {v:'1N4148',label:'1N4148 jeldióda (0,7 V, 0,2 A)',vf:0.7,ron:2,imax:0.2},
              {v:'1N4007',label:'1N4007 egyenirányító (0,7 V, 1 A)',vf:0.7,ron:0.3,imax:1}],
             help:'Csak anódtól katód felé vezet, {kind.vf} V nyitófeszültség felett. A csík a katód oldalán van.'},
            {key:'span',label:'Katód helye',type:'span',default:[0,4],help:'Az anódhoz képest (forgatás előtt). Alap: 0:4.'}],
    pins:[{id:'A',name:'anód',lr:0,lc:0,role:'an'},{id:'K',name:'katód',lr:'{dr}',lc:'{dc}',role:'ka'}],
    bounds:{pad:0.45},
    graphics:[{shape:'axial',layer:'body',from:'A',to:'K',len:1.7,w:0.62,fill:'#262626',stroke:'#000',stripe:{at:0.8,color:'#d0d4d8'}},
              {shape:'text',layer:'label',between:['A','K'],perp:-0.95,text:'{label} {kind}',size:0.36}],
    pinLabels:{mode:'sign',off:0.72,plus:['an'],plusText:'A',minusText:'K'},
    model:[{el:'diode',a:'A',k:'K',vf:'{kind.vf}',ron:'{kind.ron}',imax:'{kind.imax}'}]},
  nmos:{name:'N-MOSFET (2N7000)',fp:'S 0:0 · G 0:1 · D 0:2 (TO-92)',prefix:'Q',cat:'Félvezető',
    params:[{key:'vth',label:'Küszöb (Vth)',type:'value',unit:'V',default:2.1,min:0.2,max:10,step:0.1,help:'A D–S akkor vezet, ha a gate a source-hoz képest ennél magasabb.'},
            {key:'ron',label:'Nyitott ellenállás',type:'value',unit:'Ω',default:5,min:0.001,max:1e4,series:'E12'},
            {key:'imax',label:'Max. áram',type:'value',unit:'A',default:0.2,min:0.001,max:200,series:'E12'}],
    pins:[{id:'S',name:'S',lr:0,lc:0,role:'s'},{id:'G',name:'G',lr:0,lc:1,role:'g'},{id:'D',name:'D',lr:0,lc:2,role:'d'}],
    bounds:{r:[-0.95,0.5],c:[-0.5,2.5]},
    graphics:[{shape:'poly',layer:'body',pts:TO92,fill:'#1d1d1d',stroke:'#000',width:1,xray:{stroke:'#333'}},
              {shape:'text',layer:'label',at:[-1.35,1],text:'{label}',size:0.4}],
    pinLabels:{mode:'name',off:0.78,colors:{s:'#1f2328',g:'#1d4ed8',d:'#5c666e'}},
    model:[{el:'nmos',d:'D',g:'G',s:'S',vth:'{vth}',ron:'{ron}',imax:'{imax}'}]},
  cap:{name:'Kondenzátor (kerámia)',fp:'0:0 – 0:1 (állítható)',prefix:'C',cat:'Passzív',
    params:[{key:'f',label:'Kapacitás',type:'value',unit:'F',default:100e-9,min:1e-12,max:1,series:'E12',help:'Egyenáramon szakadás. A szimuláció a feszültséget és az időállandót (τ = R·C) mutatja.'},
            {key:'volt',label:'Névleges feszültség',type:'value',unit:'V',default:50,min:1,max:1000,step:1},
            {key:'span',label:'2. láb helye',type:'span',default:[0,1],help:'Az első lábhoz képest (forgatás előtt). Alap: 0:1.'}],
    pins:[{id:'1',lr:0,lc:0,role:'c'},{id:'2',lr:'{dr}',lc:'{dc}',role:'c'}],
    bounds:{pad:0.3,mid:0.6},
    graphics:[{shape:'radial',layer:'body',from:'1',to:'2',rad:0.55,fill:'#d9902f'},
              {shape:'text',layer:'label',between:['1','2'],perp:1.05,text:'{label} {f|si}F',size:0.4}],
    model:[{el:'capacitor',a:'1',b:'2',f:'{f}',vmax:'{volt}'}]},
  elko:{name:'Elektrolit kondenzátor',fp:'+ 0:0 · − 0:1 (állítható)',prefix:'C',cat:'Passzív',
    params:[{key:'f',label:'Kapacitás',type:'value',unit:'F',default:10e-6,min:1e-7,max:1,series:'E12',help:'Polaritásos: a + láb kerüljön a magasabb feszültségre. A csík a − láb oldalán van.'},
            {key:'volt',label:'Névleges feszültség',type:'value',unit:'V',default:16,min:1,max:500,step:1},
            {key:'span',label:'− láb helye',type:'span',default:[0,1],help:'A + lábhoz képest (forgatás előtt). Alap: 0:1.'}],
    pins:[{id:'+',name:'+',lr:0,lc:0,role:'cp'},{id:'-',name:'−',lr:'{dr}',lc:'{dc}',role:'cn'}],
    bounds:{pad:0.45,mid:1},
    graphics:[{shape:'radial',layer:'body',from:'+',to:'-',rad:0.95,fill:'#1d3f8f'},
              {shape:'text',layer:'label',between:['+','-'],perp:1.5,text:'{label} {f|si}F {volt|fix1}V',size:0.38}],
    pinLabels:{mode:'sign',off:0.72,plus:['cp']},
    model:[{el:'capacitor',a:'+',b:'-',f:'{f}',vmax:'{volt}',polar:true}]},
  npn:{name:'NPN tranzisztor',fp:'TO-92, lábsorrend típus szerint',prefix:'Q',cat:'Félvezető',
    params:[{key:'kind',label:'Típus',type:'select',default:'BC547',geo:true,options:[
              {v:'BC547',label:'BC547 (C-B-E, 100 mA)',beta:200,imax:0.1,pc:0,pb:1,pe:2},
              {v:'2N3904',label:'2N3904 (E-B-C, 200 mA)',beta:150,imax:0.2,pc:2,pb:1,pe:0},
              {v:'2N2222',label:'2N2222A (E-B-C, 600 mA)',beta:150,imax:0.6,pc:2,pb:1,pe:0}],
             help:'A C–E akkor vezet, ha a bázison áram folyik (Ube ≈ 0,65 V). Ic legfeljebb β·Ib ({kind.beta}·Ib); kapcsolóként kb. tízszer annyi bázisáram kell, mint Ic/β.'}],
    pins:[{id:'C',name:'C',lr:0,lc:'{kind.pc}',role:'col'},{id:'B',name:'B',lr:0,lc:'{kind.pb}',role:'base'},{id:'E',name:'E',lr:0,lc:'{kind.pe}',role:'emit'}],
    bounds:{r:[-0.95,0.5],c:[-0.5,2.5]},
    graphics:[{shape:'poly',layer:'body',pts:TO92,fill:'#1d1d1d',stroke:'#000',width:1,xray:{stroke:'#333'}},
              {shape:'text',layer:'label',at:[-1.35,1],text:'{label} {kind}',size:0.36}],
    pinLabels:{mode:'name',off:0.78,colors:{col:'#5c666e',base:'#1d4ed8',emit:'#1f2328'}},
    model:[{el:'npn',c:'C',b:'B',e:'E',beta:'{kind.beta}',vbe:0.65,vcesat:0.1,imax:'{kind.imax}'}]},
  hc00:dip(14,'74HC00 négy NAND kapu','DIP-14 · 4× NAND',N00,hcRole(O00),O00.map(o=>[o,`!(${o[0]}A & ${o[0]}B)`] as [string,string]),'Négy kétbemenetes NAND kapu (nY = NEM(nA ÉS nB)). Táp 2–6 V; a nem használt bemeneteket kösd GND-re.'),
  hc74:dip(14,'74HC74 kettős D tároló','DIP-14 · 2× D flip-flop',N74,hcRole(O74),[['1Q','F1'],['1Qn','!F1'],['2Q','F2'],['2Qn','!F2']],'Két D tároló: a CLK felfutó élén Q felveszi D értékét. CLR = 0 törli (Q = 0), PRE = 0 beállítja (Q = 1), az órajeltől függetlenül; használat közben mindkettőt kösd VCC-re. Qn a Q negáltja. Táp 2–6 V.',[ff('1'),ff('2')]),
  hc595:dip(16,'74HC595 léptetőregiszter','DIP-16 · 8 bit SIPO',N595,hcRole(O595),[...['QA','QB','QC','QD','QE','QF','QG','QH'].map((o,i)=>[o,'R'+i,'!OE'] as [string,string,string]),['QHs','S7']],'8 bites soros-párhuzamos átalakító: SRCLK felfutó élén a SER bit belép, a többi eggyel továbblép; RCLK felfutó élén a 8 bit a QA…QH kimenetekre kerül. OE = 0 engedélyezi a kimeneteket, SRCLR = 0 törli a léptetőregisztert. QHs (QH\') a következő 595 SER bemenetére köthető. Táp 2–6 V.',R595),
  hc139:dip(16,'74HC139 kettős 2→4 dekóder','DIP-16 · 2× (2→4)',N139,hcRole(O139),[...dec('1'),...dec('2')],'Két 2→4 dekóder: az A1 A0 bináris szám szerinti Y kimenet lesz 0 (aktív alacsony), a többi 1; ha E = 1, mind 1. Táp 2–6 V.'),
  motor:{name:'DC motor (130-as)',fp:'külső · + és − kivezetés',prefix:'M',cat:'Külső',mount:'off',
    params:[{key:'vnom',label:'Névleges feszültség',type:'value',unit:'V',default:3,min:1,max:24,step:0.5,help:'A motor a panel mellett áll; a kivezetéseit vezetékkel (kábellel) kösd a panelra. Induktív terhelés: GPIO-ról közvetlenül nem hajtható, tranzisztor vagy MOSFET és visszacsapó dióda kell.'},
            {key:'ohm',label:'Üzemi ellenállás',type:'value',unit:'Ω',default:20,min:0.5,max:1000,series:'E12',help:'Egyszerűsített modell: forgás közbeni áramfelvétel ≈ U / R. A fordulat a feszültséggel arányos.'}],
    pins:[{id:'+',name:'+',lr:0,lc:0,role:'mp'},{id:'-',name:'−',lr:0,lc:2,role:'mn'}],
    bounds:{r:[-5.9,0.5],c:[-1.8,3.8]},
    graphics:[
      {shape:'line',layer:'lead',from:'+',to:[-1.2,0.4],width:0.12,stroke:'#b87333'},{shape:'line',layer:'lead',from:'-',to:[-1.2,1.6],width:0.12,stroke:'#b87333'},
      {shape:'circle',layer:'body',at:[-3,1],rad:2.7,fill:'#b8bec4',stroke:'#6c757d',width:1.4,xray:{stroke:'#6c757d'}},
      {shape:'circle',layer:'detail',at:[-3,1],rad:2.1,fill:'#ced4da'},
      {shape:'dial',layer:'detail',at:[-3,1],rad:1.7,color:'#495057'},
      {shape:'circle',layer:'detail',at:[-3,1],rad:0.35,fill:'#343a40'},
      {shape:'text',layer:'label',at:[-6.4,1],text:'{label} {vnom|fix1}V',size:0.42}],
    pinLabels:{mode:'sign',off:0.75,plus:['mp']},
    model:[{el:'motor',a:'+',b:'-',ohm:'{ohm}',vnom:'{vnom}'}]},
  servo:{name:'Szervó (SG90)',fp:'külső · GND, V+, jel kábel',prefix:'SV',cat:'Külső',mount:'off',
    params:[{key:'ohm',label:'Áramfelvétel (ell.)',type:'value',unit:'Ω',default:100,min:5,max:10000,series:'E12',help:'A szervót a jelvezetéken érkező PWM vezérli: 50 Hz, 0,5–2,5 ms impulzus → 0–180°. A Pico GPIO-ján állítsd PWM módba (50 Hz, 7,5 % = középállás). Táp: 4,8–6 V.'}],
    pins:[{id:'GND',lr:0,lc:0,role:'gnd'},{id:'V+',lr:0,lc:1,role:'vin',vmin:4.5,vmax:6.5},{id:'SIG',lr:0,lc:2,role:'sig'}],
    bounds:{r:[-12.2,0.5],c:[-1.6,3.6]},
    graphics:[
      {shape:'line',layer:'lead',from:'GND',to:[-2.6,0.6],width:0.14,stroke:'#7b4b2a'},{shape:'line',layer:'lead',from:'V+',to:[-2.6,1],width:0.14,stroke:'#e03131'},
      {shape:'line',layer:'lead',from:'SIG',to:[-2.6,1.4],width:0.14,stroke:'#f08c00'},
      {shape:'rect',layer:'body',r:[-11.4,-2.6],c:[-0.9,2.9],fill:'#1c5bbf',stroke:'#0f3a80',width:1.2,xray:{stroke:'#1c5bbf'}},
      {shape:'rect',layer:'detail',r:[-12.2,-11.4],c:[-1.6,3.6],fill:'#1c5bbf',stroke:'#0f3a80'},
      {shape:'rect',layer:'detail',r:[-2.6,-1.8],c:[-1.6,3.6],fill:'#1c5bbf',stroke:'#0f3a80'},
      {shape:'circle',layer:'detail',at:[-9.2,1],rad:1.1,fill:'#e9ecef',stroke:'#adb5bd'},
      {shape:'dial',layer:'detail',at:[-9.2,1],rad:3.2,color:'#f8f9fa',width:0.55},
      {shape:'text',layer:'detail',at:[-5.4,1],text:'SG90',size:0.55,min:7,color:'#dbe7ff'},
      {shape:'text',layer:'label',at:[1.3,1],text:'{label}',size:0.42},
      {shape:'text',layer:'xray',at:[-6.5,1],text:'{label} · SG90',size:0.5,min:8,color:'#1c5bbf'}],
    pinLabels:{mode:'name',off:-0.75,colors:{gnd:'#5c3a1e',vin:'#c92a2a',sig:'#d9480f'}},
    model:[{el:'servo',vp:'V+',gnd:'GND',sig:'SIG',ohm:'{ohm}',pmin:0.5,pmax:2.5}]},
  header:{name:'Tüskesor 1×N',fp:'N láb egy sorban',prefix:'J',cat:'Csatlakozó',
    params:[{key:'n',label:'Lábszám',type:'int',default:4,min:1,max:20,geo:true}],
    pins:[{repeat:'{n}',id:'{i+1}',lr:0,lc:'{i}',role:'h'}],
    bounds:{r:[-0.5,0.5],c:[-0.5,'{n}-0.5']},
    graphics:[{shape:'rect',layer:'body',r:[-0.5,0.5],c:[-0.5,'{n}-0.5'],fill:'#1d1d1d',stroke:'#000',width:1},
              {shape:'text',layer:'label',at:[-0.95,'({n}-1)/2'],text:'{label}',size:0.42}]},
  bat:{name:'Akku csatlakozó',fp:'+ 0:0 · − 0:1',prefix:'BAT',cat:'Csatlakozó',
    params:[{key:'volt',label:'Feszültség',type:'value',unit:'V',default:3.7,min:0.5,max:48,step:0.1}],
    pins:[{id:'+',name:'+',lr:0,lc:0,role:'bp'},{id:'-',name:'−',lr:0,lc:1,role:'bn'}],
    bounds:{r:[-1.3,0.5],c:[-0.6,1.6]},
    graphics:[{shape:'rect',layer:'body',r:[-1.25,0.45],c:[-0.55,1.55],fill:'#f4f1e8',stroke:'#7d7563',width:1.2},
              {shape:'text',layer:'label',at:[-0.75,0.5],text:'{label} {volt|fix1}V',size:0.38}],
    pinLabels:{mode:'sign',off:0.72,plus:['bp']},
    model:[{el:'source',p:'+',n:'-',v:'{volt}',rint:0.1}]},
  tp4056:{name:'TP4056 töltőmodul',fp:'IN 0:0, 0:6 · OUT/B 9:0…9:6 (közelítő)',prefix:'U',cat:'Modul',
    params:[{key:'usb',label:'Saját USB',type:'select',default:'off',options:[{v:'off',label:'nincs bedugva',volt:0,rint:1e9},{v:'on',label:'5 V bedugva',volt:5,rint:0.1}],
             help:'Egyszerűsített modell: a bemenetről (5 V) a B+ felé tölt, a B+ és az OUT+ közös. A lábak a modul forrpontjainak közelítő helyei, tüskesorral rakd fel.'}],
    pins:[{id:'IN+',lr:0,lc:0,role:'vin',vmin:4,vmax:8},{id:'IN-',lr:0,lc:6,role:'gnd'},
          {id:'OUT+',lr:9,lc:0,role:'pout'},{id:'B+',lr:9,lc:2,role:'chg'},{id:'B-',lr:9,lc:4,role:'bn'},{id:'OUT-',lr:9,lc:6,role:'gnd'}],
    groups:[['B+','OUT+'],['IN-','OUT-']],
    bounds:{r:[-1.5,9.6],c:[-0.7,6.7]},
    graphics:[
      {shape:'rect',layer:'body',r:[-0.6,9.6],c:[-0.7,6.7],fill:'#1f4f9c',stroke:'#12325f',width:1.2,xray:{stroke:'#1f4f9c'}},
      {shape:'rect',layer:'detail',r:[-1.5,1.3],c:[1.9,4.1],fill:'#c3c8cd',stroke:'#868e96',xray:{fill:null,stroke:'#6b7a72',dash:true}},
      {shape:'rect',layer:'detail',r:[3.3,5.3],c:[2.2,3.8],fill:'#1b1b1b'},
      {shape:'rect',layer:'detail',r:[6.3,7.3],c:[4.4,5.4],fill:'#1b1b1b'},
      {shape:'circle',layer:'detail',at:[2.6,5.5],rad:0.28,fill:'#a61e1e'},{shape:'circle',layer:'detail',at:[4,5.5],rad:0.28,fill:'#1c4fd1'},
      {shape:'text',layer:'detail',at:[6.2,2.2],text:'TP4056',size:0.42,min:7,color:'#dbe7ff'},
      {shape:'text',layer:'label',at:[10.4,3],text:'{label}',size:0.42},
      {shape:'text',layer:'xray',at:[4.5,3],text:'{label} · TP4056',size:0.5,min:8,color:'#1f4f9c'}],
    pinLabels:{mode:'name',off:0.7,colors:{vin:'#ffc9d6',gnd:'#e9ecef',pout:'#ffe3bf',chg:'#ffe3bf',bn:'#e9ecef'}},
    model:[{el:'source',p:'IN+',n:'IN-',v:'{usb.volt}',rint:'{usb.rint}',kind:'supply'},
           {el:'diode',a:'IN+',k:'B+',vf:0.8,ron:1},
           {el:'resistor',a:'B-',b:'OUT-',ohm:0.05}]},
  nokia5110:{name:'Nokia 5110 kijelző',fp:'8 láb egy sorban · VCC 2,7–3,3 V',prefix:'LCD',cat:'Modul',
    pins:['RST','CE','DC','DIN','CLK','VCC','BL','GND'].map((n,i)=>(n==='VCC'?{id:n,lr:0,lc:i,role:'vin',vmin:2.7,vmax:3.6}:{id:n,lr:0,lc:i,role:n==='GND'?'gnd':'sig'})),
    bounds:{r:[-1.3,15.9],c:[-4.6,11.6]},
    graphics:[
      {shape:'rect',layer:'body',r:[-1.3,15.9],c:[-4.6,11.6],fill:'#b8282d',stroke:'#7d1a1e',width:1.2,xray:{stroke:'#b8282d'}},
      {shape:'rect',layer:'detail',r:[1.4,14.4],c:[-4,11],fill:'#d7dadd',stroke:'#9aa1a8'},
      {shape:'rect',layer:'detail',r:[2.4,13.3],c:[-3.4,10.4],fill:'#8f9f86',lit:{fill:'#c6efa4'},xray:{fill:null,stroke:'#9aa1a8',dash:true}},
      {shape:'text',layer:'detail',at:[7.9,3.5],text:'NOKIA 5110',size:0.8,min:8,color:'#2b3328'},
      {shape:'text',layer:'label',at:[15.1,3.5],text:'{label}',size:0.45,color:'#ffe0e0',xray:{color:'#7d1a1e'}},
      {shape:'text',layer:'xray',at:[7.9,3.5],text:'{label} · Nokia 5110',size:0.55,min:8,color:'#b8282d'}],
    pinLabels:{mode:'name',off:-0.85,colors:{vin:'#ffd6e0',gnd:'#f1f3f5',sig:'#f8f9fa'}},
    model:[{el:'resistor',a:'VCC',b:'GND',ohm:10000},
           {el:'diode',a:'BL',k:'GND',vf:2.6,ron:60,light:true}]},
  joystick:{name:'Joystick (KY-023)',fp:'GND · +5V · VRx · VRy · SW egy sorban',prefix:'JS',cat:'Bemenet',
    params:[{key:'x',label:'X állás',type:'number',unit:'%',default:0,min:-100,max:100,step:5,help:'−100 % bal, +100 % jobb. Szimuláció közben csúszkával is állítható.'},
            {key:'y',label:'Y állás',type:'number',unit:'%',default:0,min:-100,max:100,step:5,help:'−100 % le, +100 % fel.'}],
    pins:[{id:'GND',lr:0,lc:0,role:'gnd'},{id:'5V',name:'+5V',lr:0,lc:1,role:'vin',vmin:3,vmax:5.5},
          {id:'VRX',name:'VRx',lr:0,lc:2,role:'adc'},{id:'VRY',name:'VRy',lr:0,lc:3,role:'adc'},{id:'SW',lr:0,lc:4,role:'sig'}],
    bounds:{r:[-0.8,12.6],c:[-2.6,6.6]},
    controls:[{kind:'press',closes:[['SW','GND']]},{kind:'slider',key:'x',label:'X'},{kind:'slider',key:'y',label:'Y'}],
    graphics:[
      {shape:'rect',layer:'body',r:[-0.8,12.6],c:[-2.6,6.6],fill:'#23272e',stroke:'#0f1114',width:1.2,xray:{stroke:'#333'}},
      {shape:'rect',layer:'detail',r:[3,11.4],c:[-1.9,5.9],fill:'#e9ecef',stroke:'#adb5bd'},
      {shape:'circle',layer:'detail',at:[7.2,2],rad:3,fill:'#343a40'},
      {shape:'circle',layer:'detail',at:['7.2-{y}/40','2+{x}/40'],rad:1.9,fill:'#495057',stroke:'#111',width:1.5,
       pressed:{fill:'#6c757d',stroke:'accent',width:3},xray:{fill:null,stroke:'rgba(0,0,0,.45)',width:1.2,pressed:{stroke:'accent',width:3}}},
      {shape:'text',layer:'detail',at:['7.2-{y}/40','2+{x}/40'],text:'{label}',size:0.55,min:8,color:'#f1f3f5',xray:{color:'#1d231f'}}],
    pinLabels:{mode:'name',off:0.85,colors:{gnd:'#e9ecef',vin:'#ffc9d6',adc:'#b2f2bb',sig:'#a5d8ff'}},
    model:[{el:'resistor',a:'5V',b:'VRX',ohm:'{5001-50*x}'},{el:'resistor',a:'VRX',b:'GND',ohm:'{5001+50*x}'},
           {el:'resistor',a:'5V',b:'VRY',ohm:'{5001-50*y}'},{el:'resistor',a:'VRY',b:'GND',ohm:'{5001+50*y}'}]}
};
