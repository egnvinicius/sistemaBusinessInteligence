import type pg from 'pg';
import { config } from '../config.js';
import { aspas, colunasDaTabela, nomeColuna, normalizarTabela, poolBiDados } from '../db/biDados.js';
import { query } from '../db/pool.js';
import { exibirValor, paraPostgres, parametrosUsados, type ValorParametro } from '../lib/sqlParametros.js';
import { ErroAcesso, ErroInterrompido, origemPara, type ConexaoConfig } from '../origens/tipos.js';
import { carregarConexao, esperar, tipoPostgres } from './comum.js';
import { definicoesEfetivas, resolverParametros } from './parametros.js';
import { invalidarCache } from '../paineis/cache.js';

type Nivel = 'info' | 'aviso' | 'erro';

interface AcaoDaTarefa {
  tarefa_acao_id: number;
  acao_id: number;
  nome: string;
  ordem: number;
  caso_erro: 'continuar' | 'parar';
  tentativas: number;
  ativo: boolean;
  conexao_id: number;
  comando_sql: string;
  comando_limpeza: string | null;
  tabela_destino: string;
  tempo_maximo_min: number;
}

const MAX_PARAMS_PG = 60_000;

const minutos = (ms: number) => Math.round((ms / 60_000) * 10) / 10;

