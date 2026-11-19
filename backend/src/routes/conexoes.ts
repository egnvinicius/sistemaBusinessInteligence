import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { somenteDesenvolvedor } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { criptografar } from '../lib/cripto.js';
import { ehDuplicado, lerId, validar } from '../lib/http.js';
import { descartarPool } from '../origens/sqlserver.js';
import { origemPara, type ConexaoConfig } from '../origens/tipos.js';
import { carregarConexao } from '../etl/comum.js';

const conexaoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome da conexão.')
    .max(60)
    .regex(/^[A-Za-z0-9 _.-]+$/, 'O nome aceita letras, números, espaço, ponto, hífen e sublinhado.'),
  host: z.string().trim().min(1, 'Informe o servidor (host).').max(160),
  porta: z.coerce.number().int().min(1).max(65535).default(1433),
  banco: z.string().trim().min(1, 'Informe o banco de dados.').max(120),
  usuario: z.string().trim().min(1, 'Informe o usuário.').max(120),
  /** Em branco na edição = mantém a senha atual. */
  senha: z.string().max(500).optional().default(''),
  criptografar: z.boolean().default(true),
  confiarCertificado: z.boolean().default(true),
  ativo: z.boolean().default(true),
});

const paraResposta = (r: any) => ({
  id: r.id,
  nome: r.nome,
  tipo: r.tipo,
  host: r.host,
  porta: r.porta,
  banco: r.banco,
  usuario: r.usuario,
  criptografar: r.criptografar,
  confiarCertificado: r.confiar_certificado,
  ativo: r.ativo,
  ultimoTeste: r.ultimo_teste_em ? { em: r.ultimo_teste_em, ok: r.ultimo_teste_ok, mensagem: r.ultimo_teste_msg } : null,
  acoes: Number(r.acoes ?? 0),
});

const SQL_LISTA = `SELECT c.*, (SELECT COUNT(*) FROM acoes a WHERE a.conexao_id = c.id) AS acoes FROM conexoes c`;

export async function rotasConexoes(app: FastifyInstance) {
  app.addHook('preHandler', somenteDesenvolvedor);

  app.get('/', async () => {
    const { rows } = await query(`${SQL_LISTA} ORDER BY LOWER(c.nome)`);
    return rows.map(paraResposta);
  });

  const salvar = async (request: any, reply: any, id: number | null) => {
    const d = validar(conexaoSchema, request.body, reply);
    if (!d) return;
    if (!id && !d.senha) return reply.code(400).send({ erro: 'Informe a senha da conexão.' });
    try {
      let novoId = id;
      if (id) {
        const { rowCount } = await query(
          `UPDATE conexoes SET nome = $2, host = $3, porta = $4, banco = $5, usuario = $6,
                  senha_criptografada = COALESCE($7, senha_criptografada),
                  criptografar = $8, confiar_certificado = $9, ativo = $10, atualizado_em = NOW()
            WHERE id = $1`,
          [id, d.nome, d.host, d.porta, d.banco, d.usuario, d.senha ? criptografar(d.senha) : null, d.criptografar, d.confiarCertificado, d.ativo],
        );
        if (!rowCount) return reply.code(404).send({ erro: 'Conexão não encontrada.' });
        descartarPool(id);
      } else {
        const { rows } = await query(
          `INSERT INTO conexoes (nome, host, porta, banco, usuario, senha_criptografada, criptografar, confiar_certificado, ativo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [d.nome, d.host, d.porta, d.banco, d.usuario, criptografar(d.senha), d.criptografar, d.confiarCertificado, d.ativo],
        );
        novoId = rows[0].id;
      }
      await registrarAuditoria({
        usuarioId: request.user.sub,
        acao: id ? 'conexao_alterada' : 'conexao_criada',
        entidade: 'conexoes',
        detalhes: { id: novoId, nome: d.nome, host: d.host, banco: d.banco, senhaAlterada: !!d.senha },
        ip: request.ip,
      });
      const { rows } = await query(`${SQL_LISTA} WHERE c.id = $1`, [novoId]);
      return reply.code(id ? 200 : 201).send(paraResposta(rows[0]));
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: 'Já existe uma conexão com esse nome.' });
      throw e;
    }
  };

  app.post('/', (request, reply) => salvar(request, reply, null));
  app.put('/:id', (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvar(request, reply, id);
  });

  app.delete('/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows: uso } = await query('SELECT COUNT(*) AS n FROM acoes WHERE conexao_id = $1', [id]);
    if (Number(uso[0].n) > 0) {
      return reply.code(409).send({ erro: `Esta conexão é usada por ${uso[0].n} ação(ões). Troque a conexão delas antes de excluir.` });
    }
    const { rows } = await query('DELETE FROM conexoes WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Conexão não encontrada.' });
    descartarPool(id);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'conexao_excluida', entidade: 'conexoes', detalhes: { id, nome: rows[0].nome }, ip: request.ip });
    return reply.code(204).send();
  });

  /**
   * Testa uma conexão. Aceita os dados do formulário (antes de salvar);
   * com "id" e senha em branco, usa a senha já salva.
   */
  app.post('/testar', async (request, reply) => {
    const d = validar(conexaoSchema.extend({ id: z.number().int().positive().optional() }), request.body, reply);
    if (!d) return;
    let senha = d.senha;
    if (!senha && d.id) senha = (await carregarConexao(d.id).catch(() => null))?.senha ?? '';
    if (!senha) return reply.code(400).send({ erro: 'Informe a senha para testar.' });
    const cfg: ConexaoConfig = {
      id: d.id ?? 0,
      nome: d.nome,
      tipo: 'sqlserver',
      host: d.host,
      porta: d.porta,
      banco: d.banco,
      usuario: d.usuario,
      senha,
      criptografar: d.criptografar,
      confiarCertificado: d.confiarCertificado,
      versao: 'teste',
    };
    const inicio = Date.now();
    let resultado: { ok: boolean; mensagem: string };
    try {
      const r = await origemPara('sqlserver').testar(cfg);
      resultado = { ok: true, mensagem: `Conectado ao banco ${r.banco} em ${Date.now() - inicio} ms. ${r.versao}` };
    } catch (e) {
      resultado = { ok: false, mensagem: (e as Error).message };
    }
    if (d.id) {
      await query('UPDATE conexoes SET ultimo_teste_em = NOW(), ultimo_teste_ok = $2, ultimo_teste_msg = $3 WHERE id = $1', [
        d.id,
        resultado.ok,
        resultado.mensagem,
      ]);
    }
    return resultado;
  });
}
