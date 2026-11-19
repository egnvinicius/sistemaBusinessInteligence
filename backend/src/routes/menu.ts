import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { autenticado, somenteAdmin } from '../lib/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { ehDuplicado, lerId, listaIds, validar } from '../lib/http.js';

/* =========================================================
   Leitura para o usuário: menu e painéis que ele pode ver
   ========================================================= */

/** Profundidade máxima de subgrupos abaixo de um grupo do menu. */
export const MAX_NIVEIS_SUBGRUPO = 3;

/**
 * Painéis ativos visíveis para o usuário ($1 = id, $2 = Gestor ou Desenvolvedor):
 * - grupos: os grupos de acesso marcados no painel (Gestor e Desenvolvedor veem todos);
 * - subgrupo (análise publicada como pública): quem tem acesso ao subgrupo do menu;
 * - privado (análise publicada só para o dono): o dono e os Desenvolvedores.
 */
export const SQL_VISIVEIS = `
  SELECT p.id, p.nome, p.descricao, p.menu_subgrupo_id, p.fundo_claro, p.fundo_escuro, p.analise_id, p.visibilidade, p.dono_id
    FROM paineis p
   WHERE p.ativo
     AND CASE p.visibilidade
           WHEN 'privado' THEN p.dono_id = $1
                            OR EXISTS (SELECT 1 FROM usuarios ux WHERE ux.id = $1 AND ux.perfil = 'desenvolvedor')
           WHEN 'subgrupo' THEN $2::boolean OR p.dono_id = $1 OR usuario_acessa_subgrupo($1, p.menu_subgrupo_id)
           ELSE $2::boolean
                OR EXISTS (SELECT 1
                             FROM painel_permissao pp
                             JOIN usuario_grupo ug ON ug.grupo_usuario_id = pp.grupo_usuario_id
                            WHERE pp.painel_id = p.id AND ug.usuario_id = $1)
         END`;

interface SubgrupoLinha {
  id: number;
  menu_grupo_id: number;
  subgrupo_pai_id: number | null;
  nome: string;
}

async function carregarEstrutura() {
  const [{ rows: grupos }, { rows: subgrupos }] = await Promise.all([
    query('SELECT id, nome, icone FROM menu_grupos ORDER BY ordem, LOWER(nome)'),
    query<SubgrupoLinha>(
      'SELECT id, menu_grupo_id, subgrupo_pai_id, nome FROM menu_subgrupos ORDER BY ordem, LOWER(nome)',
    ),
  ]);
  return { grupos, subgrupos };
}

/** Caminho do subgrupo até o grupo, do mais alto para o mais baixo. */
function caminhoDo(subgrupoId: number, subgrupos: SubgrupoLinha[]) {
  const porId = new Map(subgrupos.map((s) => [s.id, s]));
  const caminho: SubgrupoLinha[] = [];
  let atual = porId.get(subgrupoId);
  while (atual) {
    caminho.unshift(atual);
    atual = atual.subgrupo_pai_id ? porId.get(atual.subgrupo_pai_id) : undefined;
  }
  return caminho;
}

export async function usuarioAtivo(id: number) {
  const { rows } = await query<{ perfil: string }>('SELECT perfil FROM usuarios WHERE id = $1 AND ativo', [id]);
  return rows[0] ? { veTudo: rows[0].perfil !== 'usuario', dev: rows[0].perfil === 'desenvolvedor' } : null;
}

