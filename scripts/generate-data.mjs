// 실시간 트렌드 주제 대시보드 - 데이터 생성 스크립트
// Claude 세션 없이, GitHub Actions가 이 스크립트를 주기적으로 실행해 data.json을 새로 만듭니다.
// 필요한 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
// (2026년 이후: developers.naver.com이 아니라 NAVER Cloud Platform의 "NAVER API HUB" / "Search Trend"
//  서비스에서 발급받은 Client ID/Secret을 사용합니다. README.md 3단계 참고)

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
  console.error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다. GitHub 저장소 Settings > Secrets and variables > Actions 에서 등록하세요.');
  process.exit(1);
}

// NAVER Cloud Platform API Gateway 인증 헤더 (구 developers.naver.com 방식과 다름)
const NAVER_HEADERS = {
  'X-NCP-APIGW-API-KEY-ID': NAVER_CLIENT_ID,
  'X-NCP-APIGW-API-KEY': NAVER_CLIENT_SECRET,
};

const TOPIC_COUNT = 10;
const KEYWORDS_PER_TOPIC = 10;
const SERIES_DAYS = 30; // datalab 조회 기간
const SPARK_DAYS = 14;  // 대시보드에 그릴 최근 일수

// ---------- 유틸 ----------
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function nowKstString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear(), m = String(kst.getUTCMonth() + 1).padStart(2, '0'), d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0'), mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const days = ['일','월','화','수','목','금','토'];
  const dow = days[kst.getUTCDay()];
  return `${y}-${m}-${d}(${dow}) ${hh}:${mm} KST`;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- 1. Google 트렌드 실시간 RSS에서 후보 주제 가져오기 ----------
async function fetchGoogleTrendsKR() {
  const res = await fetch('https://trends.google.com/trending/rss?geo=KR');
  if (!res.ok) throw new Error('Google Trends RSS fetch failed: ' + res.status);
  const xml = await res.text();
  const items = [];
  const itemBlocks = xml.split('<item>').slice(1);
  for (const block of itemBlocks) {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const traffic = (block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/) || [])[1] || '';
    const newsTitle = (block.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/) || [])[1] || '';
    const cleanTitle = title.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const cleanNews = newsTitle.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (cleanTitle) items.push({ title: cleanTitle, traffic: traffic.trim(), newsTitle: cleanNews });
  }
  return items;
}

// 네이버 데이터랩은 보통 "오늘" 데이터는 아직 집계 전이라 확정된 값이 없습니다.
// 조회 구간을 "어제까지"로 잡아서, 항상 빈 값(0)인 오늘자가 "최신 지수"로 잡히는 걸 방지합니다.
const REPORT_LAG_DAYS = 1;

// ---------- 2. 네이버 데이터랩 검색어트렌드 (NAVER API HUB / Search Trend) ----------
async function datalabSearch(keywordGroups, days = SERIES_DAYS) {
  const body = {
    startDate: ymd(daysAgo(days - 1 + REPORT_LAG_DAYS)),
    endDate: ymd(daysAgo(REPORT_LAG_DAYS)),
    timeUnit: 'date',
    keywordGroups,
  };
  const res = await fetch('https://naverapihub.apigw.ntruss.com/search-trend/v1/search', {
    method: 'POST',
    headers: { ...NAVER_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('datalab error', res.status, await res.text());
    return { results: [] };
  }
  return res.json();
}

// ---------- 3. 네이버 블로그 검색 (경쟁도 추정용, NAVER API HUB) ----------
async function blogTotal(query) {
  const url = `https://naverapihub.apigw.ntruss.com/search/v1/blog?query=${encodeURIComponent(query)}&display=1&format=json`;
  const res = await fetch(url, { headers: NAVER_HEADERS });
  if (!res.ok) return null;
  const json = await res.json();
  return typeof json.total === 'number' ? json.total : null;
}
function competitionTier(total) {
  if (total == null) return '중'; // 조회 실패 시 중간값으로 보수적 추정
  if (total < 10000) return '하';
  if (total < 100000) return '중';
  return '상';
}

// ---------- 4. 카테고리 추정 (키워드 매칭 휴리스틱) ----------
const CATEGORY_RULES = [
  { key: 'econ', label: '경제', re: /파업|증시|주가|금리|환율|실적|수출|물가|기업|채용|고용|은행|투자/ },
  { key: 'politics', label: '정치', re: /대통령|국회|정부|장관|법안|탄핵|검찰|경찰|수사청|여당|야당|외교|의원/ },
  { key: 'edu', label: '교육', re: /수능|입시|대학교|원서접수|모의고사|학교|교육청|졸업|개학/ },
  { key: 'season', label: '계절', re: /추석|설날|연휴|폭염|한파|장마|태풍|폭설|황사|미세먼지|휴가/ },
  { key: 'society', label: '사회', re: /사고|화재|사건|재판|판결|시위|집회|공항|산불|실종/ },
];
function guessCategory(title) {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(title)) return { key: rule.key, label: rule.label };
  }
  return { key: 'culture', label: '연예' };
}

