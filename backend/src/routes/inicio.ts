import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { autenticado } from '../lib/auth.js';
import { validar } from '../lib/http.js';
import { enviar, erroDaResposta, ErroIa, modelosSemToolChoice, textoDoLog } from '../paineis/ia.js';
import { carregarAnalise, dadosDaAnaliseSalva } from './analises.js';
import { SQL_VISIVEIS, usuarioAtivo } from './menu.js';
import { calcular, filtrosDoPainel, visuaisDoPainel } from './paineis.js';

/* =========================================================
   Página inicial: resumo dos painéis e análises mais usados.
   Modos (escolhidos em Configurações):
   - variacao: os números de cada visual e a variação desde o acesso anterior;
   - mudancas: só os visuais cujo número mudou;
   - ia: um texto curto por painel, escrito pela IA a partir dos números
     agregados (totais e até 10 categorias; nunca linhas de tabela);
   - desligado.
   ========================================================= */

const MAX_ITENS = 4;
const MAX_VISUAIS = 8;
const MAX_CATEGORIAS_IA = 10;

export const MODOS_RESUMO = ['variacao', 'mudancas', 'ia', 'desligado'] as const;

interface Metrica {
  chave: string;
  titulo: string;
  tipo: string;
  formato: string;
  /** Número principal: o valor do indicador ou o total do gráfico */
  valor: number | null;
  anterior: number | null;
  desde: string | null;
  /** Complemento: maior categoria, último ponto da linha */
  detalhe: string | null;
  /** Só para a IA: as maiores categorias */
  categorias?: { nome: string; valor: number }[];
  erro?: string;
}

interface Item {
  tipo: 'painel' | 'analise';
  id: number;
  nome: string;
  link: string;
  acessos: number;
  visuais: Metrica[];
}

/** Dia de hoje no fuso das agendas (AAAA-MM-DD). */
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.fusoAgenda }).format(new Date());

const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reduz os dados de um visual a um número principal (e um complemento). */
function metrica(chave: string, v: { tipo: string; titulo: string; config: any }, dados: any): Omit<Metrica, 'anterior' | 'desde'> | null {
  const formato = v.config?.formato ?? 'numero';
  const base = { chave, titulo: v.titulo, tipo: v.tipo, formato };
  if (!dados) return null;
  if (v.tipo === 'kpi') return { ...base, valor: numero(dados.valor), detalhe: null };
  if (v.tipo === 'pizza') {
    const fatias = (dados.fatias ?? []) as { nome: string; valor: number }[];
    const total = fatias.reduce((s, f) => s + (numero(f.valor) ?? 0), 0);
    const maior = [...fatias].sort((a, b) => b.valor - a.valor)[0];
    return {
      ...base,
      valor: total,
      detalhe: maior && total ? `Maior fatia: ${maior.nome} (${Math.round((maior.valor / total) * 100)}%)` : null,
      categorias: fatias.slice(0, MAX_CATEGORIAS_IA).map((f) => ({ nome: String(f.nome), valor: f.valor })),
    };
  }
  if (v.tipo === 'barra' || v.tipo === 'linha') {
    const serie = dados.series?.[0];
    const cats: string[] = dados.categorias ?? [];
    if (!serie) return null;
    const valores = (serie.valores as (number | null)[]).map((x) => numero(x) ?? 0);
    const pares = cats.map((c, i) => ({ nome: String(c), valor: valores[i] ?? 0 }));
    if (v.tipo === 'linha') {
      // Evolução: o último ponto é o número que interessa
      const ultimo = pares.at(-1);
      return {
        ...base,
        valor: ultimo?.valor ?? null,
        detalhe: ultimo ? `Último ponto: ${ultimo.nome}${pares.length > 1 ? ` (anterior ${pares.at(-2)!.nome})` : ''}` : null,
        categorias: pares.slice(-MAX_CATEGORIAS_IA),
      };
    }
    const total = valores.reduce((s, x) => s + x, 0);
    const maior = [...pares].sort((a, b) => b.valor - a.valor)[0];
    return {
      ...base,
      valor: total,
      detalhe: maior ? `Maior: ${maior.nome}` : null,
      categorias: [...pares].sort((a, b) => b.valor - a.valor).slice(0, MAX_CATEGORIAS_IA),
    };
  }
  return null; // tabela: detalhe linha a linha não entra no resumo
}

