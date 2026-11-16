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
  CCol,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormSwitch,
  CFormText,
  CLoadingButton,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react-pro';
import { api, mensagemDeErro } from '../../api/client';
import { Confirmar } from '../../components/Confirmar';
import { EditorSql } from '../../components/EditorSql';
import { useAvisos } from '../../contexts/AvisosContext';
import type { Acao, Conexao, ValidacaoAcao } from '../../types';

const VAZIA = {
  nome: '',
  conexaoId: 0,
  comandoSql: '',
  comandoLimpeza: '',
  tabelaDestino: '',
  tempoMaximoMin: 30,
  ativo: true,
};

export function AcaoPage() {
  const { id } = useParams();
  const nova = id === 'nova';
  const navigate = useNavigate();
  const avisar = useAvisos();
  const [conexoes, setConexoes] = useState<Conexao[]>([]);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [f, setF] = useState(VAZIA);
  const [salvo, setSalvo] = useState(VAZIA);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [validando, setValidando] = useState(false);
  const [validacao, setValidacao] = useState<ValidacaoAcao | null>(null);
  const [criandoTabela, setCriandoTabela] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const cx = (await api.get<Conexao[]>('/conexoes')).data;
        setConexoes(cx);
        if (nova) {
          const inicial = { ...VAZIA, conexaoId: cx[0]?.id ?? 0 };
          setF(inicial);
          setSalvo(inicial);
        } else {
          const { data } = await api.get<Acao>(`/acoes/${id}`);
          aplicar(data);
        }
      } catch (e) {
        setErro(mensagemDeErro(e));
      } finally {
        setCarregando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function aplicar(a: Acao) {
    setAcao(a);
    const valores = {
      nome: a.nome,
      conexaoId: a.conexao.id,
      comandoSql: a.comandoSql,
      comandoLimpeza: a.comandoLimpeza ?? '',
      tabelaDestino: a.tabelaDestino,
      tempoMaximoMin: a.tempoMaximoMin,
      ativo: a.ativo,
    };
    setF(valores);
    setSalvo(valores);
  }

  const alterado = JSON.stringify(f) !== JSON.stringify(salvo);
  const temLegado = /\$\[[A-Za-z_][A-Za-z0-9_]*\]/.test(f.comandoSql + f.comandoLimpeza);

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const corpo = { ...f, comandoLimpeza: f.comandoLimpeza.trim() || null };
      const { data } = nova ? await api.post<Acao>('/acoes', corpo) : await api.put<Acao>(`/acoes/${id}`, corpo);
      aplicar(data);
      const conv = data.parametrosConvertidos ?? 0;
      avisar(conv ? `Ação salva. ${conv} parâmetro(s) $[...] convertido(s) para @...` : 'Ação salva.');
      if (nova) navigate(`/dados/acoes/${data.id}`, { replace: true });
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  async function validar() {
    setValidando(true);
    setValidacao(null);
    try {
      const { data } = await api.post<ValidacaoAcao>('/acoes/validar', {
        conexaoId: f.conexaoId,
        comandoSql: f.comandoSql,
        comandoLimpeza: f.comandoLimpeza || null,
        tabelaDestino: f.tabelaDestino,
      });
      setValidacao(data);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setValidando(false);
    }
  }

  async function criarTabela() {
    setCriandoTabela(true);
    try {
      const { data } = await api.post<{ tabela: string; colunas: number; recriada: boolean }>(`/acoes/${id}/criar-tabela`);
      avisar(`Tabela ${data.tabela} ${data.recriada ? 'recriada' : 'criada'} com ${data.colunas} coluna(s).`);
      validar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setCriandoTabela(false);
    }
  }

  const colunasOk = useMemo(
    () => validacao && !validacao.erroOrigem && validacao.tabelaExiste && !validacao.faltamNaTabela.length && !validacao.faltamNoSelect.length,
    [validacao],
  );

  if (carregando) {
    return (
      <div className="py-5 text-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  if (!conexoes.length) {
    return (
      <CAlert color="warning">
        Cadastre uma conexão antes de criar ações. <Link to="/dados/conexoes">Ir para Conexões</Link>
      </CAlert>
    );
  }

  return (
    <>
      <CBreadcrumb className="mb-2">
        <CBreadcrumbItem>
          <Link to="/dados/acoes">Ações</Link>
        </CBreadcrumbItem>
        <CBreadcrumbItem active>{nova ? 'Nova ação' : acao?.nome}</CBreadcrumbItem>
      </CBreadcrumb>
      <div className="pagina-cabecalho">
        <div>
          <h1 className="pagina-titulo">{nova ? 'Nova ação' : acao?.nome}</h1>
          {!nova && acao && (
            <p className="pagina-descricao">
              {acao.tarefas.length ? (
                <>
                  Usada em:{' '}
                  {acao.tarefas.map((t, i) => (
                    <span key={t.id}>
                      {i > 0 && ', '}
                      <Link to={`/dados/tarefas/${t.id}`}>{t.nome}</Link>
                    </span>
                  ))}
                </>
              ) : (
                'Ainda não está em nenhuma tarefa.'
              )}
            </p>
          )}
        </div>
        {!nova && (
          <CButton color="danger" variant="outline" onClick={() => setExcluindo(true)}>
            Excluir ação
          </CButton>
        )}
      </div>

      {erro && (
        <CAlert color="danger" dismissible onClose={() => setErro(null)}>
          {erro}
        </CAlert>
      )}

      <CCard className="mb-4">
        <CCardBody>
          <CRow className="g-3">
            <CCol md={4}>
              <CFormLabel htmlFor="a-nome">Nome da ação</CFormLabel>
              <CFormInput id="a-nome" value={f.nome} maxLength={120} placeholder="ETL_V_FATURAMENTO_CLIENTE" onChange={(e) => set('nome', e.target.value.toUpperCase())} />
            </CCol>
            <CCol md={3}>
              <CFormLabel htmlFor="a-conexao">Conexão de origem</CFormLabel>
              <CFormSelect id="a-conexao" value={f.conexaoId} onChange={(e) => set('conexaoId', Number(e.target.value))}>
                {conexoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.banco})
                  </option>
                ))}
              </CFormSelect>
            </CCol>
            <CCol md={3}>
              <CFormLabel htmlFor="a-tabela">Tabela de destino</CFormLabel>
              <CFormInput id="a-tabela" value={f.tabelaDestino} maxLength={130} placeholder="ghlogistico.etl_v_faturamento" spellCheck={false} onChange={(e) => set('tabelaDestino', e.target.value)} />
              <CFormText>No banco bi_dados. Use schema.tabela.</CFormText>
            </CCol>
            <CCol md={2}>
              <CFormLabel htmlFor="a-tempo">Tempo máximo</CFormLabel>
              <div className="input-group">
                <CFormInput id="a-tempo" type="number" min={1} max={1440} value={f.tempoMaximoMin} onChange={(e) => set('tempoMaximoMin', Number(e.target.value))} />
                <span className="input-group-text">min</span>
              </div>
            </CCol>
            <CCol md={12}>
              <CFormSwitch id="a-ativo" label="Ação ativa" checked={f.ativo} onChange={(e) => set('ativo', e.target.checked)} />
              <CFormText>Inativa: as tarefas pulam esta ação e registram isso no log.</CFormText>
            </CCol>
          </CRow>
        </CCardBody>
      </CCard>

      {temLegado && (
        <CAlert color="info" className="small">
          Encontrei parâmetros no formato da ferramenta antiga, como <code>$[ANOMES_INI]</code>. Ao salvar, eles viram <code>@ANOMES_INI</code>, e as
          aspas em volta deixam de ser necessárias.
        </CAlert>
      )}

      <CCard className="mb-4">
        <CCardHeader className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span>
            <strong>Comando</strong>
            <span className="text-body-secondary ms-2 small">SELECT executado na origem (SQL Server)</span>
          </span>
        </CCardHeader>
        <CCardBody className="p-0">
          <EditorSql id="a-sql" rotuloAria="Comando SQL de origem" dialeto="sqlserver" valor={f.comandoSql} onChange={(v) => set('comandoSql', v)} altura="340px" />
        </CCardBody>
      </CCard>

      <CCard className="mb-4">
        <CCardHeader>
          <strong>Comando de limpeza</strong>
          <span className="text-body-secondary ms-2 small">Executado no bi_dados (PostgreSQL) antes de carregar</span>
        </CCardHeader>
        <CCardBody className="p-0">
          <EditorSql
            id="a-limpeza"
            rotuloAria="Comando de limpeza"
            dialeto="postgres"
            valor={f.comandoLimpeza}
            onChange={(v) => set('comandoLimpeza', v)}
            altura="110px"
          />
        </CCardBody>
        <div className="card-footer small text-body-secondary">
          Exemplo: <code>DELETE FROM {f.tabelaDestino || 'schema.tabela'} WHERE anomes_referente BETWEEN @ANOMES_INI AND @ANOMES_FIM</code>. Em branco, cada
          carga substitui todo o conteúdo da tabela.
        </div>
      </CCard>

      {validacao && <PainelValidacao v={validacao} />}

      <div className="barra-acoes">
        <CLoadingButton color="primary" loading={salvando} disabled={!alterado || salvando} onClick={salvar}>
          {nova ? 'Criar ação' : 'Salvar alterações'}
        </CLoadingButton>
        <CLoadingButton color="secondary" variant="outline" loading={validando} disabled={!f.comandoSql.trim() || !f.tabelaDestino.trim()} onClick={validar}>
          Validar colunas
        </CLoadingButton>
        {!nova && validacao && !validacao.erroOrigem && !alterado && (!validacao.tabelaExiste || !colunasOk) && (
          <CLoadingButton color="secondary" variant="outline" loading={criandoTabela} onClick={criarTabela}>
            {validacao.tabelaExiste ? 'Recriar tabela vazia' : 'Criar tabela agora'}
          </CLoadingButton>
        )}
        <CButton
          color="secondary"
          variant="outline"
          disabled={!f.comandoSql.trim() || !f.conexaoId}
          title="Abre o SELECT no Console SQL, na conexão de origem, para ver o que ele retorna"
          onClick={() => navigate('/dados/console', { state: { sql: f.comandoSql, destino: f.conexaoId } })}
        >
          Testar no console
        </CButton>
        {alterado && <span className="barra-acoes-aviso">Alterações não salvas</span>}
      </div>

      <Confirmar
        visivel={excluindo}
        titulo="Excluir ação?"
        acao="Excluir ação"
        perigoso
        onConfirmar={async () => {
          try {
            await api.delete(`/acoes/${id}`);
            avisar(`Ação ${acao?.nome} excluída.`);
            navigate('/dados/acoes');
          } catch (e) {
            avisar(mensagemDeErro(e), 'erro');
            setExcluindo(false);
          }
        }}
        onFechar={() => setExcluindo(false)}
      >
        A ação <strong>{acao?.nome}</strong> só pode ser excluída se não estiver em nenhuma tarefa. A tabela de destino e os dados já carregados no
        bi_dados são mantidos.
      </Confirmar>
    </>
  );
}

