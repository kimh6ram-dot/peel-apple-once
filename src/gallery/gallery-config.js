/* 전시장 설정 — 프런트엔드에는 "공개 가능한" 값만 둔다.
 *  - SUPABASE_URL      : https://<프로젝트ID>.supabase.co
 *  - PUBLISHABLE_KEY   : Supabase 대시보드의 Publishable key (sb_publishable_…) 또는 구형 anon key. 읽기 전용 RLS 가 보호한다.
 *  (Supabase 대시보드 > Project Settings > API Keys: Project URL / Publishable key. 'Secret key' 는 서버 전용이라 여기에 넣으면 안 된다.)
 *  secret key / service_role key 는 절대 넣지 않는다(넣으면 gallery-api.js 가 거부한다).
 * 비워 두면 전시장은 "연결 전" 안내를 보여준다. 값이 채워지면 별도 코드 수정 없이 실데이터 모드로 바뀐다. */
window.GALLERY_CONFIG = Object.assign({
  SUPABASE_URL: 'https://ymdwmhiyabzgtsdemuip.supabase.co',
  PUBLISHABLE_KEY: 'sb_publishable_oPvMAwL8T15IbVYEDyix5Q_p6yuPeD-',
  TABLE: 'gallery_apples',
  BUCKET: 'gallery-apples',
  PAGE_SIZE: 24,
  TIMEOUT_MS: 10000,
}, window.GALLERY_CONFIG || {});   // (QA 가 미리 넣어 둔 값이 있으면 그것을 우선)
