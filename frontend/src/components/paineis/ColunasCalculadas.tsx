import { useEffect, useRef, useState } from 'react';
import { CButton, CFormInput, CFormLabel, CFormTextarea } from '@coreui/react-pro';
import CIcon from '@coreui/icons-react';
import { cilPencil, cilPlus, cilTrash } from '@coreui/icons';
import { api, mensagemDeErro } from '../../api/client';
import { rotuloColuna } from '../../lib/graficos';

/** Coluna criada por fórmula, só deste visual */
export interface Calculada {
  nome: string;
  rotulo: string;
  formula: string;
}

export interface ColunaBase {
  nome: string;
  tipo: string;
  descricao?: string | null;
}

export type TipoColuna = 'numero' | 'texto' | 'data';

export interface InfoCalculada {
  /** true: valor por grupo (SOMA, CONTAR…), usado só como valor do visual */
  agregada: boolean;
  tipo: TipoColuna;
  erro?: string;
}

const AGREGADAS = /\b(SOMA|MEDIA|MÉDIA|MINIMO|MÍNIMO|MAXIMO|MÁXIMO|CONTAR|CONTAR_DISTINTOS)\s*\(/i;
export const MAX_CALCULADAS = 10;

/** Resultado da conferência no servidor, guardado para não repetir o pedido */
const memoria = new Map<string, InfoCalculada & { formula?: string }>();

async function conferir(formula: string, colunas: ColunaBase[], anteriores: Calculada[]): Promise<InfoCalculada & { formula?: string }> {
  const chave = JSON.stringify([formula, colunas.map((c) => [c.nome, c.tipo, c.descricao ?? '']), anteriores]);
  const pronto = memoria.get(chave);
  if (pronto) return pronto;
  try {
    const r = await api.post('/paineis/formula', { formula, colunas: colunas.map((c) => ({ nome: c.nome, tipo: c.tipo, descricao: c.descricao ?? null })), anteriores });
    const info = { agregada: r.data.agregada, tipo: r.data.tipo, formula: r.data.formula as string };
    memoria.set(chave, info);
    return info;
  } catch (e) {
    const info: InfoCalculada = { agregada: AGREGADAS.test(formula), tipo: 'numero', erro: mensagemDeErro(e) };
    if ((e as any)?.response?.status === 400) memoria.set(chave, info);
    return info;
  }
}

/**
 * Tipo de cada coluna calculada (conferido no servidor) e as listas prontas para os seletores:
 * as "por linha" valem como colunas comuns; as agregadas só como valor.
 */
export function useCalculadas(calculadas: Calculada[] | undefined, colunas: ColunaBase[]) {
  const lista = calculadas ?? [];
  const [info, setInfo] = useState<Record<string, InfoCalculada>>({});
  const chave = JSON.stringify([lista, colunas.map((c) => [c.nome, c.tipo])]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const novo: Record<string, InfoCalculada> = {};
      for (let i = 0; i < lista.length; i++) {
        const r = await conferir(lista[i].formula, colunas, lista.slice(0, i));
        novo[lista[i].nome] = { agregada: r.agregada, tipo: r.tipo, erro: r.erro };
      }
      if (ativo) setInfo(novo);
    })();
    return () => {
      ativo = false;
    };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enquanto o servidor não responde, adivinha pelo texto (SOMA(…) etc. = agregada)
  const de = (c: Calculada): InfoCalculada => info[c.nome] ?? { agregada: AGREGADAS.test(c.formula), tipo: 'numero' };
  const porLinha = lista.filter((c) => !de(c).agregada).map((c) => ({ nome: c.nome, tipo: de(c).tipo, descricao: c.rotulo }));
  const agregadas = lista.filter((c) => de(c).agregada).map((c) => ({ nome: c.nome, tipo: 'numero' as TipoColuna, descricao: c.rotulo }));
  const rotulos: Record<string, string> = Object.fromEntries(lista.map((c) => [c.nome, c.rotulo]));
  /** Nome para mostrar nos seletores */
  const nomeDe = (n: string) => rotulos[n] ?? rotuloColuna(n);
  return { info: Object.fromEntries(lista.map((c) => [c.nome, de(c)])), porLinha, agregadas, nomeDe, rotulos };
}

