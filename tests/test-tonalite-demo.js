const KMAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],KMIN=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function corr(a,b){let ma=0,mb=0;for(let i=0;i<12;i++){ma+=a[i];mb+=b[i]}ma/=12;mb/=12;let s=0,sa=0,sb=0;for(let i=0;i<12;i++){const x=a[i]-ma,y=b[i]-mb;s+=x*y;sa+=x*x;sb+=y*y}return s/Math.sqrt(sa*sb)}
function rank(h){const o=[];for(let t=0;t<12;t++){const r=h.map((_,i)=>h[(i+t)%12]);o.push([t,'maj',corr(r,KMAJ)],[t,'min',corr(r,KMIN)])}return o.sort((a,b)=>b[2]-a[2])}
const pc={D:2,G:7,B:11,A:9,E:4};
const first=[['D',1],['G',2],['B',.5],['G',.5],['B',2],['A',1],['G',2],['E',1],['D',2],['D',1]];
let h=new Array(12).fill(0),v=0;for(const [n,b] of first){h[pc[n]]+=b*0.714;v+=b*.714; }
console.log(v.toFixed(1),rank(h).slice(0,3));
