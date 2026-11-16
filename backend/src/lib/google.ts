import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';

/* =========================================================
   Login com Google: confere o ID token emitido pelo Google
   (assinatura, emissor, público, validade e e-mail verificado).
   ========================================================= */

let chaves: ReturnType<typeof createRemoteJWKSet> | null = null;

export class ErroGoogle extends Error {}

export async function validarTokenGoogle(credencial: string): Promise<{ email: string; nome: string | null }> {
  if (!config.googleClientId) throw new ErroGoogle('O login com Google não está configurado.');
  chaves ??= createRemoteJWKSet(new URL(config.googleJwksUrl));
  let payload;
  try {
    ({ payload } = await jwtVerify(credencial, chaves, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.googleClientId,
      clockTolerance: 30,
    }));
  } catch {
    throw new ErroGoogle('Não foi possível confirmar o login com o Google. Tente de novo.');
  }
  const email = String(payload.email ?? '').toLowerCase();
  if (!email || payload.email_verified !== true) throw new ErroGoogle('A conta do Google não tem e-mail verificado.');
  if (config.googleDominio) {
    const hd = String(payload.hd ?? '').toLowerCase();
    if (hd !== config.googleDominio) throw new ErroGoogle(`Use uma conta Google do domínio ${config.googleDominio}.`);
  }
  return { email, nome: typeof payload.name === 'string' ? payload.name : null };
}