/** Executa uma execução que já está marcada como "executando". */
export async function executarExecucao(execId: number) {
  const log = async (nivel: Nivel, mensagem: string) => {
    await query('INSERT INTO execucao_logs (execucao_id, nivel, mensagem) VALUES ($1, $2, $3)', [execId, nivel, mensagem]).catch(
      () => undefined,
    );
  };
  const finalizar = async (situacao: string, mensagem: string | null) => {
    await query('UPDATE execucoes SET situacao = $2, mensagem = $3, fim = NOW() WHERE id = $1', [execId, situacao, mensagem]);
    // Dados do bi_dados podem ter mudado: os painéis voltam a consultar
    invalidarCache();
  };

  const { rows: e } = await query(
    `SELECT e.*, t.nome AS tarefa_nome, t.max_tentativas_acesso, t.janela_tentativas_min, u.nome AS usuario_nome
       FROM execucoes e JOIN tarefas t ON t.id = e.tarefa_id
       LEFT JOIN usuarios u ON u.id = e.solicitado_por
      WHERE e.id = $1`,
    [execId],
  );
  const exec = e[0];
  if (!exec) return;

  // Pedido de parada: conferido a cada 2 s
  const parada = new AbortController();
  const vigia = setInterval(async () => {
    const { rows } = await query('SELECT cancelar FROM execucoes WHERE id = $1', [execId]).catch(() => ({ rows: [] as any[] }));
    if (rows[0]?.cancelar) parada.abort();
  }, 2_000);

  const politica = {
    max: exec.max_tentativas_acesso as number,
    janelaMs: (exec.janela_tentativas_min as number) * 60_000,
  };

  try {
    const origemTexto =
      exec.origem === 'manual'
        ? `manual${exec.usuario_nome ? `, por ${exec.usuario_nome}` : ''}`
        : exec.origem === 'recuperacao'
          ? 'agenda, executada com atraso após a ferramenta voltar'
          : 'agenda';
    await log('info', `Execução da tarefa ${exec.tarefa_nome} iniciada (${origemTexto}).`);

    const { rows: acoes } = await query<AcaoDaTarefa>(
      `SELECT ta.id AS tarefa_acao_id, a.id AS acao_id, a.nome, ta.ordem, ta.caso_erro, ta.tentativas, a.ativo,
              a.conexao_id, a.comando_sql, a.comando_limpeza, a.tabela_destino, a.tempo_maximo_min
         FROM tarefa_acoes ta JOIN acoes a ON a.id = ta.acao_id
        WHERE ta.tarefa_id = $1 ORDER BY ta.ordem, ta.id`,
      [exec.tarefa_id],
    );
    if (!acoes.length) {
      await log('erro', 'A tarefa não tem ações para executar.');
      return await finalizar('erro', 'A tarefa não tem ações para executar.');
    }

    // Linhas de acompanhamento por ação
    for (const a of acoes) {
      await query(
        `INSERT INTO execucao_acoes (execucao_id, acao_id, acao_nome, ordem, situacao) VALUES ($1, $2, $3, $4, 'pendente')`,
        [execId, a.acao_id, a.nome, a.ordem],
      );
    }

    /* ---------- Parâmetros ---------- */
    let valores: Record<string, ValorParametro>;
    try {
      const defs = await definicoesEfetivas(exec.tarefa_id, exec.agenda_id);
      const precisaConexao = defs.some((d) => d.modo === 'expressao');
      valores = await comTentativasDeAcesso(
        async () => resolverParametros(defs, precisaConexao ? await carregarConexao(acoes[0].conexao_id) : null),
        politica,
        parada.signal,
        log,
      );
      const resumo = Object.entries(valores).map(([n, v]) => `@${n} = ${exibirValor(v.valor)}`);
      await query('UPDATE execucoes SET parametros_json = $2 WHERE id = $1', [
        execId,
        JSON.stringify(Object.fromEntries(Object.entries(valores).map(([n, v]) => [n, exibirValor(v.valor)]))),
      ]);
      if (resumo.length) await log('info', `Parâmetros: ${resumo.join(', ')}.`);
    } catch (err) {
      const msg = mensagemFinal(err, politica);
      await log('erro', msg);
      await query(`UPDATE execucao_acoes SET situacao = 'pulado' WHERE execucao_id = $1`, [execId]);
      return await finalizar(parada.signal.aborted ? 'cancelado' : 'erro', msg);
    }

    /* ---------- Ações em ordem ---------- */
    let falhas = 0;
    let interrompida = false;
    for (const a of acoes) {
      const { rows: linha } = await query<{ id: number }>(
        `UPDATE execucao_acoes SET situacao = 'executando', inicio = NOW()
          WHERE execucao_id = $1 AND acao_id = $2 AND ordem = $3 AND situacao = 'pendente' RETURNING id`,
        [execId, a.acao_id, a.ordem],
      );
      const linhaId = linha[0]?.id;
      if (parada.signal.aborted) {
        interrompida = true;
        break;
      }
      if (!a.ativo) {
        await query(`UPDATE execucao_acoes SET situacao = 'pulado', fim = NOW(), mensagem = 'Ação inativa.' WHERE id = $1`, [linhaId]);
        await log('aviso', `${a.nome}: ação inativa, pulada.`);
        continue;
      }

      let ultimaFalha: unknown = null;
      let tentativa = 0;
      let ok = false;
      while (tentativa < a.tentativas && !ok) {
        tentativa++;
        const t0 = Date.now();
        try {
          await log('info', `${a.nome}: iniciada${a.tentativas > 1 ? ` (tentativa ${tentativa} de ${a.tentativas})` : ''}.`);
          const r = await comTentativasDeAcesso(() => executarAcao(a, valores, parada.signal, log), politica, parada.signal, log);
          await query(
            `UPDATE execucao_acoes SET situacao = 'concluido', fim = NOW(), tentativas = $2,
                    linhas_excluidas = $3, linhas_inseridas = $4, mensagem = NULL WHERE id = $1`,
            [linhaId, tentativa, r.excluidas, r.inseridas],
          );
          await log(
            'info',
            `${a.nome}: concluída em ${minutos(Date.now() - t0)} min (${r.excluidas ?? 0} linha(s) excluída(s), ${r.inseridas} inserida(s)).`,
          );
          ok = true;
        } catch (err) {
          ultimaFalha = err;
          await log('erro', `${a.nome}: ${mensagemFinal(err, politica)}`);
          if (parada.signal.aborted || err instanceof ErroAcesso || (err as Error).message?.startsWith('Tempo de execução excedido')) break;
        }
      }

      if (!ok) {
        if (parada.signal.aborted) {
          await query(`UPDATE execucao_acoes SET situacao = 'cancelado', fim = NOW(), tentativas = $2, mensagem = $3 WHERE id = $1`, [
            linhaId,
            tentativa,
            'Interrompida a pedido de um usuário.',
          ]);
          interrompida = true;
          break;
        }
        falhas++;
        await query(`UPDATE execucao_acoes SET situacao = 'erro', fim = NOW(), tentativas = $2, mensagem = $3 WHERE id = $1`, [
          linhaId,
          tentativa,
          mensagemFinal(ultimaFalha, politica),
        ]);
        if (a.caso_erro === 'parar') {
          await query(
            `UPDATE execucao_acoes SET situacao = 'pulado', mensagem = 'Não executada: uma ação anterior falhou e a regra é parar.'
              WHERE execucao_id = $1 AND situacao = 'pendente'`,
            [execId],
          );
          await log('erro', `Tarefa parada: ${a.nome} falhou e a regra desta ação é "parar".`);
          return await finalizar('erro', `${a.nome}: ${mensagemFinal(ultimaFalha, politica)}`);
        }
      }
    }

    if (interrompida) {
      await query(
        `UPDATE execucao_acoes SET situacao = 'cancelado', mensagem = 'Interrompida a pedido de um usuário.'
          WHERE execucao_id = $1 AND situacao IN ('pendente', 'executando')`,
        [execId],
      );
      await log('aviso', 'Execução interrompida a pedido de um usuário.');
      return await finalizar('cancelado', 'Interrompida a pedido de um usuário.');
    }
    if (falhas) {
      await log('aviso', `Execução concluída com ${falhas} ação(ões) com erro.`);
      return await finalizar('concluido_com_erros', `${falhas} ação(ões) com erro.`);
    }
    await log('info', 'Execução concluída.');
    return await finalizar('concluido', null);
  } catch (err) {
    const msg = `Erro inesperado: ${(err as Error).message}`;
    await log('erro', msg);
    await finalizar('erro', msg).catch(() => undefined);
  } finally {
    clearInterval(vigia);
  }
}

