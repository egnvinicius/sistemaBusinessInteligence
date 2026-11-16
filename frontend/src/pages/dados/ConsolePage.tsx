import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CLoadingButton,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CNav,
  CNavItem,
  CNavLink,
  CSpinner,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilMediaPlay, cilWarning } from '@coreui/icons';
import { api, AUTOMATICO, mensagemDeErro, obterAccessToken } from '../../api/client';
import { EditorSql } from '../../components/EditorSql';
import { useAvisos } from '../../contexts/AvisosContext';
import { formatarDataHora } from '../../lib/formato';

/* ---------- Tipos da API ---------- */

type TipoComando = 'consulta' | 'insercao' | 'alteracao' | 'exclusao' | 'estrutura' | 'outro';

interface Transacao {
  id: string;
  iniciadaEm: string;
  comandos: number;
  desfeitaAutomaticamenteEm: string;
}

interface Resultado {
  comando: string;
  tipo: TipoComando;
  linhasAfetadas: number | null;
  colunas: { nome: string; tipo: 'numero' | 'texto' | 'data' | 'outro' }[];
  linhas: unknown[][];
  truncado: boolean;
}

interface Uso {
  tabela: string;
  comando: string;
  usadoPor: { tipo: string; nome: string }[];
}

interface ItemLog {
  id: number;
  dataHora: string;
  usuario: string;
  destino: string;
  tipo: TipoComando | null;
  comando: string;
  linhas: number | null;
  duracaoMs: number | null;
  sucesso: boolean;
  erro: string | null;
  gravacao: 'direto' | 'confirmada' | 'desfeita' | 'pendente' | null;
}

type ValorParam = { tipo: 'texto' | 'numero' | 'data'; valor: string };

const NOMES_TIPO: Record<TipoComando, string> = {
  consulta: 'Consulta',
  insercao: 'Inserção',
  alteracao: 'Alteração',
  exclusao: 'Exclusão',
  estrutura: 'Estrutura',
  outro: 'Outro',
};

