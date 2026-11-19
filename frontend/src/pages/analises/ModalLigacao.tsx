import { useState } from 'react';
import { CButton, CFormLabel, CFormSelect, CModal, CModalBody, CModalFooter, CModalHeader, CModalTitle } from '@coreui/react-pro';
import { colunasEmComum, rotulo, type CuboInfo, type Ponta } from './modelo';

interface Props {
  cubos: CuboInfo[];
  inicial: { a: Ponta; b: Ponta };
  onFechar: () => void;
  onAplicar: (a: Ponta, b: Ponta) => void;
}

/** Liga dois cubos por uma coluna de cada um (os valores das duas colunas precisam ser os mesmos, ex.: código do veículo). */
export function ModalLigacao({ cubos, inicial, onFechar, onAplicar }: Props) {
  const [a, setA] = useState<Ponta>(inicial.a);
  const [b, setB] = useState<Ponta>(inicial.b);
  const cuboA = cubos.find((c) => c.id === a.cuboId);
  const cuboB = cubos.find((c) => c.id === b.cuboId);
  const comuns = cuboA && cuboB ? colunasEmComum(cuboA, cuboB) : [];

  const lado = (p: Ponta, set: (p: Ponta) => void, outro: number, id: string, titulo: string) => {
    const cubo = cubos.find((c) => c.id === p.cuboId);
    return (
      <fieldset className="ligacao-lado">
        <legend className="form-label fs-6">{titulo}</legend>
        <CFormLabel htmlFor={`${id}-cubo`} className="visually-hidden">
          Cubo
        </CFormLabel>
        <CFormSelect
          id={`${id}-cubo`}
          className="mb-2"
          value={p.cuboId}
          onChange={(e) => {
            const c = cubos.find((x) => x.id === Number(e.target.value))!;
            set({ cuboId: c.id, coluna: c.colunas[0]?.nome ?? '' });
          }}
        >
          {cubos
            .filter((c) => c.id !== outro || c.id === p.cuboId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
        </CFormSelect>
        <CFormLabel htmlFor={`${id}-col`}>Coluna</CFormLabel>
        <CFormSelect id={`${id}-col`} value={p.coluna} onChange={(e) => set({ ...p, coluna: e.target.value })}>
          {cubo?.colunas.map((x) => (
            <option key={x.nome} value={x.nome}>
              {rotulo(x)}
              {x.descricao?.trim() ? ` (${x.nome})` : ''}
            </option>
          ))}
        </CFormSelect>
      </fieldset>
    );
  };

  return (
    <CModal visible onClose={onFechar} alignment="center">
      <CModalHeader>
        <CModalTitle>Ligar cubos</CModalTitle>
      </CModalHeader>
      <CModalBody>
        <p className="small text-body-secondary">
          Escolha a coluna que identifica a mesma coisa nos dois cubos, como o código do veículo. Os filtros passam de um cubo para o outro por ela.
        </p>
        <div className="ligacao-lados">
          {lado(a, setA, b.cuboId, 'lig-a', 'Primeiro cubo')}
          <span className="ligacao-igual" aria-hidden="true">
            =
          </span>
          {lado(b, setB, a.cuboId, 'lig-b', 'Segundo cubo')}
        </div>
        {comuns.length > 0 && (
          <p className="small text-body-secondary mb-0 mt-2">
            Colunas com o mesmo nome nos dois: {comuns.join(', ')}.
          </p>
        )}
        {a.cuboId === b.cuboId && <p className="text-danger small mb-0 mt-2">Escolha dois cubos diferentes.</p>}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="ghost" onClick={onFechar}>
          Cancelar
        </CButton>
        <CButton color="primary" disabled={a.cuboId === b.cuboId || !a.coluna || !b.coluna} onClick={() => onAplicar(a, b)}>
          Ligar
        </CButton>
      </CModalFooter>
    </CModal>
  );
}