/** Mensagem final de uma falha, já em português. */
function mensagemFinal(err: unknown, politica: { max: number; janelaMs: number }) {
  if (err instanceof ErroAcesso) return err.message;
  return (err as Error)?.message ?? String(err);
}

/**
 * Repete a operação enquanto o servidor estiver inacessível,
 * até o limite da tarefa (número de tentativas ou tempo, o que vier primeiro).
 */
async function comTentativasDeAcesso<T>(
  fn: () => Promise<T>,
  politica: { max: number; janelaMs: number },
  signal: AbortSignal,
  log: (n: Nivel, m: string) => Promise<void>,
): Promise<T> {
  const inicio = Date.now();
  let n = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ErroAcesso)) throw e;
      n++;
      const decorrido = Date.now() - inicio;
      if (n >= politica.max || decorrido >= politica.janelaMs || signal.aborted) {
        throw new ErroAcesso(
          `Não executada: sem acesso ao servidor após ${n} tentativa(s) em ${minutos(decorrido)} min. Último erro: ${e.message}`,
        );
      }
      const espera = config.esperaTentativaMs ?? Math.min(politica.janelaMs / politica.max, politica.janelaMs - decorrido);
      await log('aviso', `${e.message}. Tentativa ${n} de ${politica.max}; nova tentativa em ${Math.round(espera / 1000)} s.`);
      await esperar(espera, signal);
      if (signal.aborted) throw new ErroInterrompido('Interrompida a pedido de um usuário.');
    }
  }
}

