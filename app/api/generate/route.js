import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { aiErrorResponse, runAI } from "@/lib/ai/service";
import { extractProfilePhoto } from "@/lib/pdfPhoto";
import { scoreAcceptance } from "@/lib/scoring";
import { normalizeResult } from "@/lib/normalize";
import { CAREER_SWITCH_SCHEMA, EDUCATION_SCHEMA, EXPERIENCE_SCHEMA } from "@/lib/career";

export const runtime = "nodejs";
export const maxDuration = 600; // local models can take several minutes

const MAX_PDF_BYTES = 15 * 1024 * 1024;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    profile: {
      type: "object",
      properties: {
        fullName: { type: "string" },
        firstName: { type: "string" },
        currentRole: { type: "string" },
        currentCompany: { type: "string" },
        companyDomain: {
          type: "string",
          description: "The current company's official website domain from well-known knowledge, e.g. 'cisco.com', 'tcs.com', 'swiggy.in'. '' if unsure or the company is obscure.",
        },
        industry: { type: "string", description: "Industry of the current company, short, e.g. 'IT Services', 'Fintech', 'E-commerce', 'Edtech', 'Networking', 'Healthcare'" },
        photoUrl: { type: "string", description: "A direct profile photo image URL ONLY if one appears verbatim in the provided text; otherwise ''. Never construct one." },
        location: { type: "string", description: "Location exactly as stated on the profile" },
        currentCity: {
          type: "string",
          description: "City they work/live in now, normalized (e.g. 'Bengaluru', 'Hyderabad', 'Chennai', 'Pune'); 'Unknown' if not stated",
        },
        education: EDUCATION_SCHEMA,
        experience: EXPERIENCE_SCHEMA,
        careerSwitch: CAREER_SWITCH_SCHEMA,
        totalExperience: { type: "string", description: "e.g. '6+ years'; 'Unknown' if not derivable" },
        careerPath: {
          type: "array",
          items: { type: "string" },
          description: "Roles in chronological order, e.g. 'Business Intelligence Analyst – TCS (2016–2019)'",
        },
        skills: { type: "array", items: { type: "string" } },
        domain: { type: "string" },
        aboutSummary: { type: "string" },
      },
      required: ["fullName", "firstName", "currentRole", "currentCompany", "companyDomain", "industry", "photoUrl", "location", "currentCity", "education", "experience", "careerSwitch", "totalExperience", "careerPath", "skills", "domain", "aboutSummary"],
    },
    background: {
      type: "object",
      description: "An educated GUESS about the guest's roots, used only to choose the greeting. Never stated as fact in messages.",
      properties: {
        nativeLanguage: { type: "string", description: "Most likely mother tongue, e.g. 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Hindi', 'Marathi', 'Bengali'; 'Unknown' if no signal" },
        nativeRegion: { type: "string", description: "Likely home state/region, e.g. 'Andhra Pradesh / Telangana'; 'Unknown' if no signal" },
        confidence: { type: "string", enum: ["High", "Medium", "Low"] },
        signals: {
          type: "array",
          items: { type: "string" },
          description: "Each clue used and what it suggests, e.g. 'Surname Kondapalli is common among Telugu speakers', 'Studied at JNTU Kakinada (Andhra Pradesh)', 'Works in Bengaluru (not a native signal, many migrate)'",
        },
        nativeGreeting: {
          type: "string",
          description: "Common respectful greeting in that language, in English letters, e.g. Telugu 'Namaskaram', Tamil 'Vanakkam', Kannada 'Namaskara', Malayalam 'Namaskaram', Hindi 'Namaste', Marathi 'Namaskar', Bengali 'Nomoshkar', Gujarati 'Kem cho', Punjabi 'Sat Sri Akal'; '' when language is Unknown",
        },
      },
      required: ["nativeLanguage", "nativeRegion", "confidence", "signals", "nativeGreeting"],
    },
    socialSignals: {
      type: "object",
      description: "What the profile text shows about their public presence. Use 'Unknown' when the text doesn't show it; never guess numbers.",
      properties: {
        followers: { type: "string", description: "e.g. '12,400 followers' exactly as shown, or 'Unknown'" },
        connections: { type: "string", description: "e.g. '500+ connections', or 'Unknown'" },
        postingActivity: { type: "string", enum: ["Frequent", "Occasional", "Rare", "Unknown"] },
        postingEvidence: { type: "string", description: "What shows their activity, e.g. 'Posted 3 times in the last 2 weeks about system design'; '' if none" },
        publicSpeaking: { type: "string", enum: ["Strong", "Some", "None found"] },
        speakingEvidence: { type: "array", items: { type: "string" }, description: "Talks, conferences, webinars, podcasts, YouTube, teaching, mentoring, Topmate/ADPList, meetups, blogs found in the profile" },
      },
      required: ["followers", "connections", "postingActivity", "postingEvidence", "publicSpeaking", "speakingEvidence"],
    },
    acceptance: {
      type: "object",
      description: "Scores for each prediction criterion. The app computes the overall score from these.",
      properties: {
        criteria: {
          type: "array",
          description: "Exactly one entry per criterion id, in this order: audience, posting, speaking, mentoring, story, accessibility",
          items: {
            type: "object",
            properties: {
              id: { type: "string", enum: ["audience", "posting", "speaking", "mentoring", "story", "accessibility"] },
              score: { type: "integer", description: "0–10. Use 5 when the profile text doesn't show this at all." },
              evidence: { type: "string", description: "The specific thing in the profile behind this score, quoted or paraphrased; or 'Not shown in the profile'" },
              found: { type: "boolean", description: "false when the profile text gave no information for this criterion" },
            },
            required: ["id", "score", "evidence", "found"],
          },
        },
        summary: { type: "string", description: "One sentence naming the strongest reason they might say yes and the biggest unknown or concern. Do NOT state a likelihood level, percentage or score (the app computes that)." },
        tips: { type: "array", items: { type: "string" }, description: "2–4 concrete tips to raise the chance of a yes with THIS person" },
      },
      required: ["criteria", "summary", "tips"],
    },
    contact: {
      type: "object",
      description: "Contact details that appear VERBATIM in the provided profile (e.g. LinkedIn 'Contact info', About section, website links). '' for anything not shown. Never guess or construct an email or phone number.",
      properties: {
        email: { type: "string" },
        phone: { type: "string" },
        website: { type: "string", description: "Personal site, blog, Topmate, portfolio or similar" },
      },
      required: ["email", "phone", "website"],
    },
    followUpMessage: { type: "string", description: "Polite follow-up to send if no reply after 4–5 days, 40–60 words" },
    hook: { type: "string", description: "The single most podcast-worthy part of their journey" },
    honorific: { type: "string", description: "e.g. 'garu', 'ji', 'Sir', 'Ma'am', or empty string" },
    honorificReason: { type: "string" },
    fullMessage: { type: "string" },
    connectionNote: { type: "string", description: "300 characters or fewer" },
    whatsappMessage: { type: "string" },
    personalizationNotes: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["profile", "background", "socialSignals", "acceptance", "contact", "followUpMessage", "hook", "honorific", "honorificReason", "fullMessage", "connectionNote", "whatsappMessage", "personalizationNotes", "warnings"],
};

