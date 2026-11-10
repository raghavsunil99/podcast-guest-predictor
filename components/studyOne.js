// Study one profile and save it, exactly as the Discover page does. Used for single and bulk studies.
//   inp: { url, profileText, pdf, extra, honorific }
// Returns { result, guest, duplicate, notice, photoAdded }. Throws an Error with .code / .providerId.
export async function studyOne({ inp, settings, providerId, nativeGreeting, api }) {
  const fd = new FormData();
  fd.append("url", (inp.url || "").trim());
  fd.append("profileText", inp.profileText || "");
  fd.append("honorific", inp.honorific || "auto");
  fd.append("extraInstructions", inp.extra || "");
  fd.append("nativeGreeting", nativeGreeting ? "yes" : "no");
  fd.append("settings", JSON.stringify(settings));
  if (providerId) fd.append("provider", providerId);
  if (inp.pdf) fd.append("pdf", inp.pdf);
  const res = await fetch("/api/generate", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({ error: "Unexpected server response." }));
  if (!res.ok || data.error) {
    const err = new Error(data.error || "Something went wrong.");
    err.code = data.code;
    err.providerId = data.providerId;
    throw err;
  }
  const { pdfPhoto, ...result } = data;
  const out = await api.save(result, (inp.url || "").trim());
  let photoAdded = false;
  // Profile photo found inside the PDF: use it unless the guest already has a photo.
  if (out && pdfPhoto && !out.guest.photoUrl) {
    await api.patch(out.guest.id, { patch: { photoUrl: pdfPhoto } });
    photoAdded = true;
  }
  return { result, guest: out?.guest || null, duplicate: !!out?.duplicate, notice: data.ai?.notice || "", photoAdded };
}