function PainelValidacao({ v }: { v: ValidacaoAcao }) {
  const problemas = v.faltamNaTabela.length + v.faltamNoSelect.length;
  return (
    <CCard className="mb-4 validacao">
      <CCardHeader>
        <strong>Validação</strong>
      </CCardHeader>
      <CCardBody>
        {v.erroOrigem ? (
          <CAlert color="danger" className="mb-0">
            <strong>O SQL não pôde ser analisado na origem.</strong> {v.erroOrigem}
          </CAlert>
        ) : !v.tabelaExiste ? (
          <CAlert color="info" className="mb-3">
            A tabela <code>{v.tabela}</code> ainda não existe. Ela é criada com as colunas abaixo na primeira execução, ou agora pelo botão
            &ldquo;Criar tabela agora&rdquo;.
          </CAlert>
        ) : problemas ? (
          <CAlert color="danger" className="mb-3">
            As colunas não batem com a tabela <code>{v.tabela}</code>.
            {v.faltamNaTabela.length > 0 && <div>O SELECT traz colunas que a tabela não tem: {v.faltamNaTabela.join(', ')}.</div>}
            {v.faltamNoSelect.length > 0 && <div>A tabela tem colunas que o SELECT não traz: {v.faltamNoSelect.join(', ')}.</div>}
          </CAlert>
        ) : (
          <CAlert color="success" className="mb-3">
            As {v.colunasOrigem.length} colunas do SELECT batem com a tabela <code>{v.tabela}</code>.
          </CAlert>
        )}

        {(v.parametrosSelect.length > 0 || v.parametrosLimpeza.length > 0) && (
          <p className="small mb-3">
            Parâmetros usados:{' '}
            {[...new Set([...v.parametrosSelect, ...v.parametrosLimpeza])].map((p) => (
              <CBadge key={p} color="secondary" className="badge-leve me-1 font-mono">
                @{p}
              </CBadge>
            ))}
            <span className="text-body-secondary">Defina-os nos parâmetros de cada tarefa que usar esta ação.</span>
          </p>
        )}

        {v.colunasOrigem.length > 0 && (
          <CTable small responsive className="mb-0 tabela-lista">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Coluna</CTableHeaderCell>
                <CTableHeaderCell>Tipo na origem</CTableHeaderCell>
                <CTableHeaderCell>Tipo no bi_dados</CTableHeaderCell>
                <CTableHeaderCell>Na tabela</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {v.colunasOrigem.map((c) => {
                const naTabela = v.colunasTabela.find((t) => t.nome === c.nome);
                return (
                  <CTableRow key={c.nome}>
                    <CTableDataCell className="font-mono">{c.nome}</CTableDataCell>
                    <CTableDataCell className="font-mono small">{c.tipoOrigem}</CTableDataCell>
                    <CTableDataCell className="font-mono small">{naTabela?.tipo ?? c.tipoDestino}</CTableDataCell>
                    <CTableDataCell>
                      {!v.tabelaExiste ? (
                        <span className="small text-body-secondary">será criada</span>
                      ) : naTabela ? (
                        <CBadge color="success">OK</CBadge>
                      ) : (
                        <CBadge color="danger">Falta</CBadge>
                      )}
                    </CTableDataCell>
                  </CTableRow>
                );
              })}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  );
}
