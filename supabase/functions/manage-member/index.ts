import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = ["https://margeup.vercel.app", "http://localhost:3000", "http://localhost:5500", "http://127.0.0.1:5500"];
const PREVIEW = /^https:\/\/margeup[a-z0-9-]*\.vercel\.app$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["magasinier", "transport"];

function corsFor(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED.includes(origin) || PREVIEW.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), "Content-Type": "application/json" } });
}

function toLoginEmail(identifier: string): string | null {
  const value = identifier.trim().toLowerCase();
  if (EMAIL.test(value)) return value;
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `p${digits}@membres.margeup.invalid` : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsFor(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json(req, { error: "Non authentifié" }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const token = authorization.slice("Bearer ".length);
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json(req, { error: "Non authentifié" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: caller } = await admin.from("members").select("id, company_id, role, status").eq("user_id", authData.user.id).maybeSingle();
  if (!caller || caller.role !== "direction" || caller.status !== "actif") return json(req, { error: "Réservé à la direction" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(req, { error: "Requête invalide" }, 400); }
  const action = String(body.action ?? "create");

  if (action === "list") {
    const { data: members, error } = await admin.from("members").select("id, user_id, full_name, role, phone, status, created_at").eq("company_id", caller.company_id).neq("role", "direction").order("created_at", { ascending: true });
    if (error) return json(req, { error: "Chargement des membres impossible" }, 500);
    const result = await Promise.all((members ?? []).map(async (member) => {
      const { data } = await admin.auth.admin.getUserById(member.user_id);
      return { id: member.id, full_name: member.full_name, role: member.role, phone: member.phone, status: member.status, created_at: member.created_at, identifier: data.user?.email ?? "" };
    }));
    return json(req, { members: result });
  }

  if (action === "create") {
    const fullName = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "");
    const password = String(body.password ?? "");
    const identifier = toLoginEmail(String(body.identifier ?? ""));
    const phone = body.phone ? String(body.phone).trim().slice(0, 30) : null;
    if (fullName.length < 2 || fullName.length > 80) return json(req, { error: "Nom invalide" }, 400);
    if (!ROLES.includes(role)) return json(req, { error: "Rôle invalide" }, 400);
    if (password.length < 8 || password.length > 72) return json(req, { error: "Mot de passe : 8 à 72 caractères" }, 400);
    if (!identifier) return json(req, { error: "E-mail ou numéro de téléphone invalide" }, 400);
    const { count } = await admin.from("members").select("id", { count: "exact", head: true }).eq("company_id", caller.company_id);
    if ((count ?? 0) >= 50) return json(req, { error: "Nombre maximum de membres atteint" }, 400);
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email: identifier, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (createError || !created.user) return json(req, { error: "Identifiant déjà utilisé ou refusé" }, 409);
    const { data: member, error: memberError } = await admin.from("members").insert({ company_id: caller.company_id, user_id: created.user.id, role, full_name: fullName, phone, must_change_password: true }).select("id, full_name, role, status").single();
    if (memberError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json(req, { error: "Création impossible" }, 500);
    }
    return json(req, { ok: true, member, login_identifier: identifier }, 201);
  }

  if (action === "update") {
    const memberId = String(body.member_id ?? "");
    const fullName = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "");
    const phone = body.phone ? String(body.phone).trim().slice(0, 30) : null;
    if (!memberId || fullName.length < 2 || fullName.length > 80 || !ROLES.includes(role)) return json(req, { error: "Informations du membre invalides" }, 400);
    const { data: target } = await admin.from("members").select("id, user_id, role, company_id").eq("id", memberId).maybeSingle();
    if (!target || target.company_id !== caller.company_id || target.role === "direction" || target.user_id === authData.user.id) return json(req, { error: "Membre introuvable" }, 404);
    const { error } = await admin.from("members").update({ full_name: fullName, role, phone }).eq("id", target.id);
    if (error) return json(req, { error: "Modification impossible" }, 500);
    await admin.auth.admin.updateUserById(target.user_id, { user_metadata: { full_name: fullName } });
    return json(req, { ok: true });
  }

  if (action === "delete") {
    const memberId = String(body.member_id ?? "");
    const { data: target } = await admin.from("members").select("id, user_id, role, company_id").eq("id", memberId).maybeSingle();
    if (!target || target.company_id !== caller.company_id || target.role === "direction" || target.user_id === authData.user.id) return json(req, { error: "Membre introuvable" }, 404);
    const { error: removeMemberError } = await admin.from("members").delete().eq("id", target.id);
    if (removeMemberError) return json(req, { error: "Suppression du membre impossible" }, 500);
    const { error: removeUserError } = await admin.auth.admin.deleteUser(target.user_id);
    if (removeUserError) return json(req, { error: "Le compte a été retiré de l’entreprise, mais la suppression Auth doit être vérifiée" }, 500);
    return json(req, { ok: true });
  }

  return json(req, { error: "Action inconnue" }, 400);
});

