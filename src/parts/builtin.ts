import type { PartDef } from '../core/schema';

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
   controls szimuláció közbeni vezérlés: press = lenyomva a megadott lábpárok összeérnek. */
const PICO_TABLE: Record<string, readonly [string, string]> = {};for(const k in PICO_NAMES)PICO_TABLE[k]=[PICO_NAMES[k],picoRole(PICO_NAMES[k])];
const TO92: Array<[number, number]> =Array.from({length:13},(_,k)=>{const a=Math.PI*k/12;return[+(0.35-1.25*Math.sin(a)).toFixed(3),+(1+1.45*Math.cos(a)).toFixed(3)];});
export const PARTS: Record<string, PartDef> = {
  pico:{name:'Raspberry Pi Pico W',fp:'2×20 láb, sortáv 6',prefix:'PICO',cat:'Vezérlő',
    params:[{key:'span',label:'Sortáv',type:'select',default:6,geo:true,options:[{v:6,label:'6 osztás (0 → 6)'},{v:7,label:'7 osztás (0 → 7)'}],help:'Adatlap: 17,78 mm a két lábsor között (= 7 osztás). Vonalzóval ellenőrizhető.'}],
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
    model:[{el:'source',p:'+',n:'-',v:'{volt}',rint:0.1}]}
};