/** Uma ação: limpa o período no bi_dados e carrega o resultado do SELECT, tudo numa transação. */
async function executarAcao(
  a: AcaoDaTarefa,
  todos: Record<string, ValorParametro>,
  paradaSignal: AbortSignal,
  log: (n: Nivel, m: string) => Promise<void>,
): Promise<{ excluidas: number | null; inseridas: number }> {
  const destino = normalizarTabela(a.tabela_destino);
  if (!destino) throw new Error(`Nome de tabela de destino inválido: ${a.tabela_destino}`);

  // Só os parâmetros que o SELECT usa; parâmetro usado e não definido é erro claro
  const usados: Record<string, ValorParametro> = {};
  const porNome = new Map(Object.entries(todos).map(([k, v]) => [k.toLowerCase(), [k, v] as const]));
  for (const nome of parametrosUsados(a.comando_sql)) {
    const achado = porNome.get(nome.toLowerCase());
    if (!achado) throw new Error(`O parâmetro @${nome} é usado no SQL, mas não está definido na tarefa.`);
    usados[achado[0]] = achado[1];
  }

  const conexao: ConexaoConfig = await carregarConexao(a.conexao_id);
  const origem = origemPara(conexao.tipo);

  const tempoMs = a.tempo_maximo_min * 60_000;
  const limite = new AbortController();
  const timer = setTimeout(() => limite.abort(), tempoMs);
  const signal = AbortSignal.any([paradaSignal, limite.signal]);

  const client: pg.PoolClient = await poolBiDados.connect();
  let inseridas = 0;
  let excluidas: number | null = null;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Math.floor(tempoMs)}`);

    let colunasTabela = (await colunasDaTabela(destino.schema, destino.tabela, client)).map((c) => c.column_name);

    // Primeira execução: cria a tabela a partir das colunas do SELECT
    if (!colunasTabela.length) {
      const cols = await origem.descrever(conexao, a.comando_sql, usados);
      const defs = cols.map((c) => `${aspas(nomeColuna(c.nome))} ${tipoPostgres(c.tipoOrigem)}`);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${aspas(destino.schema)}`);
      await client.query(`CREATE TABLE ${aspas(destino.schema)}.${aspas(destino.tabela)} (${defs.join(', ')})`);
      colunasTabela = cols.map((c) => nomeColuna(c.nome));
      await log('info', `${a.nome}: tabela ${destino.completo} criada com ${cols.length} coluna(s).`);
    } else if (a.comando_limpeza?.trim()) {
      const { texto, params } = paraPostgres(a.comando_limpeza, todos);
      const r = await client.query(texto, params);
      excluidas = r.rowCount ?? 0;
    } else {
      // Sem comando de limpeza: carga completa (substitui todo o conteúdo, sem duplicar)
      const r = await client.query(`DELETE FROM ${aspas(destino.schema)}.${aspas(destino.tabela)}`);
      excluidas = r.rowCount ?? 0;
    }

    let insertSql: (linhas: number) => string = () => '';
    let nCols = 0;
    const tabelaSql = `${aspas(destino.schema)}.${aspas(destino.tabela)}`;

    await origem.consultar(conexao, a.comando_sql, usados, {
      signal,
      aoReceberColunas: (cols) => {
        const nomes = cols.map(nomeColuna);
        const faltamNaTabela = nomes.filter((n) => !colunasTabela.includes(n));
        const faltamNoSelect = colunasTabela.filter((n) => !nomes.includes(n));
        if (faltamNaTabela.length || faltamNoSelect.length) {
          const partes = [];
          if (faltamNaTabela.length) partes.push(`o SELECT traz colunas que a tabela não tem: ${faltamNaTabela.join(', ')}`);
          if (faltamNoSelect.length) partes.push(`a tabela tem colunas que o SELECT não traz: ${faltamNoSelect.join(', ')}`);
          throw new Error(`As colunas não batem com a tabela ${destino.completo}: ${partes.join('; ')}.`);
        }
        nCols = nomes.length;
        const lista = nomes.map(aspas).join(', ');
        insertSql = (qtd) => {
          const valores = Array.from({ length: qtd }, (_, i) =>
            `(${Array.from({ length: nCols }, (_, j) => `$${i * nCols + j + 1}`).join(', ')})`,
          ).join(', ');
          return `INSERT INTO ${tabelaSql} (${lista}) VALUES ${valores}`;
        };
      },
      aoReceberLote: async (linhas) => {
        const porVez = Math.max(1, Math.floor(MAX_PARAMS_PG / Math.max(nCols, 1)));
        for (let i = 0; i < linhas.length; i += porVez) {
          const parte = linhas.slice(i, i + porVez);
          await client.query(insertSql(parte.length), parte.flat());
          inseridas += parte.length;
        }
      },
    });

    if (signal.aborted) throw new ErroInterrompido('Consulta interrompida.');
    await client.query('COMMIT');
    return { excluidas, inseridas };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (limite.signal.aborted && !paradaSignal.aborted) {
      throw new Error(`Tempo de execução excedido (${a.tempo_maximo_min} min). A ação foi interrompida e nada foi alterado.`);
    }
    if (paradaSignal.aborted) throw new ErroInterrompido('Interrompida a pedido de um usuário.');
    const pgErro = e as { code?: string; message?: string };
    if (pgErro.code === '57014') {
      throw new Error(`Tempo de execução excedido (${a.tempo_maximo_min} min). A ação foi interrompida e nada foi alterado.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    client.release();
  }
}
