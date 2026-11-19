import { CButton, CFormInput, CFormSelect, CFormSwitch } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilArrowBottom, cilArrowTop, cilPlus, cilTrash } from '@coreui/icons';
import { CONDICOES } from '../../lib/filtrosVisual';

export interface RegraDestaque {
  coluna: string;
  condicao: string;
  valor: string;
  alvo: 'marcador' | 'linha' | 'celula';
  colunaAlvo: string | null;
  corFundo: string | null;
  corFonte: string | null;
  piscar: boolean;
  prioridade: number;
  legenda: string | null;
}



/** Cores de situação, as mesmas dos indicadores; "Outra" abre o seletor de cor. */
const CORES: [string, string][] = [
  ['#0ca30c', 'Verde'],
  ['#fab219', 'Amarelo'],
  ['#ec835a', 'Laranja'],
  ['#d03b3b', 'Vermelho'],
  ['#2a78d6', 'Azul'],
];

const nova = (coluna: string, prioridade: number): RegraDestaque => ({
  coluna,
  condicao: 'maior',
  valor: '',
  alvo: 'marcador',
  colunaAlvo: null,
  corFundo: '#d03b3b',
  corFonte: null,
  piscar: false,
  prioridade,
  legenda: null,
});

export function SeletorCor({ id, rotulo, valor, opcional, textoAutomatico = 'Automática', onChange }: { id: string; rotulo: string; valor: string | null; opcional?: boolean; textoAutomatico?: string; onChange: (v: string | null) => void }) {
  return (
    <div className="destaque-cor" role="group" aria-label={rotulo}>
      <span className="destaque-rotulo">{rotulo}</span>
      <div className="destaque-cores">
        {opcional && (
          <button type="button" className={`destaque-amostra automatica ${valor === null ? 'ativa' : ''}`} title={textoAutomatico} aria-label={textoAutomatico} aria-pressed={valor === null} onClick={() => onChange(null)}>
            A
          </button>
        )}
        {CORES.map(([hex, nome]) => (
          <button
            key={hex}
            type="button"
            className={`destaque-amostra ${valor?.toLowerCase() === hex ? 'ativa' : ''}`}
            style={{ backgroundColor: hex }}
            title={nome}
            aria-label={nome}
            aria-pressed={valor?.toLowerCase() === hex}
            onClick={() => onChange(hex)}
          />
        ))}
        <input id={id} type="color" className="destaque-outra" title="Outra cor" aria-label={`${rotulo}: outra cor`} value={valor ?? '#000000'} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

interface Props {
  regras: RegraDestaque[];
  colunas: { nome: string; descricao?: string | null }[];
  colunasExibidas: string[];
  onChange: (r: RegraDestaque[]) => void;
}

/**
 * Regras de destaque da Tabela. Cada regra: quando <coluna> <condição> <valor>,
 * pinta o marcador, a linha inteira ou uma célula. Vale a de menor prioridade.
 */
export function EditorDestaques({ regras, colunas, colunasExibidas, onChange }: Props) {
  const set = (i: number, p: Partial<RegraDestaque>) => onChange(regras.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const mover = (i: number, d: number) => {
    const a = [...regras];
    [a[i], a[i + d]] = [a[i + d], a[i]];
    onChange(a);
  };

  return (
    <fieldset className="destaques">
      <legend className="form-label fs-6 mb-1">Destaques</legend>
      <p className="form-text mt-0 mb-2">
        Pinte a linha, uma célula ou o marcador (coluna colorida no início da tabela) quando uma coluna atender a condição. A condição pode usar
        colunas que não aparecem na tabela. Durações como <code>00d 01:00</code> ou <code>01:00</code> são comparadas como tempo. Quando várias
        regras pintam o mesmo lugar, vale a de menor prioridade.
      </p>
      {regras.map((r, i) => {
        const semValor = r.condicao === 'vazio' || r.condicao === 'nao_vazio';
        return (
          <div key={i} className="destaque-regra">
            <div className="destaque-linha">
              <span className="destaque-rotulo">Quando</span>
              <CFormSelect size="sm" aria-label="Coluna da condição" value={r.coluna} onChange={(e) => set(i, { coluna: e.target.value })}>
                {colunas.map((c) => (
                  <option key={c.nome} value={c.nome}>
                    {c.nome.startsWith('calc_') && c.descricao ? c.descricao : c.nome}
                  </option>
                ))}
              </CFormSelect>
              <CFormSelect size="sm" aria-label="Condição" value={r.condicao} onChange={(e) => set(i, { condicao: e.target.value })}>
                {CONDICOES.map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </CFormSelect>
              {!semValor && (
                <CFormInput size="sm" aria-label="Valor" placeholder="Ex.: 6 ou 00d 01:00" maxLength={120} value={r.valor} onChange={(e) => set(i, { valor: e.target.value })} />
              )}
              <div className="destaque-acoes">
                <CButton size="sm" color="secondary" variant="ghost" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir regra">
                  <CIcon icon={cilArrowTop} />
                </CButton>
                <CButton size="sm" color="secondary" variant="ghost" disabled={i === regras.length - 1} onClick={() => mover(i, 1)} aria-label="Descer regra">
                  <CIcon icon={cilArrowBottom} />
                </CButton>
                <CButton size="sm" color="danger" variant="ghost" onClick={() => onChange(regras.filter((_, k) => k !== i))} aria-label="Remover regra">
                  <CIcon icon={cilTrash} />
                </CButton>
              </div>
            </div>
            <div className="destaque-linha">
              <span className="destaque-rotulo">Pintar</span>
              <CFormSelect
                size="sm"
                aria-label="Onde aplicar"
                value={r.alvo}
                onChange={(e) => {
                  const alvo = e.target.value as RegraDestaque['alvo'];
                  set(i, { alvo, colunaAlvo: alvo === 'celula' ? (r.colunaAlvo ?? (colunasExibidas.includes(r.coluna) ? r.coluna : colunasExibidas[0] ?? null)) : null });
                }}
              >
                <option value="marcador">o marcador (coluna de destaque)</option>
                <option value="linha">a linha inteira</option>
                <option value="celula">a célula da coluna…</option>
              </CFormSelect>
              {r.alvo === 'celula' && (
                <CFormSelect size="sm" aria-label="Coluna pintada" value={r.colunaAlvo ?? ''} onChange={(e) => set(i, { colunaAlvo: e.target.value })}>
                  {colunasExibidas.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </CFormSelect>
              )}
              <CFormInput size="sm" aria-label="Legenda (opcional)" placeholder="Legenda, ex.: Crítico" maxLength={60} value={r.legenda ?? ''} onChange={(e) => set(i, { legenda: e.target.value || null })} />
            </div>
            <div className="destaque-linha destaque-linha-cores">
              <SeletorCor id={`d${i}-fundo`} rotulo={r.alvo === 'marcador' ? 'Cor' : 'Fundo'} valor={r.corFundo} onChange={(v) => set(i, { corFundo: v })} />
              {r.alvo !== 'marcador' && <SeletorCor id={`d${i}-fonte`} rotulo="Texto" opcional valor={r.corFonte} onChange={(v) => set(i, { corFonte: v })} />}
              <CFormSwitch id={`d${i}-piscar`} label="Piscar" checked={r.piscar} onChange={(e) => set(i, { piscar: e.target.checked })} />
              <label className="destaque-prioridade">
                <span className="destaque-rotulo">Prioridade</span>
                <CFormInput size="sm" type="number" min={0} max={99} value={r.prioridade} onChange={(e) => set(i, { prioridade: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })} />
              </label>
            </div>
          </div>
        );
      })}
      <CButton size="sm" color="primary" variant="outline" disabled={regras.length >= 30 || !colunas.length} onClick={() => onChange([...regras, nova(colunas[0]?.nome ?? '', regras.length)])}>
        <CIcon icon={cilPlus} className="me-1" />
        Adicionar destaque
      </CButton>
    </fieldset>
  );
}