/** Painéis e análises mais abertos nos últimos 60 dias que o usuário ainda pode ver. */
async function maisUsados(usuarioId: number, veTudo: boolean, dev: boolean) {
  const { rows } = await query<{ acao: string; id: number; n: number }>(
    `SELECT acao, (detalhes->>'id')::int AS id, COUNT(*)::int AS n
       FROM auditoria
      WHERE usuario_id = $1 AND acao IN ('painel_acessado', 'analise_acessada') AND data_hora > NOW() - interval '60 days'
      GROUP BY 1, 2 ORDER BY n DESC, MAX(data_hora) DESC LIMIT 20`,
    [usuarioId],
  );
  const itens: { tipo: 'painel' | 'analise'; id: number; nome: string; acessos: number; analiseId: number | null }[] = [];
  for (const r of rows) {
    if (itens.length >= MAX_ITENS) break;
    if (r.acao === 'painel_acessado') {
      const { rows: p } = await query(`${SQL_VISIVEIS} AND p.id = $3`, [usuarioId, veTudo, r.id]);
      if (p[0]) itens.push({ tipo: 'painel', id: p[0].id, nome: p[0].nome, acessos: r.n, analiseId: p[0].analise_id });
    } else {
      const a = await carregarAnalise(r.id, dev ? undefined : usuarioId);
      // A análise publicada já aparece pelo painel, se ele estiver na lista
      if (a && !itens.some((x) => x.analiseId === a.id)) itens.push({ tipo: 'analise', id: a.id, nome: a.nome, acessos: r.n, analiseId: a.id });
    }
  }
  return itens;
}

/** Calcula os visuais de um painel ou análise com os filtros iniciais e devolve as métricas. */
async function metricasDo(item: { tipo: 'painel' | 'analise'; id: number; analiseId: number | null }, usuarioId: number) {
  let visuais: { tipo: string; titulo: string; config: any }[];
  let resultados: { id: number | string; dados?: any; erro?: string }[];
  if (item.analiseId) {
    const a = await carregarAnalise(item.analiseId);
    if (!a) return [];
    visuais = a.visuais;
    resultados = await dadosDaAnaliseSalva(a, a.filtros ?? {}, item.tipo === 'analise' ? usuarioId : undefined);
  } else {
    const [filtros, vs] = await Promise.all([filtrosDoPainel(item.id), visuaisDoPainel(item.id)]);
    visuais = vs;
    resultados = await calcular(vs, filtros, {});
  }
  const prefixo = `${item.tipo === 'painel' ? 'p' : 'a'}${item.id}`;
  const saida: Omit<Metrica, 'anterior' | 'desde'>[] = [];
  visuais.forEach((v, i) => {
    if (saida.length >= MAX_VISUAIS) return;
    const r = resultados[i];
    // Chave estável: tipo + título (a posição muda quando alguém remonta o painel)
    const chave = `${prefixo}:${v.tipo}:${v.titulo}`.slice(0, 120);
    if (r?.erro) {
      if (v.tipo !== 'tabela') saida.push({ chave, titulo: v.titulo, tipo: v.tipo, formato: v.config?.formato ?? 'numero', valor: null, detalhe: null, erro: r.erro });
      return;
    }
    const m = metrica(chave, v, r?.dados);
    if (m) saida.push(m);
  });
  return saida;
}

/** Junta o valor do acesso anterior (o último dia antes de hoje) e guarda o de hoje. */
async function comVariacao(usuarioId: number, metricas: Omit<Metrica, 'anterior' | 'desde'>[]): Promise<Metrica[]> {
  if (!metricas.length) return [];
  const dia = hoje();
  const chaves = metricas.map((m) => m.chave);
  const { rows: antes } = await query<{ chave: string; valor: string | null; registrado_em: Date }>(
    `SELECT DISTINCT ON (chave) chave, valor, registrado_em FROM resumo_valores
      WHERE usuario_id = $1 AND chave = ANY($2::text[]) AND dia < $3::date
      ORDER BY chave, dia DESC`,
    [usuarioId, chaves, dia],
  );
  const validas = metricas.filter((m) => !m.erro);
  if (validas.length) {
    await query(
      `INSERT INTO resumo_valores (usuario_id, chave, dia, valor)
       SELECT $1, c, $3::date, v FROM unnest($2::text[], $4::numeric[]) AS t(c, v)
       ON CONFLICT (usuario_id, chave, dia) DO UPDATE SET valor = EXCLUDED.valor, registrado_em = NOW()`,
      [usuarioId, validas.map((m) => m.chave), dia, validas.map((m) => m.valor)],
    );
  }
  return metricas.map((m) => {
    const a = antes.find((x) => x.chave === m.chave);
    return { ...m, anterior: a?.valor === null || a?.valor === undefined ? null : Number(a.valor), desde: a ? new Date(a.registrado_em).toISOString() : null };
  });
}

const mudou = (m: Metrica) => m.anterior !== null && m.valor !== null && Math.abs(m.valor - m.anterior) > 1e-9;