export async function rotasMenuUsuario(app: FastifyInstance) {
  app.addHook('preHandler', autenticado);

  app.get('/', async (request, reply) => {
    const u = await usuarioAtivo(request.user.sub);
    if (!u) return reply.code(401).send({ erro: 'Usuário inativo.' });
    const [{ grupos, subgrupos }, { rows: paineis }] = await Promise.all([
      carregarEstrutura(),
      // Privados de outras pessoas (que o Desenvolvedor pode abrir) não poluem o menu dele
      query(`${SQL_VISIVEIS} AND (p.visibilidade <> 'privado' OR p.dono_id = $1) ORDER BY p.ordem, LOWER(p.nome)`, [request.user.sub, u.veTudo]),
    ]);

    // Monta Grupo › Subgrupo (› Subgrupo…) › Painel; níveis sem painel visível não aparecem
    const montar = (paiId: number | null, grupoId: number): any[] =>
      subgrupos
        .filter((s) => s.menu_grupo_id === grupoId && s.subgrupo_pai_id === paiId)
        .map((s) => ({
          id: s.id,
          nome: s.nome,
          subgrupos: montar(s.id, grupoId),
          paineis: paineis
            .filter((p) => p.menu_subgrupo_id === s.id)
            .map((p) => ({ id: p.id, nome: p.nome, privado: p.visibilidade === 'privado' })),
        }))
        .filter((s) => s.paineis.length || s.subgrupos.length);

    return grupos
      .map((g) => ({ id: g.id, nome: g.nome, icone: g.icone, subgrupos: montar(null, g.id) }))
      .filter((g) => g.subgrupos.length);
  });

  app.get('/paineis/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const u = await usuarioAtivo(request.user.sub);
    if (!u) return reply.code(401).send({ erro: 'Usuário inativo.' });
    const { rows } = await query(`${SQL_VISIVEIS} AND p.id = $3`, [request.user.sub, u.veTudo, id]);
    // Mesma resposta para "não existe" e "sem acesso", para não revelar painéis
    if (!rows[0]) return reply.code(404).send({ erro: 'Painel não encontrado ou sem permissão de acesso.' });
    const r = rows[0];
    const { grupos, subgrupos } = await carregarEstrutura();
    const caminho = caminhoDo(r.menu_subgrupo_id, subgrupos);
    const grupo = grupos.find((g) => g.id === caminho[0]?.menu_grupo_id);
    await registrarAuditoria({ usuarioId: request.user.sub, acao: 'painel_acessado', entidade: 'paineis', detalhes: { id }, ip: request.ip });
    return {
      id: r.id,
      nome: r.nome,
      descricao: r.descricao,
      grupo: { id: grupo?.id, nome: grupo?.nome },
      caminho: caminho.map((s) => ({ id: s.id, nome: s.nome })),
    };
  });
}

/* =========================================================
   Administração da estrutura do menu
   ========================================================= */

const nome = (rotulo: string) => z.string().trim().min(1, `Informe o nome do ${rotulo}.`).max(80);
const icone = z
  .string()
  .regex(/^cil[A-Za-z0-9]+$/, 'Ícone inválido.')
  .nullable()
  .default(null);

/** Grupos de acesso do grupo/subgrupo do menu; ausente = não mexe (cliente antigo). */
const gruposAcesso = z.array(z.number().int().positive()).max(500).optional();
const grupoSchema = z.object({ nome: nome('grupo'), icone, grupos: gruposAcesso });
const subgrupoSchema = z.object({
  menuGrupoId: z.number().int().positive(),
  subgrupoPaiId: z.number().int().positive().nullable().default(null),
  nome: nome('subgrupo'),
  grupos: gruposAcesso,
});

/** Grava os grupos de acesso de um grupo ou subgrupo do menu. */
async function gravarAcesso(tipo: 'grupo' | 'subgrupo', id: number, grupos: number[] | undefined) {
  if (grupos === undefined) return;
  const tabela = tipo === 'grupo' ? 'menu_grupo_permissao' : 'menu_subgrupo_permissao';
  const coluna = tipo === 'grupo' ? 'menu_grupo_id' : 'menu_subgrupo_id';
  await query(`DELETE FROM ${tabela} WHERE ${coluna} = $1`, [id]);
  if (grupos.length) {
    await query(`INSERT INTO ${tabela} (${coluna}, grupo_usuario_id) SELECT $1, g.id FROM grupos_usuarios g WHERE g.id = ANY($2::int[])`, [id, grupos]);
  }
}
const painelSchema = z.object({
  menuSubgrupoId: z.number().int().positive(),
  nome: z.string().trim().min(1, 'Informe o nome do painel.').max(120),
  descricao: z
    .string()
    .trim()
    .max(255)
    .nullable()
    .default(null)
    .transform((v) => v || null),
  ativo: z.boolean().default(true),
  grupos: listaIds,
  /** Painel de análise: público no subgrupo ou privado (os de sempre ficam em "grupos") */
  visibilidade: z.enum(['grupos', 'subgrupo', 'privado']).optional(),
  /** Publicar uma análise como painel (só na criação; a análise precisa ser de quem publica) */
  analiseId: z.number().int().positive().nullable().optional(),
});
const reordenarSchema = z.object({
  tipo: z.enum(['grupo', 'subgrupo', 'painel']),
  ids: z.array(z.number().int().positive()).min(1).max(1000),
});

