import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CAlert,
  CBadge,
  CBreadcrumb,
  CBreadcrumbItem,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CFormInput,
  CFormLabel,
  CLoadingButton,
  CSpinner,
} from '@coreui/react-pro';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { EditorSql } from '../../components/EditorSql';
import { useAvisos } from '../../contexts/AvisosContext';
import type { ConsultaPainel } from './ConsultasPage';
import type { FiltroCadastro } from './FiltrosPage';

interface Teste {
  colunas: { nome: string; tipo: string }[];
  linhas: Record<string, unknown>[];
  truncado: boolean;
  duracaoMs: number;
  filtros: { parametro: string; nome: string; tipo: string }[];
  valores: Record<string, unknown>;
}

const EXEMPLO = `SELECT to_char(dt_emissao, 'YYYY-MM') AS mes,
       filial,
       SUM(vl_faturado) AS faturado
  FROM vendas.faturamento
 WHERE (@ANO IS NULL OR EXTRACT(YEAR FROM dt_emissao) = @ANO)
   AND (@FILIAIS IS NULL OR cd_filial = ANY(@FILIAIS))
 GROUP BY 1, 2`;

export function ConsultaPage() {
  const { id } = useParams();
  const nova = id === 'nova';
  const navigate = useNavigate();
  const avisar = useAvisos();
  const [f, setF] = useState({ nome: '', descricao: '', sql: '' });
  const [original, setOriginal] = useState(f);
  const [consulta, setConsulta] = useState<ConsultaPainel | null>(null);
  const [filtros, setFiltros] = useState<FiltroCadastro[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(nova);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<Teste | null>(null);
  const [erroTeste, setErroTeste] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const alterado = JSON.stringify(f) !== JSON.stringify(original);

  useEffect(() => {
    api.get<FiltroCadastro[]>('/catalogo/filtros').then((r) => setFiltros(r.data)).catch(() => undefined);
    if (nova) return;
    api
      .get<ConsultaPainel>(`/catalogo/consultas/${id}`)
      .then((r) => {
        const v = { nome: r.data.nome, descricao: r.data.descricao ?? '', sql: r.data.sql ?? '' };
        setF(v);
        setOriginal(v);
        setConsulta(r.data);
        setCarregado(true);
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [id, nova]);

  // Parâmetros escritos no SQL, conferidos contra os filtros cadastrados (só para orientar; o servidor valida de novo)
  const usados = useMemo(() => {
    const semTexto = f.sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/gm, '');
    return [...new Set([...semTexto.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1].toUpperCase()))];
  }, [f.sql]);
  const disponiveis = useMemo(() => new Map(filtros.flatMap((x) => x.parametrosSql.map((p) => [p.toUpperCase(), x]))), [filtros]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = { nome: f.nome, descricao: f.descricao || null, sql: f.sql };
      const r = nova ? await api.post<ConsultaPainel>('/catalogo/consultas', corpo) : await api.put<ConsultaPainel>(`/catalogo/consultas/${id}`, corpo);
      const v = { nome: r.data.nome, descricao: r.data.descricao ?? '', sql: r.data.sql ?? '' };
      setF(v);
      setOriginal(v);
      setConsulta(r.data);
      avisar(nova ? 'Consulta criada.' : 'Consulta salva.');
      if (nova) navigate(`/construcao/consultas/${r.data.id}`, { replace: true });
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    setErroTeste(null);
    try {
      const r = await api.post<Teste>('/catalogo/consultas/testar', { sql: f.sql });
      setTeste(r.data);
    } catch (e) {
      setTeste(null);
      setErroTeste(mensagemDeErro(e));
    } finally {
      setTestando(false);
    }
  };

  if (!carregado) {
    return erro ? (
      <CAlert color="danger">{erro}</CAlert>
    ) : (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  return (
    <>
      <CBreadcrumb className="mb-2">
        <CBreadcrumbItem>
          <Link to="/construcao/consultas">Consultas de painel</Link>
        </CBreadcrumbItem>
        <CBreadcrumbItem active>{nova ? 'Nova consulta' : original.nome}</CBreadcrumbItem>
      </CBreadcrumb>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">{nova ? 'Nova consulta' : f.nome || 'Consulta'}</h1>
          {consulta && consulta.paineis.length > 0 && (
            <p className="pagina-descricao">Usada em {consulta.paineis.map((p) => p.nome).join(', ')}.</p>
          )}
        </div>
        {!nova && (
          <CButton color="danger" variant="outline" onClick={() => setExcluindo(true)}>
            Excluir
          </CButton>
        )}
      </div>

      <div className="consulta-layout">
        <div>
          <CCard className="mb-3">
            <CCardBody>
              <div className="row g-3">
                <div className="col-md-5">
                  <CFormLabel htmlFor="q-nome">Nome</CFormLabel>
                  <CFormInput id="q-nome" value={f.nome} maxLength={120} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Faturamento por mês e filial" />
                </div>
                <div className="col-md-7">
                  <CFormLabel htmlFor="q-desc">Descrição (aparece para quem monta o painel)</CFormLabel>
                  <CFormInput id="q-desc" value={f.descricao} maxLength={255} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
                </div>
              </div>
            </CCardBody>
          </CCard>
          <CCard className="mb-3">
            <CCardHeader className="d-flex justify-content-between align-items-center">
              <span>SELECT no bi_dados (PostgreSQL)</span>
              {!f.sql && (
                <CButton size="sm" color="secondary" variant="ghost" onClick={() => setF({ ...f, sql: EXEMPLO })}>
                  Usar exemplo
                </CButton>
              )}
            </CCardHeader>
            <EditorSql id="q-sql" rotuloAria="SQL da consulta" dialeto="postgres" valor={f.sql} onChange={(v) => setF({ ...f, sql: v })} altura="340px" />
          </CCard>
          {erro && <CAlert color="danger">{erro}</CAlert>}
          <div className="barra-acoes">
            <CLoadingButton color="primary" loading={salvando} disabled={!alterado || !f.nome.trim() || !f.sql.trim()} onClick={salvar}>
              {nova ? 'Criar consulta' : 'Salvar alterações'}
            </CLoadingButton>
            <CLoadingButton color="secondary" variant="outline" loading={testando} disabled={!f.sql.trim()} onClick={testar}>
              Testar
            </CLoadingButton>
            {alterado && <span className="barra-acoes-aviso">Alterações não salvas</span>}
          </div>

          {erroTeste && <CAlert color="danger" className="mt-3 console-erro">{erroTeste}</CAlert>}
          {teste && (
            <CCard className="mt-3">
              <CCardBody>
                <p className="console-afetadas">
                  {teste.linhas.length} {teste.linhas.length === 1 ? 'linha' : 'linhas'}
                  {teste.truncado && ' (mostrando as primeiras 500)'} · {teste.duracaoMs} ms
                  {Object.keys(teste.valores).length > 0 && (
                    <>
                      {' '}
                      · filtros no valor inicial:{' '}
                      {Object.entries(teste.valores)
                        .map(([k, v]) => `@${k} = ${v === null ? 'todos' : Array.isArray(v) ? v.join(', ') : String(v)}`)
                        .join('; ')}
                    </>
                  )}
                </p>
                <div className="console-grade">
                  <table>
                    <thead>
                      <tr>
                        {teste.colunas.map((c) => (
                          <th key={c.nome} className={c.tipo === 'numero' ? 'num' : ''}>
                            {c.nome} <span className="text-body-secondary fw-normal">({c.tipo})</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teste.linhas.map((l, i) => (
                        <tr key={i}>
                          {teste.colunas.map((c) => (
                            <td key={c.nome} className={c.tipo === 'numero' ? 'num' : ''}>
                              {l[c.nome] === null || l[c.nome] === undefined ? <span className="console-nulo">NULL</span> : String(l[c.nome])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CCardBody>
            </CCard>
          )}
        </div>

        <aside className="consulta-ajuda">
          <h2>Filtros no SQL</h2>
          <p>
            Cada filtro do painel chega como <code>@PARAMETRO</code>. Filtro em branco vale <code>NULL</code>, que deve significar “todos”:
          </p>
          <pre>{`(@ANO IS NULL OR EXTRACT(YEAR FROM data) = @ANO)`}</pre>
          <p>Seleção múltipla chega como lista:</p>
          <pre>{`(@FILIAIS IS NULL OR cd_filial = ANY(@FILIAIS))`}</pre>
          <p>Período gera dois parâmetros:</p>
          <pre>{`(@EMISSAO_INI IS NULL OR data >= @EMISSAO_INI)
AND (@EMISSAO_FIM IS NULL OR data <= @EMISSAO_FIM)`}</pre>
          <h3>Neste SQL</h3>
          {usados.length === 0 ? (
            <p className="text-body-secondary">Nenhum parâmetro.</p>
          ) : (
            <ul className="consulta-params">
              {usados.map((p) => {
                const filtro = disponiveis.get(p);
                return (
                  <li key={p}>
                    <code>@{p}</code>{' '}
                    {filtro ? (
                      <span className="text-body-secondary">{filtro.nome}</span>
                    ) : (
                      <CBadge color="danger">sem filtro cadastrado</CBadge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <h3>Disponíveis</h3>
          {filtros.length === 0 ? (
            <p className="text-body-secondary">
              Nenhum. <Link to="/construcao/filtros">Cadastre filtros</Link>.
            </p>
          ) : (
            <ul className="consulta-params">
              {filtros.map((x) => (
                <li key={x.id}>
                  {x.parametrosSql.map((p) => (
                    <code key={p} className="me-1">
                      @{p}
                    </code>
                  ))}
                  <span className="text-body-secondary">{x.nome}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <Confirmar
        visivel={excluindo}
        titulo="Excluir consulta?"
        acao="Excluir consulta"
        perigoso
        onFechar={() => setExcluindo(false)}
        onConfirmar={async () => {
          try {
            await api.delete(`/catalogo/consultas/${id}`);
            avisar('Consulta excluída.');
            navigate('/construcao/consultas');
          } catch (e) {
            setExcluindo(false);
            setErro(mensagemDeErro(e));
          }
        }}
      >
        A consulta <strong>{f.nome}</strong> será excluída. Só é possível se nenhum painel a usar.
      </Confirmar>
    </>
  );
}
