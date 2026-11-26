/** 정의되지 않은 /api/* 경로는 HTML 404 페이지 대신 JSON 오류로 응답 */
function notFound() {
  return Response.json({ error: "존재하지 않는 API 경로입니다." }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
