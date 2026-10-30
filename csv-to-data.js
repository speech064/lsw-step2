// CSV(EUC-KR) -> data.js 변환. CSV를 바꿨다면 `node csv-to-data.js` 로 다시 만드세요.
const fs=require("fs"),path=require("path");
const dir=__dirname;
function parse(t){const rows=[];let r=[],f="",q=false;for(let i=0;i<t.length;i++){const c=t[i];
 if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}
 else if(c=='"')q=true;else if(c==","){r.push(f);f=""}else if(c=="\n"){r.push(f.replace(/\r$/,""));rows.push(r);r=[];f=""}else f+=c}
 if(f||r.length){r.push(f);rows.push(r)}return rows.filter(r=>r.length>1)}
const files=fs.readdirSync(dir).filter(n=>n.endsWith(".csv"));
const pick=k=>files.find(n=>n.includes(k));
const out={};
for(const [key,k] of [["location","위치정보"],["general","일반정보"]]){
 const n=pick(k);if(!n)throw new Error(k+" CSV 없음");
 const dec=new TextDecoder("euc-kr").decode(fs.readFileSync(path.join(dir,n)));
 const [headers,...rows]=parse(dec.charCodeAt(0)===0xFEFF?dec.slice(1):dec);
 out[key]={file:n,headers,rows};
}
const json=JSON.stringify(out).replace(/</g,"\\u003c").replace(/\u2028|\u2029/g,"");
fs.writeFileSync(path.join(dir,"data.js"),"window.DATA="+json+";\n");
console.log("data.js 생성:",Object.entries(out).map(([k,v])=>k+" "+v.rows.length+"행").join(", "));
