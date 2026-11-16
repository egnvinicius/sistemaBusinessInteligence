import { useMemo } from 'react';
import { CButton, CFormInput, CFormLabel, CFormSelect, CMultiSelect } from '@coreui/react-pro';

export interface FiltroPainel {
  id: number;
  nome: string;
  parametro: string;
  tipo: 'periodo' | 'ano' | 'mes' | 'lista' | 'select';
  multiplo: boolean;
  padrao: unknown;
  opcoes: { codigo: string | number; descricao: string }[] | null;
  erro: string | null;
}

export type ValoresFiltros = Record<string, unknown>;

export const valoresIniciais = (filtros: FiltroPainel[]): ValoresFiltros =>
  Object.fromEntries(filtros.map((f) => [f.parametro, f.padrao]));

interface Props {
  filtros: FiltroPainel[];
  valores: ValoresFiltros;
  onChange: (v: ValoresFiltros) => void;
  atualizando?: boolean;
}

/** Barra de filtros do painel. Em branco = todos. */
export function BarraFiltros({ filtros, valores, onChange, atualizando }: Props) {
  const iniciais = useMemo(() => valoresIniciais(filtros), [filtros]);
  const alterado = JSON.stringify(iniciais) !== JSON.stringify(valores);
  if (!filtros.length) return null;
  const set = (p: string, v: unknown) => onChange({ ...valores, [p]: v });

  return (
    <div className="barra-filtros" role="search" aria-label="Filtros do painel">
      {filtros.map((f) => {
        const id = `filtro-${f.id}`;
        const v = valores[f.parametro];
        if (f.tipo === 'periodo') {
          const p = (v ?? {}) as { de?: string | null; ate?: string | null };
          return (
            <div key={f.id} className="filtro filtro-periodo">
              <CFormLabel htmlFor={`${id}-de`}>{f.nome}</CFormLabel>
              <div className="filtro-periodo-campos">
                <CFormInput id={`${id}-de`} type="date" size="sm" aria-label={`${f.nome}: de`} value={p.de ?? ''} max={p.ate ?? undefined} onChange={(e) => set(f.parametro, { ...p, de: e.target.value || null })} />
                <span>até</span>
                <CFormInput type="date" size="sm" aria-label={`${f.nome}: até`} value={p.ate ?? ''} min={p.de ?? undefined} onChange={(e) => set(f.parametro, { ...p, ate: e.target.value || null })} />
              </div>
            </div>
          );
        }
        if (f.erro) {
          return (
            <div key={f.id} className="filtro">
              <span className="form-label">{f.nome}</span>
              <span className="filtro-erro">{f.erro}</span>
            </div>
          );
        }
        if (f.tipo === 'ano' || f.tipo === 'mes' || !f.multiplo) {
          return (
            <div key={f.id} className="filtro">
              <CFormLabel htmlFor={id}>{f.nome}</CFormLabel>
              <CFormSelect
                id={id}
                size="sm"
                value={v === null || v === undefined || (Array.isArray(v) && !v.length) ? '' : String(Array.isArray(v) ? v[0] : v)}
                onChange={(e) => {
                  const x = e.target.value;
                  set(f.parametro, x === '' ? (f.multiplo ? [] : null) : f.tipo === 'ano' || f.tipo === 'mes' ? Number(x) : x);
                }}
              >
                <option value="">Todos</option>
                {f.opcoes?.map((o) => (
                  <option key={o.codigo} value={String(o.codigo)}>
                    {o.descricao}
                  </option>
                ))}
              </CFormSelect>
            </div>
          );
        }
        const marcados = new Set((Array.isArray(v) ? v : []).map(String));
        return (
          <div key={f.id} className="filtro filtro-multiplo">
            <CFormLabel id={`${id}-label`} htmlFor={`search${id}`}>
              {f.nome}
            </CFormLabel>
            <CMultiSelect
              id={id}
              size="sm"
              options={(f.opcoes ?? []).map((o) => ({ value: String(o.codigo), label: o.descricao, selected: marcados.has(String(o.codigo)) }))}
              selectionType="counter"
              selectionTypeCounterText="selecionados"
              optionsStyle="checkbox"
              placeholder="Todos"
              searchNoResultsLabel="Nada encontrado"
              selectAllLabel="Marcar todos"
              search
              cleaner
              resetSelectionOnOptionsChange={false}
              onChange={(sel) => {
                const novos = sel.map((s) => String(s.value)).sort();
                const atuais = [...marcados].sort();
                if (novos.join('\u0001') !== atuais.join('\u0001')) set(f.parametro, novos);
              }}
            />
          </div>
        );
      })}
      <div className="filtro filtro-acoes">
        {atualizando && <span className="filtro-atualizando" role="status">Atualizando…</span>}
        {alterado && (
          <CButton size="sm" color="secondary" variant="ghost" onClick={() => onChange(iniciais)}>
            Restaurar filtros
          </CButton>
        )}
      </div>
    </div>
  );
}
