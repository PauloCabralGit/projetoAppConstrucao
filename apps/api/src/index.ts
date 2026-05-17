import { Hono } from "hono";
import type { RegistrationPayload } from "@construconnect/shared";
import { providers, registrations, requests } from "./mock-data";

type Bindings = {
  APP_NAME: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) =>
  c.json({
    name: c.env.APP_NAME,
    status: "ok",
    date: "2026-05-16",
    message: "API da POC pronta para evoluir com Postgres e autenticacao real."
  })
);

app.get("/health", (c) => c.json({ ok: true }));

app.get("/v1/providers", (c) => {
  const role = c.req.query("role");
  const city = c.req.query("city");

  const filtered = providers.filter((provider) => {
    const matchesRole = !role || provider.role === role;
    const matchesCity = !city || provider.city.toLowerCase().includes(city.toLowerCase());
    return matchesRole && matchesCity;
  });

  return c.json({ data: filtered, total: filtered.length });
});

app.get("/v1/requests", (c) => c.json({ data: requests, total: requests.length }));

app.post("/v1/register", async (c) => {
  const payload = (await c.req.json()) as RegistrationPayload;
  const record = {
    ...payload,
    role: payload.role ?? "client"
  };

  registrations.push(record);

  return c.json(
    {
      message: "Cadastro recebido na POC.",
      nextStep: "Persistir no Postgres e emitir challenge de WebAuthn.",
      data: record
    },
    201
  );
});

app.post("/v1/auth/webauthn/register-options", async (c) => {
  const body = await c.req.json<{ email?: string }>();
  const baseChallenge = `${body.email ?? "anon"}-challenge-2026-05-16`;
  const challenge = btoa(baseChallenge);

  return c.json({
    rp: { name: c.env.APP_NAME },
    challenge,
    userVerification: "preferred",
    timeout: 60000
  });
});

app.post("/v1/auth/webauthn/verify-registration", async (c) => {
  const payload = await c.req.json();

  return c.json({
    verified: true,
    message: "Validacao mockada da POC. Salve a credencial na tabela webauthn_credentials.",
    credentialPreview: JSON.stringify(payload).slice(0, 120)
  });
});

export default app;
