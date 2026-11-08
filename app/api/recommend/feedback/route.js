// Relevant / not relevant feedback on AI recommendations. Fed into the next recommendation prompt.
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
const FILE = path.join(process.cwd(), "data", "recommendation-feedback.json");

// { kind: "company" | "profile", key: string, value: "relevant" | "irrelevant" | null }
export async function POST(req) {
  const { kind, key, value } = await req.json().catch(() => ({}));
  if (!["company", "profile"].includes(kind) || !key) return Response.json({ error: "Bad feedback." }, { status: 400 });
  let all = {};
  try {
    all = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {}
  const k = `${kind}:${String(key).slice(0, 120)}`;
  if (value === "relevant" || value === "irrelevant") all[k] = value;
  else delete all[k];
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all));
  return Response.json({ feedback: all });
}