function systemInstruction(s) {
  return `You write podcast guest invitations for ${s.senderName}, ${s.senderRole}, who hosts the ${s.podcastName}, where ${s.podcastAbout}. The format is ${s.format}.

Your job:
1. Study the guest's profile and extract the facts requested in the schema. Capture the FULL work history (every company, every role with its dates, promotions as separate roles under the same company) and every education entry. Copy dates exactly as shown; never invent months or years.
2. Pick THE HOOK: the single most interesting, podcast-worthy part of their journey (a career switch, service → product company move, non-tech → tech move, leadership growth, a notable achievement). Be specific: name the companies and roles.
3. Fill the template the user provides. Keep its structure, tone and fixed text. Replace only the {placeholders} with real details. Discussion topics must fit this guest's actual background.
4. Background guess: estimate the guest's native language and home region from these signals, strongest first:
   a. Surname and given name (e.g. Reddy/Rao/Naidu/Kondapalli → Telugu; Iyer/Subramanian/Murugan → Tamil; Nair/Menon/Pillai/Kurian → Malayalam; Gowda/Hegde/Shetty → Kannada; Patil/Kulkarni/Deshpande → Marathi; Sharma/Verma/Gupta/Singh → Hindi; Banerjee/Chatterjee/Das → Bengali; Patel/Shah/Desai → Gujarati).
   b. Where they studied, especially school and undergraduate college, and the state that college is in.
   c. Hometown, if stated anywhere.
   d. Current city is a WEAK signal: Bengaluru, Hyderabad, Pune, Chennai and NCR attract people from all over India. Note it, but don't rely on it.
   Set confidence: High when name and college point the same way; Medium when only one strong signal exists; Low when signals conflict or are missing. List every signal you used.
5. Honorific: base it on the background guess. Telugu → "garu"; Hindi, Marathi, Gujarati or Punjabi → "ji"; Tamil, Kannada, Malayalam, Bengali or Low confidence → "" (just first name). If the user supplied an honorific override, use exactly that (use "" if the override is "none").
6. Native greeting: if the user asks for it ("Native greeting: yes") AND confidence is High or Medium, open every message with the native greeting instead of "Hi", e.g. "Vanakkam Karthik," / "Namaskaram Ravi Teja garu,". Otherwise use "Hi".
7. Contact: copy any email, phone or website that the profile text itself shows (e.g. the LinkedIn Contact info section). Never invent or guess one.
   Social signals: read follower/connection counts, the Activity section, posts, Featured items, and any talks, webinars, podcasts, YouTube, teaching, mentoring (Topmate, ADPList), blogs or meetups. Only report what the text shows.
8. Acceptance prediction: score each criterion 0–10 for how likely this person is to say yes to a student-focused career podcast:
   - audience: LinkedIn followers/connections. 10 = 10k+ followers, 7 = 2k–10k, 5 = unknown, 3 = under 500 connections.
   - posting: how often they post or share on LinkedIn. 10 = posts weekly, 6 = occasionally, 5 = unknown, 2 = no visible activity.
   - speaking: talks, conferences, webinars, past podcasts, YouTube, blogs, content creation. 10 = regular speaker/creator, 5 = none mentioned.
   - mentoring: teaching, mentoring (Topmate, ADPList), helping students/freshers, community work. 10 = active mentor, 5 = none mentioned.
   - story: how strong and relatable their career story is for students (career switch, tier-2/3 college to top company, non-tech to tech, rapid growth). 10 = compelling, 3 = very linear and generic.
   - accessibility: how reachable they are. 9 = mid-level (3–12 years), 6 = senior manager/director, 3 = VP/CXO/famous, also lower if they just changed jobs.
   Be strict and use only what the profile shows. When the profile has no information for a criterion, give 5 and set found=false. Give 2–4 practical tips (best channel, what to emphasize, whether to engage with their posts first).
9. Produce four messages:
   - fullMessage: the filled template, under ~170 words.
   - connectionNote: LinkedIn connection note, STRICTLY 300 characters or fewer, based on the connection template.
   - whatsappMessage: shorter, warmer and more casual than the full message, 60–90 words, same facts.
   - followUpMessage: a polite, short nudge for when there's no reply after 4–5 days. No guilt-tripping.

Rules:
- NEVER mention the guessed native language, region or origin in the message body (a native greeting word is fine when requested).
- You may mention their college or current city in a message only if it is stated on the profile and genuinely relevant.
- NEVER invent facts. If something is not in the profile, do not claim it. Make the sentence more general instead and add a note to "warnings".
- Warm, respectful, conversational. Not salesy. No buzzwords or AI-sounding phrases ("I hope this message finds you well", "truly inspiring", "delve", "testament", "esteemed").
- Make the guest feel specifically chosen.
- personalizationNotes: short bullets saying which profile details you used and where.
- Plain text only in messages (no markdown, no asterisks).`;
}