const FUNCOES: { nome: string; modelo: string; ajuda: string }[] = [
  { nome: 'SOMA', modelo: 'SOMA([coluna]; condição)', ajuda: 'Soma a coluna. A condição é opcional: só as linhas que a atendem entram.' },
  { nome: 'CONTAR', modelo: 'CONTAR(condição)', ajuda: 'Conta as linhas. Sem condição, conta todas.' },
  { nome: 'MEDIA', modelo: 'MEDIA([coluna]; condição)', ajuda: 'Média da coluna, com condição opcional.' },
  { nome: 'MINIMO', modelo: 'MINIMO([coluna]; condição)', ajuda: 'Menor valor, com condição opcional.' },
  { nome: 'MAXIMO', modelo: 'MAXIMO([coluna]; condição)', ajuda: 'Maior valor, com condição opcional.' },
  { nome: 'CONTAR_DISTINTOS', modelo: 'CONTAR_DISTINTOS([coluna]; condição)', ajuda: 'Quantos valores diferentes a coluna tem.' },
  { nome: 'SE', modelo: 'SE(condição; se sim; se não)', ajuda: 'Escolhe um valor conforme a condição, linha a linha.' },
  { nome: 'ARRED', modelo: 'ARRED(valor; casas)', ajuda: 'Arredonda (casas decimais opcionais).' },
  { nome: 'SENULO', modelo: 'SENULO(valor; troca)', ajuda: 'Usa a troca quando o valor está vazio.' },
  { nome: 'ABS', modelo: 'ABS(valor)', ajuda: 'Valor sem sinal.' },
  { nome: 'ANO', modelo: 'ANO([data])', ajuda: 'Ano de uma data.' },
  { nome: 'MES', modelo: 'MES([data])', ajuda: 'Mês (1 a 12) de uma data.' },
  { nome: 'DIA', modelo: 'DIA([data])', ajuda: 'Dia do mês de uma data.' },
];

const descricaoTipo = (i: InfoCalculada) =>
  i.agregada ? 'Valor por grupo' : `Por linha · ${i.tipo === 'texto' ? 'texto' : i.tipo === 'data' ? 'data' : 'número'}`;

function novoNome(rotulo: string, usados: string[]) {
  const base =
    'calc_' +
    (rotulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'coluna');
  let n = base;
  for (let i = 2; usados.includes(n); i++) n = `${base.slice(0, 27)}_${i}`;
  return n;
}

/**
 * Lista e edição das colunas calculadas de um visual. A fórmula usa colunas entre colchetes,
 * textos entre aspas e ";" entre os argumentos, como no Excel em português.
 */
