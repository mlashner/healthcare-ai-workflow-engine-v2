import { CLINICIAN_COOKIE, getReviewContext } from "@/app/review-context";

export const runtime = "nodejs";

/**
 * Stands in for authenticated sign-in in this demo. It stores only an opaque
 * provider id. Role and patient scope are read from the store on every
 * request, so the cookie carries no privileges of its own.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const clinicianId = form.get("clinicianId");

  if (typeof clinicianId !== "string") {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "clinicianId is required" } },
      { status: 400 },
    );
  }

  const { repos } = getReviewContext();
  const provider = await repos.providers.getById(clinicianId);
  if (!provider) {
    return Response.json(
      { error: { code: "UNKNOWN_CLINICIAN", message: "no such provider" } },
      { status: 400 },
    );
  }

  const response = new Response(null, { status: 303, headers: { location: "/reviews" } });
  response.headers.append(
    "set-cookie",
    `${CLINICIAN_COOKIE}=${provider.id}; Path=/; HttpOnly; SameSite=Lax`,
  );

  return response;
}
