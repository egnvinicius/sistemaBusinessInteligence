import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CFormInput,
  CFormSelect,
  CLoadingButton,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilArrowBottom, cilArrowTop, cilTrash } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { useAvisos } from '../../contexts/AvisosContext';
import type { AcaoResumo, TarefaDetalhe } from '../../types';

interface Linha {
  acaoId: number;
  nome: string;
  conexao: string;
  tabelaDestino: string;
  ativo: boolean;
  casoErro: 'continuar' | 'parar';
  tentativas: number;
}

export function AbaAcoes({ tarefa, editavel, onSalvo }: { tarefa: TarefaDetalhe; editavel: boolean; onSalvo: () => void }) {
  const avisar = useAvisos();
  const original: Linha[] = useMemo(
    () =>
      tarefa.acoes.map((a) => ({
        acaoId: a.acaoId,
        nome: a.nome,
        conexao: a.conexao,
        tabelaDestino: a.tabelaDestino,
        ativo: a.ativo,
        casoErro: a.casoErro,
        tentativas: a.tentativas,
      })),
    [tarefa.acoes],
  );
  const [linhas, setLinhas] = useState<Linha[]>(original);
  const [catalogo, setCatalogo] = useState<AcaoResumo[]>([]);
  const [adicionar, setAdicionar] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setLinhas(original), [original]);
  useEffect(() => {
    if (editavel) api.get<AcaoResumo[]>('/acoes').then((r) => setCatalogo(r.data)).catch(() => undefined);
  }, [editavel]);

  const alterado = JSON.stringify(linhas) !== JSON.stringify(original);
  const disponiveis = catalogo.filter((a) => !linhas.some((l) => l.acaoId === a.id));

  const mudar = (i: number, campo: Partial<Linha>) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...campo } : l)));
  const mover = (i: number, d: -1 | 1) =>
    setLinhas((ls) => {
      const n = [...ls];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  async function salvar() {
    setSalvando(true);
    try {
      await api.put(`/tarefas/${tarefa.id}/acoes`, {
        acoes: linhas.map((l) => ({ acaoId: l.acaoId, casoErro: l.casoErro, tentativas: l.tentativas })),
      });
      avisar('Ações da tarefa salvas.');
      onSalvo();
    } catch (e) {
      avisar(mensagemDeErro(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <CCard>
      <CCardBody>
        <p className="text-body-secondary small">
          As ações rodam nesta ordem. Coloque primeiro as tabelas &ldquo;pai&rdquo; e use &ldquo;Parar&rdquo; quando as seguintes dependerem delas.
        </p>
        {linhas.length === 0 ? (
          <p className="lista-vazia">Nenhuma ação nesta tarefa ainda.</p>
        ) : (
          <CTable responsive align="middle" className="tabela-lista">
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Ordem</CTableHeaderCell>
                <CTableHeaderCell>Ação</CTableHeaderCell>
                <CTableHeaderCell>Destino</CTableHeaderCell>
                <CTableHeaderCell>Se der erro</CTableHeaderCell>
                <CTableHeaderCell>Tentativas</CTableHeaderCell>
                {editavel && (
                  <CTableHeaderCell className="text-end">
                    <span className="visually-hidden">Ordem e remoção</span>
                  </CTableHeaderCell>
                )}
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {linhas.map((l, i) => (
                <CTableRow key={l.acaoId}>
                  <CTableDataCell className="text-body-secondary">{(i + 1) * 10}</CTableDataCell>
                  <CTableDataCell>
                    {editavel ? (
                      <Link to={`/dados/acoes/${l.acaoId}`} className="font-mono small fw-semibold">
                        {l.nome}
                      </Link>
                    ) : (
                      <span className="font-mono small fw-semibold">{l.nome}</span>
                    )}
                    {!l.ativo && (
                      <CBadge color="secondary" className="ms-2">
                        Inativa
                      </CBadge>
                    )}
                    <div className="small text-body-secondary">{l.conexao}</div>
                  </CTableDataCell>
                  <CTableDataCell className="font-mono small">{l.tabelaDestino}</CTableDataCell>
                  <CTableDataCell>
                    {editavel ? (
                      <CFormSelect
                        size="sm"
                        aria-label={`O que fazer se ${l.nome} der erro`}
                        value={l.casoErro}
                        onChange={(e) => mudar(i, { casoErro: e.target.value as Linha['casoErro'] })}
                      >
                        <option value="continuar">Continuar</option>
                        <option value="parar">Parar a tarefa</option>
                      </CFormSelect>
                    ) : l.casoErro === 'parar' ? (
                      'Parar a tarefa'
                    ) : (
                      'Continuar'
                    )}
                  </CTableDataCell>
                  <CTableDataCell>
                    {editavel ? (
                      <CFormInput
                        size="sm"
                        type="number"
                        min={1}
                        max={10}
                        className="campo-numero-curto"
                        aria-label={`Tentativas de ${l.nome}`}
                        value={l.tentativas}
                        onChange={(e) => mudar(i, { tentativas: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
                      />
                    ) : (
                      l.tentativas
                    )}
                  </CTableDataCell>
                  {editavel && (
                    <CTableDataCell className="text-end text-nowrap">
                      <CButton color="secondary" variant="ghost" size="sm" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Mover ${l.nome} para cima`}>
                        <CIcon icon={cilArrowTop} />
                      </CButton>
                      <CButton
                        color="secondary"
                        variant="ghost"
                        size="sm"
                        disabled={i === linhas.length - 1}
                        onClick={() => mover(i, 1)}
                        aria-label={`Mover ${l.nome} para baixo`}
                      >
                        <CIcon icon={cilArrowBottom} />
                      </CButton>
                      <CButton
                        color="danger"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}
                        aria-label={`Tirar ${l.nome} da tarefa`}
                      >
                        <CIcon icon={cilTrash} />
                      </CButton>
                    </CTableDataCell>
                  )}
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
        )}

        {editavel && (
          <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
            <CFormSelect
              aria-label="Ação para adicionar"
              value={adicionar}
              onChange={(e) => setAdicionar(e.target.value)}
              className="seletor-adicionar"
              disabled={!disponiveis.length}
            >
              <option value="">{disponiveis.length ? 'Escolha uma ação do catálogo…' : 'Todas as ações do catálogo já estão aqui'}</option>
              {disponiveis.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome} → {a.tabelaDestino}
                </option>
              ))}
            </CFormSelect>
            <CButton
              color="secondary"
              variant="outline"
              disabled={!adicionar}
              onClick={() => {
                const a = catalogo.find((x) => x.id === Number(adicionar));
                if (!a) return;
                setLinhas((ls) => [
                  ...ls,
                  { acaoId: a.id, nome: a.nome, conexao: a.conexao.nome, tabelaDestino: a.tabelaDestino, ativo: a.ativo, casoErro: 'continuar', tentativas: 1 },
                ]);
                setAdicionar('');
              }}
            >
              Adicionar
            </CButton>
            <div className="ms-auto d-flex gap-2 align-items-center">
              {alterado && <span className="barra-acoes-aviso">Alterações não salvas</span>}
              <CButton color="secondary" variant="ghost" disabled={!alterado} onClick={() => setLinhas(original)}>
                Descartar
              </CButton>
              <CLoadingButton color="primary" loading={salvando} disabled={!alterado} onClick={salvar}>
                Salvar ações
              </CLoadingButton>
            </div>
          </div>
        )}
      </CCardBody>
    </CCard>
  );
}
