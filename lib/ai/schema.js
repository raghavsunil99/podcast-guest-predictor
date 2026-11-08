// Providers with strict structured output (OpenAI, Anthropic) require
// additionalProperties:false on every object. Our schemas already list every field as required.
export function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "properties") out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strictSchema(pv)]));
    else if (k === "items") out.items = strictSchema(v);
    else out[k] = v;
  }
  if (out.type === "object") {
    out.additionalProperties = false;
    if (out.properties && !out.required) out.required = Object.keys(out.properties);
  }
  return out;
}

// Pull the first JSON object/array out of a model reply (for providers without a schema mode).
export function parseJSON(text) {
  const s = String(text || "").trim();
  try {
    return JSON.parse(s);
  } catch {}
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
  throw new Error("The model did not return valid JSON.");
}
