const crypto = require("crypto");

const PACKAGES = ["Package 1", "Package 2", "Package 3"];
const YEARS = ["First year", "Second year", "Third year", "Fourth year", "Fifth year", "Graduate", "Other"];
const HEARD = ["Facebook", "Instagram", "LinkedIn", "WhatsApp group", "A friend", "University", "Other"];

function newId() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (const x of crypto.randomBytes(6)) s += a[x % a.length];
  return "NDT7-" + s;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Diagnostic: open /api/register?check=1 in the browser to see what is wrong
  if (req.method === "GET" && req.query && req.query.check === "1") {
    const U = process.env.SUPABASE_URL;
    const K = process.env.SUPABASE_SERVICE_KEY;
    const out = {
      hasUrl: !!U,
      hasKey: !!K,
      urlLooksRight: !!U && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(U),
      keyType: !K ? null : K.startsWith("sb_secret_") ? "secret (ok)" : K.startsWith("sb_publishable_") ? "publishable (WRONG key)" : K.startsWith("eyJ") ? "jwt" : "unknown",
    };
    if (U && K) {
      try {
        const hh = { apikey: K };
        if (K.startsWith("eyJ")) hh.Authorization = "Bearer " + K;
        const r = await fetch(U.replace(/\/$/, "") + "/rest/v1/registrations?select=ticket_id&limit=1", { headers: hh });
        out.dbStatus = r.status;
        if (!r.ok) out.dbBody = (await r.text()).slice(0, 200);
      } catch (e) {
        out.dbError = String(e.message);
      }
    }
    res.status(200).json(out);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) {
    res.status(500).json({ error: "Server is not configured" });
    return;
  }

  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 80);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 120);
  const phone = String(b.phone || "").trim().slice(0, 30);
  const pkg = String(b.package || "");
  const university = String(b.university || "").trim().slice(0, 100);
  const faculty = String(b.faculty || "").trim().slice(0, 100);
  const department = String(b.department || "").trim().slice(0, 100);
  const year = String(b.academic_year || "");
  const heard = String(b.heard_from || "");
  const expectations = String(b.expectations || "").trim().slice(0, 500);
  if (
    name.length < 3 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    phone.replace(/\D/g, "").length < 8 ||
    !PACKAGES.includes(pkg) ||
    university.length < 2 ||
    faculty.length < 2 ||
    !YEARS.includes(year) ||
    !HEARD.includes(heard)
  ) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }

  const h = { apikey: KEY, "Content-Type": "application/json" };
  if (KEY.startsWith("eyJ")) h.Authorization = "Bearer " + KEY;
  const base = URL.replace(/\/$/, "") + "/rest/v1/registrations";

  try {
    // Same email registered before: update the details and the package, keep the same ID
    const f = await fetch(
      base + "?email=eq." + encodeURIComponent(email) + "&select=ticket_id,package_name,paid&limit=1",
      { headers: h }
    );
    if (!f.ok) throw new Error("lookup " + f.status);
    const found = await f.json();
    if (found.length) {
      const old = found[0];
      let finalPkg = pkg;
      let note = "";
      if (old.paid && old.package_name !== pkg) {
        finalPkg = old.package_name;
        note = "Your payment was already confirmed for " + old.package_name + ". Contact the team to change your package.";
      }
      const u = await fetch(base + "?email=eq." + encodeURIComponent(email), {
        method: "PATCH",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({
          name, phone, package_name: finalPkg, university, faculty,
          department: department || null, academic_year: year, heard_from: heard,
          expectations: expectations || null,
        }),
      });
      if (!u.ok) throw new Error("update " + u.status);
      res.status(200).json({ ticketId: old.ticket_id, name, package: finalPkg, existing: true, note });
      return;
    }

    for (let i = 0; i < 3; i++) {
      const ticketId = newId();
      const r = await fetch(base, {
        method: "POST",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({
          ticket_id: ticketId, name, email, phone, package_name: pkg, university, faculty,
          department: department || null, academic_year: year, heard_from: heard,
          expectations: expectations || null,
        }),
      });
      if (r.ok) {
        res.status(200).json({ ticketId, name, package: pkg });
        return;
      }
      if (r.status !== 409) throw new Error("insert " + r.status);
    }
    throw new Error("id collision");
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save your registration. Please try again." });
  }
};
