# CTF Live Dashboard

CTFtime 기반 데이터를 실시간으로 수집해서 한눈에 보여주는 웹 대시보드입니다.  
API 키가 필요한 다른 소스도 붙일 수 있게 서버에서 키 주입을 지원합니다.

## 1) 실행

```bash
cd /home/yadoo/NiceTop/ctf-live-dashboard
cp .env.example .env
npm run start
```

브라우저:

- `http://localhost:8080`

## 2) 주요 기능

- 일정 자동 갱신(기본 45초 폴링)
- 실시간 반영(SSE)
- 필터: 전체 / 진행중 / 예정 / 국내 관련
- 검색: 대회명, 위치
- KR Top Teams / Global Top Teams 표시

## 3) 환경변수

- `PORT`: 서버 포트
- `CTF_API_BASE_URL`: 업스트림 API base URL
- `CTF_API_KEY`: 업스트림 API 키
- `CTF_API_KEY_HEADER`: 키를 넣을 헤더명 (기본 `Authorization`)
- `CTF_API_KEY_PREFIX`: 헤더 prefix (기본 `Bearer`)
- `CTF_API_KEY_QUERY`: 쿼리 파라미터 키 이름(필요 시)
- `CTF_REFRESH_MS`: 갱신 주기(ms)
- `CTF_LOOKAHEAD_DAYS`: 앞으로 조회할 일수
- `CTF_EVENTS_LIMIT`: 조회 이벤트 최대 개수

## 4) API

- `GET /api/dashboard`  
  대시보드 전체 데이터 반환
- `GET /api/status`  
  소스/최근 갱신/에러 상태
- `GET /api/stream`  
  SSE 실시간 스트림
- `POST /api/refresh`  
  즉시 수동 새로고침