const TABELA = { grupo: 'menu_grupos', subgrupo: 'menu_subgrupos', painel: 'paineis' } as const;

const DUPLICADO = {
  grupo: 'Já existe um grupo de menu com esse nome.',
  subgrupo: 'Já existe um subgrupo com esse nome neste mesmo nível.',
  painel: 'Já existe um painel com esse nome neste subgrupo.',
};

export async function rotasMenuAdmin(app: FastifyInstance) {
  app.addHook('preHandler', somenteAdmin);

  const auditar = (request: any, acao: string, detalhes: Record<string, unknown>) =>
    registrarAuditoria({ usuarioId: request.user.sub, acao, entidade: 'menu', detalhes, ip: request.ip });

  /** Árvore completa, incluindo níveis vazios e painéis inativos. Privados de outras pessoas só para o Desenvolvedor. */
  app.get('/arvore', async (request) => {
    const dev = request.user.perfil === 'desenvolvedor';
    const [{ grupos, subgrupos }, { rows: paineis }, { rows: acessoGrupo }, { rows: acessoSub }] = await Promise.all([
      carregarEstrutura(),
      query(
        `SELECT p.id, p.menu_subgrupo_id, p.nome, p.descricao, p.ativo, p.analise_id AS "analiseId", p.visibilidade,
                u.nome AS "donoNome",
                COALESCE(array_agg(pp.grupo_usuario_id ORDER BY pp.grupo_usuario_id)
                         FILTER (WHERE pp.grupo_usuario_id IS NOT NULL), '{}') AS grupos
           FROM paineis p
           LEFT JOIN painel_permissao pp ON pp.painel_id = p.id
           LEFT JOIN usuarios u ON u.id = p.dono_id
          WHERE $1::boolean OR p.visibilidade <> 'privado' OR p.dono_id = $2
          GROUP BY p.id, u.nome
          ORDER BY p.ordem, LOWER(p.nome)`,
        [dev, request.user.sub],
      ),
      query('SELECT menu_grupo_id AS id, grupo_usuario_id AS g FROM menu_grupo_permissao'),
      query('SELECT menu_subgrupo_id AS id, grupo_usuario_id AS g FROM menu_subgrupo_permissao'),
    ]);
    const acesso = (lista: { id: number; g: number }[], id: number) => lista.filter((x) => x.id === id).map((x) => x.g).sort((a, b) => a - b);
    const montar = (paiId: number | null, grupoId: number, nivel: number): any[] =>
      subgrupos
        .filter((s) => s.menu_grupo_id === grupoId && s.subgrupo_pai_id === paiId)
        .map((s) => ({
          id: s.id,
          nome: s.nome,
          nivel,
          grupos: acesso(acessoSub, s.id),
          subgrupos: montar(s.id, grupoId, nivel + 1),
          paineis: paineis
            .filter((p) => p.menu_subgrupo_id === s.id)
            .map((p) => ({
              id: p.id,
              nome: p.nome,
              descricao: p.descricao,
              ativo: p.ativo,
              grupos: p.grupos,
              analiseId: p.analiseId ?? null,
              visibilidade: p.visibilidade,
              donoNome: p.donoNome,
            })),
        }));
    return grupos.map((g) => ({ id: g.id, nome: g.nome, icone: g.icone, grupos: acesso(acessoGrupo, g.id), subgrupos: montar(null, g.id, 1) }));
  });

  /* ---------- Grupos do menu ---------- */
  app.post('/grupos', async (request, reply) => {
    const d = validar(grupoSchema, request.body, reply);
    if (!d) return;
    try {
      const { rows } = await query(
        `INSERT INTO menu_grupos (nome, icone, ordem)
         VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM menu_grupos)) RETURNING id`,
        [d.nome, d.icone],
      );
      await gravarAcesso('grupo', rows[0].id, d.grupos);
      await auditar(request, 'menu_grupo_criado', { id: rows[0].id, nome: d.nome });
      return reply.code(201).send({ id: rows[0].id });
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: DUPLICADO.grupo });
      throw e;
    }
  });

  app.put('/grupos/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(grupoSchema, request.body, reply);
    if (!d) return;
    try {
      const { rowCount } = await query('UPDATE menu_grupos SET nome = $2, icone = $3 WHERE id = $1', [id, d.nome, d.icone]);
      if (!rowCount) return reply.code(404).send({ erro: 'Grupo de menu não encontrado.' });
      await gravarAcesso('grupo', id, d.grupos);
      await auditar(request, 'menu_grupo_alterado', { id, nome: d.nome, grupos: d.grupos });
      return { id };
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: DUPLICADO.grupo });
      throw e;
    }
  });

  app.delete('/grupos/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('SELECT COUNT(*) AS n FROM menu_subgrupos WHERE menu_grupo_id = $1', [id]);
    if (Number(rows[0].n) > 0) {
      return reply.code(409).send({ erro: 'Este grupo ainda tem subgrupos. Exclua ou mova os subgrupos antes.' });
    }
    const { rowCount } = await query('DELETE FROM menu_grupos WHERE id = $1', [id]);
    if (!rowCount) return reply.code(404).send({ erro: 'Grupo de menu não encontrado.' });
    await auditar(request, 'menu_grupo_excluido', { id });
    return reply.code(204).send();
  });

  /* ---------- Subgrupos ---------- */

  /**
   * Confere o destino de um subgrupo (novo ou movido):
   * o pai precisa estar no mesmo grupo, não pode ser ele mesmo nem um descendente,
   * e a árvore resultante não pode passar de MAX_NIVEIS_SUBGRUPO níveis.
   */
  async function validarDestino(menuGrupoId: number, paiId: number | null, movendoId: number | null) {
    const { rows: g } = await query('SELECT 1 FROM menu_grupos WHERE id = $1', [menuGrupoId]);
    if (!g[0]) return 'Grupo de menu não encontrado.';
    const { subgrupos } = await carregarEstrutura();
    let nivelPai = 0;
    if (paiId) {
      const pai = subgrupos.find((s) => s.id === paiId);
      if (!pai) return 'Subgrupo de destino não encontrado.';
      if (pai.menu_grupo_id !== menuGrupoId) return 'O subgrupo de destino pertence a outro grupo do menu.';
      const caminho = caminhoDo(paiId, subgrupos);
      if (movendoId && caminho.some((s) => s.id === movendoId)) {
        return 'Não é possível mover um subgrupo para dentro dele mesmo.';
      }
      nivelPai = caminho.length;
    }
    // Altura da subárvore que está sendo movida (1 = só ele)
    const altura = (id: number): number =>
      1 + Math.max(0, ...subgrupos.filter((s) => s.subgrupo_pai_id === id).map((s) => altura(s.id)));
    const alturaMovida = movendoId ? altura(movendoId) : 1;
    if (nivelPai + alturaMovida > MAX_NIVEIS_SUBGRUPO) {
      return `O menu aceita até ${MAX_NIVEIS_SUBGRUPO} níveis de subgrupo abaixo do grupo.`;
    }
    return null;
  }

  const proximaOrdem = `(SELECT COALESCE(MAX(ordem), -1) + 1 FROM menu_subgrupos
                          WHERE menu_grupo_id = $1 AND subgrupo_pai_id IS NOT DISTINCT FROM $2::int)`;

  app.post('/subgrupos', async (request, reply) => {
    const d = validar(subgrupoSchema, request.body, reply);
    if (!d) return;
    const problema = await validarDestino(d.menuGrupoId, d.subgrupoPaiId, null);
    if (problema) return reply.code(400).send({ erro: problema });
    try {
      const { rows } = await query(
        `INSERT INTO menu_subgrupos (menu_grupo_id, subgrupo_pai_id, nome, ordem)
         VALUES ($1, $2, $3, ${proximaOrdem}) RETURNING id`,
        [d.menuGrupoId, d.subgrupoPaiId, d.nome],
      );
      await gravarAcesso('subgrupo', rows[0].id, d.grupos);
      await auditar(request, 'menu_subgrupo_criado', { id: rows[0].id, nome: d.nome });
      return reply.code(201).send({ id: rows[0].id });
    } catch (e) {
      if (ehDuplicado(e)) return reply.code(409).send({ erro: DUPLICADO.subgrupo });
      throw e;
    }
  });

  app.put('/subgrupos/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const d = validar(subgrupoSchema, request.body, reply);
    if (!d) return;
    const { rows: atual } = await query('SELECT * FROM menu_subgrupos WHERE id = $1', [id]);
    if (!atual[0]) return reply.code(404).send({ erro: 'Subgrupo não encontrado.' });
    const mudouLugar = atual[0].menu_grupo_id !== d.menuGrupoId || atual[0].subgrupo_pai_id !== d.subgrupoPaiId;
    if (mudouLugar) {
      const problema = await validarDestino(d.menuGrupoId, d.subgrupoPaiId, id);
      if (problema) return reply.code(400).send({ erro: problema });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE menu_subgrupos
            SET nome = $2,
                ordem = CASE WHEN $3::boolean
                             THEN (SELECT COALESCE(MAX(ordem), -1) + 1 FROM menu_subgrupos
                                    WHERE menu_grupo_id = $4 AND subgrupo_pai_id IS NOT DISTINCT FROM $5::int)
                             ELSE ordem END,
                menu_grupo_id = $4,
                subgrupo_pai_id = $5
          WHERE id = $1`,
        [id, d.nome, mudouLugar, d.menuGrupoId, d.subgrupoPaiId],
      );
      if (mudouLugar) {
        // Leva junto tudo o que está dentro dele para o novo grupo
        await client.query(
          `WITH RECURSIVE desc_ AS (
             SELECT id FROM menu_subgrupos WHERE subgrupo_pai_id = $1
             UNION ALL
             SELECT s.id FROM menu_subgrupos s JOIN desc_ d ON s.subgrupo_pai_id = d.id
           )
           UPDATE menu_subgrupos SET menu_grupo_id = $2 WHERE id IN (SELECT id FROM desc_)`,
          [id, d.menuGrupoId],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if (ehDuplicado(e)) return reply.code(409).send({ erro: DUPLICADO.subgrupo });
      throw e;
    } finally {
      client.release();
    }
    await gravarAcesso('subgrupo', id, d.grupos);
    await auditar(request, 'menu_subgrupo_alterado', { id, nome: d.nome, movido: mudouLugar, grupos: d.grupos });
    return { id };
  });

  app.delete('/subgrupos/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query(
      `SELECT (SELECT COUNT(*) FROM paineis WHERE menu_subgrupo_id = $1) AS paineis,
              (SELECT COUNT(*) FROM menu_subgrupos WHERE subgrupo_pai_id = $1) AS filhos`,
      [id],
    );
    if (Number(rows[0].filhos) > 0) {
      return reply.code(409).send({ erro: 'Este subgrupo tem subgrupos dentro dele. Exclua ou mova esses subgrupos antes.' });
    }
    if (Number(rows[0].paineis) > 0) {
      return reply.code(409).send({ erro: 'Este subgrupo ainda tem painéis. Exclua ou mova os painéis antes.' });
    }
    const { rowCount } = await query('DELETE FROM menu_subgrupos WHERE id = $1', [id]);
    if (!rowCount) return reply.code(404).send({ erro: 'Subgrupo não encontrado.' });
    await auditar(request, 'menu_subgrupo_excluido', { id });
    return reply.code(204).send();
  });

  /* ---------- Painéis ---------- */
  const salvarPainel = async (request: any, reply: any, id: number | null) => {
    const d = validar(painelSchema, request.body, reply);
    if (!d) return;
    const client = await pool.connect();
    let painelId = id;
    try {
      await client.query('BEGIN');
      if (painelId) {
        if (d.visibilidade) {
          // Só painel de análise usa público/privado; os montados seguem por grupos de acesso
          await client.query(
            `UPDATE paineis SET visibilidade = CASE WHEN analise_id IS NULL THEN 'grupos' ELSE $2 END WHERE id = $1`,
            [painelId, d.visibilidade === 'grupos' ? 'subgrupo' : d.visibilidade],
          );
        }
        const { rowCount } = await client.query(
          `UPDATE paineis SET nome = $2, descricao = $3, ativo = $4, atualizado_em = NOW(),
                  ordem = CASE WHEN menu_subgrupo_id <> $5
                               THEN (SELECT COALESCE(MAX(ordem), -1) + 1 FROM paineis WHERE menu_subgrupo_id = $5)
                               ELSE ordem END,
                  menu_subgrupo_id = $5
            WHERE id = $1`,
          [painelId, d.nome, d.descricao, d.ativo, d.menuSubgrupoId],
        );
        if (!rowCount) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ erro: 'Painel não encontrado.' });
        }
      } else {
        if (d.analiseId) {
          const { rows: a } = await client.query('SELECT 1 FROM analises WHERE id = $1 AND usuario_id = $2', [d.analiseId, request.user.sub]);
          if (!a[0]) {
            await client.query('ROLLBACK');
            return reply.code(404).send({ erro: 'Análise não encontrada. Só o dono pode publicar a análise.' });
          }
        }
        const { rows } = await client.query(
          `INSERT INTO paineis (menu_subgrupo_id, nome, descricao, ativo, ordem, analise_id, dono_id, visibilidade)
           VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM paineis WHERE menu_subgrupo_id = $1), $5, $6, $7)
           RETURNING id`,
          [
            d.menuSubgrupoId,
            d.nome,
            d.descricao,
            d.ativo,
            d.analiseId ?? null,
            request.user.sub,
            d.analiseId ? (d.visibilidade === 'privado' ? 'privado' : 'subgrupo') : 'grupos',
          ],
        );
        painelId = rows[0].id as number;
      }
      await client.query('DELETE FROM painel_permissao WHERE painel_id = $1', [painelId]);
      if (d.grupos.length) {
        await client.query(
          `INSERT INTO painel_permissao (painel_id, grupo_usuario_id)
           SELECT $1, g.id FROM grupos_usuarios g WHERE g.id = ANY($2::int[])`,
          [painelId, d.grupos],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if (ehDuplicado(e)) {
        const jaPublicada = (e as any)?.constraint === 'paineis_analise_uidx';
        return reply.code(409).send({ erro: jaPublicada ? 'Esta análise já está publicada como painel.' : DUPLICADO.painel });
      }
      if ((e as any)?.code === '23503') return reply.code(400).send({ erro: 'Subgrupo não encontrado.' });
      throw e;
    } finally {
      client.release();
    }
    await auditar(request, id ? 'painel_alterado' : 'painel_criado', { id: painelId, nome: d.nome, grupos: d.grupos });
    return reply.code(id ? 200 : 201).send({ id: painelId });
  };

  app.post('/paineis', (request, reply) => salvarPainel(request, reply, null));

  app.put('/paineis/:id', (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    return salvarPainel(request, reply, id);
  });

  app.delete('/paineis/:id', async (request, reply) => {
    const id = lerId(request.params, reply);
    if (!id) return;
    const { rows } = await query('DELETE FROM paineis WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) return reply.code(404).send({ erro: 'Painel não encontrado.' });
    await auditar(request, 'painel_excluido', { id, nome: rows[0].nome });
    return reply.code(204).send();
  });

  /* ---------- Ordem ---------- */
  app.post('/reordenar', async (request, reply) => {
    const d = validar(reordenarSchema, request.body, reply);
    if (!d) return;
    await query(
      `UPDATE ${TABELA[d.tipo]} t SET ordem = x.ordem
         FROM unnest($1::int[]) WITH ORDINALITY AS x(id, ordem)
        WHERE t.id = x.id`,
      [d.ids],
    );
    return { ok: true };
  });
}
