import { Problem } from "../src/domain.ts";
export function protect(response: Response): Response {
  const r = new Response(response.body, response);
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  };
  for (const [key, value] of Object.entries(headers)) r.headers.set(key, value);
  if (!r.headers.has("Cache-Control"))
    r.headers.set("Cache-Control", "no-store");
  return r;
}
export function failure(error: unknown): Response {
  if (error instanceof Problem)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      {
        status: error.status,
        headers:
          error.status === 401
            ? {
                "WWW-Authenticate":
                  'Bearer realm="workflow-lab", error="invalid_token"',
              }
            : undefined,
      },
    );
  console.error(
    JSON.stringify({ event: "request_failed", category: "internal" }),
  );
  return Response.json(
    {
      error: {
        code: "INTERNAL",
        message:
          "The service could not complete the request. Refresh and retry.",
      },
    },
    { status: 500 },
  );
}
