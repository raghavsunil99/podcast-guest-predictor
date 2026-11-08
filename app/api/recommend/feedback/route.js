// Relevant / not relevant feedback on AI recommendations. Fed into the next recommendation prompt.
import { readDoc, writeDoc } from "@/lib/db";

export const runtime = "nodejs";

// { kind: "company" | "profile", key: string, value: "relevant" | "irrelevant" | null }
export async function POST(req) {
  const { kind, key, value } = await req.json().catch(() => ({}));
  if (!["company", "profile"].includes(kind) || !key) return Response.json({ error: "Bad feedback." }, { status: 400 });
  const all = await readDoc("recommendation-feedback", {});
  const k = `${kind}:${String(key).slice(0, 120)}`;
  if (value === "relevant" || value === "irrelevant") all[k] = value;
  else delete all[k];
  await writeDoc("recommendation-feedback", all);
  return Response.json({ feedback: all });
}