export function EditorCalculadas({
  calculadas,
  colunas,
  info,
  onChange,
}: {
  calculadas: Calculada[];
  colunas: ColunaBase[];
  info: Record<string, InfoCalculada>;
  /** removida: nome da coluna que saiu (para limpar o que a usava) */
  onChange: (lista: Calculada[], removida?: string) => void;
}) {
  const [editando, setEditando] = useState<{ indice: number | null; rotulo: string; formula: string } | null>(null);
  const [conferencia, setConferencia] = useState<(InfoCalculada & { formula?: string }) | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);

  // Colunas que a fórmula em edição pode usar: as da origem e as calculadas por linha anteriores a ela
  const indiceAtual = editando?.indice ?? calculadas.length;
  const anteriores = calculadas.slice(0, indiceAtual);
  const usaveis = [
    ...colunas.map((c) => ({ nome: c.nome, rotulo: c.descricao || c.nome, tipo: c.tipo })),
    ...anteriores.filter((c) => !info[c.nome]?.agregada).map((c) => ({ nome: c.nome, rotulo: c.rotulo, tipo: info[c.nome]?.tipo ?? 'numero' })),
  ];

  useEffect(() => {
    if (!editando?.formula.trim()) {
      setConferencia(null);
      return;
    }
    let ativo = true;
    setConferindo(true);
    const t = window.setTimeout(async () => {
      const r = await conferir(editando.formula, colunas, anteriores);
      if (ativo) {
        setConferencia(r);
        setConferindo(false);
      }
    }, 400);
    return () => {
      ativo = false;
      window.clearTimeout(t);
    };
  }, [editando?.formula, indiceAtual, JSON.stringify(anteriores)]); // eslint-disable-line react-hooks/exhaustive-deps

  const inserir = (texto: string, recuoCursor = 0) => {
    if (!editando) return;
    const el = caixa.current;
    const ini = el?.selectionStart ?? editando.formula.length;
    const fim = el?.selectionEnd ?? editando.formula.length;
    const formula = editando.formula.slice(0, ini) + texto + editando.formula.slice(fim);
    setEditando({ ...editando, formula });
    window.requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = ini + texto.length - recuoCursor;
      el.setSelectionRange(pos, pos);
    });
  };

  const abrir = (indice: number | null) => {
    setErroForm(null);
    setConferencia(null);
    setEditando(indice === null ? { indice, rotulo: '', formula: '' } : { indice, rotulo: calculadas[indice].rotulo, formula: calculadas[indice].formula });
  };

  const salvar = () => {
    if (!editando) return;
    const rotulo = editando.rotulo.trim();
    if (!rotulo) return setErroForm('Dê um nome à coluna.');
    if (calculadas.some((c, i) => i !== editando.indice && c.rotulo.trim().toLowerCase() === rotulo.toLowerCase())) return setErroForm('Já existe uma coluna calculada com esse nome.');
    if (conferindo || !conferencia) return setErroForm('Aguarde a conferência da fórmula.');
    if (conferencia.erro) return setErroForm(conferencia.erro);
    const formula = conferencia.formula ?? editando.formula.trim();
    if (editando.indice === null) {
      onChange([...calculadas, { nome: novoNome(rotulo, calculadas.map((c) => c.nome)), rotulo, formula }]);
    } else {
      onChange(calculadas.map((c, i) => (i === editando.indice ? { ...c, rotulo, formula } : c)));
    }
    setEditando(null);
  };

  const exemplo = () => {
    const texto = colunas.find((c) => c.tipo === 'texto');
    const numero = colunas.find((c) => c.tipo === 'numero');
    const t = texto ? `[${texto.nome}]` : '[processo]';
    const n = numero ? `[${numero.nome}]` : '[quantidade]';
    setEditando((e) => e && { ...e, rotulo: e.rotulo || '% do total', formula: `SOMA(${n}; ${t} = "X") / SOMA(${n}) * 100` });
  };

  return (
    <fieldset className="mb-3 calculadas">
      <legend className="form-label fs-6 mb-1">Colunas calculadas</legend>
      <p className="form-text mt-0 mb-2">
        Crie valores com fórmulas, sem mudar a consulta. Com SOMA, CONTAR e afins, o valor é calculado para cada barra, fatia ou período do visual, depois
        dos filtros: por exemplo, o percentual de um processo sobre o total do mês.
      </p>
      {calculadas.length > 0 && (
        <ul className="calculadas-lista">
          {calculadas.map((c, i) => {
            const inf = info[c.nome];
            return (
              <li key={c.nome} className={inf?.erro ? 'com-erro' : ''}>
                <div className="calculadas-cab">
                  <strong>{c.rotulo}</strong>
                  {inf && <span className={`calculadas-tipo${inf.agregada ? ' agregada' : ''}`}>{inf.erro ? 'Com erro' : descricaoTipo(inf)}</span>}
                  <span className="calculadas-acoes">
                    <CButton size="sm" color="secondary" variant="ghost" onClick={() => abrir(i)} aria-label={`Editar ${c.rotulo}`} disabled={!!editando}>
                      <CIcon icon={cilPencil} />
                    </CButton>
                    <CButton
                      size="sm"
                      color="danger"
                      variant="ghost"
                      aria-label={`Excluir ${c.rotulo}`}
                      disabled={!!editando}
                      onClick={() => onChange(calculadas.filter((_, k) => k !== i), c.nome)}
                    >
                      <CIcon icon={cilTrash} />
                    </CButton>
                  </span>
                </div>
                <code className="calculadas-formula">{c.formula}</code>
                {inf?.erro && <div className="text-danger small">{inf.erro}</div>}
              </li>
            );
          })}
        </ul>
      )}

      {editando ? (
        <div className="calculadas-form">
          <div className="mb-2">
            <CFormLabel htmlFor="calc-rotulo">Nome da coluna</CFormLabel>
            <CFormInput id="calc-rotulo" value={editando.rotulo} maxLength={60} placeholder="Ex.: % do processo no mês" onChange={(e) => setEditando({ ...editando, rotulo: e.target.value })} />
          </div>
          <div className="mb-2">
            <div className="d-flex justify-content-between align-items-end">
              <CFormLabel htmlFor="calc-formula">Fórmula</CFormLabel>
              <button type="button" className="btn btn-link btn-sm p-0 mb-1" onClick={exemplo}>
                Usar exemplo de percentual
              </button>
            </div>
            <CFormTextarea
              id="calc-formula"
              ref={caixa}
              rows={3}
              maxLength={1000}
              spellCheck={false}
              className="calculadas-caixa"
              placeholder='SOMA([quantidade]; [processo] = "X") / SOMA([quantidade]) * 100'
              value={editando.formula}
              onChange={(e) => setEditando({ ...editando, formula: e.target.value })}
              aria-describedby="calc-conferencia"
            />
            <div id="calc-conferencia" className="calculadas-conferencia" aria-live="polite">
              {!editando.formula.trim() ? (
                <span className="text-body-secondary">Clique numa coluna ou função abaixo para inserir na fórmula.</span>
              ) : conferindo || !conferencia ? (
                <span className="text-body-secondary">Conferindo…</span>
              ) : conferencia.erro ? (
                <span className="text-danger">{conferencia.erro}</span>
              ) : conferencia.agregada ? (
                <span className="text-success">Fórmula certa. Valor por grupo: escolha esta coluna como Valor do visual.</span>
              ) : (
                <span className="text-success">
                  Fórmula certa. Vira uma coluna nova em cada linha ({conferencia.tipo === 'texto' ? 'texto' : conferencia.tipo === 'data' ? 'data' : 'número'}): use como
                  categoria, coluna da tabela, filtro ou valor somado.
                </span>
              )}
            </div>
          </div>
          <div className="calculadas-paleta" aria-label="Colunas">
            <span className="destaque-rotulo">Colunas</span>
            {usaveis.map((c) => (
              <button key={c.nome} type="button" className="calculadas-chip" title={`${c.nome} (${c.tipo})`} onClick={() => inserir(`[${c.nome}]`)}>
                {c.rotulo === c.nome ? rotuloColuna(c.nome) : c.rotulo}
              </button>
            ))}
          </div>
          <div className="calculadas-paleta" aria-label="Funções">
            <span className="destaque-rotulo">Funções</span>
            {FUNCOES.map((f) => (
              <button key={f.nome} type="button" className="calculadas-chip funcao" title={`${f.modelo}: ${f.ajuda}`} onClick={() => inserir(`${f.nome}()`, 1)}>
                {f.nome}
              </button>
            ))}
          </div>
          <details className="calculadas-ajuda">
            <summary>Como escrever</summary>
            <ul>
              <li>
                Colunas entre colchetes: <code>[quantidade]</code>. Textos entre aspas: <code>"Pneus"</code> (maiúsculas e acentos não importam).
              </li>
              <li>
                Separe os argumentos com ponto e vírgula; decimais com vírgula: <code>ARRED([valor] * 1,1; 2)</code>.
              </li>
              <li>
                Contas <code>+ - * /</code>, comparações <code>= &lt;&gt; &gt; &lt; &gt;= &lt;=</code> e <code>E</code>, <code>OU</code>, <code>NAO</code>.
              </li>
              {FUNCOES.map((f) => (
                <li key={f.nome}>
                  <code>{f.modelo}</code>: {f.ajuda}
                </li>
              ))}
              <li>
                Percentual de um processo no total do grupo: <code>SOMA([quantidade]; [processo] = "X") / SOMA([quantidade]) * 100</code>, com o formato
                Percentual.
              </li>
              <li>
                Faixa por linha: <code>SE([valor] &gt; 1000; "Alto"; "Baixo")</code>, para usar como categoria.
              </li>
            </ul>
          </details>
          {erroForm && <div className="text-danger small mt-2">{erroForm}</div>}
          <div className="d-flex gap-2 mt-2">
            <CButton size="sm" color="primary" onClick={salvar} disabled={conferindo}>
              {editando.indice === null ? 'Criar coluna' : 'Salvar coluna'}
            </CButton>
            <CButton size="sm" color="secondary" variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </CButton>
          </div>
        </div>
      ) : (
        <CButton size="sm" color="primary" variant="outline" onClick={() => abrir(null)} disabled={calculadas.length >= MAX_CALCULADAS || !colunas.length}>
          <CIcon icon={cilPlus} className="me-1" />
          Nova coluna calculada
        </CButton>
      )}
    </fieldset>
  );
}

/** Tira as referências a uma coluna calculada excluída da configuração do visual */
export function semReferencias(config: Record<string, any>, nome: string): Record<string, any> {
  const c = { ...config };
  for (const k of ['medida', 'meta', 'categoria']) if (c[k] === nome) c[k] = null;
  if (Array.isArray(c.medidas)) c.medidas = c.medidas.filter((m: string) => m !== nome);
  if (Array.isArray(c.colunas)) c.colunas = c.colunas.filter((m: string) => m !== nome);
  if (Array.isArray(c.filtrosVisual)) c.filtrosVisual = c.filtrosVisual.filter((f: any) => f.coluna !== nome);
  if (Array.isArray(c.destaques)) c.destaques = c.destaques.filter((d: any) => d.coluna !== nome);
  for (const k of ['rotulos', 'cores']) {
    if (c[k] && nome in c[k]) {
      c[k] = { ...c[k] };
      delete c[k][nome];
    }
  }
  return c;
}