/* ---------- Resumo por IA ---------- */

const FERRAMENTA = {
  name: 'resumir_paineis',
  description: 'Devolve um resumo curto, em português do Brasil, para cada painel.',
  input_schema: {
    type: 'object',
    properties: {
      resumos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'O identificador do painel, exatamente como recebido' },
            texto: { type: 'string', description: 'Duas a quatro frases sobre o que os números mostram e o que mudou' },
          },
          required: ['item', 'texto'],
        },
      },
    },
    required: ['resumos'],
  },
} as const;

async function resumirComIa(itens: Item[]): Promise<{ textos: Record<string, string>; tokens: { entrada: number | null; saida: number | null } }> {
  if (!config.anthropicApiKey) throw new ErroIa('A IA não está configurada neste servidor.', 503);
  const blocos = itens.map((it) => {
    const linhas = it.visuais
      .filter((v) => !v.erro)
      .map((v) => {
        const partes = [`- ${v.titulo} (${v.tipo}, formato ${v.formato}): ${v.valor ?? 'sem valor'}`];
        if (v.anterior !== null) partes.push(`antes ${v.anterior}`);
        if (v.categorias?.length) partes.push(`categorias: ${v.categorias.map((c) => `${c.nome}=${c.valor}`).join('; ')}`);
        return partes.join(' | ');
      });
    return `[${it.tipo}:${it.id}] ${it.nome}\n${linhas.join('\n') || '(sem números)'}`;
  });
  const sistema = `Você escreve o resumo da página inicial de uma ferramenta de BI de uma empresa de logística.
Para cada painel abaixo, escreva de duas a quatro frases curtas, em português do Brasil, destacando os números principais e o que mudou desde o acesso anterior ("antes"), com a variação em percentual quando houver.
Formatos: moeda = reais (R$), percentual = já está em %, inteiro = quantidade. Arredonde (ex.: R$ 3,3 milhões).
Não invente números nem causas; use só o que está aqui. Sem títulos nem listas. Responda chamando a ferramenta resumir_paineis.

${blocos.join('\n\n')}`;
  const modelo = config.anthropicModelo;
  const base = { model: modelo, max_tokens: 2000, tools: [FERRAMENTA], messages: [{ role: 'user', content: 'Escreva o resumo de cada painel.' }] };
  const semObrigar = { ...base, system: `${sistema}\n\nChame a ferramenta uma única vez, sem texto fora dela.`, tool_choice: { type: 'auto' } };
  let r = modelosSemToolChoice.has(modelo) ? await enviar(semObrigar) : await enviar({ ...base, system: sistema, tool_choice: { type: 'tool', name: FERRAMENTA.name } });
  if (r.resposta.status === 400 && /tool_choice/i.test(r.corpo?.error?.message ?? '') && !modelosSemToolChoice.has(modelo)) {
    modelosSemToolChoice.add(modelo);
    r = await enviar(semObrigar);
  }
  if (!r.resposta.ok) throw erroDaResposta(r.resposta, r.corpo, modelo);
  const uso = r.corpo?.content?.find((c: any) => c.type === 'tool_use');
  let resumos: any[] = uso?.input?.resumos ?? [];
  if (!uso) {
    const texto = (r.corpo?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    try {
      resumos = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)).resumos ?? [];
    } catch {
      resumos = [];
    }
  }
  const textos: Record<string, string> = {};
  for (const x of resumos) if (typeof x?.item === 'string' && typeof x?.texto === 'string') textos[x.item.replace(/^\[|\]$/g, '')] = x.texto.slice(0, 800);
  return { textos, tokens: { entrada: r.corpo?.usage?.input_tokens ?? null, saida: r.corpo?.usage?.output_tokens ?? null } };
}