// ---------- 5. 시리즈 통계 ----------
function seriesStats(dataPoints, days) {
  // dataPoints: [{period, ratio}] (일부 날짜가 비어있을 수 있음)
  const map = {};
  (dataPoints || []).forEach(p => { map[p.period] = p.ratio; });
  const series = [];
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = ymd(daysAgo(i + REPORT_LAG_DAYS));
    series.push(map[d] != null ? Number(map[d].toFixed(2)) : 0);
    dates.push(d.slice(5).replace('-', '/'));
  }
  const latest = series[series.length - 1];
  const prev = series[series.length - 2] || 0;
  const deltaPct = prev > 0 ? Math.round(((latest - prev) / prev) * 100) : (latest > 0 ? 100 : 0);
  return { series, dates, latest, deltaPct };
}
function volumeTier(valuesInBatch, value) {
  const nonZero = valuesInBatch.filter(v => v > 0);
  if (!nonZero.length || value <= 0) return '하';
  const max = Math.max(...nonZero);
  if (value >= max * 0.5) return '상';
  if (value >= max * 0.1) return '중';
  return '하';
}
function trendLabel(series) {
  const last = series[series.length - 1];
  const prev = series[series.length - 2] || 0;
  const everSeen = series.some(v => v > 0);
  if (!everSeen) return '신규';
  if (prev === 0 && last > 0) return '신규';
  if (last > prev * 1.05) return '상승';
  if (last < prev * 0.95) return '하락';
  return '유지';
}

// ---------- 6. 롱테일 키워드 후보 생성 (기계적 조합) ----------
const SUFFIXES = ['이유', '뜻', '정리', '근황', '프로필', '방법', '논란', '전망', '총정리', '반응'];
function buildKeywordCandidates(topic) {
  return SUFFIXES.map(s => `${topic} ${s}`);
}

// ---------- 7. 메인 파이프라인 ----------
async function main() {
  console.log('1) Google 트렌드 실시간 후보 수집...');
  let trends = [];
  try {
    trends = await fetchGoogleTrendsKR();
  } catch (e) {
    console.error('Google Trends 수집 실패, 이전 data.json 유지 후 종료:', e.message);
    process.exit(1);
  }
  const candidates = trends.slice(0, Math.max(TOPIC_COUNT + 5, 15));
  if (candidates.length < TOPIC_COUNT) {
    console.error('후보 주제가 부족합니다. 종료.');
    process.exit(1);
  }

  console.log('2) 후보 주제 데이터랩 검증...');
  const topicStats = [];
  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5);
    const groups = batch.map(c => ({ groupName: c.title, keywords: [c.title] }));
    const res = await datalabSearch(groups, SERIES_DAYS);
    (res.results || []).forEach((r, idx) => {
      const stats = seriesStats(r.data, SERIES_DAYS);
      topicStats.push({ ...batch[idx], ...stats });
    });
    await sleep(150);
  }

  // 전일대비 변화율 큰 순으로 정렬해 상위 TOPIC_COUNT개 선정
  // 등락률이 같으면(예: 둘 다 0%) 최근 검색 지수가 더 높은 쪽을 우선
  topicStats.sort((a, b) => (b.deltaPct - a.deltaPct) || (b.latest - a.latest));
  const chosen = topicStats.slice(0, TOPIC_COUNT);

  console.log('3) 주제별 세부 키워드 조사...');
  const items = [];
  for (const topic of chosen) {
    const cat = guessCategory(topic.title);
    const kwCandidates = buildKeywordCandidates(topic.title);
    const kwStats = [];
    for (let i = 0; i < kwCandidates.length; i += 5) {
      const batch = kwCandidates.slice(i, i + 5);
      const groups = batch.map(k => ({ groupName: k, keywords: [k] }));
      const res = await datalabSearch(groups, SERIES_DAYS);
      (res.results || []).forEach((r, idx) => {
        const stats = seriesStats(r.data, SERIES_DAYS);
        kwStats.push({ keyword: batch[idx], ...stats });
      });
      await sleep(150);
    }
    const latestValues = kwStats.map(k => k.latest);

    // 경쟁도는 API 절약을 위해 상위 3개 키워드만 실측하고 나머지는 추정
    const sortedByVolume = [...kwStats].sort((a, b) => b.latest - a.latest);
    const measured = {};
    for (const kw of sortedByVolume.slice(0, 3)) {
      const total = await blogTotal(kw.keyword);
      measured[kw.keyword] = competitionTier(total);
      await sleep(150);
    }
    const fallbackTier = Object.values(measured)[0] || '중';

    const subKeywords = kwStats.map(k => {
      const volume = volumeTier(latestValues, k.latest);
      const trend = trendLabel(k.series);
      const competition = measured[k.keyword] || fallbackTier;
      const estimated = measured[k.keyword] ? '' : ' (참고값, 개별 검증 전)';
      const sign = k.deltaPct >= 0 ? '+' : '';
      const reason = `검색 지수 ${k.latest}, 전일대비 ${sign}${k.deltaPct}%.${estimated}`;
      return { keyword: k.keyword, volume, trend, competition, reason };
    });

    const reasonBase = topic.newsTitle
      ? topic.newsTitle
      : `Google 실시간 트렌드 상위 키워드 (트래픽 ${topic.traffic || '집계중'}).`;

    items.push({
      keyword: topic.title,
      category: cat.label,
      catKey: cat.key,
      reason: reasonBase,
      series: topic.series.slice(-SPARK_DAYS),
      dates: topic.dates.slice(-SPARK_DAYS),
      deltaPct: topic.deltaPct,
      latest: topic.latest,
      seriesLabel: `최근 ${SPARK_DAYS}일`,
      subKeywords,
    });
  }

  const data = {
    generatedAt: nowKstString(),
    items,
  };

  const fs = await import('node:fs/promises');
  await fs.writeFile(new URL('../data.json', import.meta.url), JSON.stringify(data, null, 2), 'utf8');
  console.log('data.json 생성 완료:', items.length, '개 주제');
}

main().catch(e => {
  console.error('스크립트 실행 실패:', e);
  process.exit(1);
});
