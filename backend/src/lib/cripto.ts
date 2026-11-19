import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Criptografia das senhas das conexões (AES-256-GCM).
 * A chave vem de CHAVE_CRIPTOGRAFIA; qualquer texto longo serve, ele é derivado para 32 bytes.
 * Formato gravado: v1.<iv>.<tag>.<cifrado> (base64url).
 */
const chave = crypto.createHash('sha256').update(config.chaveCriptografia).digest();

export function criptografar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), cifrado.toString('base64url')].join('.');
}

export function descriptografar(valor: string): string {
  const [versao, iv, tag, cifrado] = valor.split('.');
  if (versao !== 'v1' || !iv || !tag || !cifrado) throw new Error('Senha criptografada em formato inválido.');
  const decifra = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64url'));
  decifra.setAuthTag(Buffer.from(tag, 'base64url'));
  try {
    return Buffer.concat([decifra.update(Buffer.from(cifrado, 'base64url')), decifra.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Não foi possível ler a senha da conexão. A CHAVE_CRIPTOGRAFIA mudou desde que ela foi salva? Informe a senha de novo na conexão.',
    );
  }
}