export async function rotasInicio(app: FastifyInstance) {
  app.addHook('preHandler', autenticado);

  app.get('/resumo', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const usuarioId = request.user.sub;
    const u = await usuarioAtivo(usuarioId);
    if (!u) return reply.code(401).send({ erro: 'Usuário inativo.' });
    const { rows: pref } = await query<{ resumo_inicio: (typeof MODOS_RESUMO)[number] }>('SELECT resumo_inicio FROM usuarios WHERE id = $1', [usuarioId]);
    const modo = pref[0]?.resumo_inicio ?? 'variacao';
    if (modo === 'desligado') return { modo, itens: [] };

    const lista = await maisUsados(usuarioId, u.veTudo, u.dev);
    const itens: Item[] = [];
    for (const it of lista) {
      try {
        const visuais = await comVariacao(usuarioId, await metricasDo(it, usuarioId));
        itens.push({
          tipo: it.tipo,
          id: it.id,
          nome: it.nome,
          link: it.tipo === 'painel' ? `/painel/${it.id}` : `/analises/${it.id}/ver`,
          acessos: it.acessos,
          visuais,
        });
      } catch (e) {
        itens.push({ tipo: it.tipo, id: it.id, nome: it.nome, link: '', acessos: it.acessos, visuais: [{ chave: 'erro', titulo: '', tipo: '', formato: 'numero', valor: null, anterior: null, desde: null, detalhe: null, erro: (e as Error).message }] });
      }
    }
    const semCategorias = (x: Item[]) => x.map((i) => ({ ...i, visuais: i.visuais.map(({ categorias: _c, ...v }) => v) }));

    if (modo === 'mudancas') {
      return { modo, itens: semCategorias(itens.map((i) => ({ ...i, visuais: i.visuais.filter(mudou) })).filter((i) => i.visuais.length)), totalItens: itens.length };
    }
    if (modo !== 'ia') return { modo, itens: semCategorias(itens) };

    // IA: guardado por dia; "atualizar" gera de novo (conta no limite diário)
    const atualizar = (request.query as { atualizar?: string }).atualizar === '1';
    const dia = hoje();
    let textos: Record<string, string> | null = null;
    let geradoEm: string | null = null;
    let aviso: string | null = null;
    let detalhe: string | null = null;
    const { rows: guardado } = await query('SELECT textos, gerado_em FROM resumo_ia WHERE usuario_id = $1 AND dia = $2', [usuarioId, dia]);
    const chaves = itens.map((i) => `${i.tipo}:${i.id}`);
    if (guardado[0] && !atualizar && chaves.every((k) => k in guardado[0].textos)) {
      textos = guardado[0].textos;
      geradoEm = new Date(guardado[0].gerado_em).toISOString();
    } else if (itens.length) {
      const { rows: n } = await query<{ n: string }>(`SELECT COUNT(*) AS n FROM ia_log WHERE usuario_id = $1 AND criado_em >= date_trunc('day', NOW())`, [usuarioId]);
      if (Number(n[0].n) >= config.iaLimiteDiario) aviso = `Você atingiu o limite de ${config.iaLimiteDiario} pedidos à IA hoje. Mostrando os números.`;
      else {
        const inicio = Date.now();
        try {
          const r = await resumirComIa(itens);
          textos = r.textos;
          geradoEm = new Date().toISOString();
          await query(
            `INSERT INTO resumo_ia (usuario_id, dia, textos) VALUES ($1, $2, $3)
             ON CONFLICT (usuario_id, dia) DO UPDATE SET textos = EXCLUDED.textos, gerado_em = NOW()`,
            [usuarioId, dia, JSON.stringify(textos)],
          );
          await query(
            `INSERT INTO ia_log (usuario_id, pedido, sucesso, modelo, tokens_entrada, tokens_saida, duracao_ms) VALUES ($1, $2, TRUE, $3, $4, $5, $6)`,
            [usuarioId, 'Resumo da página inicial', config.anthropicModelo, r.tokens.entrada, r.tokens.saida, Date.now() - inicio],
          ).catch(() => undefined);
        } catch (e) {
          aviso = `${(e as Error).message} Mostrando os números.`;
          if (e instanceof ErroIa && request.user.perfil !== 'usuario') detalhe = e.detalhe;
          await query(`INSERT INTO ia_log (usuario_id, pedido, sucesso, erro, modelo, duracao_ms) VALUES ($1, $2, FALSE, $3, $4, $5)`, [
            usuarioId,
            'Resumo da página inicial',
            textoDoLog(e as Error),
            config.anthropicModelo,
            Date.now() - inicio,
          ]).catch(() => undefined);
        }
      }
    }
    return {
      modo,
      itens: semCategorias(itens).map((i) => ({ ...i, texto: textos?.[`${i.tipo}:${i.id}`] ?? null })),
      geradoEm,
      aviso,
      detalhe,
    };
  });

  /** Configurações pessoais (por enquanto, o resumo da página inicial). */
  app.get('/configuracoes', async (request) => {
    const { rows } = await query('SELECT resumo_inicio FROM usuarios WHERE id = $1', [request.user.sub]);
    return { resumoInicio: rows[0]?.resumo_inicio ?? 'variacao', iaDisponivel: !!config.anthropicApiKey };
  });

  app.put('/configuracoes', async (request, reply) => {
    const d = validar(z.object({ resumoInicio: z.enum(MODOS_RESUMO) }), request.body, reply);
    if (!d) return;
    await query('UPDATE usuarios SET resumo_inicio = $2, atualizado_em = NOW() WHERE id = $1', [request.user.sub, d.resumoInicio]);
    return d;
  });
}
