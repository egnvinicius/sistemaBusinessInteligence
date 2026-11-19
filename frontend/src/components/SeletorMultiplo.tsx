import { useMemo } from 'react';
import { CFormLabel, CMultiSelect } from '@coreui/react-pro';

export interface OpcaoSeletor {
  value: number;
  label: string;
  /** Quando informado, as opções aparecem agrupadas por este rótulo. */
  grupo?: string;
}

interface Props {
  id: string;
  /** Rótulo ligado ao campo de busca do componente (acessível por leitor de tela). */
  rotulo: string;
  opcoes: OpcaoSeletor[];
  valor: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  vazio?: string;
}

/** CMultiSelect controlado por uma lista de ids. */
export function SeletorMultiplo({ id, rotulo, opcoes, valor, onChange, placeholder, vazio }: Props) {
  const selecionados = useMemo(() => new Set(valor), [valor]);

  const options = useMemo(() => {
    const comSelecao = opcoes.map((o) => ({ value: o.value, label: o.label, selected: selecionados.has(o.value), _g: o.grupo }));
    if (!opcoes.some((o) => o.grupo)) return comSelecao;
    const grupos = new Map<string, typeof comSelecao>();
    for (const o of comSelecao) {
      const chave = o._g ?? '';
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave)!.push(o);
    }
    return [...grupos.entries()].map(([label, options]) => ({ label, options }));
  }, [opcoes, selecionados]);

  return (
    <>
    <CFormLabel id={`${id}-label`} htmlFor={`search${id}`}>
      {rotulo}
    </CFormLabel>
    <CMultiSelect
      id={id}
      options={options}
      selectionType="tags"
      optionsStyle="checkbox"
      placeholder={placeholder ?? 'Selecione'}
      searchNoResultsLabel={vazio ?? 'Nada encontrado'}
      selectAllLabel="Selecionar todos"
      deselectAllLabel="Limpar seleção"
      search
      cleaner
      resetSelectionOnOptionsChange={false}
      onChange={(sel) => {
        const ids = sel.map((s) => Number(s.value)).sort((a, b) => a - b);
        const atual = [...valor].sort((a, b) => a - b);
        // Só propaga mudanças reais (o componente também avisa ao montar)
        if (ids.length !== atual.length || ids.some((v, i) => v !== atual[i])) onChange(ids);
      }}
    />
    </>
  );
}
