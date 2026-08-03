// publishable(anon) 키는 클라이언트 노출을 전제로 설계된 값이다. 실제 방어선은 RLS.
// service_role 키는 어떤 경우에도 여기에 두지 않는다.
// 두 값이 비어 있으면 공유/갤러리 기능만 꺼지고 나머지는 전부 정상 동작한다.
export const SUPABASE = {
  url: 'https://erqvcpdpvrecjdfmtsue.supabase.co',
  key: 'sb_publishable_nXCUmG2xs9Vu0pTLvW1DlA_CvVyjvkn',
};
