// 2단계: 데이터를 파일 대신 API(공공데이터포털 odcloud)에서 불러오는 작은 서버입니다.
// 실행: node server.js  (또는 npm start)  →  http://localhost:3000
// API 키는 코드에 없고 .env.local 의 환경변수로만 읽어요. 브라우저에는 키가 가지 않고 이 서버만 키를 써요.
//   JEJU_CULTURE_INFO_KEY      제주역사문화 일반정보 API 키
//   JEJU_CULTURE_LOCATION_KEY  제주역사문화 위치정보 API 키
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- .env.local 읽기 (이미 설정된 환경변수가 있으면 그쪽이 우선) ----
function loadEnv(file) {
  let text = '';
  try { text = fs.readFileSync(path.join(__dirname, file), 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env.local');
loadEnv('.env');

const PORT = Number(process.env.PORT) || 3000;
const ODCLOUD = 'https://api.odcloud.kr/api';
const ENDPOINTS = {
  info: { env: 'JEJU_CULTURE_INFO_KEY', label: '일반정보', url: `${ODCLOUD}/15109587/v1/uddi:56c2b3a4-4b4b-46cd-a1fa-f928ef731ffb` },
  location: { env: 'JEJU_CULTURE_LOCATION_KEY', label: '위치정보', url: `${ODCLOUD}/15109570/v1/uddi:8781448b-81a8-487c-bc95-d26335bafa82` },
};

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---- odcloud 호출 (키는 메시지·로그에 절대 넣지 않음) ----
const cache = new Map(); // name -> { at, rows }
const TTL = 10 * 60 * 1000;

async function fetchAll(name) {
  const ep = ENDPOINTS[name];
  const key = (process.env[ep.env] || '').trim();
  if (!key) throw new ApiError('no-key', `${ep.label} API 키(${ep.env})가 비어 있어요. .env.local 에 값을 넣고 서버를 다시 켜 주세요.`);
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;

  const rows = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${ep.url}?page=${page}&perPage=200&returnType=JSON&serviceKey=${encodeURIComponent(key)}`;
    let res, body;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      body = await res.text();
    } catch {
      throw new ApiError('network', `${ep.label} API에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.`);
    }
    let json = null;
    try { json = JSON.parse(body); } catch { /* JSON 아님 */ }
    if (!json) throw new ApiError('bad-response', `${ep.label} API가 JSON이 아닌 응답을 줬어요 (HTTP ${res.status}).`);
    if (json.code !== undefined && json.code < 0) {
      throw new ApiError(json.code === -4 || json.code === -401 ? 'bad-key' : 'upstream',
        `${ep.label} API 오류: ${json.msg || '알 수 없는 오류'} (키가 올바른지, 활용신청이 승인됐는지 확인해 주세요).`);
    }
    if (!res.ok || !Array.isArray(json.data)) throw new ApiError('upstream', `${ep.label} API 응답이 이상해요 (HTTP ${res.status}).`);
    rows.push(...json.data);
    if (rows.length >= (json.totalCount || 0) || json.data.length === 0) break;
  }
  cache.set(name, { at: Date.now(), rows });
  return rows;
}

// ---- 두 API 결과를 데이터 고유번호로 묶기 ----
const clean = (v) => (v === undefined || v === null || v === '해당없음' ? '' : String(v));
async function places(ids) {
  const warnings = [];
  const info = await fetchAll('info'); // 없으면 전체 실패
  let loc = [];
  try { loc = await fetchAll('location'); }
  catch (e) {
    if (!(e instanceof ApiError)) throw e;
    warnings.push({ code: e.code === 'no-key' ? 'location-no-key' : 'location-failed', message: e.message + ' 주소 없이 좌표로 표시해요.' });
  }
  const locById = new Map(loc.map((r) => [String(r['데이터 고유번호']), r]));
  let rows = info;
  if (ids) rows = info.filter((r) => ids.includes(String(r['데이터 고유번호'])));
  const items = rows.map((r) => {
    const id = String(r['데이터 고유번호']);
    const l = locById.get(id) || {};
    return {
      id,
      name: clean(r['장소명']),
      lat: parseFloat(r['위도']),
      lon: parseFloat(r['경도']),
      addr: clean(l['위치']),
      cat: clean(r['분류']),
      dir: clean(r['디렉토리1']),
      title: clean(r['제목']),
      text: clean(r['내용']),
      url: clean(l['데이터 상세보기 URL']) || clean(r['링크']),
    };
  });
  return { items, warnings };
}

// ---- 서버 ----
const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return send(res, 405, { error: { code: 'method', message: 'GET만 쓸 수 있어요.' } });

  if (url.pathname === '/api/places') {
    const ids = url.searchParams.get('ids');
    const list = ids ? ids.split(',').map((s) => s.trim()).filter((s) => /^\d{1,6}$/.test(s)) : null;
    try {
      const { items, warnings } = await places(list);
      return send(res, 200, { source: 'api', fetchedAt: new Date().toISOString(), count: items.length, items, warnings });
    } catch (e) {
      const known = e instanceof ApiError;
      if (!known) console.error('예상 못 한 오류:', e.message);
      return send(res, known && e.code === 'no-key' ? 503 : 502, {
        error: { code: known ? e.code : 'server', message: known ? e.message : '서버에서 오류가 났어요.' },
      });
    }
  }

  // 화면 파일은 index.html 하나만 내보냄 (.env.local 같은 파일은 절대 내보내지 않음)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html 을 읽지 못했어요'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('찾을 수 없어요');
}).listen(PORT, () => {
  const has = (n) => (process.env[ENDPOINTS[n].env] || '').trim() ? '있음' : '비어 있음';
  console.log(`http://localhost:${PORT}  (일반정보 키: ${has('info')}, 위치정보 키: ${has('location')})`);
});
