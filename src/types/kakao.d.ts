// 이 프로젝트에서 사용하는 카카오맵 JavaScript SDK API의 최소 타입 정의
declare namespace kakao.maps {
  function load(callback: () => void): void;

  class LatLng {
    constructor(lat: number, lng: number);
    getLat(): number;
    getLng(): number;
  }

  class LatLngBounds {
    constructor();
    extend(latlng: LatLng): void;
    contain(latlng: LatLng): boolean;
    getSouthWest(): LatLng;
    getNorthEast(): LatLng;
  }

  namespace event {
    function addListener(target: Map, type: "idle" | "zoom_changed" | "dragend" | "click", handler: () => void): void;
    function removeListener(target: Map, type: "idle" | "zoom_changed" | "dragend" | "click", handler: () => void): void;
  }

  interface MapOptions {
    center: LatLng;
    level?: number;
  }

  class Map {
    constructor(container: HTMLElement, options: MapOptions);
    setCenter(latlng: LatLng): void;
    panTo(latlng: LatLng): void;
    setBounds(bounds: LatLngBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void;
    getLevel(): number;
    getBounds(): LatLngBounds;
    setLevel(level: number, options?: { animate?: boolean }): void;
    relayout(): void;
    addControl(control: ZoomControl, position: ControlPosition): void;
  }

  class ZoomControl {
    constructor();
  }

  enum ControlPosition {
    TOP,
    TOPLEFT,
    TOPRIGHT,
    LEFT,
    RIGHT,
    BOTTOMLEFT,
    BOTTOM,
    BOTTOMRIGHT,
  }

  interface CustomOverlayOptions {
    position: LatLng;
    content: HTMLElement | string;
    map?: Map;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
    clickable?: boolean;
  }

  class CustomOverlay {
    constructor(options: CustomOverlayOptions);
    setMap(map: Map | null): void;
  }

  interface PolygonOptions {
    path: LatLng[] | LatLng[][];
    map?: Map;
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: "solid" | "shortdash" | "shortdot" | "dash" | "dot";
    fillColor?: string;
    fillOpacity?: number;
    zIndex?: number;
  }

  class Polygon {
    constructor(options: PolygonOptions);
    setMap(map: Map | null): void;
  }

  interface PolylineOptions {
    path: LatLng[];
    map?: Map;
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: "solid" | "shortdash" | "shortdot" | "dash" | "dot";
    zIndex?: number;
  }

  class Polyline {
    constructor(options: PolylineOptions);
    setMap(map: Map | null): void;
  }
}

interface Window {
  kakao?: typeof kakao;
}
