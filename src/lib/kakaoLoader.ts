let loading: Promise<void> | null = null;

const LOAD_TIMEOUT_MS = 10_000;

/** 카카오맵 SDK를 한 번만 불러옵니다 (autoload=false 후 kakao.maps.load 사용). */
export function loadKakaoMaps(appKey: string): Promise<void> {
  if (window.kakao?.maps?.LatLng) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const fail = (message: string) => {
      loading = null;
      reject(new Error(message));
    };
    const timer = window.setTimeout(
      () => fail("카카오맵 SDK 응답이 없습니다. 앱 키와 등록된 도메인을 확인해 주세요."),
      LOAD_TIMEOUT_MS,
    );

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao?.maps) {
        window.clearTimeout(timer);
        fail("카카오맵 SDK를 초기화하지 못했습니다. 앱 키와 등록된 도메인을 확인해 주세요.");
        return;
      }
      window.kakao.maps.load(() => {
        window.clearTimeout(timer);
        resolve();
      });
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      script.remove();
      // 카카오는 등록되지 않은 도메인·잘못된 키에 401을 돌려주며, 브라우저는 이를 스크립트 로드 실패로만 알려 줍니다.
      fail("카카오맵이 이 주소에서의 지도 사용을 거부했거나 SDK를 내려받지 못했습니다.");
    };
    document.head.appendChild(script);
  });

  return loading;
}