const GRAVACAO: Record<NonNullable<ItemLog['gravacao']>, { texto: string; cor: string }> = {
  direto: { texto: 'Gravado', cor: 'success' },
  confirmada: { texto: 'Confirmado', cor: 'success' },
  desfeita: { texto: 'Desfeito', cor: 'secondary' },
  pendente: { texto: 'Em transação', cor: 'warning' },
};

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const numero = new Intl.NumberFormat('pt-BR');
const duracao = (ms: number | null) => (ms === null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

/** Desfaz a transação ao fechar/recarregar a aba (fetch keepalive sobrevive ao fechamento). */
function sairSemEsperar() {
  const token = obterAccessToken();
  fetch('/api/console/transacao/sair', {
    method: 'POST',
    keepalive: true,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => undefined);
}

export function ConsolePage() {
  const avisar = useAvisos();
  const location = useLocation();
  const vindo = (location.state ?? {}) as { sql?: string; destino?: number };

  const [aba, setAba] = useState<'editor' | 'historico'>('editor');
  const [conexoes, setConexoes] = useState<{ id: number; nome: string; banco: string }[]>([]);
  const [restrito, setRestrito] = useState(true);
  const [limite, setLimite] = useState(1000);
  const [destino, setDestino] = useState<string>(vindo.destino ? String(vindo.destino) : 'bi_dados');
  const [sql, setSql] = useState(vindo.sql ?? '');
  const [transacao, setTransacao] = useState<Transacao | null>(null);
  const transacaoRef = useRef<Transacao | null>(null);
  transacaoRef.current = transacao;

  const [executando, setExecutando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [resumo, setResumo] = useState<{ duracaoMs: number; destino: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(0);

  const [pedirParams, setPedirParams] = useState<string[] | null>(null);
  const [params, setParams] = useState<Record<string, ValorParam>>({});
  const [aviso, setAviso] = useState<Uso[] | null>(null);
  const [acaoTransacao, setAcaoTransacao] = useState<'iniciar' | 'confirmar' | 'desfazer' | null>(null);

  const ehOrigem = destino !== 'bi_dados';
  const nomeDestino = ehOrigem ? (conexoes.find((c) => String(c.id) === destino)?.nome ?? 'Conexão') : 'bi_dados';

  useEffect(() => {
    api
      .get('/console/estado')
      .then((r) => {
        setConexoes(r.data.conexoes);
        setRestrito(r.data.usuarioRestrito);
        setLimite(r.data.limiteLinhas);
        setTransacao(r.data.transacao);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
    // Se veio de uma ação, os parâmetros @ são pedidos ao executar
  }, []);

  // Sair da tela (ou fechar o navegador) desfaz a transação aberta
  useEffect(() => {
    const antesDeFechar = (e: BeforeUnloadEvent) => {
      if (!transacaoRef.current) return;
      sairSemEsperar();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', antesDeFechar);
    return () => {
      window.removeEventListener('beforeunload', antesDeFechar);
      if (transacaoRef.current) {
        api.post('/console/transacao/sair').catch(() => undefined);
        avisar('A transação do Console SQL foi desfeita porque você saiu da tela.', 'erro');
      }
    };
  }, [avisar]);

  // Verifica de tempos em tempos se a transação foi desfeita por inatividade
  useEffect(() => {
    if (!transacao) return;
    const t = window.setInterval(async () => {
      try {
        const r = await api.get('/console/estado', AUTOMATICO);
        if (!r.data.transacao) {
          setTransacao(null);
          setErro('A transação ficou 10 minutos sem uso e foi desfeita automaticamente. Nada do que foi executado nela foi gravado.');
        } else setTransacao(r.data.transacao);
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    }, 30_000);
    return () => window.clearInterval(t);
  }, [transacao?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const executar = useCallback(
    async (opcoes: { confirmado?: boolean; parametros?: Record<string, ValorParam> } = {}) => {
      if (!sql.trim() || executando) return;
      setExecutando(true);
      setErro(null);
      try {
        const corpo = {
          destino: ehOrigem ? Number(destino) : 'bi_dados',
          sql,
          confirmado: !!opcoes.confirmado,
          ...(opcoes.parametros ? { parametros: Object.fromEntries(Object.entries(opcoes.parametros).map(([k, v]) => [k, { tipo: v.tipo, valor: v.valor === '' ? null : v.valor }])) } : {}),
        };
        const r = await api.post('/console/executar', corpo);
        setResultados(r.data.resultados);
        setResumo({ duracaoMs: r.data.duracaoMs, destino: nomeDestino });
        setAtivo(Math.max(0, r.data.resultados.findIndex((x: Resultado) => x.colunas.length)));
        if (!ehOrigem) setTransacao(r.data.transacao);
      } catch (e: any) {
        const d = e?.response?.data;
        if (e?.response?.status === 409 && d?.aviso) {
          setAviso(d.usos);
        } else if (d?.parametrosFaltando) {
          setParams((p) => Object.fromEntries(d.parametrosFaltando.map((n: string) => [n, p[n] ?? { tipo: 'texto', valor: '' }])));
          setPedirParams(d.parametrosFaltando);
        } else {
          setErro(mensagemDeErro(e));
          if (d?.transacaoEncerrada) setTransacao(null);
        }
      } finally {
        setExecutando(false);
      }
    },
    [sql, destino, ehOrigem, executando, nomeDestino],
  );

  // Ctrl+Enter executa
  const executarRef = useRef(executar);
  executarRef.current = executar;
  const ultimosParams = useRef<Record<string, ValorParam> | undefined>(undefined);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && aba === 'editor') {
        e.preventDefault();
        executarRef.current({ parametros: ultimosParams.current });
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aba]);

  const controlarTransacao = async (acao: 'iniciar' | 'confirmar' | 'desfazer') => {
    setErro(null);
    try {
      const r = await api.post(`/console/transacao/${acao}`);
      if (acao === 'iniciar') {
        setTransacao(r.data.transacao);
        avisar('Transação iniciada. Os comandos só serão gravados quando você confirmar.');
      } else {
        setTransacao(null);
        avisar(acao === 'confirmar' ? 'Transação confirmada: as alterações foram gravadas.' : 'Transação desfeita: nada foi gravado.');
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
      if (acao !== 'iniciar') {
        const r = await api.get('/console/estado').catch(() => null);
        setTransacao(r?.data.transacao ?? null);
      }
    } finally {
      setAcaoTransacao(null);
    }
  };

  const abrirNoEditor = (item: ItemLog) => {
    if (transacao && item.destino !== 'bi_dados') {
      avisar('Feche a transação antes de trocar para uma conexão de origem.', 'erro');
      return;
    }
    setSql(item.comando);
    const cx = conexoes.find((c) => c.nome === item.destino);
    setDestino(item.destino === 'bi_dados' ? 'bi_dados' : cx ? String(cx.id) : 'bi_dados');
    setAba('editor');
  };

  const r = resultados?.[ativo];

  return (
    <>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">Console SQL</h1>
          <p className="pagina-descricao">
            Consultas e comandos no bi_dados. Nas conexões de origem, só consultas (somente leitura). Tudo fica registrado no histórico.
          </p>
        </div>
      </div>

      {!restrito && (
        <CAlert color="warning" className="d-flex gap-2 align-items-start">
          <CIcon icon={cilWarning} className="flex-shrink-0 mt-1" />
          <div>
            O console está usando o usuário principal do banco, porque não foi possível criar o usuário restrito <code>bi_dados_app</code>. Os
            comandos têm acesso total ao servidor PostgreSQL.
          </div>
        </CAlert>
      )}

      <CNav variant="underline-border" role="tablist" className="mb-4">
        <CNavItem>
          <CNavLink as="button" role="tab" active={aba === 'editor'} aria-selected={aba === 'editor'} onClick={() => setAba('editor')}>
            Editor
          </CNavLink>
        </CNavItem>
        <CNavItem>
          <CNavLink as="button" role="tab" active={aba === 'historico'} aria-selected={aba === 'historico'} onClick={() => setAba('historico')}>
            Histórico
          </CNavLink>
        </CNavItem>
      </CNav>

      {aba === 'historico' ? (
        <Historico onAbrir={abrirNoEditor} />
      ) : (
        <>
          {transacao && (
            <div className="console-transacao" role="status">
              <div>
                <strong>Transação aberta</strong>
                <span>
                  {transacao.comandos === 0
                    ? 'Nenhum comando executado ainda.'
                    : transacao.comandos === 1 ? '1 execução, ainda não gravada.' : `${transacao.comandos} execuções, ainda não gravadas.`}{' '}
                  Sem uso, ela é desfeita às {hora.format(new Date(transacao.desfeitaAutomaticamenteEm))}. Sair desta tela também desfaz.
                </span>
              </div>
              <div className="console-transacao-botoes">
                <CButton color="success" onClick={() => setAcaoTransacao('confirmar')}>
                  Confirmar
                </CButton>
                <CButton color="secondary" variant="outline" onClick={() => setAcaoTransacao('desfazer')}>
                  Desfazer
                </CButton>
              </div>
            </div>
          )}

          <CCard className="mb-3">
            <div className="console-barra">
              <div className="console-destino">
                <CFormLabel htmlFor="c-destino" className="mb-0">
                  Executar em
                </CFormLabel>
                <CFormSelect
                  id="c-destino"
                  value={destino}
                  disabled={!!transacao}
                  title={transacao ? 'Feche a transação para trocar de destino.' : undefined}
                  onChange={(e) => {
                    setDestino(e.target.value);
                    setResultados(null);
                  }}
                >
                  <option value="bi_dados">bi_dados (PostgreSQL)</option>
                  {conexoes.length > 0 && (
                    <optgroup label="Conexões de origem (somente leitura)">
                      {conexoes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome} · {c.banco}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </CFormSelect>
              </div>
              <div className="console-barra-acoes">
                {!ehOrigem && !transacao && (
                  <CButton color="secondary" variant="outline" onClick={() => setAcaoTransacao('iniciar')}>
                    Iniciar transação
                  </CButton>
                )}
                <CLoadingButton color="primary" loading={executando} disabled={!sql.trim()} onClick={() => executar({ parametros: ultimosParams.current })}>
                  <CIcon icon={cilMediaPlay} className="me-1" />
                  Executar
                </CLoadingButton>
              </div>
            </div>
            <EditorSql
              id="c-sql"
              rotuloAria="Comando SQL"
              dialeto={ehOrigem ? 'sqlserver' : 'postgres'}
              valor={sql}
              onChange={(v) => {
                setSql(v);
                ultimosParams.current = undefined;
              }}
              altura="260px"
            />
            <div className="console-dica">
              Ctrl+Enter executa · Vários comandos separados por ; rodam em sequência · Consultas mostram até {numero.format(limite)} linhas
            </div>
          </CCard>

          {erro && (
            <CAlert color="danger" className="console-erro">
              {erro}
            </CAlert>
          )}

          {executando && !resultados && (
            <div className="py-4 text-center">
              <CSpinner color="primary" />
            </div>
          )}

          {resultados && resumo && (
            <CCard>
              <CCardBody>
                <div className="console-resumo">
                  <span>
                    {resultados.length === 1 ? '1 comando' : `${resultados.length} comandos`} em {resumo.destino} · {duracao(resumo.duracaoMs)}
                    {transacao && ' · dentro da transação'}
                  </span>
                </div>
                {resultados.length > 1 && (
                  <div className="console-comandos" role="tablist" aria-label="Resultados por comando">
                    {resultados.map((x, i) => (
                      <button key={i} type="button" role="tab" aria-selected={i === ativo} className={i === ativo ? 'ativo' : ''} onClick={() => setAtivo(i)}>
                        {i + 1}. {x.comando || NOMES_TIPO[x.tipo]}
                        <span>{x.colunas.length ? `${numero.format(x.linhas.length)} linhas` : x.linhasAfetadas !== null ? `${numero.format(x.linhasAfetadas)} afetadas` : 'ok'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {r && <GradeResultado r={r} limite={limite} />}
              </CCardBody>
            </CCard>
          )}
        </>
      )}

      {/* Parâmetros @ do comando */}
      <CModal visible={!!pedirParams} onClose={() => setPedirParams(null)} alignment="center">
        <CModalHeader>
          <CModalTitle>Valores dos parâmetros</CModalTitle>
        </CModalHeader>
        <CModalBody>
          <p className="text-body-secondary small">Em branco vale NULL.</p>
          {pedirParams?.map((n) => (
            <div key={n} className="console-param">
              <CFormLabel htmlFor={`p-${n}`} className="mb-0">
                <code>@{n}</code>
              </CFormLabel>
              <CFormSelect
                aria-label={`Tipo de @${n}`}
                value={params[n]?.tipo ?? 'texto'}
                onChange={(e) => setParams((p) => ({ ...p, [n]: { ...p[n], tipo: e.target.value as ValorParam['tipo'] } }))}
              >
                <option value="texto">Texto</option>
                <option value="numero">Número</option>
                <option value="data">Data</option>
              </CFormSelect>
              <CFormInput
                id={`p-${n}`}
                type={params[n]?.tipo === 'data' ? 'date' : 'text'}
                inputMode={params[n]?.tipo === 'numero' ? 'decimal' : undefined}
                value={params[n]?.valor ?? ''}
                onChange={(e) => setParams((p) => ({ ...p, [n]: { ...p[n], valor: e.target.value } }))}
              />
            </div>
          ))}
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={() => setPedirParams(null)}>
            Cancelar
          </CButton>
          <CButton
            color="primary"
            onClick={() => {
              ultimosParams.current = params;
              setPedirParams(null);
              executar({ parametros: params });
            }}
          >
            Executar
          </CButton>
        </CModalFooter>
      </CModal>

      {/* Aviso: tabela usada por ações ou painéis */}
      <CModal visible={!!aviso} onClose={() => setAviso(null)} alignment="center">
        <CModalHeader>
          <CModalTitle>Esta tabela está em uso</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {aviso?.map((u) => (
            <div key={u.tabela + u.comando} className="mb-3">
              <p className="mb-1">
                <strong>{u.comando}</strong> em <code>{u.tabela}</code>, que é usada por:
              </p>
              <ul className="mb-0">
                {u.usadoPor.map((x) => (
                  <li key={x.tipo + x.nome}>
                    {x.tipo}: {x.nome}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mb-0 text-body-secondary">
            {transacao ? 'Como há uma transação aberta, ainda dá para desfazer depois.' : 'Sem transação, a alteração é gravada na hora.'}
          </p>
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={() => setAviso(null)}>
            Cancelar
          </CButton>
          <CButton
            color="danger"
            onClick={() => {
              setAviso(null);
              executar({ confirmado: true, parametros: ultimosParams.current });
            }}
          >
            Executar mesmo assim
          </CButton>
        </CModalFooter>
      </CModal>

      {/* Confirmação dos botões de transação */}
      <CModal visible={!!acaoTransacao} onClose={() => setAcaoTransacao(null)} alignment="center">
        <CModalHeader>
          <CModalTitle>
            {acaoTransacao === 'iniciar' ? 'Iniciar transação' : acaoTransacao === 'confirmar' ? 'Confirmar transação' : 'Desfazer transação'}
          </CModalTitle>
        </CModalHeader>
        <CModalBody>
          {acaoTransacao === 'iniciar' &&
            'Os próximos comandos no bi_dados ficam pendentes até você confirmar ou desfazer. Enquanto a transação estiver aberta, as tabelas alteradas podem ficar bloqueadas para as cargas e os painéis.'}
          {acaoTransacao === 'confirmar' && `Gravar ${transacao?.comandos === 1 ? 'o comando executado' : `os ${transacao?.comandos} comandos executados`} na transação?`}
          {acaoTransacao === 'desfazer' && 'Descartar tudo o que foi executado na transação? Nada será gravado.'}
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="ghost" onClick={() => setAcaoTransacao(null)}>
            Voltar
          </CButton>
          <CButton
            color={acaoTransacao === 'confirmar' ? 'success' : acaoTransacao === 'desfazer' ? 'danger' : 'primary'}
            onClick={() => acaoTransacao && controlarTransacao(acaoTransacao)}
          >
            {acaoTransacao === 'iniciar' ? 'Iniciar' : acaoTransacao === 'confirmar' ? 'Confirmar' : 'Desfazer'}
          </CButton>
        </CModalFooter>
      </CModal>
    </>
  );
}

/* ---------- Grade de resultado ---------- */

function celula(v: unknown) {
  if (v === null || v === undefined) return <span className="console-nulo">NULL</span>;
  if (v instanceof Object) return JSON.stringify(v);
  return String(v);
}

function GradeResultado({ r, limite }: { r: Resultado; limite: number }) {
  if (!r.colunas.length) {
    return (
      <p className="console-afetadas">
        <strong>{r.comando || NOMES_TIPO[r.tipo]}</strong>{' '}
        {r.linhasAfetadas !== null ? `· ${numero.format(r.linhasAfetadas)} ${r.linhasAfetadas === 1 ? 'linha afetada' : 'linhas afetadas'}` : '· executado'}
      </p>
    );
  }
  return (
    <>
      <p className="console-afetadas">
        {numero.format(r.linhas.length)} {r.linhas.length === 1 ? 'linha' : 'linhas'}
        {r.truncado && ` · mostrando só as primeiras ${numero.format(limite)}. Use WHERE ou LIMIT para ver o resto.`}
      </p>
      <div className="console-grade" tabIndex={0} aria-label="Resultado da consulta">
        <table>
          <thead>
            <tr>
              <th className="console-n">#</th>
              {r.colunas.map((c, i) => (
                <th key={i} className={c.tipo === 'numero' ? 'num' : ''}>
                  {c.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.linhas.map((l, i) => (
              <tr key={i}>
                <td className="console-n">{i + 1}</td>
                {l.map((v, j) => (
                  <td key={j} className={r.colunas[j]?.tipo === 'numero' ? 'num' : ''}>
                    {celula(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- Histórico ---------- */

function Historico({ onAbrir }: { onAbrir: (i: ItemLog) => void }) {
  const [f, setF] = useState({ usuarioId: '', tipo: '', destino: '', de: '', ate: '', texto: '' });
  const [itens, setItens] = useState<ItemLog[] | null>(null);
  const [usuarios, setUsuarios] = useState<{ id: number; nome: string }[]>([]);
  const [destinos, setDestinos] = useState<string[]>([]);
  const [pagina, setPagina] = useState(1);
  const [temMais, setTemMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  const consulta = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v)), [f]);

  const carregar = useCallback(
    async (pag: number) => {
      try {
        const r = await api.get('/console/log', { params: { ...consulta, pagina: pag } });
        setItens((atual) => (pag === 1 ? r.data.itens : [...(atual ?? []), ...r.data.itens]));
        setTemMais(r.data.temMais);
        setUsuarios(r.data.usuarios);
        setDestinos(r.data.destinos);
        setPagina(pag);
        setErro(null);
      } catch (e) {
        setErro(mensagemDeErro(e));
      }
    },
    [consulta],
  );

  useEffect(() => {
    const t = window.setTimeout(() => carregar(1), f.texto ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [carregar, f.texto]);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <CCard>
      <CCardBody>
        <div className="console-filtros">
          <CFormInput aria-label="Buscar no comando" placeholder="Buscar no comando" value={f.texto} onChange={(e) => set('texto', e.target.value)} />
          <CFormSelect aria-label="Usuário" value={f.usuarioId} onChange={(e) => set('usuarioId', e.target.value)}>
            <option value="">Todos os usuários</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </CFormSelect>
          <CFormSelect aria-label="Tipo de comando" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
            <option value="">Todos os tipos</option>
            {Object.entries(NOMES_TIPO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </CFormSelect>
          <CFormSelect aria-label="Destino" value={f.destino} onChange={(e) => set('destino', e.target.value)}>
            <option value="">Todos os destinos</option>
            {destinos.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </CFormSelect>
          <div className="console-periodo">
            <CFormInput type="date" aria-label="De" value={f.de} onChange={(e) => set('de', e.target.value)} />
            <span>até</span>
            <CFormInput type="date" aria-label="Até" value={f.ate} onChange={(e) => set('ate', e.target.value)} />
          </div>
        </div>

        {erro && <CAlert color="danger">{erro}</CAlert>}
        {!itens ? (
          <div className="py-4 text-center">
            <CSpinner color="primary" />
          </div>
        ) : itens.length === 0 ? (
          <p className="lista-vazia">Nenhum comando encontrado.</p>
        ) : (
          <ul className="console-log">
            {itens.map((i) => (
              <li key={i.id} className={i.sucesso ? '' : 'falhou'}>
                <div className="console-log-cabeca">
                  <span className="console-log-quando">{formatarDataHora(i.dataHora)}</span>
                  <span>{i.usuario}</span>
                  <span className="text-body-secondary">{i.destino}</span>
                  {i.tipo && <CBadge color="secondary" className="console-tipo">{NOMES_TIPO[i.tipo]}</CBadge>}
                  {!i.sucesso ? (
                    <CBadge color="danger">Erro</CBadge>
                  ) : (
                    i.gravacao && <CBadge color={GRAVACAO[i.gravacao].cor}>{GRAVACAO[i.gravacao].texto}</CBadge>
                  )}
                  <span className="console-log-numeros">
                    {i.linhas !== null && i.sucesso && `${numero.format(i.linhas)} ${i.tipo === 'consulta' ? 'lidas' : 'afetadas'}`}
                    {i.duracaoMs !== null && ` · ${duracao(i.duracaoMs)}`}
                  </span>
                  <CButton size="sm" color="secondary" variant="ghost" onClick={() => onAbrir(i)}>
                    Abrir no editor
                  </CButton>
                </div>
                <button type="button" className="console-log-sql" aria-expanded={aberto === i.id} onClick={() => setAberto(aberto === i.id ? null : i.id)}>
                  {aberto === i.id ? i.comando : i.comando.replace(/\s+/g, ' ').slice(0, 220) + (i.comando.length > 220 ? '…' : '')}
                </button>
                {!i.sucesso && i.erro && <div className="console-log-erro">{i.erro}</div>}
              </li>
            ))}
          </ul>
        )}
        {temMais && (
          <div className="text-center mt-3">
            <CButton color="secondary" variant="outline" onClick={() => carregar(pagina + 1)}>
              Carregar mais
            </CButton>
          </div>
        )}
      </CCardBody>
    </CCard>
  );
}
