import { getUsageSummary } from "@/lib/usage";
import { getProviders } from "@/lib/ai/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getUsageSummary(await getProviders()));
}
