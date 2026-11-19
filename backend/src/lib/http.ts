import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';
import { z } from 'zod';

const NOMES_CAMPOS: Record<string, string> = {
  nome: 'o nome',
  login: 'o login',
  email: 'o e-mail',
  senha: 'a senha',
  host: 'o servidor',
  banco: 'o banco de dados',
  usuario: 'o usuário',
  conexaoId: 'a conexão',
  comandoSql: 'o comando SQL',
  tabelaDestino: 'a tabela de destino',
  grupoId: 'o grupo',
  valor: 'o valor',
  horas: 'as horas',
  minutos: 'os minutos',
};

/** Valida o corpo; em caso de erro já responde 400 e devolve null. */
export function validar<T>(schema: ZodType<T>, dados: unknown, reply: FastifyReply): T | null {
  const r = schema.safeParse(dados ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const campo = String(issue.path.at(-1) ?? '');
    const ausente = issue.code === 'invalid_type' && /received (undefined|null)/i.test(issue.message);
    const erro = ausente ? `Informe ${NOMES_CAMPOS[campo] ?? `o campo ${campo}`}.` : issue.message;
    reply.code(400).send({ erro });
    return null;
  }
  return r.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export function lerId(params: unknown, reply: FastifyReply): number | null {
  const r = idParam.safeParse(params);
  if (!r.success) {
    reply.code(404).send({ erro: 'Registro não encontrado.' });
    return null;
  }
  return r.data.id;
}

/** Violação de unicidade no PostgreSQL. */
export const ehDuplicado = (e: unknown) => (e as { code?: string })?.code === '23505';

export const listaIds = z.array(z.number().int().positive()).max(5000).default([]);

export const senhaForte = z
  .string()
  .min(8, 'A senha deve ter ao menos 8 caracteres.')
  .max(200)
  .regex(/[A-Za-z]/, 'A senha deve conter letras.')
  .regex(/[0-9]/, 'A senha deve conter números.');
