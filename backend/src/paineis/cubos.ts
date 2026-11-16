import { query } from '../db/pool.js';
import { parametrosUsados } from '../lib/sqlParametros.js';
import { usuarioAtivo } from '../routes/menu.js';
import { colunasDaAcao } from './cuboTabela.js';
import { carregarFiltros, parametrosDoFiltro, type Filtro } from './filtros.js';
import type { ColunaCubo } from './ia.js';

/* =========================================================
   Cubos: dados liberados por grupo para as análises.
   Origem: a tabela de uma ação (atual) ou uma consulta de painel (antigos).
   ========================================================= */

export interface CuboLinha {
  id: number;
  nome: string;
  descricao: string | null;
  /** Consulta efetiva: a da consulta de painel, ou um id próprio do cubo (cubos de ação) */
  consulta_id: number;
  colunas_descricao: Record<string, string>;
  ativo: boolean;
  /** SQL da consulta de painel (vazio nos cubos de ação) */
  sql: string;
  colunas: { nome: string; tipo: 'numero' | 'texto' | 'data' }[];
  /** Cubo de ação: tabela já com aspas ("schema"."tabela"); null nos cubos de consulta */
  tabela: string | null;
}

/** Id de "consulta" dos cubos de ação (só identifica os visuais; não colide com consultas de painel). */
export const ID_BASE_ACAO = 1_000_000_000;

export const SQL_CUBO = `
  SELECT c.*, q.sql, q.colunas AS colunas_consulta, a.tabela_destino
    FROM cubos c
    LEFT JOIN consultas_painel q ON q.id = c.consulta_id
    LEFT JOIN acoes a ON a.id = c.acao_id`;

/** Completa a linha do banco: nos cubos de ação, as colunas vêm da tabela da ação. */
export async function montarCubo(r: any): Promise<CuboLinha> {
  if (r.acao_id) {
    const { tabela, colunas } = await colunasDaAcao(r.tabela_destino ?? '');
    return { ...r, consulta_id: ID_BASE_ACAO + r.id, sql: '', colunas, tabela };
  }
  return { ...r, colunas: r.colunas_consulta ?? [], tabela: null };
}

const SQL_LIBERADO = `($2::boolean OR EXISTS (SELECT 1 FROM cubo_grupos cg JOIN usuario_grupo ug ON ug.grupo_usuario_id = cg.grupo_usuario_id
                                               WHERE cg.cubo_id = c.id AND ug.usuario_id = $1))`;

/** Cubo que o usuário pode usar: ativo e liberado para um dos grupos dele (Gestor e Desenvolvedor veem todos). */
export async function cuboVisivel(usuarioId: number, cuboId: number): Promise<CuboLinha | null> {
  const u = await usuarioAtivo(usuarioId);
  if (!u) return null;
  const { rows } = await query(`${SQL_CUBO} WHERE c.id = $3 AND c.ativo AND ${SQL_LIBERADO}`, [usuarioId, u.veTudo, cuboId]);
  return rows[0] ? montarCubo(rows[0]) : null;
}

/** Cubos ativos que o usuário pode usar. */
export async function cubosVisiveis(usuarioId: number, veTudo: boolean): Promise<CuboLinha[]> {
  const { rows } = await query(`${SQL_CUBO} WHERE c.ativo AND ${SQL_LIBERADO} ORDER BY LOWER(c.nome)`, [usuarioId, veTudo]);
  return Promise.all(rows.map(montarCubo));
}

/**
 * Vários cubos de uma vez. Com usuarioId, só os que ele pode usar; sem, todos os ativos
 * (painel publicado: quem tem acesso ao painel vê a análise, mesmo sem acesso aos cubos).
 * Devolve o id do primeiro cubo que faltar.
 */
export async function carregarCubos(ids: number[], usuarioId?: number): Promise<{ cubos: Map<number, CuboLinha>; faltando: number | null }> {
  const cubos = new Map<number, CuboLinha>();
  for (const id of ids) {
    if (cubos.has(id)) continue;
    let c: CuboLinha | null;
    if (usuarioId) c = await cuboVisivel(usuarioId, id);
    else {
      const { rows } = await query(`${SQL_CUBO} WHERE c.id = $1 AND c.ativo`, [id]);
      c = rows[0] ? await montarCubo(rows[0]) : null;
    }
    if (!c) return { cubos, faltando: id };
    cubos.set(id, c);
  }
  return { cubos, faltando: null };
}

export const colunasDoCubo = (c: CuboLinha): ColunaCubo[] =>
  (c.colunas ?? []).map((x) => ({ ...x, descricao: c.colunas_descricao?.[x.nome] ?? null }));

/** Filtros cadastrados cujos @parâmetros a consulta do cubo usa (só cubos de consulta). */
export async function filtrosDoCubo(c: CuboLinha): Promise<Filtro[]> {
  if (c.tabela) return [];
  const usados = parametrosUsados(c.sql, 'pg').map((p) => p.toLowerCase());
  return (await carregarFiltros()).filter((f) => parametrosDoFiltro(f).some((p) => usados.includes(p.nome.toLowerCase())));
}
