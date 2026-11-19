import { useEffect, useState, type ReactNode } from 'react';
import { CAlert, CButton, CFormInput, CFormLabel, CFormSelect, CModal, CModalBody, CModalFooter, CModalHeader, CModalTitle, CSpinner } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { mensagemDeErro } from '../../api/client';
import { Visual, type DadosVisual, type TipoVisual } from './Visual';

/** Visual já montado em outro painel ou análise, que pode ser copiado */
export interface ObjetoExistente {
  id: string | number;
  tipo: TipoVisual;
  titulo: string;
  config: Record<string, any>;
  layout?: { w: number; h: number };
  /** Onde está hoje: nome do painel ou da análise */
  origem: string;
  /** Linha de apoio: local no menu, consulta ou cubo */
  detalhe?: string;
  /** Motivo para não deixar incluir */
  bloqueio?: string | null;
}

export interface TipoObjeto {
  tipo: TipoVisual;
  nome: string;
  icone: string[];
}

interface Props<T extends ObjetoExistente> {
  /** Textos do destino: { no: 'no painel', neste: 'neste painel' } */
  destino: { no: string; neste: string };
  tipos: TipoObjeto[];
  buscar: (busca: string, tipo: TipoVisual | '') => Promise<T[]>;
  previa: (o: T) => Promise<{ dados?: DadosVisual; erro?: string }>;
  /** Opções extras do item escolhido (ex.: incluir os filtros que faltam) */
  extra?: (o: T) => ReactNode;
  onFechar: () => void;
  onIncluir: (o: T, titulo: string) => void;
}

/**
 * Busca um visual que já existe (pelo título, ou pelo nome do painel/análise de origem),
 * mostra a prévia e inclui uma cópia. A cópia é independente: mudar uma não muda a outra.
 */
export function IncluirExistente<T extends ObjetoExistente>({ destino, tipos, buscar, previa, extra, onFechar, onIncluir }: Props<T>) {
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<TipoVisual | ''>('');
  const [lista, setLista] = useState<T[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<T | null>(null);
  const [titulo, setTitulo] = useState('');
  const [dados, setDados] = useState<{ dados?: DadosVisual; erro?: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    const t = window.setTimeout(() => {
      buscar(busca.trim(), tipo)
        .then((r) => {
          if (!ativo) return;
          setLista(r);
          setErro(null);
        })
        .catch((e) => ativo && setErro(mensagemDeErro(e)));
    }, 300);
    return () => {
      ativo = false;
      window.clearTimeout(t);
    };
  }, [busca, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!escolhido) return;
    let ativo = true;
    setDados(null);
    previa(escolhido)
      .then((r) => ativo && setDados(r))
      .catch((e) => ativo && setDados({ erro: mensagemDeErro(e) }));
    return () => {
      ativo = false;
    };
  }, [escolhido]); // eslint-disable-line react-hooks/exhaustive-deps

  const escolher = (o: T) => {
    setEscolhido(o);
    setTitulo(o.titulo);
  };
  const nomeTipo = (t: TipoVisual) => tipos.find((x) => x.tipo === t);

  return (
    <CModal visible size="xl" onClose={onFechar} alignment="center" backdrop="static">
      <CModalHeader>
        <CModalTitle>Incluir visual existente</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <div className="incluir-existente">
          <div className="incluir-busca">
            <div className="row g-2 mb-2">
              <div className="col-sm-5">
                <CFormLabel htmlFor="ie-tipo" className="visually-hidden">
                  Tipo
                </CFormLabel>
                <CFormSelect id="ie-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVisual | '')}>
                  <option value="">Todos os tipos</option>
                  {tipos.map((t) => (
                    <option key={t.tipo} value={t.tipo}>
                      {t.nome}
                    </option>
                  ))}
                </CFormSelect>
              </div>
              <div className="col-sm-7">
                <CFormLabel htmlFor="ie-busca" className="visually-hidden">
                  Buscar
                </CFormLabel>
                <CFormInput id="ie-busca" type="search" autoFocus value={busca} placeholder="Título, painel ou consulta" onChange={(e) => setBusca(e.target.value)} />
              </div>
            </div>
            {erro && <CAlert color="danger">{erro}</CAlert>}
            {lista === null ? (
              <div className="py-4 text-center">
                <CSpinner size="sm" />
              </div>
            ) : lista.length === 0 ? (
              <p className="lista-vazia">{busca ? `Nenhum visual com "${busca}".` : 'Ainda não há visuais montados.'}</p>
            ) : (
              <ul className="incluir-lista" role="listbox" aria-label="Visuais encontrados">
                {lista.map((o) => {
                  const t = nomeTipo(o.tipo);
                  const ativo = escolhido?.id === o.id;
                  return (
                    <li key={o.id} role="option" aria-selected={ativo}>
                      <button type="button" className={ativo ? 'ativo' : ''} onClick={() => escolher(o)}>
                        {t && <CIcon icon={t.icone} className="incluir-icone" title={t.nome} />}
                        <span className="incluir-textos">
                          <strong>{o.titulo}</strong>
                          <span>
                            {o.origem}
                            {o.detalhe ? ` · ${o.detalhe}` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {lista && lista.length >= 60 && <div className="form-text">Mostrando os 60 primeiros. Escreva mais do título para achar o que procura.</div>}
          </div>
          <div className="incluir-previa">
            {!escolhido ? (
              <div className="incluir-previa-vazia">Escolha um visual na lista para ver a prévia aqui.</div>
            ) : (
              <>
                <span className="editor-visual-previa-rotulo">Prévia</span>
                <div className="editor-visual-previa-area" style={{ height: escolhido.tipo === 'kpi' ? 170 : escolhido.tipo === 'imagem' ? 220 : 340 }}>
                  <Visual tipo={escolhido.tipo} titulo={titulo || escolhido.titulo} config={escolhido.config} dados={dados?.dados} erro={dados?.erro} carregando={!dados} />
                </div>
                <div className="mt-3">
                  <CFormLabel htmlFor="ie-titulo">Título {destino.neste}</CFormLabel>
                  <CFormInput id="ie-titulo" value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} />
                </div>
                {extra?.(escolhido)}
                <p className="form-text mb-0 mt-2">
                  Entra uma cópia: depois de incluída, ela pode ser ajustada aqui sem mudar o original em "{escolhido.origem}".
                </p>
                {escolhido.bloqueio && (
                  <CAlert color="warning" className="mt-2 mb-0">
                    {escolhido.bloqueio}
                  </CAlert>
                )}
              </>
            )}
          </div>
        </div>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          Cancelar
        </CButton>
        <CButton color="primary" disabled={!escolhido || !!escolhido.bloqueio || !titulo.trim()} onClick={() => escolhido && onIncluir(escolhido, titulo.trim())}>
          Incluir {destino.no}
        </CButton>
      </CModalFooter>
    </CModal>
  );
}
