// template.html + data.js 에서 7곳만 뽑아 index.html 한 파일로 합칩니다. (node build.js)
const fs=require("fs"),path=require("path");
global.window={};require(path.join(__dirname,"data.js"));const D=window.DATA;
const IDS=["2470","3778","2992","2460","2480","941","2636"];
const L=Object.fromEntries(D.location.rows.map(r=>[r[0],Object.fromEntries(D.location.headers.map((h,i)=>[h,r[i]]))]));
const G=Object.fromEntries(D.general.rows.map(r=>[r[0],Object.fromEntries(D.general.headers.map((h,i)=>[h,r[i]]))]));
const stops=IDS.map(id=>({id,name:L[id]["장소명"],lat:+L[id]["위도"],lon:+L[id]["경도"],addr:L[id]["위치"],
 cat:G[id]["분류"],dir:G[id]["디렉토리1"],title:G[id]["제목"],text:G[id]["내용"],url:L[id]["데이터 상세보기 URL"]}));
const json=JSON.stringify(stops).replace(/</g,"\\u003c");
const t=fs.readFileSync(path.join(__dirname,"template.html"),"utf8");
fs.writeFileSync(path.join(__dirname,"index.html"),t.replace("/*STOPS*/","const STOPS="+json+";"));
console.log("index.html 생성:",stops.map(s=>s.name).join(", "));
