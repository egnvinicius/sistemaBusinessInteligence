import { useEffect, useState } from 'react';
import {
  CAlert,
  CButton,
  CFormInput,
  CFormSelect,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
} from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilPlus, cilTrash } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { CONDICOES } from '../../lib/filtrosVisual';
import type { FiltroVisual } from '../../lib/filtrosVisual';
import { Visual, type DadosVisual, type TipoVisual } from './Visual';
import { useCalculadas, type ColunaBase } from './ColunasCalculadas';

export type { FiltroVisual } from '../../lib/filtrosVisual';

interface Props {
  visual: { tipo: TipoVisual; titulo: string; consultaId: number; config: Record<string, any>; layout: any };
  colunas: ColunaBase[];
  filtrosIds?: number[];
  painelId?: number;
  podeExec: boolean;
  /** Prévia do visual; sem ela, usa a prévia do montador de painéis */
  buscarPrevia?: (v: Props['visual']) => Promise<{ dados?: DadosVisual; erro?: string }>;
  onFechar: () => void;
  onAplicar: (filtros: FiltroVisual[]) => void;
}

/**
 * Filtros próprios de um visual: só as linhas da consulta que atendem
 * as condições entram no cálculo. "E" vale antes de "OU".
 */
export function EditorFiltrosVisual({ visual, colunas: colunasOrigem, filtrosIds, painelId, podeExec, onFechar, onAplicar, buscarPrevia }: Props) {
  const [filtros, setFiltros] = useState<FiltroVisual[]>(visual.config.filtrosVisual ?? []);
  // Colunas calculadas por linha também podem ser filtradas
  const calc = useCalculadas(visual.config.calculadas, colunasOrigem);
  const colunas = [...colunasOrigem, ...calc.porLinha];
  const [previa, setPrevia] = useState<{ dados?: DadosVisual; erro?: string }>({});
  const set = (i: number, p: Partial<FiltroVisual>) => setFiltros((a) => a.map((f, k) => (k === i ? { ...f, ...p } : f)));
  const completos = filtros.filter((f) => f.condicao === 'vazio' || f.condicao === 'nao_vazio' || f.valor.trim());

  useEffect(() => {
    let ativo = true;
    const t = window.setTimeout(() => {
      const alvo = { ...visual, titulo: visual.titulo || 'Visual', config: { ...visual.config, filtrosVisual: completos } };
      const pedido: Promise<{ dados?: DadosVisual; erro?: string }> = buscarPrevia
        ? buscarPrevia(alvo)
        : api.post('/paineis/montagem/previa', { visual: alvo, filtrosIds: filtrosIds ?? [], painelId }).then((r) => ({ dados: r.data.dados, erro: r.data.erro }));
      pedido.then((r) => ativo && setPrevia(r)).catch((e) => ativo && setPrevia({ erro: mensagemDeErro(e) }));
    }, 450);
    return () => {
      ativo = false;
      window.clearTimeout(t);
    };
  }, [JSON.stringify(completos)]); // eslint-disable-line react-hooks/exhaustive-deps

  const temExec = filtros.some((f) => /^\s*exec\s*=/i.test(f.valor));

  return (
    <CModal visible size="xl" onClose={onFechar} alignment="center" backdrop="static">
      <CModalHeader>
        <CModalTitle>Filtros do visual: {visual.titulo}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <p className="text-body-secondary small">
          Só as linhas da consulta que atendem estes filtros entram no cálculo deste visual. Eles se somam aos filtros do topo do painel. Durações
          como <code>00d 02:00</code> são comparadas como tempo. Para calcular o valor na hora, comece com <code>exec=</code> e escreva uma expressão
          SQL, por exemplo <code>exec=to_char(current_date - 1, 'YYYY-MM-DD')</code>.
        </p>
        {filtros.length === 0 ? (
          <p className="lista-vazia mb-3">Nenhum filtro: o visual usa todas as linhas da consulta.</p>
        ) : (
          <div className="filtros-visual" role="table" aria-label="Filtros do visual">
            <div className="filtros-visual-cab" role="row">
              <span role="columnheader">Coluna</span>
              <span role="columnheader">Condição</span>
              <span role="columnheader">Valor</span>
              <span role="columnheader">Ligação</span>
              <span />
            </div>
            {filtros.map((f, i) => {
              const semValor = f.condicao === 'vazio' || f.condicao === 'nao_vazio';
              const ultimo = i === filtros.length - 1;
              return (
                <div key={i} className="filtros-visual-linha" role="row">
                  <CFormSelect size="sm" aria-label={`Coluna do filtro ${i + 1}`} value={f.coluna} onChange={(e) => set(i, { coluna: e.target.value })}>
                    {colunas.map((c) => (
                      <option key={c.nome} value={c.nome}>
                        {calc.rotulos[c.nome] ?? c.nome}
                      </option>
                    ))}
                  </CFormSelect>
                  <CFormSelect size="sm" aria-label={`Condição do filtro ${i + 1}`} value={f.condicao} onChange={(e) => set(i, { condicao: e.target.value })}>
                    {CONDICOES.map(([k, n]) => (
                      <option key={k} value={k}>
                        {n}
                      </option>
                    ))}
                  </CFormSelect>
                  <CFormInput
                    size="sm"
                    aria-label={`Valor do filtro ${i + 1}`}
                    placeholder={semValor ? 'Sem valor' : 'Ex.: 00d 02:00, 15, Itajaí ou exec=…'}
                    disabled={semValor}
                    maxLength={500}
                    className={/^\s*exec\s*=/i.test(f.valor) ? 'font-monospace' : undefined}
                    value={semValor ? '' : f.valor}
                    onChange={(e) => set(i, { valor: e.target.value })}
                  />
                  <CFormSelect size="sm" aria-label={`Ligação com o próximo filtro`} disabled={ultimo} value={f.ligacao} onChange={(e) => set(i, { ligacao: e.target.value as 'e' | 'ou' })}>
                    <option value="e">E</option>
                    <option value="ou">OU</option>
                  </CFormSelect>
                  <CButton size="sm" color="danger" variant="ghost" aria-label={`Remover filtro ${i + 1}`} onClick={() => setFiltros((a) => a.filter((_, k) => k !== i))}>
                    <CIcon icon={cilTrash} />
                  </CButton>
                </div>
              );
            })}
          </div>
        )}
        <CButton
          size="sm"
          color="primary"
          variant="outline"
          disabled={filtros.length >= 20 || !colunas.length}
          onClick={() => setFiltros((a) => [...a, { coluna: colunas[0]?.nome ?? '', condicao: 'menor_igual', valor: '', ligacao: 'e' }])}
        >
          <CIcon icon={cilPlus} className="me-1" />
          Adicionar filtro
        </CButton>
        {filtros.some((f) => f.ligacao === 'ou') && filtros.length > 2 && (
          <p className="small text-body-secondary mt-2 mb-0">"E" vale antes de "OU": A E B OU C é lido como (A E B) OU C.</p>
        )}
        {temExec && !podeExec && (
          <CAlert color="warning" className="mt-3 mb-0 small">
            Valores com exec= são expressões SQL: só um Desenvolvedor pode criá-los ou alterá-los. As expressões que já estavam salvas continuam
            valendo.
          </CAlert>
        )}
        <div className="filtros-visual-previa">
          <span className="editor-visual-previa-rotulo">Prévia com estes filtros</span>
          <div className="editor-visual-previa-area" style={{ height: visual.tipo === 'kpi' ? 170 : 320 }}>
            <Visual tipo={visual.tipo} titulo={visual.titulo || 'Sem título'} config={{ ...visual.config, filtrosVisual: completos }} dados={previa.dados} erro={previa.erro} />
          </div>
        </div>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          Cancelar
        </CButton>
        <CButton color="primary" onClick={() => onAplicar(completos)}>
          Aplicar filtros
        </CButton>
      </CModalFooter>
    </CModal>
  );
}