async function researchFromUrl(url, providerId) {
  const out = await runAI({
    kind: "research",
    needs: { web: true },
    providerId,
    parts: [{ text: `Find public information about the professional whose LinkedIn profile is: ${url}

Try reading the URL directly, and also search the web for their public profile details.
Report ONLY facts you actually found, as plain text:
- Full name
- Headline / current role and company
- Location
- Work history (companies, roles, approximate dates)
- Education (institution, degree, years, and the city/state of each institution)
- Hometown or native place, if mentioned anywhere
- Follower and connection counts, posting activity, talks, webinars, podcasts, mentoring, YouTube or blogs
- Skills / domain
- Public contact details (email, website) only if published by them
- About section (paraphrased)
- Any notable achievements, talks, posts or projects

If you could not find reliable information, say exactly "NOT_FOUND" and nothing else. Do not guess or merge different people with the same name.` }],
  });
  return { text: String(out.data || "").trim(), tokens: out.tokens };
}

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const url = String(form.get("url") || "").trim();
  const profileText = String(form.get("profileText") || "").trim();
  const honorificOverride = String(form.get("honorific") || "auto");
  const nativeGreeting = String(form.get("nativeGreeting") || "") === "yes";
  const extraInstructions = String(form.get("extraInstructions") || "").trim();
  const pdf = form.get("pdf");
  const providerId = String(form.get("provider") || "") || undefined; // "" = automatic fallback order
  let settings = DEFAULT_SETTINGS;
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(String(form.get("settings") || "{}")) };
  } catch {}

  const hasPdf = pdf && typeof pdf === "object" && pdf.size > 0;
  if (!url && !profileText && !hasPdf) {
    return Response.json({ error: "Add a LinkedIn URL, paste the profile text, or upload the profile PDF." }, { status: 400 });
  }
  if (hasPdf && pdf.size > MAX_PDF_BYTES) {
    return Response.json({ error: "PDF is too large (max 15 MB)." }, { status: 400 });
  }

  const parts = [];
  let pdfPhoto = null;
  const sourceNotes = [];

  try {
    if (hasPdf) {
      const buf = Buffer.from(await pdf.arrayBuffer());
      parts.push({ pdf: buf.toString("base64") });
      pdfPhoto = extractProfilePhoto(buf); // browser-saved LinkedIn pages include the profile photo
      sourceNotes.push("Profile PDF attached above.");
    }
    if (profileText) {
      parts.push({ text: `PROFILE TEXT (pasted by user):\n${profileText}` });
      sourceNotes.push("Profile text pasted by user.");
    }
    let usedWebResearch = false;
    let researchTokens = 0;
    if (!hasPdf && !profileText && url) {
      // Only providers with web access (Gemini) can research a bare URL.
      const { text: research, tokens } = await researchFromUrl(url, providerId);
      researchTokens = tokens;
      if (!research || research.includes("NOT_FOUND") || research.length < 80) {
        return Response.json(
          {
            error:
              "Couldn't read enough public information from that LinkedIn URL (LinkedIn blocks most automated access). Paste the profile text or upload the profile PDF (LinkedIn → More → Save to PDF) and try again.",
          },
          { status: 422 }
        );
      }
      usedWebResearch = true;
      parts.push({ text: `PROFILE INFO (gathered from public web search, may be incomplete):\n${research}` });
    }

    parts.push({
      text: `LinkedIn URL: ${url || "(not given)"}
Sources: ${sourceNotes.join(" ") || "Public web research."}
Honorific override: ${honorificOverride}
Native greeting: ${nativeGreeting ? "yes" : "no"}
${extraInstructions ? `Extra instructions from the host: ${extraInstructions}\n` : ""}
FULL MESSAGE TEMPLATE:
"""
${settings.template}
"""

CONNECTION NOTE TEMPLATE (max 300 characters):
"""
${settings.connectionTemplate}
"""`,
    });

    const out = await runAI({
      kind: "generate",
      providerId,
      needs: { pdf: hasPdf },
      system: systemInstruction(settings),
      parts,
      schema: OUTPUT_SCHEMA,
      temperature: 0.7,
    });

    const data = out.data;
    data.warnings = Array.isArray(data.warnings) ? data.warnings : [];
    normalizeResult(data, honorificOverride);
    scoreAcceptance(data);
    if (usedWebResearch) {
      data.warnings.unshift("Profile details came from public web search, not the profile itself. Double-check them before sending.");
    }
    if ((data.connectionNote || "").length > 300) {
      data.warnings.push(`Connection note is ${data.connectionNote.length} characters; LinkedIn allows 300. Shorten it before sending.`);
    }
    if (pdfPhoto) data.pdfPhoto = pdfPhoto.dataUrl;
    data.model = out.model;
    data.ai = { provider: out.provider.name, providerId: out.provider.id, model: out.model, notice: out.notice };
    data.tokensUsed = out.tokens + researchTokens;
    return Response.json(data);
  } catch (err) {
    return aiErrorResponse(err);
  }
}
