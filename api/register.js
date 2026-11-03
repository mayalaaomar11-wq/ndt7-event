const crypto = require("crypto");

const PACKAGES = ["Package 1", "Package 2", "Package 3"];

function newId() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (const x of crypto.randomBytes(6)) s += a[x % a.length];
  return "NDT7-" + s;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
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
  if (
    name.length < 3 ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    phone.replace(/\D/g, "").length < 8 ||
    !PACKAGES.includes(pkg)
  ) {
    res.status(400).json({ error: "Invalid data" });
    return;
  }

  const h = { apikey: KEY, "Content-Type": "application/json" };
  if (KEY.startsWith("eyJ")) h.Authorization = "Bearer " + KEY;
  const base = URL.replace(/\/$/, "") + "/rest/v1/registrations";

  try {
    // Same email registered before: return the same ticket
    const f = await fetch(
      base + "?email=eq." + encodeURIComponent(email) + "&select=ticket_id,name,package_name&limit=1",
      { headers: h }
    );
    if (!f.ok) throw new Error("lookup " + f.status);
    const found = await f.json();
    if (found.length) {
      res.status(200).json({
        ticketId: found[0].ticket_id,
        name: found[0].name,
        package: found[0].package_name,
        existing: true,
      });
      return;
    }

    for (let i = 0; i < 3; i++) {
      const ticketId = newId();
      const r = await fetch(base, {
        method: "POST",
        headers: { ...h, Prefer: "return=minimal" },
        body: JSON.stringify({ ticket_id: ticketId, name, email, phone, package_name: pkg }),
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
