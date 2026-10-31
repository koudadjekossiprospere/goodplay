const KMAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],KMIN=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function corr(a,b){let ma=0,mb=0;for(let i=0;i<12;i++){ma+=a[i];mb+=b[i]}ma/=12;mb/=12;let s=0,sa=0,sb=0;for(let i=0;i<12;i++){const x=a[i]-ma,y=b[i]-mb;s+=x*y;sa+=x*x;sb+=y*y}return s/Math.sqrt(sa*sb)}
const kc=(h,t,m)=>corr(h.map((_,i)=>h[(i+t)%12]),m=='maj'?KMAJ:KMIN);
const pc={D:2,G:7,B:11,A:9,E:4};
const D=[['D',1],['G',2],['B',.5],['G',.5],['B',2],['A',1],['G',2],['E',1],['D',2],['D',1],['G',2],['B',.5],['G',.5],['B',2],['A',1],['D',3]];
const h=new Array(12).fill(0);for(const[n,b]of D)h[(pc[n]+2)%12]+=b*.68; // monté de 2, ~14s
let best=[];for(let t=0;t<12;t++)for(const m of['maj','min'])best.push([t,m,kc(h,t,m)]);best.sort((a,b)=>b[2]-a[2]);
console.log('top',best[0],'G maj',kc(h,7,'maj').toFixed(3));
const full=[['D',1],['G',2],['B',.5],['G',.5],['B',2],['A',1],['G',2],['E',1],['D',2],['D',1],['G',2],['B',.5],['G',.5],['B',2],['A',1],['D',3,1],['B',1],['D',2],['B',.5],['G',.5],['B',2],['A',1],['G',2],['E',1],['D',2],['D',1],['G',2],['B',.5],['G',.5],['B',2],['A',1],['G',3,1]];
const beat=60/88;let t=0;const ev=[];for(const[n,b,f]of full){ev.push({pc:pc[n],s:t,e:t+b*beat,f});t+=b*beat}
for(let now=6;now<=t;now+=1.5){const r=new Array(12).fill(0);ev.forEach(e=>{if(e.e>now-14&&e.s<now){const d=Math.min(e.e,now)-Math.max(e.s,now-14);r[e.pc]+=d*(e.f?1.7:1)}});
let b=[];for(let k=0;k<12;k++)for(const m of['maj','min'])b.push([k,m,kc(r,k,m)]);b.sort((x,y)=>y[2]-x[2]);const g=kc(r,7,'maj');
if(!(b[0][0]==7&&b[0][1]=='maj')&&b[0][2]-g>=.15)console.log('FAUX',now.toFixed(1),b[0],g.toFixed(2))}
console.log('fin');
