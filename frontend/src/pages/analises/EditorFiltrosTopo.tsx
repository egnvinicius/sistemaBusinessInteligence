import { useState } from 'react';
import { CButton, CFormCheck, CFormInput, CFormLabel, CFormSelect, CModal, CModalBody, CModalFooter, CModalHeader, CModalTitle } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilPlus, cilTrash } from '@coreui/icons';
import { alcance, NOME_TIPO_FILTRO, novoIdFiltro, PADROES, rotulo, type CuboInfo, type FiltroTopo, type LigacaoTela, type TipoFiltroTopo } from './modelo';

const MAX = 10;

interface Props {
  filtros: FiltroTopo[];
  cubos: CuboInfo[];
  ligacoes: LigacaoTela[];
  onFechar: () => void;
  onAplicar: (f: FiltroTopo[]) => void;
}

/** Filtros do topo da análise: cada um numa coluna de um cubo; valem para todos os visuais ligados a ele. */
export function EditorFiltrosTopo({ filtros, cubos, ligacoes, onFechar, onAplicar }: Props) {
  const [lista, setLista] = useState<FiltroTopo[]>(filtros);
  const [erro, setErro] = useState<string | null>(null);
  const variosCubos = cubos.length > 1;

  const colunaDe = (f: Pick<FiltroTopo, 'cuboId' | 'coluna'>) => cubos.find((c) => c.id === f.cuboId)?.colunas.find((c) => c.nome === f.coluna);
  const tiposPara = (tipoCol?: string): TipoFiltroTopo[] => (tipoCol === 'data' ? ['periodo', 'ano', 'mes'] : ['valores']);

  const alterar = (i: number, mudanca: Partial<FiltroTopo>) => setLista((l) => l.map((f, j) => (j === i ? { ...f, ...mudanca } : f)));

  const trocarColuna = (i: number, valor: string) => {
    const [cubo, ...resto] = valor.split('|');
    const cuboId = Number(cubo);
    const coluna = resto.join('|');
    const atual = lista[i];
    const nova = colunaDe({ cuboId, coluna });
    const antiga = colunaDe(atual);
    const tipos = tiposPara(nova?.tipo);
    const tipo = tipos.includes(atual.tipo) ? atual.tipo : tipos[0];
    // Nome automático acompanha a coluna, até a pessoa escrever outro
    const nomeAutomatico = !atual.nome.trim() || (antiga && atual.nome === rotulo(antiga));
    alterar(i, { cuboId, coluna, tipo, padrao: 'nenhum', ...(nomeAutomatico && nova ? { nome: rotulo(nova).slice(0, 60) } : {}) });
  };

  const adicionar = () => {
    const usadas = new Set(lista.map((f) => `${f.cuboId}|${f.coluna}`));
    const todas = cubos.flatMap((c) => c.colunas.map((col) => ({ cubo: c, col })));
    const escolha =
      todas.find((x) => x.col.tipo === 'data' && !usadas.has(`${x.cubo.id}|${x.col.nome}`)) ??
      todas.find((x) => x.col.tipo === 'texto' && !usadas.has(`${x.cubo.id}|${x.col.nome}`)) ??
      todas[0];
    if (!escolha) return;
    setLista((l) => [
      ...l,
      {
        id: novoIdFiltro(),
        nome: rotulo(escolha.col).slice(0, 60),
        cuboId: escolha.cubo.id,
        coluna: escolha.col.nome,
        tipo: escolha.col.tipo === 'data' ? 'periodo' : 'valores',
        multiplo: true,
        padrao: 'nenhum',
      },
    ]);
  };

  const aplicar = () => {
    const vazio = lista.find((f) => !f.nome.trim());
    if (vazio) return setErro('Dê um nome a cada filtro.');
    onAplicar(lista.map((f) => ({ ...f, nome: f.nome.trim() })));
  };

  const valePara = (f: FiltroTopo) => {
    const ids = alcance(f.cuboId, ligacoes);
    const fora = cubos.filter((c) => !ids.has(c.id));
    const dentro = cubos.filter((c) => ids.has(c.id));
    return { dentro, fora };
  };

  return (
    <CModal visible onClose={onFechar} alignment="center" size="lg" scrollable>
      <CModalHeader>
        <CModalTitle>Filtros da análise</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <p className="small text-body-secondary">
          Os filtros aparecem no topo e valem para todos os visuais. Um filtro de um cubo também filtra os visuais dos cubos ligados a ele: escolher um modelo em
          Veículos mostra só a manutenção desses veículos.
        </p>
        {lista.length === 0 && <p className="lista-vazia">Nenhum filtro ainda.</p>}
        <ol className="filtros-topo-lista">
          {lista.map((f, i) => {
            const col = colunaDe(f);
            const tipos = tiposPara(col?.tipo);
            const { dentro, fora } = valePara(f);
            return (
              <li key={f.id} className="filtros-topo-item">
                <div className="filtros-topo-campos">
                  <div>
                    <CFormLabel htmlFor={`ft-nome-${f.id}`}>Nome na barra</CFormLabel>
                    <CFormInput id={`ft-nome-${f.id}`} size="sm" value={f.nome} maxLength={60} onChange={(e) => alterar(i, { nome: e.target.value })} />
                  </div>
                  <div>
                    <CFormLabel htmlFor={`ft-col-${f.id}`}>Coluna</CFormLabel>
                    <CFormSelect id={`ft-col-${f.id}`} size="sm" value={`${f.cuboId}|${f.coluna}`} onChange={(e) => trocarColuna(i, e.target.value)}>
                      {cubos.map((c) => (
                        <optgroup key={c.id} label={c.nome}>
                          {c.colunas.map((x) => (
                            <option key={x.nome} value={`${c.id}|${x.nome}`}>
                              {rotulo(x)}
                              {x.descricao?.trim() ? ` (${x.nome})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </CFormSelect>
                  </div>
                  <div>
                    <CFormLabel htmlFor={`ft-tipo-${f.id}`}>Tipo</CFormLabel>
                    <CFormSelect
                      id={`ft-tipo-${f.id}`}
                      size="sm"
                      value={f.tipo}
                      disabled={tipos.length === 1}
                      onChange={(e) => alterar(i, { tipo: e.target.value as TipoFiltroTopo, padrao: 'nenhum' })}
                    >
                      {tipos.map((t) => (
                        <option key={t} value={t}>
                          {NOME_TIPO_FILTRO[t]}
                        </option>
                      ))}
                    </CFormSelect>
                  </div>
                  <div>
                    {f.tipo === 'valores' ? (
                      <>
                        <span className="form-label d-block">Seleção</span>
                        <CFormCheck
                          id={`ft-mult-${f.id}`}
                          label="Permitir marcar vários"
                          checked={f.multiplo}
                          onChange={(e) => alterar(i, { multiplo: e.target.checked })}
                        />
                      </>
                    ) : (
                      <>
                        <CFormLabel htmlFor={`ft-padrao-${f.id}`}>Começa com</CFormLabel>
                        <CFormSelect id={`ft-padrao-${f.id}`} size="sm" value={f.padrao} onChange={(e) => alterar(i, { padrao: e.target.value })}>
                          {PADROES[f.tipo].map((p) => (
                            <option key={p.valor} value={p.valor}>
                              {p.nome}
                            </option>
                          ))}
                        </CFormSelect>
                      </>
                    )}
                  </div>
                  <CButton color="danger" variant="ghost" size="sm" className="filtros-topo-remover" aria-label={`Remover o filtro ${f.nome}`} onClick={() => setLista((l) => l.filter((_, j) => j !== i))}>
                    <CIcon icon={cilTrash} />
                  </CButton>
                </div>
                {variosCubos && (
                  <p className="filtros-topo-alcance">
                    Vale para {dentro.map((c) => c.nome).join(', ')}
                    {fora.length > 0 && (
                      <span className="filtros-topo-fora">
                        {' '}
                        · não chega a {fora.map((c) => c.nome).join(', ')} (sem ligação)
                      </span>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <CButton color="secondary" variant="outline" size="sm" onClick={adicionar} disabled={lista.length >= MAX}>
          <CIcon icon={cilPlus} className="me-1" />
          Adicionar filtro
        </CButton>
        {erro && <p className="text-danger small mt-2 mb-0">{erro}</p>}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          Cancelar
        </CButton>
        <CButton color="primary" onClick={aplicar}>
          Aplicar filtros
        </CButton>
      </CModalFooter>
    </CModal>
  );
}
