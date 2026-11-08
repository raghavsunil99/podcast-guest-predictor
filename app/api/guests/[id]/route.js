import { deleteGuest, updateGuest } from "@/lib/guestStore";
import { decorate, deletePhoto, storePhoto } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // Photos are downloaded/stored locally instead of keeping a link that may expire.
  const photo = body.patch?.photoUrl;
  if (photo && (photo.startsWith("data:") || /^https?:\/\//.test(photo))) {
    try {
      body.patch.photoUrl = await storePhoto(id, photo);
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  } else if (body.patch && "photoUrl" in body.patch && !photo) {
    await deletePhoto(id);
  }
  const guest = await updateGuest(id, body);
  if (!guest) return Response.json({ error: "Guest not found." }, { status: 404 });
  return Response.json({ guest: decorate(guest) });
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  const ok = await deleteGuest(id);
  if (ok) await deletePhoto(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Guest not found." }, { status: 404 });
}
